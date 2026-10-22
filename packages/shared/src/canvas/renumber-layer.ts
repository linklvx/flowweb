// packages/shared/src/canvas/renumber-layer.ts
// T18（plan v11.2 S5 片·spec Z4''-v14）：CLI `renumber-layer` 规划单源——离线/维护窗层键重排
// （幂等，不承诺永久无重复）。在线 repair 整建制删除（G53 改口：读序 (order,id)/(slot,id)
// 双 tie-break 容忍重复键——repair 是质量优化非正确性需求）；本模块=CLI 的纯规划核
// （scripts/collab-renumber-layer.mjs 消费 dist——写回归 CLI 的 PG 直连单事务）。
//
// 语义（spec Z4''-v14 词表）：
//   - 按层 (order,id) 现序全量重排为带间隙整键（base 5000=FIRST_ORDER_KEY 中位点、步长 100
//     ——双向留增长余量+中插 .5 族空间；幂等：再跑零变更）。
//   - slot 域不动（分镜格位整值已紧凑——resize/swap/删格全走整值写）。
//   - 跨层旧键（入组/出组携带）一并重排（全层全量重排天然覆盖）。
//   - 重复键容忍（不 500）：重排输入=读序（compareWithinLayer 含 tie-break），等值键成员按
//     (order,id) 稳定序获得相异新键=去重；再产生的重复（离线合并回灌）非本 CLI 承诺面。
//   - 缺键/非法键成员殿后档（读序兜底序）同样获得新键=修复缺键/非法键病理。
import { FIRST_ORDER_KEY } from './order-key';
import { compareWithinLayer, layerOf, type OrderableRecord } from './order-records';
import { readPlacement } from './placement';

/** 重排键参数（带间隙整键：5000,5100,5200,…——base=空层首键中位点单源引用）。 */
export const RENUMBER_BASE = Number(FIRST_ORDER_KEY);   // 5000
export const RENUMBER_STEP = 100;

/** 重排计划（CLI 消费：byId 应用到 doc data.order；layers/changed=dry-run 报告面）。 */
export interface RenumberPlan {
  /** id → 新 order 键（仅含需变更的成员——同值不重排=幂等零变更面） */
  byId: Map<string, string>;
  /** 受影响层键集合（parent id；根层=null） */
  layers: ReadonlySet<string | null>;
  /** 参与重排的 order 域成员总数（分母——含同值跳过者） */
  scannedNodes: number;
}

/** 层键重排规划纯函数（输入只读不改；读序单源=compareWithinLayer 含 (order,id) tie-break）。 */
export function planRenumberLayers(records: readonly OrderableRecord[]): RenumberPlan {
  const byLayer = new Map<string | null, OrderableRecord[]>();
  let scanned = 0;
  for (const r of records) {
    const p = readPlacement((r.data ?? {}) as Record<string, unknown>);
    if (p.kind !== 'order') continue;   // slot 域不动（格位整值已紧凑）
    scanned++;
    const layer = layerOf(r);
    const bucket = byLayer.get(layer);
    if (bucket) bucket.push(r); else byLayer.set(layer, [r]);
  }
  const byId = new Map<string, string>();
  const layers = new Set<string | null>();
  for (const [layer, members] of byLayer) {
    members.sort((a, b) => compareWithinLayer(a, b));   // 现序（含重复键 tie-break——等值键按 id 稳定分键）
    let changedInLayer = false;
    members.forEach((m, i) => {
      const next = String(RENUMBER_BASE + i * RENUMBER_STEP);
      const cur = (m.data ?? {})['order'];
      if (cur === next) return;   // 同值零变更（幂等：已重排层再跑零写）
      byId.set(m.id, next);
      changedInLayer = true;
    });
    if (changedInLayer) layers.add(layer);
  }
  return { byId, layers, scannedNodes: scanned };
}
