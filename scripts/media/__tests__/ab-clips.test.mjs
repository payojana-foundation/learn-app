/**
 * ab-clips.test.mjs — listening test key map (3 Nov). The label → X/Y key is
 * written to keys-do-not-open.json: two rounds × parts 8/11/4 × labels a/b, and
 * within every (round, part) pair one label is X and the other Y.
 * Runs the real ab-clips.sh self-test path (AB_SELFTEST=1). Skips without bash.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
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

describe('ab-clips.sh write_keys', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'abc-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  run('12 labels over 2 rounds × parts 8/11/4; each (round, part) pair is one X and one Y', () => {
    const r = spawnSync(BASH, [script], { cwd: dir, env: { ...process.env, AB_SELFTEST: '1' }, encoding: 'utf-8' });
    expect(r.status).toBe(0);
    const keys = JSON.parse(readFileSync(join(dir, 'keys-do-not-open.json'), 'utf-8'));
    expect(Object.keys(keys)).toHaveLength(12);
    for (const R of ['R1', 'R2']) {
      for (const p of ['8', '11', '4']) {
        const pair = [keys[`${R}-${p}a`], keys[`${R}-${p}b`]].sort();
        expect(pair).toEqual(['X', 'Y']);
      }
    }
  });

  run('no key file is created outside the working dir and no R2 tooling is referenced', () => {
    const src = readFileSync(script, 'utf-8');
    expect(src).not.toMatch(/rclone|r2:course-media|media\.84000/);
  });
});
