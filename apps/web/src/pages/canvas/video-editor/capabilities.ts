export interface VideoEditorCapabilities {
  /** 预览依赖解码器三件（spec 边界护栏：编辑入口检测；VideoEncoder/AAC 属导出弹层，Plan 4） */
  canPreview: boolean;
}

export function detectVideoEditorCapabilities(): VideoEditorCapabilities {
  const g = globalThis as Record<string, unknown>;
  const canPreview = typeof g.VideoDecoder === 'function'
    && typeof g.AudioDecoder === 'function'
    && typeof g.OffscreenCanvas === 'function';
  return { canPreview };
}

export interface ExportCapabilities { video: boolean; audio: boolean; }
export interface ExportCapsDeps {
  // 宽签名 (c: string, o?: object) 在 strictFunctionTypes 下接收不了真实 mediabunny 函数
  // （codec 参数是 'avc'|'hevc'|... 字面量联合——参数逆变 TS2322）——直接 Pick 真实模块类型
  loadMediabunny: () => Promise<Pick<typeof import('mediabunny'), 'canEncodeVideo' | 'canEncodeAudio'>>;
  loadAacPolyfill: () => Promise<{ registerAacEncoder: () => void }>;
}
/** 导出弹层打开时检测（编码器检测推迟到点导出）。真实 config：1080p avc + 48k 立体声 AAC。
 *  probeSize：探测编码尺寸（ExportModal 传 computeExportSize(canvasSizeOf(data), '1080p')——9:16/21:9 工程探测尺寸不失真），缺省 16:9 基准。
 *  本函数在主线程注册 AAC polyfill（拉起一个常驻 worker）作探针复测——无功能问题；
 *  Worker 内（后续 Task）会注册自己的副本，两处注册幂等不冲突。 */
export async function detectExportCapabilities(deps: ExportCapsDeps = {
  loadMediabunny: () => import('mediabunny'),
  loadAacPolyfill: () => import('@mediabunny/aac-encoder'),
}, probeSize: { width: number; height: number } = { width: 1920, height: 1080 }): Promise<ExportCapabilities> {
  if (typeof VideoEncoder === 'undefined' && typeof AudioEncoder === 'undefined') return { video: false, audio: false };
  const mb = await deps.loadMediabunny();
  const video = await mb.canEncodeVideo('avc', { ...probeSize, bitrate: 12_000_000 })
    .catch((e) => { console.warn('[capabilities] 编码检测异常:', e); return false; });
  let audio = await mb.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48_000, bitrate: 128_000 })
    .catch((e) => { console.warn('[capabilities] 编码检测异常:', e); return false; });
  if (!audio) {
    // AAC 静默动态 polyfill（注册后复测）
    (await deps.loadAacPolyfill()).registerAacEncoder();
    audio = await mb.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48_000, bitrate: 128_000 })
      .catch((e) => { console.warn('[capabilities] 编码检测异常:', e); return false; });
  }
  return { video: Boolean(video), audio: Boolean(audio) };
}
