import { describe, it, expect } from 'vitest';
import { computeExportSize, estimateSizeBytes, estimateMemoryBytes, runPrecheck } from './precheck';
import { CANVAS_PRESETS } from '../timeline/canvas-size';
import type { ProjectData, VideoClip, AudioClip, SubtitleClip } from '../types';

const TIERS = ['480p', '720p', '1080p'] as const;

const vc = (id: string, mediaId: string, start: number, duration: number, trackId = 't-video'): VideoClip => ({
  id, trackId, type: 'video', start, duration, sourceStart: 0, mediaId, playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});
const ac = (id: string, mediaId: string, start: number, duration: number, trackId = 't-audio1'): AudioClip => ({
  id, trackId, type: 'audio', start, duration, sourceStart: 0, mediaId,
  volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [],
});
const mk = (clips: (VideoClip | AudioClip | SubtitleClip)[], tracks: { id: string; type: 'video' | 'subtitle' | 'audio' }[]): ProjectData => ({
  version: 1, fps: 30,
  tracks: tracks.map((t) => ({ id: t.id, type: t.type, name: t.id, muted: false, hidden: false, clips: clips.filter((c) => c.trackId === t.id).map((c) => c.id) })),
  clips: Object.fromEntries(clips.map((c) => [c.id, c])),
});

describe('computeExportSize（档位=目标短边，取偶，单点）', () => {
  it.each(CANVAS_PRESETS.flatMap((p) => TIERS.map((t) => [p.label, t, p.size] as const)))(
    '%s @ %s 全偶数', (_label, tier, size) => {
      const out = computeExportSize(size, tier);
      expect(out.width % 2).toBe(0);
      expect(out.height % 2).toBe(0);
      expect(Math.min(out.width, out.height)).toBe(parseInt(tier)); // 短边=档位
    });
  it('16:9 480p = 854×480（853.33 取偶）', () => {
    expect(computeExportSize({ width: 1920, height: 1080 }, '480p')).toEqual({ width: 854, height: 480 });
  });
  it('9:16 1080p = 1080×1920（非 608×1080——短边口径）', () => {
    expect(computeExportSize({ width: 1080, height: 1920 }, '1080p')).toEqual({ width: 1080, height: 1920 });
  });
});

describe('estimateSizeBytes（码率×时长×1.2）', () => {
  it('720p 60s ≈ 46.15MB（数值字面量钉子——复刻实现公式是同义反复）', () => {
    expect(estimateSizeBytes({ width: 1920, height: 1080 }, '720p', 60)).toBe(46_152_000); // (5M+128k)/8×60×1.2
  });
  it('1080p 900s（15min 上限）≈ 1.64GB 口径仅数值断言', () => {
    expect(estimateSizeBytes({ width: 1920, height: 1080 }, '1080p', 900)).toBeGreaterThan(1.5 * 1024 ** 3);
  });
});

describe('estimateMemoryBytes（345.6MB/轨口径按实际时长线性 × 3.5 瞬时）', () => {
  it('900s 单视频片无音频轨 = 345.6MB × 1 × 3.5', () => {
    const data = mk([vc('v', 'm1', 0, 900)], [{ id: 't-video', type: 'video' }]);
    expect(estimateMemoryBytes(data, 900)).toBe(1_209_600_000); // 900×48000×2×4×1×3.5（字面量钉子——复刻实现公式是同义反复）
  });
  it('音频轨数与视频片数都计入（视频内嵌音轨保守全算）', () => {
    const data = mk([vc('v', 'm1', 0, 10), ac('a', 'm2', 0, 10)], [{ id: 't-video', type: 'video' }, { id: 't-audio1', type: 'audio' }]);
    expect(estimateMemoryBytes(data, 10)).toBe(26_880_000); // 10×48000×2×4×2×3.5
  });
});

describe('runPrecheck', () => {
  const okEncoder = { video: true, audio: true };
  const urls = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, `http://x/${id}`]));
  it('时长 >15min 拦截（errors 含 duration）', () => {
    const data = mk([vc('v', 'm1', 0, 901)], [{ id: 't-video', type: 'video' }]);
    const r = runPrecheck(data, urls('m1'), okEncoder);
    expect(r.errors.some((e) => e.code === 'duration')).toBe(true);
  });
  it('mediaId 不在已知媒体集 → missing-media（素材缺失拦截导出）', () => {
    const data = mk([vc('v', 'ghost', 0, 5)], [{ id: 't-video', type: 'video' }]);
    const r = runPrecheck(data, urls('other'), okEncoder);
    expect(r.errors.some((e) => e.code === 'missing-media')).toBe(true);
  });
  it('id 存在但 url 空 → missing-url（防导出黑帧却"成功"），与 missing-media 互斥', () => {
    const data = mk([vc('v', 'm1', 0, 5)], [{ id: 't-video', type: 'video' }]);
    const r = runPrecheck(data, { m1: '' }, okEncoder);
    expect(r.errors.some((e) => e.code === 'missing-url')).toBe(true);
    expect(r.errors.some((e) => e.code === 'missing-media')).toBe(false);
  });
  it('字幕片无 mediaId 不参与缺失检查', () => {
    const sub = { id: 's', trackId: 't-sub', type: 'subtitle', start: 0, duration: 3, text: 'x', visible: true, style: { fontSize: 48, color: '#FFF', letterSpacing: 0 } } as SubtitleClip;
    const data = mk([sub], [{ id: 't-sub', type: 'subtitle' }]);
    expect(runPrecheck(data, {}, okEncoder).errors).toHaveLength(0);
  });
  it('编码器不支持 → encoder-video / encoder-audio 错误', () => {
    const data = mk([vc('v', 'm1', 0, 5)], [{ id: 't-video', type: 'video' }]);
    expect(runPrecheck(data, urls('m1'), { video: false, audio: true }).errors.some((e) => e.code === 'encoder-video')).toBe(true);
    expect(runPrecheck(data, urls('m1'), { video: true, audio: false }).errors.some((e) => e.code === 'encoder-audio')).toBe(true);
  });
  it('内存 >1GB 警告但不算错误（放行）', () => {
    const data = mk([vc('v', 'm1', 0, 900), vc('v2', 'm2', 0, 900), ac('a', 'm3', 0, 900)], [{ id: 't-video', type: 'video' }, { id: 't-audio1', type: 'audio' }]);
    const r = runPrecheck(data, urls('m1', 'm2', 'm3'), okEncoder);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings.some((w) => w.code === 'memory')).toBe(true);
  });
  it('空工程（duration=0）→ empty 错误（前置拦截）', () => {
    const data = mk([], [{ id: 't-video', type: 'video' }]);
    expect(runPrecheck(data, {}, okEncoder).errors.some((e) => e.code === 'empty')).toBe(true);
  });
});
