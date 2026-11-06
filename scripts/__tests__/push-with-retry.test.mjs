/**
 * push-with-retry.test.mjs — scripts/ci/push-with-retry.sh (course-audio manifest
 * commit + sheets-inventory). Real git against a local bare "origin":
 *  - another job pushed first → pull --rebase makes our push land;
 *  - the remote keeps rejecting → exit non-zero (the job fails loudly) after 3 tries.
 * Skips on a host without bash/git.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const fwd = (p) => p.replace(/\\/g, '/');
const script = fwd(resolve(here, '..', 'ci', 'push-with-retry.sh'));

function findBash() {
  if (spawnSync('bash', ['-c', 'exit 0']).status === 0) return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) {
    if (existsSync(p)) return p;
  }
  return null;
}
const BASH = findBash();
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const run = BASH && HAS_GIT ? it : it.skip;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
  PUSH_RETRY_SLEEP: '0',
};

describe('push-with-retry.sh', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pwr-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function sh(cmd, cwd = dir) {
    const r = spawnSync(BASH, ['-c', cmd], { cwd, env: { ...process.env, ...GIT_ENV }, encoding: 'utf-8' });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
  }

  /** origin.git (bare, main) seeded with one commit; clones a (our job) and b (the other job). */
  function setup() {
    const d = fwd(dir);
    const r = sh(`
      set -e
      git init -q --bare origin.git
      git --git-dir=origin.git symbolic-ref HEAD refs/heads/main
      git clone -q origin.git seed 2>/dev/null
      cd seed && git checkout -q -b main && echo base > f.txt && git add f.txt && git commit -q -m base && git push -q origin main
      cd ..
      git clone -q origin.git a && git clone -q origin.git b
    `);
    expect(r.status).toBe(0);
    return d;
  }

  run('lands our commit after another job pushed first (pull --rebase, then push)', () => {
    setup();
    // The other job pushes a DIFFERENT file first → our plain push would be rejected.
    expect(sh('echo other > other.txt && git add other.txt && git commit -q -m other && git push -q origin HEAD:main', join(dir, 'b')).status).toBe(0);
    // Our job commits and uses the script.
    expect(sh('echo mine > mine.txt && git add mine.txt && git commit -q -m mine', join(dir, 'a')).status).toBe(0);
    const plain = sh('git push origin HEAD:main', join(dir, 'a'));
    expect(plain.status).not.toBe(0); // proves the race is real

    const r = sh(`bash "${script}" origin main`, join(dir, 'a'));
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/pushed to origin\/main/);
    const log = sh('git --git-dir=origin.git log --format=%s main').out.trim().split(/\r?\n/);
    expect(log).toEqual(expect.arrayContaining(['mine', 'other', 'base']));
  });

  run('an unstaged tracked-file change (e.g. chmod +x) does not block the push', () => {
    setup();
    expect(sh('echo other > other.txt && git add other.txt && git commit -q -m other && git push -q origin HEAD:main', join(dir, 'b')).status).toBe(0);
    expect(sh('echo mine > mine.txt && git add mine.txt && git commit -q -m mine', join(dir, 'a')).status).toBe(0);
    // dirty tree, like the workflow's `chmod +x` on a 100644 file
    expect(sh('echo dirty >> f.txt', join(dir, 'a')).status).toBe(0);

    const r = sh(`bash "${script}" origin main`, join(dir, 'a'));
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/pushed to origin\/main/);
    expect(readFileSync(join(dir, 'a', 'f.txt'), 'utf-8')).toMatch(/dirty/); // edit preserved
    const log = sh('git --git-dir=origin.git log --format=%s main').out.trim().split(/\r?\n/);
    expect(log).toContain('mine');
  });

  run('a remote that keeps rejecting → non-zero exit after 3 attempts, loud error', () => {
    setup();
    writeFileSync(join(dir, 'origin.git', 'hooks', 'pre-receive'), '#!/bin/sh\necho "rejected by hook" >&2\nexit 1\n', { mode: 0o755 });
    expect(sh('echo mine > mine.txt && git add mine.txt && git commit -q -m mine', join(dir, 'a')).status).toBe(0);

    const r = sh(`bash "${script}" origin main`, join(dir, 'a'));
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/push attempt 1\/3/);
    expect(r.out).toMatch(/push attempt 3\/3/);
    expect(r.out).toMatch(/::error title=Push failed::/);
    expect(r.out).not.toMatch(/pushed to origin\/main/);
    // the commit really did not land
    const log = sh('git --git-dir=origin.git log --format=%s main').out.trim().split(/\r?\n/);
    expect(log).not.toContain('mine');
  });

  run('both workflows call the script and the failed push is not swallowed', () => {
    const root = resolve(here, '..', '..');
    const ca = readFileSync(join(root, '.github', 'workflows', 'course-audio.yml'), 'utf-8');
    const si = readFileSync(join(root, '.github', 'workflows', 'sheets-inventory.yml'), 'utf-8');
    expect(ca).toMatch(/push-with-retry\.sh origin main \|\| exit 1/);
    expect(si).toMatch(/push-with-retry\.sh origin main/);
    expect(ca).not.toMatch(/git push origin HEAD:main/);
    expect(si).not.toMatch(/git push origin HEAD:main/);
  });
});
