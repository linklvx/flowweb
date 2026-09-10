import { describe, it, expect } from 'vitest';
import {
  keyframeValueAt, interpolateTransform, crossfadeContextOf, transitionEffect, interpolateClip,
} from './interpolate';
import type { ProjectData, VideoClip } from '../types';

const vc = (id: string, start: number, duration: number, over: Partial<VideoClip> = {}): VideoClip => ({
  id, trackId: 'tv', type: 'video', start, duration, sourceStart: 0, mediaId: 'm', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [], ...over,
});
const data = (clips: VideoClip[]): ProjectData => ({
  version: 1, fps: 30,
  tracks: [{ id: 'tv', type: 'video', name: 'V', muted: false, hidden: false, clips: clips.map(c => c.id) }],
  clips: Object.fromEntries(clips.map(c => [c.id, c])),
});
const kf = (t: number, property: 'x' | 'y' | 'scale' | 'rotation' | 'opacity', value: number) =>
  ({ id: `k-${t}-${property}`, t, property, value, easing: 'linear' as const });

describe('keyframeValueAt（插值边界，spec 数据模型）', () => {
  it('无点取 base / 单点恒值', () => {
    expect(keyframeValueAt([], 1, 0.7)).toBe(0.7);
    expect(keyframeValueAt([{ t: 0, value: 0.3 }], 5, 1)).toBe(0.3);
  });
  it('越首点取首值 / 越末点取末值', () => {
    const pts = [{ t: 1, value: 10 }, { t: 3, value: 30 }];
    expect(keyframeValueAt(pts, 0, 0)).toBe(10);
    expect(keyframeValueAt(pts, 9, 0)).toBe(30);
  });
  it('中间线性插值', () => {
    expect(keyframeValueAt([{ t: 0, value: 0 }, { t: 2, value: 1 }], 0.5)).toBeCloseTo(0.25, 10);
  });
  it('乱序输入先排序', () => {
    expect(keyframeValueAt([{ t: 2, value: 1 }, { t: 0, value: 0 }], 1)).toBeCloseTo(0.5, 10);
  });
});

describe('interpolateTransform（五属性独立通道）', () => {
  it('各属性走各自关键帧，无关键帧属性取基准', () => {
    const c = vc('a', 0, 10, {
      transform: { x: 100, y: 50, scale: 2, rotation: 30, opacity: 0.8 },
      keyframes: [kf(0, 'x', 0), kf(10, 'x', 300)],
    });
    const tr = interpolateTransform(c, 5);
    expect(tr.x).toBeCloseTo(150, 10);
    expect(tr.y).toBe(50); expect(tr.scale).toBe(2); expect(tr.rotation).toBe(30); expect(tr.opacity).toBe(0.8);
  });
});

describe('crossfadeContextOf（双窗口角色判定，决策 17）', () => {
  it('后片：backOverlap=实际重叠量', () => {
    const d = data([vc('f', 0, 3), vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    expect(crossfadeContextOf(d, 'b')).toEqual({ backOverlap: 0.5, frontOverlap: 0 });
  });
  it('前片：frontOverlap=重叠量（前片自身无任何转场字段）', () => {
    const d = data([vc('f', 0, 3), vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    expect(crossfadeContextOf(d, 'f')).toEqual({ backOverlap: 0, frontOverlap: 0.5 });
  });
  it('三片链 A/B/C 全 crossfade：中间片双窗口并存（R1 审核 G3）', () => {
    const d = data([
      vc('a', 0, 3),
      vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
      vc('c', 5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    expect(crossfadeContextOf(d, 'b')).toEqual({ backOverlap: 0.5, frontOverlap: 0.5 }); // b=[2.5,5.5)，c 从 5 起 → b/c 重叠 0.5
  });
  it('无 crossfade 参与 → null', () => {
    const d = data([vc('f', 0, 3), vc('b', 4, 3)]);
    expect(crossfadeContextOf(d, 'b')).toBeNull();
    expect(crossfadeContextOf(d, 'f')).toBeNull();
  });
  it('crossfade 但无实际重叠 → null（无重叠区无渐变）', () => {
    const d = data([vc('f', 0, 3), vc('b', 5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    expect(crossfadeContextOf(d, 'b')).toBeNull(); // eff.overlap=0
    expect(crossfadeContextOf(d, 'f')).toBeNull();
  });
});

describe('transitionEffect（5 种转场，局部时间）', () => {
  const mk = (over: Partial<VideoClip>) => vc('a', 10, 4, over); // 局部 [0,4)
  it('fadeIn：开头 duration 内 0→1', () => {
    const d = data([mk({ transitionIn: { type: 'fadeIn', duration: 2 } })]);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 0).alpha).toBeCloseTo(0, 10);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 1).alpha).toBeCloseTo(0.5, 10);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 2.5).alpha).toBe(1);
  });
  it('fadeOut：结尾 duration 内 1→0', () => {
    const d = data([mk({ transitionOut: { type: 'fadeOut', duration: 2 } })]);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 2).alpha).toBeCloseTo(1, 10);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 3).alpha).toBeCloseTo(0.5, 10);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 4 - 1e-9).alpha).toBeCloseTo(0, 8); // numDigits 10→8：end-1e-9 探针的 rem 双精度残差 ~5e-10，阈值 5e-11 不可满足（控制器登记偏离）
  });
  it('toBlack：结尾 overlay black 0→1（alpha 恒 1）', () => {
    const d = data([mk({ transitionOut: { type: 'toBlack', duration: 2 } })]);
    const mid = transitionEffect(d, d.clips['a'] as VideoClip, 3);
    expect(mid.alpha).toBe(1);
    expect(mid.overlay).toEqual({ color: 'black', alpha: 0.5 });
  });
  it('toWhite：结尾 overlay white', () => {
    const d = data([mk({ transitionOut: { type: 'toWhite', duration: 2 } })]);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 3).overlay).toEqual({ color: 'white', alpha: 0.5 });
  });
  it('入转场 toBlack：开头 overlay 从 1→0', () => {
    const d = data([mk({ transitionIn: { type: 'toBlack', duration: 2 } })]);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 1).overlay).toEqual({ color: 'black', alpha: 0.5 });
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 3).overlay).toBeNull();
  });
  it('crossfade 后片：前缘 0→1（overlap 内）', () => {
    const d = data([vc('f', 0, 3), vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    expect(transitionEffect(d, d.clips['b'] as VideoClip, 0).alpha).toBeCloseTo(0, 10);
    expect(transitionEffect(d, d.clips['b'] as VideoClip, 0.25).alpha).toBeCloseTo(0.5, 10);
    expect(transitionEffect(d, d.clips['b'] as VideoClip, 1).alpha).toBe(1);
    expect(transitionEffect(d, d.clips['b'] as VideoClip, 0.25).overlay).toBeNull(); // crossfade 永不作为独立转场施加（类型守卫）——窗口内不得叠加独立 overlay
  });
  it('crossfade 前片：尾缘 1→0（与后片同曲线 equal-gain，spec 第六节）', () => {
    const d = data([vc('f', 0, 3), vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } })]);
    expect(transitionEffect(d, d.clips['f'] as VideoClip, 2.5).alpha).toBeCloseTo(1, 10);
    expect(transitionEffect(d, d.clips['f'] as VideoClip, 2.75).alpha).toBeCloseTo(0.5, 10);
    expect(transitionEffect(d, d.clips['f'] as VideoClip, 3 - 1e-9).alpha).toBeCloseTo(0, 8); // numDigits 10→8：end-1e-9 探针的 rem 双精度残差 ~2e-9，阈值 5e-11 不可满足（控制器登记偏离）
  });
  it('前片独立 transitionOut 被 crossfade 吞并（effectiveTransitions.out=null，走 cf 分支）', () => {
    const d = data([
      vc('f', 0, 3, { transitionOut: { type: 'toBlack', duration: 1 } }),
      vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    const r = transitionEffect(d, d.clips['f'] as VideoClip, 2.75);
    expect(r.alpha).toBeCloseTo(0.5, 10); // crossfade 曲线生效
    expect(r.overlay).toBeNull();          // toBlack 被吞
  });
  it('三片链：中间片前缘入 + 尾缘出双窗口独立施加（G3——修复前中间片尾缘恒 1）', () => {
    const d = data([
      vc('a', 0, 3),
      vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
      vc('c', 5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }),
    ]);
    const te = (tl: number) => transitionEffect(d, d.clips['b'] as VideoClip, tl).alpha;
    expect(te(0)).toBeCloseTo(0, 10);      // 前缘起点（back 窗口）
    expect(te(1)).toBe(1);                 // 独立区
    expect(te(2.75)).toBeCloseTo(0.5, 10); // 尾缘中点（front 窗口：局部 2.75，rem=0.25 → 0.5）
    expect(te(3 - 1e-9)).toBeCloseTo(0, 8); // numDigits 10→8：end-1e-9 探针的 rem 双精度残差 ~2e-9，阈值 5e-11 不可满足（控制器登记偏离）
  });
  it('入 crossfade + 出 toBlack 组合：窗口 alpha 与未吞并的独立出场 overlay 同时生效（决策 17）', () => {
    const d = data([
      vc('a', 0, 3),
      vc('b', 2.5, 3, { transitionIn: { type: 'crossfade', duration: 0.5 }, transitionOut: { type: 'toBlack', duration: 1 } }),
    ]);
    const r = transitionEffect(d, d.clips['b'] as VideoClip, 2.75); // rem=0.25<1 → overlay=0.75；无 front 窗 → alpha=1
    expect(r.alpha).toBe(1);
    expect(r.overlay).toEqual({ color: 'black', alpha: 0.75 });
  });
  it('crossfade 前片存在但零重叠：不作为独立转场施加（无白闪——质量审查发现）', () => {
    const d = data([
      vc('f', 0, 2),
      vc('b', 3, 3, { transitionIn: { type: 'crossfade', duration: 0.5 } }), // 间隔放置 overlap=0
    ]);
    expect(crossfadeContextOf(d, 'b')).toBeNull();      // 无重叠区无渐变
    expect(transitionEffect(d, d.clips['b'] as VideoClip, 0)).toEqual({ alpha: 1, overlay: null });
    expect(transitionEffect(d, d.clips['b'] as VideoClip, 0.25)).toEqual({ alpha: 1, overlay: null });
  });
  it('transitionOut 选 crossfade：语义由后片表达，本片不施加任何独立效果（无白闪）', () => {
    const d = data([vc('a', 0, 4, { transitionOut: { type: 'crossfade', duration: 1 } })]);
    expect(transitionEffect(d, d.clips['a'] as VideoClip, 3.5)).toEqual({ alpha: 1, overlay: null });
  });
});

describe('interpolateClip（整合输出）', () => {
  it('视频片：sourceTime 公式 + transform 插值 + opacity 合成 + overlay', () => {
    const d = data([vc('a', 1, 8, {
      sourceStart: 2, playbackSpeed: 2,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.5 },
      keyframes: [kf(0, 'opacity', 1)],
      transitionOut: { type: 'toBlack', duration: 2 },
    })]);
    // 数值验算（控制器预验算）：t=7.5 → 局部 6.5；sourceTime=2+(7.5-1)×2=15；
    // opacity 通道单点 kf 恒值 1（基准 0.5 被覆盖）× alpha 1 = 1；toBlack rem=8-6.5=1.5 < 2 → overlay=1-1.5/2=0.25
    const s = interpolateClip(d, 'a', 7.5);
    expect(s.kind).toBe('visual');
    if (s.kind === 'visual') {
      expect(s.sourceTime).toBe(15);
      expect(s.opacity).toBe(1);
      expect(s.overlay).toEqual({ color: 'black', alpha: 0.25 });
    }
  });
  it('图片片：sourceTime=null', () => {
    const d = data([]);
    d.clips['img'] = { id: 'img', trackId: 'tv', type: 'image', start: 0, duration: 5, mediaId: 'mi', transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] };
    d.tracks[0].clips.push('img');
    const s = interpolateClip(d, 'img', 2);
    expect(s.kind === 'visual' && s.sourceTime).toBeNull();
  });
  it('字幕片：text/style/visible 透传', () => {
    const d = data([]);
    d.clips['sub'] = { id: 'sub', trackId: 'ts', type: 'subtitle', start: 0, duration: 2, text: '你好', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
    d.tracks[0] = { id: 'ts', type: 'subtitle', name: 'S', muted: false, hidden: false, clips: ['sub'] };
    const s = interpolateClip(d, 'sub', 1);
    expect(s).toMatchObject({ kind: 'subtitle', text: '你好', visible: true });
  });
});
