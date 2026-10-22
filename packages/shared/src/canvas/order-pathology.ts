// packages/shared/src/canvas/order-pathology.ts
// T18（plan v11.2 S5 片·spec Z4''-v14/:77：在线 repair 整建制删除——只留病理计数+soft/hard 告警
// +CLI renumber-layer）。order 域病理单源扫描：纯函数（records→报告），api 装载档挂点+CLI
// dry-run 报告共用（禁两份判定）。
//
// 病理档（Z4''-v14 词表——阈值单源=order-key.ts）：
//   duplicate-key：同层 order 域两成员等值键（并发/离线合并产物）——读序 (order,id) tie-break
//     容忍不丢节点（G53），计数观测归本模块，修复归 CLI renumber-layer（离线/维护窗）。
//   soft-key：合法键键长 ≥ ORDER_KEY_SOFT_LIMIT(24)——病态中插深度告警档（spec §0.2-⑤ 维持 v10）。
//   hard-key：非法键（isValidOrderKey 假——含键长 > ORDER_KEY_HARD_LIMIT(128)、非 canonical 形、
//     超键域上沿）——损坏上限档；读侧排序兜底殿后（compareOrderKeys 非法殿后语义），不 500。
//   missing-key：order 域成员缺 order 键（未迁移窗口/删写竞态）——读侧 (null,id) 兜底殿后同容忍。
//   load 档：装载路径扫描命中任一档 ⇒ doc 级计数+告警（挂点=api loadDocument replay 后——
//     装载是 doc 内容进进程的唯一咽喉，零热路径成本；每装载一次观测一次，非持续状态）。
// slot 域不在本扫描面：格位重复/溢出的读侧容忍已由 deriveStoryboardCells (slot,id) tie-break
// 承载（Z17''），格位病理（重复 slot/越格）同源计数属 Y2 扩展面（本批零代码——spec :77 口径）。
import { isValidOrderKey, ORDER_KEY_SOFT_LIMIT } from './order-key';
import { readPlacement } from './placement';
import { layerOf, type OrderableRecord } from './order-records';

/** order 域病理档词表（计数 label 值域——api 指标与 CLI 报告共用单源）。 */
export const ORDER_PATHOLOGY_KINDS = ['duplicate-key', 'soft-key', 'hard-key', 'missing-key'] as const;
export type OrderPathologyKind = (typeof ORDER_PATHOLOGY_KINDS)[number];

/** doc 级病理报告（CLI --dry-run 输出=本报告直印；api 装载档消费 clean 判定+计数）。 */
export interface OrderPathologyReport {
  /** 命中档清单（doc 级去重——同档多处命中归一） */
  kinds: readonly OrderPathologyKind[];
  /** 同层等值键成员数（duplicate-key 档——超 1 即病理；计数口径=参与重复的成员数非重复组数） */
  duplicateKeyNodes: number;
  /** soft 档成员数（键长 ≥24 的合法键） */
  softKeyNodes: number;
  /** hard 档成员数（非法键） */
  hardKeyNodes: number;
  /** 缺键成员数（order 域成员无 order 键） */
  missingKeyNodes: number;
  /** 受影响层集合（parent 索引层键——根层=null） */
  layers: readonly (string | null)[];
  /** 扫描的 order 域成员总数（分母观测） */
  scannedNodes: number;
}

/** 病理扫描纯函数（读序单源消费方——layerOf/readPlacement 不在本地重实现）。
 *  输入只读不改；缺 data/非 map 值按缺键档计（读侧全函数同口径）。 */
export function scanOrderPathology(records: readonly OrderableRecord[]): OrderPathologyReport {
  const hitLayers = new Set<string | null>();
  const duplicateMembers: string[] = [];   // 参与重复的成员 id（档内计数）
  const soft: string[] = [];
  const hard: string[] = [];
  const missing: string[] = [];
  // 按层分桶 order 域成员（slot 域跳过——格位病理归 deriveStoryboardCells 读侧面）
  const orderDomain = new Map<string | null, { id: string; order: string | null; len: number }[]>();
  let scanned = 0;
  for (const r of records) {
    const p = readPlacement((r.data ?? {}) as Record<string, unknown>);
    if (p.kind !== 'order') continue;
    scanned++;
    const layer = layerOf(r);
    const bucket = orderDomain.get(layer);
    const entry = { id: r.id, order: p.order, len: p.order?.length ?? 0 };
    if (bucket) bucket.push(entry); else orderDomain.set(layer, [entry]);
  }
  for (const [layer, members] of orderDomain) {
    // 同层等值键分组（合法键值域——非法/缺键不参与重复判定：等值语义依赖 canonical 键）
    const byKey = new Map<string, number>();
    let layerHit = false;
    for (const m of members) {
      if (m.order == null) { missing.push(m.id); layerHit = true; continue; }
      if (!isValidOrderKey(m.order)) { hard.push(m.id); layerHit = true; continue; }
      if (m.len >= ORDER_KEY_SOFT_LIMIT) { soft.push(m.id); layerHit = true; }
      byKey.set(m.order, (byKey.get(m.order) ?? 0) + 1);
    }
    for (const m of members) {
      if (m.order != null && isValidOrderKey(m.order) && (byKey.get(m.order) ?? 0) > 1) {
        duplicateMembers.push(m.id);
        layerHit = true;
      }
    }
    if (layerHit) hitLayers.add(layer);   // 仅真实命中档的层入集合
  }
  const kinds: OrderPathologyKind[] = [];
  if (duplicateMembers.length > 0) kinds.push('duplicate-key');
  if (soft.length > 0) kinds.push('soft-key');
  if (hard.length > 0) kinds.push('hard-key');
  if (missing.length > 0) kinds.push('missing-key');
  return {
    kinds,
    duplicateKeyNodes: duplicateMembers.length,
    softKeyNodes: soft.length,
    hardKeyNodes: hard.length,
    missingKeyNodes: missing.length,
    layers: [...hitLayers],
    scannedNodes: scanned,
  };
}

/** clean 谓词（api 装载档告警分流：clean ⇒ 零计数零日志）。 */
export function isCleanOrderPathology(report: OrderPathologyReport): boolean {
  return report.kinds.length === 0;
}
