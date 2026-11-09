/**
 * manifest-save.test.mjs - orphan prevention (8 Nov 2026): entry written right
 * after upload, manifest saved after EACH file, and the r2-orphan-cleanup rules.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { planCleanup } from '../orphan-cleanup.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf-8').replace(/\r\n/g, '\n');
const one = read('scripts/media/transcode-one.sh');
const audio = read('.github/workflows/course-audio.yml');
const cleanup = read('.github/workflows/r2-orphan-cleanup.yml');
function findBash() {
  if (spawnSync('bash', ['-c', 'exit 0']).status === 0) return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe']) if (existsSync(p)) return p;
  return null;
}
const BASH = findBash();

describe('manifest entry is saved before anything can orphan the object', () => {
  it('transcode-one writes entry-<id>.json right after rclone copyto, before the size/200/206 checks', () => {
    const up = one.indexOf('stage=rclone-copyto exit=');
    const entry = one.indexOf('"entry-"+a[1]+".json"');
    const size = one.indexOf('FAILED stage=verify: remote size');
    const pub = one.indexOf('verify_on_r2 "$key"; then');
    expect(up).toBeGreaterThan(0);
    expect(entry).toBeGreaterThan(up);
    expect(size).toBeGreaterThan(entry);
    expect(pub).toBeGreaterThan(entry);
  });
  it('course-audio saves after each file (not in a dry run) and at the end', () => {
    expect(audio).toMatch(/SAVE_CMD: \$\{\{ inputs\.dry_run == 'true' && '' \|\| 'bash scripts\/ci\/save-manifest\.sh' \}\}/);
    expect(audio).toMatch(/if: \$\{\{ always\(\) && inputs\.dry_run != 'true' \}\}[\s\S]*push-with-retry\.sh origin main/);
  });
  (BASH ? it : it.skip)('batch-run calls SAVE_CMD after every id, including a failed one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'save-'));
    try {
      writeFileSync(join(dir, 'plan.txt'), 'A\nB\n');
      const stub = join(dir, 'stub.sh');
      writeFileSync(stub, '#!/usr/bin/env bash\n[ "$1" = B ] && exit 1\nexit 0\n');
      const save = join(dir, 'save.sh');
      writeFileSync(save, '#!/usr/bin/env bash\necho saved >> saves.log\n');
      chmodSync(stub, 0o755); chmodSync(save, 0o755);
      spawnSync(BASH, [join(root, 'scripts/media/batch-run.sh'), 'plan.txt'], {
        cwd: dir, env: { ...process.env, TRANSCODE_ONE: stub, SAVE_CMD: save },
      });
      expect(readFileSync(join(dir, 'saves.log'), 'utf-8').trim().split('\n')).toHaveLength(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('planCleanup never touches a key with a manifest entry', () => {
  const k = (n) => `audio/${n.repeat(16)}-a64.mp3`;
  const manifest = [{ drive_file_id: 'HAS', key: k('a') }, { drive_file_id: 'OTHER', key: k('c') }];
  const keys = { HAS: k('a'), ORPH: k('b'), NOOBJ: k('d'), DUP: k('c'), BAD: 'audio/x.mp3' };
  const sizes = { [k('a')]: 5, [k('b')]: 5, [k('c')]: 5 };
  const plan = planCleanup(['HAS', 'ORPH', 'NOOBJ', 'DUP', 'BAD'], manifest, (i) => keys[i], (key) => sizes[key] || 0);
  const act = Object.fromEntries(plan.map((p) => [p.id, p.action]));
  it('deletes only an existing object with no entry by id or key', () => {
    expect(act).toEqual({ HAS: 'has-entry', ORPH: 'delete', NOOBJ: 'no-object', DUP: 'has-entry', BAD: 'no-key' });
  });
});

describe('r2-orphan-cleanup.yml', () => {
  it('is manual, per-queue concurrency, DELETE-gated, no cancel', () => {
    expect(cleanup).toMatch(/^ {2}workflow_dispatch:/m);
    expect(cleanup).toMatch(/group: r2-orphan-cleanup-\$\{\{ inputs\.queue \}\}/);
    expect(cleanup).toMatch(/\[ "\$CONFIRM" = "DELETE" \] && mode=delete/);
    expect(cleanup).toContain('^data/queues/[A-Za-z0-9_.-]+\\.csv$');
  });
});
