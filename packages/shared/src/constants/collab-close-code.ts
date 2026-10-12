/** close code 全集分配表（spec §3.5）——应用侧自有码本文件定义；**库自发码从 @hocuspocus/common 导入重导出**
 * （P-N 单源——禁重写库值字面量，与库漂移防线）。组件禁散落判 code（扫描锚）。
 * 库自发语义：4205 ResetConnection（通用重置码，pre-auth 队列超限等多处复用，本身不携带"超限"语义
 *  ——配额提示必须配服务端计数指标）/4401 Unauthorized（reason 字面量 "Unauthorized"）/4403 Forbidden/
 *  4408 ConnectionTimeout（注意：provider 客户端合成 (4408,'forced') 三击强制〔esm:342-357〕——双键分型
 *  以 synthetic 标记区分诊断）/1009 MessageTooBig。
 *  应用侧：1012 计划内重启（既有）/4401 'session-expired'（sweep）/1000 team disbanded/
 *  4402 max-lifetime/4404 doc-over-quota（Y0b-4 实装）/4410 generation-superseded（Y0b-4 启用——spec §3.5 预留提前消费）。 */
import {
  ConnectionTimeout,
  Forbidden,
  MessageTooBig,
  ResetConnection,
  Unauthorized,
} from '@hocuspocus/common';
import { isTerminalReason } from './collab-auth-reason';

export const CollabCloseCode = {
  // —— 应用侧自有码 ——
  NORMAL: 1000,
  APP_RESTART: 1012,
  SESSION_EXPIRED: 4401,        // 应用 sweep（reason='session-expired'）与库 Unauthorized 同码异 reason——双键分型
  MAX_LIFETIME: 4402,
  // —— Y0b-4 配额/代际码（spec §3.5）——**码只能经 webSocket.close 抵达**——P7；
  // throw 的 code 被 Connection.close 丢弃（T0 探针②运行实证：throw 路径客户端 30s 僵尸
  // 零 close，webSocket.close 是唯一可行投递路径）——
  DOC_OVER_QUOTA: 4404,        // 文档超配额终态（自救归 T4/T11）
  GENERATION_SUPERSEDED: 4410, // 代际被超（v6 启用——spec §3.5 预留提前消费）
  RATE_LIMITED_CLOSE: 1008,    // 消息频率超限（瞬态——backoff 重连）
  SLOW_CONSUMER: 1011,         // 消费过慢被踢（瞬态——backoff 重连）
  // —— 库自发码（@hocuspocus/common 单源重导出——P-N：.code 引用，库升级值自动跟随）——
  LIB_RESET: ResetConnection.code,
  LIB_UNAUTHORIZED: Unauthorized.code,
  LIB_FORBIDDEN: Forbidden.code,
  LIB_CONNECTION_TIMEOUT: ConnectionTimeout.code,
  LIB_MESSAGE_TOO_BIG: MessageTooBig.code,
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

/** Y0b-4 T1：配额/代际 terminal 原因常量单源（T5 close 映射/T11 终态档/T9a 检测点共用——字段一致矩阵：
 * 四侧字面量漂移=执行卡死，一律经本常量引用）。 */
export const DOC_OVER_QUOTA_TERMINAL_REASON = 'doc-over-quota' as const;
export const DOC_VACUUMING_TERMINAL_REASON = 'doc-vacuuming' as const;
export const DOC_GENERATION_STALE_TERMINAL_REASON = 'doc-generation-stale' as const;

export function resolveCloseAction(code: number, reason: string | undefined): CloseAction {
  // (code,reason) 双键分型（spec §5.2 v2.1）——只判 code 会把库 Unauthorized 当会话过期无限续期
  if (code === CollabCloseCode.SESSION_EXPIRED) {
    if (reason === 'session-expired') return { kind: 'silent-renew-once' };
    return { kind: 'terminal', terminalReason: 'session-expired' }; // 含库默认 'Unauthorized'/reason 缺失
  }
  if (code === CollabCloseCode.APP_RESTART) return { kind: 'planned-restart' };
  // Y0b-4 T1：4410 双 reason（doc-vacuuming/doc-generation-stale）均落 terminal——reason 仅诊断区分（透传）。
  // 前置条件：4410 调用方（T9a hardClose）恒携带 reason 常量——terminalReason undefined 仅出现在库抹码异常形态
  // （下游 runtime 非空断言直取；(1000,reason) 兜底不对称=登记项，T9a 实装时评估）
  if (code === CollabCloseCode.GENERATION_SUPERSEDED) return { kind: 'terminal', terminalReason: reason };
  if (code === CollabCloseCode.DOC_OVER_QUOTA) return { kind: 'terminal', terminalReason: DOC_OVER_QUOTA_TERMINAL_REASON };
  if (code === CollabCloseCode.NORMAL) {
    // 库抹码形态兜底（外审 P0-2 尾巴）：旧路径/竞态下客户端可能观测 (1000,'doc-over-quota')
    // ——reason 匹配配额终态时不得落 normal，双键分型先于 NORMAL 判定
    if (reason === DOC_OVER_QUOTA_TERMINAL_REASON) return { kind: 'terminal', terminalReason: DOC_OVER_QUOTA_TERMINAL_REASON };
    return { kind: 'normal' };
  }
  if (code === CollabCloseCode.LIB_MESSAGE_TOO_BIG) return { kind: 'terminal', terminalReason: MESSAGE_TOO_BIG_TERMINAL_REASON };
  if (code === CollabCloseCode.LIB_CONNECTION_TIMEOUT) {
    return reason === 'forced'
      ? { kind: 'backoff', synthetic: true }   // 客户端合成（三击强制）——诊断标记
      : { kind: 'backoff' };
  }
  if (code === CollabCloseCode.RATE_LIMITED_CLOSE) return { kind: 'backoff' };  // 1008 消息频率超限——瞬态
  if (code === CollabCloseCode.SLOW_CONSUMER) return { kind: 'backoff' };       // 1011 消费过慢——瞬态
  return { kind: 'backoff' }; // 4205/4403/4402 max-lifetime/未知——全瞬态退避档（4403：sweep/事件驱动先踢，此处 fail-safe 重连后 auth 面给权威 reason）
}

/** Y0b-5 T0（spec §5.2 v2.2；裁定 23⑵ 按路由分流+裁定 24⑴ 穷尽性/⑸ route 参数）：
 *  显式路由参数 route:'auth'|'close'|'timeout'（先例 CloseAction.synthetic 标志——reason 只承载协议串，禁内部哨兵）；
 *  close 路由以 resolveCloseAction 五档穷尽映射（silent-renew-once→silent-renew 立即一次/normal→exponential
 *  带退避一次重连——库抹码可能掩盖瞬态；terminal→none）；auth 路由 isTerminalReason 单源派生（禁第二张 reason 表）；
 *  none=「永久断线」显式语义——不可扩展集合，仅 terminal 档与应用主动销毁两处产生。
 *  裁定 22⑻ 退避表真合并：T3 删 connectionMachine.ts RECOVER_BACKOFF_MS 改 import 本表（单源）。 */
export const TRANSIENT_BACKOFF_STEPS_MS = [2_000, 5_000, 10_000, 30_000] as const;
export type BackoffRoute = 'auth' | 'close' | 'timeout';
export type BackoffPlan =
  | { kind: 'none'; ms: 0 }                        // 永久断线（terminal 档/应用销毁）
  | { kind: 'silent-renew'; ms: number }           // 4401 'session-expired'——500ms+jitter 立即一次，闩锁第二次回落 terminal
  | { kind: 'short'; ms: number }                  // 1012——jitter 0-60s full（裁定 23⑶ NAT 部署窗算术）
  | { kind: 'exponential'; ms: number };

export function resolveBackoffPlan(route: BackoffRoute, code: number | undefined, reason: string, attempt: number, jitterMs: number): BackoffPlan {
  const exponential = (): BackoffPlan => ({
    kind: 'exponential',
    ms: TRANSIENT_BACKOFF_STEPS_MS[Math.min(attempt, TRANSIENT_BACKOFF_STEPS_MS.length - 1)] + jitterMs,
  });
  if (route === 'timeout') return exponential();                                    // socket OPEN 未认证 10s 超时
  if (route === 'auth' || code === undefined) return isTerminalReason(reason) ? { kind: 'none', ms: 0 } : exponential(); // code 缺失归 auth 路由（裁定 25⑵ 去 code! 断言）
  // close 路由：五档穷尽（kind 联合类型+无 default——新增档未映射即编译红）
  const action = resolveCloseAction(code, reason);
  switch (action.kind) {
    case 'planned-restart': return { kind: 'short', ms: 1_000 + jitterMs };
    case 'silent-renew-once': return { kind: 'silent-renew', ms: 500 + jitterMs };
    case 'backoff': return exponential();
    case 'normal': return exponential();                                            // 裁定 24⑴——库抹码掩盖瞬态；真终态由下次握手 auth 拒档权威分型
    case 'terminal': return { kind: 'none', ms: 0 };
  }
}
