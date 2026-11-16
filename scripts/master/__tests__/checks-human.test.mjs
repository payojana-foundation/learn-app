/** PART 6 — checks.json covers all human work (placeholders only). */
import { describe, it, expect } from 'vitest';
import { checksJson, videoFailuresFrom, isNotShared } from '../checks.mjs';
import { planDecisions, applyDecisions } from '../decisions.mjs';

const DID = (s) => (s + '0000000000000000000000000').slice(0, 28);
const url = (s) => `https://drive.google.com/file/d/${DID(s)}/view`;
const folder = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const row = (o) => ({ row_key: '', lesson_id: '', course_id: 'c900', course_title_km: 'ct', lesson_title: 't', lesson_code: '', source_type: 'mp3', mp3_link: '', mp4_link: '', minicourse_link: '', check_decision: '', ...o });
const base = (rows, extra = {}) => checksJson({ lessonRows: rows, courseRows: [], wanted: new Map(), manifest: [], now: 'T', ...extra });
const reasons = (o) => o.items.map((i) => [i.row_key, i.media_type, i.reason]);

describe('no file link', () => {
  it('a course lesson without a Drive file link, or with a folder link', () => {
    const o = base([row({ row_key: 'M1' }), row({ row_key: 'M2', mp3_link: folder }), row({ row_key: 'M3', mp3_link: url('A') }), row({ row_key: 'M4', course_id: '' })]);
    expect(reasons(o).filter((r) => r[2] === 'no file link')).toEqual([['M1', 'audio', 'no file link'], ['M2', 'audio', 'no file link']]);
    expect(o.items.find((i) => i.row_key === 'M2').detail).toBe('a folder link, not a file link');
  });
});

describe('file not shared', () => {
  it('audio: a conversion refused by Drive (403/404); other failures stay "conversion failed"', () => {
    const rows = [row({ row_key: 'M1', mp3_link: url('A') }), row({ row_key: 'M2', mp3_link: url('B') })];
    const failed = new Map([[DID('A'), 'file not readable from Drive (drive-meta): HTTP 404 (token expired or no access)'], [DID('B'), 'too quiet: I -18.9 LUFS']]);
    const o = base(rows, { failed });
    expect(reasons(o).filter((r) => r[1] === 'audio' && r[2] !== 'no approved lesson')).toEqual([['M1', 'audio', 'file not shared'], ['M2', 'audio', 'conversion failed']]);
    expect(isNotShared('HTTP 403')).toBe(true);
    expect(isNotShared('too quiet')).toBe(false);
  });
  it('video: from the video inventory failures (403/404 only), until the video is converted', () => {
    const rows = [row({ row_key: 'M1', mp3_link: url('A'), mp4_link: url('V1') }), row({ row_key: 'M2', mp3_link: url('B'), mp4_link: url('V2') })];
    const vf = videoFailuresFrom([
      { drive_file_id: DID('V1'), http_status: '404', likely_cause: 'not shared with the service account, deleted, or in the trash' },
      { drive_file_id: DID('V2'), http_status: '200', likely_cause: 'Drive has no video metadata' },
    ]);
    const o = base(rows, { videoFailures: vf, manifest: [{ drive_file_id: DID('A'), status: 'approved' }] });
    expect(reasons(o).filter((r) => r[1] === 'video')).toEqual([['M1', 'video', 'file not shared']]);
    expect(o.items.find((i) => i.media_type === 'video').detail).toBe('Drive HTTP 404: not shared with the service account, deleted, or in the trash');
    const later = base(rows, { videoFailures: vf, videoManifest: [{ drive_file_id: DID('V1'), key: 'video/x' }] });
    expect(later.items.some((i) => i.media_type === 'video')).toBe(false);
  });
});

describe('course with no approved lesson', () => {
  it('only when nothing is waiting for the pipeline', () => {
    const blocked = [row({ row_key: 'M1' }), row({ row_key: 'M2', mp3_link: url('A') })];
    const failed = new Map([[DID('A'), 'HTTP 404']]);
    const o = base(blocked, { failed });
    const c = o.items.find((i) => i.reason === 'no approved lesson');
    expect(c).toMatchObject({ row_key: 'M1', course_id: 'c900', media_type: 'audio', detail: '0 of 2 lessons approved and none waiting: 1 no file link, 1 file not shared' });
    // one lesson not converted yet (autorun will) -> no course item
    const waiting = base([...blocked, row({ row_key: 'M3', mp3_link: url('C') })], { failed });
    expect(waiting.items.some((i) => i.reason === 'no approved lesson')).toBe(false);
    // one approved lesson -> no course item
    const live = base(blocked, { failed, manifest: [{ drive_file_id: DID('Z'), status: 'approved' }] , lessonRows: [...blocked, row({ row_key: 'M4', mp3_link: url('Z') })] });
    expect(live.items.some((i) => i.reason === 'no approved lesson')).toBe(false);
  });
  it('same item fields, no sheet id or URL', () => {
    const o = base([row({ row_key: 'M1' })]);
    for (const i of o.items) expect(Object.keys(i)).toEqual(['row_key', 'lesson_id', 'course_id', 'course_title_km', 'lesson_title', 'media_type', 'reason', 'detail', 'first_flagged_at', 'sheet_row', 'sheet_gid', 'play_url', 'check_decision']);
    expect(JSON.stringify(o)).not.toMatch(/docs\.google\.com\/spreadsheets|sheet_id/);
  });
});

describe('check_decision "fixed" re-runs intake / convert for these rows', () => {
  it('not converted: off failed-review, autorun tries reset, back in the course queue (once); video too', () => {
    const rows = [row({ row_key: 'M1', mp3_link: url('A'), mp4_link: url('V'), check_decision: 'fixed' }), row({ row_key: 'M2', check_decision: 'fixed' })];
    const plan = planDecisions(rows, [], [], {});
    const r = applyDecisions(plan, { manifest: [], videoManifest: [], precheck: null, autorun: { attempts: { [DID('A')]: 2, [DID('V')]: 2 } }, log: {}, date: 'D', queued: new Set(), failedIds: new Set([DID('A')]) });
    expect(r.queueAdds).toEqual([{ course_id: 'c900', id: DID('A') }]);
    expect(r.failedRemove).toEqual([DID('A')]);
    expect(r.autorun.attempts).toEqual({});
    expect(r.log.M1.result).toBe('not converted yet: conversion queued again, video queued for conversion again');
    expect(r.log.M2.result).toBe('still no Drive file link: add it in the sheet, then set fixed again');
    const again = applyDecisions(plan, { manifest: [], videoManifest: [], precheck: null, log: {}, date: 'D', queued: new Set([DID('A')]), failedIds: new Set() });
    expect(again.queueAdds).toEqual([]);
  });
});
