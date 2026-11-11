/**
 * scripts/catalogue/file-aliases.mjs — file-id and tab-name aliases (Part A).
 *
 * data/source/file-aliases.json:
 *   { "files": { "<new_file_id>": "<old_file_id>" },
 *     "tabs":  { "<file_id>\t<new tab>": "<file_id>\t<old tab>" } }
 *
 * Why: a converted/re-uploaded sheet gets a NEW Drive file id (same name) and a
 * renamed tab is a NEW tab name. Every registry keys on the OLD id/tab (teacher-
 * files.json, course-ids.json, SKIP_TABS, NON_COURSE_FILES, PILOT_FILE, the
 * INVENTORY name). The alias map points new → old so course ids, lesson ids and
 * the teacher stay the same.
 *
 * Order: resolve the FILE id first, then the TAB, before any lookup.
 * A tab key may be written with the new file id (as on disk) or the old one.
 * Pure + dependency-free; chains are followed (A→B→C) with a loop guard.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const EMPTY_ALIASES = Object.freeze({ files: {}, tabs: {} });

/** Accept a parsed JSON value; anything malformed becomes the empty map. */
export function normalizeAliases(raw) {
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { files: obj(raw && raw.files), tabs: obj(raw && raw.tabs) };
}

export function loadAliases(root) {
  const p = join(root, 'data', 'source', 'file-aliases.json');
  if (!existsSync(p)) return normalizeAliases(null);
  return normalizeAliases(JSON.parse(readFileSync(p, 'utf-8')));
}

/** new file id → the id the registries know (follows chains, loop-safe). */
export function canonicalFileId(fileId, aliases) {
  const files = (aliases && aliases.files) || {};
  const seen = new Set([fileId]);
  let id = fileId;
  while (typeof files[id] === 'string' && files[id] && !seen.has(files[id])) {
    id = files[id];
    seen.add(id);
  }
  return id;
}

/** new tab name (of the file on disk) → the tab name the registries know. */
export function canonicalTab(rawFileId, tabName, aliases) {
  const tabs = (aliases && aliases.tabs) || {};
  const canonFile = canonicalFileId(rawFileId, aliases);
  let name = tabName;
  const seen = new Set();
  for (;;) {
    const hit = tabs[`${rawFileId}\t${name}`] ?? tabs[`${canonFile}\t${name}`];
    if (typeof hit !== 'string' || !hit || seen.has(name)) break;
    seen.add(name);
    const i = hit.indexOf('\t');
    const next = i >= 0 ? hit.slice(i + 1) : hit;
    if (next === name) break;
    name = next;
  }
  return name;
}
