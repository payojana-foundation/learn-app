/**
 * scripts/media/sheets-query.mjs — build the Drive `files.list` q for the
 * children of a folder (Q1 sheets-inventory). Extracted so the exact query is
 * unit-tested: the old workflow used `trimmed = false` (not a Drive field,
 * which 400s and silently returned zero items); the field is `trashed`.
 *
 * Usage: node scripts/media/sheets-query.mjs <folderId>  → prints URL-encoded q
 */
export function childrenQuery(folderId) {
  if (!folderId || /['\\]/.test(folderId)) throw new Error('bad folderId');
  return `'${folderId}' in parents and trashed = false`;
}

function main() {
  const id = process.argv[2];
  process.stdout.write(encodeURIComponent(childrenQuery(id)));
}
if (process.argv[1] && process.argv[1].endsWith('sheets-query.mjs')) main();
