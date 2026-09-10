import { describe, it, expect, vi } from 'vitest';
import { renderFrameAt, type FrameRenderDeps } from './render-frame';
import type { VideoCacheService, WrappedFrame } from './video-cache';
import type { CanvasRenderer } from './canvas-renderer';
import type { ProjectData, VideoClip } from '../types';

const mkDeps = (over: { frame?: WrappedFrame | null; bitmap?: { width: number; height: number } | null; url?: string } = {}): FrameRenderDeps & { video: { getFrame: ReturnType<typeof vi.fn> }; images: { getImageBitmap: ReturnType<typeof vi.fn> }; getMediaUrl: ReturnType<typeof vi.fn>; getBlob: ReturnType<typeof vi.fn> } => {
  const deps = {
    video: { getFrame: vi.fn(async () => over.frame ?? null) },
    images: { getImageBitmap: vi.fn(async () => over.bitmap ?? null) },
    getMediaUrl: vi.fn(() => over.url ?? 'http://u-mv'),
    getBlob: vi.fn(async () => new Blob(['x'])),
    renderer: { draw: vi.fn() },
  } as unknown as FrameRenderDeps & { video: { getFrame: ReturnType<typeof vi.fn> }; images: { getImageBitmap: ReturnType<typeof vi.fn> }; getMediaUrl: ReturnType<typeof vi.fn>; getBlob: ReturnType<typeof vi.fn> };
  return deps;
};

const vc = (id: string, start: number, duration: number): VideoClip => ({
  id, trackId: 'tv', type: 'video', start, duration, sourceStart: 0, mediaId: 'mv', playbackSpeed: 1,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [],
});
const dataWith = (clips: { id: string; start: number; duration: number; type: 'video' | 'image' | 'subtitle' }[]): ProjectData => {
  const d: ProjectData = {
    version: 1, fps: 30,
    tracks: [{ id: 'tv', type: 'video', name: 'V', muted: false, hidden: false, clips: [] },
             { id: 'ts', type: 'subtitle', name: 'S', muted: false, hidden: false, clips: [] }],
    clips: {},
  };
  for (const c of clips) {
    if (c.type === 'video') { d.clips[c.id] = vc(c.id, c.start, c.duration); d.tracks[0].clips.push(c.id); }
    else if (c.type === 'image') {
      d.clips[c.id] = { id: c.id, trackId: 'tv', type: 'image', start: c.start, duration: c.duration, mediaId: 'mi', transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] };
      d.tracks[0].clips.push(c.id);
    } else {
      d.clips[c.id] = { id: c.id, trackId: 'ts', type: 'subtitle', start: c.start, duration: c.duration, text: '字幕', visible: true, style: { fontSize: 48, color: '#FFFFFF', letterSpacing: 0 } };
      d.tracks[1].clips.push(c.id);
    }
  }
  return d;
};

describe('renderFrameAt（单帧渲染编排）', () => {
  it('视频片取帧：url+sourceTime 传给 videoCache，帧 canvas 进 draw', async () => {
    const frame = { canvas: { width: 1920, height: 1080 }, timestamp: 0, duration: 1 } as unknown as WrappedFrame;
    const deps = mkDeps({ frame });
    await renderFrameAt(dataWith([{ id: 'v', start: 0, duration: 5, type: 'video' }]), 2, deps);
    expect(deps.video.getFrame).toHaveBeenCalledWith('mv', 'http://u-mv', 2);
    expect(deps.renderer.draw).toHaveBeenCalledWith(
      [expect.objectContaining({ srcW: 1920, srcH: 1080 })],
      [],
    );
  });
  it('图片片走 imageCache；字幕进 subtitles 数组', async () => {
    const deps = mkDeps({ bitmap: { width: 800, height: 600 } });
    await renderFrameAt(dataWith([
      { id: 'img', start: 0, duration: 5, type: 'image' },
      { id: 'sub', start: 0, duration: 5, type: 'subtitle' },
    ]), 1, deps);
    expect(deps.images.getImageBitmap).toHaveBeenCalledWith('mi', expect.any(Blob));
    const [visual, subs] = (deps.renderer.draw as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(visual).toHaveLength(1);
    expect(subs).toHaveLength(1);
    expect(subs[0].state.text).toBe('字幕');
  });
  it('取帧失败/无 url：层跳过不炸（draw 仍执行）', async () => {
    const deps = mkDeps({ frame: null });
    deps.getMediaUrl = vi.fn(() => undefined); // A3：视频源缺 url 跳过
    await renderFrameAt(dataWith([{ id: 'v', start: 0, duration: 5, type: 'video' }]), 0, deps);
    expect(deps.renderer.draw).toHaveBeenCalledWith([], []);
  });
});
