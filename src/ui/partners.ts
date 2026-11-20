/**
 * src/ui/partners.ts — bulk 10 P3/P4 screens for partner YouTube classes (served only when the
 * partners switch is on; otherwise the routes show the normal "not found").
 *
 * A partner class page (P-11 exemption, coordinator 19 Nov) has NO per-lesson progress bar and
 * NO ticks, and no leaf or bud: only "started" (after the first play tap) and a "mark class done"
 * toggle. The player is NOT here: P-14 — the page shows Learn's own cover button; the KillerPlayer
 * iframe is built by src/app.ts only after the tap, from the UUID (never pasted HTML).
 * Titles and names are shown exactly as stored (P-17), escaped for HTML only.
 */
import type { Lang } from '../lang';
import { t } from '../strings';
import { num, esc } from '../format';
import type { Teacher } from '../data/catalog';
import type { Partner, PartnerCourse, PartnerClassFile, PartnerData, PartnerLesson } from '../data/partners';

export interface PartnerProgress {
  course_id: string;
  started_at: number;
  done_at: number | null;
}

const SECTION = 20;

const label = (lang: Lang): string => `<span class="plabel"><span aria-hidden="true">▶</span> ${t('PARTNER_LABEL', lang)}</span>`;

function teacherNames(slugs: string[], teacherBySlug: Map<string, Teacher>): string {
  return slugs.map((s) => teacherBySlug.get(s)).filter((x): x is Teacher => !!x).map((tc) => esc(tc.name_km)).join(' · ');
}

const partnerName = (p: Partner, lang: Lang): string => esc(lang === 'en' && p.name_en ? p.name_en : p.name_km);

/** A class card (list, partner page, teacher page, My Learning). */
export function partnerClassCard(k: PartnerCourse, teacherBySlug: Map<string, Teacher>, lang: Lang, prog?: PartnerProgress): string {
  const state = prog ? (prog.done_at ? `<span>✓ ${t('PARTNER_IS_DONE', lang)}</span>` : `<span>${t('PARTNER_STARTED', lang)}</span>`) : '';
  return `<button class="card pcard" data-nav="pclass" data-slug="${esc(k.partner_slug)}" data-id="${esc(k.id)}"><span class="t">${esc(k.title)}</span>
  <span class="muted small">${teacherNames(k.teacher_slugs, teacherBySlug)}</span>
  <span class="meta"><span>${num(k.lesson_count, lang)} ${t('LESSONS', lang)}</span>${label(lang)}${state}</span></button>`;
}

/** A started class that is no longer served (retired): kept, never dropped, not a link. */
export function retiredClassCard(lang: Lang): string {
  return `<div class="card pcard retired" aria-disabled="true"><span class="t muted">${t('PARTNER_RETIRED', lang)}</span></div>`;
}

export function partnersView(d: PartnerData, teacherBySlug: Map<string, Teacher>, lang: Lang): string {
  return `<h1>${t('PARTNERS', lang)}</h1><div class="list" style="margin-top:14px">${d.partners
    .map((p) => `<button data-nav="partner" data-slug="${esc(p.slug)}"><span>${partnerName(p, lang)}<br><span class="muted small">${teacherNames(p.teacher_slugs, teacherBySlug)}</span></span><span class="muted small">${num(p.course_ids.length, lang)} ${t('PARTNER_CLASSES', lang)}</span></button>`)
    .join('')}</div>`;
}

export function partnerView(p: Partner, d: PartnerData, teacherBySlug: Map<string, Teacher>, lang: Lang, prog: Record<string, PartnerProgress>): string {
  const classes = d.courses.filter((k) => k.partner_slug === p.slug);
  const teachers = p.teacher_slugs.map((s) => teacherBySlug.get(s)).filter((x): x is Teacher => !!x);
  const other = lang === 'en' ? p.name_km : p.name_en;
  return `<div class="crumbs"><button class="link" data-nav="partners">${t('PARTNERS', lang)}</button></div>
  <h1>${partnerName(p, lang)}</h1>${other ? `<p class="muted" style="margin:0">${esc(other)}</p>` : ''}
  ${teachers.length ? `<section style="margin-top:14px"><div class="sechead"><h2>${t('TEACHERS', lang)}</h2></div><div class="row">${teachers.map((tc) => `<button class="link" data-nav="teacher" data-slug="${esc(tc.slug)}">${esc(tc.name_km)}</button>`).join('')}</div></section>` : ''}
  <section style="margin-top:14px"><div class="sechead"><h2>${t('PARTNER_CLASSES', lang)}</h2><span class="muted small">${num(classes.length, lang)}</span></div>
  <div class="cgrid">${classes.map((k) => partnerClassCard(k, teacherBySlug, lang, prog[k.id])).join('')}</div></section>`;
}

/**
 * The class page. `player` = 'cover' (Learn's own cover button, before the tap) | 'frame' (the
 * slot app.ts fills with the iframe) | 'offline' (needs internet) | 'none' (P3: no player yet).
 */
export function partnerClassView(
  k: PartnerClassFile,
  p: Partner,
  teacherBySlug: Map<string, Teacher>,
  lang: Lang,
  filter: string,
  prog: PartnerProgress | undefined,
  player: 'none' | 'cover' | 'frame' | 'offline' = 'none'
): string {
  const f = filter.trim();
  const rows = k.lessons.filter((l) => !f || l.title.includes(f) || String(l.num) === f);
  const sections: PartnerLesson[][] = [];
  for (let i = 0; i < rows.length; i += SECTION) sections.push(rows.slice(i, i + SECTION));
  const row = (l: PartnerLesson): string => `<li><span class="plrow" data-n="${l.num}"><span class="n">${num(l.num, lang)}</span><span class="tt">${l.title.trim() ? esc(l.title) : `<span class="ph">${t('NO_TITLE', lang)}</span>`}</span></span></li>`;
  const sectionsHtml = sections
    .map((s, i) => `<details class="sect" ${f || i === 0 ? 'open' : ''}><summary><span>${t('LESSON', lang)} ${num(s[0].num, lang)}–${num(s[s.length - 1].num, lang)}</span><span class="muted small">${num(s.length, lang)}</span></summary><ul class="les">${s.map(row).join('')}</ul></details>`)
    .join('') || `<div class="empty">${t('NOTHING', lang)}</div>`;
  const playerHtml =
    player === 'cover'
      ? `<button type="button" class="pcover" data-kp-play aria-label="${t('PARTNER_PLAY', lang)}: ${esc(k.title)}"><span class="pcover-t">${esc(k.title)}</span><span class="pcover-p" aria-hidden="true">▶</span><span class="small">${t('PARTNER_PLAY', lang)}</span></button>`
      : player === 'frame'
        ? '<div class="pframe" data-kp-slot></div>'
        : player === 'offline'
          ? `<div class="empty">${t('OFFLINE_MEDIA', lang)}</div>`
          : '';
  const done = !!prog?.done_at;
  const status = prog
    ? `<div class="row" style="margin-top:12px"><span class="muted small" data-pstatus>${done ? `✓ ${t('PARTNER_IS_DONE', lang)}` : t('PARTNER_STARTED', lang)}</span>
      <button type="button" class="btn ${done ? '' : 'ghost'} sm" data-pdone aria-pressed="${done}">${t('PARTNER_MARK_DONE', lang)}</button></div>`
    : '';
  return `<div class="chead"><div class="crumbs"><button class="link" data-nav="partner" data-slug="${esc(p.slug)}">${partnerName(p, lang)}</button></div>
  <h1>${esc(k.title)}</h1>
  <div class="row">${k.teacher_slugs.map((s) => teacherBySlug.get(s)).filter((x): x is Teacher => !!x).map((tc) => `<button class="who" data-nav="teacher" data-slug="${esc(tc.slug)}">${tc.photo ? `<img src="/data/${esc(tc.photo)}" alt="">` : ''}<span>${esc(tc.name_km)}</span></button>`).join('')}</div>
  <div class="meta"><span>${num(k.lessons.length, lang)} ${t('LESSONS', lang)}</span>${label(lang)}</div>
  ${playerHtml}${status}</div>
  <section style="margin-top:20px"><form class="search" data-form="course-filter"><input name="f" type="search" value="${esc(filter)}" placeholder="${t('FILTER', lang)}" aria-label="${t('FILTER', lang)}"></form>
  <div>${sectionsHtml}</div></section>`;
}

/** Home: one row of partners (links to each partner page) + "See all" → /partners; '' when none. */
export function homePartnerSection(d: PartnerData, lang: Lang): string {
  if (!d.partners.length) return '';
  return `<section><div class="sechead"><h2>${t('PARTNERS', lang)}</h2><button class="link" data-nav="partners">${t('SEE_ALL', lang)}</button></div>
  <div class="hrow">${d.partners
    .map((p) => `<button class="card" data-nav="partner" data-slug="${esc(p.slug)}"><span class="t">${partnerName(p, lang)}</span><span class="meta"><span>${num(p.course_ids.length, lang)} ${t('PARTNER_CLASSES', lang)}</span>${label(lang)}</span></button>`)
    .join('')}</div></section>`;
}

/** Search hits for partner classes (section), or ''. */
export function partnerSearchHits(hits: PartnerCourse[], teacherBySlug: Map<string, Teacher>, lang: Lang, hl: (s: string) => string): string {
  if (!hits.length) return '';
  return `<section><div class="sechead"><h2>${t('PARTNER_CLASSES', lang)}</h2></div><ul class="res">${hits
    .map((k) => `<li><button data-nav="pclass" data-slug="${esc(k.partner_slug)}" data-id="${esc(k.id)}">${hl(k.title)}<span class="muted small">${teacherNames(k.teacher_slugs, teacherBySlug)} · ${t('PARTNER_LABEL', lang)}</span></button></li>`)
    .join('')}</ul></section>`;
}

/** Teacher page: that teacher's served partner classes, or ''. */
export function teacherPartnerSection(classes: PartnerCourse[], teacherBySlug: Map<string, Teacher>, lang: Lang, prog: Record<string, PartnerProgress>): string {
  if (!classes.length) return '';
  return `<section style="margin-top:20px"><div class="sechead"><h2>${t('PARTNER_CLASSES', lang)}</h2><span class="muted small">${num(classes.length, lang)}</span></div>
  <div class="cgrid">${classes.map((k) => partnerClassCard(k, teacherBySlug, lang, prog[k.id])).join('')}</div></section>`;
}
