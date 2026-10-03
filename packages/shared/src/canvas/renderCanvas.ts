// packages/shared/src/canvas/renderCanvas.ts
// O0c-2（Spec B）：第 4 渲染面（ProcessSnapshot/分享）唯一写者——records(作者态 abs)→RenderNode
// (rel+派生帧+剔除 hidden)。与主画布同一派生链：组帧单源=deriveGroupFrame（reconcile 写域① 同参
// 同源——快照≡主画布几何逐位）；单遍单 origin（终裁 40⑤ 同构）：帧集合一步产出→子 rel=abs−本遍新 origin。
// hidden 剔除=deriveHiddenMap 同构（groupHidesChildren 单源谓词，深度 1）：分镜子（组内 CSS grid 渲染，
// 不读子 position——终裁 14）与 collapsed 子代不产独立 RF 节点（v3.12 评审三 P1-1：{0,0} 子节点拉塌
// 初始 bounds/叠原点）；按祖先链整剔防悬空 parentId（组深≤1 下与深度 1 同集合）。分镜子 data 经组
// data.cellNodes 双通道载荷保留（公开页通道 thumbnailUrl；主画布通道 fileId 由 GroupNode 现算——入参同形）。
// 纯函数零 web 依赖（RenderNode 所在 docShape 同族；spec 终裁 9：入参=结构性最小类型，不 import @xyflow）。
import type { RenderNode, Rect } from './docShape';
import type { RelPos, RelCoord } from './brands';
import { deriveGroupFrame, DEFAULT_CHILD_SIZE } from './geometry';
import { groupHidesChildren } from './arrangeSelection';

/** 入口结构性最小类型（JSON 边界 null≡缺——DocNodeRecord/SnapshotNode 双喂；spec 终裁 9）。 */
export interface RenderSourceNode {
  id: string;
  type: string;
  parentId?: string | null;
  position?: { x: number; y: number } | null;
  width?: number | null;
  height?: number | null;
  data: Record<string, unknown>;
}

/** 入口边（DocEdgeRecord/SnapshotEdge 双喂——缺写/悬空由过滤段消化）。 */
export interface RenderSourceEdge {
  id: string;
  source?: string | null;
  target?: string | null;
}

/** 出口边（无悬空——两端必在输出节点集）。 */
export interface RenderEdge { id: string; source: string; target: string }

const rel = (x: number, y: number): RelPos => ({ x: x as RelCoord, y: y as RelCoord });

/** records(abs)→RenderNode(rel+派生帧)+边集过滤。输出父先子后（RF v12 要求）+环守卫；
 *  输出零 hidden 节点（剔除式——可见集合≡主画布 deriveHidden 不可见集合）。 */
export function deriveRenderCanvas(input: {
  records: readonly RenderSourceNode[];
  edges?: readonly RenderSourceEdge[];
}): { nodes: RenderNode[]; edges: RenderEdge[] } {
  const records = input.records;
  const byId = new Map(records.map((r) => [r.id, r]));
  const childrenByParent = new Map<string, RenderSourceNode[]>();
  for (const r of records) {
    if (r.parentId == null) continue;
    const list = childrenByParent.get(r.parentId);
    if (list) list.push(r); else childrenByParent.set(r.parentId, [r]);
  }
  const hidesChildrenIds = new Set(
    records.filter((r) => r.type === 'group' && groupHidesChildren(r.data)).map((r) => r.id),
  );

  // —— Pass 1：帧集合一步产出（memo 递归；组环 visiting 命中以记录裸形回退——有限值保证，不挂死）。
  //    子 rect 尺寸链=record wh ?? DEFAULT_CHILD_SIZE（reconcile 同源——doc wh 第一/常量最后）；
  //    组子（若存在）rect=其派生帧；普通组子缺 position=缺键排除（reconcile 同款——脏形态不掺 bbox）。 ——
  const frames = new Map<string, Rect>();
  const inProgress = new Set<string>();
  const rawRect = (g: RenderSourceNode): Rect => ({
    x: g.position?.x ?? 0, y: g.position?.y ?? 0,
    width: g.width ?? DEFAULT_CHILD_SIZE.width, height: g.height ?? DEFAULT_CHILD_SIZE.height,
  });
  const frameOf = (g: RenderSourceNode): Rect => {
    const memo = frames.get(g.id);
    if (memo) return memo;
    if (inProgress.has(g.id)) return rawRect(g); // 环回退
    inProgress.add(g.id);
    const childrenAbs = (childrenByParent.get(g.id) ?? []).flatMap((c): Rect[] => {
      if (c.type === 'group') return [frameOf(c)];
      if (c.position == null) return [];
      return [{
        x: c.position.x, y: c.position.y,
        width: c.width ?? DEFAULT_CHILD_SIZE.width, height: c.height ?? DEFAULT_CHILD_SIZE.height,
      }];
    });
    const f = deriveGroupFrame({
      data: g.data,
      storedFrame: { position: g.position ?? undefined, width: g.width ?? undefined, height: g.height ?? undefined },
      childrenAbs,
      // reconcile 同参：组 position 现值（空 auto 组 doc 无键——公开载荷归一 {0,0} 是该形态的固有极限）
      fallbackOrigin: g.position ?? undefined,
    });
    frames.set(g.id, f);
    inProgress.delete(g.id);
    return f;
  };
  for (const r of records) {
    if (r.type === 'group') frameOf(r);
  }

  // —— hidden 剔除集：祖先链达 hidesChildren 组（storyboard∨collapsed）即整剔（防悬空 parentId）——
  const dropped = new Set<string>();
  for (const r of records) {
    const seen = new Set<string>();
    let p = r.parentId ?? null;
    while (p != null && !seen.has(p)) {
      seen.add(p);
      if (hidesChildrenIds.has(p)) { dropped.add(r.id); break; }
      p = byId.get(p)?.parentId ?? null;
    }
  }

  // —— Pass 2：父先子后输出（环=visiting 命中跳过——先序已保证环内先访者被 emit，不爆栈）——
  const nodes: RenderNode[] = [];
  const emitted = new Set<string>();
  const visiting = new Set<string>();
  const toRenderNode = (r: RenderSourceNode): RenderNode => {
    // parentId 保留判据=父帧在集合（父=组且产出）；悬空父/非组父按顶层产出（无 origin 可减——禁双加）
    const parentId = r.parentId != null && frames.has(r.parentId) ? r.parentId : undefined;
    const parentFrame = parentId != null ? frames.get(parentId) : undefined;
    if (r.type === 'group') {
      const f = frames.get(r.id)!; // Pass 1 已为全部组产出
      const data = { ...r.data };
      if (r.data.groupType === 'storyboard') {
        // 分镜子双通道载荷（公开页通道：thumbnailUrl 已由 api 注入；主画布通道 fileId 在 GroupNode 现算）
        data.cellNodes = (childrenByParent.get(r.id) ?? []).map((c) => ({
          id: c.id,
          ...(typeof c.data.thumbnailUrl === 'string' ? { thumbnailUrl: c.data.thumbnailUrl } : {}),
        }));
      }
      return {
        id: r.id, type: r.type,
        ...(parentId != null ? { parentId } : {}),
        position: rel(f.x - (parentFrame?.x ?? 0), f.y - (parentFrame?.y ?? 0)),
        width: f.width, height: f.height,
        data,
      };
    }
    return {
      id: r.id, type: r.type,
      ...(parentId != null ? { parentId } : {}),
      position: rel(
        (r.position?.x ?? 0) - (parentFrame?.x ?? 0),
        (r.position?.y ?? 0) - (parentFrame?.y ?? 0),
      ),
      ...(r.width != null ? { width: r.width } : {}),
      ...(r.height != null ? { height: r.height } : {}),
      data: r.data,
    };
  };
  const emit = (r: RenderSourceNode): void => {
    if (emitted.has(r.id) || visiting.has(r.id)) return;
    visiting.add(r.id);
    if (r.parentId != null && frames.has(r.parentId)) {
      const parent = byId.get(r.parentId);
      if (parent) emit(parent);
    }
    emitted.add(r.id);
    visiting.delete(r.id);
    if (dropped.has(r.id)) return;
    nodes.push(toRenderNode(r));
  };
  for (const r of records) emit(r);

  // —— 边集过滤：两端均在输出节点集（剔除节点/未知 id 的边整条删——无悬空）——
  const keptIds = new Set(nodes.map((n) => n.id));
  const edges: RenderEdge[] = [];
  for (const e of input.edges ?? []) {
    if (typeof e.source !== 'string' || typeof e.target !== 'string') continue;
    if (!keptIds.has(e.source) || !keptIds.has(e.target)) continue;
    edges.push({ id: e.id, source: e.source, target: e.target });
  }
  return { nodes, edges };
}
