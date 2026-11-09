#!/usr/bin/env node
/**
 * scripts/ci/data-rebuild.mjs — rebuild public/data/ and commit it if it changed
 * (bulk-07 P2). Used by .github/workflows/data-rebuild.yml after a person edits
 * data/*.json on GitHub. It does NOT push: the workflow then runs the existing
 * scripts/ci/push-with-retry.sh.
 *
 * Steps:
 *   1. run the build (default `npm run build-courses`; env DATA_REBUILD_CMD
 *      overrides it, for tests)
 *   2. stage ONLY public/data/ (any other dirty file is left alone)
 *   3. nothing staged → print "data-rebuild: no change" and exit 0
 *      otherwise commit "data: rebuild after <short sha of the source commit>"
 *
 * Exit codes: 0 = done (committed or nothing to do), 1 = build failed or git
 * error. Prints `committed=true|false` for the workflow ($GITHUB_OUTPUT if set).
 * Never pushes, never force-anything, never touches data/ sources.
 */

import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const cwd = process.cwd();
const sh = (cmd, opts = {}) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });

function output(committed) {
  const line = `committed=${committed}`;
  console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line + '\n');
}

function main() {
  const source = (process.env.DATA_REBUILD_SOURCE_SHA || sh('git rev-parse HEAD')).trim().slice(0, 7);
  const build = process.env.DATA_REBUILD_CMD || 'npm run build-courses';
  try {
    execSync(build, { cwd, stdio: 'inherit' });
  } catch {
    console.error('::error title=data rebuild::the build failed; nothing was committed.');
    process.exit(1);
  }
  sh('git add -A -- public/data');
  let staged = true;
  try {
    sh('git diff --cached --quiet -- public/data');
    staged = false;
  } catch {
    staged = true; // non-zero exit = there are staged changes
  }
  if (!staged) {
    console.log('data-rebuild: no change');
    output(false);
    return;
  }
  const msg = `data: rebuild after ${source}`;
  sh(`git commit -m "${msg}" -- public/data`);
  console.log(`data-rebuild: ${msg}`);
  output(true);
}

main();
