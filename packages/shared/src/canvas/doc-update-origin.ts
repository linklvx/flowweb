// packages/shared/src/canvas/doc-update-origin.ts
// Y1c T24（spec v5.4 §3.2 v5.4⑤ origin 枚举）：doc_update_origin_total{origin} 计数器分类器——
// label 限 closed 六值 gate|connection|load|import|maintenance|server-direct；**仅 server-direct
// 在 serving 期写 doc 时告警**（load/import/maintenance=合法受控路径——S1 验收⑦/⑧）。
// 归类（事件面=persistence update 监听单点，全部 update 事件必经）：
//  - gate：actor gate pre-apply（isGateApplyOrigin——{source:'connection',connection,gate:true}）；
//  - connection：Hocuspocus 库内幂等重放（origin={source:'connection',connection} 无 gate 标记）；
//  - load：装载/恢复重放（replay 抑制窗内 origin=undefined——withReplaySuppressed 直调零 origin）；
//  - maintenance：服务端受控事务（SERVER_TRANSACT_ORIGIN='server'——withDoc/writeBatch/shrink 族；
//    S1 ⑧ allowlist 面=load/replay/maintenance/readCanvas/withDoc）；
//  - server-direct：**其余一切**（未识别 origin——fail-closed 告警桶：含越出 allowlist 的
//    DirectConnection 业务写）。serving 期命中=结构告警（计数+调用方节流日志）。
//  - import：recovery import（T25 typed DraftEnvelope 导入路径——预留分类，当前零调用面）。
import { SERVER_TRANSACT_ORIGIN } from './docShape';

/** doc_update_origin_total label 词表（closed 六值——spec §3.2 v5.4⑤）。 */
export const DOC_UPDATE_ORIGINS = ['gate', 'connection', 'load', 'import', 'maintenance', 'server-direct'] as const;
export type DocUpdateOrigin = typeof DOC_UPDATE_ORIGINS[number];

/** gate apply origin 形（doc-protocol isGateApplyOrigin 的结构性最小面——避免 collab/ 冻结面 import）。 */
const isGateOriginShape = (o: unknown): boolean =>
  typeof o === 'object' && o !== null && (o as { source?: unknown }).source === 'connection'
  && (o as { gate?: unknown }).gate === true;

const isConnectionOriginShape = (o: unknown): boolean =>
  typeof o === 'object' && o !== null && (o as { source?: unknown }).source === 'connection';

/**
 * 分类（纯函数）：origin 事件源 → closed 六值。
 * replaying=装载/恢复重放抑制窗内（load 档）；其余 undefined/未知一律 server-direct（fail-closed
 * 告警桶——宁可误报不可漏报：越 allowlist 的服务端写必须可见）。
 */
export function classifyDocUpdateOrigin(origin: unknown, opts?: { replaying?: boolean }): DocUpdateOrigin {
  if (isGateOriginShape(origin)) return 'gate';
  if (origin === SERVER_TRANSACT_ORIGIN) return 'maintenance';
  if (isConnectionOriginShape(origin)) return 'connection';
  if (opts?.replaying) return 'load';
  if (origin === 'import') return 'import';
  return 'server-direct';
}
