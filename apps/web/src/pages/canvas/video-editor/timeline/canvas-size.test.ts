import { describe, it, expect } from 'vitest';
import { CANVAS_PRESETS, canvasSizeOf, remapForCanvasSize, LAST_ASPECT_KEY } from './canvas-size';
import type { VideoClip } from '../types';

describe('canvasSizeOf', () => {
  it('缺省兜底 1920×1080', () => {
    expect(canvasSizeOf({} as never)).toEqual({ width: 1920, height: 1080 });
  });
  it('读取 data.canvasSize', () => {
    expect(canvasSizeOf({ canvasSize: { width: 1080, height: 1920 } } as never)).toEqual({ width: 1080, height: 1920 });
  });
});

describe('CANVAS_PRESETS（6 档，spec 5.1）', () => {
  it('16:9/9:16/21:9/3:4/4:3/1:1 全存在', () => {
    expect(CANVAS_PRESETS.map(p => p.label)).toEqual(['16:9', '9:16', '21:9', '3:4', '4:3', '1:1']);
  });
});

describe('remapForCanvasSize（中心点等比 + 关键帧 value 覆盖）', () => {
  it('片段 transform 与 keyframes.value 同步重映射', () => {
    const clip = {
      id: 'c', trackId: 't', type: 'video', start: 0, duration: 5, sourceStart: 0, mediaId: 'm', playbackSpeed: 1 as const,
      transform: { x: 1920, y: 540, scale: 1, rotation: 0, opacity: 1 },
      keyframes: [{ id: 'k', t: 1, property: 'x' as const, value: 1920, easing: 'linear' as const }],
    };
    const out = remapForCanvasSize([clip as never], { width: 1920, height: 1080 }, { width: 1080, height: 1920 });
    const c0 = out[0] as VideoClip; // 窄化：Clip 联合上 audio/subtitle 无 transform/keyframes
    expect(c0.transform.x).toBeCloseTo(1080);      // 1920/1920*1080
    expect(c0.transform.y).toBeCloseTo(960);       // 540/1080*1920
    expect(c0.keyframes[0].value).toBeCloseTo(1080); // 关键帧同步（spec 5.1——漏了必漂移）
  });
});

describe('LAST_ASPECT_KEY（R17-F5②：Shell/EditorTopBar 双方消费的存储键）', () => {
  it('常量值稳定', () => {
    expect(LAST_ASPECT_KEY).toBe('ve-last-canvas-preset');
  });
});
