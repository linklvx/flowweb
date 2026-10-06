/** 批3-1（R15 const-object + 派生 union，先例 subscription-error.ts）：
 *  collab WS 鉴权拒绝分型六档。gateway 侧以 Object.assign(new Error(msg), { reason })
 *  附着——Hocuspopus onAuthenticate catch 直读 error.reason 写入 permission-denied
 *  （hocuspocus-server.esm.js:939 `error.reason ?? "permission-denied"`），客户端
 *  provider 以 authenticationFailed { reason } 原样收到（批 2 wsAuthNotice 消费）。
 *  值即线上协议串——只增不改（改 = 客户端分型断裂）。
 *  Y0a-2（X9）：draining=关停期受理门拒新连接（Y21 追加枚举末尾——瞬态档，客户端继续重连；
 *  复用 db-unavailable 会让客户端停止重连=方向错）。 */
export const CollabAuthReason = {
  UNAUTHENTICATED: 'unauthenticated',
  SESSION_EXPIRED: 'session-expired',
  NOT_FOUND: 'not-found',
  FORBIDDEN: 'forbidden',
  DB_UNAVAILABLE: 'db-unavailable',
  DRAINING: 'draining',
} as const;

export type CollabAuthReasonCode = (typeof CollabAuthReason)[keyof typeof CollabAuthReason];

/** 契约锁㉙：终态白名单——仅四档 true（客户端引导重登/跳转）；db-unavailable、
 *  裸 permission-denied、undefined 及一切未打标值一律瞬态桶（横幅重试）。
 *  放 shared 使 web 批 2 与 api 同源判定。 */
const TERMINAL_AUTH_REASONS: ReadonlySet<string> = new Set<string>([
  CollabAuthReason.UNAUTHENTICATED,
  CollabAuthReason.SESSION_EXPIRED,
  CollabAuthReason.NOT_FOUND,
  CollabAuthReason.FORBIDDEN,
]);

export function isTerminalReason(reason: unknown): boolean {
  return TERMINAL_AUTH_REASONS.has(reason as string);
}
