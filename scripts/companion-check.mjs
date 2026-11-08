/**
 * scripts/companion-check.mjs — build-time checks for the study-companion data
 * (bulk-05): data/paths.json and data/guide-lines.json.
 *
 * - A bad SHAPE is a hard failure (the build stops, so no bad file ever gets a
 *   manifest hash and reaches the app).
 * - Unknown course ids are NOT failures: they are listed in
 *   reports/paths-issues.csv and skipped by the app.
 *
 * Pure functions; the file I/O is in build-courses.mjs. People edit data/,
 * never public/data/.
 */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';

/** @returns {string[]} shape errors (empty = OK) */
export function pathsShapeErrors(v) {
  const errs = [];
  if (!isObj(v)) return ['paths.json: not an object'];
  if (typeof v.version !== 'number') errs.push('paths.json: version must be a number');
  if (!Array.isArray(v.paths)) return [...errs, 'paths.json: paths must be an array'];
  v.paths.forEach((p, i) => {
    if (!isObj(p)) return errs.push(`paths[${i}]: not an object`);
    if (!isStr(p.id)) errs.push(`paths[${i}]: id must be a string`);
    for (const k of ['title_km', 'title_en']) if (!(p[k] === null || isStr(p[k]))) errs.push(`paths[${i}]: ${k} must be string or null`);
    if (!Array.isArray(p.course_ids) || !p.course_ids.every(isStr)) errs.push(`paths[${i}]: course_ids must be an array of strings`);
    if (typeof p.approved !== 'boolean') errs.push(`paths[${i}]: approved must be true or false`);
  });
  return errs;
}

/** @returns {string[]} shape errors (empty = OK) */
export function guideLinesShapeErrors(v) {
  const errs = [];
  if (!isObj(v)) return ['guide-lines.json: not an object'];
  if (typeof v.version !== 'number') errs.push('guide-lines.json: version must be a number');
  if (!isStr(v.default_sign)) errs.push('guide-lines.json: default_sign must be a string');
  if (!isObj(v.course_signs) || !Object.values(v.course_signs).every(isStr)) errs.push('guide-lines.json: course_signs must map course id to file name');
  if (!isObj(v.lines)) return [...errs, 'guide-lines.json: lines must be an object'];
  for (const [k, l] of Object.entries(v.lines)) {
    if (!isObj(l) || !isStr(l.km) || !isStr(l.en) || typeof l.approved !== 'boolean') errs.push(`lines.${k}: needs km, en (strings) and approved (true/false)`);
  }
  return errs;
}

/**
 * Rows for reports/paths-issues.csv.
 * @param {object} paths      parsed paths.json (shape already OK)
 * @param {object} guide      parsed guide-lines.json (shape already OK)
 * @param {Set<string>} catalogIds ids in the catalogue
 * @param {Record<string,string>} aliases provisional → permanent
 * @returns {{file:string, where:string, id:string, kind:string}[]}
 */
export function companionIssues(paths, guide, catalogIds, aliases = {}) {
  const rows = [];
  for (const p of paths.paths) {
    for (const id of p.course_ids) {
      if (!catalogIds.has(id)) rows.push({ file: 'paths.json', where: `path ${p.id}`, id, kind: 'unknown_course_id' });
    }
  }
  for (const key of Object.keys(guide.course_signs)) {
    const ok = catalogIds.has(key) || catalogIds.has(aliases[key]);
    if (!ok) rows.push({ file: 'guide-lines.json', where: 'course_signs', id: key, kind: 'unknown_course_id' });
  }
  return rows;
}

export function issuesCsv(rows) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  return ['file,where,id,kind', ...rows.map((r) => [r.file, q(r.where), q(r.id), r.kind].join(','))].join('\n') + '\n';
}
