/**
 * scripts/verify-deploy.mjs — post-deploy hash verification (`npm run deploy-check <url>`).
 *
 * Fetches data/manifest.json from a DEPLOYED learn-app URL, then fetches every
 * data file the manifest lists, computes the SHA-256 of each response body, and
 * compares it to the manifest's recorded hash. Prints a MATCH / MISMATCH line
 * per file and a record block ready to paste into a report.
 *
 * Why: the app trusts a file only when its bytes hash to the manifest value.
 * This proves the SAME thing end-to-end against the live edge — that the host
 * serves the data byte-for-byte, with no CDN transform or stale copy. The host
 * returns index.html with status 200 for a MISSING file, so a MATCH on the
 * hash (not the status code) is the only proof.
 *
 * Reads/writes nothing in data/; it only fetches over the network and hashes
 * the response bytes.
 *
 * Usage (Node 18+, built-in fetch + crypto). The deploy URL is REQUIRED:
 *   node scripts/verify-deploy.mjs <https://your-deploy-url>
 *   npm run deploy-check <https://your-deploy-url>
 *
 * Exit code: 0 only if every file is MATCH; 1 otherwise.
 */

import { createHash } from 'node:crypto';

const rawBase = process.argv[2];
if (!rawBase) {
  console.error(
    'Usage: node scripts/verify-deploy.mjs <https://your-deploy-url>\n' +
      'The deploy URL is required; there is no default.'
  );
  process.exit(1);
}
const base = rawBase.replace(/\/+$/, '');

async function fetchBytes(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const manifestUrl = `${base}/data/manifest.json`;
  console.log(`Deploy base : ${base}`);
  console.log(`Manifest    : ${manifestUrl}`);
  console.log('');

  let manifest;
  try {
    const bytes = await fetchBytes(manifestUrl);
    manifest = JSON.parse(bytes.toString('utf-8'));
  } catch (err) {
    console.error('FAILED to fetch/parse manifest.json:');
    console.error('  ' + (err?.message ?? String(err)));
    process.exit(1);
  }

  const files = manifest?.files ?? {};
  const results = [];
  let allMatch = true;

  for (const [key, meta] of Object.entries(files)) {
    const file = meta?.file;
    const expected = meta?.sha256;
    if (!file || !expected) {
      console.error(`${key}: manifest entry missing file/sha256`);
      allMatch = false;
      continue;
    }
    const url = `${base}/data/${file}`;
    try {
      const bytes = await fetchBytes(url);
      const actual = sha256(bytes);
      const ok = actual === expected;
      if (!ok) allMatch = false;
      results.push({ key, file, expected, ok, bytes: bytes.length });
      console.log(`${ok ? 'MATCH   ' : 'MISMATCH'} ${key.padEnd(10)} ${file} (${bytes.length} bytes)`);
      if (!ok) {
        console.log(`         expected ${expected}`);
        console.log(`         actual   ${actual}`);
      }
    } catch (err) {
      allMatch = false;
      results.push({ key, file, expected, ok: false });
      console.log(`MISMATCH ${key.padEnd(10)} ${file} — fetch failed`);
      console.log('         ' + (err?.message ?? String(err)));
    }
  }

  console.log('\n--- paste into the report ---\n');
  console.log(`### Deploy hash verification — ${nowIso()}`);
  console.log(`- Deploy URL: ${base}`);
  console.log('');
  console.log('| Key | File | Expected SHA-256 | Result |');
  console.log('| --- | --- | --- | --- |');
  for (const r of results) {
    console.log(`| ${r.key} | ${r.file} | \`${r.expected}\` | ${r.ok ? 'MATCH' : 'MISMATCH'} |`);
  }
  console.log(`\n- Overall: ${allMatch ? 'ALL MATCH — safe to promote' : 'MISMATCH PRESENT — do NOT promote'}`);
  console.log('\n--- end ---');

  process.exit(allMatch ? 0 : 1);
}

main().catch((err) => {
  console.error('Unexpected error:', err?.message ?? String(err));
  process.exit(1);
});
