/**
 * workflow-secrets.test.mjs — assert the media workflows reference the right
 * secrets/vars after the DNS-desk change (28–30 Oct 2026):
 *   - endpoint built from secret R2_ACCOUNT_ID, no R2_ENDPOINT var anywhere;
 *   - course-audio + approve-media use the course-media token
 *     (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY);
 *   - word-audio-upload uses its OWN token
 *     (WORD_AUDIO_R2_ACCESS_KEY_ID / WORD_AUDIO_R2_SECRET_ACCESS_KEY) and
 *     STOPS (never falls back to the course token) when those are absent.
 *
 * These are text/contract assertions over the committed YAML, not a live run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wf = (name) => readFileSync(join(here, '..', '..', '..', '.github', 'workflows', name), 'utf-8');

const wordAudio = wf('word-audio-upload.yml');
const courseAudio = wf('course-audio.yml');
const approveMedia = wf('approve-media.yml');

describe('endpoint is built from R2_ACCOUNT_ID (no R2_ENDPOINT var)', () => {
  it('no workflow references the retired R2_ENDPOINT var (comments aside)', () => {
    for (const src of [wordAudio, courseAudio, approveMedia]) {
      // The var must not be read (`vars.R2_ENDPOINT`) nor expanded as an env
      // value (`${R2_ENDPOINT}`) nor declared as a step env key. A mention in a
      // "# … no R2_ENDPOINT var" comment is fine.
      expect(src).not.toMatch(/vars\.R2_ENDPOINT/);
      expect(src).not.toMatch(/\$\{R2_ENDPOINT\}/);
      expect(src).not.toMatch(/^\s*R2_ENDPOINT:/m);
    }
  });

  it('course-audio + word-audio build the endpoint from the account id secret', () => {
    for (const src of [wordAudio, courseAudio]) {
      expect(src).toMatch(/secrets\.R2_ACCOUNT_ID/);
      expect(src).toMatch(/https:\/\/\$\{R2_ACCOUNT_ID\}\.r2\.cloudflarestorage\.com/);
    }
  });
});

describe('course-audio uses the course-media token', () => {
  it('references R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY', () => {
    expect(courseAudio).toMatch(/secrets\.R2_ACCESS_KEY_ID/);
    expect(courseAudio).toMatch(/secrets\.R2_SECRET_ACCESS_KEY/);
  });
  it('does NOT use the word-audio token', () => {
    expect(courseAudio).not.toMatch(/WORD_AUDIO_R2_/);
  });
});

describe('word-audio uses its OWN token and never falls back', () => {
  it('references the WORD_AUDIO_R2_* secrets', () => {
    expect(wordAudio).toMatch(/secrets\.WORD_AUDIO_R2_ACCESS_KEY_ID/);
    expect(wordAudio).toMatch(/secrets\.WORD_AUDIO_R2_SECRET_ACCESS_KEY/);
  });
  it('does NOT use the course-media token for the rclone config', () => {
    // The course token secrets must not be wired into word-audio at all.
    expect(wordAudio).not.toMatch(/secrets\.R2_ACCESS_KEY_ID/);
    expect(wordAudio).not.toMatch(/secrets\.R2_SECRET_ACCESS_KEY/);
  });
  it('stops with an error when the word-audio secrets are missing', () => {
    // A guard step emits ::error and exits non-zero when either is empty.
    expect(wordAudio).toMatch(/::error title=word-audio R2 token missing/);
    expect(wordAudio).toMatch(/-z "\$\{WORD_AUDIO_R2_ACCESS_KEY_ID\}"/);
  });
});

describe('approve-media needs no R2 token (edits the manifest only)', () => {
  it('references neither R2 token (no bucket access)', () => {
    expect(approveMedia).not.toMatch(/R2_ACCESS_KEY_ID/);
    expect(approveMedia).not.toMatch(/WORD_AUDIO_R2_/);
    expect(approveMedia).not.toMatch(/rclone/);
  });
});
