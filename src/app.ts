/**
 * src/app.ts — the screen controller.
 *
 * Owns UI state, loads the catalog/teachers/course data, renders the current
 * route into the shell, wires the bottom tab bar, the r2 audio player + mini
 * player, search, and the My Learning / More interactions. Navigation uses the
 * History API over real paths (src/router.ts); language comes from src/lang.ts.
 */

import { initLang, setLang, type Lang } from './lang';
import { VACANA_BASE_URL, LIBRARY_BASE_URL } from './config';
import { pathCourseIds, draftAllowed, startedCourseIds, courseCanFinish } from './data/companion';
import type { CompanionCtx } from './ui/companion';
import { t, STRINGS, displayString } from './strings';
import { cleanForSearch, esc, searchable } from './format';
import { parseRoute, routePath, tabForRoute, type Route } from './router';
import { rewriteLessonId } from './db/aliases';
import {
  getCatalog,
  getTeachersFile,
  getCourse,
  getAliasesFile,
  getPathsFile,
  getGuideLinesFile,
  getPartnerClass,
  type Catalog,
  type Course,
  type Lesson,
  type Teacher,
} from './data/catalog';
import { migrateAliases, resolveAlias, type AliasMap } from './db/aliases';
import { legacyLessonId } from './db/legacy';
import {
  getLessonProgress,
  setLessonProgress,
  listSaved,
  toggleSaved,
  pushHistory,
  listHistory,
  addNote,
  listNotes,
  listNotesFor,
  exportBackup,
  importBackup,
  awardLeafIfFinished,
  backfillLeaves,
  listLeaves,
  listProgress,
  listPartnerProgress,
  markPartnerStarted,
  togglePartnerDone,
} from './db';
import { buildKpFrame, ensureKpHelper } from './ui/kp';
import { renderVersionLabel } from './version-label';
import { createPlayer, setMediaMetadata, mediaUrl, SPEEDS, SLEEP_OPTIONS, type PlayerHandle } from './audio/player';
import * as V from './ui/views';
import * as P from './ui/partners';
import { partnerData, partnerTeacherSlugs, classSearchTexts, EMPTY_PARTNERS, type PartnerData, type PartnerClassFile } from './data/partners';
import { carryPosition } from './audio/carry';
import { devLog } from './devlog';

interface AppState {
  lang: Lang;
  route: Route;
  topic: string;
  myTab: V.MyTab;
  courseFilter: string;
  playing: boolean;
  speed: number;
  sleep: number;
  auto: boolean;
  /** P-14 (15 Nov): Listen (default) or Watch an approved R2 video. */
  mediaMode: V.MediaMode;
}

const state: AppState = {
  lang: 'km',
  route: { name: 'home' },
  topic: 'all',
  myTab: 'inprog',
  courseFilter: '',
  playing: false,
  speed: 1,
  sleep: 0,
  auto: true,
  mediaMode: 'listen',
};

let catalog: Catalog | null = null;
let teachers: Teacher[] = [];
let aliases: AliasMap = {};
/** Course ids of the approved "start-here" path (known ids only); [] = row hidden. */
let startHereIds: string[] = [];
let guideFile: Awaited<ReturnType<typeof getGuideLinesFile>> = null;
/** DEV build only: ?guide=draft seen at start; sticky across in-app navigation. */
let guideDraft = false;
const teacherBySlug = new Map<string, Teacher>();
const courseCache = new Map<string, Course>();
/** Bulk 10: partner classes (empty unless the build served them: partners switch on). */
let partners: PartnerData = EMPTY_PARTNERS;
const partnerCache = new Map<string, PartnerClassFile>();
/** P-14 (bulk 10 P4): the partner class whose KillerPlayer frame is open (after a tap), or null. */
let kpOpen: string | null = null;
let cur: { courseId: string; lessonId: string } | null = null;
let player: PlayerHandle | null = null;
/** The one lesson <video> (Watch). Kept outside main.innerHTML so re-renders re-attach it. */
let videoEl: HTMLVideoElement | null = null;
/** Key of the media the current player is bound to. */
let mountedKey = '';
/** Position + playing state handed to the next mount when switching Listen/Watch. */
let carry: { pos: number; play: boolean } | null = null;

function $(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

async function loadBase(): Promise<void> {
  catalog = await getCatalog();
  partners = partnerData(catalog);
  const tf = await getTeachersFile();
  // P-07: a teacher page exists for a teacher with a shown own course or a served partner class.
  const withCourse = new Set([...(catalog?.courses ?? []).map((c) => c.teacher_slug), ...partnerTeacherSlugs(partners)]);
  teachers = (tf?.teachers ?? []).filter((tc) => !catalog || withCourse.has(tc.slug));
  teacherBySlug.clear();
  for (const tc of teachers) teacherBySlug.set(tc.slug, tc);
  const known = new Set((catalog?.courses ?? []).map((c) => c.id));
  startHereIds = pathCourseIds(await getPathsFile(), 'start-here', known);
  guideFile = await getGuideLinesFile();
}

/** What the screens need to draw the guide leaf and the branch. */
function companionCtx(extra: Pick<CompanionCtx, 'hasLeaf' | 'leafCount' | 'budCount' | 'leafIds'> = {}): CompanionCtx {
  return { lang: state.lang, guide: guideFile, aliases, draft: guideDraft, ...extra };
}

/** After a completion change: add the course's leaf once if every visible lesson is done. */
async function checkLeaf(courseId: string): Promise<void> {
  const c = courseCache.get(courseId) ?? (await course(courseId));
  if (!c) return;
  if (!courseCanFinish(c)) return;
  try {
    await awardLeafIfFinished(courseId, c.lessons.map((l) => l.id));
  } catch (err) {
    devLog('leaf check failed', err);
  }
}

/** First run after the update: leaves for courses that are already finished. */
async function backfillLeavesOnce(): Promise<void> {
  if (!catalog) return;
  try {
    const prog = await catalogProgress();
    const candidates = catalog.courses
      .filter((c) => {
        const done = Object.values(prog[c.id] ?? {}).filter((x) => x.done).length;
        return courseCanFinish(c) && c.lesson_count > 0 && done >= c.lesson_count;
      })
      .map((c) => c.id);
    await backfillLeaves(candidates, async (id) => (await course(id))?.lessons.map((l) => l.id) ?? null);
  } catch (err) {
    devLog('leaf backfill failed', err);
  }
}

async function course(id: string): Promise<Course | null> {
  if (courseCache.has(id)) return courseCache.get(id)!;
  const c = await getCourse(id);
  if (c) courseCache.set(id, c);
  return c;
}

/** A served partner class file (hash-verified), or null (not served / bad shape). */
async function partnerClass(id: string): Promise<PartnerClassFile | null> {
  if (!partners.courses.some((k) => k.id === id)) return null;
  if (partnerCache.has(id)) return partnerCache.get(id)!;
  const k = await getPartnerClass(id);
  if (k) partnerCache.set(id, k);
  return k;
}

/** Partner "started / done" per class (P4); {} until then. */
async function partnerProgressMap(): Promise<Record<string, P.PartnerProgress>> {
  try {
    return await listPartnerProgress();
  } catch (err) {
    devLog('partner progress read failed', err);
    return {};
  }
}

/** What the class page shows where the player goes: the cover until the tap, then the frame. */
function partnerPlayerState(k: PartnerClassFile): 'none' | 'cover' | 'frame' | 'offline' {
  if (kpOpen !== k.id) return 'cover';
  return navigator.onLine === false ? 'offline' : 'frame';
}

/**
 * P-14: after the tap, put the ONE KillerPlayer iframe into the class page's slot (built from the
 * UUID, never pasted HTML) and add the helper script once. A bad UUID = no iframe, the
 * needs-internet notice instead.
 */
function mountKp(k: PartnerClassFile): void {
  const slot = document.querySelector('[data-kp-slot]');
  if (!slot || slot.querySelector('iframe')) return;
  const f = buildKpFrame(document, k.playlist_uuid, k.title);
  if (!f) {
    slot.outerHTML = `<div class="empty">${t('OFFLINE_MEDIA', state.lang)}</div>`;
    return;
  }
  slot.appendChild(f);
  ensureKpHelper(document);
}

/** One player at a time: the tap on a partner cover stops the R2 audio and its mini player. */
function stopR2(): void {
  if (player) {
    player.destroy();
    player = null;
  }
  cur = null;
  state.playing = false;
  renderMini();
}

/** Find-in-course on a partner class page, in place (a re-render would reload the open frame). */
function filterPartnerRows(f: string): void {
  const q = f.trim();
  document.querySelectorAll<HTMLElement>('details.sect').forEach((d) => {
    let shown = 0;
    d.querySelectorAll<HTMLElement>('.les li').forEach((li) => {
      const hit = !q || (li.querySelector('.tt')?.textContent ?? '').includes(q) || li.querySelector<HTMLElement>('.plrow')?.dataset.n === q;
      li.hidden = !hit;
      if (hit) shown++;
    });
    d.hidden = shown === 0;
    if (q && shown) (d as HTMLDetailsElement).open = true;
  });
}

async function progressMap(ids: string[]): Promise<V.ProgressMap> {
  const map: V.ProgressMap = {};
  for (const id of ids) {
    const c = courseCache.get(id);
    if (!c) continue;
    map[id] = {};
    for (const l of c.lessons) map[id][l.id] = await getLessonProgress(id, l.id);
  }
  return map;
}

/** Progress for every catalog course, built from stored progress only (no course files). */
async function catalogProgress(): Promise<V.ProgressMap> {
  // doneCount per course is derived from the progress store directly.
  const map: V.ProgressMap = {};
  if (!catalog) return map;
  const { openLearnDB } = await import('./db');
  const db = await openLearnDB();
  const all = await db.getAll('progress');
  for (const rec of all) map[rec.courseId] = rec.lessons ?? {};
  return map;
}

// ── Navigation ───────────────────────────────────────────────────────────────

function navigate(route: Route, push = true): void {
  const path = routePath(route) + (state.lang === 'en' ? (routePath(route).includes('?') ? '&lang=en' : '?lang=en') : '');
  if (push) history.pushState(null, '', path);
  state.route = route;
  state.courseFilter = '';
  void render();
  window.scrollTo(0, 0);
}

/**
 * Resolve a parsed route's course/lesson id through the alias map (Q5). A
 * provisional `/courses/<prov>` (or its lesson URL) redirects in-app to the
 * permanent id: the route is rewritten and the address bar is replaced (no new
 * history entry) so Back still works. Returns the possibly-rewritten route.
 */
function redirectAlias(route: Route): Route {
  if (route.name === 'course') {
    const perm = resolveAlias(route.id, aliases);
    if (perm !== route.id) {
      const next: Route = { name: 'course', id: perm };
      history.replaceState(null, '', routePath(next));
      return next;
    }
  } else if (route.name === 'lesson') {
    const moved = legacyLessonId(route.id, route.lessonId);
    if (moved) {
      const next: Route = { name: 'lesson', id: route.id, lessonId: moved };
      history.replaceState(null, '', routePath(next));
      return next;
    }
    const perm = resolveAlias(route.id, aliases);
    if (perm !== route.id) {
      const next: Route = { name: 'lesson', id: perm, lessonId: rewriteLessonId(route.lessonId, route.id, perm) };
      history.replaceState(null, '', routePath(next));
      return next;
    }
  }
  return route;
}

function viewState(savedIds: Set<string>): V.ViewState {
  return { lang: state.lang, topic: state.topic, savedIds };
}

// ── Render ────────────────────────────────────────────────────────────────────

async function render(): Promise<void> {
  const main = $('#app-main');
  if (!main || !catalog) return;
  const route = state.route;
  const savedIds = new Set(await listSaved());
  await leaveWatchIfNeeded(route);
  // P-14: leaving the class page (or opening another) closes its frame.
  if (!(route.name === 'partnerClass' && route.classId === kpOpen)) kpOpen = null;

  let html = '';
  if (route.name === 'home') {
    const prog = await catalogProgress();
    const hist = (await listHistory()).map((h) => ({ courseId: h.courseId, lessonId: h.lessonId, lessonNum: h.lessonNum }));
    html = V.homeView(catalog, teachers, teacherBySlug, prog, viewState(savedIds), startHereIds, hist, companionCtx({ leafIds: new Set((await listLeaves()).map((l) => l.course_id)) }));
  } else if (route.name === 'course') {
    const c = await course(route.id);
    if (!c) html = V.notFoundView(state.lang);
    else {
      const prog = await progressMap([c.id]);
      const hist = await listHistory();
      const last = hist.find((h) => h.courseId === c.id)?.lessonId ?? null;
      html = V.courseView(c, teacherBySlug.get(c.teacher_slug), prog, viewState(savedIds), state.courseFilter, last, companionCtx({ hasLeaf: (await listLeaves()).some((l) => l.course_id === c.id) }));
    }
  } else if (route.name === 'lesson') {
    const c = await course(route.id);
    const l = c?.lessons.find((x) => x.id === route.lessonId);
    if (!c || !l) html = V.notFoundView(state.lang);
    else {
      cur = { courseId: c.id, lessonId: l.id };
      await pushHistory(c.id, l.id, l.num);
      const prog = await progressMap([c.id]);
      const notes = (await listNotesFor(c.id, l.id)).map((n) => ({ atS: n.atS, text: n.text }));
      html = V.lessonView(c, l, prog, viewState(savedIds), notes, state.playing, state.speed, state.sleep, state.auto, state.mediaMode);
    }
  } else if (route.name === 'teachers') {
    html = V.teachersView(teachers, state.lang);
  } else if (route.name === 'teacher') {
    const tc = teacherBySlug.get(route.slug);
    if (!tc) html = V.notFoundView(state.lang);
    else {
      const courses = catalog.courses.filter((c) => c.teacher_slug === route.slug);
      const prog = await catalogProgress();
      const pk = partners.courses.filter((k) => k.teacher_slugs.includes(route.slug));
      const partnerHtml = pk.length ? P.teacherPartnerSection(pk, teacherBySlug, state.lang, await partnerProgressMap()) : '';
      html = V.teacherView(tc, courses, teacherBySlug, prog, state.lang, partnerHtml);
    }
  } else if (route.name === 'partners') {
    html = partners.partners.length ? P.partnersView(partners, teacherBySlug, state.lang) : V.notFoundView(state.lang);
  } else if (route.name === 'partner') {
    const p = partners.partners.find((x) => x.slug === route.slug);
    html = p ? P.partnerView(p, partners, teacherBySlug, state.lang, await partnerProgressMap()) : V.notFoundView(state.lang);
  } else if (route.name === 'partnerClass') {
    const p = partners.partners.find((x) => x.slug === route.slug);
    const k = p ? await partnerClass(route.classId) : null;
    if (!p || !k || k.partner_slug !== p.slug) html = V.notFoundView(state.lang);
    else html = P.partnerClassView(k, p, teacherBySlug, state.lang, state.courseFilter, (await partnerProgressMap())[k.id], partnerPlayerState(k));
  } else if (route.name === 'search') {
    html = await renderSearch(route.q);
  } else if (route.name === 'my') {
    html = await renderMy(savedIds);
  } else if (route.name === 'more') {
    html = V.moreView(state.lang);
  } else {
    html = V.notFoundView(state.lang);
  }

  main.innerHTML = html;
  attachVideo();
  renderTabbar();
  if (route.name === 'more') {
    const host = document.getElementById('shell-version');
    if (host) renderVersionLabel(host);
  }
  // Mount the r2 player after the lesson HTML is in the DOM.
  if (route.name === 'lesson') await mountPlayerIfR2();
  if (route.name === 'partnerClass' && kpOpen) {
    const k = partnerCache.get(kpOpen);
    if (k) mountKp(k);
  }
  renderMini();
}

async function renderSearch(q: string): Promise<string> {
  if (!catalog) return '';
  const cq = cleanForSearch(q.trim());
  let courseBundles: { course: V.ViewState extends never ? never : (typeof catalog.courses)[number] }[] = [];
  let teacherHits: Teacher[] = [];
  const lessonHits: { course: (typeof catalog.courses)[number]; lessonId: string; num: number; title: string }[] = [];
  if (cq) {
    // PART 9: old titles after a rename are searched too (shown: the current title only).
    courseBundles = catalog.courses.filter((c) => searchable([c.title_km, c.title_en], c.title_aliases).includes(cq)).map((course) => ({ course }));
    teacherHits = teachers.filter((tc) => cleanForSearch(`${tc.name_km} ${tc.name_en ?? ''}`).includes(cq));
    // Lesson hits: load course files lazily, cap at 40.
    for (const c of catalog.courses) {
      const cf = await course(c.id);
      if (!cf) continue;
      for (const l of cf.lessons) {
        if (searchable([l.title_km], l.title_aliases).includes(cq)) {
          lessonHits.push({ course: c, lessonId: l.id, num: l.num, title: l.title_km });
          if (lessonHits.length >= 40) break;
        }
      }
      if (lessonHits.length >= 40) break;
    }
  }
  // Bulk 10 P3: partner classes by title or teaching points (P-16: the same cleaned substring).
  const partnerHits = cq ? partners.courses.filter((k) => searchable(classSearchTexts(k, partners.terms)).includes(cq)) : [];
  return V.searchView(q, catalog, courseBundles, teacherHits, lessonHits, teacherBySlug, state.lang, {
    count: partnerHits.length,
    html: (hl) => P.partnerSearchHits(partnerHits, teacherBySlug, state.lang, hl),
  });
}

/** /my: leaves, then buds (started = in catalogue, no leaf, >= 1 lesson done), derived now. */
async function myCompanionCtx(): Promise<CompanionCtx> {
  const leaves = await listLeaves();
  const known = new Set((catalog?.courses ?? []).map((c) => c.id));
  const buds = startedCourseIds(await listProgress(), known, new Set(leaves.map((l) => l.course_id)));
  return companionCtx({ leafCount: leaves.length, budCount: buds.length });
}

async function renderMy(savedIds: Set<string>): Promise<string> {
  if (!catalog) return '';
  const prog = await catalogProgress();
  const saved = await listSaved();
  const hist = await listHistory();
  const notes = await listNotes();
  // Bulk 10 P4: started, not-done partner classes (only while partner classes are served);
  // a started class that is no longer served shows "No longer available" (never dropped).
  let partnerInprog = '';
  if (partners.courses.length) {
    const pp = await partnerProgressMap();
    partnerInprog = Object.values(pp)
      .filter((r) => !r.done_at)
      .sort((a, b) => b.started_at - a.started_at)
      .map((r) => {
        const k = partners.courses.find((x) => x.id === r.course_id);
        if (k) return P.partnerClassCard(k, teacherBySlug, state.lang, r);
        return partners.retired.courses[r.course_id] ? P.retiredClassCard(state.lang) : '';
      })
      .join('');
  }
  return V.myView(state.myTab, catalog, teacherBySlug, prog, viewState(savedIds), saved, hist, notes, await myCompanionCtx(), partnerInprog);
}

function renderTabbar(): void {
  const bar = $('#tabbar');
  if (!bar) return;
  const active = tabForRoute(state.route);
  const items: { key: 'home' | 'search' | 'my' | 'more'; label: string }[] = [
    { key: 'home', label: t('TAB_HOME', state.lang) },
    { key: 'search', label: t('TAB_SEARCH', state.lang) },
    { key: 'my', label: t('TAB_MY', state.lang) },
    { key: 'more', label: t('TAB_MORE', state.lang) },
  ];
  bar.innerHTML = items
    .map((it) => `<button data-nav="${it.key}" ${active === it.key ? 'aria-current="page"' : ''}>${it.label}</button>`)
    .join('');
}

// ── r2 player + mini player ────────────────────────────────────────────────

async function mountPlayerIfR2(): Promise<void> {
  if (!cur) return;
  const c = courseCache.get(cur.courseId);
  const l = c?.lessons.find((x) => x.id === cur!.lessonId);
  const r2 = l?.media.find((m) => m.kind === 'r2');
  if (!c || !l || !r2) {
    if (player) {
      player.destroy();
      player = null;
    }
    return;
  }
  const useVideo = state.mediaMode === 'watch' && !!l.video;
  const key = useVideo ? l.video!.src : r2.src;
  // Watch: a re-render (speed, sleep, notes) keeps the playing video as it is.
  if (useVideo && player && player.audio === videoEl && mountedKey === key && !carry) return;
  const pp = await getLessonProgress(c.id, l.id);
  const start = carry ? carry.pos : pp.pos;
  const autoplay = carry?.play ?? false;
  carry = null;
  mountedKey = key;
  player = createPlayer(key, start, {
    onTime: (pos, dur) => {
      void setLessonProgress(c.id, l.id, { pos });
      const bar = document.querySelector<HTMLElement>('[data-bar]');
      const posEl = document.querySelector('[data-pos]');
      const durEl = document.querySelector('[data-dur]');
      if (bar && dur) bar.style.width = `${(100 * pos) / dur}%`;
      if (posEl) posEl.textContent = fmt(pos);
      if (durEl && dur) durEl.textContent = fmt(dur);
    },
    onComplete: () => void setLessonProgress(c.id, l.id, { done: true }).then(() => checkLeaf(c.id)),
    onEnded: () => {
      const idx = c.lessons.indexOf(l);
      const nx = c.lessons[idx + 1];
      if (state.auto && nx) navigate({ name: 'lesson', id: c.id, lessonId: nx.id });
    },
    onState: (playing) => {
      state.playing = playing;
      document.querySelectorAll('[data-pp]').forEach((b) => (b.textContent = playing ? '❚❚' : '▶'));
      renderMini();
    },
  }, useVideo ? ensureVideo(l) : undefined);
  player.setSpeed(state.speed);
  if (state.sleep) player.setSleep(state.sleep);
  setMediaMetadata(l.title_km, c.title_km);
  if (autoplay) void player.play();
}

/** The lesson <video> for Watch, poster from the data (bare R2 key), never guessed. */
function ensureVideo(l: Lesson): HTMLVideoElement {
  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.setAttribute('playsinline', '');
    videoEl.preload = 'metadata';
    videoEl.dataset.video = '';
    try {
      (globalThis as unknown as { __learnVideo?: HTMLVideoElement }).__learnVideo = videoEl;
    } catch {
      /* ignore */
    }
  }
  if (l.video?.poster) videoEl.poster = mediaUrl(l.video.poster);
  else videoEl.removeAttribute('poster');
  return videoEl;
}

/**
 * iOS Safari starts a video only from inside the user's tap. The Watch switch reads the
 * saved position first (async), so the real start would come too late: start the video
 * element HERE, in the tap, muted (allowed everywhere), and pause it at once. That unlocks
 * the element; the player then sets the position and plays it normally.
 */
function startVideoInTap(): void {
  if (!cur || state.mediaMode === 'watch' || !player || player.audio.paused) return;
  const l = courseCache.get(cur.courseId)?.lessons.find((x) => x.id === cur!.lessonId);
  if (!l?.video) return;
  const v = ensureVideo(l);
  const url = mediaUrl(l.video.src);
  if (v.src !== url) v.src = url;
  v.muted = true;
  const p = v.play();
  const unmute = () => {
    // Still the unlock play (the player has not taken the element yet): stop it here.
    if (player?.audio !== v) v.pause();
    v.muted = false;
  };
  if (p && typeof p.then === 'function') p.then(unmute, unmute);
  else unmute();
}

/** Put the <video> into the lesson's slot right after each render (same task: it keeps playing). */
function attachVideo(): void {
  const slot = document.querySelector('[data-video-slot]');
  if (!slot || state.mediaMode !== 'watch' || !cur) return;
  const l = courseCache.get(cur.courseId)?.lessons.find((x) => x.id === cur!.lessonId);
  if (l?.video) slot.appendChild(ensureVideo(l));
}


/** Switch Listen <-> Watch on the open lesson; the position and play state carry over. */
async function switchMode(mode: V.MediaMode): Promise<void> {
  if (!cur || mode === state.mediaMode) return;
  const pp = await getLessonProgress(cur.courseId, cur.lessonId);
  carry = { pos: carryPosition(player?.audio.currentTime ?? 0, pp.pos), play: !!player && !player.audio.paused };
  state.mediaMode = mode;
  await render();
}

/**
 * Leaving the lesson (or opening another one) while watching: go back to Listen.
 * On a non-lesson screen the audio continues from the same second, so the mini player
 * and the lock-screen controls keep working; a new lesson starts in Listen (the default).
 */
async function leaveWatchIfNeeded(route: Route): Promise<void> {
  if (state.mediaMode !== 'watch') return;
  const sameLesson = route.name === 'lesson' && cur && route.id === cur.courseId && route.lessonId === cur.lessonId;
  if (sameLesson) return;
  const pos = player?.audio.currentTime ?? 0;
  const play = !!player && !player.audio.paused;
  state.mediaMode = 'listen';
  if (route.name !== 'lesson' && cur) {
    const pp = await getLessonProgress(cur.courseId, cur.lessonId);
    carry = { pos: carryPosition(pos, pp.pos), play };
    await mountPlayerIfR2();
  }
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const x = Math.floor(s % 60);
  const d = (n: number | string): string => (state.lang === 'km' ? String(n).replace(/\d/g, (c) => '០១២៣៤៥៦៧៨៩'[Number(c)]) : String(n));
  return `${d(m)}:${d(String(x).padStart(2, '0'))}`;
}

function renderMini(): void {
  const mini = $('#mini') as HTMLElement | null;
  if (!mini) return;
  if (!cur || !player || state.route.name === 'lesson') {
    mini.hidden = true;
    mini.innerHTML = '';
    return;
  }
  const c = courseCache.get(cur.courseId);
  const l = c?.lessons.find((x) => x.id === cur!.lessonId);
  if (!c || !l) {
    mini.hidden = true;
    return;
  }
  mini.hidden = false;
  mini.innerHTML = `<button class="mt" data-nav="lesson" data-id="${c.id}" data-lesson="${esc(l.id)}">${esc(l.title_km)}<small>${esc(c.title_km)}</small></button><button class="pp" data-pp>${state.playing ? '❚❚' : '▶'}</button>`;
}

function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout((el as unknown as { _t?: ReturnType<typeof setTimeout> })._t);
  (el as unknown as { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(() => (el!.hidden = true), 1800);
}

// ── Events ─────────────────────────────────────────────────────────────────

function handoffUrl(which: string): string {
  const base = which === 'vacana' ? VACANA_BASE_URL : LIBRARY_BASE_URL;
  return base + (state.lang === 'en' ? '?lang=en' : '');
}

function wireEvents(): void {
  document.addEventListener('click', (e) => {
    // Watch: a tap on the picture pauses / plays (the <video> has no native controls).
    if (videoEl && (e.target as HTMLElement).closest('.vbox video') === videoEl) {
      player?.toggle();
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>('button,a,label');
    if (!el) return;
    const d = el.dataset;

    if (d.nav) {
      e.preventDefault();
      switch (d.nav) {
        case 'home': return navigate({ name: 'home' });
        case 'search': return navigate({ name: 'search', q: '' });
        case 'my': return navigate({ name: 'my' });
        case 'more': return navigate({ name: 'more' });
        case 'teachers': return navigate({ name: 'teachers' });
        case 'teacher': return navigate({ name: 'teacher', slug: d.slug! });
        case 'course': return navigate({ name: 'course', id: d.id! });
        case 'lesson': return navigate({ name: 'lesson', id: d.id!, lessonId: d.lesson! });
        case 'partners': return navigate({ name: 'partners' });
        case 'partner': return navigate({ name: 'partner', slug: d.slug! });
        case 'pclass': return navigate({ name: 'partnerClass', slug: d.slug!, classId: d.id! });
      }
    }
    if (d.handoff != null) {
      e.preventDefault();
      window.open(handoffUrl(d.handoff), '_blank', 'noopener');
      return;
    }
    if (d.setlang) {
      state.lang = setLang(d.setlang as Lang);
      updateHeader();
      void render();
      return;
    }
    if (d.topic) {
      state.topic = d.topic;
      void render();
      return;
    }
    if (d.mtab) {
      state.myTab = d.mtab as V.MyTab;
      void render();
      return;
    }
    if (d.save != null) {
      void toggleSaved(d.save).then(() => render());
      return;
    }
    if (d.share != null) {
      const url = location.origin + routePath(state.route);
      navigator.clipboard?.writeText(url).then(
        () => toast(t('LINK_COPIED', state.lang)),
        () => toast(url)
      );
      return;
    }
    if (d.pp != null) {
      player?.toggle();
      return;
    }
    if (d.skip) {
      player?.skip(Number(d.skip));
      return;
    }
    if (d.seek) {
      player?.seek(Number(d.seek));
      void player?.play();
      return;
    }
    if (d.speed != null) {
      const i = (SPEEDS.indexOf(state.speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length;
      state.speed = SPEEDS[i];
      player?.setSpeed(state.speed);
      void render();
      return;
    }
    if (d.sleep != null) {
      const i = (SLEEP_OPTIONS.indexOf(state.sleep as (typeof SLEEP_OPTIONS)[number]) + 1) % SLEEP_OPTIONS.length;
      state.sleep = SLEEP_OPTIONS[i];
      player?.setSleep(state.sleep);
      void render();
      return;
    }
    if (d.mode === 'listen' || d.mode === 'watch') {
      if (d.mode === 'watch') startVideoInTap();
      void switchMode(d.mode);
      return;
    }
    if (d.auto != null) {
      state.auto = !state.auto;
      void render();
      return;
    }
    if (d.done != null && cur) {
      void getLessonProgress(cur.courseId, cur.lessonId).then((pp) =>
        setLessonProgress(cur!.courseId, cur!.lessonId, { done: !pp.done })
          .then(() => checkLeaf(cur!.courseId))
          .then(() => render())
      );
      return;
    }
    if (d.bioToggle != null) {
      // PART C: open / close the teacher bio in place (Enter and Space work: a real button).
      const open = el.getAttribute('aria-expanded') !== 'true';
      el.setAttribute('aria-expanded', String(open));
      const arrow = el.querySelector('[data-arrow]');
      if (arrow) arrow.textContent = open ? '▾' : '▸';
      const panel = document.getElementById(el.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !open;
      return;
    }
    if (d.kpPlay != null && state.route.name === 'partnerClass') {
      const id = state.route.classId;
      stopR2();
      kpOpen = id;
      void markPartnerStarted(id).then(() => render(), () => render());
      return;
    }
    if (d.pdone != null && state.route.name === 'partnerClass') {
      void togglePartnerDone(state.route.classId).then((rec) => {
        if (!rec) return;
        const done = !!rec.done_at;
        // in place: an open frame keeps playing
        el.setAttribute('aria-pressed', String(done));
        el.classList.toggle('ghost', !done);
        const st = document.querySelector('[data-pstatus]');
        if (st) st.textContent = done ? `✓ ${t('PARTNER_IS_DONE', state.lang)}` : t('PARTNER_STARTED', state.lang);
      });
      return;
    }
    if (d.export != null) {
      void doExport();
      return;
    }
    // scrub click
    const scrub = (e.target as HTMLElement).closest<HTMLElement>('[data-scrub]');
    if (scrub && player) {
      const r = scrub.getBoundingClientRect();
      const dur = player.audio.duration || 0;
      if (dur) player.seek((dur * ((e as MouseEvent).clientX - r.left)) / r.width);
    }
  });

  document.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    if (kind === 'home-search' || kind === 'search') {
      const q = (form.querySelector('input[name="q"]') as HTMLInputElement)?.value ?? '';
      navigate({ name: 'search', q });
    } else if (kind === 'note' && cur) {
      const ta = form.querySelector('textarea[name="note"]') as HTMLTextAreaElement;
      const text = ta.value.trim();
      if (!text) return;
      void getLessonProgress(cur.courseId, cur.lessonId).then((pp) => {
        const c = courseCache.get(cur!.courseId)!;
        const l = c.lessons.find((x) => x.id === cur!.lessonId)!;
        return addNote({ courseId: cur!.courseId, lessonId: cur!.lessonId, lessonNum: l.num, atS: Math.floor(pp.pos), text }).then(() => render());
      });
    }
  });

  document.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const form = input.closest<HTMLFormElement>('form[data-form]');
    if (form?.dataset.form === 'search' && input.name === 'q') {
      state.route = { name: 'search', q: input.value };
      const pos = input.selectionStart;
      void render().then(() => {
        const again = document.querySelector<HTMLInputElement>('form[data-form="search"] input[name="q"]');
        if (again) {
          again.focus();
          if (pos != null) again.setSelectionRange(pos, pos);
        }
      });
    }
    if (form?.dataset.form === 'course-filter' && input.name === 'f' && state.route.name === 'partnerClass') {
      state.courseFilter = input.value;
      filterPartnerRows(input.value);
      return;
    }
    if (form?.dataset.form === 'course-filter' && input.name === 'f') {
      state.courseFilter = input.value;
      const pos = input.selectionStart;
      void render().then(() => {
        const again = document.querySelector<HTMLInputElement>('form[data-form="course-filter"] input[name="f"]');
        if (again) {
          again.focus();
          if (pos != null) again.setSelectionRange(pos, pos);
        }
      });
    }
    if (input.dataset.import != null && input.files?.[0]) {
      void doImport(input.files[0]);
    }
  });

  window.addEventListener('popstate', () => {
    state.route = redirectAlias(parseRoute(location.pathname, location.search));
    void render();
  });
}

async function doExport(): Promise<void> {
  try {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `learn-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    devLog('export failed', err);
  }
}

async function doImport(file: File): Promise<void> {
  try {
    const backup = JSON.parse(await file.text());
    await importBackup(backup);
    toast('✓');
    await render();
  } catch (err) {
    devLog('import failed', err);
    toast('✗');
  }
}

function updateHeader(): void {
  const header = $('#app-header');
  if (!header) return;
  header.innerHTML = `<div class="hin"><button class="brand" data-nav="home">${state.lang === 'km' ? 'ថ្នាក់សិក្សា · Learn' : 'Learn · ថ្នាក់សិក្សា'}<small>84000.DIGITAL</small></button>
  <span class="lang" role="group" aria-label="Language"><button data-setlang="km" aria-pressed="${state.lang === 'km'}">ខ្មែរ</button><button data-setlang="en" aria-pressed="${state.lang === 'en'}">EN</button></span></div>`;
}

/** App entry: resolve language, load data, wire events, render the first route. */
export async function startApp(): Promise<void> {
  state.lang = initLang();
  guideDraft = draftAllowed(location.search);
  updateHeader();
  wireEvents();
  await loadBase();
  // Load the alias map and migrate user data provisional → permanent, once.
  aliases = (await getAliasesFile()) ?? {};
  try {
    await migrateAliases(aliases);
  } catch (err) {
    devLog('alias migration failed', err);
  }
  await backfillLeavesOnce();
  state.route = redirectAlias(parseRoute(location.pathname, location.search));
  // topic deep link on /courses/?topic=
  const topicParam = new URLSearchParams(location.search).get('topic');
  if (topicParam && catalog?.courses.some((c) => c.topics.length > 0)) state.topic = topicParam;
  await render();
}

// expose for the update prompt in main.ts
export function currentLang(): Lang {
  return state.lang;
}
export { STRINGS, displayString };
