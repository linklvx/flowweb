// packages/shared/src/canvas/geometry.ts
// R1b Task 16：apps/web/src/utils/groupLayout.ts 整模块下沉（逐字迁入 + import type 改自 '../types/group'），
// 新增 DEFAULT_CHILD_SIZE / COLLAPSED_SIZE / refitGroupGeometry / shouldAutoRefit / RATIO_MAP / clampChildIntoGroup。
import type { AspectRatio } from '../types/group';

export const CELL_WIDTH = 320;
export const CELL_GAP = 2;
export const CONVERT_GAP = 40;
export const GROUP_PADDING = 20;
export const GROUP_PADDING_TOP = 50;

export const ASPECT_RATIO_MAP: Record<AspectRatio, number> = {
  '21:9': 21 / 9, '16:9': 16 / 9, '9:16': 9 / 16,
  '3:4': 3 / 4, '4:3': 4 / 3, '1:1': 1,
};

/** API 索引兼容面，web 勿用（web 用类型安全的 ASPECT_RATIO_MAP）——
 *  stitch.consumer 的 `RATIO_MAP[d.aspectRatio]` 中 aspectRatio: string，Record<AspectRatio,...> 会 TS7053
 *  （原 apps/api stitch.size.ts 用 Record<string,...> 正是为此；值同源自 ASPECT_RATIO_MAP）。 */
export const RATIO_MAP: Record<string, number> = ASPECT_RATIO_MAP;

export const STITCH_WIDTH_MAP = { '2K': 2048, '4K': 3840 } as const;

/** 子节点缺测量时的 rect 基准（`?? 280 / ?? 120` 内联单源化——sweep 必含 Task 14 clamp 守卫
 *  的 canvasStore.ts onNodesChange 内 cw/ch 两行（唯一 measured 夹在 ?? 与字面量之间的位置——漏扫留最隐蔽不同源），
 *  另含 normalizeLoadedCanvas/applyGroupFrame/addToGroup 分支 A/assertInvariant 四处派生公式点） */
export const DEFAULT_CHILD_SIZE = { width: 280, height: 120 } as const;

/** 折叠组尺寸（现状 canvasStore.ts:1262 与 NormalGroupRenderer.tsx:44 两处内联 200×64——R1b 单源化） */
export const COLLAPSED_SIZE = { width: 200, height: 64 } as const;

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

export function clampPositionToPadding(
  position: { x: number; y: number },
  childSize: { width: number; height: number },
  groupSize: { width: number; height: number },
): { x: number; y: number } {
  const xMax = groupSize.width - GROUP_PADDING - childSize.width;
  const yMax = groupSize.height - GROUP_PADDING - childSize.height;
  return {
    x: Math.min(Math.max(position.x, GROUP_PADDING), xMax),
    y: Math.min(Math.max(position.y, GROUP_PADDING_TOP), yMax),
  };
}

/** 子入组 clamp 共享守卫：组宽/高任一不可用（null/undefined）或退化（xMax < GROUP_PADDING /
 *  yMax < GROUP_PADDING_TOP——组比 padding+子尺寸还小）→ 返回原 rel 不夹（防负坐标钉死）；
 *  否则 clampPositionToPadding。Task 14 拖拽期与 Task 18 placement 期同源。 */
export function clampChildIntoGroup(
  rel: { x: number; y: number }, childSize: { width: number; height: number },
  groupSize: { width: number | null; height: number | null },
): { x: number; y: number } {
  if (groupSize.width == null || groupSize.height == null) return rel;
  const xMax = groupSize.width - GROUP_PADDING - childSize.width;
  const yMax = groupSize.height - GROUP_PADDING - childSize.height;
  if (xMax < GROUP_PADDING || yMax < GROUP_PADDING_TOP) return rel;
  return clampPositionToPadding(rel, childSize, groupSize as { width: number; height: number });
}

export function calcGroupMinSize(
  items: { x: number; y: number; width: number; height: number }[],
): { minWidth: number; minHeight: number } {
  if (items.length === 0) return { minWidth: 200, minHeight: 120 };
  const minX = Math.min(...items.map((i) => i.x));
  const minY = Math.min(...items.map((i) => i.y));
  const maxX = Math.max(...items.map((i) => i.x + i.width));
  const maxY = Math.max(...items.map((i) => i.y + i.height));
  return {
    minWidth: maxX - minX + GROUP_PADDING * 2,
    minHeight: maxY - minY + GROUP_PADDING_TOP + GROUP_PADDING,
  };
}

/** 组几何唯一重算纯函数（契约 2/§4.8 v11）：输入子节点绝对 rect，输出 frame + 每子 rel（= abs − frame.origin）。
 *  守恒：重算型调用下子绝对坐标不变（rel 随 frame 补偿）——F33 整类根修。
 *  无 clamp（v11 推翻）：frame = bbox+padding 使 rel ∈ [padding, frame−padding−size] 恒成立（数学构造保证）；
 *  拖拽期真 clamp 在 onNodesChange（帧固定时）；placement 对不 refit 组的 clamp 见 addToGroup（Task 18）。 */
export function refitGroupGeometry(
  children: { x: number; y: number; width: number; height: number }[],
): { frame: { x: number; y: number; width: number; height: number }; rels: { x: number; y: number }[] } {
  const frame = calcGroupBounds(children);
  const rels = children.map((c) => ({ x: c.x - frame.x, y: c.y - frame.y }));
  return { frame, rels };
}

/** 契约 2 scope 门禁：组框 ≡ bbox+padding 仅适用于 normal && !collapsed && !manuallyResized */
export function shouldAutoRefit(group: { type: string; data?: Record<string, unknown> }): boolean {
  const d = (group.data ?? {}) as Record<string, unknown>;
  return group.type === 'group' && d.groupType !== 'storyboard' && !d.collapsed && !d.manuallyResized;
}
