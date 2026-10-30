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
