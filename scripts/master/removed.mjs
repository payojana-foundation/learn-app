/**
 * scripts/master/removed.mjs — PART 13: read side of data/ops/removals.json (written by
 * scripts/master/removals.mjs). No other imports, so the build, master-sync, the queues and the
 * planners can use it without import cycles.
 *   isRemovedRow(row, state)  the row's course or the row itself is removed
 *   keepRows(rows, state)     the rows that stay in the app
 *   removedSources(state)     Drive ids left out of the conversion queues and autorun
 */
import { readFileSync, existsSync } from 'node:fs';

export const STATE = 'data/ops/removals.json';

export const emptyState = () => ({ courses: {}, lessons: {}, retired: [], sources: [], log: { courses: {}, lessons: {} } });

/** A row is hidden when its course or the row itself is removed. Pure. */
export function isRemovedRow(r, state) {
  const s = state || {};
  return Boolean((r && r.course_id && s.courses && s.courses[r.course_id]) || (r && r.row_key && s.lessons && s.lessons[r.row_key]));
}

/** The rows that stay in the app. Pure. */
export const keepRows = (rows, state) => (rows || []).filter((r) => !isRemovedRow(r, state));

/** Drive ids that must not be converted. Pure. */
export const removedSources = (state) => new Set(((state && state.sources) || []).filter(Boolean));

/** data/ops/removals.json (missing = nothing removed). A bad shape throws. */
export function readState(path = STATE) {
  if (!existsSync(path)) return emptyState();
  const s = JSON.parse(readFileSync(path, 'utf-8'));
  const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!obj(s) || !obj(s.courses || {}) || !obj(s.lessons || {}) || !Array.isArray(s.retired || []) || !Array.isArray(s.sources || [])) {
    throw new Error(`${path}: bad shape (courses/lessons objects, retired/sources lists)`);
  }
  return { ...emptyState(), ...s };
}
