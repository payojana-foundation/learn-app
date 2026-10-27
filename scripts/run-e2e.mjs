/**
 * scripts/run-e2e.mjs — one-command e2e runner.
 *
 * Does, in order:
 *   1. `npm run build`
 *   2. starts `npm run preview -- --port 4321 --strictPort`
 *   3. waits until http://localhost:4321/ answers
 *   4. runs every e2e/*.e2e.mjs in turn, with E2E_PORT=4321 so they all target
 *      this one server
 *   5. ALWAYS stops the preview server (even on failure / Ctrl-C)
 *   6. exits non-zero if the build, the server, or ANY e2e script failed
 *
 * Node built-ins + the existing `playwright` (used by the e2e scripts
 * themselves). Works in Windows PowerShell 5.1 — child processes use
 * shell:true, and the preview tree is killed with taskkill /T on Windows.
 */

import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 4321;
const BASE = `http://localhost:${PORT}/`;
const isWindows = process.platform === 'win32';

/** Run a command to completion; resolve with its exit code (never rejects). */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: true, ...opts });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`[e2e] failed to spawn ${cmd}: ${err.message}`);
      resolve(1);
    });
  });
}

/** Kill a process (and its children on Windows) as reliably as possible. */
function killTree(child) {
  if (!child || child.killed || child.pid == null) return;
  try {
    if (isWindows) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  } catch (err) {
    console.error(`[e2e] could not stop preview: ${err?.message ?? err}`);
  }
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  console.log('[e2e] building…');
  const buildCode = await run('npm', ['run', 'build']);
  if (buildCode !== 0) {
    console.error('[e2e] build failed');
    process.exit(1);
  }

  const e2eDir = join(root, 'e2e');
  if (!existsSync(e2eDir)) {
    console.log('[e2e] no e2e/ directory yet — build passed, nothing to run.');
    process.exit(0);
  }
  const scripts = readdirSync(e2eDir)
    .filter((f) => f.endsWith('.e2e.mjs'))
    .sort();
  if (scripts.length === 0) {
    console.log('[e2e] no e2e/*.e2e.mjs scripts yet — build passed, nothing to run.');
    process.exit(0);
  }

  console.log(`[e2e] starting preview on ${BASE} …`);
  const preview = spawn(
    'npm',
    ['run', 'preview', '--', '--port', String(PORT), '--strictPort'],
    { cwd: root, shell: true, detached: !isWindows, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  preview.stdout?.on('data', (d) => process.stdout.write(`[preview] ${d}`));
  preview.stderr?.on('data', (d) => process.stderr.write(`[preview] ${d}`));

  let exitCode = 0;
  const results = [];
  const cleanup = () => killTree(preview);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  try {
    const up = await waitForServer();
    if (!up) {
      console.error(`[e2e] preview did not become reachable at ${BASE}`);
      cleanup();
      process.exit(1);
    }
    console.log('[e2e] preview is up');

    for (const s of scripts) {
      console.log(`\n[e2e] ── running ${s} ──`);
      const code = await run('node', [join('e2e', s)], {
        env: { ...process.env, E2E_PORT: String(PORT) },
      });
      results.push({ s, code });
      if (code !== 0) exitCode = 1;
    }
  } finally {
    cleanup();
  }

  console.log('\n[e2e] ── summary ──');
  for (const { s, code } of results) console.log(`  ${code === 0 ? 'PASS' : 'FAIL'}  ${s}`);
  if (exitCode !== 0) console.error('[e2e] one or more e2e scripts FAILED');
  else console.log('[e2e] all e2e scripts passed');
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[e2e] runner error:', err);
  process.exit(1);
});
