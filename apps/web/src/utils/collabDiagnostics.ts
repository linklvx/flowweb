// apps/web/src/utils/collabDiagnostics.ts
// 批1-5 collab 诊断（spec：环形缓冲最近 500 条 + prod 常开计数 + kill switch）——零依赖纯模块。
// 事件类型：ws_status 迁移 / recover_triggered（恢复各级）/ watchdog_fire / hydration_fail /
// auth_reject / write_reject（后两者批 2/批 4 接入——类型先行固化）。
export type CollabDiagEventType =
  | 'ws_status'
  | 'recover_triggered'
  | 'watchdog_fire'
  | 'hydration_fail'
  | 'auth_reject'
  | 'write_reject';

export interface CollabDiagEvent {
  type: CollabDiagEventType;
  at: number;
  detail?: Record<string, unknown>;
}

const RING_CAPACITY = 500;
const ring: CollabDiagEvent[] = [];
const counters = new Map<CollabDiagEventType, number>();

export function recordCollabDiag(type: CollabDiagEventType, detail?: Record<string, unknown>): void {
  counters.set(type, (counters.get(type) ?? 0) + 1);
  ring.push({ type, at: Date.now(), detail });
  if (ring.length > RING_CAPACITY) ring.splice(0, ring.length - RING_CAPACITY);
}

export function getRecentCollabDiag(): readonly CollabDiagEvent[] {
  return ring;
}

export function getCollabDiagCounters(): ReadonlyMap<CollabDiagEventType, number> {
  return counters;
}

/** kill switch：VITE_COLLAB_AUTO_RECOVER=off 时 watchdog 只记录不 recover（读取时点求值——env 可 stub） */
export function isAutoRecoverDisabled(): boolean {
  return import.meta.env.VITE_COLLAB_AUTO_RECOVER === 'off';
}

/** 测试缝：环形缓冲/计数复位 */
export function _resetCollabDiagForTest(): void {
  ring.length = 0;
  counters.clear();
}

// dev 挂载：控制台现场取证（window.__collabDiag.recent() / .counters()）；prod 不挂——计数仍常开
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__collabDiag = { recent: getRecentCollabDiag, counters: getCollabDiagCounters };
}
