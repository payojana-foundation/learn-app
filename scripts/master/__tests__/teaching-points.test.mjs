/** Bulk 10 P2b — master "Teaching points" tab (fake Sheets API; placeholders). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ensureTab, assignIds } from '../teaching-points.mjs';

const schema = JSON.parse(readFileSync('data/master/teaching-points.json', 'utf-8'));
const KEYS = schema.columns.map((c) => c.key);
const SA = 'sa@example.iam.gserviceaccount.com';

function fake(tabs) {
  const calls = [];
  const fetchFn = async (u, init) => {
    const p = decodeURIComponent(u.replace('https://sheets.googleapis.com/v4/spreadsheets/S', ''));
    calls.push({ p, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    const ok = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (init.method === 'GET' && p.startsWith('?fields=')) return ok({ sheets: Object.keys(tabs).map((t, i) => ({ properties: { sheetId: i, title: t } })) });
    if (init.method === 'GET') { const t = /\/values\/'([^']+)'/.exec(p)[1]; return ok({ values: tabs[t] || [] }); }
    if (p === ':batchUpdate') { const b = JSON.parse(init.body); if (b.requests[0].addSheet) { tabs[b.requests[0].addSheet.properties.title] = []; return ok({ replies: [{ addSheet: { properties: { sheetId: 99 } } }] }); } return ok({}); }
    if (init.method === 'PUT') { const b = JSON.parse(init.body); tabs[/'([^']+)'/.exec(b.range)[1]] = b.values; return ok({}); }
    return { ok: false, status: 404, text: async () => 'nope' };
  };
  return { fetchFn, calls, tabs };
}
const sheet = (rows) => ({ header: KEYS, rows: rows.map((o) => KEYS.map((k) => o[k] ?? '')) });

describe('schema', () => {
  it('term_id SYSTEM + protected, the rest TEAM; approved_by = Renovann / Chansy; no Lessons/Courses column changed', () => {
    expect(schema.tab).toBe('Teaching points');
    expect(KEYS).toEqual(['term_id', 'term_km', 'term_pali', 'term_en', 'other_spellings', 'approved_by', 'approved_at', 'notes']);
    expect(schema.columns.filter((c) => c.owner === 'SYSTEM').map((c) => c.key)).toEqual(['term_id']);
    expect(schema.columns.filter((c) => c.protected).map((c) => c.key)).toEqual(['term_id']);
    expect(schema.columns.find((c) => c.key === 'approved_by').dropdown).toEqual(['Renovann', 'Chansy']);
    const cols = JSON.parse(readFileSync('data/master/columns.json', 'utf-8'));
    expect(JSON.stringify(cols)).not.toMatch(/term_id|teaching/i);
  });
});

describe('ensureTab (fake API)', () => {
  it('creates the tab once: header, frozen row, dropdown, term_id protected for the service account only', async () => {
    const api = fake({ Lessons: [['row_key']], Courses: [['course_id']] });
    expect(await ensureTab({ sheetId: 'S', token: 't', schema, saEmail: SA, fetchFn: api.fetchFn })).toBe('created');
    expect(api.tabs['Teaching points']).toEqual([KEYS]);
    const reqs = api.calls.filter((c) => c.p === ':batchUpdate').flatMap((c) => c.body.requests);
    expect(reqs[0].addSheet.properties).toEqual({ title: 'Teaching points', gridProperties: { frozenRowCount: 1 } });
    const prot = reqs.filter((r) => r.addProtectedRange).map((r) => r.addProtectedRange.protectedRange);
    expect(prot).toEqual([expect.objectContaining({ range: { sheetId: 99, startColumnIndex: 0, endColumnIndex: 1 }, warningOnly: false, editors: { users: [SA] } })]);
    expect(reqs.filter((r) => r.setDataValidation).map((r) => r.setDataValidation.range.startColumnIndex)).toEqual([KEYS.indexOf('approved_by')]);
    expect(api.tabs.Lessons).toEqual([['row_key']]);
    expect(api.calls.some((c) => /Lessons|Courses|delete/i.test(JSON.stringify(c.body || {}) + c.p))).toBe(false);
    expect(await ensureTab({ sheetId: 'S', token: 't', schema, saEmail: SA, fetchFn: api.fetchFn })).toBe('exists');
  });
  it('an existing tab with another header is left alone and the job stops', async () => {
    const api = fake({ 'Teaching points': [['term', 'other']] });
    await expect(ensureTab({ sheetId: 'S', token: 't', schema, saEmail: SA, fetchFn: api.fetchFn })).rejects.toThrow(/different header/);
    expect(api.calls.every((c) => c.method === 'GET')).toBe(true);
  });
});

describe('assignIds', () => {
  it('new terms get T0001… in sheet order; ids never reused; rows without a term or with an id untouched; re-run writes nothing', () => {
    const s = sheet([{ term_km: 'a' }, { term_id: 'T0002', term_km: 'b' }, { notes: 'only a note' }, { term_en: 'c' }, { term_pali: 'd' }]);
    const r1 = assignIds(s, { next: 1, ids: ['T0001'] }); // T0001 given before (row since deleted)
    expect(r1.cells).toEqual([{ row: 2, to: 'T0003' }, { row: 5, to: 'T0004' }, { row: 6, to: 'T0005' }]);
    expect(r1.registry.ids).toEqual(['T0001', 'T0003', 'T0004', 'T0005']);
    const after = sheet([{ term_id: 'T0003', term_km: 'a' }, { term_id: 'T0002', term_km: 'b' }, { notes: 'only a note' }, { term_id: 'T0004', term_en: 'c' }, { term_id: 'T0005', term_pali: 'd' }]);
    expect(assignIds(after, r1.registry)).toEqual({ cells: [], registry: r1.registry });
  });
});

describe('workflow', () => {
  it('hourly, registry committed before the cells are written, only this tab', () => {
    const y = readFileSync('.github/workflows/master-teaching-points.yml', 'utf-8');
    expect(y).toMatch(/cron: "37 \* \* \* \*"/);
    expect(y.indexOf('git add data/master/term-ids.json')).toBeLessThan(y.indexOf('teaching-points.mjs write'));
    expect(y).not.toMatch(/export\.mjs|build-courses|sync\.mjs/);
  });
});
