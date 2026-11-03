/**
 * transcode-verify.test.mjs — prove transcode-one.sh's verify_on_r2 gate.
 *
 * Regression: a run reported "done" while R2 stayed empty (upload failed
 * silently and nothing verified the object existed). verify_on_r2 must return
 * success ONLY when rclone lsjson shows size > 0 AND curl -I returns 200.
 *
 * Sources the real script with TRANSCODE_ONE_LIB=1 (defines functions, runs no
 * transcode) and injects stub rclone/curl via $RCLONE/$CURL. Skips without bash.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const script = resolve(here, '..', 'transcode-one.sh');

function findBash() {
  if (spawnSync('bash', ['-c', 'exit 0']).status === 0) return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe']) {
    if (existsSync(p)) return p;
  }
  return null;
}
const BASH = findBash();
const run = BASH ? it : it.skip;

/** Stub rclone: `lsjson <remote>` prints a JSON array with the given Size. */
function rcloneStub(size) {
  return `#!/usr/bin/env bash\nif [ "$1" = lsjson ]; then echo '[{"Size":${size}}]'; fi\nexit 0\n`;
}
/** Stub curl: -w '%{http_code}' prints the given code. */
function curlStub(code) {
  return `#!/usr/bin/env bash\nprintf '%s' "${code}"\nexit 0\n`;
}

function runVerify(dir, { size, http }, key = 'audio/ID-a64.mp3') {
  const rclone = join(dir, 'rclone');
  const curl = join(dir, 'curl');
  writeFileSync(rclone, rcloneStub(size));
  writeFileSync(curl, curlStub(http));
  chmodSync(rclone, 0o755);
  chmodSync(curl, 0o755);
  const r = spawnSync(
    BASH,
    ['-c', `source "${script}"; verify_on_r2 "${key}"`],
    {
      cwd: dir,
      env: { ...process.env, TRANSCODE_ONE_LIB: '1', RCLONE: rclone, CURL: curl, MEDIA_BASE_URL: 'https://media.example' },
      encoding: 'utf-8',
    }
  );
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

describe('transcode-one.sh verify_on_r2', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'verify-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  run('passes when R2 size > 0 AND public URL is 200', () => {
    const r = runVerify(dir, { size: 12055126, http: 200 });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/size=12055126/);
    expect(r.out).toMatch(/HTTP 200/);
  });

  run('fails when the object is missing/empty (size 0)', () => {
    const r = runVerify(dir, { size: 0, http: 200 });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/missing or empty/);
  });

  run('fails when the public URL is not 200 (e.g. 404)', () => {
    const r = runVerify(dir, { size: 999, http: 404 });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/did not return 200/);
  });
});
