// apps/web/src/pages/canvas/video-editor/timeline/timecode.test.ts
import { describe, it, expect } from 'vitest';
import { formatTimecode, formatShortTime, totalDuration } from './timecode';
import type { ProjectData, VideoClip } from '../types';

describe('formatTimecode（HH:MM:SS:FF，30fps 非丢帧——片段块显示）', () => {
  it('零点', () => { expect(formatTimecode(0)).toBe('00:00:00:00'); });
  it('1h2m3s4f', () => { expect(formatTimecode(3600 + 120 + 3 + 4 / 30)).toBe('01:02:03:04'); });
  it('29 帧不进位', () => { expect(formatTimecode(29 / 30)).toBe('00:00:00:29'); });
  it('30 帧进秒', () => { expect(formatTimecode(1)).toBe('00:00:01:00'); });
});

describe('formatShortTime（M:SS——节点本体简略显示，与片段块精度注明不同）', () => {
  it('M:SS', () => {
    expect(formatShortTime(0)).toBe('0:00');
    expect(formatShortTime(65.4)).toBe('1:05');
    expect(formatShortTime(600)).toBe('10:00');
  });
});

describe('totalDuration（原点恒 0，总长 = max(end)；overlap 不重复计时天然成立）', () => {
  // 夹具显式标注 VideoClip——Object.fromEntries 泛型 T 从 entries 推断，
  // 内联字面量的 type 会被拓宽为 string 导致 tsc 报错（R1 审核 P0-4，vitest esbuild 不查类型但 build tsc -b 会）
  const mk = (clips: { start: number; duration: number }[]): ProjectData => {
    const entries = clips.map((c, i) => {
      const v: VideoClip = {
        id: `c${i}`, trackId: 't', type: 'video', start: c.start, duration: c.duration,
        sourceStart: 0, mediaId: 'm', playbackSpeed: 1,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
      };
      return [`c${i}`, v] as const;
    });
    return {
      version: 1, fps: 30,
      tracks: [{ id: 't', type: 'video', name: 'V', muted: false, hidden: false, clips: entries.map(([id]) => id) }],
      clips: Object.fromEntries(entries),
    };
  };
  it('空工程 0', () => { expect(totalDuration(mk([]))).toBe(0); });
  it('max(end)——片段不从 0 开始时前导为黑场计入成片', () => {
    expect(totalDuration(mk([{ start: 2, duration: 3 }, { start: 0, duration: 1 }]))).toBe(5);
  });
});
