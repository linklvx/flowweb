// packages/shared/src/canvas/intrinsicFit.ts
// T17（plan v11.2 S5 片·spec Z5'' 维持 v10/:78）：applyIntrinsicFit=**纯函数**——内在尺寸消费
// 单源（尺寸域收口）：
//   - **store 数据源**：natural（Media facts 固有尺寸——EXIF 未应用的存储尺寸）优先；缺席回落
//     display（浏览器报告尺寸——display 契约）。
//   - **display 契约 EXIF 5-8**：natural 与 display 同时在且互为转置（n.w=d.h ∧ n.h=d.w ∧ 非方形）
//     ⇒ EXIF 横竖交换档——有效内在尺寸取 display 形态（EXIF 5-8 已交换，禁二次交换）。
//   - **imageRotation 用户变换交换**：90/270 ⇒ 有效尺寸 W/H 再交换（旋转后盒=转置足迹）；
//     0/180 不交换（G56「二次旋转」红锚——旋转后重 load 不得回弹未旋尺寸）。
//   - **分镜跳过**：分镜子尺寸=格尺寸域（capacity/CELL_WIDTH 权威）——零尺寸写。
//   - **sizeMode**：'fixed'=作者手改档——零覆盖写（'auto'=本函数域）。
//   - **clamp**：calcConstrainedSize 滚动约束框（ceil 单源）；冷启动（无 currentWH）必写。
//   - 沿用档（contentEventSize 同族）：比例未变 ⇒ changed=false 零写；比例变 ⇒ adaptToFit。
//   - viewer 公开页 fit 属 G28 域（payload natural 注入）——本函数纯输入纯输出可直接复用。
import { adaptToFit, calcConstrainedSize, type SizeBounds } from './geometry';
import { normalizeSize } from './docShape';

export type ImageRotationQuarter = 0 | 90 | 180 | 270;

export interface IntrinsicFitInput {
  /** 现盒（cs 信封 wh——缺=冷启动首帧必写）。 */
  currentWH?: { width: number; height: number } | null;
  /** 浏览器报告尺寸（EXIF 5-8 已应用——display 契约；natural 缺席时的回落源）。 */
  display?: { width: number; height: number } | null;
  /** 媒体固有尺寸（store 数据源——Media facts natural；EXIF 未应用的存储尺寸）。 */
  natural?: { width: number; height: number } | null;
  /** 用户变换旋转（0/90/180/270——90/270 交换有效尺寸）。 */
  imageRotation?: ImageRotationQuarter;
  /** 分镜子（跳过——尺寸=格域）。 */
  isStoryboardChild?: boolean;
  /** 尺寸档：'fixed'=作者手改零覆盖；'auto'=本函数域（缺省）。 */
  sizeMode?: 'auto' | 'fixed';
  /** 滚动约束框（clamp）。 */
  bounds: SizeBounds;
  /** 已立档比例（ratio 变化判定——contentEventSize 同族沿用/重算分档）。 */
  existingAspectRatio?: number;
}

export interface IntrinsicFitResult {
  size: { width: number; height: number };
  /** 旋转交换后的有效比例（调用方 updateConfig 立档用——与 contentEventSize.aspectRatio 同位）。 */
  aspectRatio: number;
  /** changed=true ⇒ 调用方提交 envelope{wh}；false 沿用档零写。 */
  changed: boolean;
}

const swapWH = (s: { width: number; height: number }) => ({ width: s.height, height: s.width });

/** 冷启动兜底盒（质评 Minor#6：548×306 魔数单源——ratioDimensions 非法比例兜底同值族）。 */
const INTRINSIC_FIT_COLD_FALLBACK = { width: 548, height: 306 } as const;

/** 兜底档共用出口（分镜跳过/fixed/双源缺席）：沿用 currentWH，缺则冷启动兜底盒过约束框。 */
const keepCurrent = (
  currentWH: { width: number; height: number } | null | undefined,
  bounds: SizeBounds,
): IntrinsicFitResult => {
  const fallback = currentWH ?? (() => {
    const c = calcConstrainedSize(INTRINSIC_FIT_COLD_FALLBACK.width, INTRINSIC_FIT_COLD_FALLBACK.height, bounds);
    return { width: c.w, height: c.h };
  })();
  return { size: { ...fallback }, aspectRatio: fallback.width / fallback.height, changed: false };
};

/** applyIntrinsicFit（Z5'' 纯函数——全 facet：EXIF 5-8/imageRotation 交换/分镜跳过/sizeMode/clamp）。 */
export function applyIntrinsicFit(input: IntrinsicFitInput): IntrinsicFitResult {
  const {
    currentWH, display, natural, imageRotation = 0,
    isStoryboardChild = false, sizeMode = 'auto', bounds, existingAspectRatio,
  } = input;

  // 分镜跳过 / fixed 档：零尺寸写（沿用 currentWH；冷启动分镜子回落兜底盒——格域权威在渲染层）
  if (isStoryboardChild || sizeMode === 'fixed') {
    return keepCurrent(currentWH, bounds);
  }

  // 有效内在尺寸：store 数据源（natural）优先；EXIF 5-8 转置档（natural/display 互为转置）取
  // display 形态（EXIF 已交换——防二次交换）；双缺席=无内在面（沿用档）
  let effective: { width: number; height: number } | null = null;
  if (natural != null && display != null
    && natural.width === display.height && natural.height === display.width
    && natural.width !== natural.height) {
    effective = { ...display };   // EXIF 5-8：display 已应用横竖交换
  } else if (natural != null) {
    effective = { ...natural };   // store 数据源（无 EXIF 面/display 缺席）
  } else if (display != null) {
    effective = { ...display };   // 回落 display 契约
  }
  if (effective == null || !Number.isFinite(effective.width) || !Number.isFinite(effective.height)
    || effective.width <= 0 || effective.height <= 0) {
    return keepCurrent(currentWH, bounds);   // 双源缺席/非法——沿用档
  }

  // imageRotation 用户变换交换（G56：90/270 转置足迹——二次旋转红锚）
  if (imageRotation === 90 || imageRotation === 270) effective = swapWH(effective);
  const aspectRatio = effective.width / effective.height;

  // 沿用/重算分档（contentEventSize 同族）：现盒在 ∧ 比例未漂 ⇒ 沿用零写；比例漂 ⇒ adaptToFit
  if (currentWH != null) {
    const ratioChanged = existingAspectRatio != null && Math.abs(aspectRatio - existingAspectRatio) > 0.01;
    // 旋转变换落地窗：90/270 且现盒仍是未旋形态（比例不符旋转后比例）⇒ 重算（含比例漂同路）
    const rotatedMismatch = imageRotation === 90 || imageRotation === 270
      ? Math.abs(currentWH.width / currentWH.height - aspectRatio) > 0.01
      : false;
    if (!ratioChanged && !rotatedMismatch) {
      return { size: { ...currentWH }, aspectRatio, changed: false };   // 沿用档零写
    }
    const fit = adaptToFit(currentWH, aspectRatio);
    return { size: { width: normalizeSize(fit.width), height: normalizeSize(fit.height) }, aspectRatio, changed: true };
  }

  // 冷启动首帧：clamp 约束框
  const c = calcConstrainedSize(effective.width, effective.height, bounds);
  return { size: { width: c.w, height: c.h }, aspectRatio, changed: true };
}
