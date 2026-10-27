import { describe, it, expect } from 'vitest';
import { summarise, summaryLine } from '../ffprobe-summary.mjs';

describe('summarise', () => {
  it('audio-only file: has_audio, no video, audio codec, floored duration', () => {
    const s = summarise({
      format: { duration: '600.7' },
      streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
    });
    expect(s).toEqual({ duration_s: 600, has_video: false, has_audio: true, codec: 'mp3' });
  });

  it('real video (named mp3): has_video true, audio codec preferred for codec field', () => {
    const s = summarise({
      format: { duration: '300' },
      streams: [
        { codec_type: 'video', codec_name: 'h264' },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    });
    expect(s.has_video).toBe(true);
    expect(s.has_audio).toBe(true);
    expect(s.codec).toBe('aac');
  });

  it('cover-art picture is NOT real video', () => {
    const s = summarise({
      format: { duration: '120' },
      streams: [
        { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        { codec_type: 'audio', codec_name: 'mp3' },
      ],
    });
    expect(s.has_video).toBe(false);
  });

  it('video with no audio track: has_audio false, falls back to video codec', () => {
    const s = summarise({
      format: { duration: '90' },
      streams: [{ codec_type: 'video', codec_name: 'h264' }],
    });
    expect(s.has_audio).toBe(false);
    expect(s.has_video).toBe(true);
    expect(s.codec).toBe('h264');
  });

  it('empty / unreadable probe → zeros and empty codec', () => {
    expect(summarise({})).toEqual({ duration_s: 0, has_video: false, has_audio: false, codec: '' });
  });
});

describe('summaryLine', () => {
  it('formats the pipe-delimited line the workflow parses', () => {
    expect(summaryLine({ format: { duration: '600' }, streams: [{ codec_type: 'audio', codec_name: 'mp3' }] })).toBe(
      '600|false|true|mp3'
    );
  });
});
