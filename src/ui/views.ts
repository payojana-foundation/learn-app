/**
 * src/ui/views.ts — pure HTML builders for each screen, matching
 * design/learn-mockup.html. No data fetching here; the controller (app.ts)
 * passes the data and the current UI state in, and these return HTML strings.
 *
 * All interface words come from strings.ts (km + en). Course/lesson/teacher
 * text is shown exactly as stored (esc() only escapes HTML, never edits text).
 */

import type { Lang } from '../lang';
import { t, topicLabel, TOPICS } from '../strings';
import { num, time, esc, cleanForSearch, displayTitle } from '../format';
import type { Catalog, CatalogCourse, Course, Lesson, Teacher } from '../data/catalog';
import type { LessonProgress } from '../db';
import { guideLineHtml, branchPanelHtml, leafMarkHtml, type CompanionCtx } from './companion';

export interface ProgressMap {
  // courseId → { lessonId → progress }
  [courseId: string]: Record<string, LessonProgress>;
}

export interface ViewState {
  lang: Lang;
  topic: string; // 'all' or a topic id
  savedIds: Set<string>;
}

const courseTitle = (c: CatalogCourse | Course, lang: Lang): string =>
  lang === 'en' && c.title_en ? c.title_en : c.title_km;

export function doneCountOf(progress: ProgressMap, courseId: string): number {
  const p = progress[courseId];
  return p ? Object.values(p).filter((x) => x.done).length : 0;
}
export function pctOf(progress: ProgressMap, c: CatalogCourse): number {
  return c.lesson_count ? Math.round((100 * doneCountOf(progress, c.id)) / c.lesson_count) : 0;
}

function teacherName(teacher: Teacher | undefined, lang: Lang): string {
  if (!teacher) return '';
  const en = teacher.name_en ? ` <span class="muted small">· ${esc(teacher.name_en)}</span>` : '';
  return esc(teacher.name_km) + (lang === 'en' ? en : en);
}

export function courseCard(c: CatalogCourse, teacher: Teacher | undefined, progress: ProgressMap, lang: Lang, mark = ''): string {
  const p = pctOf(progress, c);
  const hasA = c.media_kinds.includes('acast') || c.media_kinds.includes('r2');
  const hasV = c.media_kinds.includes('youtube') || c.media_kinds.includes('drive');
  const isR2 = c.media_kinds.includes('r2');
  return `<button class="card" data-nav="course" data-id="${c.id}"><span class="t">${mark}${esc(courseTitle(c, lang))}</span>
  <span class="muted small">${teacherName(teacher, lang)}</span>
  <span class="meta"><span>${num(c.lesson_count, lang)} ${t('LESSONS', lang)}</span>${hasA ? '<span>♪ audio</span>' : ''}${hasV ? '<span>▶ video</span>' : ''}${isR2 ? '<span>R2</span>' : ''}</span>
  ${p ? `<span class="pbar"><i style="width:${p}%"></i></span><span class="meta">${num(p, lang)}% ${t('DONE', lang)}</span>` : ''}</button>`;
}

export function teacherCard(teacher: Teacher): string {
  return `<button class="card tcard" data-nav="teacher" data-slug="${esc(teacher.slug)}">${teacher.photo ? `<img class="av" src="/data/${esc(teacher.photo)}" alt="">` : ''}<span class="nm">${esc(teacher.name_km)}</span></button>`;
}

export function homeView(
  catalog: Catalog,
  teachers: Teacher[],
  teacherBySlug: Map<string, Teacher>,
  progress: ProgressMap,
  state: ViewState,
  startHere: string[],
  history: { courseId: string; lessonId: string; lessonNum: number }[],
  companion?: CompanionCtx
): string {
  const { lang } = state;
  const cont = history
    .slice(0, 3)
    .map((h) => {
      const c = catalog.courses.find((x) => x.id === h.courseId);
      if (!c) return '';
      const pp = progress[h.courseId]?.[h.lessonId] ?? { pos: 0, done: false };
      return `<button class="card cont" data-nav="lesson" data-id="${h.courseId}" data-lesson="${esc(h.lessonId)}">
      <span class="meta">${t('LESSON', lang)} ${num(h.lessonNum, lang)} · ${pp.done ? t('UNDONE', lang) : time(pp.pos, lang)}</span>
      <span class="muted small">${esc(courseTitle(c, lang))}</span>
      <span class="pbar"><i style="width:${pctOf(progress, c)}%"></i></span></button>`;
    })
    .join('');

  const list = catalog.courses.filter((c) => state.topic === 'all' || c.topics.includes(state.topic));
  const chips = [{ id: 'all', km: t('ALL', 'km'), en: t('ALL', 'en') }, ...TOPICS]
    .map((tp) => `<button class="chip" data-topic="${tp.id}" aria-pressed="${state.topic === tp.id}">${lang === 'km' ? tp.km : tp.en}</button>`)
    .join('');

  const startRow =
    startHere.length > 0
      ? `<section><div class="sechead"><h2>${t('START_HERE', lang)}</h2></div>${guideLineHtml(companion, 'home.start_here', null)}<div class="hrow">${startHere
          .map((id) => catalog.courses.find((c) => c.id === id))
          .filter((c): c is CatalogCourse => !!c)
          .map((c) => courseCard(c, teacherBySlug.get(c.teacher_slug), progress, lang, leafMarkHtml(companion, c.id)))
          .join('')}</div></section>`
      : '';

  return `<div class="stack"><p class="tagline">${t('TAGLINE', lang)}</p>
  <form class="search" data-form="home-search"><input name="q" type="search" placeholder="${t('FIND', lang)}" aria-label="${t('TAB_SEARCH', lang)}"></form></div>
  ${cont ? `<section><div class="sechead"><h2>${t('CONT', lang)}</h2><button class="link" data-nav="my">${t('TAB_MY', lang)}</button></div><div class="hrow">${cont}</div></section>` : ''}
  ${startRow}
  <section><div class="sechead"><h2>${t('COURSES', lang)}</h2><span class="muted small">${num(list.length, lang)}</span></div>
  <div class="row">${chips}</div>
  <div class="hrow">${list.map((c) => courseCard(c, teacherBySlug.get(c.teacher_slug), progress, lang)).join('')}</div></section>
  <section><div class="sechead"><h2>${t('TEACHERS', lang)}</h2><button class="link" data-nav="teachers">${t('SEE_ALL', lang)}</button></div><div class="hrow t">${teachers.map((tc) => teacherCard(tc)).join('')}</div></section>`;
}

const SECTION = 20;

export function courseView(
  c: Course,
  teacher: Teacher | undefined,
  progress: ProgressMap,
  state: ViewState,
  filter: string,
  lastLessonId: string | null,
  companion?: CompanionCtx
): string {
  const { lang } = state;
  const done = doneCountOf(progress, c.id);
  const pct = c.lessons.length ? Math.round((100 * done) / c.lessons.length) : 0;
  const firstUnfinished = c.lessons.find((l) => !(progress[c.id]?.[l.id]?.done))?.id ?? c.lessons[0]?.id ?? '';
  const target = lastLessonId ?? firstUnfinished;
  const saved = state.savedIds.has(c.id);
  const f = filter.trim();
  const rows = c.lessons.filter((l) => !f || l.title_km.includes(f) || String(l.num) === f);
  const sections: Lesson[][] = [];
  for (let k = 0; k < rows.length; k += SECTION) sections.push(rows.slice(k, k + SECTION));

  const topicCrumb = c.topics[0] ? esc(topicLabel(c.topics[0], lang)) : '';

  const lessonRow = (l: Lesson): string => {
    const pp = progress[c.id]?.[l.id] ?? { pos: 0, done: false };
    const hasA = l.media.some((m) => m.kind === 'r2' || m.kind === 'acast');
    const hasV = l.media.some((m) => m.kind === 'youtube' || m.kind === 'drive');
    const mic = `${hasA ? '♪' : ''}${hasV ? ' ▶' : ''}`;
    const title = l.title_km.trim() ? esc(displayTitle(l.title_km)) : `<span class="ph">${t('NO_TITLE', lang)}</span>`;
    return `<li><button data-nav="lesson" data-id="${c.id}" data-lesson="${esc(l.id)}" class="${l.id === lastLessonId ? 'cur' : ''}">
      <span class="tick ${pp.done ? 'on' : ''}">${pp.done ? '✓' : ''}</span><span class="n">${num(l.num, lang)}</span>
      <span class="tt">${title}</span><span class="mic">${mic}</span></button></li>`;
  };

  const sectionsHtml =
    sections
      .map((s, k) => {
        const dn = s.filter((l) => progress[c.id]?.[l.id]?.done).length;
        const open = !!f || s.some((l) => l.id === target) || k === 0;
        return `<details class="sect" ${open ? 'open' : ''}><summary><span>${t('LESSON', lang)} ${num(s[0].num, lang)}–${num(s[s.length - 1].num, lang)}</span><span class="muted small">${num(dn, lang)}/${num(s.length, lang)}</span></summary>
        <ul class="les">${s.map(lessonRow).join('')}</ul></details>`;
      })
      .join('') || `<div class="empty">${t('NOTHING', lang)}</div>`;

  return `<div class="chead"><div class="crumbs">${t('COURSES', lang)} › ${topicCrumb}</div>
  <h1>${esc(courseTitle(c, lang))}</h1>
  <button class="who" data-nav="teacher" data-slug="${esc(c.teacher_slug)}">${teacher?.photo ? `<img src="/data/${esc(teacher.photo)}" alt="">` : ''}<span>${teacherName(teacher, lang)}</span></button>
  <div class="meta"><span>${num(c.lessons.length, lang)} ${t('LESSONS', lang)}</span></div>
  <div class="pbar"><i style="width:${pct}%"></i></div><div class="meta">${num(done, lang)}/${num(c.lessons.length, lang)} ${t('DONE', lang)} · ${num(pct, lang)}%</div>
  ${companion?.hasLeaf ? guideLineHtml(companion, 'course.finished', c.id) : ''}
  <div class="row"><button class="btn" data-nav="lesson" data-id="${c.id}" data-lesson="${esc(target)}">${lastLessonId || pct ? `${t('CONT_LESSON', lang)} ${num(c.lessons.find((l) => l.id === target)?.num ?? '', lang)}` : t('START_COURSE', lang)}</button>
  <button class="btn ghost sm" data-save="${c.id}">${saved ? '★ ' + t('SAVED', lang) : '☆ ' + t('SAVE', lang)}</button><button class="btn ghost sm" data-share>${t('SHARE', lang)}</button></div></div>
  <section style="margin-top:20px"><form class="search" data-form="course-filter"><input name="f" type="search" value="${esc(filter)}" placeholder="${t('FILTER', lang)}" aria-label="${t('FILTER', lang)}"></form>
  <div>${sectionsHtml}</div></section>`;
}

export function lessonView(
  c: Course,
  l: Lesson,
  progress: ProgressMap,
  state: ViewState,
  notes: { atS: number; text: string }[],
  playing: boolean,
  speed: number,
  sleep: number,
  auto: boolean
): string {
  const { lang } = state;
  const pp = progress[c.id]?.[l.id] ?? { pos: 0, done: false };
  const idx = c.lessons.indexOf(l);
  const nx = c.lessons[idx + 1];
  const pv = c.lessons[idx - 1];
  const r2 = l.media.find((m) => m.kind === 'r2');

  // Real duration comes from the data (manifest) so it shows before the audio
  // element loads (Q4). 0 → the "0:00" placeholder until the audio reports it.
  const durS = r2 && r2.duration_s ? r2.duration_s : 0;
  const media = r2
    ? `<div class="player" data-player><div class="times"><span>${t('OUR_PLAYER', lang)}</span><span>♪ MP3</span></div>
      <div class="scrub" data-scrub><i data-bar style="width:${pp.pos ? '0' : '0'}%"></i></div>
      <div class="times"><span data-pos>${time(pp.pos, lang)}</span><span data-dur>${time(durS, lang)}</span></div>
      <div class="pctl"><button data-skip="-15">⟲ ${num(15, lang)}</button><button class="pp" data-pp aria-label="Play/Pause">${playing ? '❚❚' : '▶'}</button><button data-skip="15">${num(15, lang)} ⟳</button></div>
      <div class="popts"><button data-speed>${t('SPEED', lang)} ${speed}×</button><button data-sleep>${t('SLEEP', lang)} ${sleep ? num(sleep, lang) + '′' : '—'}</button><button data-auto>${t('AUTO', lang)}: ${auto ? '✓' : '—'}</button></div></div>`
    : l.media.some((m) => m.kind === 'acast' || m.kind === 'youtube')
      ? embedMedia(l, lang)
      : l.media.some((m) => m.kind === 'drive')
        ? `<div class="empty">${t('COMING_SOON', lang)}</div>`
        : `<div class="empty">${t('OFFLINE_MEDIA', lang)}</div>`;

  return `<div class="crumbs"><button class="link" data-nav="course" data-id="${c.id}">${esc(courseTitle(c, lang))}</button> › ${t('LESSON', lang)} ${num(l.num, lang)}/${num(c.lessons.length, lang)}</div>
  <h1 style="margin:6px 0 12px">${l.title_km.trim() ? esc(displayTitle(l.title_km)) : `<span class="ph">${t('NO_TITLE', lang)}</span>`}</h1>${media}
  <div class="row" style="margin-top:12px"><button class="btn ${pp.done ? 'ghost' : ''} sm" data-done>${pp.done ? t('UNDONE', lang) : t('MARK_DONE', lang)}</button>
  <button class="btn ghost sm" data-share>${t('SHARE', lang)}</button></div>
  <div class="row" style="justify-content:space-between;margin-top:14px">${pv ? `<button class="btn ghost sm" data-nav="lesson" data-id="${c.id}" data-lesson="${esc(pv.id)}">‹ ${t('PREV', lang)}</button>` : '<span></span>'}${nx ? `<button class="btn sm" data-nav="lesson" data-id="${c.id}" data-lesson="${esc(nx.id)}">${t('NEXT', lang)} ›</button>` : ''}</div>
  <section style="margin-top:20px"><div class="sechead"><h2>${t('NOTES', lang)}</h2></div>
  <form data-form="note" class="stack"><textarea name="note" placeholder="${t('NOTE_HINT', lang)}" aria-label="${t('NOTES', lang)}"></textarea><div><button class="btn sm">${t('ADD_NOTE', lang)} ${time(pp.pos, lang)}</button></div></form>
  ${notes.map((n) => `<div class="note"><button class="ts" data-seek="${n.atS}">${time(n.atS, lang)}</button><span>${esc(n.text)}</span></div>`).join('')}</section>`;
}

/**
 * P-14 (changed): render the real embed for acast/youtube ONLY. Drive never
 * plays in-app (coordinator decision) — see the drive "coming soon" branch in
 * lessonView. The iframe src is the `src` stored in the data (already an embed
 * URL); we never guess a URL. acast is audio-only (short height); youtube is
 * 16:9. A small link below opens the source in a new tab.
 */
function embedMedia(l: Lesson, lang: Lang): string {
  const m = l.media.find((x) => x.kind === 'acast' || x.kind === 'youtube');
  if (!m) return `<div class="empty">${t('OFFLINE_MEDIA', lang)}</div>`;
  const src = esc(m.src);
  const name = m.kind === 'youtube' ? 'YouTube' : 'Acast';
  const isAudio = m.kind === 'acast';
  const frame = `<iframe src="${src}" loading="lazy" title="${esc(name)}"
    allow="autoplay; encrypted-media; fullscreen" allowfullscreen
    style="border:0;width:100%;${isAudio ? 'height:180px' : 'aspect-ratio:16/9'}"></iframe>`;
  return `<div class="embed" data-embed>${frame}</div>
  <a class="link small" href="${src}" target="_blank" rel="noopener noreferrer">${t('OPEN_IN', lang)} ${esc(name)}</a>`;
}

export function teachersView(teachers: Teacher[], lang: Lang): string {
  return `<h1>${t('TEACHERS', lang)}</h1><div class="cgrid" style="margin-top:14px;grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">${teachers.map((tc) => teacherCard(tc)).join('')}</div>`;
}

export function teacherView(
  teacher: Teacher,
  courses: CatalogCourse[],
  teacherBySlug: Map<string, Teacher>,
  progress: ProgressMap,
  lang: Lang
): string {
  const bio = teacher.bio_km ? (lang === 'en' && teacher.bio_en ? teacher.bio_en : teacher.bio_km) : null;
  return `<div class="tprof">${teacher.photo ? `<img src="/data/${esc(teacher.photo)}" alt="">` : ''}<div><h1>${esc(teacher.name_km)}</h1>${teacher.name_en ? `<p class="muted" style="margin:0">${esc(teacher.name_en)}</p>` : ''}</div></div>
  ${bio ? `<div class="bio" style="margin-top:14px">${esc(bio)}</div>` : ''}
  <section style="margin-top:20px"><div class="sechead"><h2>${t('COURSES', lang)}</h2><span class="muted small">${num(courses.length, lang)}</span></div>
  <div class="cgrid">${courses.map((c) => courseCard(c, teacherBySlug.get(c.teacher_slug), progress, lang)).join('')}</div></section>`;
}

export function searchView(
  q: string,
  catalog: Catalog,
  courseBundles: { course: CatalogCourse }[],
  teachers: Teacher[],
  lessonHits: { course: CatalogCourse; lessonId: string; num: number; title: string }[],
  teacherBySlug: Map<string, Teacher>,
  lang: Lang
): string {
  const cq = cleanForSearch(q.trim());
  let body = '';
  if (cq) {
    const hl = (s: string): string => {
      const i = cleanForSearch(s).indexOf(cq);
      return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + cq.length)) + '</mark>' + esc(s.slice(i + cq.length));
    };
    const total = courseBundles.length + teachers.length + lessonHits.length;
    body = total
      ? `<p class="muted small">${num(total, lang)}${lessonHits.length >= 40 ? '+' : ''} ${t('RESULTS', lang)}</p>
        ${teachers.length ? `<section><div class="sechead"><h2>${t('TEACHERS', lang)}</h2></div><ul class="res">${teachers.map((tc) => `<li><button data-nav="teacher" data-slug="${esc(tc.slug)}">${hl(tc.name_km)}</button></li>`).join('')}</ul></section>` : ''}
        ${courseBundles.length ? `<section><div class="sechead"><h2>${t('COURSES', lang)}</h2></div><ul class="res">${courseBundles.map(({ course: c }) => `<li><button data-nav="course" data-id="${c.id}">${hl(lang === 'en' && c.title_en ? c.title_en : c.title_km)}<span class="muted small">${esc(teacherBySlug.get(c.teacher_slug)?.name_km ?? '')} · ${num(c.lesson_count, lang)} ${t('LESSONS', lang)}</span></button></li>`).join('')}</ul></section>` : ''}
        ${lessonHits.length ? `<section><div class="sechead"><h2>${t('LESSONS', lang)}</h2></div><ul class="res">${lessonHits.map((h) => `<li><button data-nav="lesson" data-id="${h.course.id}" data-lesson="${esc(h.lessonId)}">${hl(h.title)}<span class="muted small">${esc(h.course.title_km)}</span></button></li>`).join('')}</ul></section>` : ''}`
      : `<div class="empty stack"><span>${t('NO_RESULT', lang)}</span><span>${t('TRY_THIS', lang)}</span><div class="row" style="justify-content:center"><a class="btn ghost sm" data-handoff="vacana" target="_blank" rel="noopener">Vacana ↗</a><a class="btn ghost sm" data-handoff="library" target="_blank" rel="noopener">Library · បណ្ណាល័យ ↗</a></div></div>`;
  }
  void catalog;
  return `<h1>${t('TAB_SEARCH', lang)}</h1><form class="search" data-form="search" style="margin:12px 0"><input name="q" type="search" value="${esc(q)}" placeholder="${t('FIND', lang)}" aria-label="${t('TAB_SEARCH', lang)}"></form>${body}`;
}

export function notFoundView(lang: Lang): string {
  return `<div class="empty">404 · <button class="link" data-nav="home">${t('TAB_HOME', lang)}</button></div>`;
}

export type MyTab = 'inprog' | 'saved' | 'history' | 'notes';

export function myView(
  tab: MyTab,
  catalog: Catalog,
  teacherBySlug: Map<string, Teacher>,
  progress: ProgressMap,
  state: ViewState,
  savedIds: string[],
  history: { courseId: string; lessonId: string; lessonNum: number; at: number }[],
  notes: { courseId: string; lessonId: string; lessonNum: number; atS: number; text: string }[],
  companion?: CompanionCtx
): string {
  const { lang } = state;
  const tabs: [MyTab, string][] = [
    ['inprog', t('IN_PROGRESS', lang)],
    ['saved', t('SAVED', lang)],
    ['history', t('HISTORY', lang)],
    ['notes', t('NOTES', lang)],
  ];
  const card = (id: string): string => {
    const c = catalog.courses.find((x) => x.id === id);
    return c ? courseCard(c, teacherBySlug.get(c.teacher_slug), progress, lang) : '';
  };

  let b = '';
  if (tab === 'inprog') {
    const ids = [...new Set(history.map((h) => h.courseId))].filter((id) => {
      const c = catalog.courses.find((x) => x.id === id);
      return c && pctOf(progress, c) < 100;
    });
    b = ids.length ? `<div class="cgrid">${ids.map(card).join('')}</div>` : '';
  } else if (tab === 'saved') {
    b = savedIds.length ? `<div class="cgrid">${savedIds.map(card).join('')}</div>` : '';
  } else if (tab === 'history') {
    b = history.length
      ? `<ul class="res">${history
          .map((h) => {
            const c = catalog.courses.find((x) => x.id === h.courseId);
            return `<li><button data-nav="lesson" data-id="${h.courseId}" data-lesson="${esc(h.lessonId)}">${t('LESSON', lang)} ${num(h.lessonNum, lang)}<span class="muted small">${esc(c ? (lang === 'en' && c.title_en ? c.title_en : c.title_km) : '')} · ${new Date(h.at).toLocaleDateString(lang === 'km' ? 'km-KH' : 'en-US')}</span></button></li>`;
          })
          .join('')}</ul>`
      : '';
  } else {
    b = notes.length
      ? notes
          .map((n) => {
            const c = catalog.courses.find((x) => x.id === n.courseId);
            return `<button class="note" data-nav="lesson" data-id="${n.courseId}" data-lesson="${esc(n.lessonId)}" style="width:100%;text-align:left"><span class="ts">${time(n.atS, lang)}</span><span>${esc(n.text)}<br><span class="muted small">${esc(c ? c.title_km : '')} · ${t('LESSON', lang)} ${num(n.lessonNum, lang)}</span></span></button>`;
          })
          .join('')
      : '';
  }

  return `<h1>${t('TAB_MY', lang)}</h1>${branchPanelHtml(companion)}<div class="tabs" style="margin:12px 0">${tabs.map(([k, n]) => `<button data-mtab="${k}" aria-pressed="${tab === k}">${n}</button>`).join('')}</div><div class="stack">${b || `<div class="empty">${t('NOTHING', lang)}</div>`}</div>`;
}

export function moreView(lang: Lang): string {
  const apps: [string, string | null, string][] = [
    ['Vacana', 'vacana', lang === 'km' ? 'កំពុងសាកល្បង' : 'In testing'],
    ['Library · បណ្ណាល័យ', 'library', lang === 'km' ? 'កំពុងសាកល្បង' : 'In testing'],
  ];
  return `<h1>${t('TAB_MORE', lang)}</h1>
  <section style="margin-top:14px"><div class="sechead"><h2>${t('APPS', lang)}</h2></div><div class="list">${apps
    .map(([n, h, s]) => `<a data-handoff="${h}" target="_blank" rel="noopener"><span>${n}</span><span class="muted small">${s} ↗</span></a>`)
    .join('')}</div></section>
  <section><div class="sechead"><h2>${t('TAB_MY', lang)}</h2></div><div class="list">
  <button data-export><span>${t('EXPORT', lang)}</span><span>⭳</span></button>
  <label class="list-import"><span>${t('IMPORT', lang)}</span><input type="file" accept="application/json" data-import hidden><span>⭱</span></label></div></section>
  <section><div class="list">
  <div><span>${t('LANGUAGE', lang)}</span><span class="lang" role="group"><button data-setlang="km" aria-pressed="${lang === 'km'}">ខ្មែរ</button><button data-setlang="en" aria-pressed="${lang === 'en'}">EN</button></span></div>
  <div><span>${t('OFFLINE', lang)}</span><span class="muted small">${lang === 'km' ? 'v1៖ ស្ទ្រីមតែប៉ុណ្ណោះ' : 'v1: streaming only'}</span></div></div></section>
  <p class="muted small rights">${esc(t('RIGHTS', lang))}</p>
  <div id="shell-version"></div>`;
}
