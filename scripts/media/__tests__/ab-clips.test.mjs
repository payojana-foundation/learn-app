/**
 * ab-clips.test.mjs — B6: pick_abc writes a complete, private A/B/C→version map
 * (the three versions, each used once). Runs the real ab-clips.sh in its self-
 * test path (AB_SELFTEST=1) with a deterministic $SHUF stub (cat = identity).
 * Skips without bash.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const script = resolve(here, '..', 'ab-clips.sh');

function findBash() {
  if (spawnSync('bash', ['-c', 'exit 0']).status === 0) return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) {
    if (existsSync(p)) return p;
  }
  return null;
}
const BASH = findBash();
const run = BASH ? it : it.skip;

describe('ab-clips.sh pick_abc', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'abc-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  run('writes a complete A/B/C map with each version used exactly once', () => {
    const shuf = join(dir, 'shuf');
    writeFileSync(shuf, '#!/usr/bin/env bash\ncat\n'); // identity order
    chmodSync(shuf, 0o755);
    const r = spawnSync(BASH, [script], {
      cwd: dir,
      env: { ...process.env, AB_SELFTEST: '1', SHUF: shuf },
      encoding: 'utf-8',
    });
    expect(r.status).toBe(0);
    const map = JSON.parse(readFileSync(join(dir, 'abc-order.json'), 'utf-8'));
    expect(Object.keys(map).sort()).toEqual(['A', 'B', 'C']);
    expect(Object.values(map).sort()).toEqual(['b3', 'b3-fixedgain', 'current']);
    // identity shuf → A=current, B=b3, C=b3-fixedgain
    expect(map).toEqual({ A: 'current', B: 'b3', C: 'b3-fixedgain' });
  });
});
