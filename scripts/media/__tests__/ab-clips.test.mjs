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

describe('ab-clips.sh write_order (B6 rev 2)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'abc-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  run('writes two rounds of labels per part, each version used once per round', () => {
    const r = spawnSync(BASH, [script], {
      cwd: dir,
      env: { ...process.env, AB_SELFTEST: '1' },
      encoding: 'utf-8',
    });
    expect(r.status).toBe(0);
    const map = JSON.parse(readFileSync(join(dir, 'abc-order.json'), 'utf-8'));
    expect(Object.keys(map).sort()).toEqual(['part1', 'part4']);
    const p1 = ['current', 'b3', 'b3matched'].sort();
    const p4 = ['b3', 'forced16', 'm18'].sort();
    for (const R of ['R1', 'R2']) {
      expect(Object.keys(map.part1[R]).sort()).toEqual(['A', 'B', 'C']);
      expect(Object.values(map.part1[R]).sort()).toEqual(p1);
      expect(Object.values(map.part4[R]).sort()).toEqual(p4);
    }
  });
});
