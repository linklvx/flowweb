// packages/shared/src/canvas/expandedFrame.ts
// R2d-1（§4.9 改道）：展开帧单源——折叠组展开/加载补缺共用的纯函数阶梯。
// 消费方：canvasStore.toggleCollapse（展开档）；normalizeLoadedCanvas 消费点已随 O0b-0 整删。
import { calcGroupBounds, calcStoryboardSize, COLLAPSED_SIZE } from './geometry';
import { DEFAULT_STORYBOARD_CONFIG } from './storyboardConfig';
import type { StoryboardConfig } from '../types/group';

/** 展开帧：width/height 恒有；origin 仅守恒重算档返回（绝对原点≠组现位——caller 须 moveNode 落位，
 *  其余档 caller 保持组现位不挪）。 */
export interface ExpandedFrame {
  width: number;
  height: number;
  origin?: { x: number; y: number };
}

export interface ResolveExpandedFrameArgs {
  /** 组节点 data（读 savedSize 密封快照 + groupType 判档——不读 collapsed：caller 决定展开语境） */
  data: Record<string, unknown>;
  /** 子节点绝对 rect（rel+组原点；尺寸兜底 DEFAULT_CHILD_SIZE 由 caller 做）——守恒档输入 */
  childrenAbs?: { x: number; y: number; width: number; height: number }[];
  /** 已解析分镜配置（caller 经 resolveStoryboardConfig+缺格 calcDefaultGrid 派生——本函数不做第二份派生） */
  config?: StoryboardConfig;
}

/** savedSize 密封性判定（v2.2：有限且正的宽高才算有效快照——缺键/非有限/≤0/数组形态全落堵洞档） */
function isValidSavedSize(v: unknown): v is { width: number; height: number } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as { width?: unknown; height?: unknown };
  return typeof s.width === 'number' && Number.isFinite(s.width) && s.width > 0
    && typeof s.height === 'number' && Number.isFinite(s.height) && s.height > 0;
}

/** 展开帧阶梯（§4.9 v2.2 裁决单源）：
 *  ① 有效 savedSize（密封快照——等价性仅 normal 组；分镜组不可折叠，其 data 上的 savedSize 是
 *     脏数据，normalizeLoadedCanvas 加载边界剥键后才会进入本函数）；
 *  ② storyboard → calcStoryboardSize(resolved config)（配置是分镜框真理）；
 *  ③ 守恒重算（childrenAbs bbox+padding——frame 绝对，origin 随返回）；
 *  ④ 空组 → COLLAPSED_SIZE（不造 0×0——calcGroupBounds 空集=Infinity 垃圾，须先档空）。 */
export function resolveExpandedFrame({ data, childrenAbs, config }: ResolveExpandedFrameArgs): ExpandedFrame {
  const s = data.savedSize;
  if (isValidSavedSize(s)) return { width: s.width, height: s.height };
  if (data.groupType === 'storyboard') {
    const cfg = config ?? DEFAULT_STORYBOARD_CONFIG;
    const size = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
    return { width: size.width, height: size.height };
  }
  if (childrenAbs && childrenAbs.length > 0) {
    const frame = calcGroupBounds(childrenAbs);
    return { width: frame.width, height: frame.height, origin: { x: frame.x, y: frame.y } };
  }
  return { width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height };
}
