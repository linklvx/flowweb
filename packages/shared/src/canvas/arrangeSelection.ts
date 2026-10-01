import type { CanvasNodeRecord } from './nodeEnvelope';
import { calcDefaultGrid } from './geometry';

export interface SelectionBuckets {
  groups: CanvasNodeRecord[];
  looseRoots: CanvasNodeRecord[];
  detachedChildren: CanvasNodeRecord[];
}

export function normalizeSelection(nodes: CanvasNodeRecord[], ids: string[]): SelectionBuckets {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups: CanvasNodeRecord[] = [];
  const looseRoots: CanvasNodeRecord[] = [];
  const detachedChildren: CanvasNodeRecord[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (n.type === 'group') { groups.push(n); continue; }
    if (n.parentId) detachedChildren.push(n);               // 有父即 detached（父组同选时由 participation 策略表裁决去重/排除）
    else looseRoots.push(n);
  }
  return { groups, looseRoots, detachedChildren };
}

export type ParticipationAction = 'arrange' | 'duplicate' | 'download';
export interface Participation {
  ids: string[];
  excluded: { detached: number; hidden: number };
  excludedCount: number;
}

/** hidden 判定单源谓词（v2.1）：shared 导出，groupDerive.ts 的 deriveHidden 与本模块同引——防两份规则漂移。 */
export function groupHidesChildren(data: Record<string, unknown>): boolean {
  return data.groupType === 'storyboard' || data.collapsed === true;
}

/** 策略表（契约 1 唯一裁决点，v2.1 语义收窄版）：
 *  arrange=组原子块+散根（detached 排除）；duplicate=组闭包全量保真（hidden 成员随组纳入——复制折叠组得完整副本；
 *  分镜子 rel 归零由 copyPlan 承担）；download=组闭包全部成员。
 *  hidden 排除仅作用于 detached/直接选中桶（防陈旧选中残留产出孤儿副本——2a-0 不变量落地后的防御性兜底）。
 *  性能：预建 Map<parentId, children[]> 一次，勿在组循环内 O(G×N) 全量扫。 */
export function participation(buckets: SelectionBuckets, action: ParticipationAction, nodes: CanvasNodeRecord[]): Participation {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, CanvasNodeRecord[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n);
    childrenOf.set(n.parentId, list);
  }
  const out: string[] = [];
  const outSet = new Set<string>();
  const push = (id: string) => { if (!outSet.has(id)) { outSet.add(id); out.push(id); } };
  let detached = 0, hidden = 0;
  for (const g of buckets.groups) {
    push(g.id);
    if (action === 'arrange') continue;                       // 组=原子块
    for (const child of childrenOf.get(g.id) ?? []) {        // 闭包全量保真（duplicate/download 均含 hidden 成员）
      if (child.type !== 'group') push(child.id);            // 嵌套组被 producer 侧禁止；不递归展开
    }
  }
  for (const n of buckets.looseRoots) push(n.id);
  for (const n of buckets.detachedChildren) {
    if (outSet.has(n.id)) continue;                          // 组闭包已纳员：不再裁决/计数（防双计）
    if (action === 'arrange') { detached++; continue; }
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const isHidden = !!parent && groupHidesChildren(parent.data as Record<string, unknown>);
    if (action === 'duplicate' && isHidden) { hidden++; continue; }   // 陈旧选中残留兜底：孤儿副本不产出
    push(n.id);                                                // 其余 detached 纳入（副本顶层化）
  }
  return { ids: out, excluded: { detached, hidden }, excludedCount: detached + hidden };
}

export const ARRANGE_ROW_TOLERANCE = 8;
export const ARRANGE_GAP = 60;
export type ArrangeMode = 'grid' | 'horizontal' | 'vertical';

/** F40：先按 y 升序遍历分行（对行首 y 判容差），再每行内按 x 升序——spec"行内 x 升序"字面。 */
export function sortForArrange<T extends { x: number; y: number }>(items: T[]): T[] {
  const byY = [...items].sort((a, b) => a.y - b.y);
  const rows: T[][] = [];
  for (const it of byY) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(it.y - row[0].y) < ARRANGE_ROW_TOLERANCE) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((row) => [...row].sort((a, b) => a.x - b.x));
}

export interface ArrangeRect { x: number; y: number; width: number; height: number; }

/** §4.3：cell=行 max 高×列 max 宽、节点按 cell 左上角落位（自身尺寸不变）、n≤1 no-op、包围盒中心不变。 */
export function arrangeRects(rects: ArrangeRect[], mode: ArrangeMode): ArrangeRect[] {
  const n = rects.length;
  if (n <= 1) return rects;
  const cols = mode === 'horizontal' ? n : mode === 'vertical' ? 1 : calcDefaultGrid(n).cols;
  const rows = Math.ceil(n / cols);
  const colW: number[] = [], rowH: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c] ?? 0, rects[i].width);
    rowH[r] = Math.max(rowH[r] ?? 0, rects[i].height);
  }
  const xs: number[] = [0];
  for (let c = 1; c < cols; c++) xs[c] = xs[c - 1] + colW[c - 1] + ARRANGE_GAP;
  const ys: number[] = [0];
  for (let r = 1; r < rows; r++) ys[r] = ys[r - 1] + rowH[r - 1] + ARRANGE_GAP;
  const laid = rects.map((r, i) => ({ ...r, x: xs[i % cols], y: ys[Math.floor(i / cols)] }));
  const dx = bboxCenter(rects, 'x') - bboxCenter(laid, 'x');
  const dy = bboxCenter(rects, 'y') - bboxCenter(laid, 'y');
  return laid.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
}
function bboxCenter(rects: ArrangeRect[], axis: 'x' | 'y'): number {
  const lo = Math.min(...rects.map((r) => r[axis]));
  const hi = Math.max(...rects.map((r) => (axis === 'x' ? r.x + r.width : r.y + r.height)));
  return (lo + hi) / 2;
}
