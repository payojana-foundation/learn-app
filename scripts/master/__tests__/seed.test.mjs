import { describe, it, expect } from 'vitest';
import { LABELS } from '../../catalogue/sheets-map.mjs';
import { HIDDEN_TABS } from '../../catalogue/catalogue-build.mjs';
import {
  buildMaster, buildCourses, coursesCsv, acastEmbedUrl, acastEpisodeId, loadColumns, masterCsv, legacyCsv, excludedCsv, rawLink, minicourseDecision, scanMiniCourse,
  writeToSheet, RefuseError, DETAILS_LABEL, YOUTUBE_EXTRA_LABEL,
} from '../seed.mjs';
import { parseCsvObjects } from '../csv.mjs';

const columns = loadColumns();
const KEYS = columns.columns.map((c) => c.key);
const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (id) => `https://drive.google.com/file/d/${DID(id)}/view`;
const F1 = 'FILEONE00000000000000000000000001';
const F2 = 'FILETWO00000000000000000000000002';
const SLUG = 't-one';
const teachers = [{ slug: SLUG, name_km: 'Teacher One Display', name_en: 'Teacher One' }];

// column order of the fixture tabs
const H0 = ['', '', '', '', 'MP3 link', 'MP4 link', 'Video for MiniCourse', 'YouTube link', DETAILS_LABEL, YOUTUBE_EXTRA_LABEL, 'Embed link from Acast', 'acast', 'Soundwise', 'Ready ?', 'MiniCourse', 'Position', '', 'Other Embed link'];
const H1 = ['L.R', LABELS.teacher, LABELS.title, LABELS.code, '', '', '', '', '', '', '', '', '', '', '', '', `${LABELS.code} Video`, ''];
const cells = (o) => [o.num ?? '', 'tc', o.title ?? '', o.code ?? '', o.mp3 ?? '', o.mp4 ?? '', o.mini ?? '', o.yt ?? '', o.details ?? '', o.ytx ?? '', o.embed ?? '', o.acast ?? '', o.sw ?? '', o.ready ?? '', o.mc ?? '', o.pos ?? '', o.vcode ?? '', o.embed2 ?? ''];
function tab(name, rows) {
  const text = [H0, H1, ...rows.map(cells)];
  return { name, text, links: text.map((r) => r.map(() => '')) };
}
const file = (id, tabs) => ({ file_id: id, file_name: '', tabs });
const ctx = (extra = {}) => ({ teacherFiles: { [F1]: SLUG }, pending: [], teachers, courseIds: { [`${F1}\tT1`]: 'c001' }, manifest: [], failedReview: new Set(), aliases: null, ...extra });
const one = (rows, c = ctx()) => buildMaster([file(F1, [tab('T1', rows)])], c);

describe('PART 2 seed: rows from the catalogue functions', () => {
  it('course_id / lesson_id come from the registry and lessonIdOf; row_key is sequential; source columns set', () => {
    const { rows } = one([{ num: '1', title: 'A', code: 'CODE0001', mp3: url('A') }, { num: '2', title: 'B', mp3: url('B') }]);
    expect(rows.map((r) => r.row_key)).toEqual(['M00001', 'M00002']);
    expect(rows.map((r) => r.course_id)).toEqual(['c001', 'c001']);
    expect(rows[0].lesson_id).toBe('CODE0001'); // code as-is
    expect(rows[1].lesson_id).toBe(`d-${DID('B')}`); // no code: d-<source id>
    expect(rows[0]).toMatchObject({ teacher: 'Teacher One Display', source_file: F1, source_tab: 'T1', source_row: '3', source_type: 'mp3', course_title_en: '', notes: '' });
    expect(Object.keys(rows[0])).toEqual(KEYS);
  });
  it('no source and no code → empty lesson_id and the issue; no title → issue; both rows still go in', () => {
    const { rows } = one([{ num: '1', title: 'A' }, { num: '2', title: '', code: 'CODE0002', mp3: url('Z') }]);
    expect(rows[0].lesson_id).toBe('');
    expect(rows[0].issues).toContain('no source, no code');
    expect(rows[0].issues).toContain('no source (no cut MP3'); // the catalogue's own hide reason
    expect(rows[1].issues).toContain('no title');
    expect(rows[1].lesson_title).toBe('');
  });
  it('learn_live = approved AND visible; audio_status order: approved > needs review > converted > not started', () => {
    const manifest = [
      { drive_file_id: DID('A'), status: 'approved' },
      { drive_file_id: DID('B'), status: 'DRAFT - needs reviewer approval' },
      { drive_file_id: DID('C'), status: 'DRAFT - needs reviewer approval' },
    ];
    const { rows } = one(
      [1, 2, 3, 4].map((n, i) => ({ num: String(n), title: `t${n}`, code: `CODE000${n}`, mp3: url('ABCD'[i]) })),
      ctx({ manifest, failedReview: new Set([DID('C')]) }),
    );
    expect(rows.map((r) => r.audio_status)).toEqual(['approved', 'converted', 'needs review', 'not started']);
    expect(rows.map((r) => r.learn_live)).toEqual(['yes', 'no', 'no', 'no']);
    expect(rows[0].issues).toBe('');
    expect(rows[1].issues).toContain('no approved manifest entry yet');
  });
  it('teacher: Khmer display name from the registry; pending file → "pending"; unmapped → empty', () => {
    const c = ctx({ pending: [{ file_id: F2, name: 'x' }] });
    const { rows } = buildMaster([file(F1, [tab('T1', [{ num: '1', title: 'A', code: 'CODE0001', mp3: url('A') }])]), file(F2, [tab('T2', [{ num: '1', title: 'B', code: 'CODE0009', mp3: url('Q') }])])], c);
    expect(rows.map((r) => r.teacher)).toEqual(['Teacher One Display', 'pending']);
    expect(rows[1].issues).toContain('PENDING TEACHER');
    const none = buildMaster([file(F2, [tab('T2', [{ num: '1', title: 'B', code: 'CODE0009', mp3: url('Q') }])])], ctx());
    expect(none.rows[0].teacher).toBe('');
  });
  it('hidden tab rows go in with issue "hidden tab", never live; section and unnumbered rows are excluded and listed', () => {
    const { rows, excluded } = buildMaster([file(F1, [tab(HIDDEN_TABS[0], [{ num: '1', title: 'H', code: 'CODE0100', mp3: url('H') }]), tab('T1', [
      { num: '0', title: 'Section title' },
      { num: '', title: 'unnumbered title' },
      { num: '1', title: 'L1', code: 'CODE0001', mp3: url('A') },
    ])])], ctx());
    expect(rows.map((r) => [r.source_tab, r.issues.includes('hidden tab'), r.learn_live])).toEqual([[HIDDEN_TABS[0], true, 'no'], ['T1', false, 'no']]);
    expect(rows[0].lesson_id).toBe('CODE0100');
    expect(excluded.map((e) => [e.kind, e.tab, e.row, e.text])).toEqual([['unnumbered row', 'T1', 4, 'unnumbered title'], ['section row', 'T1', 3, 'Section title']]);
  });
  it('0_ tabs and tabs without a header add no rows', () => {
    const noHeader = { name: 'plain', text: [['a']], links: [['']] };
    const { rows } = buildMaster([file(F1, [tab('0_help', [{ num: '1', title: 'x', code: 'CODE0001', mp3: url('A') }]), noHeader])], ctx());
    expect(rows).toEqual([]);
  });
  it('no new course ids are made for registered tabs', () => {
    expect(one([{ num: '1', title: 'A', code: 'CODE0001', mp3: url('A') }]).stats.newCourseIds).toEqual([]);
  });
});

describe('PART 2 seed: columns of the sheet', () => {
  it('link columns, details, video_code, youtube (own column first, else the extra label), ready', () => {
    const { rows } = one([
      { num: '1', title: 'A', code: 'CODE0001', mp3: url('A'), mp4: url('B'), mini: url('C'), yt: 'https://youtu.be/x', details: 'D1', vcode: 'VCODE01', ready: 'Yes' },
      { num: '2', title: 'B', code: 'CODE0002', mp3: url('A2'), ytx: 'https://youtu.be/y', ready: 'yes' },
      { num: '3', title: 'C', code: 'CODE0003', mp3: url('A3'), ready: '' },
    ]);
    expect(rows[0]).toMatchObject({ mp3_link: url('A'), mp4_link: url('B'), minicourse_link: url('C'), youtube_link: 'https://youtu.be/x', details: 'D1', video_code: 'VCODE01', ready: 'yes' });
    expect(rows[1]).toMatchObject({ youtube_link: 'https://youtu.be/y', ready: 'yes' });
    expect(rows[2].ready).toBe('');
  });
  it('acast / soundwise / minicourse statuses (C6, C8)', () => {
    const { rows, legacy } = one([
      { num: '1', title: 'a', code: 'CODE0001', mp3: url('A'), acast: 'done', embed: 'https://embed.acast.com/1', sw: 'done', mc: 'done' },
      { num: '2', title: 'b', code: 'CODE0002', mp3: url('B'), acast: 'done', sw: '', mc: '' },
      { num: '3', title: 'c', code: 'CODE0003', mp3: url('C'), acast: '', embed: 'https://embed.acast.com/3', sw: 'STRAY VALUE ' },
      { num: '4', title: 'd', code: 'CODE0004', mp3: url('D') },
    ]);
    expect(rows.map((r) => r.acast_status)).toEqual(['posted', 'posted', 'posted', 'to do']);
    expect(rows.map((r) => r.acast_embed)).toEqual(['https://embed.acast.com/1', '', 'https://embed.acast.com/3', '']);
    expect(rows.map((r) => r.issues.includes('acast embed missing'))).toEqual([false, true, false, false]);
    expect(rows.map((r) => r.soundwise_status)).toEqual(['posted', 'to do', 'to do', 'to do']);
    expect(rows.map((r) => r.minicourse_status)).toEqual(['posted', 'to do', 'to do', 'to do']);
    // the stray Soundwise value is kept byte-for-byte in Legacy
    expect(legacy.filter((l) => l.label === 'Soundwise')).toEqual([{ row_key: 'M00003', source_file: F1, source_tab: 'T1', source_row: '5', label: 'Soundwise', value: 'STRAY VALUE ' }]);
  });
  it('PART 4: acast_embed is decided by the URL host (both embed labels); anything else stays in Legacy', () => {
    const { rows, legacy } = one([
      { num: '1', title: 'a', code: 'CODE0001', mp3: url('A'), embed2: 'https://play.acast.com/s/x/1' },
      { num: '2', title: 'b', code: 'CODE0002', mp3: url('B'), embed: 'https://example.com/e/2', acast: 'done' },
      { num: '3', title: 'c', code: 'CODE0003', mp3: url('C'), embed2: '6748088e74eb04a4db2ba53c' },
      { num: '4', title: 'd', code: 'CODE0004', mp3: url('D'), embed: 'https://embed.acast.com/4', embed2: 'https://play.acast.com/s/y/4' },
    ]);
    expect(rows.map((r) => r.acast_embed)).toEqual(['https://play.acast.com/s/x/1', '', '', 'https://embed.acast.com/4']);
    expect(rows.map((r) => r.acast_status)).toEqual(['posted', 'posted', 'to do', 'posted']);
    expect(rows.map((r) => r.acast_episode_id)).toEqual(['', '', '6748088e74eb04a4db2ba53c', '']); // PART 5: a bare id is no longer Legacy
    expect(rows.map((r) => r.issues.includes('acast embed missing'))).toEqual([false, true, false, false]); // done + no Acast URL
    expect(legacy.map((l) => [l.row_key, l.label, l.value])).toEqual([
      ['M00002', 'Embed link from Acast', 'https://example.com/e/2'],
      ['M00004', 'Other Embed link', 'https://play.acast.com/s/y/4'],
    ]);
  });
  it('PART 5: a 24-hex value under an embed label -> acast_episode_id (not Legacy); no URL is built; the issue needs neither', () => {
    const ID = '6748088E74eb04a4db2ba53c';
    const { rows, legacy } = one([
      { num: '1', title: 'a', code: 'CODE0001', mp3: url('A'), acast: 'done', embed2: ` ${ID} ` },
      { num: '2', title: 'b', code: 'CODE0002', mp3: url('B'), acast: 'done', embed: 'https://embed.acast.com/2', embed2: ID.toLowerCase() },
      { num: '3', title: 'c', code: 'CODE0003', mp3: url('C'), acast: 'done', embed2: '6748088e74eb04a4db2ba53' }, // 23 digits
      { num: '4', title: 'd', code: 'CODE0004', mp3: url('D'), acast: 'done', embed2: '6748088e74eb04a4db2ba53g' }, // not hex
      { num: '5', title: 'e', code: 'CODE0005', mp3: url('E'), acast: 'done' },
    ]);
    expect(rows.map((r) => r.acast_episode_id)).toEqual([ID, ID.toLowerCase(), '', '', '']);
    expect(rows.map((r) => r.acast_embed)).toEqual(['', 'https://embed.acast.com/2', '', '', '']);
    expect(rows.every((r) => !r.acast_embed.includes(ID) && !r.acast_embed.includes(ID.toLowerCase()))).toBe(true); // never a built URL
    expect(rows.map((r) => r.issues.includes('acast embed missing'))).toEqual([false, false, true, true, true]);
    // only the two non-ids stay in Legacy
    expect(legacy.map((l) => [l.row_key, l.value])).toEqual([['M00003', '6748088e74eb04a4db2ba53'], ['M00004', '6748088e74eb04a4db2ba53g']]);
    expect(acastEpisodeId(ID)).toBe(true);
    expect(acastEpisodeId('x')).toBe(false);
  });  it('acastEmbedUrl: host only, not the path or the text', () => {
    expect(acastEmbedUrl('https://embed.acast.com/abc')).toBe(true);
    expect(acastEmbedUrl('<iframe src="https://play.acast.com/x">')).toBe(true);
    expect(acastEmbedUrl('https://example.com/acast')).toBe(false);
    expect(acastEmbedUrl('acast')).toBe(false);
    expect(acastEmbedUrl('')).toBe(false);
  });
  it('MiniCourse with a value that is not done/empty → the whole column goes to Legacy, minicourse_status stays empty', () => {
    const { rows, legacy, stats } = one([
      { num: '1', title: 'a', code: 'CODE0001', mp3: url('A'), mc: 'done' },
      { num: '2', title: 'b', code: 'CODE0002', mp3: url('B'), mc: 'a note' },
    ]);
    expect(stats.minicourse.decision).toBe('legacy');
    expect(stats.minicourse.other).toEqual([{ value: 'a note', rows: 1 }]);
    expect(rows.map((r) => r.minicourse_status)).toEqual(['', '']);
    expect(legacy.filter((l) => l.label === 'MiniCourse').map((l) => l.value)).toEqual(['done', 'a note']);
  });
  it('minicourseDecision / scanMiniCourse', () => {
    expect(minicourseDecision({ done: 5, '': 2 }).decision).toBe('status');
    expect(minicourseDecision({ Done: 5, x: 1 }).decision).toBe('legacy');
    expect(scanMiniCourse([file(F1, [tab('T1', [{ num: '1', title: 'a', code: 'CODE0001', mp3: url('A'), mc: 'done' }])])])).toEqual({ done: 1 });
  });
  it('Legacy: every other labelled column with data, byte-exact; the youtube extra goes to Legacy when the own column is filled', () => {
    const { legacy } = one([{ num: '1', title: 'a', code: 'CODE0001', mp3: url('A'), pos: ' 7\u200B ', yt: 'https://youtu.be/x', ytx: 'https://youtu.be/y' }]);
    expect(legacy.map((l) => [l.label, l.value])).toEqual([[YOUTUBE_EXTRA_LABEL, 'https://youtu.be/y'], ['Position', ' 7\u200B ']]);
    expect(legacy.every((l) => l.row_key === 'M00001' && l.source_row === '3')).toBe(true);
  });
  it('Khmer / zero-width text is copied byte-for-byte (details, Legacy value, tab name)', () => {
    const odd = '\u1780\u17B6\u200B\u1781\u17D2\u1782 \u00A0end \n';
    const { rows, legacy } = one([{ num: '1', title: 'T\u200BT', code: 'CODE0001', mp3: url('A'), details: odd, pos: odd }]);
    expect(rows[0].details).toBe(odd);
    expect(rows[0].lesson_title).toBe('T\u200BT'); // inner characters untouched
    expect(legacy[0].value).toBe(odd);
  });
  it('rawLink: text with a link wins; a plain name falls back to the hyperlink target', () => {
    expect(rawLink(` ${url('A')} `, 'https://other')).toBe(url('A'));
    expect(rawLink('name.mp3', 'https://drive.google.com/file/d/X/view')).toBe('https://drive.google.com/file/d/X/view');
    expect(rawLink('name.mp3', '')).toBe('name.mp3');
  });
});

describe('PART 2 seed: dry-run CSV', () => {
  it('Lessons CSV round-trips every value (commas, quotes, newlines, Khmer, zero-width)', () => {
    const odd = 'a,"b"\nc \u200B\u1780';
    const { rows, legacy, excluded } = one([{ num: '1', title: 'a, "b"', code: 'CODE0001', mp3: url('A'), details: odd, pos: odd }]);
    const back = parseCsvObjects(masterCsv(columns, rows));
    expect(back).toEqual(rows);
    expect(back[0].details).toBe(odd);
    expect(parseCsvObjects(legacyCsv(columns, legacy))).toEqual(legacy);
    expect(excludedCsv(excluded).split('\n')[0]).toBe('file_id,tab,row,kind,text');
    expect(masterCsv(columns, rows).split('\n')[0]).toBe(KEYS.join(','));
  });
});

// ── write mode, with a fake Sheets API ────────────────────────────────────────

function fakeSheets({ lessonsData = false, existing = ['Lessons'] } = {}) {
  const calls = [];
  let titles = [...existing];
  const sheetsMeta = () => ({ sheets: titles.map((t, i) => ({ properties: { sheetId: 100 + i, title: t }, protectedRanges: t === 'Lessons' ? [{ protectedRangeId: 7 }] : [] })) });
  const fetchFn = async (u, init) => {
    const path = u.replace('https://sheets.googleapis.com/v4/spreadsheets/SHEETID', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: decodeURIComponent(path), body, auth: init.headers.Authorization });
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (init.method === 'GET' && path.startsWith('?fields')) return ok(sheetsMeta());
    if (init.method === 'GET' && path.includes('/values/')) return ok(lessonsData ? { values: [['M00001', 'x']] } : {});
    if (path === ':batchUpdate') {
      for (const r of body.requests) if (r.addSheet) titles.push(r.addSheet.properties.title);
      return ok({});
    }
    return ok({});
  };
  return { fetchFn, calls };
}
const smallCourses = () => buildCourses(small().rows);
const small = () => one([{ num: '1', title: 'A', code: 'CODE0001', mp3: url('A') }, { num: '2', title: 'B', code: 'CODE0002', mp3: url('B') }]);

describe('PART 6: Courses tab', () => {
  it('one row per distinct non-empty course id, in order of first appearance; copied title and teacher; lesson_count; status empty', () => {
    const rows = [
      { course_id: 'c002', course_title_km: 'T2', teacher: 'A', x: 1 },
      { course_id: 'c001', course_title_km: 'T1', teacher: 'B' },
      { course_id: 'c002', course_title_km: 'T2 changed', teacher: 'A2' },
      { course_id: '', course_title_km: 'hidden tab', teacher: 'A' },
      { course_id: 'c002', course_title_km: 'T2 again', teacher: 'A' },
    ];
    expect(buildCourses(rows)).toEqual([
      { course_id: 'c002', course_title_km: 'T2', teacher: 'A', lesson_count: '3', course_status: '' },
      { course_id: 'c001', course_title_km: 'T1', teacher: 'B', lesson_count: '1', course_status: '' },
    ]);
  });
  it('from a real build: counts add up, hidden-tab rows are not a course', () => {
    const { rows } = buildMaster([file(F1, [tab(HIDDEN_TABS[0], [{ num: '1', title: 'H', code: 'CODE0100', mp3: url('H') }]), tab('T1', [
      { num: '1', title: 'a', code: 'CODE0001', mp3: url('A') }, { num: '2', title: 'b', code: 'CODE0002', mp3: url('B') },
    ])])], ctx());
    const courses = buildCourses(rows);
    expect(courses.map((c) => [c.course_id, c.lesson_count])).toEqual([['c001', '2']]);
    expect(rows.length).toBe(3); // 2 + the hidden-tab row, which has no course id
  });
  it('CSV: header = the Courses column keys, values round-trip, Khmer-safe', () => {
    const rows = [{ course_id: 'c001', course_title_km: 'a,"b"\n\u1780\u200B', teacher: 'pending' }];
    const courses = buildCourses(rows);
    const back = parseCsvObjects(coursesCsv(columns, courses));
    expect(back).toEqual(courses);
    expect(coursesCsv(columns, courses).split('\n')[0]).toBe('course_id,course_title_km,teacher,lesson_count,course_status');
  });
  it('smallCourses helper sees the fixture course', () => {
    expect(smallCourses().map((c) => c.lesson_count)).toEqual(['2']);
  });
});

describe('PART 2 seed: write mode (fake Sheets API)', () => {
  it('REFUSES when Lessons already has data rows and changes nothing', async () => {
    const { rows, legacy } = small();
    const { fetchFn, calls } = fakeSheets({ lessonsData: true });
    await expect(writeToSheet({ sheetId: 'SHEETID', token: 'tok', saEmail: 'sa@x', columns, rows, legacy, fetchFn })).rejects.toBeInstanceOf(RefuseError);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
  it('empty Lessons: creates tabs, validation, protected ranges (service account only), freeze; Lessons rows LAST', async () => {
    const { rows, legacy } = small();
    const { fetchFn, calls } = fakeSheets({ existing: ['Lessons'] });
    const courses = buildCourses(rows);
    const r = await writeToSheet({ sheetId: 'SHEETID', token: 'tok', saEmail: 'sa@x', columns, rows, legacy, courses, fetchFn });
    expect(r).toEqual({ rows: 2, legacy: legacy.length, courses: 1 });
    expect(calls.every((c) => c.auth === 'Bearer tok')).toBe(true);
    const add = calls.find((c) => c.path === ':batchUpdate' && c.body.requests.some((x) => x.addSheet));
    expect(add.body.requests.map((x) => x.addSheet.properties.title)).toEqual(['Legacy', 'Lists', 'Courses']);
    const fmt = calls.filter((c) => c.path === ':batchUpdate').pop().body.requests;
    expect(fmt.some((x) => x.deleteProtectedRange)).toBe(true); // an earlier attempt's ranges are replaced
    expect(fmt.some((x) => x.updateSheetProperties && x.updateSheetProperties.properties.gridProperties.frozenRowCount === 1)).toBe(true);
    const dd = fmt.filter((x) => x.setDataValidation);
    expect(dd.length).toBe(columns.columns.filter((c) => c.dropdown).length + columns.courses.columns.filter((c) => c.dropdown).length);
    // Part 6: the Courses tab gets its own protected ranges and its course_status dropdown
    const coursesProt = fmt.filter((x) => x.addProtectedRange).map((x) => x.addProtectedRange.protectedRange).filter((p) => p.description.startsWith('master sheet Courses'));
    expect(coursesProt.length).toBe(1);
    expect(coursesProt[0].range).toMatchObject({ startColumnIndex: 0, endColumnIndex: 4 });
    expect(dd.some((x) => x.setDataValidation.rule.condition.values.some((v) => v.userEnteredValue === 'ongoing'))).toBe(true);
    const coursesPut = calls.find((c) => c.method === 'PUT' && c.path.includes('Courses!A1'));
    expect(coursesPut.body.values).toEqual([columns.courses.columns.map((c) => c.key), ['c001', expect.any(String), 'Teacher One Display', '2', '']]);
    expect(dd[0].setDataValidation.rule.condition.type).toBe('ONE_OF_LIST');
    const prot = fmt.filter((x) => x.addProtectedRange).map((x) => x.addProtectedRange.protectedRange);
    expect(prot.length).toBeGreaterThan(0);
    expect(prot.every((p) => p.warningOnly === false && JSON.stringify(p.editors) === JSON.stringify({ users: ['sa@x'] }))).toBe(true);
    // the Lessons data (more than the header) is the last write
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts[puts.length - 1].path).toContain('Lessons!A1');
    expect(puts[puts.length - 1].body.values.length).toBe(3); // header + 2 rows
    const lessonsHeaderOnly = puts.find((c) => c.path.includes('Lessons!A1') && c.body.values.length === 1);
    expect(lessonsHeaderOnly).toBeTruthy();
    expect(calls.findIndex((c) => c === lessonsHeaderOnly)).toBeLessThan(calls.findIndex((c) => c === calls.filter((x) => x.path === ':batchUpdate').pop()));
    expect(puts.every((c) => c.path.includes('valueInputOption=RAW'))).toBe(true);
  });
  it('needs a sheet id, a token and the service account address', async () => {
    const { rows, legacy } = small();
    const { fetchFn } = fakeSheets();
    await expect(writeToSheet({ sheetId: '', token: 't', saEmail: 'a', columns, rows, legacy, fetchFn })).rejects.toThrow(/sheet id/);
    await expect(writeToSheet({ sheetId: 'S', token: '', saEmail: 'a', columns, rows, legacy, fetchFn })).rejects.toThrow(/ACCESS_TOKEN/);
    await expect(writeToSheet({ sheetId: 'S', token: 't', saEmail: '', columns, rows, legacy, fetchFn })).rejects.toThrow(/SA_EMAIL/);
  });
  it('dry mode makes no network call (buildMaster/masterCsv are pure)', () => {
    const real = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('network used'); };
    try { masterCsv(columns, small().rows); } finally { globalThis.fetch = real; }
  });
});
