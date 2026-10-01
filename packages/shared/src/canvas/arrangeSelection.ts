import type { CanvasNodeRecord } from './nodeEnvelope';

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
      if (child.type !== 'group') push(child.id);
    }
  }
  for (const n of buckets.looseRoots) push(n.id);
  for (const n of buckets.detachedChildren) {
    if (action === 'arrange') { detached++; continue; }
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const isHidden = !!parent && groupHidesChildren(parent.data as Record<string, unknown>);
    if (action === 'duplicate' && isHidden) { hidden++; continue; }   // 陈旧选中残留兜底：孤儿副本不产出
    push(n.id);                                                // 其余 detached 纳入（副本顶层化）
  }
  return { ids: out, excluded: { detached, hidden }, excludedCount: detached + hidden };
}
