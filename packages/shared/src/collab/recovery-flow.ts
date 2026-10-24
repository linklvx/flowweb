// packages/shared/src/collab/recovery-flow.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段——spec v5.4 §8.1）：4410 三分/4411/4412/4413/4406 客户端
// 恢复动作契约+重复 DENY 逃生口状态机+historyId 半链消费。**CONTRACT-FREEZE**——类型+常量+纯函数；
// 消费方=T10 web 恢复机/T25 恢复实现。复用纪律：close 载荷+reason 常量+auth 半链判定全部 import
// 自 T5a doc-protocol.ts/collab-close-code.ts（禁重抄第二份 reason 表）。契约测试=recovery-flow.spec.ts。
import {
  CollabCloseCode,
  DOC_GENERATION_STALE_TERMINAL_REASON,
  DOC_VACUUMING_TERMINAL_REASON,
  SERVER_RESTORED_TERMINAL_REASON,
} from '../constants/collab-close-code';
import type { CollabY1cClosePayload, AuthHistoryVerdict } from './doc-protocol';

// ═══ §1 恢复动作枚举+close 载荷分派（§8.1）══════════════════════════════════════════════════

/** 客户端恢复动作七值（plan T5c 卡冻结；T10 web 恢复机消费）：
 *  - reconnect-new-generation：4410 doc-generation-stale——全会话重建（新 docName(#g)+清整族缓存）；
 *  - export-draft-then-clear：4410 doc-vacuuming——离线 dirty 草稿先导出 DraftEnvelope 再清缓存
 *    （换代前先保存可恢复脏草稿再清——禁静默丢离线编辑〔§3.4〕）；
 *  - readonly-recovery-user-adjudication：4410 server-restored——不清缓存，只读 recovery+草稿导出+
 *    管理员裁定（g_client>g_server 或 historyId 不匹配——堵同代 PITR 客户端 SS2 复活）；
 *  - resync-full：4411/4412——客户端重置到服务端状态（零本地增量重放）+B 场景草稿裁定；
 *  - force-refresh-protocol：4406 client-outdated——客户端强刷后对齐硬门三元；
 *  - retry-after-maintenance：4413 maintenance-freeze——按 Retry-After 可重试（非终态）；
 *  - backoff-retry：其余/瞬态——退避重连（resolveCloseAction backoff 档同族）。 */
export type RecoveryAction =
  | 'reconnect-new-generation'
  | 'export-draft-then-clear'
  | 'readonly-recovery-user-adjudication'
  | 'resync-full'
  | 'force-refresh-protocol'
  | 'retry-after-maintenance'
  | 'backoff-retry';

/** close 载荷→恢复动作（纯函数——按 T5a 冻结的 close reason 常量分派，穷尽 CollabY1cClosePayload
 *  判别 union 无 default；非 Y1c 码面统一落 backoff-retry〔resolveCloseAction 瞬态退避档同语义〕）。
 *  4411/4412 同落 resync-full：拒帧恢复=重置到服务端状态+DraftEnvelope 同代 fresh doc（§8.1）——
 *  4411 的连续计数归 §2 逃生口状态机（本函数不携带计数状态）。 */
export function resolveRecoveryAction(
  payload: CollabY1cClosePayload | { code: number; reason?: string },
): RecoveryAction {
  if (payload.code === CollabCloseCode.GENERATION_SUPERSEDED) {
    // 4410 三分（判据=collab-close-code 单源常量 import——禁重抄 reason 字面量〔头注纪律〕）
    if (payload.reason === DOC_GENERATION_STALE_TERMINAL_REASON) return 'reconnect-new-generation';
    if (payload.reason === DOC_VACUUMING_TERMINAL_REASON) return 'export-draft-then-clear';
    return 'readonly-recovery-user-adjudication';   // SERVER_RESTORED_TERMINAL_REASON（三分兜底档）
  }
  if (payload.code === CollabCloseCode.FRAME_MALFORMED) return 'resync-full';        // 4411 毒帧/apply 失败
  if (payload.code === CollabCloseCode.RESYNC_REQUIRED) return 'resync-full';        // 4412 pending 区间拒绝
  if (payload.code === CollabCloseCode.MAINTENANCE_FREEZE) return 'retry-after-maintenance';
  if (payload.code === CollabCloseCode.CLIENT_OUTDATED) return 'force-refresh-protocol';
  return 'backoff-retry';
}

// ═══ §2 重复 DENY 逃生口（§8.1——N 次 4411 后 recovery 模式）══════════════════════════════════

/** 阈值冻结=3（Controller 工程值裁定：连续三次 4411=确定性客户端态坏，再循环=自我 DoS；
 *  1-2 次可能瞬态——不提前切换）。 */
export const CONSECUTIVE_DENY_RECOVERY_THRESHOLD = 3 as const;

/** 逃生口状态机（纯转移函数）：
 *  - deny-4411：计数+1；达阈值（≥3）切 recovery 模式；
 *  - sync-ok：恢复同步成功——normal 态归零计数（1-2 次瞬态重置重新起算）；recovery 态归零计数
 *    但**模式粘住**（退出仅经 recovery-complete）；
 *  - recovery-complete：用户完成裁定导入——回 normal 计数清零；
 *  - recovery 态下 deny-4411 不回退不重进（禁无限重连循环——负控由测试锁定）。 */
export interface RecoveryDenyState {
  consecutiveDenyCount: number;
  mode: 'normal' | 'recovery';
}

export type RecoveryDenyEvent =
  | { kind: 'deny-4411' }
  | { kind: 'sync-ok' }
  | { kind: 'recovery-complete' };

export function advanceRecoveryDenyState(s: RecoveryDenyState, event: RecoveryDenyEvent): RecoveryDenyState {
  switch (event.kind) {
    case 'deny-4411': {
      const count = s.consecutiveDenyCount + 1;
      return { consecutiveDenyCount: count, mode: count >= CONSECUTIVE_DENY_RECOVERY_THRESHOLD ? 'recovery' : s.mode };
    }
    case 'sync-ok':
      return { consecutiveDenyCount: 0, mode: s.mode };
    case 'recovery-complete':
      return { consecutiveDenyCount: 0, mode: 'normal' };
  }
}

/** 逃生口契约注记（§8.1 末句：客户端 N 次 4411 后切换 recovery 模式〔导出→重置→用户裁定导入〕，
 *  禁无限重连循环——recovery 模式下不再消耗重连预算，只走三步恢复序列）。 */
export const DENY_ESCAPE_HATCH_CONTRACT = {
  sequence: '导出 DraftEnvelope→重置到服务端状态→用户裁定导入（B 场景裁定面）',
  noInfiniteReconnectLoop: '禁无限重连循环——达阈值后 recovery 模式粘住，重连预算停发',
  threshold: CONSECUTIVE_DENY_RECOVERY_THRESHOLD,
} as const;

// ═══ §3 historyId 客户端半链消费（§8.1 v5.4⑦——复用 T5a 单源）════════════════════════════════

/** auth 裁定→恢复动作映射（纯函数；verdict 由 T5a resolveAuthHistoryVerdict 产生——**先比
 *  historyId 再比 generation**：g_client==g_server 时旧内容重灌是同代 PITR 恢复的 SS2 复活形态，
 *  generation 相等救不了 historyId 不匹配）。ok=null（无恢复动作——正常装载）。 */
export function recoveryActionForAuthVerdict(v: AuthHistoryVerdict): RecoveryAction | null {
  if (v === 'server-restored') return 'readonly-recovery-user-adjudication';
  if (v === 'doc-generation-stale') return 'reconnect-new-generation';
  return null;
}

/** 半链契约注记（§8.1 客户端半链——**import 复用不重造**：providerVersion `h=<historyId>` 参数/
 *  本地缓存键五元 (uid,pid,generation,schemaVersion,historyId)/resolveAuthHistoryVerdict 判序/
 *  LocalCacheKeyFiveTuple 全部住 doc-protocol.ts 单源；本文件只做动作映射）。 */
export const HISTORY_ID_HALF_CHAIN_CONTRACT = {
  cacheKey: '本地缓存键五元 (uid,pid,generation,schemaVersion,historyId)——per-tab 记录+boot mergeUpdates 并集',
  compareOrder: 'onAuthenticate 先比 historyId 再比 generation（堵同代 PITR 客户端 SS2 复活）',
  reuse: '复用 doc-protocol resolveAuthHistoryVerdict/LocalCacheKeyFiveTuple/formatProviderHistoryParam——禁重造',
  firstConnect: '首连无 historyId 由服务端 auth 回执下发并客户端持久化（非 mismatch）',
} as const;
