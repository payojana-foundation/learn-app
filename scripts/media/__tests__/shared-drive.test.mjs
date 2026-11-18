/**
 * PART 7b (18 Nov) — every Drive API call works for files in a Shared Drive: files.get and
 * downloads set supportsAllDrives=true; listings also includeItemsFromAllDrives=true.
 * (files.export takes neither parameter.) Scans the committed scripts and workflows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === '__tests__') continue;
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(mjs|js|sh|yml)$/.test(f)) out.push(p);
  }
  return out;
}
const calls = [];
for (const p of [...files('scripts'), ...files('.github/workflows')]) {
  readFileSync(p, 'utf-8').split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(/googleapis\.com\/drive\/v3\/files[^\s"'`]*/g)) calls.push({ where: `${p}:${i + 1}`, url: m[0] });
  });
}

import { lessonFileIds, pickFile } from '../shared-drive-check.mjs';

describe('shared-drive-check picks a lesson file', () => {
  const ID = (c) => c.repeat(28);
  it('prefers an audio/video file a lesson links to', () => {
    const linked = lessonFileIds([{ mp3_link: `https://drive.google.com/file/d/${ID('b')}/view`, mp4_link: '', minicourse_link: '' }]);
    expect([...linked]).toEqual([ID('b')]);
    const files = [{ id: ID('a'), mimeType: 'audio/mpeg' }, { id: ID('b'), mimeType: 'video/mp4' }, { id: ID('c'), mimeType: 'application/pdf' }];
    expect(pickFile(files, linked).id).toBe(ID('b'));
    expect(pickFile(files, new Set()).id).toBe(ID('a'));
    expect(pickFile([{ id: 'x', mimeType: 'text/plain' }], new Set())).toBe(null);
  });
});

describe('Shared Drive: every Drive API call', () => {
  it('finds the calls (scanner works)', () => {
    expect(calls.length).toBeGreaterThanOrEqual(12);
  });
  it('files.get / download / duration lookup set supportsAllDrives=true', () => {
    const bad = calls.filter((c) => !/\/export\b/.test(c.url) && !c.url.includes('supportsAllDrives=true'));
    expect(bad).toEqual([]);
  });
  it('listings also set includeItemsFromAllDrives=true', () => {
    const lists = calls.filter((c) => /\/files\?/.test(c.url));
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.filter((c) => !c.url.includes('includeItemsFromAllDrives=true'))).toEqual([]);
  });
});

describe('shared-drive-check workflow', () => {
  it('a failed find stops the run (pipefail), so the pipeline step never runs with an empty id', () => {
    const y = readFileSync('.github/workflows/shared-drive-check.yml', 'utf-8');
    expect(y).toMatch(/set -euo pipefail\n\s+node scripts\/media\/shared-drive-check\.mjs/);
  });
});
