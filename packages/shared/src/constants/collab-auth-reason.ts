/** 批3-1（R15 const-object + 派生 union，先例 subscription-error.ts）：
 *  collab WS 鉴权拒绝分型六档。gateway 侧以 Object.assign(new Error(msg), { reason })
 *  附着——Hocuspopus onAuthenticate catch 直读 error.reason 写入 permission-denied
 *  （hocuspocus-server.esm.js:939 `error.reason ?? "permission-denied"`），客户端
 *  provider 以 authenticationFailed { reason } 原样收到（批 2 wsAuthNotice 消费）。
 *  值即线上协议串——只增不改（改 = 客户端分型断裂）。
 *  Y0a-2（X9）：draining=关停期受理门拒新连接（Y21 追加枚举末尾——瞬态档，客户端继续重连；
 *  复用 db-unavailable 会让客户端停止重连=方向错）。
 *  Y0a-3：lease-not-ready=租约未持有/失守——瞬态档（客户端继续重连；Y0b 终端 UX 分型消费）。
 *  Y0b-3（T0/P-A）：追加六值——server-overloaded/rate-limited/server-outdated 瞬态档
 *  （误入终态=一次内存尖峰/一次拥塞/一次部署滞后把全部客户端钉死且不自愈）；版本族三档
 *  schema-outdated/client-version-missing/client-version-invalid 终态（reload 档 UX 分流）。
 *  Y0b-5 T16（裁定 23⑹/24⑿）：追加 invalid-doc-name 第十四值——终态档（docName 全匹配
 *  ^project:[A-Za-z0-9_-]{1,64}$ 守卫；确定性拒绝：漏入终态=客户端对永不可合法的 docName 无限重连）。 */
export const CollabAuthReason = {
  UNAUTHENTICATED: 'unauthenticated',
  SESSION_EXPIRED: 'session-expired',
  NOT_FOUND: 'not-found',
  FORBIDDEN: 'forbidden',
  DB_UNAVAILABLE: 'db-unavailable',
  DRAINING: 'draining',
  LEASE_NOT_READY: 'lease-not-ready',
  SERVER_OVERLOADED: 'server-overloaded',
  SCHEMA_OUTDATED: 'schema-outdated',
  CLIENT_VERSION_MISSING: 'client-version-missing',
  CLIENT_VERSION_INVALID: 'client-version-invalid',
  RATE_LIMITED: 'rate-limited',
  SERVER_OUTDATED: 'server-outdated', // v2 M-4：csv>current（客户端新于服务端）——瞬态档（服务端待更新提示，reload 无效不自动刷）
  INVALID_DOC_NAME: 'invalid-doc-name',
} as const;
/** 值序冻结（线上协议串只增不改）——测试 toEqual 锚此数组 */
export const COLLAB_AUTH_REASONS: readonly CollabAuthReasonCode[] = Object.values(CollabAuthReason);

export type CollabAuthReasonCode = (typeof CollabAuthReason)[keyof typeof CollabAuthReason];

/** 契约锁㉙：终态白名单——版本族三档加入后共七档 true（客户端引导重登/跳转/reload 档 UX）；
 *  Y0b-5 T16 起八档（+invalid-doc-name——docName 永不可合法=重连无意义）；SERVER_OVERLOADED/
 *  RATE_LIMITED/SERVER_OUTDATED 瞬态档严禁入终态（spec §3.2/§5.2——误入=
 *  一次内存尖峰/一次拥塞/一次部署滞后把全部客户端钉死且不自愈）；db-unavailable、
 *  裸 permission-denied、undefined 及一切未打标值一律瞬态桶（横幅重试）。
 *  放 shared 使 web 批 2 与 api 同源判定。 */
const TERMINAL_AUTH_REASONS: ReadonlySet<string> = new Set<string>([
  CollabAuthReason.UNAUTHENTICATED,
  CollabAuthReason.SESSION_EXPIRED,
  CollabAuthReason.NOT_FOUND,
  CollabAuthReason.FORBIDDEN,
  CollabAuthReason.SCHEMA_OUTDATED,
  CollabAuthReason.CLIENT_VERSION_MISSING,
  CollabAuthReason.CLIENT_VERSION_INVALID,
  CollabAuthReason.INVALID_DOC_NAME,
]);

export function isTerminalReason(reason: unknown): boolean {
  return TERMINAL_AUTH_REASONS.has(reason as string);
}

/** 版本族终态（reload 自愈档）——终态七档全集的子集：schema-outdated/client-version-missing/
 *  client-version-invalid；server-outdated 是瞬态档不入（reload 无效——v2 M-4）。
 *  Y0b-3 T9 评审 M-1：web 两消费面（runtime handleVersionTerminal 分流 + SyncBanner 版本族横幅
 *  分档）的本地重复表单源化——消费面各自 new Set(this)。 */
export const COLLAB_VERSION_TERMINAL_REASONS: readonly CollabAuthReasonCode[] = [
  CollabAuthReason.SCHEMA_OUTDATED,
  CollabAuthReason.CLIENT_VERSION_MISSING,
  CollabAuthReason.CLIENT_VERSION_INVALID,
];
