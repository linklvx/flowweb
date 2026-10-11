/** close code 全集分配表（spec §3.5）——应用侧自有码本文件定义；**库自发码从 @hocuspocus/common 导入重导出**
 * （P-N 单源——禁重写库值字面量，与库漂移防线）。组件禁散落判 code（扫描锚）。
 * 库自发语义：4205 ResetConnection（通用重置码，pre-auth 队列超限等多处复用，本身不携带"超限"语义
 *  ——配额提示必须配服务端计数指标）/4401 Unauthorized（reason 字面量 "Unauthorized"）/4403 Forbidden/
 *  4408 ConnectionTimeout（注意：provider 客户端合成 (4408,'forced') 三击强制〔esm:342-357〕——双键分型
 *  以 synthetic 标记区分诊断）/1009 MessageTooBig。
 *  应用侧：1012 计划内重启（既有）/4401 'session-expired'（sweep）/1000 team disbanded/
 *  4402 max-lifetime（本批新）——4404 doc-over-quota/4410 generation-superseded 为 Y0b-4/Y1c-1 预留值（注释钉死）。 */
import {
  ConnectionTimeout,
  Forbidden,
  MessageTooBig,
  ResetConnection,
  Unauthorized,
} from '@hocuspocus/common';

export const CollabCloseCode = {
  // —— 应用侧自有码 ——
  NORMAL: 1000,
  APP_RESTART: 1012,
  SESSION_EXPIRED: 4401,        // 应用 sweep（reason='session-expired'）与库 Unauthorized 同码异 reason——双键分型
  MAX_LIFETIME: 4402,
  // —— 库自发码（@hocuspocus/common 单源重导出——P-N：.code 引用，库升级值自动跟随）——
  LIB_RESET: ResetConnection.code,
  LIB_UNAUTHORIZED: Unauthorized.code,
  LIB_FORBIDDEN: Forbidden.code,
  LIB_CONNECTION_TIMEOUT: ConnectionTimeout.code,
  LIB_MESSAGE_TOO_BIG: MessageTooBig.code,
  // 预留（本批不产生，Y0b-4/Y1c-1 消费）：DOC_OVER_QUOTA: 4404, GENERATION_SUPERSEDED: 4410,
} as const;

export type CloseActionKind =
  | 'terminal'            // 终态：不重连（terminalReason 转四/五档 UX；1009 内容确定性归此档）
  | 'silent-renew-once'   // 4401 'session-expired'：静默重连一次，失败才终态
  | 'planned-restart'     // 1012：既有 30s 窗+1~3s 短退避链路（runtime 收编）
  | 'backoff'             // 瞬态退避（4205/4403/4408/4402/未知——machine 既有退避表；v3：reconnect 档删除=死档）
  | 'normal';             // 1000

export interface CloseAction { kind: CloseActionKind; terminalReason?: string; synthetic?: boolean }

/** terminalReason 字面量单源（Y0b-3 T9：runtime/SyncBanner 消费——禁散落字面量） */
export const MESSAGE_TOO_BIG_TERMINAL_REASON = 'message-too-big' as const;

export function resolveCloseAction(code: number, reason: string | undefined): CloseAction {
  // (code,reason) 双键分型（spec §5.2 v2.1）——只判 code 会把库 Unauthorized 当会话过期无限续期
  if (code === CollabCloseCode.SESSION_EXPIRED) {
    if (reason === 'session-expired') return { kind: 'silent-renew-once' };
    return { kind: 'terminal', terminalReason: 'session-expired' }; // 含库默认 'Unauthorized'/reason 缺失
  }
  if (code === CollabCloseCode.APP_RESTART) return { kind: 'planned-restart' };
  if (code === CollabCloseCode.NORMAL) return { kind: 'normal' };
  if (code === CollabCloseCode.LIB_MESSAGE_TOO_BIG) return { kind: 'terminal', terminalReason: MESSAGE_TOO_BIG_TERMINAL_REASON };
  if (code === CollabCloseCode.LIB_CONNECTION_TIMEOUT) {
    return reason === 'forced'
      ? { kind: 'backoff', synthetic: true }   // 客户端合成（三击强制）——诊断标记
      : { kind: 'backoff' };
  }
  return { kind: 'backoff' }; // 4205/4403/4402 max-lifetime/未知——全瞬态退避档（4403：sweep/事件驱动先踢，此处 fail-safe 重连后 auth 面给权威 reason）
}
