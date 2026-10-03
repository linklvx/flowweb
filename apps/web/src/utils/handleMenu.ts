/** handle 拖拽弹菜单——守卫/决策纯函数与工具（spec 2026-09-26-image-node-panel-redesign §3.3）
 * 守卫顺序承重：reconnecting 必须最先（复位语义）；toNode 由 toHandle 派生、仅覆盖 handle 命中，
 * 节点体命中由 isPointOnAnyNode(绝对矩形) 单独承保。
 * B6-1（Spec B 终裁 57①）自 pages/canvas/components/ 迁入 utils/（13 符号全量）：
 * DRAG_THRESHOLD_PX 补导出=B6-3 点击/连线唯一阈值；clientPoint 多指落点修（终裁 37⑤）。 */
import type { HandleSide } from '@flowweb/shared';

export const HANDLE_MENU_NODE_TYPES = new Set(['imageGen', 'imageExtGen']);
export const DRAG_THRESHOLD_PX = 5;

export interface HandleMenuNodeLike {
  id: string;
  type?: string;
  parentId?: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
  /** B6-1（Spec B 终裁 57③）：折叠组内子节点 hidden=true——旧 rect 排除（渲染面≡命中面） */
  hidden?: boolean;
}

export interface NodeRect { x: number; y: number; w: number; h: number }

/** 解析节点的画布绝对矩形：子节点 position 是组内相对坐标（canvasStore 惯例），
 * 沿 parentId 累加祖先 position；group 是容器非实体节点，continue 维持
 * （B6-1 终裁 57③：折叠组区域=空白⇒弹菜单——渲染面≡命中面；"折叠组命中区=折叠帧"表述废止）；
 * hidden 子代不产出矩形（折叠期旧 rect 排除）；尺寸 width 优先（envelope 尺寸真源——measured 一帧滞后）。 */
export function absoluteRectsOf(nodes: HandleMenuNodeLike[]): NodeRect[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const absPos = (n: HandleMenuNodeLike, seen = new Set<string>()): { x: number; y: number } => {
    let x = n.position.x;
    let y = n.position.y;
    let cur = n;
    while (cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      x += parent.position.x;
      y += parent.position.y;
      cur = parent;
    }
    return { x, y };
  };
  const rects: NodeRect[] = [];
  for (const n of nodes) {
    if (n.type === 'group') continue;
    if (n.hidden) continue;
    const w = n.width ?? n.measured?.width;
    const h = n.height ?? n.measured?.height;
    if (!w || !h) continue;
    const { x, y } = absPos(n);
    rects.push({ x, y, w, h });
  }
  return rects;
}

export function isPointOnAnyNode(flowPoint: { x: number; y: number }, rects: NodeRect[]): boolean {
  return rects.some((r) =>
    flowPoint.x >= r.x && flowPoint.x <= r.x + r.w &&
    flowPoint.y >= r.y && flowPoint.y <= r.y + r.h,
  );
}

export interface HandleMenuPayload {
  x: number;
  y: number;
  nodeId: string;
  side: HandleSide;
  flowPoint: { x: number; y: number };
}

export interface HandleMenuGuardArgs {
  reconnecting: boolean;
  isValid: boolean | null;
  toHandle: unknown;
  toNode: unknown;
  nodeType: string | undefined;
  isLocked: boolean;
  dragDistancePx: number;
  flowPoint: { x: number; y: number };
  rects: NodeRect[];
  /** B6-2（Spec B 撞车①c）：+号输出按钮命中区（流坐标）——源 handle 拖≥5px 落+号 ⇒ 零菜单零连线。
   *  区在节点框外（isPointOnAnyNode(rects) 不覆盖），须单列；空数组=当前无 +号渲染。 */
  plusZones: NodeRect[];
}

export function shouldOpenHandleMenu(args: HandleMenuGuardArgs): boolean {
  if (args.reconnecting) return false;
  if (args.isValid === true) return false;
  if (args.toHandle !== null && args.toHandle !== undefined) return false;
  if (args.toNode !== null && args.toNode !== undefined) return false;
  if (!HANDLE_MENU_NODE_TYPES.has(args.nodeType ?? '')) return false;
  if (args.isLocked) return false;
  if (args.dragDistancePx < DRAG_THRESHOLD_PX) return false;
  if (isPointOnAnyNode(args.flowPoint, args.rects)) return false;
  if (args.plusZones.length > 0 && isPointOnAnyNode(args.flowPoint, args.plusZones)) return false;
  return true;
}

export type HandleMenuDecision =
  | { kind: 'ignore' }
  | { kind: 'open'; payload: HandleMenuPayload };

/** 决策+载荷组装一并纯函数化：Task 9 的 onConnectEnd 退化为"取 event/state → 调本函数 → open"。 */
export function decideHandleMenu(
  args: HandleMenuGuardArgs & { nodeId: string; side: HandleSide; clientX: number; clientY: number },
): HandleMenuDecision {
  if (!shouldOpenHandleMenu(args)) return { kind: 'ignore' };
  return {
    kind: 'open',
    payload: {
      x: args.clientX,
      y: args.clientY,
      nodeId: args.nodeId,
      side: args.side,
      flowPoint: args.flowPoint,
    },
  };
}

/** handle 拖拽建边的确定性 id——前缀刻意避开 auto:/auto-out:（那是协作/撤销的通道路由，spec §2.1）；
 * handle: 走 LocalUser 常规通道，与 addNode 同 origin 同撤销步。 */
export function handleEdgeId(sourceNodeId: string, targetNodeId: string): string {
  return `handle:${sourceNodeId}:${targetNodeId}`;
}

/** B6-1（Spec B 终裁 37⑤）：多指落点修——双指期间松第二指以第二指坐标弹菜单。
 * changedTouches 末位=最后落下的指；[0] 在多指齐松/次序落点时会取首指坐标致落点错位。 */
export function clientPoint(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('clientX' in e) return { x: e.clientX, y: e.clientY };
  const list = e.changedTouches;
  const t = list[list.length - 1];
  return { x: t?.clientX ?? 0, y: t?.clientY ?? 0 };
}
