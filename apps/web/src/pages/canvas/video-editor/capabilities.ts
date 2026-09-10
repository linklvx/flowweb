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
