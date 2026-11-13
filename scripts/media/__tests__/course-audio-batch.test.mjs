/**
 * course-audio-batch.test.mjs - contract tests for the run-name, the orphan
 * rule (R2 object without manifest entry) and the batch workflow that reuses
 * course-audio via workflow_call. Text assertions over the committed YAML/sh.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf-8').replace(/\r\n/g, '\n');
const audio = read('.github/workflows/course-audio.yml');
const batch = read('.github/workflows/course-audio-batch.yml');
const one = read('scripts/media/transcode-one.sh');
const loop = read('scripts/media/batch-run.sh');

describe('course-audio.yml', () => {
  it('has a run-name showing list and DRY RUN / REAL', () => {
    expect(audio).toMatch(/^run-name: .*inputs\.list.*DRY RUN.*REAL/m);
  });
  it('is callable and keeps the per-queue concurrency group', () => {
    expect(audio).toMatch(/^ {2}workflow_call:/m);
    expect(audio).toMatch(/^ {2}workflow_dispatch:/m);
    expect(audio).toMatch(/group: course-audio-\$\{\{ inputs\.list \}\}/);
    expect(audio).not.toMatch(/github\.event\.inputs/);
  });
  it('ends red on an orphan, naming the ids', () => {
    expect(audio).toContain('R2 object without manifest entry - needs coordinator');
    expect(audio).toContain('results.orphan.ndjson');
  });
});

describe('orphan handling never deletes or overwrites R2', () => {
  it('transcode-one exits 4 for key-on-R2-without-manifest-entry', () => {
    expect(one).toMatch(/ORPHAN/);
    expect(one).toMatch(/exit 4/);
    expect(one).not.toMatch(/rclone (delete|deletefile|purge|sync)/);
  });
  it('batch-run records exit 4 as orphan', () => {
    expect(loop).toMatch(/-eq 4/);
    expect(loop).toContain('results.orphan.ndjson');
  });
});

describe('course-audio-batch.yml', () => {
  it('matrixes over queues, one at a time, no fail-fast', () => {
    expect(batch).toMatch(/max-parallel: 1/);
    expect(batch).toMatch(/fail-fast: false/);
    expect(batch).toMatch(/fromJSON\(needs\.plan\.outputs\.queues\)/);
  });
  it('defaults limit to 45 and runs REAL via course-audio.yml', () => {
    expect(batch).toMatch(/limit:[\s\S]*?default: "45"/);
    expect(batch).toMatch(/uses: \.\/\.github\/workflows\/course-audio\.yml/);
    // the string 'false' as an expression: course-audio.yml types dry_run as a string, and
    // actionlint rejects a bare YAML "false" there (PART L, 11 Nov). Same value: a REAL run.
    expect(batch).toMatch(/dry_run: \$\{\{ 'false' \}\}/);
  });
  it('copies no audio code', () => {
    expect(batch).not.toMatch(/rclone|ffmpeg|transcode-one/);
  });
});
