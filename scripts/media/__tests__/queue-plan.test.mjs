import { describe, it, expect } from 'vitest';
import { parseQueue, manifestDriveIds, planRun, summaryTable } from '../queue-plan.mjs';

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

describe('manifestDriveIds', () => {
  it('collects every drive_file_id regardless of status', () => {
    const set = manifestDriveIds([
      { drive_file_id: 'A', status: 'DRAFT – needs reviewer approval' },
      { drive_file_id: 'B', status: 'approved' },
      { key: 'no-id' },
    ]);
    expect([...set].sort()).toEqual(['A', 'B']);
  });
});

describe('planRun', () => {
  const queue = ['A', 'B', 'C', 'D', 'E', 'F'];

  it('skips ids already in the manifest and caps at limit', () => {
    const manifest = [{ drive_file_id: 'B' }, { drive_file_id: 'D' }];
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
    expect(planRun([], [], 5)).toEqual({ toProcess: [], skipped: [], remaining: [] });
  });

  it('all queued already present → all skipped, nothing to process', () => {
    const manifest = queue.map((id) => ({ drive_file_id: id }));
    const plan = planRun(queue, manifest, 5);
    expect(plan.skipped).toEqual(queue);
    expect(plan.toProcess).toEqual([]);
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
