// apps/web/src/pages/canvas/video-editor/timeline/clip-math.test.ts
import { describe, it, expect } from 'vitest';
import {
  FPS, secondsToFrame, frameToSeconds, quantizeTime,
  sourceTime, trimLeftGuard, trimRightGuard, clampDelta,
  applyTrimLeft, applyTrimRight, splitClipAt,
} from './clip-math';
import type { TimedClip } from './clip-math';
import type { VideoClip } from '../types';

const vc = (over: Partial<VideoClip> = {}): VideoClip => ({
  id: 'c1', trackId: 't1', type: 'video', start: 0, duration: 10,
  sourceStart: 2, mediaId: 'm1', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
  ...over,
});

describe('帧量化（帧整数为唯一真相）', () => {
  it('secondsToFrame 四舍五入 / frameToSeconds 精确除法', () => {
    expect(secondsToFrame(1.0166, 30)).toBe(30); // 0.5 帧进位
    expect(secondsToFrame(2, 30)).toBe(60);
    expect(frameToSeconds(45, 30)).toBe(1.5);
  });
  it('quantizeTime 消除浮点尾差', () => {
    const noisy = 0.1 + 0.2;
    expect(quantizeTime(noisy, 30)).toBe(0.3); // 9 帧精确（0.30000000000000004 的尾差被量化消除，Object.is 意义上 === 0.3）
  });
});

describe('sourceTime 变速公式', () => {
  it('1×/0.5×/2× 三档', () => {
    const base = { sourceStart: 2, start: 1 } as const;
    expect(sourceTime(vc({ ...base, playbackSpeed: 1, duration: 10 }), 3)).toBe(4);
    expect(sourceTime(vc({ ...base, playbackSpeed: 0.5 }), 3)).toBe(3);
    expect(sourceTime(vc({ ...base, playbackSpeed: 2 }), 3)).toBe(6);
  });
});

describe('trim guard（素材边界约束）', () => {
  it('左缘左拉不得越过素材 0 点（素材约束更紧时由它决定）', () => {
    const g = trimLeftGuard(vc({ sourceStart: 1, playbackSpeed: 1, start: 10 }), 100);
    expect(g.minDelta).toBe(-1); // max(-1, -10)——素材约束生效
  });
  it('左缘至少留 1 帧', () => {
    expect(trimLeftGuard(vc(), 100).maxDelta).toBeCloseTo(10 - 1 / FPS, 10);
  });
  it('左拉下界取素材 0 点与时间轴 0 点的交（start 约束更紧时由它兜底）', () => {
    // sourceStart=100 富余（源约束 -100 放行），start=5 → 时间轴 0 点约束 -5 生效
    const g = trimLeftGuard(vc({ sourceStart: 100, duration: 10, start: 5 }), 200);
    expect(g.minDelta).toBe(-5);
    const r = applyTrimLeft(vc({ sourceStart: 100, duration: 10, start: 5 }), -5);
    expect(r.start).toBe(0);          // 不越过时间轴原点
    expect(r.duration).toBe(15);      // duration 随左拉增大（左拉侧永不为负——R1 审核 P0-1 反例方向修正）
    expect((r as VideoClip).sourceStart).toBe(95);
  });
  it('start=0 的片段左拉下界为 0（时间轴原点恒 0，start 不为负）', () => {
    const g = trimLeftGuard(vc({ sourceStart: 100, duration: 10, start: 0 }), 200);
    // 注意：Math.max(-100, -0) 返回 -0，而 toBe 是 Object.is 语义（-0 ≠ 0）——必须 toBeCloseTo
    expect(g.minDelta).toBeCloseTo(0, 10);
  });
  it('字幕/图片片（sourceLimit=-Infinity）左拉由时间轴 0 点兜底（R2 审核 P2-1：原实现对无源片 clampDelta 形同虚设）', () => {
    const sub = { id: 's1', trackId: 'tv', type: 'subtitle', start: 2, duration: 3, text: 'x', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } } as any;
    expect(trimLeftGuard(sub, Infinity).minDelta).toBe(-2); // max(-Infinity, -2)——有限下界，不再无限左拉
  });
  it('右缘不超素材时长（0.5× 换算）', () => {
    const g = trimRightGuard(vc({ sourceStart: 2, duration: 10, playbackSpeed: 0.5 }), 30);
    expect(g.maxDelta).toBeCloseTo((30 - 2) / 0.5 - 10, 5);
  });
  it('clampDelta 夹取', () => {
    expect(clampDelta({ minDelta: -1, maxDelta: 5 }, -9)).toBe(-1);
    expect(clampDelta({ minDelta: -1, maxDelta: 5 }, 9)).toBe(5);
  });
  it('素材时长 Infinity → 右缘不设限（时长未知兜底）', () => {
    expect(trimRightGuard(vc(), Infinity).maxDelta).toBe(Infinity);
  });
});

describe('applyTrim（量化成片时间，源时间连续浮点）', () => {
  it('左缘：start/duration 量化，sourceStart += Δ*speed', () => {
    const r = applyTrimLeft(vc({ start: 1, duration: 8, sourceStart: 2, playbackSpeed: 2 }), 0.5);
    expect(r.start).toBe(1.5);
    expect(r.duration).toBe(7.5);
    expect((r as VideoClip).sourceStart).toBe(3);
  });
  it('右缘：sourceStart 不动', () => {
    const r = applyTrimRight(vc({ start: 1, duration: 8, sourceStart: 2 }), -0.5);
    expect(r.duration).toBe(7.5);
    expect((r as VideoClip).sourceStart).toBe(2);
  });
  it('反复 trim 100 次不漂移/无缝隙（浮点纪律 TDD）', () => {
    let c = vc({ start: 0, duration: 5, sourceStart: 0, playbackSpeed: 1 }); // 5s = 150 帧：左剪 50 帧 + 右剪 50 帧 = 剩 50 帧
    for (let i = 0; i < 50; i++) c = applyTrimLeft(c, 1 / FPS) as VideoClip;
    for (let i = 0; i < 50; i++) c = applyTrimRight(c, -1 / FPS) as VideoClip;
    expect(c.start).toBeCloseTo(50 / FPS, 10);
    expect(c.duration).toBeCloseTo(50 / FPS, 10);
    expect(c.start).toBe(quantizeTime(c.start));
    expect(c.duration).toBe(quantizeTime(c.duration));
  });
});

describe('splitClipAt（播放头分割，spec 第三节公式）', () => {
  it('前片 [start,cut]、后片 sourceStart/duration/start 按公式', () => {
    const c = vc({ start: 1, duration: 8, sourceStart: 2, playbackSpeed: 2 });
    const { front, back } = splitClipAt(c, 3, 'c2');
    expect(front.duration).toBe(2);
    expect(back.start).toBe(3);
    expect(back.duration).toBe(6);
    expect((back as VideoClip).sourceStart).toBe(2 + (3 - 1) * 2);
  });
  it('分割后 sourceTime 连续（无缝）', () => {
    const c = vc({ start: 1, duration: 8, sourceStart: 2, playbackSpeed: 0.5 });
    const { front, back } = splitClipAt(c, 4, 'c2');
    const t = 4; // 切点
    expect(sourceTime(front as TimedClip, t)).toBeCloseTo(sourceTime(back as TimedClip, t), 10);
  });
  it('转场语义：前片清 transitionOut、后片清 transitionIn（配对交给状态机重配）', () => {
    const c = vc({ transitionIn: { type: 'crossfade', duration: 0.5 }, transitionOut: { type: 'fadeOut', duration: 0.5 } });
    const { front, back } = splitClipAt(c, 2, 'c2');
    expect((front as VideoClip).transitionIn?.type).toBe('crossfade');
    expect((front as VideoClip).transitionOut).toBeUndefined();
    expect((back as VideoClip).transitionIn).toBeUndefined();
    expect((back as VideoClip).transitionOut?.type).toBe('fadeOut');
  });
  it('关键帧按局部时间分配：前片留 t<=cut-local，后片移位', () => {
    const c = vc({
      keyframes: [
        { id: 'k1', t: 1, property: 'opacity', value: 0.5, easing: 'linear' },
        { id: 'k2', t: 5, property: 'opacity', value: 1, easing: 'linear' },
      ],
    });
    const { front, back } = splitClipAt(c, 3, 'c2');
    expect((front as VideoClip).keyframes.map(k => k.id)).toEqual(['k1']);
    expect((back as VideoClip).keyframes).toEqual([{ id: 'k2', t: 2, property: 'opacity', value: 1, easing: 'linear' }]);
  });
  it('image/subtitle 分支：无 sourceStart 仅分割时长', () => {
    const img = { id: 'i1', trackId: 't1', type: 'image', start: 0, duration: 6, mediaId: 'm2',
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as const;
    const { front, back } = splitClipAt(img as any, 2, 'i2');
    expect(front.duration).toBe(2);
    expect(back.duration).toBe(4);
    expect((back as any).sourceStart).toBeUndefined();
  });
});
