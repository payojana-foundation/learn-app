/**
 * workflow-secrets.test.mjs — assert the media workflows reference the right
 * secrets/vars after the DNS-desk change (28–30 Oct 2026) and the 30 Oct move
 * of the word-audio job to its own repo (payojana-foundation/word-audio-pipeline):
 *   - endpoint built from secret R2_ACCOUNT_ID, no R2_ENDPOINT var anywhere;
 *   - course-audio uses the course-media token
 *     (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) and NEVER the word-audio token;
 *   - approve-media touches no R2 token (edits the manifest only).
 *
 * learn-app no longer contains a word-audio workflow; word audio is read-only
 * here, over https://audio.84000.digital.
 *
 * These are text/contract assertions over the committed YAML, not a live run.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wfDir = join(here, '..', '..', '..', '.github', 'workflows');
const wf = (name) => readFileSync(join(wfDir, name), 'utf-8');

const courseAudio = wf('course-audio.yml');
const approveMedia = wf('approve-media.yml');

describe('the word-audio workflow no longer lives in learn-app', () => {
  it('has no word-audio-upload.yml (moved to word-audio-pipeline)', () => {
    expect(existsSync(join(wfDir, 'word-audio-upload.yml'))).toBe(false);
  });
});

describe('endpoint is built from R2_ACCOUNT_ID (no R2_ENDPOINT var)', () => {
  it('no workflow references the retired R2_ENDPOINT var (comments aside)', () => {
    for (const src of [courseAudio, approveMedia]) {
      // The var must not be read (`vars.R2_ENDPOINT`) nor expanded as an env
      // value (`${R2_ENDPOINT}`) nor declared as a step env key. A mention in a
      // "# … no R2_ENDPOINT var" comment is fine.
      expect(src).not.toMatch(/vars\.R2_ENDPOINT/);
      expect(src).not.toMatch(/\$\{R2_ENDPOINT\}/);
      expect(src).not.toMatch(/^\s*R2_ENDPOINT:/m);
    }
  });

  it('course-audio builds the endpoint from the account id secret', () => {
    expect(courseAudio).toMatch(/secrets\.R2_ACCOUNT_ID/);
    expect(courseAudio).toMatch(/https:\/\/\$\{R2_ACCOUNT_ID\}\.r2\.cloudflarestorage\.com/);
  });
});

describe('course-audio uses the course-media token', () => {
  it('references R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY', () => {
    expect(courseAudio).toMatch(/secrets\.R2_ACCESS_KEY_ID/);
    expect(courseAudio).toMatch(/secrets\.R2_SECRET_ACCESS_KEY/);
  });
  it('does NOT use the word-audio token (that job moved out of this repo)', () => {
    expect(courseAudio).not.toMatch(/WORD_AUDIO_R2_/);
  });
});

describe('approve-media needs no R2 token (edits the manifest only)', () => {
  it('references neither R2 token (no bucket access)', () => {
    expect(approveMedia).not.toMatch(/R2_ACCESS_KEY_ID/);
    expect(approveMedia).not.toMatch(/WORD_AUDIO_R2_/);
    expect(approveMedia).not.toMatch(/rclone/);
  });
});

/**
 * if:-reference integrity — every `steps.<id>.outputs.<name>` used in an `if:`
 * must name a step that exists AND an output that step writes to $GITHUB_OUTPUT.
 * This is the regression guard for the course-audio bug where the transcode
 * step gated on a plan file that never existed at if:-eval time.
 */
function stepIds(src) {
  return new Set([...src.matchAll(/^\s*id:\s*([A-Za-z0-9_-]+)\s*$/gm)].map((m) => m[1]));
}
// Outputs a step writes, scoped to the block after its `id:` line.
function outputsById(src, id) {
  const start = src.indexOf(`id: ${id}`);
  const next = src.indexOf('\n      - name:', start + 1);
  const block = src.slice(start, next === -1 ? undefined : next);
  return new Set([...block.matchAll(/([A-Za-z0-9_-]+)=[^\n]*>>\s*"\$GITHUB_OUTPUT"/g)].map((m) => m[1]));
}
function ifRefs(src) {
  return [...src.matchAll(/if:[^\n]*steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g)].map(
    (m) => ({ id: m[1], name: m[2] }),
  );
}

describe.each([
  ['course-audio.yml', courseAudio],
  ['approve-media.yml', approveMedia],
])('%s: every if: step-output reference resolves', (_name, src) => {
  const ids = stepIds(src);
  const refs = ifRefs(src);
  it('references an existing step id and an output that step writes', () => {
    for (const { id, name } of refs) {
      expect(ids.has(id), `if: references unknown step id "${id}"`).toBe(true);
      expect(outputsById(src, id).has(name), `step "${id}" never writes output "${name}"`).toBe(true);
    }
  });
});

describe('course-audio.yml: the transcode gate uses the plan output (not hashFiles)', () => {
  it('gates transcode on steps.plan.outputs.to_process', () => {
    expect(courseAudio).toMatch(/if:\s*\$\{\{\s*steps\.plan\.outputs\.to_process/);
    expect(courseAudio).not.toMatch(/hashFiles\('to-process\.txt'\)/);
  });
});
