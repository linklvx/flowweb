// packages/shared/src/canvas/geometry.ts
// R1b Task 16：apps/web/src/utils/groupLayout.ts 整模块下沉（逐字迁入 + import type 改自 '../types/group'），
// 新增 DEFAULT_CHILD_SIZE / COLLAPSED_SIZE / refitGroupGeometry / shouldAutoRefit / RATIO_MAP / clampChildIntoGroup。
// O0b-1（Spec B）：deriveGroupFrame 写域①四模式单源落位（storyboard=calcStoryboardSize 无 padding/
// collapsed=COLLAPSED_SIZE 档优先级最高[终裁 82]/manual=storedFrame 密封/auto=calcGroupBounds；
// mode oracle=frameMode(doc storedFrame)——帧装配算术实现点=1 calcGroupBounds，禁自写 padding 公式）。
import type { AspectRatio } from '../types/group';
import { frameMode, isCollapsed, isValidStoredFrame, type Rect } from './docShape';
import { resolveStoryboardConfig } from './storyboardConfig';

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
 *  另含 applyGroupFrame/addToGroup 分支 A/assertInvariant 派生公式点；normalizeLoadedCanvas 消费点已随 O0b-0 整删） */
export const DEFAULT_CHILD_SIZE = { width: 280, height: 120 } as const;

/** 折叠组尺寸（R2d-2 改值 220×160；原 canvasStore.ts/NormalGroupRenderer.tsx 两处内联 200×64——R1b 单源化） */
export const COLLAPSED_SIZE = { width: 220, height: 160 } as const;

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
  groupSize: { width: number | null | undefined; height: number | null | undefined },
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

/** O0b-5 refit 退役接替谓词（shouldAutoRefit 整删——终裁 50 manuallyResized 标记域废除，clamp
 *  谓词从"标记域"（data.manuallyResized）改 doc 帧键形态 oracle）：auto ∧ !collapsed——
 *  即"帧由内容派生（bbox+padding）"的组。manual（storedFrame 三键齐）/storyboard/collapsed → false
 *  （帧固定语义——折叠组入组落点走 clamp 档；cs 折叠渲染档=COLLAPSED_SIZE 由 reconcile 写域①
 *  collapsed 分支承担）。mode oracle=frameMode(doc 侧键)——storedFrame 禁喂 cs 派生帧（终裁 44）。 */
export function isContentDerivedFrame(input: {
  data: Record<string, unknown>;
  storedFrame?: { position?: { x: number; y: number }; width?: number; height?: number };
}): boolean {
  const mode = frameMode(input);
  return mode === 'auto' && !isCollapsed(input.data);
}

/** 帧值面（doc 侧帧三键/cs 活值帧共用形——deriveGroupFrame 入参）。 */
export interface GroupStoredFrame {
  position?: { x: number; y: number };
  width?: number;
  height?: number;
}

/** O0b-1 组帧派生四模式单源（reconcile 写域①——组 position 唯一写者的值来源，后续消费共用）：
 *  - storyboard：尺寸=calcStoryboardSize（resolveStoryboardConfig 单源，无 padding）；
 *    origin=帧 position 键（键集表：组 position⟺manual∨storyboard）；'cs' 源活值 wh 优先（命令中间态）。
 *  - collapsed（非 storyboard）⇒COLLAPSED_SIZE 档、优先级最高（终裁 82——doc 三键保持展开态值不动）；
 *    origin：manual=密封 origin（帧 position 键）/auto=照旧 bbox 派生/空组兜底 fallbackOrigin。
 *  - manual：storedFrame 三键密封（'cs' 源=liveFrame 活值，活值三键缺任一回落密封源）。
 *  - auto：calcGroupBounds(childrenAbs)（帧装配算术实现点=1——禁调用方自写 padding 公式）；
 *    空 auto 组→COLLAPSED_SIZE@fallbackOrigin；liveFrame 不参与 auto（恒派生）。
 *  mode oracle=frameMode(doc storedFrame)——禁 cs 派生帧当 storedFrame（终裁 44，auto 防死锁）：
 *  liveFrame 只被 manual/storyboard 的值面消费，永不参与模式判定。 */
export function deriveGroupFrame(input: {
  data: Record<string, unknown>;
  childrenAbs: readonly { x: number; y: number; width: number; height: number }[];
  storedFrame?: GroupStoredFrame;
  liveFrame?: GroupStoredFrame;
  fallbackOrigin?: { x: number; y: number };
}): Rect {
  const { data, childrenAbs, storedFrame, liveFrame, fallbackOrigin } = input;
  const mode = frameMode({ data, storedFrame });
  if (mode === 'storyboard') {
    const cfg = resolveStoryboardConfig(data);
    const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
    const origin = liveFrame?.position ?? storedFrame?.position ?? fallbackOrigin ?? { x: 0, y: 0 };
    return {
      x: origin.x, y: origin.y,
      width: liveFrame?.width ?? size.width,
      height: liveFrame?.height ?? size.height,
    };
  }
  if (isCollapsed(data)) {
    const sealedOrigin = mode === 'manual' ? (liveFrame?.position ?? storedFrame?.position) : undefined;
    // sealedOrigin 命中⇒bbox 惰性跳过（origin 消费面只认密封 origin——O0b-1 质评一行版）
    const b = sealedOrigin ? undefined : (childrenAbs.length > 0 ? calcGroupBounds([...childrenAbs]) : undefined);
    const origin = sealedOrigin ?? (b ? { x: b.x, y: b.y } : undefined) ?? fallbackOrigin ?? { x: 0, y: 0 };
    return { x: origin.x, y: origin.y, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height };
  }
  if (mode === 'manual') {
    // mode=manual ⇒ storedFrame 三键齐且有效（isValidStoredFrame 已过）——非空断言安全
    const f = liveFrame
      && liveFrame.position
      && isValidStoredFrame(liveFrame)
      ? liveFrame
      : storedFrame!;
    return { x: f.position!.x, y: f.position!.y, width: f.width!, height: f.height! };
  }
  if (childrenAbs.length === 0) {
    const origin = fallbackOrigin ?? { x: 0, y: 0 };
    return { x: origin.x, y: origin.y, width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height };
  }
  const b = calcGroupBounds([...childrenAbs]);
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

// ══════════ O0b-2（Spec B）：尺寸取整/contain-fit/内容事件决策/multiImage 公式 单源 ══════════
// 终裁 59③/75/83④/91：adaptToFit 新名独立纯函数（不复用 web adaptCustomSize 名——该符号随
// customSize 并入 envelope 同批删除）；calcConstrainedSize/ratioDimensions 三份逐字重复收编单源
//（web census：定义点=1）；round 同批改 ceil（normalizeSize=Math.ceil 单源落 docShape——差 ≤1px）。

/** 尺寸约束 bounds（calcConstrainedSize/ratioDimensions 参数化——三组件常量不同）。 */
export interface SizeBounds {
  maxW: number;
  maxH: number;
  minW: number;
  minH: number;
}

/** contain-fit 约束尺寸（ImageGenNode/VideoGenNode/MultiImageNode 三份逐字重复收编单源——终裁 83④；
 *  Math.round 改 Math.ceil——终裁 59③ 取整单源，防同一节点两来源差 1px）。
 *  顺序：缩到 max 内（保比例）→ 抬到 min（可破 max——与 web 原实现同语义）。 */
export function calcConstrainedSize(
  naturalW: number,
  naturalH: number,
  bounds: SizeBounds,
): { w: number; h: number } {
  let w = naturalW;
  let h = naturalH;
  if (w > bounds.maxW) {
    h = Math.ceil(h * (bounds.maxW / w));
    w = bounds.maxW;
  }
  if (h > bounds.maxH) {
    w = Math.ceil(w * (bounds.maxH / h));
    h = bounds.maxH;
  }
  if (w < bounds.minW) w = bounds.minW;
  if (h < bounds.minH) h = bounds.minH;
  return { w, h };
}

/** contain-fit 适配（终裁 75——wh=滚动约束框：以当前框为约束适配新比例；新内容完整装入现框）。
 *  新名 adaptToFit（不复用 adaptCustomSize 名）；Math.round 改 Math.ceil（终裁 59③）。 */
export function adaptToFit(
  size: { width: number; height: number },
  newRatio: number,
): { width: number; height: number } {
  const fitByWidth = Math.ceil(size.width / newRatio);
  if (fitByWidth <= size.height) {
    return { width: size.width, height: fitByWidth };
  }
  return { width: Math.ceil(size.height * newRatio), height: size.height };
}

/** ratio 比例名（'16:9'）→约束尺寸（三份重复收编单源；非法比例兜底 548×306——原 web 实现同值）。 */
export function ratioDimensions(ratio: string, bounds: SizeBounds): { w: number; h: number } {
  const [rw, rh] = ratio.split(':').map(Number);
  if (!rw || !rh) return { w: 548, h: 306 };
  // 大 base 精确算比例再约束（原 web 实现同构）
  const base = 1000;
  const w = rw >= rh ? base : Math.round(base * (rw / rh));
  const h = rh >= rw ? base : Math.round(base * (rh / rw));
  return calcConstrainedSize(w, h, bounds);
}

/** multiImage 展开档宫格常量（MultiImageNode 本地常量上移单源——公式与组件共用同一纯函数，终裁 91）。 */
export const MULTI_IMAGE_CELL_SIZE = 150;
export const MULTI_IMAGE_GAP = 8;
export const MULTI_IMAGE_MAX_WIDTH = 548;
export const MULTI_IMAGE_STACKED_SIZE = { width: 400, height: 300 } as const;

/** multiImage 宫格列数（≤4 图 2 列/否则 3 列——组件 JSX 与尺寸公式共用单源）。 */
export function multiImageGridCols(imageCount: number): number {
  return imageCount <= 4 ? 2 : 3;
}

/** multiImage 尺寸纯函数（组件显式上报四类触发点共用——挂载首帧∪toggleExpanded∪增删图∪非展开态
 *  主图 load；收敛锚"上报后一致⇒不再上报"由调用侧同值去重承担）。 */
export function multiImageSize(
  imageCount: number,
  expanded: boolean,
  stackedSize?: { width: number; height: number },
): { width: number; height: number } {
  if (!expanded) return stackedSize ?? { ...MULTI_IMAGE_STACKED_SIZE };
  const gridCols = multiImageGridCols(imageCount);
  const gridRows = Math.ceil(imageCount / gridCols);
  return {
    width: Math.min(gridCols * MULTI_IMAGE_CELL_SIZE + (gridCols - 1) * MULTI_IMAGE_GAP + 24, MULTI_IMAGE_MAX_WIDTH),
    height: gridRows * MULTI_IMAGE_CELL_SIZE + (gridRows - 1) * MULTI_IMAGE_GAP + 48,
  };
}

/** 内容事件尺寸决策纯函数（终裁 59①[ii]+76+83⑤——三分支；handler 只吃 DOM 事件参数，禁测量/
 *  cs.wh/data 变更触发的结构性收口=决策不读 store）。changed=false ⇒ 调用方零 dispatch（沿用档
 *  "以当前 wh 为准"）；changed=true ⇒ updateNodeEnvelope{wh}（Origin.Geometry——允许覆盖）。
 *  aspectRatio 回传供调用方 updateConfig（键保留——ratioChanged 判定依赖，终裁 83⑤③）。 */
export function contentEventSize(input: {
  currentWH?: { width: number; height: number } | null;
  existingAspectRatio?: number;
  naturalW: number;
  naturalH: number;
  bounds: SizeBounds;
}): { size: { width: number; height: number }; aspectRatio: number; changed: boolean } {
  const { currentWH, existingAspectRatio, naturalW, naturalH, bounds } = input;
  const aspectRatio = naturalW / naturalH;
  const ratioChanged = currentWH && existingAspectRatio != null
    && Math.abs(aspectRatio - existingAspectRatio) > 0.01;
  if (currentWH && !ratioChanged) {
    // 类型谎言注明：ratio 未立档（cs 有 wh 但从未 load）时 existingAspectRatio 为 undefined——
    // changed=false 分支零消费；未来消费前需放宽返回类型。
    return { size: { ...currentWH }, aspectRatio: existingAspectRatio!, changed: false };  // 沿用档
  }
  if (currentWH && ratioChanged) {
    return { size: adaptToFit(currentWH, aspectRatio), aspectRatio, changed: true };        // contain-fit 重算
  }
  const c = calcConstrainedSize(naturalW, naturalH, bounds);                                // 冷启动首帧
  return { size: { width: c.w, height: c.h }, aspectRatio, changed: true };
}
