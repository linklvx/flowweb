import { useEditorStore } from '../store/editorStore';
import { audioEngine } from '../audio-engine/engine';
import { totalDuration } from '../timeline/timecode';
import { resolveMediaBlob } from '../renderer/media-blob';
import { videoCache } from '../renderer/video-cache';
import { getImageBitmap, clearImageBitmaps } from '../renderer/image-cache';
import { CanvasRenderer } from '../renderer/canvas-renderer';
import type { FrameRenderDeps } from '../renderer/render-frame';

const clampT = (t: number) => {
  const es = useEditorStore.getState();
  return Math.max(0, Math.min(t, es.data ? totalDuration(es.data) : 0));
};
const resolveBlob = (mediaId: string) => resolveMediaBlob(mediaId, useEditorStore.getState().mediaInfo[mediaId]?.url);

const mediaUrlOf = (mediaId: string) => useEditorStore.getState().mediaInfo[mediaId]?.url;

export function makeFrameDeps(ctx: CanvasRenderingContext2D): FrameRenderDeps {
  return {
    video: videoCache,
    images: { getImageBitmap },
    getMediaUrl: mediaUrlOf, // A3：视频 UrlSource 直连（决策 1）
    getBlob: resolveBlob,    // 图片 ImageBitmap 用（音频解码亦经 resolveBlob）
    renderer: new CanvasRenderer(ctx),
  };
}

export async function togglePlayback(): Promise<void> {
  const es = useEditorStore.getState();
  if (es.status !== 'ready' || !es.data) return;
  if (es.playing) { stopPlayback(); return; }
  if (es.preparing) return;
  es.setPreparing(true);
  try {
    await audioEngine.prepare(es.data, resolveBlob);
  } finally {
    useEditorStore.getState().setPreparing(false);
  }
  useEditorStore.getState().setPlaying(true); // prepare 完成后同起点起播（决策 14）
}

export function stopPlayback(): void {
  audioEngine.stop();
  useEditorStore.getState().setPlaying(false);
}

/** 单击/键盘 seek：setPlayhead + 播放中重锚重排（低频路径，直接 playFrom） */
export function seekPlayback(t: number): void {
  const es = useEditorStore.getState();
  if (!es.data) return;
  const tt = clampT(t);
  es.setPlayhead(tt);
  if (es.playing) audioEngine.playFrom(es.data, tt); // G4：bufferCache 已复用，重排无全量复制
}

// ---- 拖拽 seek 三段式（G4 决策 6②：move 只动播放头，up 才重排）----
let scrubWasPlaying = false;
let scrubActive = false; // R3 五-3：running 守卫——标尺/画布等多 scrub 源交错时防串状态

/** 标尺/画布拖拽开始：播放中则停音频+退 rAF（静音拖拽——决策 6②），仅移动播放头 */
export function scrubBegin(t: number): void {
  const es = useEditorStore.getState();
  if (scrubActive) { // 上一轮未 up（异常路径）——先按上轮状态收口再重入
    if (scrubWasPlaying) es.setPlaying(true);
  }
  scrubActive = true;
  scrubWasPlaying = es.playing;
  if (es.playing) { audioEngine.stop(); es.setPlaying(false); } // rAF 循环随 playing=false 退出
  es.setPlayhead(clampT(t));
}

export function scrubMove(t: number): void {
  if (!scrubActive) return;
  useEditorStore.getState().setPlayhead(clampT(t)); // 纯播放头——G1 暂停态单帧 effect 出画
}

export function scrubEnd(): void {
  if (!scrubActive) return;
  scrubActive = false;
  if (scrubWasPlaying) useEditorStore.getState().setPlaying(true); // effect 内 playFrom(playhead) 重锚（prepare 已缓存幂等）
}

/** 编辑器收起时的运行时释放（spec 边界护栏） */
export function releaseEditorRuntime(): void {
  stopPlayback();
  audioEngine.releasePcm();
  audioEngine.suspend();
  videoCache.release();
  clearImageBitmaps();
}
