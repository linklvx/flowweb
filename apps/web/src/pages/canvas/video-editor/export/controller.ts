// apps/web/src/pages/canvas/video-editor/export/controller.ts
import type { ExportResolution } from '@flowweb/shared';
import type { ProjectData } from '../types';
import { totalDuration } from '../timeline/timecode';
import { renderFrameAt, type FrameRenderDeps } from '../renderer/render-frame';

export const EXPORT_FPS = 30;
export class ExportCanceledError extends Error {
  constructor() { super('export canceled'); this.name = 'ExportCanceledError'; }
}

/** mediabunny Output 装配抽象（Worker 真实实现/测试 mock；audioTrack 在 hasAudio 时才非 null）。
 *  音频契约是 raw f32（channels + sampleRate）——AudioBuffer/Web Audio 不进 Worker；
 *  交织/分块/AudioSample 构造是装配侧（Task 8）内部细节，controller 只调一次 add。
 *  createOutput 是 async——Worker 侧 AAC 守卫在 hasAudio 分支内 await。
 *  非 abort 错误（start/add/finalize 抛错）不做 output.cancel()——半成品处置归 Worker 生命周期（terminate 丢弃 FSA swap/整体回收），勿在此补 cancel-on-error。 */
export interface ExportOutput {
  videoTrack: { add(timestamp: number, duration: number): Promise<void> };
  audioTrack: { add(channels: Float32Array[], sampleRate: number): Promise<void> } | null;
  start(): Promise<void>;
  finalize(): Promise<void>;
  cancel(): Promise<void>;
}
export interface ExportControllerDeps extends FrameRenderDeps {
  /** 全时间线混音（Task 6 纯函数注入）；onMixProgress 为 mix 阶段进度 */
  mixdown(data: ProjectData, onMixProgress?: (ratio: number) => void): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null>;
  createOutput(opts: { hasAudio: boolean }): Promise<ExportOutput>;
  onProgress: (phase: 'mix' | 'encode', ratio: number) => void;
  signal: AbortSignal;
}

/** 导出编排（依赖注入，jsdom 可测）：
 *  混音 → 装配 Output（hasAudio 决定音轨）→ start → 音频单次 add → 逐帧 renderFrameAt（复用预览渲染）→ videoTrack.add → finalize。
 *  VideoFrame 纪律：本函数零 `new VideoFrame`——CanvasSink→canvas→drawImage→CanvasSource.add 由 mediabunny 内部管理。 */
export async function runExport(data: ProjectData, _resolution: ExportResolution, deps: ExportControllerDeps): Promise<void> {
  const duration = totalDuration(data);
  if (duration <= 0) throw new Error('空工程不可导出');
  if (deps.signal.aborted) throw new ExportCanceledError();

  // 段 1：离线混音（进度经 onProgress('mix')）
  const mixed = await deps.mixdown(data, (r) => deps.onProgress('mix', r));
  deps.onProgress('mix', 1);

  const output = await deps.createOutput({ hasAudio: !!mixed }); // async 契约
  await output.start();

  if (mixed) {
    if (deps.signal.aborted) { await output.cancel(); throw new ExportCanceledError(); }
    await output.audioTrack!.add([mixed.left, mixed.right], mixed.sampleRate); // raw f32 一次交付（分块在装配侧）
  }

  // 段 2：逐帧编码（renderFrameAt 全注入——绘制到 Worker 的 OffscreenCanvas）
  const totalFrames = Math.round(duration * EXPORT_FPS);
  for (let f = 0; f < totalFrames; f++) {
    if (deps.signal.aborted) { await output.cancel(); throw new ExportCanceledError(); }
    const t = f / EXPORT_FPS;
    await renderFrameAt(data, t, deps);
    if (deps.signal.aborted) { await output.cancel(); throw new ExportCanceledError(); }
    await output.videoTrack.add(t, 1 / EXPORT_FPS);
    deps.onProgress('encode', (f + 1) / totalFrames);
  }
  await output.finalize();
}
