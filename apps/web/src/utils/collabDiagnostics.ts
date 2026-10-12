// apps/web/src/utils/collabDiagnostics.ts
// 批1-5 collab 诊断（spec：环形缓冲最近 500 条 + prod 常开计数 + kill switch）——零依赖纯模块。
// 事件类型：ws_status 迁移 / recover_triggered（恢复各级）/ watchdog_fire / hydration_fail /
// auth_reject / write_reject / invariant_violation（批4a doc⇄store 投影不变量——dev/prod 均计数）。
// Y0b-5 T2（spec §5.6 ring 接 sink）：类型对齐 shared 遥测白名单 12 值（close_code/projection_duration
// 本批接线、unsynced_close 归 T6）+批量聚合缓冲（复合键）+30s 心跳 loop（会话绑定）+pagehide 即刻
// flush+sendBeacon/fetch keepalive 直连（禁统一 api 封装——其 401 无差别置 httpExpired 电平）。
import { isKnownTelemetryType, MAX_TELEMETRY_EVENTS_PER_BATCH, type CollabTelemetryEventType } from '@flowweb/shared';

/** 类型=shared 白名单单源（12 值封闭——本地 ring 与服务端 sanitize 同集；白名单外不入批） */
export type CollabDiagEventType = CollabTelemetryEventType;

export interface CollabDiagEvent {
  type: CollabDiagEventType;
  at: number;
  detail?: Record<string, unknown>;
}

const RING_CAPACITY = 500;
const ring: CollabDiagEvent[] = [];
const counters = new Map<CollabDiagEventType, number>();

// ── Y0b-5 T2：批量聚合缓冲（复合键 Map）──
/** 聚合后待发条目：同复合键合并 n 计数/首 at（detail=首条原样——sanitize 在服务端 T1） */
interface TelemetryBatchEntry {
  type: CollabTelemetryEventType;
  at: number;
  n: number;
  detail?: Record<string, unknown>;
}
const pendingBatch = new Map<string, TelemetryBatchEntry>();
let telemetryDroppedTotal = 0;

/** 复合聚合键=type|code|reason + label 维 from/to（同键合并 n——分布不被压掉；from/to 不入键会把
 *  迁移对压一条且 SLO 载体被首条无 ms 迁移合并丢失=v1 病复发）。ws_status 额外附 ms：SLO 时长是
 *  直方图 observe 值非 label——合并=丢样本（flapping 窗两条 reconnect 各自存活）；projection_duration
 *  的 ms 不入键（每次 apply 值皆异——入键=聚合击穿，12 上限即刻爆+全批丢弃）。 */
function batchKey(type: CollabDiagEventType, detail?: Record<string, unknown>): string {
  const labels = `${detail?.code ?? ''}|${detail?.reason ?? ''}|${detail?.from ?? ''}|${detail?.to ?? ''}`;
  return type === 'ws_status' ? `${type}|${labels}|${detail?.ms ?? ''}` : `${type}|${labels}`;
}

export function recordCollabDiag(type: CollabDiagEventType, detail?: Record<string, unknown>): void {
  counters.set(type, (counters.get(type) ?? 0) + 1);
  const at = Date.now();
  ring.push({ type, at, detail });
  if (ring.length > RING_CAPACITY) ring.splice(0, ring.length - RING_CAPACITY);
  if (!isKnownTelemetryType(type)) return; // 白名单外只进 ring 不入批（运行时防御）
  const key = batchKey(type, detail);
  const existing = pendingBatch.get(key);
  if (existing) { existing.n += 1; return; }
  if (pendingBatch.size >= MAX_TELEMETRY_EVENTS_PER_BATCH) {
    telemetryDroppedTotal += 1;
    if (import.meta.env.DEV) console.warn(`[collabDiag] 遥测批量超 ${MAX_TELEMETRY_EVENTS_PER_BATCH} 条——新复合键丢弃（计数 ${telemetryDroppedTotal}）`);
    return;
  }
  pendingBatch.set(key, { type, at, n: 1, detail });
}

export function getRecentCollabDiag(): readonly CollabDiagEvent[] {
  return ring;
}

export function getCollabDiagCounters(): ReadonlyMap<CollabDiagEventType, number> {
  return counters;
}

/** 聚合后截断丢弃计数（测试/巡检观测面——不入遥测本身） */
export function getTelemetryDroppedTotal(): number {
  return telemetryDroppedTotal;
}

/** kill switch：VITE_COLLAB_AUTO_RECOVER=off 时 watchdog 只记录不 recover（读取时点求值——env 可 stub） */
export function isAutoRecoverDisabled(): boolean {
  return import.meta.env.VITE_COLLAB_AUTO_RECOVER === 'off';
}

// ── Y0b-5 T2：flush（sendBeacon 优先/fetch keepalive 降级——两路直连，不经统一 api 封装）──

const TELEMETRY_ENDPOINT = '/api/collab/telemetry';
const TELEMETRY_FLUSH_INTERVAL_MS = 30_000;

/** 批次级元数据源（csv=协议版本/generation=vacuum 代际——runtime 注册，flush 时求值；未注册不发。
 *  csv=string|number：CLIENT_PROTOCOL_VERSION 是数字字面量（服务端 meta() String() 归一） */
let telemetryMeta: (() => { csv?: string | number; generation?: number }) | null = null;
export function registerTelemetryMeta(fn: () => { csv?: string | number; generation?: number }): void {
  telemetryMeta = fn;
}

/** 即刻上报缓冲（幂等——发后清空；缓冲空零 beacon=匿名页零 401 噪声）。
 *  直连两路均不经统一 api 封装（client.ts:30——401 无差别置 httpExpired 电平=误报登录过期）。
 *  Blob 必须 application/json（text/plain=CORS simple request 跨站伪造面——预检正是防线）。 */
export function flushTelemetry(): void {
  if (pendingBatch.size === 0) return;
  const events = [...pendingBatch.values()].slice(0, MAX_TELEMETRY_EVENTS_PER_BATCH);
  pendingBatch.clear();
  const meta = telemetryMeta?.();
  const payload = JSON.stringify({ events, clientBuild: __CLIENT_BUILD__, csv: meta?.csv, generation: meta?.generation });
  const blob = new Blob([payload], { type: 'application/json' });
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(TELEMETRY_ENDPOINT, blob);
    return;
  }
  if (typeof fetch !== 'function') return; // 双通道均不可用（极端环境/测试基座）——丢弃即弃（禁重试循环）
  void fetch(TELEMETRY_ENDPOINT, { method: 'POST', body: blob, keepalive: true }).catch(() => { /* 尽力上报——失败即弃（禁重试循环） */ });
}

// ── Y0b-5 T2：30s 心跳 loop（启停绑定 initCollab/destroyCollab——无会话零 beacon）──

let telemetryLoopTimer: ReturnType<typeof setInterval> | null = null;

/** 测试缝+runtime 接线点：起搏（幂等——已运行零动作） */
export function _startTelemetryLoop(): void {
  if (telemetryLoopTimer !== null) return;
  telemetryLoopTimer = setInterval(flushTelemetry, TELEMETRY_FLUSH_INTERVAL_MS);
}

/** 测试缝+runtime 接线点：停搏（destroyCollab 会话终点） */
export function _stopTelemetryLoop(): void {
  if (telemetryLoopTimer === null) return;
  clearInterval(telemetryLoopTimer);
  telemetryLoopTimer = null;
}

/** 测试缝：loop 运行态（启停绑定断言用） */
export function _telemetryLoopRunning(): boolean {
  return telemetryLoopTimer !== null;
}

/** 测试缝：环形缓冲/计数/批量缓冲复位（loop 与 window 监听不属测试态——不动） */
export function _resetCollabDiagForTest(): void {
  ring.length = 0;
  counters.clear();
  pendingBatch.clear();
  telemetryDroppedTotal = 0;
}

// dev 挂载：控制台现场取证（window.__collabDiag.recent() / .counters()）；prod 不挂——计数仍常开
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__collabDiag = { recent: getRecentCollabDiag, counters: getCollabDiagCounters };
}

// Y0b-5 T2：页面卸载兜底——pagehide（主）+visibilitychange hidden（辅）即刻 flush（模块级一次挂；
// 缓冲空=零 beacon，匿名页零上报；bfcache/后台回收两形态均兜住）
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushTelemetry);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushTelemetry(); });
}
