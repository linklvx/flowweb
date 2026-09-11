import type { ProjectData } from '../types';
import { selectActiveClips } from '../scene/active-clips';
import { interpolateClip, type SubtitleRenderState, type VisualRenderState } from '../scene/interpolate';
import { canvasSizeOf, type CanvasSize } from '../timeline/canvas-size';
import type { SubtitleLayer, VisualLayer } from './canvas-renderer';
import type { WrappedFrame } from './video-cache';

/** deps 全量注入可测。视频片经 UrlSource 取帧（A3——getMediaUrl 直连 presigned URL）；
 *  图片片与未来其他 blob 消费走 getBlob（createImageBitmap 需全量 blob）。 */
export interface FrameRenderDeps {
  video: { getFrame(mediaId: string, url: string, time: number): Promise<WrappedFrame | null> };
  images: { getImageBitmap(mediaId: string, blob: Blob): Promise<ImageBitmap | null> };
  getMediaUrl: (mediaId: string) => string | undefined;
  getBlob: (mediaId: string) => Promise<Blob | null>;
  renderer: { draw(visual: VisualLayer[], subtitles: SubtitleLayer[], size: CanvasSize): void };
}

/** 单帧渲染编排：selectActiveClips → interpolateClip → 取源（videoCache/imageCache）→ renderer.draw。
 *  deps 全量注入可测；生产装配在 hooks/playback.ts（makeFrameDeps）——renderer 层不 import store，依赖方向由 playback 层承担。 */
export async function renderFrameAt(data: ProjectData, t: number, deps: FrameRenderDeps): Promise<void> {
  const visual: VisualLayer[] = [];
  const subs: SubtitleLayer[] = [];
  for (const { clip } of selectActiveClips(data, t)) {
    const state = interpolateClip(data, clip.id, t);
    if (state.kind === 'subtitle') { subs.push({ state }); continue; }
    if (clip.type === 'image') {
      const blob = await deps.getBlob(clip.mediaId);
      if (!blob) continue;
      const bmp = await deps.images.getImageBitmap(clip.mediaId, blob);
      if (bmp) visual.push({ source: bmp, srcW: bmp.width, srcH: bmp.height, state });
    } else if (clip.type === 'video') { // 偏离：计划为裸 else——TS 窄化后 else 含 SubtitleClip（无 mediaId）报 tsc 2339；运行时 audio 已被 selectActiveClips 剔除、subtitle 恒走上方 continue，此处可达者仅 video，行为等价
      const url = deps.getMediaUrl(clip.mediaId);
      if (!url) continue;
      const frame = await deps.video.getFrame(clip.mediaId, url, (state as { sourceTime: number }).sourceTime!);
      if (frame) visual.push({ source: frame.canvas, srcW: frame.canvas.width, srcH: frame.canvas.height, state });
    }
  }
  deps.renderer.draw(visual, subs, canvasSizeOf(data));
}
