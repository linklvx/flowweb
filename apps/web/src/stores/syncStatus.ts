// apps/web/src/stores/syncStatus.ts
// 批2-1：canEdit 纯函数（spec 状态层/canEdit 门组）——VIEWER 双层（批2-2）与异步落地（批2-3）的判据基础。
// 合取：hydration==='ready' && !collabReadOnly && wsAuthNotice 非 terminal。
// sessionLost（时间面）与 httpExpired 不在列（反向断言锚：HTTP 过期面只驱动横幅，编辑权回收走 WS 终态）。
// "ready 但无会话"结构上不存在（ready 唯一写点在 initCollab synced 段）——无需读 runtime 模块变量。
import type { CanvasState } from './canvasStore';

export const canEdit = (s: CanvasState): boolean =>
  s.hydration === 'ready' && !s.collabReadOnly && s.wsAuthNotice?.terminal !== true;
