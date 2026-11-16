/**
 * scripts/ops/readiness-report.mjs — reports/launch-readiness.md (PART 4, 16 Nov).
 * Read-only. Live counts from the LIVE site (catalog + course files), held lessons by reason
 * from public/ops/checks.json, automation state from data/ops/* and the repo variables
 * (passed as JSON, e.g. from `gh variable list --json name,value`), open issues from an
 * in-memory build of the committed data (scripts/build-courses.mjs buildFromMaster).
 *
 * Usage: node scripts/ops/readiness-report.mjs <out.md> <vars.json> [https://learn.84000.digital]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildFromMaster } from '../build-courses.mjs';
import { parseCsvObjects } from '../master/csv.mjs';

const json = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : d);

/** Pure: counts of the served data. */
export function liveCounts(catalog, courses) {
  const lessons = courses.flatMap((c) => c.lessons || []);
  return {
    courses: (catalog.courses || []).length,
    coursesWithVideo: (catalog.courses || []).filter((c) => c.has_video).length,
    lessons: lessons.length,
    audio: lessons.filter((l) => (l.media || []).some((m) => m.kind === 'r2')).length,
    video: lessons.filter((l) => l.video).length,
  };
}

/** Pure: held items by media and reason. */
export function heldByReason(checks) {
  const by = {};
  for (const i of (checks && checks.items) || []) {
    const k = `${i.media_type}: ${i.reason}`;
    by[k] = (by[k] || 0) + 1;
  }
  return Object.entries(by).sort((a, b) => b[1] - a[1]);
}

/** Pure: build issues by kind (and detail for course_hidden). */
export function issueCounts(issues) {
  const by = {};
  for (const i of issues || []) {
    const k = i.kind === 'course_hidden' || i.kind === 'lesson_hidden' ? `${i.kind}: ${i.detail}` : i.kind;
    by[k] = (by[k] || 0) + 1;
  }
  return Object.entries(by).sort((a, b) => b[1] - a[1]);
}

async function main() {
  const [, , out, varsPath, base = 'https://learn.84000.digital'] = process.argv;
  const vars = Object.fromEntries((json(varsPath, []) || []).map((v) => [v.name, v.value]));
  const B = base.replace(/\/+$/, '');
  const catalog = await (await fetch(`${B}/data/catalog.json`)).json();
  const courses = [];
  for (const c of catalog.courses) courses.push(await (await fetch(`${B}/data/courses/${c.id}.json`)).json());
  const live = liveCounts(catalog, courses);
  const checks = json('public/ops/checks.json', { items: [] });
  const autorun = json('data/ops/autorun-state.json', {});
  const decisions = json('data/ops/check-decisions.json', {});
  const vm = json('data/video-manifest.json', []);
  const am = json('data/media-manifest.json', []);
  const approvedA = am.filter((e) => /^approved\b/i.test(e.status || '')).length;
  const approvedV = vm.filter((e) => /^approved\b/i.test(e.status || '')).length;
  const teachers = json('data/source/teachers-2026-11-02/teachers-2026-11-02.json', []);
  const rows = parseCsvObjects(readFileSync('data/master/lessons.csv', 'utf-8'));
  const crs = parseCsvObjects(readFileSync('data/master/courses.csv', 'utf-8'));
  const { issues } = buildFromMaster(rows, crs, teachers, am, { enabled: vars.VIDEO_ENABLED === 'true', manifest: vm });
  const autorunLog = existsSync('data/ops/autorun.log') ? readFileSync('data/ops/autorun.log', 'utf-8').trim().split(/\r?\n/).slice(-3) : [];
  const relLog = existsSync('data/ops/auto-release.log') ? readFileSync('data/ops/auto-release.log', 'utf-8').trim().split(/\r?\n/).slice(-1) : [];
  const L = [];
  L.push(`# Launch readiness (${new Date().toISOString().slice(0, 16)}Z)`, '');
  L.push(`Live site ${B} (catalog and course files fetched now).`, '');
  L.push('## Live counts', '');
  L.push(`- Courses: **${live.courses}** (with video: ${live.coursesWithVideo})`);
  L.push(`- Lessons: **${live.lessons}**; with audio ${live.audio}; with video ${live.video}`);
  L.push(`- Manifests: audio approved ${approvedA} of ${am.length} converted; video approved ${approvedV} of ${vm.length} converted`, '');
  L.push('## Held (public/ops/checks.json)', '');
  L.push(`${checks.items.length} items (generated ${checks.generated_at || 'unknown'}).`, '');
  L.push('| media: reason | items |', '|---|---:|', ...heldByReason(checks).map(([k, n]) => `| ${k} | ${n} |`), '');
  L.push('## Automation', '');
  L.push(`- AUTORUN_ENABLED=${vars.AUTORUN_ENABLED ?? 'unset'}; autorun stopped after a red run: ${autorun.disabled ? `yes (${autorun.reason})` : 'no'}; lessons tried ${Object.keys(autorun.attempts || {}).length} (at the limit: ${Object.values(autorun.attempts || {}).filter((n) => n >= 2).length})`);
  for (const l of autorunLog) L.push(`  - ${l}`);
  L.push(`- AUTO_APPROVE_PASSING=${vars.AUTO_APPROVE_PASSING ?? 'unset'}; last auto-release: ${relLog[0] || 'none yet'}`);
  L.push(`- VIDEO_ENABLED=${vars.VIDEO_ENABLED ?? 'unset'}, VIDEO_RENDITION=${vars.VIDEO_RENDITION ?? 'unset'}`);
  L.push(`- MASTER_SYNC_MODE=${vars.MASTER_SYNC_MODE ?? 'unset (dry)'}: ${vars.MASTER_SYNC_MODE === 'write' ? 'the sync writes the sheet' : 'the sync only READS the sheet: SYSTEM cells, team row intake and new course ids are NOT written'}`);
  L.push(`- Team decisions logged: ${Object.keys(decisions).length}`, '');
  L.push('## Open issues (build of the committed data)', '');
  L.push('| issue | count |', '|---|---:|', ...issueCounts(issues).map(([k, n]) => `| ${k.replace(/\|/g, '\\|')} | ${n} |`), '');
  writeFileSync(out, L.join('\n') + '\n', 'utf-8');
  console.log(JSON.stringify({ live, held: checks.items.length }));
}

if (process.argv[1] && process.argv[1].endsWith('readiness-report.mjs')) main();
