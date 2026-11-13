import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { allPassingIds } from '../approve-manifest.mjs';

// Placeholder ids only.
const DRAFT = 'DRAFT – needs reviewer approval';
const e = (id, o = {}) => ({ drive_file_id: id, key: `audio/${id}.mp3`, sha256: `sha-${id}`, status: DRAFT, ...o });
const manifest = [e('pass1'), e('pass2'), e('flag1'), e('pend1'), e('changed', { sha256: 'new' }), e('done', { status: 'approved' })];
const precheck = {
  results: {
    pass: [{ id: 'pass1', sha256: 'sha-pass1' }, { id: 'pass2', sha256: 'sha-pass2' }, { id: 'changed', sha256: 'sha-changed' }, { id: 'done', sha256: 'sha-done' }, { id: 'gone', sha256: 'x' }],
    flagged: [{ id: 'flag1', reasons: ['duration 1:00 is under 5 min'] }],
    pending: [{ id: 'pend1', checks: ['silence'] }],
  },
};

describe('allPassingIds', () => {
  const { ids, skipped } = allPassingIds(manifest, precheck);
  it('approves only passing, unapproved lessons whose audio is the one that was checked', () => {
    expect(ids).toEqual(['pass1', 'pass2']);
  });
  it('never a flagged or not-yet-checked lesson; reports why the rest are left out', () => {
    expect(ids).not.toContain('flag1');
    expect(ids).not.toContain('pend1');
    expect(skipped).toEqual({ flagged: ['flag1'], pending: ['pend1'], changed: ['changed'], approved: ['done'], notFound: ['gone'] });
  });
  it('an id both passing and flagged is not approved', () => {
    const p = { results: { pass: [{ id: 'pass1', sha256: 'sha-pass1' }], flagged: [{ id: 'pass1', reasons: ['x'] }], pending: [] } };
    expect(allPassingIds(manifest, p).ids).toEqual([]);
  });
  it('an empty or missing check gives nothing to approve', () => {
    expect(allPassingIds(manifest, {}).ids).toEqual([]);
    expect(allPassingIds(manifest, null).ids).toEqual([]);
  });
});

describe('CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ap-'));
  const mPath = join(dir, 'm.json');
  const pPath = join(dir, 'p.json');
  const cli = (...a) => execFileSync('node', ['scripts/media/approve-manifest.mjs', ...a], { encoding: 'utf-8' });
  const reset = () => { writeFileSync(mPath, JSON.stringify(manifest)); writeFileSync(pPath, JSON.stringify(precheck)); };
  it('all-passing --dry-run lists what it would approve and changes nothing', () => {
    reset();
    const before = readFileSync(mPath, 'utf-8');
    const out = cli(mPath, 'all-passing', 'Reviewer', pPath, '--dry-run');
    expect(out).toContain('would approve (2): pass1, pass2');
    expect(out).toContain('APPLIED_COUNT=0');
    expect(readFileSync(mPath, 'utf-8')).toBe(before);
  });
  it('all-passing approves them with the reviewer name; the others stay DRAFT', () => {
    reset();
    const out = cli(mPath, 'all-passing', 'Reviewer', pPath);
    expect(out).toContain('APPLIED_COUNT=2');
    const m = JSON.parse(readFileSync(mPath, 'utf-8'));
    const st = Object.fromEntries(m.map((x) => [x.drive_file_id, [x.status, x.reviewer]]));
    expect(st.pass1).toEqual(['approved', 'Reviewer']);
    expect(st.pass2).toEqual(['approved', 'Reviewer']);
    expect(st.flag1[0]).toBe(DRAFT);
    expect(st.pend1[0]).toBe(DRAFT);
    expect(st.changed[0]).toBe(DRAFT);
  });
  it('per-id mode is unchanged; its dry run writes nothing', () => {
    reset();
    const before = readFileSync(mPath, 'utf-8');
    const dry = cli(mPath, 'approved', 'R', 'flag1', '--dry-run');
    expect(dry).toContain('applied (1): flag1');
    expect(readFileSync(mPath, 'utf-8')).toBe(before);
    cli(mPath, 'approved', 'R', 'flag1');
    expect(JSON.parse(readFileSync(mPath, 'utf-8')).find((x) => x.drive_file_id === 'flag1').status).toBe('approved');
  });
});

describe('approve-media.yml', () => {
  const wf = readFileSync('.github/workflows/approve-media.yml', 'utf-8');
  it('has mode (per-ids default) and dry_run (false default); ids are optional', () => {
    expect(wf).toMatch(/mode:\n\s+description: "per-ids[^\n]*\n\s+required: true\n\s+type: choice\n\s+options:\n\s+- per-ids\n\s+- all-passing\n\s+default: per-ids/);
    expect(wf).toMatch(/dry_run:\n[\s\S]*?default: "false"/);
    expect(wf).toMatch(/drive_file_ids:\n\s+description: [^\n]*\n\s+required: false/);
  });
  it('all-passing uses precheck.json and refuses a reject; a dry run skips the commit', () => {
    expect(wf).toContain('all-passing "$REVIEWER" data/queues/approve/precheck.json $DRY');
    expect(wf).toContain('mode all-passing only approves');
    expect(wf).toMatch(/- name: Commit the decision to main\n\s+if: \$\{\{ github\.event\.inputs\.dry_run != 'true' \}\}/);
  });
});
