// apps/web/src/stores/syncStatus.ts
// 批2-1：canEdit 纯函数（spec 状态层/canEdit 门组）——VIEWER 双层（批2-2）与异步落地（批2-3）的判据基础。
// 合取：hydration==='ready' && !collabReadOnly && wsAuthNotice 非 terminal。
// sessionLost（时间面）与 httpExpired 不在列（反向断言锚：HTTP 过期面只驱动横幅，编辑权回收走 WS 终态）。
// "ready 但无会话"结构上不存在（ready 唯一写点在 initCollab synced 段）——无需读 runtime 模块变量。
import type { CanvasState } from './canvasStore';

export const canEdit = (s: CanvasState): boolean =>
  s.hydration === 'ready' && !s.collabReadOnly && s.wsAuthNotice?.terminal !== true;

/** Y0b-2 T7（裁定 2）：canExecute 一等谓词——只留硬态（自持未确认标记两方向都会漂，不立字段；
 *  钱的方向由服务端 SV 支配门权威兜底——SYNC_PENDING 409 反应式重发）。
 *  canEdit 基础 ∧ connStatus==='connected' ∧ !writeFrozen（冻结契约 12：writeFrozen⇒禁执行）。
 *  writeFrozen 置位点=Y0b-5 gateway 快照下发（Z55 落位——当前恒 false，T9 残余登记 drain 窗口行为）。 */
export const canExecute = (s: CanvasState): boolean =>
  canEdit(s) && s.connStatus === 'connected' && !s.writeFrozen;
