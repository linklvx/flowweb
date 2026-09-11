// apps/web/src/pages/canvas/video-editor/timeline/canvas-size.ts
import type { Clip, ProjectData } from '../types';

export interface CanvasSize { width: number; height: number; }

/** C 档画布 6 档 preset（spec 5.1 D6） */
export const CANVAS_PRESETS: ReadonlyArray<{ label: string; size: CanvasSize }> = [
  { label: '16:9', size: { width: 1920, height: 1080 } },
  { label: '9:16', size: { width: 1080, height: 1920 } },
  { label: '21:9', size: { width: 2560, height: 1080 } },
  { label: '3:4',  size: { width: 1080, height: 1440 } },
  { label: '4:3',  size: { width: 1440, height: 1080 } },
  { label: '1:1',  size: { width: 1080, height: 1080 } },
];

export const DEFAULT_CANVAS_SIZE: CanvasSize = CANVAS_PRESETS[0].size;

export function canvasSizeOf(data: Pick<ProjectData, 'canvasSize'> | null | undefined): CanvasSize {
  return data?.canvasSize ?? DEFAULT_CANVAS_SIZE;
}

/** 切换比例：中心点等比重映射，keyframes.value（绝对值）同步（spec 5.1） */
export function remapForCanvasSize(clips: Clip[], from: CanvasSize, to: CanvasSize): Clip[] {
  const sx = to.width / from.width, sy = to.height / from.height;
  return clips.map((c) => {
    if (c.type === 'subtitle' || c.type === 'audio') return c; // 无 transform
    const t = { ...c.transform, x: c.transform.x * sx, y: c.transform.y * sy };
    const keyframes = c.keyframes.map((k) => (
      k.property === 'x' ? { ...k, value: k.value * sx } :
      k.property === 'y' ? { ...k, value: k.value * sy } : k
    ));
    return { ...c, transform: t, keyframes };
  });
}

// R17-F5②：LAST_ASPECT_KEY 常量在本文件导出（Shell/EditorTopBar 双方消费）——
// ⚠ R18-G4：消费方 import，禁止在调用侧重复声明
export const LAST_ASPECT_KEY = 've-last-canvas-preset';
