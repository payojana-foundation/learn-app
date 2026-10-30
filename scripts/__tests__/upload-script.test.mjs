/**
 * upload-script.test.mjs — assert the `npm run upload` helper is a pointer, not
 * an uploader. Course audio is transcoded/uploaded ONLY in GitHub Actions (the
 * course-audio workflow); the local script must do nothing but print where to
 * run it.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

const EXPECTED = 'Uploads run in GitHub Actions \u2192 course-audio \u2192 Run workflow';

describe('npm run upload', () => {
  it('is defined in package.json', () => {
    expect(pkg.scripts.upload).toBeTruthy();
  });

  it('only prints the GitHub Actions pointer (never uploads)', () => {
    // The script is a single `node -e "..."` invocation. Execute that exact
    // node program (not npm, to stay cross-platform and avoid a .cmd shell).
    const cmd = String(pkg.scripts.upload);
    const m = /^node\s+-e\s+(['"])([\s\S]*)\1\s*$/.exec(cmd.trim());
    expect(m, `upload script is not a plain \`node -e\`: ${cmd}`).toBeTruthy();
    const program = m[2];
    const out = execFileSync(process.execPath, ['-e', program], {
      cwd: root,
      encoding: 'utf-8',
    }).trim();
    expect(out).toBe(EXPECTED);
  });

  it('does not invoke rclone, curl, ffmpeg, or any network/transcode tool', () => {
    const cmd = String(pkg.scripts.upload);
    expect(cmd).not.toMatch(/rclone|curl|aws|wget|fetch|ffmpeg|ffprobe/i);
  });
});
