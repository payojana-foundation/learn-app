/**
 * data-rebuild.test.mjs — scripts/ci/data-rebuild.mjs (bulk-07 P2), the commit
 * step of .github/workflows/data-rebuild.yml. Real git in a temp repo with a
 * stand-in build command (DATA_REBUILD_CMD), plus one end-to-end run of the
 * workflow's two shell steps (rebuild → push-with-retry.sh) against a local
 * bare "origin". Placeholder file contents only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const fwd = (p) => p.replace(/\\/g, '/');
const SCRIPT = resolve(here, '..', 'ci', 'data-rebuild.mjs');
const PUSH = fwd(resolve(here, '..', 'ci', 'push-with-retry.sh'));
const HAS_GIT = spawnSync('git', ['--version']).status === 0;
function findBash() {
  if (spawnSync('bash', ['-c', 'exit 0']).status === 0) return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) if (existsSync(p)) return p;
  return null;
}
const BASH = findBash();
const runGit = HAS_GIT ? it : it.skip;
const runE2E = HAS_GIT && BASH ? it : it.skip;
const T = 30000; // real git + node child processes: generous on a busy Windows host

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
  PUSH_RETRY_SLEEP: '0',
};
const git = (cwd, ...args) => spawnSync('git', args, { cwd, env: ENV, encoding: 'utf-8' });
const log = (cwd) => git(cwd, 'log', '--format=%s').stdout.trim().split('\n');

/** The stand-in build: copies data/src.txt to public/data/out.txt (like build-courses copies data → public/data). */
const BUILD = `node -e "const f=require('fs');f.mkdirSync('public/data',{recursive:true});f.writeFileSync('public/data/out.txt',f.readFileSync('data/src.txt'))"`;

function rebuild(cwd, extra = {}) {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, env: { ...ENV, DATA_REBUILD_CMD: BUILD, ...extra }, encoding: 'utf-8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

describe('data-rebuild.mjs', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drb-'));
    git(dir, 'init', '-q', '-b', 'main');
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'src.txt'), 'v1\n');
    mkdirSync(join(dir, 'public', 'data'), { recursive: true });
    writeFileSync(join(dir, 'public', 'data', 'out.txt'), 'v1\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'seed');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  runGit('no change → no commit, committed=false', () => {
    const r = rebuild(dir);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/committed=false/);
    expect(log(dir)).toEqual(['seed']);
  }, T);

  runGit('a person edits data/ → one "data: rebuild after <sha>" commit holding only public/data', () => {
    writeFileSync(join(dir, 'data', 'src.txt'), 'v2\n');
    git(dir, 'commit', '-q', '-am', 'person edits data');
    const sha = git(dir, 'rev-parse', '--short=7', 'HEAD').stdout.trim();
    writeFileSync(join(dir, 'unrelated.txt'), 'dirty'); // a stray file must NOT be committed
    const r = rebuild(dir);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/committed=true/);
    expect(log(dir)[0]).toBe(`data: rebuild after ${sha}`);
    const files = git(dir, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n');
    expect(files).toEqual(['public/data/out.txt']);
    expect(git(dir, 'status', '--porcelain').stdout).toMatch(/unrelated\.txt/);
    expect(rebuild(dir).out).toMatch(/committed=false/); // second run: nothing to do
  }, T);

  runGit('a failing build commits nothing and exits 1', () => {
    const r = rebuild(dir, { DATA_REBUILD_CMD: 'node -e "process.exit(3)"' });
    expect(r.status).toBe(1);
    expect(log(dir)).toEqual(['seed']);
  }, T);

  runGit('writes committed=… to $GITHUB_OUTPUT', () => {
    const out = join(dir, 'gh-output.txt');
    writeFileSync(join(dir, 'data', 'src.txt'), 'v3\n');
    git(dir, 'commit', '-q', '-am', 'edit');
    rebuild(dir, { GITHUB_OUTPUT: out });
    expect(readFileSync(out, 'utf-8')).toBe('committed=true\n');
  }, T);

  runE2E('workflow steps end to end: rebuild + push-with-retry lands on origin even after the bot pushed first', () => {
    const d = fwd(dir);
    const bare = `${d}/origin.git`;
    const sh = (cmd, cwd = dir) => spawnSync(BASH, ['-c', cmd], { cwd, env: ENV, encoding: 'utf-8' });
    expect(sh(`git clone -q --bare "${d}" "${bare}"`).status).toBe(0);
    const job = `${d}/job`;
    const bot = `${d}/bot`;
    expect(sh(`git clone -q "${bare}" "${job}" && git clone -q "${bare}" "${bot}"`).status).toBe(0);
    // a person's edit is on origin; the job checked it out
    expect(sh(`cd "${bot}" && echo v2 > data/src.txt && git commit -qam "person edits data" && git push -q origin main`).status).toBe(0);
    expect(sh(`cd "${job}" && git pull -q origin main`).status).toBe(0);
    // meanwhile the course-audio bot pushes an unrelated file
    expect(sh(`cd "${bot}" && echo m > media.txt && git add media.txt && git commit -qm "course-audio: DRAFT" && git push -q origin main`).status).toBe(0);
    // the job: rebuild (commit) then the existing push script
    expect(rebuild(job.replace(/\//g, '\\')).out).toMatch(/committed=true/);
    const p = sh(`cd "${job}" && bash "${PUSH}" origin main`);
    expect(p.status, p.stdout + p.stderr).toBe(0);
    const remote = sh(`git --git-dir="${bare}" log --format=%s main`).stdout.trim().split('\n');
    expect(remote[0]).toMatch(/^data: rebuild after [0-9a-f]{7}$/);
    expect(remote).toContain('course-audio: DRAFT');
    expect(sh(`git --git-dir="${bare}" show main:public/data/out.txt`).stdout).toBe('v2\n');
  }, 60000);
});

describe('data-rebuild.yml', () => {
  const yml = readFileSync(resolve(here, '..', '..', '.github', 'workflows', 'data-rebuild.yml'), 'utf-8');
  const check = readFileSync(resolve(here, '..', '..', '.github', 'workflows', 'data-check.yml'), 'utf-8');
  it('triggers on data/** only, never on public/data (no loop), one run at a time, never force-pushes', () => {
    expect(yml).toMatch(/paths:\s*\n\s*- "data\/\*\*"/);
    expect(yml).not.toMatch(/public\/data\/\*\*"/);
    expect(yml).toMatch(/concurrency:[\s\S]*group: data-rebuild-main[\s\S]*cancel-in-progress: false/);
    expect(yml).toMatch(/startsWith\(github\.event\.head_commit\.message, 'data: rebuild'\)/);
    expect(yml).toMatch(/fetch-depth: 0/);
    expect(yml).toMatch(/npm ci/);
    expect(yml).toMatch(/bash scripts\/ci\/push-with-retry\.sh origin main/);
    expect(yml + check).not.toMatch(/--force|push -f\b|force-with-lease/);
  });
  it('data-check runs after data-rebuild on main, and still on build-script pushes', () => {
    expect(check).toMatch(/workflow_run:\s*\n\s*workflows: \[data-rebuild\]/);
    expect(check).toMatch(/- "scripts\/build-courses\.mjs"/);
    expect(check).not.toMatch(/- "data\/\*\*"/);
  });
  it('data-check pins SOURCE_DATE_EPOCH to the committed catalog stamp (a bot stamp lag is not drift)', () => {
    expect(check).toMatch(/SOURCE_DATE_EPOCH="\$\(node -e .*public\/data\/catalog\.json.*generated/);
    expect(check).toMatch(/export SOURCE_DATE_EPOCH/);
  });
});
