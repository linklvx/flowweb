// apps/web/src/pages/canvas/video-editor/timeline/view-scale.test.ts
import { describe, it, expect } from 'vitest';
import {
  timeToPx, pxToTime, snapThresholdSec, collectSnapPoints, snapTime, edgeHitTest, anchorZoomScroll,
} from './view-scale';
import type { Clip } from '../types';

const clip = (id: string, start: number, duration: number): Clip => ({
  id, trackId: 't1', type: 'video', start, duration, sourceStart: 0, mediaId: 'm',
  playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});

describe('像素↔秒换算', () => {
  it('互逆', () => {
    expect(timeToPx(2.5, 80)).toBe(200);
    expect(pxToTime(200, 80)).toBe(2.5);
  });
});

describe('吸附（8px 阈值随 px/s 变化）', () => {
  it('阈值秒 = 8 / pxPerSec 多档', () => {
    expect(snapThresholdSec(50)).toBeCloseTo(0.16);
    expect(snapThresholdSec(100)).toBeCloseTo(0.08);
    expect(snapThresholdSec(200)).toBeCloseTo(0.04);
  });
  it('命中片段边缘吸附', () => {
    const pts = collectSnapPoints('me', [clip('a', 2, 3)], 0); // 边缘 2、5
    const r = snapTime(2.05, pts, 100); // 距 2 为 0.05s < 0.08
    expect(r.time).toBe(2);
    expect(r.snapped?.kind).toBe('clip-start');
  });
  it('不命中返回原值', () => {
    const pts = collectSnapPoints('me', [clip('a', 2, 3)], 0);
    const r = snapTime(4, pts, 100); // 距 2/5 均 1s+ > 0.08；整秒 4 距 0——整秒命中！
    expect(r.snapped?.kind).toBe('whole-second');
    expect(r.time).toBe(4);
  });
  it('整秒刻度独立命中（无显式点时）', () => {
    const pts = collectSnapPoints('me', [clip('a', 0.1, 0.1)], 0.3);
    const r = snapTime(0.99, pts, 100); // 距 1s 为 0.01 < 0.08
    expect(r.time).toBe(1);
    expect(r.snapped?.kind).toBe('whole-second');
  });
  it('排除自身片段边缘', () => {
    const pts = collectSnapPoints('me', [clip('me', 2, 3)], 0);
    expect(pts.some(p => p.kind === 'clip-start' && p.time === 2)).toBe(false);
  });
  it('播放头是吸附点', () => {
    const pts = collectSnapPoints('me', [], 7);
    const r = snapTime(7.05, pts, 100);
    expect(r.snapped?.kind).toBe('playhead');
  });
  it('等距 tie（显式点与整秒同点）：显式点胜出', () => {
    const pts = collectSnapPoints('me', [clip('a', 0, 3)], 0); // 显式点 0/3
    const r = snapTime(3, pts, 100); // clip-end 3 与整秒 3 同点同距 0
    expect(r.snapped?.kind).toBe('clip-end');
  });
  it('整秒更近时独立胜出（证明整秒是独立档，非仅显式兜底）', () => {
    const pts = collectSnapPoints('me', [clip('a', 2, 3)], 0); // 显式点 2/5
    const r = snapTime(3.05, pts, 100); // 距整秒 3 为 0.05 < 0.08；距显式点 2/5 均 > 1
    expect(r.time).toBe(3);
    expect(r.snapped?.kind).toBe('whole-second');
  });
});

describe('边缘命中（trim 拖拽判定）', () => {
  it('6px 内命中左/右缘，中间为移动', () => {
    expect(edgeHitTest(2, 100)).toBe('left');
    expect(edgeHitTest(97, 100)).toBe('right');
    expect(edgeHitTest(50, 100)).toBe(null);
  });
});

describe('缩放锚定（Ctrl+滚轮以播放头为中心）', () => {
  it('保持锚点视口位置不变', () => {
    // 播放头 10s 在视口 x=300（viewportW 800, scrollLeft 500, pxPerSec 80）
    const r = anchorZoomScroll({ scrollLeft: 500, anchorTime: 10, oldPxPerSec: 80, newPxPerSec: 160, viewportW: 800 });
    expect(r.scrollLeft).toBe(10 * 160 - 300); // 锚点仍距视口左 300px
  });
});
