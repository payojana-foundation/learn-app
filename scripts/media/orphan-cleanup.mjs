/**
 * scripts/media/orphan-cleanup.mjs - delete R2 "orphans" for one queue
 * (r2-orphan-cleanup.yml). An orphan = an R2 object at the id's md5 key while
 * the manifest has NO entry for that id and NO entry with that key.
 *
 * Safety: a key with ANY manifest entry (by drive_file_id or by key) is never
 * touched. Only keys of the form audio/<16 hex>-a64.mp3 are ever deleted.
 *
 * Usage: node scripts/media/orphan-cleanup.mjs <queue.csv> <manifest.json> <delete|list>
 * Env:   ACCESS_TOKEN (Drive), RCLONE (default "rclone").
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseQueue } from './queue-plan.mjs';

const KEY_RE = /^audio\/[0-9a-f]{16}-a64\.mp3$/;

/**
 * Pure decision. keyOf(id) -> key|null ; sizeOf(key) -> bytes (0 = absent).
 * Returns [{id, key, action}] with action in: delete | has-entry | no-object | no-key.
 */
export function planCleanup(ids, manifest, keyOf, sizeOf) {
  const list = Array.isArray(manifest) ? manifest : [];
  const byId = new Set(list.map((e) => e && e.drive_file_id).filter(Boolean));
  const byKey = new Set(list.map((e) => e && e.key).filter(Boolean));
  return ids.map((id) => {
    if (byId.has(id)) return { id, key: null, action: 'has-entry' };
    const key = keyOf(id);
    if (!key || !KEY_RE.test(key)) return { id, key: null, action: 'no-key' };
    if (byKey.has(key)) return { id, key, action: 'has-entry' };
    return { id, key, action: sizeOf(key) > 0 ? 'delete' : 'no-object' };
  });
}

async function driveKey(id, token) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=md5Checksum`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const m = String((await r.json()).md5Checksum || '').toLowerCase().match(/^[0-9a-f]{16}/);
  return m ? `audio/${m[0]}-a64.mp3` : null;
}

function r2Size(rclone, key) {
  try {
    const out = execFileSync(rclone, ['lsjson', `r2:course-media/${key}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const a = JSON.parse(out);
    return (a[0] && a[0].Size) || 0;
  } catch {
    return 0;
  }
}

async function main() {
  const [queue, manifestPath, mode] = process.argv.slice(2);
  const rclone = process.env.RCLONE || 'rclone';
  const ids = parseQueue(readFileSync(queue, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const keys = new Map();
  for (const id of ids) keys.set(id, await driveKey(id, process.env.ACCESS_TOKEN || ''));
  const plan = planCleanup(ids, manifest, (id) => keys.get(id), (k) => r2Size(rclone, k));
  let deleted = 0;
  for (const p of plan) {
    if (p.action === 'delete' && mode === 'delete') {
      execFileSync(rclone, ['deletefile', `r2:course-media/${p.key}`], { stdio: 'inherit' });
      console.log(`DELETED ${p.key} (id ${p.id})`);
      deleted++;
    } else if (p.action === 'delete') {
      console.log(`WOULD DELETE ${p.key} (id ${p.id}) - set confirm=DELETE to delete`);
    } else {
      console.log(`keep ${p.id} ${p.key || ''} (${p.action})`);
    }
  }
  const n = plan.filter((p) => p.action === 'delete').length;
  console.log(`${queue}: ${plan.length} ids, ${n} orphan(s), ${deleted} deleted`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
