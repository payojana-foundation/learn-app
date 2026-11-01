/**
 * batch-run.test.mjs — prove the course-audio batch loop actually dispatches
 * every id in the plan (regression: it silently dispatched nothing), logs each
 * id + the transcode script's exit code, and marks any non-zero exit failed.
 *
 * Runs the real scripts/media/batch-run.sh with a fixture plan and a STUB
 * transcode script injected via $TRANSCODE_ONE — no ffmpeg/rclone/Drive needed.
 * Skips on a host without bash (the loop is bash; CI is ubuntu-latest).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const script = resolve(here, '..', 'batch-run.sh');

// Find a bash: on PATH (CI/ubuntu, macOS), else Git-for-Windows' bundled bash.
function findBash() {
  if (spawnSync('bash', ['-c', 'exit 0']).status === 0) return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) {
    if (existsSync(p)) return p;
  }
  return null;
}
const BASH = findBash();
const run = BASH ? it : it.skip;

function runBatch(dir, planText, stubBody) {
  writeFileSync(join(dir, 'to-process.txt'), planText);
  const stub = join(dir, 'stub-transcode.sh');
  writeFileSync(stub, `#!/usr/bin/env bash\n${stubBody}\n`);
  chmodSync(stub, 0o755);
  const stdout = execFileSync(BASH, [script, 'to-process.txt'], {
    cwd: dir,
    env: { ...process.env, TRANSCODE_ONE: stub, MAX_MINUTES: '300' },
    encoding: 'utf-8',
  });
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf-8') : '');
  const lines = (f) => read(f).split(/\r?\n/).filter(Boolean).map(JSON.parse);
  return { stdout, done: lines('results.done.ndjson'), failed: lines('results.failed.ndjson') };
}

describe('batch-run.sh dispatches every planned id', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'batch-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  run('runs the transcode script for BOTH ids (writes entry-<id>.json each)', () => {
    const r = runBatch(dir, 'ID1\nID2\n', 'echo "entry" > "entry-$1.json"; exit 0');
    expect(readdirSync(dir).filter((f) => /^entry-/.test(f)).sort()).toEqual(['entry-ID1.json', 'entry-ID2.json']);
    expect(r.done.map((x) => x.id)).toEqual(['ID1', 'ID2']);
    expect(r.failed).toEqual([]);
    expect(r.stdout).toMatch(/\[ID1\] starting/);
    expect(r.stdout).toMatch(/\[ID2\] starting/);
    expect(r.stdout).toMatch(/\[ID1\] exit 0/);
    expect(r.stdout).toMatch(/batch finished: dispatched 2/);
  });

  run('a non-zero exit counts as failed with the reason captured', () => {
    const r = runBatch(dir, 'OK\nBAD\n', 'if [ "$1" = BAD ]; then echo "boom reason" >&2; exit 7; fi; exit 0');
    expect(r.done.map((x) => x.id)).toEqual(['OK']);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].id).toBe('BAD');
    expect(r.failed[0].reason).toMatch(/exit 7/);
    expect(r.failed[0].reason).toMatch(/boom reason/);
    expect(r.stdout).toMatch(/\[BAD\] exit 7/);
  });

  run('CRLF and surrounding whitespace in the plan do not break dispatch', () => {
    const r = runBatch(dir, '  ID1  \r\nID2\r\n', 'exit 0');
    expect(r.done.map((x) => x.id)).toEqual(['ID1', 'ID2']);
  });
});
