// apps/web/src/collab/rejected-recovery.ts
// Y1c T25（plan v1.7 Task 25——spec v5.4 §8.1 拒帧恢复+§4.5 DraftEnvelope 三场景）：REJECTED/
// DIVERGED 恢复模块。runtime（canvasCollabRuntime）close/stateless 分派的消费面：
//  - Y1c 四码客户端分派接线（修正 #7：4406/4411/4412/4413 先经 resolveRecoveryAction——
//    assertY1cCodesNotBackoffRouted 装配守卫防漂移回 backoff）；
//  - 重复 DENY 逃生口状态机（N=3 次 4411→recovery 模式粘住——shared advanceRecoveryDenyState 单源）；
//  - DraftEnvelope 类型化导出（serializeCanvas canonical 快照+sha256 摘要+#9 historyId）；
//  - historyId 客户端半链（auth-receipt 持久化+h= 上行参数——T9 服务端已落）；
//  - docName #g 世代载体（T12——api doc-name.util canvasDocName 的 web 侧镜像，形态锁测试）；
//  - 多标签 BroadcastChannel（recovery 态跨 tab 通告——同 pid 会话同进 recovery 停重连预算）。
// 纯逻辑+窄 IO（下载/localStorage/BroadcastChannel feature-detect）——零 runtime 会话态依赖
// （会话态归 runtime；本模块只提供可单测的机构）。
import {
  CollabCloseCode,
  serializeCanvas,
  advanceRecoveryDenyState,
  assertY1cCodesNotBackoffRouted,
  CONSECUTIVE_DENY_RECOVERY_THRESHOLD,
  formatProviderHistoryParam,
  type DraftEnvelope,
  type RecoveryDenyState,
} from '@flowweb/shared';
import type * as Y from 'yjs';

// ═══ §0 装配守卫（修正 #7——Y1c 四码禁入通用 backoff 处理集合）════════════════════════════

/** 通用重连族（resolveCloseAction backoff 档同族码——supervisor 指数档承接面）。本模块装配期
 *  断言：Y1c 四码（4406/4411/4412/4413）绝不在此集合——任何后继维护把 Y1c 码加进通用 backoff
 *  面，模块加载即 throw（fail-closed，测试红）。 */
export const GENERIC_RECONNECT_BACKOFF_CODES: readonly number[] = [
  CollabCloseCode.RATE_LIMITED_CLOSE,   // 1008
  CollabCloseCode.SLOW_CONSUMER,        // 1011
  CollabCloseCode.LIB_RESET,            // 4205
  CollabCloseCode.LIB_FORBIDDEN,        // 4403
  CollabCloseCode.LIB_CONNECTION_TIMEOUT, // 4408
  CollabCloseCode.MAX_LIFETIME,         // 4402
  CollabCloseCode.NORMAL,               // 1000（库抹码掩盖瞬态——裁定 24⑴）
];
assertY1cCodesNotBackoffRouted(GENERIC_RECONNECT_BACKOFF_CODES);

// ═══ §1 docName #g 世代载体（T12——web 侧镜像）═══════════════════════════════════════════

/** provider wire docName（api doc-name.util canvasDocName 镜像：gen0=裸名、gen>0=`#g<N>`——
 *  规范形禁前导零/大写 G〔api DOC_NAME_RE 单源〕。形态锁=rejected-recovery.spec 对照断言；
 *  世代真值=服务端 DB（fetchProjectMeta collabGeneration）——R3 注记：客户端按 DB 真值构造，
 *  不做本地推断）。generation 缺失（meta 不完整会话）=裸名兜底（gen0 语义——服务端 auth 面给
 *  权威拒因走恢复通道）。 */
export function collabDocNameOf(projectId: string, generation: number | undefined): string {
  const g = typeof generation === 'number' && Number.isFinite(generation) ? Math.trunc(generation) : 0;
  return g > 0 ? `project:${projectId}#g${g}` : `project:${projectId}`;
}

// ═══ §2 historyId 客户端半链（T9 服务端已落——auth-receipt 回执消费）════════════════════

const HISTORY_ID_STORAGE_KEY = 'collab:history-id';

/** auth-receipt 载荷（SG.onConnected stateless——T9 修正 #8 半链：首连放行+回执下发）。 */
export interface AuthReceiptPayload {
  type: 'auth-receipt';
  historyId: string;
  protocolVersion: number;
  schemaVersion: number;
}

export function parseAuthReceipt(payload: string): AuthReceiptPayload | null {
  try {
    const m = JSON.parse(payload) as Record<string, unknown>;
    if (m?.type !== 'auth-receipt' || typeof m.historyId !== 'string' || m.historyId === '') return null;
    return {
      type: 'auth-receipt',
      historyId: m.historyId,
      protocolVersion: typeof m.protocolVersion === 'number' ? m.protocolVersion : 0,
      schemaVersion: typeof m.schemaVersion === 'number' ? m.schemaVersion : 0,
    };
  } catch {
    return null;
  }
}

export function loadPersistedHistoryId(): string | null {
  try {
    return localStorage.getItem(HISTORY_ID_STORAGE_KEY) || null;
  } catch {
    return null;   // storage 不可用（隐私模式）——首连放行档（回执再补）
  }
}

export function persistHistoryId(historyId: string): void {
  try { localStorage.setItem(HISTORY_ID_STORAGE_KEY, historyId); } catch { /* 尽力——次连无 h= 走首连放行档 */ }
}

/** provider URL 追加 h= 参数（formatProviderHistoryParam 单源——无值 null 不追加=首连放行）。 */
export function appendHistoryParam(url: string, historyId: string | null): string {
  if (!historyId) return url;
  return `${url}&${formatProviderHistoryParam(historyId)}`;
}

// ═══ §3 Y1c close 载荷解析（stateless 前置载荷——T12 4410 载荷先例）═════════════════════

/** Y1c close 前置 stateless 载荷（服务端 hardClose 前尽力投递——close 帧只携 code+reason 短串，
 *  retryAfterMs/generation/discardLocalCache 等结构化字段经 stateless 通道）。 */
export interface Y1cClosePayload {
  code: number;
  reason: string;
  generation?: number;
  discardLocalCache?: boolean;
  retryAfterMs?: number;
}

export function parseY1cClosePayload(payload: string): Y1cClosePayload | null {
  try {
    const m = JSON.parse(payload) as Record<string, unknown>;
    if (typeof m?.code !== 'number' || typeof m?.reason !== 'string') return null;
    return {
      code: m.code,
      reason: m.reason,
      ...(typeof m.generation === 'number' ? { generation: m.generation } : {}),
      ...(m.discardLocalCache === true ? { discardLocalCache: true } : {}),
      ...(typeof m.retryAfterMs === 'number' && m.retryAfterMs > 0 ? { retryAfterMs: m.retryAfterMs } : {}),
    };
  } catch {
    return null;
  }
}

// ═══ §4 DraftEnvelope 类型化导出（§4.5——#9 historyId 随行）══════════════════════════════

/** sha256 64hex（crypto.subtle——浏览器/Node18+ 通用；缺 subtle 环境=零填充占位〔完整性摘要
 *  不可得时诚实占位非伪造〕，diag 侧可辨）。 */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: { digest(a: string, b: Uint8Array): Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (!subtle) return '0'.repeat(64);
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DraftEnvelopeBuildInput {
  doc: Y.Doc;
  projectId: string;
  generation: number;
  schemaVersion: number;
  historyId: string;
  tabId: string;
  draftId?: string;
}

/** 构建 DraftEnvelope（serializeCanvas canonical 快照——非 CRDT 裸字节；hashes=nodes/edges
 *  canonical JSON 的 sha256）。空 doc（零节点零边）=null（无可保全内容——调用方跳过下载）。 */
export async function buildDraftEnvelope(i: DraftEnvelopeBuildInput): Promise<DraftEnvelope | null> {
  const canvas = serializeCanvas(i.doc);
  if (canvas.nodes.length === 0 && canvas.edges.length === 0) return null;
  const [nodesHash, edgesHash] = await Promise.all([
    sha256Hex(JSON.stringify(canvas.nodes)),
    sha256Hex(JSON.stringify(canvas.edges)),
  ]);
  return {
    draftId: i.draftId ?? `draft-${i.projectId}-g${i.generation}-${Date.now()}`,
    projectId: i.projectId,
    generation: i.generation,
    schemaVersion: i.schemaVersion,
    historyId: i.historyId,   // #9：捕获纪元随行
    capturedAtMs: Date.now(),
    tabId: i.tabId,
    nodes: canvas.nodes,
    edges: canvas.edges,
    meta: canvas.meta,
    hashes: { nodes: nodesHash, edges: edgesHash },
  };
}

/** 信封下载（.json 文件——用户裁定面/离线保全双用途）。 */
export function downloadDraftEnvelope(envelope: DraftEnvelope): void {
  const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `canvas-draft-${envelope.projectId}-g${envelope.generation}-${envelope.draftId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ═══ §5 重复 DENY 逃生口状态机（N=3——shared 单源转移+跨 tab 通告）══════════════════════

export const DENY_ESCAPE_THRESHOLD = CONSECUTIVE_DENY_RECOVERY_THRESHOLD;

/** 多标签 BroadcastChannel（T18 无既有通道——本模块建；feature-detect：环境缺席（旧 jsdom）=
 * no-op 降级不阻断恢复主链）。 */
export const RECOVERY_BROADCAST_CHANNEL = 'collab-recovery';

export interface RecoveryBroadcastMessage {
  type: 'collab-recovery';
  pid: string;
  kind: 'deny-escape' | 'server-restored' | 'history-bump' | 'recovery-accepted';   // history-bump=收口 I-1+I-2：4406 面 bump 通告（他 tab 自清 h+缓存族）；recovery-accepted=T25b B5：管理员接受 server-restored（他 tab 同步退出只读恢复——清缓存+reload 重建）
}

export function broadcastRecoveryState(msg: RecoveryBroadcastMessage): void {
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(RECOVERY_BROADCAST_CHANNEL);
    ch.postMessage(msg);
    ch.close();
  } catch { /* 通道失败不阻断恢复——他 tab 自身 close 面独立收敛 */ }
}

/** 逃生口跟踪器（纯转移函数的窄状态壳——runtime 持单例；测试可独立构造）。 */
export class RecoveryDenyTracker {
  private state: RecoveryDenyState = { consecutiveDenyCount: 0, mode: 'normal' };
  /** recovery 模式进入边沿（一次性回调——runtime 接 store 写点+broadcast）。 */
  onRecoveryMode: (() => void) | null = null;

  get snapshot(): RecoveryDenyState { return { ...this.state }; }

  /** 4411 close 计数（4412 不计——pending 拒绝自愈面；§8.1 逃生口=N 次 4411）。 */
  deny4411(): void {
    const before = this.state.mode;
    this.state = advanceRecoveryDenyState(this.state, { kind: 'deny-4411' });
    if (before === 'normal' && this.state.mode === 'recovery') this.onRecoveryMode?.();
  }

  /** synced/authenticated 成功（计数清零——recovery 态粘住仅 recovery-complete 退出）。 */
  syncOk(): void {
    this.state = advanceRecoveryDenyState(this.state, { kind: 'sync-ok' });
  }

  /** 用户完成裁定导入（导出→重置→导入三步闭环——回 normal）。 */
  recoveryComplete(): void {
    this.state = advanceRecoveryDenyState(this.state, { kind: 'recovery-complete' });
  }

  /** 会话边界复位（runtime initCollab 消费——新会话=新额度；resync 恢复环内经 preserve
   *  豁免：连续 deny 计数必须跨 resync 存活，否则恢复环永不达阈值=逃生口结构性失效）。 */
  reset(): void {
    this.state = { consecutiveDenyCount: 0, mode: 'normal' };
  }

  restore(s: RecoveryDenyState): void {
    this.state = { ...s };
  }
}
