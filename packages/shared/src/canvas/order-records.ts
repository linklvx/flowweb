// packages/shared/src/canvas/order-records.ts
// T17（plan v11.2 S5 片·spec D5/Z4''-v14/:77）：读序单源——层序遍历+同层 (order,id)/(slot,id)
// 双 tie-break 容忍重复键（repair 归 T18 CLI——读序稳定不 500 不丢节点）。
//
// D5：order 仅同 parentId 层内生效；投影数组序=层序遍历+同层 (order,id)；不设跨层全局序。
// 本模块是全仓节点读序唯一实现（sortNodesByPosition/sortForArrange 空间序读面已收编——
// canvasStore merge/convert/arrange 三面全改走本单源）。
import { isValidOrderKey, compareOrderKeys } from './order-key';
import { readPlacement, isStoryboardChildRecord, type NodePlacement } from './placement';

/** 读序最小记录面（StoredNodeRecord/CanvasNodeRecord/CS Node 结构兼容）。 */
export interface OrderableRecord {
  id: string;
  parentId?: string | null;
  data?: Record<string, unknown>;
}

/** 层键（D5 层内序）：根层=null；子层=parentId（分镜子与自由子同归父组层——槽序判别在比较器内）。 */
export function layerOf(rec: { parentId?: string | null }): string | null {
  return rec.parentId ?? null;
}

const placementRank = (p: NodePlacement): number => (p.kind === 'order' ? 0 : 1);

/**
 * 同层读序比较器（双 tie-break 单源）：
 *   - order 档：(order,id)——order 键数值序（compareOrderKeys 单源——禁裸字符串比较），
 *     缺键/非法键排同层最后（(null,id) 兜底——未迁移窗口不 500）；
 *   - slot 档：(slot,id)——slot 数值序+id 字典序；
 *   - 混合层（脏态）：order 档在前、slot 档在后（分镜格位成员殿后——稳定不抛）。
 */
export function compareWithinLayer(a: OrderableRecord, b: OrderableRecord): number {
  const pa = readPlacement(a.data ?? {});
  const pb = readPlacement(b.data ?? {});
  const rankDiff = placementRank(pa) - placementRank(pb);
  if (rankDiff !== 0) return rankDiff;
  if (pa.kind === 'slot' && pb.kind === 'slot') {
    return pa.slot - pb.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  // order 档（order 可 null——合法键排前、缺键殿后；非法键与缺键同档按 id 稳定）
  const oa = pa.kind === 'order' ? pa.order : null;
  const ob = pb.kind === 'order' ? pb.order : null;
  if (oa != null && ob != null) {
    if (!isValidOrderKey(oa) || !isValidOrderKey(ob)) {
      return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }
    const c = compareOrderKeys(oa, ob);
    if (c !== 0) return c;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // 等值键 tie-break——重复键容忍（Z4''-v14）
  }
  if (oa != null) return -1; // 有键 < 缺键
  if (ob != null) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * orderRecords（读序单源出口）：层序遍历（父先于子——RF updateChildNode 契约）+同层读序。
 *   - 根层（含孤儿/父环成员——读侧全函数不丢节点不抛栈溢出）先出，组层按父组在父层的读序随后；
 *   - 同层序=compareWithinLayer（(order,id)/(slot,id) 双 tie-break）；
 *   - 纯函数（输入不被就地修改）。
 */
export function orderRecords<T extends OrderableRecord>(records: readonly T[]): T[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const childrenOf = new Map<string | null, T[]>();
  const known = new Set(byId.keys());
  // 环检测：沿 parentId 上溯有环 ⇒ 作根层成员输出（防丢/防栈溢出）
  const inCycle = new Set<string>();
  for (const r of records) {
    const seen = new Set<string>([r.id]);
    let p = r.parentId ?? null;
    while (p != null && known.has(p)) {
      if (seen.has(p)) { inCycle.add(r.id); break; }
      seen.add(p);
      p = byId.get(p!)?.parentId ?? null;
    }
  }
  for (const r of records) {
    const attached = r.parentId != null && known.has(r.parentId) && !inCycle.has(r.id);
    const layer = attached ? (r.parentId as string) : null;
    const list = childrenOf.get(layer);
    if (list) list.push(r); else childrenOf.set(layer, [r]);
  }
  for (const list of childrenOf.values()) list.sort(compareWithinLayer);
  const out: T[] = [];
  const emit = (layer: string | null): void => {
    for (const r of childrenOf.get(layer) ?? []) {
      out.push(r);
      emit(r.id);
    }
  };
  emit(null);
  // 防御：emit 覆盖全集（孤儿/环已归根层）；若仍有遗漏（理论不可达）按输入序补尾——不丢节点
  if (out.length !== records.length) {
    const emitted = new Set(out.map((r) => r.id));
    for (const r of records) if (!emitted.has(r.id)) out.push(r);
  }
  return out;
}

/** 分镜子层判定便捷面（读序消费者：storyboard 组子层按 (slot,id)——由 compareWithinLayer 内判）。 */
export { isStoryboardChildRecord };
