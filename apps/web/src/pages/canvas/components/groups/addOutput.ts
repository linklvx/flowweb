// apps/web/src/pages/canvas/components/groups/addOutput.ts
// B6-2（Spec B 需求 6 / 撞车② B 案）+号输出按钮纯函数层：显隐单源/锚框/源集/命中区/松手落点。
// rect 读 cs（v3.16 终裁 57②）：组帧三字段=useCanvasStore 订阅（编辑器渲染面=cs），
// 不读 RF internals.measured；组恒顶层（组深≤1）⇒组 position 即绝对坐标（rel≡abs）。
// 消费面：AddOutputHandle（渲染+手势）、CanvasView onConnectEnd（撞车①c 喂 shouldOpenHandleMenu）。
import { ADD_OUTPUT_HANDLE } from './selectionTokens';
import type { HandleMenuNodeLike, NodeRect } from '@/utils/handleMenu';

export interface AddOutputNodeLike extends HandleMenuNodeLike {
  selected?: boolean;
  data?: { groupType?: string; collapsed?: boolean };
}

export interface AddOutputOpts {
  marqueeSelecting: boolean;
  canEdit: boolean;
  /** viewer 折叠本地 override（GroupNode effCollapsed 同式：local ?? data.collapsed） */
  localCollapsed?: Record<string, boolean | undefined>;
}

export type AddOutputTarget =
  | { kind: 'selection'; ids: string[] }
  | { kind: 'group'; id: string };

/** 显隐单源（v2.2 §3.5）：!canEdit/marquee 进行中 → null；可见选中 ≥2 → selection；
 * 恰一选中且为组 → normal 未折叠才给 group（分镜组/折叠组不渲染——口径 5/26）。 */
export function resolveAddOutputTarget(nodes: AddOutputNodeLike[], opts: AddOutputOpts): AddOutputTarget | null {
  if (!opts.canEdit) return null;
  if (opts.marqueeSelecting) return null;
  const selected = nodes.filter((n) => n.selected && !n.hidden);
  if (selected.length >= 2) return { kind: 'selection', ids: selected.map((n) => n.id) };
  if (selected.length === 1) {
    const g = selected[0];
    if (g.type !== 'group') return null;
    if (g.data?.groupType === 'storyboard') return null;
    const effCollapsed = opts.localCollapsed?.[g.id] ?? g.data?.collapsed === true;
    if (effCollapsed) return null;
    return { kind: 'group', id: g.id };
  }
  return null;
}

export interface FlowFrame { x: number; y: number; w: number; h: number }

/** 沿 parentId 累加祖先 position（组深≤1——循环父链 seen 防环，同 absoluteRectsOf 口径） */
function absPositionOf(n: AddOutputNodeLike, byId: Map<string, AddOutputNodeLike>): { x: number; y: number } {
  let x = n.position.x;
  let y = n.position.y;
  let cur = n;
  const seen = new Set<string>();
  while (cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    cur = parent;
  }
  return { x, y };
}

/** 锚框（流坐标）：group 档=cs 组帧三字段（缺失→null）；selection 档=可见选中集 bbox
 * （选中组以整帧参与——与 SelectionBoxOverlay 可见选框同延，+号贴可见框右缘）。 */
export function addOutputFrameFlow(nodes: AddOutputNodeLike[], target: AddOutputTarget): FlowFrame | null {
  if (target.kind === 'group') {
    const g = nodes.find((n) => n.id === target.id);
    if (!g) return null;
    const w = g.width ?? 0;
    const h = g.height ?? 0;
    if (!w || !h) return null;
    return { x: g.position.x, y: g.position.y, w, h };
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const idSet = new Set(target.ids);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (!idSet.has(n.id)) continue;
    const { x, y } = absPositionOf(n, byId);
    const w = n.width ?? n.measured?.width ?? 0;
    const h = n.height ?? n.measured?.height ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** 源集展开（v2.2 §3.6 源集合定义）：group 档=组内全部子节点（hidden 不参与）；
 * selection 档=选中组展开为子节点 ∪ 非组选中。连线语义（判重/过滤无 handle 源）归 B6-3。 */
export function addOutputSourceIds(nodes: AddOutputNodeLike[], target: AddOutputTarget): string[] {
  if (target.kind === 'group') {
    return nodes.filter((n) => n.parentId === target.id && !n.hidden).map((n) => n.id);
  }
  const idSet = new Set(target.ids);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (!idSet.has(n.id)) continue;
    if (n.type === 'group') {
      for (const c of nodes) {
        if (c.parentId === n.id && !c.hidden && !seen.has(c.id)) { seen.add(c.id); out.push(c.id); }
      }
    } else if (!seen.has(n.id)) {
      seen.add(n.id);
      out.push(n.id);
    }
  }
  return out;
}

/** +号命中区（流坐标，撞车①c 喂 shouldOpenHandleMenu）：框右缘向框外 hitWidth×hitHeight
 * 屏幕常量——流坐标=屏幕常量/zoom；只向框外展开（框内右缘归 resizer 右中手柄与子节点）。 */
export function addOutputHitZoneFlow(frame: FlowFrame, zoom: number): NodeRect {
  const halfH = (ADD_OUTPUT_HANDLE.hitHeight / 2) / zoom;
  return {
    x: frame.x + frame.w,
    y: frame.y + frame.h / 2 - halfH,
    w: ADD_OUTPUT_HANDLE.hitWidth / zoom,
    h: halfH * 2,
  };
}

/** 源锚点（屏幕坐标）：每源节点右缘中点（流→屏幕 = ×zoom+vp）——BatchConnectLines 与 +号
 * 共用锚点口径（v2.2 §3.6 统一锚点函数）；零尺寸/缺失源跳过。 */
export function addOutputSourceAnchorsScreen(
  nodes: AddOutputNodeLike[],
  ids: string[],
  viewport: { x: number; y: number; zoom: number },
): Array<{ x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: Array<{ x: number; y: number }> = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (!n || n.hidden) continue;
    const w = n.width ?? n.measured?.width;
    const h = n.height ?? n.measured?.height;
    if (!w || !h) continue;
    const { x, y } = absPositionOf(n, byId);
    out.push({ x: (x + w) * viewport.zoom + viewport.x, y: (y + h / 2) * viewport.zoom + viewport.y });
  }
  return out;
}

/** B6-3 缝：+号手势终态载荷——B6-2 只送达不执行（<阈值=点击建点菜单 / ≥阈值=拖线松手：
 * 命中→batchConnect、落空→建点+连线[拍板②]——语义全归 B6-3）。 */
export interface BatchConnectClickEnd {
  kind: 'click';
  sourceIds: string[];
  /** +号圆心（client 坐标）——B6-3 点击建点菜单的弹出锚 */
  anchorClient: { x: number; y: number };
}

export interface BatchConnectDropEnd {
  kind: 'drop';
  sourceIds: string[];
  clientPoint: { x: number; y: number };
  flowPoint: { x: number; y: number };
  /** 松手落点节点（源自身/hidden/组已排除；null=落空） */
  hitNodeId: string | null;
}

export type BatchConnectGestureEnd = BatchConnectClickEnd | BatchConnectDropEnd;

/** B6-3 手势终态决策：命中节点=直接批量连线；点击/拖线落空（含 hidden——resolveBatchDropTarget
 * 排除=落空同语义）=建点+连线菜单（拍板②——HandleAddNodeMenu:82-92 同手势先例；需求 7"点击建点"
 * =落空退化情形）。toFlow=client→流坐标换算（CanvasView screenToFlowPosition 注入——click 载荷
 * 只有 client 锚，drop 载荷自带 flowPoint 不换算）。 */
export type BatchGestureDecision =
  | { kind: 'connect'; sourceIds: string[]; targetId: string }
  | { kind: 'menu'; sourceIds: string[]; client: { x: number; y: number }; flow: { x: number; y: number } };

export function decideBatchGestureEnd(
  end: BatchConnectGestureEnd,
  toFlow: (p: { x: number; y: number }) => { x: number; y: number },
): BatchGestureDecision {
  if (end.kind === 'click') {
    return { kind: 'menu', sourceIds: end.sourceIds, client: end.anchorClient, flow: toFlow(end.anchorClient) };
  }
  if (end.hitNodeId != null) {
    return { kind: 'connect', sourceIds: end.sourceIds, targetId: end.hitNodeId };
  }
  return { kind: 'menu', sourceIds: end.sourceIds, client: end.clientPoint, flow: end.flowPoint };
}

/** 松手落点（absoluteRectsOf 同口径）：组/hidden 不产出命中矩形 + 排除源自身（F9——
 * hidden 目标会建出永远看不见的边）。连线动作归 B6-3，本函数只解析落点。 */
export function resolveBatchDropTarget(
  nodes: AddOutputNodeLike[],
  flowPoint: { x: number; y: number },
  sourceIds: string[],
): string | null {
  const sources = new Set(sourceIds);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.type === 'group' || n.hidden || sources.has(n.id)) continue;
    const w = n.width ?? n.measured?.width;
    const h = n.height ?? n.measured?.height;
    if (!w || !h) continue;
    const { x, y } = absPositionOf(n, byId);
    if (flowPoint.x >= x && flowPoint.x <= x + w && flowPoint.y >= y && flowPoint.y <= y + h) return n.id;
  }
  return null;
}
