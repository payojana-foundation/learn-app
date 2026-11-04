import { describe, it, expect } from 'vitest';
import { parseQueue, manifestDriveIds, planRun, summaryTable, isB2Key, checkQueue } from '../queue-plan.mjs';

describe('parseQueue', () => {
  it('parses ids, ignoring header, blanks, comments, and dedupes', () => {
    const ids = parseQueue('drive_file_id\nID1\n\n# a comment\nID2\nID1\nID3,extra\n');
    expect(ids).toEqual(['ID1', 'ID2', 'ID3']);
  });
  it('an empty queue yields nothing', () => {
    expect(parseQueue('')).toEqual([]);
    expect(parseQueue('drive_file_id\n')).toEqual([]);
  });
});

describe('isB2Key', () => {
  it('matches audio/<16hex>-a64[.-vN].mp3 only', () => {
    expect(isB2Key('audio/0123456789abcdef-a64.mp3')).toBe(true);
    expect(isB2Key('audio/0123456789abcdef-a64-v2.mp3')).toBe(true);
    expect(isB2Key('audio/1EyF4VvMVm5RquR6-a64.mp3')).toBe(false); // legacy drive-id key
    expect(isB2Key('audio/0123456789abcde-a64.mp3')).toBe(false); // 15 hex
  });
});

describe('manifestDriveIds (bug-4: only B2 md5 keys count as "already done")', () => {
  it('counts an id with a B2 md5 key; ignores a legacy drive-id key', () => {
    const set = manifestDriveIds([
      { drive_file_id: 'A', key: 'audio/0123456789abcdef-a64.mp3', status: 'approved' }, // B2 → counted
      { drive_file_id: 'OLD', key: 'audio/OLD-a64.mp3', status: 'approved' },             // legacy → NOT counted
      { drive_file_id: 'NOKEY' },                                                          // no key → NOT counted
    ]);
    expect([...set].sort()).toEqual(['A']);
  });
});

describe('planRun', () => {
  const queue = ['A', 'B', 'C', 'D', 'E', 'F'];

  // "present" now means the id has a B2 md5 key (bug-4); a fake 16-hex key stands in.
  const b2 = (id, hex) => ({ drive_file_id: id, key: `audio/${hex}-a64.mp3` });

  it('skips ids already in the manifest (with a B2 key) and caps at limit', () => {
    const manifest = [b2('B', '00000000000000b0'), b2('D', '00000000000000d0')];
    const plan = planRun(queue, manifest, 2);
    expect(plan.skipped).toEqual(['B', 'D']);
    expect(plan.toProcess).toEqual(['A', 'C']); // first 2 not already present
    expect(plan.remaining).toEqual(['E', 'F']); // left for the next run
  });

  it('defaults to limit 5 when limit is missing or invalid', () => {
    const plan = planRun(queue, [], 0);
    expect(plan.toProcess).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(plan.remaining).toEqual(['F']);
  });

  it('empty queue → empty plan (nothing to do)', () => {
    expect(planRun([], [], 5)).toEqual({ toProcess: [], skipped: [], remaining: [], force: [] });
  });

  it('all queued already present (B2 keys) → all skipped, nothing to process', () => {
    const manifest = queue.map((id, i) => b2(id, String(i).padStart(16, '0')));
    const plan = planRun(queue, manifest, 5);
    expect(plan.skipped).toEqual(queue);
    expect(plan.toProcess).toEqual([]);
  });

  it('bug-4: an id present only with a LEGACY drive-id key is NOT skipped (re-processed)', () => {
    const manifest = [{ drive_file_id: 'B', key: 'audio/B-a64.mp3' }];
    const plan = planRun(queue, manifest, 2);
    expect(plan.toProcess).toContain('B');
    expect(plan.skipped).not.toContain('B');
  });

  it('force_ids: an already-present id is re-processed, not skipped', () => {
    const manifest = [{ drive_file_id: 'B' }];
    const plan = planRun(queue, manifest, 5, ['B']);
    expect(plan.toProcess).toContain('B');
    expect(plan.skipped).not.toContain('B');
    expect(plan.force).toEqual(['B']);
  });

  it('force_ids: an id not in the queue is still processed (prepended)', () => {
    const plan = planRun(['A'], [{ drive_file_id: 'Z' }], 5, ['Z']);
    expect(plan.toProcess).toEqual(['Z', 'A']);
  });
});

describe('summaryTable', () => {
  it('renders a markdown table with a count line', () => {
    const md = summaryTable([
      { id: 'A', status: 'done' },
      { id: 'B', status: 'skipped', reason: 'already in manifest' },
      { id: 'C', status: 'failed', reason: 'ffprobe: no audio' },
    ]);
    expect(md).toMatch(/\| drive_file_id \| status \| reason \|/);
    expect(md).toMatch(/\| A \| done \|  \|/);
    expect(md).toMatch(/\| C \| failed \| ffprobe: no audio \|/);
    expect(md).toMatch(/done 1 · skipped 1 · failed 1/);
  });
});

describe('checkQueue (missing/empty queue must fail loudly)', () => {
  it('a missing queue file → clear error naming the path and the data/ hint', () => {
    const e = checkQueue('audio-queue.pilot.csv', null);
    expect(e).toMatch(/audio-queue\.pilot\.csv/);
    expect(e).toMatch(/not found/);
    expect(e).toMatch(/data\//);
  });
  it('an empty queue (header only / blank) → error', () => {
    expect(checkQueue('q.csv', 'drive_file_id\n')).toMatch(/no drive_file_ids/);
    expect(checkQueue('q.csv', '')).toMatch(/no drive_file_ids/);
  });
  it('a queue with ids is fine; an empty queue is allowed only with force ids', () => {
    expect(checkQueue('q.csv', 'drive_file_id\nA\n')).toBeNull();
    expect(checkQueue('q.csv', '', ['A'])).toBeNull();
  });
});
