// apps/web/src/utils/canvas-allocator.ts
// T17（plan v11.2 S5 片·spec Z12''/G54/:505/:512）：placement/order 分配**唯一入口**——
// 建点/副本（copy/paste）/入组出组/整理（arrange）全经本 allocator 落 order 键与不重叠位置。
//
// 红线（G54）：copy/paste 重新分配 placement/order——副本同层同 order 重复键+位置重叠复现=本
// 模块的存在理由；buildCopyPlan 的 CopyOrderAllocator 缝由本模块实现（根层对既有层尾键 after、
// 复制闭包新组层顺序键）。
//
// order 键域=shared order-key（单一有界分数索引；after/before/between 四曲线折半）。重复键
// 容忍（(order,id) tie-break——Z4''-v14），allocator 侧仍以零碰撞为目标（after(max) 恒零碰撞）。
import {
  FIRST_ORDER_KEY, isValidOrderKey, compareOrderKeys, orderKeyAfter, orderKeyBetween,
} from '@flowweb/shared';
import type { CopyOrderAllocator } from '@flowweb/shared';
/** allocator 最小节点面（cs Node 结构兼容——data 上携带 order 键）。 */
export interface AllocatableNode {
  id: string;
  parentId?: string | null;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  data?: Record<string, unknown>;
}

const orderKeyOf = (n: AllocatableNode): string | null => {
  const k = (n.data ?? {}).order;
  return typeof k === 'string' && isValidOrderKey(k) ? k : null;
};

/** 层内既有 order 键集（D5：层=parentId 同值；根层=parentId 空）。 */
export function layerOrderKeys(nodes: readonly AllocatableNode[], parentId: string | null): string[] {
  return nodes
    .filter((n) => (n.parentId ?? null) === parentId)
    .map(orderKeyOf)
    .filter((k): k is string => k != null);
}

/** 层内最大 order 键（无有效键层=null——首键从 FIRST_ORDER_KEY 起）。 */
export function maxOrderKey(nodes: readonly AllocatableNode[], parentId: string | null): string | null {
  const keys = layerOrderKeys(nodes, parentId);
  if (keys.length === 0) return null;
  return keys.reduce((max, k) => (compareOrderKeys(k, max) > 0 ? k : max));
}

/**
 * 建点/入层分配（allocator 唯一入口·层尾追加档）：层尾键 after（恒零碰撞——任何既有键 ≤max
 * < after(max)）；空层首键=FIRST_ORDER_KEY。永不返回 null（after 上沿 2^53 不可达——
 * 运行时防御：null 时回退 max 本键（重复容忍+病理计数域））。
 */
export function allocateOrderAfter(nodes: readonly AllocatableNode[], parentId: string | null): string {
  const max = maxOrderKey(nodes, parentId);
  if (max == null) return FIRST_ORDER_KEY;
  return orderKeyAfter(max) ?? max;
}

/**
 * 副本 order 分配器（buildCopyPlan 的 CopyOrderAllocator 实现——G54 副本同层同 order 重复键红线）：
 *   - 根层（layerParentId=null）：对既有层尾键 after 后逐副本递进（after 链恒严格递增——副本间零碰撞）；
 *   - 复制闭包新组层（父=新组 id——层内尚无成员）：顺序键 FIRST_ORDER_KEY、after 链递进。
 * 调用方传入既有节点集（副本落位前的 cs nodes）。
 */
export function createCopyOrderAllocator(existingNodes: readonly AllocatableNode[]): CopyOrderAllocator {
  const layerLast = new Map<string | null, string>();
  return (layer) => {
    const existing = layerLast.get(layer) ?? maxOrderKey(existingNodes, layer);
    // 空层首键=FIRST_ORDER_KEY（中位点留双向余量）；有层尾=after（副本间恒严格递增——零碰撞）
    const next = existing == null ? FIRST_ORDER_KEY : (orderKeyAfter(existing) ?? existing);
    layerLast.set(layer, next);
    return next;
  };
}

const bboxOverlap = (
  a: { position: { x: number; y: number }; width?: number | null; height?: number | null },
  b: { position: { x: number; y: number }; width?: number | null; height?: number | null },
): boolean => {
  const aw = a.width ?? 0, ah = a.height ?? 0;
  const bw = b.width ?? 0, bh = b.height ?? 0;
  return a.position.x < b.position.x + bw && b.position.x < a.position.x + aw
    && a.position.y < b.position.y + bh && b.position.y < a.position.y + ah;
};

/**
 * 副本落位不重叠守卫（G54 位置重叠红线）：副本集与**非源**既有节点 bbox 相交 ⇒ 整体按步进
 * 平移（副本集整体平移——内部相对布局保真）直到与全场景零相交（有界 64 步——超限放行：
 * 重叠非正确性问题，守卫为 UX 档）。excludeIds=剪贴板源成员（粘贴落在原件正上=既有 UX 契约
 * ——测试锚「粘贴坐标 shell 直用 flow 位置」；源自身不算重叠对象）。纯函数。
 */
export function nudgeCopiesUntilFree<T extends { position: { x: number; y: number } }>(
  copies: readonly T[],
  existing: ReadonlyArray<{ id?: string; position: { x: number; y: number }; width?: number | null; height?: number | null }>,
  step: { x: number; y: number } = { x: 40, y: 40 },
  excludeIds?: ReadonlySet<string>,
): T[] {
  const blockers = existing.filter((e) => e.id == null || !(excludeIds?.has(e.id) ?? false));
  let cur = copies.map((c) => ({ ...c, position: { ...c.position } }));
  for (let i = 0; i < 64; i++) {
    const clash = cur.some((c) => blockers.some((e) => bboxOverlap(c, e)));
    if (!clash) return cur;
    for (const c of cur) { c.position.x += step.x; c.position.y += step.y; }
  }
  return cur;
}

/**
 * 整理（arrange）后层序回写（G54「拖序不持久红」的 order 面）：按 laid 顺序给参与节点重排
 * order 键——块起点=参与集原最小键（块内首位直接继承），块内递进 between 压缩；触到块上方
 * 最近非参与键时 squeeze，squeeze 饱和（between=null）退 after(max)（重复容忍+病理域）。
 * 返回 id→新键表（值不变者不进表——调用方零冗余 intent）。
 */
export function fitOrderBlock(
  layerNodes: readonly AllocatableNode[],
  orderedIds: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (orderedIds.length === 0) return out;
  const selected = new Set(orderedIds);
  const keys = layerNodes
    .filter((n) => selected.has(n.id))
    .map(orderKeyOf)
    .filter((k): k is string => k != null)
    .sort((a, b) => compareOrderKeys(a, b));
  // 质评 Important#1：全键空层（旧档整层无 order 键）零返回=arrange 零 intent——G54「拖序不
  // 持久」红线该人群残活（且与头注释「缺键=块起点引导」矛盾）。修：空层以 FIRST_ORDER_KEY
  // 中位点引导全块（层内既有非参与键的相对位由 ceiling squeeze 守恒；键域中点留双向余量）。
  const startKey = keys.length > 0 ? keys[0] : FIRST_ORDER_KEY;
  // 块上方最近非参与键（块内键须全部 < ceiling 才不动非参与相对位；null=层内无上邻——尾插链）
  const ceiling = layerNodes
    .filter((n) => !selected.has(n.id))
    .map(orderKeyOf)
    .filter((k): k is string => k != null && compareOrderKeys(k, startKey) > 0)
    .sort((a, b) => compareOrderKeys(a, b))[0] ?? null;
  let prev: string | null = null;
  for (const id of orderedIds) {
    const target: string = prev == null ? startKey : nextKey(prev, ceiling);
    out.set(id, target);
    prev = target;
  }
  return out;
}

const nextKey = (prev: string, ceiling: string | null): string => {
  if (ceiling == null) return orderKeyAfter(prev) ?? prev; // 无上邻：尾插链（恒严格递增）
  const squeezed = orderKeyBetween(prev, ceiling);
  // squeeze 可用=严格落 (prev, ceiling)；饱和（等值邻接不可表达）→ after 退（可能撞 ceiling
  // ——重复容忍 (order,id) tie-break+病理计数域，Z4''-v14）
  return squeezed ?? (orderKeyAfter(prev) ?? prev);
};
