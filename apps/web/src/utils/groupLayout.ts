// apps/web/src/utils/groupLayout.ts
import type { AspectRatio } from '@/types/group';

export const CELL_WIDTH = 320;
export const CELL_GAP = 2;
export const CONVERT_GAP = 40;
export const GROUP_PADDING = 20;
export const GROUP_PADDING_TOP = 50;

export const ASPECT_RATIO_MAP: Record<AspectRatio, number> = {
  '21:9': 21 / 9, '16:9': 16 / 9, '9:16': 9 / 16,
  '3:4': 3 / 4, '4:3': 4 / 3, '1:1': 1,
};

export const STITCH_WIDTH_MAP = { '2K': 2048, '4K': 3840 } as const;

export function calcDefaultGrid(count: number): { rows: number; cols: number } {
  if (count <= 1) return { rows: 1, cols: 1 };
  if (count === 2) return { rows: 1, cols: 2 };
  if (count <= 4) return { rows: 2, cols: 2 };
  if (count <= 9) return { rows: 3, cols: 3 };
  if (count <= 16) return { rows: 4, cols: 4 };
  if (count <= 25) return { rows: 5, cols: 5 };
  const rows = Math.ceil(Math.sqrt(count));
  return { rows, cols: Math.ceil(count / rows) };
}

export function calcStoryboardSize(rows: number, cols: number, ratio: AspectRatio) {
  const cellWidth = CELL_WIDTH;
  const cellHeight = cellWidth / ASPECT_RATIO_MAP[ratio];
  return {
    width: cols * cellWidth + (cols - 1) * CELL_GAP,
    height: rows * cellHeight + (rows - 1) * CELL_GAP,
    cellWidth, cellHeight,
  };
}

export function calcStitchSize(rows: number, cols: number, ratio: AspectRatio, targetWidth: number) {
  const cellWidth = (targetWidth - (cols - 1) * CELL_GAP) / cols;
  const cellHeight = cellWidth / ASPECT_RATIO_MAP[ratio];
  return {
    width: targetWidth,
    height: Math.round(rows * cellHeight + (rows - 1) * CELL_GAP),
    cellWidth: Math.round(cellWidth), cellHeight: Math.round(cellHeight),
  };
}

export function sortNodesByPosition<T extends { positionX: number; positionY: number }>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) =>
    a.positionX - b.positionX || a.positionY - b.positionY);
}

export function calcGroupBounds(items: { x: number; y: number; width: number; height: number }[]) {
  const minX = Math.min(...items.map((i) => i.x)) - GROUP_PADDING;
  const minY = Math.min(...items.map((i) => i.y)) - GROUP_PADDING_TOP;
  const maxX = Math.max(...items.map((i) => i.x + i.width)) + GROUP_PADDING;
  const maxY = Math.max(...items.map((i) => i.y + i.height)) + GROUP_PADDING;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
