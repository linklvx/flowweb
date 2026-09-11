/** 一次性首帧海报工厂（与播放缓存 video-cache 隔离——不进任何 LRU，用后即关）。
 *  失败返回 null 静默保持兜底底色（非致命路径），资源主口是 Input.dispose（CanvasSink 无 dispose，
 *  B1 实测同 video-cache.ts；formats 必填与 video-cache.ts:175 同款）。 */
export async function ensurePoster(url: string): Promise<string | null> {
  let input: { dispose(): void } | null = null;
  try {
    const { Input, UrlSource, CanvasSink, ALL_FORMATS } = await import('mediabunny');
    const inp = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    input = inp;
    const track = await inp.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new CanvasSink(track, { fit: 'contain' });
    const frame = await sink.getCanvas(0); // t=0 首帧，WrappedCanvas | null
    if (!frame) return null;
    return toJpegDataUrl(frame.canvas, 320);
  } catch { return null; } // 失败静默保持兜底底色（非致命路径）
  finally { try { input?.dispose(); } catch { /* 已释放 */ } } // 用后即关——一次性
}

/** 恒绘制进新 HTMLCanvasElement（≤maxW 等比缩）——不做早退返回 src：frame.canvas 是
 *  HTMLCanvasElement | OffscreenCanvas 联合（OffscreenCanvas 无 toDataURL），恒绘归一化类型。 */
function toJpegDataUrl(src: HTMLCanvasElement | OffscreenCanvas, maxW: number): string {
  const w = Math.min(maxW, src.width);
  const scale = w / src.width;
  const out = document.createElement('canvas');
  out.width = w; out.height = Math.max(1, Math.round(src.height * scale));
  out.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.7);
}
