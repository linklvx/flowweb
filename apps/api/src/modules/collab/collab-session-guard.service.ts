// apps/api/src/modules/collab/collab-session-guard.service.ts
// Y0c T41（W3b/B2）：SessionGuard 切出——连接鉴权/限流/awareness 判定单一所有者（Z24「按状态所有权
// 界定边界」；设计单源=t41-b2-design.md §1.1 三列清单+§12 RC2=A/RC3=A/RC4=A 裁决）。状态键=socketId/
// connection 对象：限流四桶（upgrade/msg/bytes/aware）+认证防线三层态（refusalCache/authInflight/
// authAttemptBuckets）+连接寿命/标识台账（connEstablishedAt/connectionIds）+awareness 归属双索引/认证
// 身份表（clientIdOwner/ownedClientIds/socketIdentity/awarenessDriftLogged）+sweep 复验缓存（permCache/
// sweepGrace/sweepRecheckFails/sweepKickPending）+writeFreeze 冻结层单源（Q-A v5）+背压 wrap 台账
// +heap 采样闸（overloadTripped——RC3：采样闸归 SG，stuck 账目留 DR）+两域内定时器（sessionSweep/
// authMapsSweep）。
// 行数锚 ≤1100（§0.6 偏离 65 重标建议值——W5 出口实测重标）。构造器零 gateway/Server 依赖（显式
// @Inject=esbuild 无 metadata 先例）；DI/直构双兼容（gateway 尾参缺省自建+bindHost——B1 persistence/
// W3a docRegistry 同款；自建传同 pgBreaker/persistence/docRegistry 实例防脑裂+façade 装置同一性）。
// 行为零变化红线：方法体=gateway 前文逐字平移，仅 host 缝机械替换（logger 共享实例/allDocuments 库读面/
// collabState 谓词两位）。SG→DR 经构造直引（isVacuuming/quotaFrozenDocs/buildDocStatus/ageOverPush/
// dropOverPush——RC4/RC2）；DR→SG 能力经 DR host 缝（gateway 侧接线转发 sg.*，DR 文件两波零改动）。
// verdict 纯函数化（§5）：decideUpgrade/resolveAllowedOrigins/clientIpOf/decideAuthAdmission/
// decideAwarenessStrip/decideClientOwnership/decideSweepRecheck/isEmptyState/serverIdentityOf 顶层导出
// ——搬移+参数化（判定表达式逐字对应，读态改入参）或导出既有纯函数；执法副作用（计数/close/throw/字段写）
// 留方法壳按 verdict 分支执行，副作用与判定相对顺序+惰性语义逐字保持（桶不空转/admitQuery 门序）。

import { Injectable, Logger, NotFoundException, Optional, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Document, beforeHandleAwarenessPayload, beforeHandleMessagePayload, connectedPayload, onAuthenticatePayload, onUpgradePayload } from '@hocuspocus/server';
import { createHash, randomUUID } from 'node:crypto';
import type { ProjectRole } from '@prisma/client';
import { parseSessionToken } from '../../common/utils/parse-session-token';
import { SessionService } from '../../auth/session.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabPgBreakerService } from './collab-pg-breaker.service';
import { CollabPersistenceService } from './collab-persistence.service';
import { CollabDocRegistryService } from './collab-doc-registry.service';
import { parseDocName, isValidDocName, admitDocNameForGeneration, projectDocName } from './doc-name.util';
import { TokenBucket } from './token-bucket';
import { readFrameType, MessageType } from './collab-frame-type';
import { CollabAuthReason, CollabCloseCode, negotiateClientVersion, userColorOfUserId, DOC_VACUUMING_TERMINAL_REASON, resolveVersionGate, CANVAS_DOC_SCHEMA_VERSION, CLIENT_PROTOCOL_VERSION, type CollabAuthReasonCode, type VersionVerdict } from '@flowweb/shared';
import { RSS_RELEASE_BYTES, RSS_TRIP_BYTES, measureHeapPressure, releaseHook, type HeapPressureSample } from './heap-pressure';
import { COLLAB_ROLE_DEFAULT, type CollabRole } from '../../config/env';
import type { CollabConnection, FreezeReason } from './collab.gateway';   // W3b：type-only 零运行时边（无 design:paramtypes 环——偏离 67 循环前提对纯类型不成立；W3a DR 同款先例，collab-conn.util 候选否因 census ⑤/backpressure 锚词面冲突）
import { deriveCollabLimits, type CollabLimits } from './collab-limits';
import { OutboundBudget } from './collab-outbound-budget';
import { CollabHeartbeat } from './collab-heartbeat';   // R6'：保活心跳独立模块（B15 缓解）
import { collabAuthRejectTotal, collabAuthTimeoutTotal, collabUpgradeRejectedTotal, collabLoadRejectedTotal, collabVersionNegotiationRejectTotal, collabOverloadState, collabWsCloseTotal, collabSweepCloseTotal, collabAwarenessRejectTotal, collabAwarenessRateExceededTotal, collabAwarenessStrippedTotal, collabMsgRateExceededTotal, collabQuotaFrameRejectedTotal, memberRevokedConns } from './store.metrics';

/** Y0b-4 T6（Q-K/H-4）：awareness 入站帧闸 64KB——解码前拦（beforeHandleMessage 判型后帧字节判；
 *  30/s×16MB=480MB/s 解码路径封死，报告1 P1-1）。两个实体两个名：本常量=帧字节闸；
 *  AWARENESS_STATES_LIMIT_BYTES=4KB 解码后 states 字节判（T12 落地——勿混）。W3b 随域迁 SG
 *  （gateway 再导出保 import 面——rate-gate spec ×1）。 */
export const AWARENESS_FRAME_LIMIT_BYTES = 64 * 1024;

/** Y0b-4 T12（E38）：解码后 states 字节上限 4KB——guardAwareness 内判（剔除/注入后的广播字节近似，
 *  states 值 ASCII 为主 JSON.stringify length≈utf8 字节）。与 T6 帧闸两实体两名：帧闸=解码前
 *  close 1009；本判=解码后丢帧不 close（客户端 setSelection 已有 4KB 前置拒——本判为兜底，
 *  直发裸帧/旧 bundle 残余路径封口）。W3b 随域迁 SG（gateway 再导出保 import 面——awareness-guard spec ×1）。 */
export const AWARENESS_STATES_LIMIT_BYTES = 4096;

/** Y0b-4 T13（E39/Q-L 后两档）：over-8 剔字段阈值——文档全量∪本帧 user.id 去重数 >8 即剔
 *  cursor/selection（9 人以上画布光标广播扇出/字节成本放大而收益趋零；user/presence 保留——
 *  成员表/保活链不受影响）。测试常量绑定（BACKPRESSURE 双阈先例——改值本测试红）。W3b 随域迁 SG。 */
export const AWARENESS_DISTINCT_USER_STRIP_OVER = 8;

/** 批3-4 sweep 轮询与 grace 窗。Y0b-3 T8：间隔 60s→5min——事件驱动为主（collab.perm.changed 即时
 *  踢权）后 sweep 降为兜底；±20% jitter 见 sweepIntervalMs（setTimeout 自排链逐轮重排）。W3b 随域迁 SG
 *  （模块私有——spec 导入面实测零，非再导出义务）。 */
const SESSION_SWEEP_INTERVAL_MS = 5 * 60_000;
const SESSION_SWEEP_GRACE_MS = 5_000;

/** 单连接 clientId 上限（spec §3.3 终裁值 4——纯真内容 clientId 计入：自身 clock=0 占位被时钟门
 *  剥离、scratch 幽灵被空态判据剔除，均不占槽；触发必计数防静默故障 S-3）。W3b：class static→模块级
 *  const（decideClientOwnership 顶层 verdict 纯函数消费——private static 顶层函数不可达；值 4 不变，
 *  设计 §1.1「(static)」为 W3b 前形态注记，commit 披露）。 */
const AWARENESS_CLIENT_ID_LIMIT = 4;

/** Y0b-3 T5 版本门四档映射（I-1 穷尽性 Record——VersionVerdict 加档时 tsc 红，杜绝 if/else 链
 *  兜底静默映射终态档 SCHEMA_OUTDATED）。键序=VersionVerdict 声明序（allow 除外）。W3b 随域迁 SG
 *  （decideAuthAdmission 版本门消费；模块私有——spec 导入面实测零）。 */
const REASON_BY_VERDICT: Record<Exclude<VersionVerdict, 'allow'>, CollabAuthReasonCode> = {
  'client-version-missing': CollabAuthReason.CLIENT_VERSION_MISSING,
  'client-version-invalid': CollabAuthReason.CLIENT_VERSION_INVALID,
  'schema-outdated': CollabAuthReason.SCHEMA_OUTDATED,
  'server-outdated': CollabAuthReason.SERVER_OUTDATED,
};

// ══════════════════════════════════════════════════════════════════════════════
// verdict 纯函数（§5——SG 硬判据 request/context→verdict；搬移+参数化或导出既有纯函数。
// 执法副作用留方法壳，副作用与判定相对顺序+惰性语义逐字保持）。
// ══════════════════════════════════════════════════════════════════════════════

/** decideUpgrade verdict（§5——handleUpgrade 判定核搬移+参数化）：origin 门→rate 门（惰性——
 *  rateAllowed 仅 originAllowed 才 consume，:620 桶不空转语义由方法壳的三元短路保持）。原判定表达式：
 *  `typeof origin !== 'string' || !allowedOrigins().includes(origin)`→!originAllowed；
 *  `!upgradeBucket.consume(ip,1)`→!rateAllowed。执法（inc/rejectUpgrade socket 直写）留壳。 */
export type UpgradeVerdict =
  | { allow: true }
  | { allow: false; status: '403' | '429'; reason: 'origin' | 'rate-limited' };
export function decideUpgrade(ctx: { originAllowed: boolean; rateAllowed: boolean }): UpgradeVerdict {
  if (!ctx.originAllowed) return { allow: false, status: '403', reason: 'origin' };
  if (!ctx.rateAllowed) return { allow: false, status: '429', reason: 'rate-limited' };
  return { allow: true };
}

/** resolveAllowedOrigins verdict（§5——allowedOrigins :644-655 搬移+参数化，env 三键快照入参）：
 *  显式 COLLAB_ALLOWED_ORIGINS（逗号分隔）> BETTER_AUTH_URL origin 推导（缺省 dev http://localhost:5173）。
 *  P-R：生产不注入 localhost（非浏览器工具可注入任意 Origin——localhost 在表=多余绕过面）；dev 推导表补
 *  127.0.0.1:5173（vite host:0.0.0.0 下用 127.0.0.1 打开时 origin 不含 localhost——403 全灭）；LAN IP
 *  场景显式 COLLAB_ALLOWED_ORIGINS。方法壳传 process.env（new URL 抛 TypeError 的 fail-open 由壳 try/catch 承）。 */
export function resolveAllowedOrigins(env: { COLLAB_ALLOWED_ORIGINS?: string; BETTER_AUTH_URL?: string; NODE_ENV?: string }): string[] {
  const raw = env.COLLAB_ALLOWED_ORIGINS;
  if (raw) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  const base = env.BETTER_AUTH_URL ?? 'http://localhost:5173';
  const origins = [new URL(base).origin];
  if (env.NODE_ENV !== 'production') {
    for (const dev of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      if (!origins.includes(dev)) origins.push(dev);
    }
  }
  return origins;
}

/** clientIpOf verdict（§5——既有近纯函数 :665-673 env 读参数化）：升级面客户端 IP（限流键）。
 *  X-Real-IP 仅 socket peer 为 loopback 时信任（绑定 127.0.0.1+nginx 同机使前提成立；nginx conf 已设
 *  X-Real-IP）+trustedProxy 门控（P-I 双门——未设 env=peer 恒用，全站单桶=生产必须设 env，部署告知项）。
 *  方法壳 clientIpOf(request,socket) 传 this.trustedProxyEnabled()（env 读留壳——façade 3 直调核销）。 */
export function clientIpOf(request: { headers: Record<string, unknown> }, socket: { remoteAddress?: string }, trustedProxy: boolean): string {
  const peer = socket?.remoteAddress ?? '';
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  if (loopback && trustedProxy) {
    const xri = request.headers['x-real-ip'];
    if (typeof xri === 'string' && xri) return xri;
  }
  return peer || 'unknown';
}

/** decideAuthAdmission verdict（§5——authenticateInner :887-912 确定性门前段搬移+参数化，七门快照入参；
 *  §3.1bis 执行序钉死 heap→version→docName→draining→lease→breaker）。执法（inc/connectionConfig.readOnly/
 *  broadcastSpoolDegraded/DB 段）留壳；heapPressureSample/admitQuery 两侧副作用读的惰性由方法壳保持
 *  （heapTripped 仅 !hasDoc 才采样；breakerOpen 仅 gates1-5 全过才 admitQuery——首过 breakerOpen=false
 *  占位判 gates1-5，proceed 才真调 admitQuery）。原判定表达式逐条对应见各 return。 */
export type AuthAdmissionVerdict =
  | { proceed: true }
  | { proceed: false; reason: CollabAuthReasonCode; message: string; source: 'heap' | 'version' | 'state'; loadRejectCount?: 'server-overloaded' };
export function decideAuthAdmission(ctx: {
  hasDoc: boolean; heapTripped: boolean; csv: string | null;
  docNameValid: boolean; shuttingDown: boolean; leaseServing: boolean; breakerOpen: boolean;
}): AuthAdmissionVerdict {
  // gate1 heap（§3.1bis 序：外层桶/信号量→heap→DB——"压力期被拒重连不得打 DB"）：仅拒新物化（!hasDoc 前置——压力期放行存量编辑防自伤）
  if (!ctx.hasDoc && ctx.heapTripped) return { proceed: false, reason: CollabAuthReason.SERVER_OVERLOADED, message: 'server overloaded', source: 'heap', loadRejectCount: 'server-overloaded' };
  // gate2 版本门（heap 之后 DB 之前——旧/新客户端零 DB 往返）：csv 精确相等四档（negotiateClientVersion 单源）
  const verdict = negotiateClientVersion(ctx.csv);
  if (verdict !== 'allow') return { proceed: false, reason: REASON_BY_VERDICT[verdict], message: `client protocol ${verdict}`, source: 'version' };
  // gate3 docName 全匹配守卫（三入口①——别名执法分叉根修）：确定性拒绝零 DB
  if (!ctx.docNameValid) return { proceed: false, reason: CollabAuthReason.INVALID_DOC_NAME, message: 'invalid doc name', source: 'state' };
  // gate4 状态检查先于凭据提取（DRAINING 档必须前置于租约门：draining 时 collabState≠'serving'，租约门先行=死代码+误导 reason）
  if (ctx.shuttingDown) return { proceed: false, reason: CollabAuthReason.DRAINING, message: 'service restarting', source: 'state' };
  // gate5 租约门（P0-1 三入口①——V12：collabState 派生——serving=唯一放行态）
  if (!ctx.leaseServing) return { proceed: false, reason: CollabAuthReason.LEASE_NOT_READY, message: 'collab lease not held', source: 'state' };
  // gate6 熔断面①（调用点①准入，spec §5.9 E57）：open 期直接 db-unavailable（零 Prisma）；half-open 放行=本次即探测
  if (ctx.breakerOpen) return { proceed: false, reason: CollabAuthReason.DB_UNAVAILABLE, message: 'pg breaker open', source: 'state' };
  return { proceed: true };
}

/** decideAwarenessStrip verdict（§5——guardAwareness :2406-2426 档位判定核搬移+参数化）：readOnly（连接级）
 *  → solo/over-8（文档级）三档。原判定表达式：`if (readOnly)`→'read-only'；`distinctUsers.size<=1`→'solo'；
 *  `>AWARENESS_DISTINCT_USER_STRIP_OVER`→'over-8'；else null。distinctUsers 并集计算（读态）留壳，仅传去重数。 */
export function decideAwarenessStrip(ctx: { readOnly: boolean; distinctUsers: number }): 'read-only' | 'solo' | 'over-8' | null {
  if (ctx.readOnly) return 'read-only';
  if (ctx.distinctUsers <= 1) return 'solo';
  if (ctx.distinctUsers > AWARENESS_DISTINCT_USER_STRIP_OVER) return 'over-8';
  return null;
}

/** decideClientOwnership verdict（§5——guardAwareness 三分支 :2441-2462 搬移+参数化，归属表快照入参）：
 *  ①他人登记=伪造→'forged'；②首见 ghost（空态∧doc 无此 id）→'ghost'；②首见超上限→'owner-limit'；
 *  ②首见登记→'register'；③owned（含刚登记）→'pass-inject'。states.delete/set+计数+登记留壳按 verdict 执行。 */
export type ClientOwnershipVerdict = 'pass-inject' | 'forged' | 'ghost' | 'owner-limit' | 'register';
export function decideClientOwnership(ctx: { owner: string | undefined; socketId: string; emptyState: boolean; docHasState: boolean; ownCount: number }): ClientOwnershipVerdict {
  if (ctx.owner !== undefined && ctx.owner !== ctx.socketId) return 'forged';
  if (ctx.owner === undefined) {
    if (ctx.emptyState && !ctx.docHasState) return 'ghost';
    if (ctx.ownCount >= AWARENESS_CLIENT_ID_LIMIT) return 'owner-limit';
    return 'register';
  }
  return 'pass-inject';
}

/** decideSweepRecheck verdict（§5——sweepSessions 判据门 :2245-2248+permRecheckDue :2268-2271 搬移+参数化）：
 *  快照死线 ∨ 权限复验到期（permCache 5min/首查）→'recheck'，否则 'skip'。原判定表达式：
 *  `expired = deadline instanceof Date && deadline.getTime()<=now`；`dueForPerm = !c || now-c.at>=TTL`；
 *  `if (!expired && !dueForPerm) continue`→skip。now 单点快照（设计 §5 入参——原双 Date.now() 亚毫秒差不可观测）。 */
export function decideSweepRecheck(ctx: { expiresAt: Date | undefined; now: number; cachedAt: number | undefined; ttl: number }): 'skip' | 'recheck' {
  const expired = ctx.expiresAt instanceof Date && ctx.expiresAt.getTime() <= ctx.now;
  const dueForPerm = ctx.cachedAt === undefined || ctx.now - ctx.cachedAt >= ctx.ttl;
  return expired || dueForPerm ? 'recheck' : 'skip';
}

/** isEmptyState（§5——既有纯函数导出，static→顶层等价形态）：scratch 幽灵判据=空态对象
 *  （构造器 setLocalState({}) 指纹——真内容帧不受影响）。 */
export function isEmptyState(state: Record<string, any>): boolean {
  return typeof state === 'object' && state !== null && Object.keys(state).length === 0;
}

/** serverIdentityOf（§5——既有纯函数导出，static→顶层等价形态）：服务端身份注入形——color=shared 单源
 *  确定性哈希（与客户端同源算法=迁移等价性保证：旧 bundle 自算 userColor(id) 与新注入同值，部署窗口零色变）。 */
export function serverIdentityOf(u: { id: string; name: string; role: string }): { id: string; name: string; role: string; color: string } {
  return { id: u.id, name: u.name, role: u.role, color: userColorOfUserId(u.id) };
}

/** W3b host 最小接口（设计 §4.2——逐位消费点证明见各行注；「全消费零投机」纪律：无消费点的位置禁设）。
 *  4 位（logger/allDocuments/isServingState/isDrainingDerived〔B3 承接账④更名，原 isShuttingDownFlag〕）+现场核补 1 位 closeConnections
 *  （closeTeamDocuments :1949 库 closeConnections 消费——设计 §4.2 表列漏位，DR shouldUnloadDocument
 *  同款先例，commit 披露/偏离登记）。 */
export interface CollabSessionGuardHost {
  readonly logger: Logger;
  /** 库 documents Map 只读访问器（enforceConnMaxLifetime/sweepSessions/wirePermChangedEvents/
   *  closeAllConnections1012/closeTeamDocuments/broadcastSpoolDegraded/rewriteAwarenessRole/
   *  authenticateInner heap 闸 hasDoc 消费）。 */
  allDocuments(): ReadonlyMap<string, Document>;
  /** collabState serving 谓词（authenticateInner gate5 isLeaseServing 消费——V12 判据唯一化）。 */
  isServingState(): boolean;
  /** collabState draining 谓词（authenticateInner gate4 isShuttingDown + recheckConnection 升回守卫消费
   *  ——isShuttingDown() draining 派生〔非布尔 shuttingDown 关停闸〕；B3 承接账④更名消同名异义〔Minor-4——persistence host 位 isShuttingDownFlag=真关停闸，两语义各归其名〕）。 */
  isDrainingDerived(): boolean;
  /** 库 closeConnections（closeTeamDocuments :1949 消费——Connection.close→removeConnection 活 Map 删键，
   *  协议级 CLOSE；设计 §4.2 表列漏位，DR shouldUnloadDocument 同款先例补位）。 */
  closeConnections(name: string): void;
}

/** 连接鉴权/限流/awareness 判定单一所有者（Z24；设计 §1.1）。公有面=既有外部消费方经 gateway 委托位/
 *  钩子接线背后的本体+测试直调族（gw.sessionGuard.startSessionSweep 等——B1「公有化后 cast 消失」同款，
 *  §0.6 偏离 64②）。SG→DR 经构造直引（docRegistry）；DR→SG 能力经 DR host 缝（gateway 侧转发 sg.*）。 */
@Injectable()
export class CollabSessionGuardService {
  private host!: CollabSessionGuardHost;
  /** 批3-3：session 查询/滑动续期统一入口（手写 findUnique 收口；直构测试不传时以注入的 prisma 兜底自建——
   *  gateway 直构路径传 this.sessionSvc 同实例，DI 路径 @Inject SessionService 单例）。 */
  private readonly sessionSvc: SessionService;
  /** Y0b-5 T16：PG 熔断器（准入+store 短路——spec §5.9 E57；直构缺省自建；gateway 自建路径传同实例防脑裂）。 */
  private readonly pgBreaker: CollabPgBreakerService;

  // ── 限流四桶（census ⑥ TokenBucket 定义点恰四处：upgrade/msg/bytes/aware——W3b 随域迁 SG 构造器） ──
  /** Y0b-3 T2（P-R）：WS 升级限流桶（per-IP——DoS 兜底非配额；60/min 补充+burst 20；重启清零） */
  private readonly upgradeBucket: TokenBucket;
  /** Y0b-4 T6（Q-E v5）：速率闸三桶（per-conn 键=socketId；onDisconnect delete——重连重置=断连循环
   *  刷桶的 DoS 兜底语义）。容量语义见构造点注释；census ⑥ TokenBucket 定义点恰四处：upgrade/msg/bytes/aware。 */
  private readonly msgBuckets: TokenBucket;
  private readonly bytesBuckets: TokenBucket;
  /** aware 桶=共享实例+键前缀 aware:${sid}（与 msg 桶分账——awareness 帧双计：msg 桶计帧数、aware 桶独立限速 30/s） */
  private readonly awareBuckets: TokenBucket;

  // ── 认证防线三层态（P-F/P-Q）+连接寿命/标识台账+awareness 归属双索引/认证身份表 ──
  private readonly refusalCache = new Map<string, { reason: CollabAuthReasonCode; at: number }>();
  /** 全局并发认证信号量现值（公有=gateway registerAuthInflightReader collect 读面，B1 stuckDocsSeen 先例）。 */
  authInflight = 0;
  private authInflightPeak = 0;   // peak 仅测试/演练观测用（进程寿命只写不读）——生产 gauge=collab_auth_inflight collect 读 authInflight 现值
  private readonly authAttemptBuckets = new Map<string, { count: number; windowStart: number }>();
  /** Y0b-3 T6：连接寿命台账（socketId → 建立时点）。键=connected/onAuthenticate/onDisconnect 三钩子
   *  共有稳定键（onDisconnectPayload 无 connection 字段〔d.ts:687-696〕——Connection 键 Map=死代码）。
   *  写点三处：connected 播种 / onDisconnect+closeTeamDocuments+beforeUnloadDocument 键控清理（防无界）；
   *  读点一处：sweep tick 首部 enforceConnMaxLifetime。 */
  private readonly connEstablishedAt = new Map<string, number>();
  /** Y0b-5 T11：WS connectionId（socketId → randomUUID）——onAuthenticate 成功播种/断连清理。
   *  消费：结构化日志三元组（traceId 预留位 null——T13 才有）+doc-status 预留字段回传客户端
   *  （遥测 join）+Sentry scope（装载失败等带 socketId 的 catch 取实值）。 */
  private readonly connectionIds = new Map<string, string>();
  /** Y1c T9（Controller 裁定 2+修正 #8）：SystemHistory 单行权威快照（gateway 启动接线
   *  setServerHistory——requireSystemHistory fail-closed 读面；未接线=版本门 historyId 维缺省放行
   *  首连、回执不下发〔测试直构面〕）。 */
  private serverHistory: { historyId: string } | null = null;
  setServerHistory(h: { historyId: string }): void { this.serverHistory = h; }
  /** ===== Y0b-3 T7（E73/spec §3.3）：awareness 归属表（双索引）+认证身份表 =====
   *  clientIdOwner=归属权威（clientId→socketId，O(1) 伪造判定——库 connections 的 clients 集在 hook
   *  之后才填充〔esm:625-634〕不能作权威，自建表语义）；ownedClientIds=socketId→clientIds 反向索引
   *  （上限计数=.size；剪枝/断连清理/T8 role 改写按自有 Set 迭代 O(自己)）；socketIdentity=认证身份
   *  （authenticate 成功路径播种——覆写 user 的来源，不读 connection.context 防未认证帧绕过）。 */
  private readonly clientIdOwner = new Map<number, string>();
  private readonly ownedClientIds = new Map<string, Set<number>>();
  private readonly socketIdentity = new Map<string, { id: string; name: string; role: string; teamId: string }>();
  /** 漂移告警去重（socketId 级——漂移持续期只告警一次，恢复即清；防热路径刷屏） */
  private readonly awarenessDriftLogged = new Set<string>();

  // ── sweep 复验会话级态（connection 键 WeakMap/WeakSet——连接回收即散）+域内定时器 ──
  /** 批3-4 sweep：grace 在途去重 + 连续复验失败计数（WeakMap/WeakSet——连接回收即散） */
  private readonly sweepGrace = new WeakSet<object>();
  private readonly sweepRecheckFails = new WeakMap<object, number>();
  /** sweep 判据门第二分支（P-K）：per-connection 权限结论缓存（5min 会话级 TTL——WeakMap 随连接回收）；
   *  T8 事件失效消费=仅 delete 不直接 recheck。 */
  private readonly permCache = new WeakMap<object, { role: ProjectRole | null; at: number }>();
  private sweepKickPending = false;
  private sessionSweepTimer: ReturnType<typeof setInterval> | null = null;
  private authMapsSweepTimer: ReturnType<typeof setInterval> | null = null;
  /** R6'：保活心跳（B15 缓解——10s stateless sweep；键=connectedPayload.socketId）——start/stop 随域定时器族 */
  private readonly heartbeat = new CollabHeartbeat();

  /** Y1c T22（spec §7 心跳携 latestFeedSeq）：心跳载荷增补注入缝（RuntimeFeedService 构造期接线——
   *  feed 进程内 lastKnown 快照同步读；未注入=纯 heartbeat 形态不变）。 */
  setHeartbeatEnricher(fn: (conn: CollabConnection) => Record<string, unknown> | null): void {
    this.heartbeat.setEnricher(fn);
  }

  // ── writeFreeze 冻结层单源（Q-A v5）+背压 wrap 台账+heap 采样闸（RC3） ──
  /** Y0b-4 T4（Q-A v5/Q-C）：writeFreeze 冻结层单源——conn→{pid, 原因集}（readOnly=原因集非空）。
   *  唯一出口=applyWriteFreeze（生产直写 conn.readOnly 仅 connectionConfig 构造期一处——库首帧拦截）。
   *  退役 frozenConnections prev 快照（H-5 语义的集合化继任：解除=移除本方原因，drain 解除
   *  不误赦免 viewer/spool 降级连接）。onDisconnect 按 socketId 反查清（值含 pid——O(1) 判定域）。 */
  private readonly writeFreeze = new Map<CollabConnection, { pid: string; reasons: Set<FreezeReason> }>();
  /** R4b'（v3）：出站背压/预算契约单源派生（collab-limits——桶容量/close/budget 族消费）+判定核
   *  本体（OutboundBudget——wrapBackpressure 3 行委托；WeakSet 台账随迁 Map 判重）。 */
  private readonly limits: CollabLimits;
  private readonly outbound: OutboundBudget;
  /** Y0b-3 T4（spec §3.2）：heap 压力闸观测态（翻转检测缓存——真实态在 heap-pressure util 迟滞内）。
   *  RC3：采样闸（heapPressureSample/overloadTripped/syncOverloadGauge）归 SG（准入闸判定态——auth/load
   *  两闸+isHeapPressureTripped 委托消费）；stuck 账目（docStuckRounds/stuckDocsSeen/heapObserverTimer）留 DR。 */
  private overloadTripped = false;

  // ── 判定常量（随判定体迁） ──
  private static readonly REFUSAL_CACHEABLE = new Set<string>([
    CollabAuthReason.DRAINING, CollabAuthReason.LEASE_NOT_READY,
    CollabAuthReason.DB_UNAVAILABLE, CollabAuthReason.SERVER_OVERLOADED,
  ]);   // §3.1bis 白名单精确四类（terminal 不入=客户端已 disconnect；信号量溢出/桶超限不经此——P-F 结构分离）；SERVER_OVERLOADED 自 T4 起可达（heap 闸在 inner 首行 throw 经此写缓存——信号量层 throw 仍不经此）
  /** AUTH deadline——DB 段超时折 db-unavailable（防慢 DB 挂满信号量；不加 env=YAGNI）。
   *  边界：Promise.race 到期不取消底层 Prisma 查询——约束的是信号量槽位占用，非 DB 工作量；
   *  DB 真实并发由池 connection_limit=10 兜底（外审收口 5→10：池与 REST+BullMQ 同进程共享，
   *  留 6 给 REST/队列——禁单独调大任一破坏预算，部署清单对照小表）。 */
  private static readonly AUTH_DB_DEADLINE_MS = 3_000;
  private static readonly PERM_RECHECK_TTL_MS = 5 * 60_000;   // §3.1bis：sweep 权限复验周期=会话级结论缓存 5min

  constructor(
    // 显式 @Inject token（esbuild 无 metadata 先例）；sessionSvc/perm/persistence/docRegistry/eventEmitter
    // 均模块 provider（Nest 注入单例）；gateway 直构路径传同实例（pgBreaker 防脑裂+persistence/docRegistry
    // 同一性=façade stubRepo/stubSpool 双写装置前提）。pgBreaker @Optional 尾参真可选（缺省自建——DR 同款）。
    @Inject(SessionService) sessions: SessionService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabPersistenceService) private readonly persistence: CollabPersistenceService,
    @Inject(CollabDocRegistryService) private readonly docRegistry: CollabDocRegistryService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
    @Optional() @Inject(CollabPgBreakerService) pgBreaker?: CollabPgBreakerService,
  ) {
    this.sessionSvc = sessions;
    this.pgBreaker = pgBreaker ?? new CollabPgBreakerService();
    // R4b'（v3）：limits 单源派生+出站预算判定核（构造期 activeQuota——fail-fast 校验随 deriveCollabLimits）
    this.limits = deriveCollabLimits(this.docRegistry.activeQuota);
    this.outbound = new OutboundBudget(this.limits);
    // Y0b-3 T2：升级限流——COLLAB_UPGRADE_RATE_PER_MIN 默认 60/min；burst=20 常量（多标签友好——
    // 单用户多标签页各持一条 WS 连接，burst 抬高集中握手容忍度；DoS 兜底非配额）。
    this.upgradeBucket = new TokenBucket({
      capacity: 20,
      refillPerMin: Number(process.env.COLLAB_UPGRADE_RATE_PER_MIN) || 60,
    });
    // Y0b-4 T6（Q-E v5）速率闸三桶：msg=400 帧容量（瞬时突发吸收）+msgRate/s 补充；
    // bytes=capacity:maxDocBytes+FRAME_ALLOWANCE_BYTES——"桶容量≥最大合法帧"不变量（consume
    // Math.min(capacity) 封顶 ⇒ cost>capacity 恒 false；报告1 P0-2：1MB 容量下 >1MB 合法离线合并帧
    // 结构性永拒形态防复发）。Y0b-5 T8（裁定 24⑵）：SS2 闸抬到 maxDocBytes+ALLOWANCE 后容量必须
    // 同步——只抬闸不同步桶=(maxDocBytes,+64KB] 帧→⓪′ 结构性拒→1008→重连重发无限循环（正是 1009
    // 当初要防的形态）；首帧突发由容量吸收+稳态 bytesRate/s 节流；handshakeCredit 不存在（v5 整删——
    // 功能被容量吸收）；aware=共享实例+键前缀（capacity 60+30/s——>30 帧/s 独立限速）。
    // W3b：quota 四值读面=docRegistry.activeQuota 单源（RC2「SG 不持 quota 对象，构造取 msgRate/bytesRate/
    // maxDocBytes」——注入 docRegistry 构造期已解析，桶容量≥最大合法帧不变量口径不变，防双源 P3）。
    this.msgBuckets = new TokenBucket({ capacity: 400, refillPerMin: this.docRegistry.activeQuota.msgRate * 60 });
    this.bytesBuckets = new TokenBucket({ capacity: this.limits.bytesBucketCapacity, refillPerMin: this.docRegistry.activeQuota.bytesRate * 60 });
    this.awareBuckets = new TokenBucket({ capacity: 60, refillPerMin: 1_800 });
  }

  /** host 后置绑定（B1 persistence.bindHost/W3a docRegistry.bindHost 同形先例）——业务方法消费前必 bind。 */
  bindHost(host: CollabSessionGuardHost): void {
    this.host = host;
  }

  /** ===== Y0b-3 T2：upgrade 面（§3.1ter）=====
   *  Origin 白名单+升级限流，拒绝形态=socket 直写 403/429+end（hook throw=库 async 监听器内
   *  unhandled rejection 形同虚设〔hocuspocus esm:1623-1636 实证〕——必须 socket 直写让客户端
   *  收到真实 HTTP 响应；hook 自身全函数 try/catch fail-open：校验面炸不阻断升级，鉴权仍由
   *  onAuthenticate 兜底）。hook 正常 resolve 后库仍调 crossws.handleUpgrade——对已 end socket
   *  的后续握手写由 ws 的 socketOnError 吞（handleUpgrade 首行注册 error 监听，无进程崩溃）。
   *  end 替代 destroy（P-R：write 后立即 destroy 丢弃未发送字节=客户端收 RST 非 403）。
   *  W3b verdict 纯函数化：判定核=decideUpgrade（§5）；执法（inc/rejectUpgrade socket 直写）留壳，
   *  惰性语义保持（rateAllowed 仅 originAllowed 才 clientIpOf+consume——:620 桶不空转）。 */
  handleUpgrade({ request, socket }: onUpgradePayload): void {
    try {
      const origin = request.headers.origin;
      const originAllowed = typeof origin === 'string' && this.allowedOrigins().includes(origin);
      // 惰性：仅 originAllowed 才 clientIpOf+consume（原短路 return 语义——桶不空转，:620）
      const rateAllowed = originAllowed ? this.upgradeBucket.consume(this.clientIpOf(request, socket), 1) : false;   // census ⑨：生产调用全显式 cost（升级握手=1 次/桶）
      const verdict = decideUpgrade({ originAllowed, rateAllowed });
      if (!verdict.allow) {
        collabUpgradeRejectedTotal.inc({ reason: verdict.reason });
        this.rejectUpgrade(socket, verdict.status === '403' ? 'HTTP/1.1 403 Forbidden' : 'HTTP/1.1 429 Too Many Requests');
      }
    } catch (e) {
      // fail-open：升级面校验炸=放行（onAuthenticate 兜底鉴权）。I-3：真实触发面存在（BETTER_AUTH_URL
      // 配垃圾串→allowedOrigins 内 new URL 抛 TypeError→每次升级静默 fail-open、Origin 防线全失）——
      // 必须留痕，否则运维零可见。
      this.host.logger.warn(`[y0b-3] onUpgrade fail-open：${(e as Error)?.message}`);
    }
  }

  /** 拒绝响应直写（403/429 同族——P-G/P-R 形态单点） */
  private rejectUpgrade(socket: { write?: (s: string) => void; end?: () => void }, statusLine: string): void {
    try {
      socket?.write?.(`${statusLine}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket?.end?.();
    } catch { /* 已断 */ }
  }

  /** Origin 白名单（方法壳建三键快照传 resolveAllowedOrigins verdict 纯函数，§5）。census ㉒：三键
   *  process.env.KEY 显式读在本壳（保键级白名单跟踪——Z79 裸读面登记 SG 条目 14 键含此三；设计 §5
   *  「三键快照」+§8.2「14 键迁 SG」吻合，resolveAllowedOrigins 消费快照不裸读）。
   *  M-1：唯一消费=handleUpgrade；测试经 façade spyAllowedOrigins（spyOn 单点收敛）。 */
  allowedOrigins(): string[] {
    return resolveAllowedOrigins({
      COLLAB_ALLOWED_ORIGINS: process.env.COLLAB_ALLOWED_ORIGINS,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
      NODE_ENV: process.env.NODE_ENV,
    });
  }

  private trustedProxyEnabled(): boolean {
    return process.env.COLLAB_TRUSTED_PROXY === '1';
  }

  /** 升级面客户端 IP（限流键）方法壳——verdict 纯函数 clientIpOf(request,socket,trustedProxy) 判定核
   *  （§5 env 读参数化；trustedProxy 门控经 trustedProxyEnabled()）。M-1：唯一消费=handleUpgrade；
   *  测试走 gw.sessionGuard.clientIpOf（façade 3 直调核销——公有面，cast 消失）。 */
  clientIpOf(request: { headers: Record<string, unknown> }, socket: { remoteAddress?: string }): string {
    return clientIpOf(request, socket, this.trustedProxyEnabled());   // 裸标识符=模块级 verdict 纯函数（类方法非词法绑定——非递归）
  }

  /** ===== Y0b-3 T3（P-F/P-K/P-Q）：认证防线三层+权限判据单源 =====
   *  结构（§3.1bis 钉死）：authenticate()=外层防线壳（refusalCache→信号量→桶→try{inner}finally——
   *  heap 闸〔T4〕/版本门〔T5〕已插入 inner 内）；authenticateInner()=原方法体
   *  （状态检查→token→session→权限段 resolveWithTeam 单源→DB）。
   *  信号量/桶的 throw 在 try 之外=不经过写缓存的 catch（P-F 结构分离："瞬时拥塞≠状态故障"
   *  按 throw 来源结构分离，非 reason 值——入缓存=一次拥塞变 15s 确定性拒绝）；
   *  inner 的 throw 进外层 catch→reason∈REFUSAL_CACHEABLE（四类）→写 cache。 */
  withAuthDeadline<T>(p: Promise<T>): Promise<T> {   // W3b 公有（auth-defense spec 直调核销——cast 消失面，§1.4）
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      p.finally(() => { if (timer) clearTimeout(timer); }),   // settle 即清 timer（I-1：不清理则成功路径迟到 fire=假超时计数，指标报废）
      new Promise<never>((_resolve, rej) => {
        timer = setTimeout(() => {
          collabAuthTimeoutTotal.inc();
          rej(Object.assign(new Error('auth db deadline'), { reason: CollabAuthReason.DB_UNAVAILABLE }));
        }, CollabSessionGuardService.AUTH_DB_DEADLINE_MS);
        timer.unref?.();
      }),
    ]);
  }
  private refusalTtlMs(): number { return Number(process.env.COLLAB_REFUSAL_CACHE_TTL_MS) || 15_000; }
  private authAttemptsPerMin(): number { return Number(process.env.COLLAB_AUTH_ATTEMPTS_PER_MIN) || 10; }
  private authInflightMax(): number { return Number(process.env.COLLAB_AUTH_INFLIGHT_MAX) || 4; }   // 默认 4——池公式 cpu×2+1=5 对齐（8×3 查询>池 5=P2024 折 db-unavailable）
  /** 清空钩子单点（P-Q）：任一 transition('serving') 转移清（fence/drain 解除/租约 rejoin 全含于
   *  serving 转移——比枚举因由稳，漏一即残留）+spool 恢复翻转+heap 释放（T4 releaseHook 接线汇入同点）。
   *  W3b：refusalCache 单源清空点=clearRefusalCache（本方法=serving 汇点调用位；gw setOnRecovered 接线
   *  直调 clearRefusalCache——锚随迁「SG 文件 refusalCache.clear() 恰 1+serving 汇点调用恰 1」§8.3-1）。 */
  onServingTransition(): void { this.clearRefusalCache(); }
  /** refusalCache 清空单点（新语义操作——机械提取自 gateway onServingTransition/setOnRecovered 接线；
   *  SG 文件内 `refusalCache.clear()` 唯一落点）。 */
  clearRefusalCache(): void { this.refusalCache.clear(); }
  /** 防线三 Map 老化（P-V⑦）：TTL 过期条目清+桶过期窗清——独立 1min timer（禁挂 sweep tick——
   *  SWEEP_ENABLED=false 逃生阀不得静默关掉老化）。Y0b-4 T4：overPush 台账同点老化（断连清理
   *  之外的兜底——idle-reset 只清计数不清条目，防 socketId 复用期无界）。W3b：overPush 台账归 DR
   *  （RC2——经构造直引 docRegistry.ageOverPush，原序保持）。 */
  private sweepStaleAuthMaps(): void {
    const now = Date.now();
    for (const [k, v] of this.refusalCache) if (now - v.at >= this.refusalTtlMs()) this.refusalCache.delete(k);
    for (const [k, v] of this.authAttemptBuckets) if (now - v.windowStart >= 60_000) this.authAttemptBuckets.delete(k);
    this.docRegistry.ageOverPush(now);   // W3a（RC2）：overPush 台账归 DR——老化循环体机械提取同点调用（原序保持：断连清理之外的兜底，idle-reset 只清计数不清条目）
    // 防只握手不认证风暴喂新 socketId：TTL 清不掉"未满窗"的桶（60s 内持续新增）——硬上界兜底（Map 插入序=最旧优先）
    while (this.authAttemptBuckets.size > 10_000) this.authAttemptBuckets.delete(this.authAttemptBuckets.keys().next().value!);
    this.outbound.reconcile();   // R4b'（v3）：预算对账（per-ws 回填）挂本 sweep——authMapsSweeper 在 SWEEP_ENABLED 阀之前=始终运行
  }
  startAuthMapsSweeper(): void {
    if (this.authMapsSweepTimer) { clearInterval(this.authMapsSweepTimer); this.authMapsSweepTimer = null; }
    this.authMapsSweepTimer = setInterval(() => this.sweepStaleAuthMaps(), 60_000);
    this.authMapsSweepTimer.unref?.();
    this.heartbeat.start();   // R6'：心跳 timer 随本定时器族启（unref）——gateway 构造器唯一启动位
  }

  /** deny 工厂单点（§5.1-5 拒绝与计数同点）：所有 onAuthenticate 拒绝路径经此——reason=词表 13 值，
   *  source=拒绝位六分位（state=inner 业务状态拒绝含 DB 折叠桶；semaphore/bucket/heap/version=防线层位；cache=缓存命中重放）。 */
  private denyAuth(reason: CollabAuthReasonCode, message: string, source: 'state' | 'semaphore' | 'bucket' | 'heap' | 'version' | 'cache'): Error {
    collabAuthRejectTotal.inc({ reason, source });
    return Object.assign(new Error(message), { reason });
  }

  /** Y0b-3 T4：heap 压力采样包装（env 三键读在此——util 收纯数值保持可测）。翻转驱动：
   *  trip 翻转→gauge+四数采样日志一条（首拒前必经翻转点——禁每拒一条 ERROR）；tripped→released
   *  翻转→util 一次性回调→onServingTransition 清 refusalCache（P-Q 钩子②）+gauge 复位。
   *  RC3：采样闸归 SG（DR host 缝 heapPressureSample() 接线转发本方法；gateway isHeapPressureTripped 委托读 overloadTripped）。 */
  heapPressureSample(): HeapPressureSample {
    // Y0c T30（Z84②）：TRIP/RELEASE 按 role 取值（gateway 只装配于 api|all；COLLAB_ROLE 裸读
    // census ㉒ 登记 until=T34——execution-daemon.module:32 同款 ?? COLLAB_ROLE_DEFAULT 单源 fallback）
    const role = (process.env.COLLAB_ROLE ?? COLLAB_ROLE_DEFAULT) as CollabRole;
    const sample = measureHeapPressure({
      tripBytes: Number(process.env.COLLAB_RSS_TRIP_BYTES) || RSS_TRIP_BYTES[role],
      releaseBytes: Number(process.env.COLLAB_RSS_RELEASE_BYTES) || RSS_RELEASE_BYTES[role],
      tripRatio: Number(process.env.COLLAB_HEAP_PRESSURE_RATIO) || 0.8,
    });
    if (sample.tripped && !this.overloadTripped) {
      this.overloadTripped = true;
      this.syncOverloadGauge(true);
      const mu = process.memoryUsage();
      this.host.logger.warn(JSON.stringify({ event: 'collab_heap_tripped', rss: sample.rssBytes, heapUsed: sample.heapUsedBytes, heapLimit: sample.heapLimitBytes, external: mu.external, arrayBuffers: mu.arrayBuffers }));
    }
    const released = releaseHook();
    if (released) {
      this.overloadTripped = false;
      this.syncOverloadGauge(false);
      this.onServingTransition();   // P-Q：heap 释放清空汇入 serving/spool 翻转同点
      this.host.logger.log(JSON.stringify({ event: 'collab_heap_released' }));
    }
    return sample;
  }
  syncOverloadGauge(tripped: boolean): void {
    collabOverloadState.set({ state: 'tripped' }, tripped ? 1 : 0);
    collabOverloadState.set({ state: 'ok' }, tripped ? 0 : 1);
  }
  /** Y0c T16（Z126①）：heap 闸压力态纯读数（gateway isHeapPressureTripped 委托位读此——reaper 消费
   *  禁调 heapPressureSample〔翻转日志+gauge 同步+refusalCache 清理副作用〕；overloadTripped=翻转检测缓存）。 */
  isHeapPressureTripped(): boolean { return this.overloadTripped; }

  /** 鉴权外壳（防线三层，§3.1bis 钉死执行序：refusalCache → 信号量 → 桶 → inner〔T4 heap 已落首行；T5 版本门后续插入〕→ DB）。
   *  fingerprint=真实凭据（P-Q）：cookie-only 后 payload.token 恒占位——从 cookie 解析真值做键
   *  （'anon' 塌缩=跨用户 15s 放大）；键=(documentName, sha256(token) 前 16 位)。
   *  无 cookie ⇒ cacheKey=null ⇒ 本轮拒绝不落缓存（anon 键会使不同来源的状态拒绝互相覆盖——写入侧短路）。
   *  拒绝一律带 reason（客户端 authenticationFailed 原样收到）；断连由库 30s 超时自然完成（桶超限不主动 close）。 */
  async authenticate(payload: onAuthenticatePayload) {
    const credential = parseSessionToken(payload.requestHeaders?.get('cookie'));
    const fingerprint = credential ? `t:${createHash('sha256').update(credential).digest('hex').slice(0, 16)}` : null;
    const cacheKey = fingerprint ? `${payload.documentName}|${fingerprint}` : null;   // 唯一声明（读写两侧均 if(cacheKey) 短路）
    const cached = cacheKey ? this.refusalCache.get(cacheKey) : undefined;
    if (cached && Date.now() - cached.at < this.refusalTtlMs()) {
      throw this.denyAuth(cached.reason, `refusal cached: ${cached.reason}`, 'cache');   // TTL 15s 绝对过期不续期
    }
    // 全局并发认证信号量（spec 序第二层——唯一不依赖库内部结构的乘积闸）；throw 在 try 外=不经写缓存的 catch（P-F）
    if (this.authInflight >= this.authInflightMax()) {
      throw this.denyAuth(CollabAuthReason.SERVER_OVERLOADED, 'auth inflight limit', 'semaphore');
    }
    // per-socket 认证尝试桶（spec 序第三层；键=payload.socketId d.ts:480）
    const bucket = this.authAttemptBuckets.get(payload.socketId) ?? { count: 0, windowStart: Date.now() };
    if (Date.now() - bucket.windowStart >= 60_000) { bucket.count = 0; bucket.windowStart = Date.now(); }
    bucket.count += 1;
    this.authAttemptBuckets.set(payload.socketId, bucket);
    if (bucket.count > this.authAttemptsPerMin()) {
      throw this.denyAuth(CollabAuthReason.RATE_LIMITED, 'auth attempts exceeded', 'bucket');
    }
    this.authInflight += 1;
    this.authInflightPeak = Math.max(this.authInflightPeak, this.authInflight);
    try {
      const ctx = await this.authenticateInner(payload);
      // Y0b-5 T11：连接标识在此生成（认证成功=连接事实成立；拒绝路径不播种）——进 context（后续
      // 连接上下文 catch 可取）+socketId 台账（doc-status 回传/装载 catch 取值）+结构化日志三元组。
      const connectionId = randomUUID();
      this.connectionIds.set(payload.socketId, connectionId);
      this.host.logger.log(JSON.stringify({ event: 'collab_connection_auth', traceId: null, connectionId, docName: payload.documentName }));   // traceId=T13 预留位；日志面不 scrub（偏离表：project id 非机密）
      return { ...ctx, connectionId };
    } catch (err) {
      const reason = (err as { reason?: CollabAuthReasonCode } | null)?.reason;
      if (reason && CollabSessionGuardService.REFUSAL_CACHEABLE.has(reason) && cacheKey) {
        this.refusalCache.set(cacheKey, { reason, at: Date.now() });   // 无凭据不落缓存（P-Q）
      }
      throw err;
    } finally {
      this.authInflight -= 1;
    }
  }

  /** 鉴权内层（原 authenticate 方法体——Y0b-3 T3 改名+判据单源化）：
   *  token 只来自 httpOnly cookie（Y0b-3 T2 cookie-only；BetterAuth getSession 在 NestJS 上下文失效——session 直查 DB）。
   *  spec 1.2：VIEWER 连接置 readOnly，Hocuspocus 拒绝其写更新。
   *  批3-1：已分型异常原样 rethrow，其余（DB 抖动等未打标）一律折成 db-unavailable（瞬态桶，契约锁㉙）。
   *  批3-3：session 查询统一走 SessionService.touchWithReason——age>updateAge(1d) 顺带续期 7d；
   *  context 携带 token/sessionExpiresAt 供 sweep 复验。
   *  W3b verdict 纯函数化：确定性门前段=decideAuthAdmission（§5）；执法副作用（inc/connectionConfig.readOnly/
   *  broadcastSpoolDegraded）留壳按 verdict 执行；heapPressureSample/admitQuery 两侧读的惰性+门序逐字保持；DB 段不纯函数化。 */
  private async authenticateInner({ requestHeaders, requestParameters, documentName, connectionConfig, socketId }: onAuthenticatePayload) {
    const deny = (reason: CollabAuthReasonCode, message: string) => this.denyAuth(reason, message, 'state');
    try {
      // —— 确定性门前段（§5 decideAuthAdmission 纯判定；执行序 heap→version→docName→draining→lease→breaker 钉死）——
      const hasDoc = this.host.allDocuments().has(documentName);
      const heapTripped = !hasDoc ? this.heapPressureSample().tripped : false;   // heapPressureSample 仅 !hasDoc 才采样（原短路 && 惰性——压力期放行存量编辑防自伤）
      const csv = requestParameters?.get('csv') ?? null;
      const docNameValid = isValidDocName(documentName);
      const shuttingDown = this.host.isDrainingDerived();
      const leaseServing = this.host.isServingState();
      // admitQuery 惰性（半开探测槽不得提前消费）：首过 breakerOpen=false 判 gates1-5（decideAuthAdmission
      // 单源，禁复制门序逻辑），proceed 才真调 admitQuery——原 gate 序 heap→…→lease 全过才达熔断面语义保持。
      const pre = decideAuthAdmission({ hasDoc, heapTripped, csv, docNameValid, shuttingDown, leaseServing, breakerOpen: false });
      const breakerOpen = pre.proceed ? !this.pgBreaker.admitQuery() : false;
      const admission = breakerOpen ? decideAuthAdmission({ hasDoc, heapTripped, csv, docNameValid, shuttingDown, leaseServing, breakerOpen }) : pre;
      if (!admission.proceed) {
        if (admission.loadRejectCount) collabLoadRejectedTotal.inc({ reason: admission.loadRejectCount });   // P-B 双计数（auth 面）
        if (admission.source === 'version') collabVersionNegotiationRejectTotal.inc({ reason: admission.reason });   // 版本门审计（reason=REASON_BY_VERDICT 映射）
        throw this.denyAuth(admission.reason, admission.message, admission.source);
      }
      // —— DB 段（:920-960 不纯函数化——IO 本体）——
      const spoolState = this.persistence.spoolStateForAuth();   // 恢复翻转检测在此（P-Q 清空并集 spool 支——B1 随域迁 service，翻转清 refusalCache 经 host.onSpoolRecoveredFlip 回接线）
      let freezeIntent: FreezeReason | undefined;
      if (spoolState !== 'ok') {
        connectionConfig.readOnly = true;          // X9：只读降级（协议层拒写更新）
        freezeIntent = 'spool';                    // Y0b-4 T4：auth 期意图存 context（connected 补登记 writeFreeze 单源）
        this.broadcastSpoolDegraded(documentName); // Y9：独立通告通道
      }
      // Y1c T9（修正 #8 生效）：版本门三元拆分——csv=protocolVersion 既有四档门之上，historyId 硬门
      // 经 resolveVersionGate（shared 单源）：客户端 hid 参数缺省=首连放行（allowFirstConnect——无值≠
      // 有值不匹配，后者 4406 client-outdated）；auth 回执下发 historyId（onConnected stateless——
      // web 客户端消费归后续卡，登记 deferred）。
      if (this.serverHistory) {
        const hidRaw = requestParameters?.get('hid');
        const verdict = resolveVersionGate(
          { protocolVersion: Number(csv ?? NaN), schemaVersion: CANVAS_DOC_SCHEMA_VERSION, historyId: hidRaw === null || hidRaw === '' ? undefined : hidRaw },
          { protocolVersion: CLIENT_PROTOCOL_VERSION, schemaVersion: CANVAS_DOC_SCHEMA_VERSION, historyId: this.serverHistory.historyId },
        );
        if (verdict === 'client-outdated') {
          collabVersionNegotiationRejectTotal.inc({ reason: CollabAuthReason.SCHEMA_OUTDATED });
          throw this.denyAuth(CollabAuthReason.SCHEMA_OUTDATED, `client history/protocol outdated（hid ${hidRaw === null || hidRaw === '' ? '首连' : '不匹配'}）`, 'version');
        }
      }
      const token = parseSessionToken(requestHeaders?.get('cookie'));   // T2 cookie-only——query token 通道删除
      if (!token) throw deny(CollabAuthReason.UNAUTHENTICATED, '未登录');
      const { session, expired } = await this.withAuthDeadline(this.sessionSvc.touchWithReason(token));
      if (!session) throw deny(expired ? CollabAuthReason.SESSION_EXPIRED : CollabAuthReason.UNAUTHENTICATED, expired ? '会话过期' : '未登录');
      // —— 权限段（F-3 判据单源——P-K）：原 canvasProject.findUnique+teamMember.findUnique 硬门+
      // perm.resolve 三段整体换为一次 resolveWithTeam（显式 ProjectMember>创建者>团队回退——
      // 4-5 次冗余往返归 1-3 次，信号量乘积闸才有意义）。⚠ 权限语义 A：removeMember 不触碰
      // ProjectMember 表=移出团队但有显式授权仍保留访问（REST assertEditor 同链既有语义）。
      const projectId = parseDocName(documentName)?.projectId ?? '';
      let resolved: { role: ProjectRole | null; teamId: string };
      try {
        resolved = await this.withAuthDeadline(this.perm.resolveWithTeam(projectId, session.user.id));
      } catch (e) {
        if (e instanceof NotFoundException) throw deny(CollabAuthReason.NOT_FOUND, '项目不存在');   // 保 NOT_FOUND/FORBIDDEN 分型（客户端 UX 分流依赖）
        throw e;   // 其余进 catch 分型（DB_UNAVAILABLE 等）
      }
      if (!resolved.role) throw deny(CollabAuthReason.FORBIDDEN, '无项目访问权限');
      // Y1c T12（偏离 27/E23「onAuthenticate∧onLoadDocument 双校验+独立 reason」①auth 面）：docName
      // 世代准入——陈旧世代名（真空换代后旧 #g/裸名≡旧代）在装载/SS1/上行**之前**拒绝（S2 复活链
      // 关闭——形态②〔全 clock<pre〕唯一可达面=裸名@gen>0 在此拦截）。CanvasDoc.generation PG 列
      // 真值（契约 1 单源=repository.readGeneration 经 DR.generationInDb 转发；行缺失=null⇒0
      // 〔懒建档——canonical=裸名〕，与 DR.loadDocument 装载读同真源）；拒因=GENERATION_STALE
      // （终态档——同名盲目重连无限循环；恢复=携 #g<目标代> 重连，客户端链 T25）。
      {
        const dbGeneration = await this.withAuthDeadline(this.docRegistry.generationInDb(projectId));
        const admission = admitDocNameForGeneration(documentName, dbGeneration ?? 0);
        if (!admission.ok) {
          throw deny(
            CollabAuthReason.GENERATION_STALE,
            `doc generation stale（docName=${documentName} 世代段≠DB generation=${admission.generation}——携 #g${admission.generation} 重连）`,
          );
        }
      }
      const readOnly = resolved.role === 'PROJECT_VIEWER';
      // Y0b-5 T16：viewer 只读改走 auth 期意图+connected 登记（freezeIntent 先例——writeFreeze 单源
      // 施加，connectionConfig.readOnly 直写退役=census ⑪ 3→2；spool 降级/quotaFrozen 两档保留直写）。
      if (readOnly) freezeIntent = 'viewer';
      // Y0b-4 T4（Q-C）：冻结期加入的连接置 readOnly（auth 期兜底——freezeQuota 的 setImmediate 窗内
      // 新连接不在 doc.connections；connected 钩子第二道登记进 writeFreeze 单源）
      const quotaFrozen = this.docRegistry.quotaFrozenDocs.has(parseDocName(documentName)?.projectId ?? '');   // W3a：冻结注册表读面随域迁 DR（RC4：connected/authenticateInner 的 SG→DR 直引位）
      if (quotaFrozen) connectionConfig.readOnly = true;
      // 批3-4：unhealthy 电平期的新连接补推 persist-status（payload 无 connection——v4 形状，
      // 延迟到本 tick 后连接已注册进 document.connections；B1 电平/补推随域迁 service）。
      // Y1c T12：台账归一 bare 键（#g/裸名同 pid——与 persistence.persistKey 同口径）
      if (this.persistence.persistUnhealthy.has(projectDocName(projectId))) {
        const t = setTimeout(() => this.persistence.pushPersistStatus(documentName), 500);
        t.unref?.();
      }
      // Y0b-3 T7：认证成功即播 socketIdentity（guardAwareness 覆写 user 的唯一来源——防未认证帧绕过）
      this.socketIdentity.set(socketId, { id: session.user.id, name: session.user.name, role: resolved.role, teamId: resolved.teamId });   // Y0b-3 T8：+teamId（perm.changed 事件匹配依据）
      this.pgBreaker.recordSuccess();   // Y0b-5 T16：PG 健康样本（half-open 成功=探测成功→closed）
      return {
        user: { id: session.user.id, name: session.user.name, role: resolved.role },   // 词表统一 ProjectRole（TeamRole OWNER/MEMBER 混用终结）
        readOnly,
        freezeIntent,   // Y0b-4 T4：auth 期冻结意图（connected 补登记 writeFreeze；quota 加入不走此字段——集合成员判定）
        token,   // sweep 复验凭据（context 只在服务端内存，不外发）
        sessionExpiresAt: session.expiresAt,   // sweep 死线快照（必过期下界）
      };
    } catch (err) {
      if (err instanceof Error && (err as Error & { reason?: CollabAuthReasonCode }).reason) throw err;   // 已分型原样透传（denyAuth 已计数；withAuthDeadline 超时另有专表不双计）
      this.pgBreaker.recordFailure(err);   // Y0b-5 T16：DB 折叠桶=PG 健康采样（连接族推闸；业务错只观测）
      throw this.denyAuth(CollabAuthReason.DB_UNAVAILABLE, `db unavailable: ${(err as Error).message}`, 'state');
    }
  }

  /** Y0a-2（X9/Y9）：spool 熔断的只读降级通告——best-effort（连接注册后 doc 才存在，500ms 延迟取；
   *  无 doc 则跳过，重连时 authenticate 再补）。客户端据此展示"暂存不可用"横幅——禁静默只读。
   *  B1 归属注记：通告载体=document.connections 广播面（SessionGuard/协议适配域），非 persist 台账——W3b 随域迁 SG。 */
  private broadcastSpoolDegraded(documentName: string): void {
    const t = setTimeout(() => {
      const document = this.host.allDocuments().get(this.docRegistry.liveDocName(parseDocName(documentName)?.projectId ?? ''));   // Y1c T12：canonical wire 名解析（#g 换代通道）
      if (!document) return;
      try {
        document.broadcastStateless(JSON.stringify({ type: 'persist-status', healthy: false, reason: 'spool-unwritable' }));
      } catch (err) {
        this.host.logger.warn(`spool degraded broadcast failed for ${documentName}: ${(err as Error).message}`);
      }
    }, 500);
    t.unref?.();
  }
  /** Y0b-4 T4（v6 报告3 P1-1）：auth 期冻结意图在 Connection 未创建时无法落地（库在 onAuthenticate
   *  返回后 new——esm:1054）——connected 统一登记进 writeFreeze 单源+补推 doc-status。
   *  Y0b-5 T16：viewer 改意图登记（auth 期 connectionConfig.readOnly 直写退役= census ⑪ 3→2；
   *  connected 先于任何帧处理 ⇒ applyWriteFreeze 置 readOnly=库级首帧拦截等价）。
   *  RC4=A（W3b）：connected 钩子体即迁 SG.onConnected——DR 读经 SG→DR 构造直引 3 位（isVacuuming/
   *  quotaFrozenDocs/buildDocStatus）；GW hooks.connected 改 1 行接线。hardClose 4410 terminal 语义逐字平移。 */
  onConnected({ socketId, connection, documentName }: connectedPayload): Promise<void> {
    this.connEstablishedAt.set(socketId, Date.now());   // Y0b-3 T6：寿命台账播种
    const c = connection as unknown as CollabConnection;
    if (c) {
      this.wrapBackpressure(c);   // Y0b-4 T7：出站背压 wrap（先于下方 sendStateless——R4b' Map 幂等）
      this.heartbeat.register(socketId, c);   // R6'：心跳登记（键=payload.socketId——v3：conn.socketId 可选不可靠；与 onDisconnectCleanup unregister 同键）
      const pid = parseDocName(documentName)?.projectId ?? '';
      // Y0b-4 T9a serving 门（WS 面）：真空窗口新连接 terminal close 4410 'doc-vacuuming'。
      // 形态裁定：plan 原文"auth 503"——但 WS 层无 HTTP 503（auth 期 throw 被库折 close 4403
      // 非 503）；落地=4410 terminal close（resolveCloseAction(4410)→terminal——语义=稍后重连
      // 成功，T11 终态档 reload 通道）；REST withDoc 面用真 503（COLLAB_NOT_SERVING 族）。
      // Y1c T12：4410 close 载荷先行（stateless {code,reason,generation,discardLocalCache:true}——
      // beginVacuumEra 同款；客户端 export-draft-then-clear+携新世代重连链（T25 消费））。
      if (this.docRegistry.isVacuuming(pid)) {   // W3a：serving 门读面随域迁 DR（RC4：SG→DR 直引 3 位之一）
        try {
          c.sendStateless?.(JSON.stringify({
            code: CollabCloseCode.GENERATION_SUPERSEDED, reason: DOC_VACUUMING_TERMINAL_REASON,
            generation: this.docRegistry.vacuumTargetGeneration(pid), discardLocalCache: true,
          }));
        } catch { /* 已断——载荷尽力，close 权威投递仍在 */ }
        this.hardClose(c, CollabCloseCode.GENERATION_SUPERSEDED, DOC_VACUUMING_TERMINAL_REASON);
        return Promise.resolve();
      }
      const intent = c.context?.freezeIntent;
      if (!this.writeFreeze.has(c) && (intent === 'viewer' || intent === 'spool')) {
        this.applyWriteFreeze(c, intent, true);   // auth 意图登记（sendStateless conn-status 补推同点）
      }
      if (this.docRegistry.quotaFrozenDocs.has(pid)) this.applyWriteFreeze(c, 'quota', true);   // 冻结期加入（auth 查询兜底之外的第二道登记）
      // Y0b-5 T11：per-conn 推送面带 connectionId 预留字段（回传客户端——遥测 join 通道；per-doc 广播面缺省）
      try { c.sendStateless?.(JSON.stringify(this.docRegistry.buildDocStatus(pid, undefined, this.connectionIds.get(socketId)))); } catch { /* 已断 */ }
      // Y1c T9（修正 #8 半链）：服务端 auth 回执下发 historyId（+硬门三元——客户端持久化供次连携带
      // hid；web 客户端消费归后续卡，deferred 登记）。
      if (this.serverHistory) {
        try {
          c.sendStateless?.(JSON.stringify({
            type: 'auth-receipt',
            historyId: this.serverHistory.historyId,
            protocolVersion: CLIENT_PROTOCOL_VERSION,
            schemaVersion: CANVAS_DOC_SCHEMA_VERSION,
          }));
        } catch { /* 已断 */ }
      }
    }
    return Promise.resolve();
  }

  /** ===== Y0b-4 T6（Q-E v5/Q-K）：beforeHandleMessage——msg 桶计数+awareness 入站帧闸 =====
   *  H-3 三分落点之一：每帧必经（ClientConnection.processMessages——esm:457 每帧 await 本钩子后
   *  才进 MessageReceiver 解码）。帧闸判型=readFrameType 单源（库 IncomingMessage 解析——禁字节
   *  猜型，census ③；异常一律 null=放行，边界安全）；>64KB awareness 帧 1009 解码前拦（报告1 P1-1：
   *  30/s×16MB=480MB/s 解码路径封死）。msg 桶 cost=1 显式（census ⑨——帧数桶非字节桶）；
   *  超限 close 1008（backoff 档瞬态——重连自愈，与帧闸 1009 terminal 分档）。
   *  throw 兜底语义同 T4：code 权威投递=hardClose.webSocket.close 先行，throw 清空同批后续帧。 */
  async guardMessageFrame({ update, socketId, connection }: beforeHandleMessagePayload): Promise<void> {
    const conn = connection as unknown as CollabConnection;
    if (update.length > AWARENESS_FRAME_LIMIT_BYTES && readFrameType(update) === MessageType.Awareness) {   // 长度前置短路（T6 外审 M2）——常规帧（≤64KB 全量）免解析，语义恒等
      collabQuotaFrameRejectedTotal.inc({ reason: 'frame-too-large' });
      this.hardClose(conn, CollabCloseCode.LIB_MESSAGE_TOO_BIG, 'frame-too-large');
      throw Object.assign(new Error('awareness frame too large'), { code: CollabCloseCode.LIB_MESSAGE_TOO_BIG, reason: 'frame-too-large' });
    }
    if (!this.msgBuckets.consume(socketId, 1)) {
      collabMsgRateExceededTotal.inc();
      this.hardClose(conn, CollabCloseCode.RATE_LIMITED_CLOSE, 'msg-rate-exceeded');
      throw Object.assign(new Error('msg rate exceeded'), { code: CollabCloseCode.RATE_LIMITED_CLOSE, reason: 'msg-rate-exceeded' });
    }
  }

  /** code 权威投递路径=webSocket.close（throw.code 被库 Connection.close 丢弃——T0 探针②运行实证：
   *  throw 路径客户端 30s 僵尸零 close；throw 仅兜底中止帧并清空同批后续帧）。DR guardSyncFrame 经 host 缝消费→SG 公有。 */
  hardClose(conn: CollabConnection | undefined | null, code: number, reason: string): void {
    try {
      conn?.webSocket?.close(code, reason);
      collabWsCloseTotal.inc({ code: String(code), reason });
    } catch { /* 已断 */ }
  }

  /** Y0b-4 T7：ws 级 hardClose 变体（wrapBackpressure 内只有 ws 无 conn——close+计数复用 hardClose
   *  的 ws 部分）。调用点编号=collabWsCloseTotal 注释⑥。 */
  private hardCloseWs(ws: NonNullable<CollabConnection['webSocket']>, code: number, reason: string): void {
    try {
      ws.close(code, reason);
      collabWsCloseTotal.inc({ code: String(code), reason });
    } catch { /* 已断 */ }
  }

  /** ===== Y0b-4 T7（Q-F v2）→R4b'（v3）：出站背压 wrap——webSocket.send 包装（库 Connection.send
   *  恒经 this.webSocket.send〔esm:390-397 属性查找〕=出站必经点，T0 探针①）。判定核整体迁
   *  OutboundBudget（collab-outbound-budget.ts——四档帧型/预算记账/close 兜底释放）；本壳只留
   *  委托+getBacklog 闭包。wrap 点=connected 钩子（多文档连接同 ws 多次 connected——budget Map 判重）。
   *  census ⑤：bufferedAmount 生产读点唯一=wrapBackpressure（读点文本留本文件——脚本/自测/spec 三处零改）。 */
  wrapBackpressure(conn: CollabConnection): void {
    const ws = conn.webSocket;
    if (!ws) return;
    this.outbound.wrap(ws, (w, code, reason) => this.hardCloseWs(w, code, reason), () => ws.bufferedAmount ?? 0);
  }

  /** writeFreeze 单源查询（auth→connected 登记窗的回退：context.freezeIntent 意图 / 冻结期加入映射 quota）。
   *  W3b：本体随域迁 SG（DR guardSyncFrame ① 经 host.freezeReasons 缝消费——gateway 接线转发 sg 本方法）；
   *  quotaFrozenDocs 读面经构造直引 DR 公有字段。 */
  freezeReasons(conn: CollabConnection): Set<FreezeReason> {
    const e = this.writeFreeze.get(conn);
    if (e) return e.reasons;
    const pid = conn.document?.name ? parseDocName(conn.document.name)?.projectId ?? '' : '';
    const intent = conn.context?.freezeIntent;
    return new Set([intent ?? (pid && this.docRegistry.quotaFrozenDocs.has(pid) ? 'quota' : 'viewer')]);
  }

  /** writeFreeze 唯一出口（四点内联=drain begin/end、quota freeze/thaw、sweep 升/降；两点 connected
   *  补推=viewer/spool）。禁绕过本函数直写 conn.readOnly（生产直写仅 connectionConfig 构造期一处）。
   *  conn-status 推送=每连接冻结变更唯一通告（Q-A v4：per-conn 量不进 per-doc 广播）。
   *  T4 Minor：入口幂等短路——原因集无净变（add 已在集/del 不在集）直接跳过（sweep 5min 复验对
   *  已登记 viewer 重发 conn-status 的噪音消除——电平未翻不重推）。
   *  census ⑪：conn.readOnly 直写点唯一（W3b 目标文件切 collab-session-guard.service.ts）；DR 冻结族经 host 缝驱动。 */
  applyWriteFreeze(conn: CollabConnection, reason: FreezeReason, on: boolean): void {
    const existing = this.writeFreeze.get(conn);
    if (on ? existing?.reasons.has(reason) : !existing?.reasons.has(reason)) return;   // 无净变——幂等短路
    const pid = conn.document?.name ? parseDocName(conn.document.name)?.projectId ?? '' : '';
    const e = existing ?? { pid, reasons: new Set<FreezeReason>() };
    if (on) e.reasons.add(reason); else e.reasons.delete(reason);
    if (e.reasons.size === 0) this.writeFreeze.delete(conn); else this.writeFreeze.set(conn, e);
    conn.readOnly = e.reasons.size > 0;   // 库读该属性拦 SyncStep2/Update（readOnly=原因集非空——单一真值）
    try { conn.sendStateless?.(JSON.stringify({ type: 'conn-status', readOnly: conn.readOnly })); } catch { /* 已断 */ }
  }

  /** writeFreeze 全清（新语义操作——机械提取自 gateway selfIsolate :928/onApplicationShutdown :1888
   *  `writeFreeze.clear()`；强引用台账随隔离/停清——连接由 closeAll1012 关，正常路径 onDisconnect 自清）。 */
  clearAllWriteFreeze(): void { this.writeFreeze.clear(); }

  /** writeFreeze 条目按 pid 解除+返回受影响 socketId（新语义操作——机械提取自 gateway W3a DR.bindHost
   *  releaseFreezeForDoc 内联循环体，逐字平移；DR purgeDocState/abortVacuumRestore 经 host 缝消费——gateway
   *  接线转发 sg 本方法，DR 文件两波零改动）。purge=全原因解除+返回受影响 socketId（DR 侧连带清 overPush
   *  ——原「条目 pid 反查」语义在此保持）；abort=仅 'quota' 原因（reason 参数——返回值忽略）。 */
  releaseFreezeForDoc(pid: string, reason?: FreezeReason): string[] {
    const socketIds: string[] = [];
    for (const [c, e] of [...this.writeFreeze]) {
      if (e.pid !== pid) continue;
      if (reason !== undefined) { this.applyWriteFreeze(c, reason, false); }
      else { for (const r of [...e.reasons]) this.applyWriteFreeze(c, r, false); }   // 集合空=条目自动删
      if (c.socketId) socketIds.push(c.socketId);
    }
    return socketIds;
  }

  /** WS connectionId 读面（新语义操作——connectionIds socketId 键台账 SG 所有；DR loadDocument 装载失败
   *  Sentry 样本经 host.connectionIdOf 缝消费——gateway 接线转发 sg 本方法）。 */
  connectionIdOf(socketId: string): string | undefined { return this.connectionIds.get(socketId); }

  /** bytes 速率桶扣减（新语义操作——bytesBuckets SG 所有〔RC2 代价=DR guardSyncFrame ⓪′ 经 host 缝 1 位〕；
   *  gateway DR host 接线转发 sg 本方法）。 */
  consumeBytesBucket(socketId: string, bytes: number): boolean { return this.bytesBuckets.consume(socketId, bytes); }

  /** 断连清理（新语义操作——机械提取自 gateway disconnect 壳首行清理段〔early-return 之前〕，逐字平移；
   *  T6/T7 同点纪律：多标签 clientsCount>0 断连同样清〔防无界〕；overPush 台账归 DR 经构造直引 dropOverPush）。 */
  onDisconnectCleanup(socketId: string): void {
    this.connEstablishedAt.delete(socketId);
    this.connectionIds.delete(socketId);   // Y0b-5 T11：连接标识随断连清理（防无界）
    this.authAttemptBuckets.delete(socketId);
    // Y0b-3 T7 在此追加 awareness 归属表清理（T6 同点纪律：首行、early-return 之前——多标签
    // clientsCount>0 断连同样要清）：按 socketId 键控=所有权校验天然满足（双标签只清自己的）；
    // doc awareness 状态清场归库（removeConnection 已自动 removeAwarenessStates——自建表只清登记）。
    for (const cid of this.ownedClientIds.get(socketId) ?? []) this.clientIdOwner.delete(cid);
    this.ownedClientIds.delete(socketId);
    this.socketIdentity.delete(socketId);
    this.awarenessDriftLogged.delete(socketId);   // Y0b-3 T8 附带 T7 评审小修：漂移去重 Set 同点清（socketId 级残留=泄漏面）
    // Y0b-4 T4：冻结层+强推台账键控清理（onDisconnectPayload 无 connection——按 socketId 扫 writeFreeze；
    // 台账只含冻结连接=O(冻结面)；overPush O(1)——sid 键直删）
    for (const [c] of this.writeFreeze) if (c.socketId === socketId) this.writeFreeze.delete(c);
    this.docRegistry.dropOverPush(socketId);   // W3a（RC2）：overPush 台账归 DR——sid 键直删机械提取（SG 断连清理缝位，原位原序保持）
    // Y0b-4 T6：速率闸三桶键控清理（socketId 键+aware: 前缀键——重连重置=断连循环刷桶的 DoS 兜底；
    // T6 同点纪律：首行清理段，多标签 clientsCount>0 断连同样清）
    this.msgBuckets.delete(socketId);
    this.bytesBuckets.delete(socketId);
    this.awareBuckets.delete(`aware:${socketId}`);
    this.heartbeat.unregister(socketId);   // R6'：心跳台账键控清理（键与 connected register 严格同源——payload.socketId）
  }

  /** 卸载 doc 全连接的 SG 域台账清理（新语义操作——机械提取自 gateway unloadDocument 壳 finally 段
   *  〔connEstablishedAt+ownedClientIds/clientIdOwner 反查〕，逐字平移；钩子在 doc 移出 documents 之前触发，
   *  payload.document 仍可达；?. 防 finally 内 TypeError 绕过上方 catch——X4「钩子永不抛」契约对 finally 同样成立）。 */
  onDocUnloadCleanup(document: Document): void {
    // Y0b-3 T6 键控清理：卸载清该 doc 全部连接寿命条目（防无界——常规路径 onDisconnect 已逐条清，
    // 此为库自发卸载/直连路径的兜底反查）
    for (const connection of document.connections?.keys() ?? []) this.connEstablishedAt.delete(connection.socketId);
    // Y0b-3 T7 键控清理：卸载清该 doc 全部连接的 awareness 归属条目（T6 同款兜底反查——常规路径
    // onDisconnect 已逐条清，此为库自发卸载/直连路径的兜底；socketIdentity 不在此清=socket 键控
    // 随 onDisconnect 走，doc 卸载不构成身份失效）
    for (const connection of document.connections?.keys() ?? []) {
      for (const cid of this.ownedClientIds.get(connection.socketId) ?? []) this.clientIdOwner.delete(cid);
      this.ownedClientIds.delete(connection.socketId);
    }
  }
  /** 批3-4：sweep 轮询（unref——进程退出不被阻）。Y0b-3 T8：setTimeout 自排链——每轮按
   *  sweepIntervalMs（5min±20% jitter）重排（setInterval 固定周期无法表达 jitter；jitter 防多连接
   *  同刻聚集脉冲）。Y0b-3 T1 起默认开：COLLAB_SWEEP_ENABLED === 'false' 时 tick 首行即返
   *  （逃生阀=零行为差异——§4.2 回滚表用）。快照死线（context.sessionExpiresAt——authenticate 播种，
   *  必过期下界）命中后先 DB 复验（session+权限链，移除成员也踢）；复验翻案（me 探活已续期）则刷新
   *  快照；确认 revoked → stateless 预通知 {type:'session-expiring'}（客户端 flushPendingUpdates）→
   *  5s grace → webSocket.close(CollabCloseCode.SESSION_EXPIRED)。禁 Connection.close——文档级 CLOSE
   *  制造 L6 僵尸；close 调用处自行 catch。复验异常 fail-open，但连续 5 次仍关（无界 fail-open=安全债
   *  没真修）+ metric。W3b：perm-events/sweep 三锚随迁（sessionSweepTimer setTimeout 自排链三件套 §8.3-2/3）。 */
  startSessionSweep() {
    if (this.sessionSweepTimer) { clearTimeout(this.sessionSweepTimer); this.sessionSweepTimer = null; }   // W8/M2②：clear-first（幂等——rejoin 不泄漏定时器）
    const schedule = (): void => {
      this.sessionSweepTimer = setTimeout(() => {
        void this.sweepSessions().catch((e) => this.host.logger.warn(`session sweep: ${e}`));
        schedule();
      }, this.sweepIntervalMs());
      this.sessionSweepTimer.unref?.();
    };
    schedule();
  }

  /** Y0b-3 T8：jitter 间隔（±20% → [4min, 6min]）。抽函数=区间断言单点（perm-events spec）。 */
  sweepIntervalMs(): number { return SESSION_SWEEP_INTERVAL_MS * (0.8 + Math.random() * 0.4); }

  /** Y0b-3 T6：连接最大寿命检查（默认 12h——COLLAB_CONN_MAX_LIFETIME_MS，默认值落使用点）。
   *  并进 sweep 同一脉冲（不新开 timer）；置于 SWEEP_ENABLED 逃生阀**之前**——阀=session-expiry
   *  回滚面，不得静默关掉本机制（T3 防线老化/T4 观测同纪律）。超线→webSocket.close(CollabCloseCode.MAX_LIFETIME)——
   *  P7：connection.close 丢 code，统一 webSocket.close；close 调用处自 catch（F11）。 */
  private enforceConnMaxLifetime(): void {
    for (const doc of this.host.allDocuments().values()) {
      for (const conn of doc.connections.keys()) {
        const at = this.connEstablishedAt.get(conn.socketId);
        if (at !== undefined && Date.now() - at > this.connMaxLifetimeMs()) {
          try {
            conn.webSocket?.close(CollabCloseCode.MAX_LIFETIME, 'max-lifetime');   // 4401 已被库 Unauthorized+sweep 双占用——4402 新码
            collabWsCloseTotal.inc({ code: String(CollabCloseCode.MAX_LIFETIME), reason: 'max-lifetime' });
            this.connEstablishedAt.delete(conn.socketId);   // Y0b-3 T6 评审小修：close 成功即删条目——防重入 tick 重复 inc 失真（onDisconnect delete 幂等无副作用）
          } catch (err) { this.host.logger.warn(`max-lifetime close failed for ${doc.name}: ${(err as Error).message}`); }
        }
      }
    }
  }

  private connMaxLifetimeMs(): number { return Number(process.env.COLLAB_CONN_MAX_LIFETIME_MS) || 43_200_000; }

  async sweepSessions() {
    this.enforceConnMaxLifetime();   // Y0b-3 T6：寿命检查同一脉冲首部（在 SWEEP_ENABLED 阀之前——见上注）
    if (process.env.COLLAB_SWEEP_ENABLED === 'false') return; // 默认开（Y0b-3 T1 P-H，spec §3.1）；'false'=env 逃生阀（§4.2 回滚表——只静默 session-expiry 支，寿命检查在其前不受辖）
    for (const document of [...this.host.allDocuments().values()]) {
      for (const connection of [...document.connections.keys()]) {
        const ctx = (connection.context ?? {}) as { token?: string; sessionExpiresAt?: Date };
        if (this.sweepGrace.has(connection)) continue;   // 通知/grace 在途：去重
        // —— 判据门两分支（Y0b-3 T3 P-K）：快照死线 ∨ 权限复验到期（permCache 5min/首查）——
        // 原单分支（快照未过期 continue）使权限复验零调用=降级/撤权最长 7d 不可见（本 Task 修）。
        // W3b verdict 纯函数化：decideSweepRecheck（§5——permRecheckDue 逻辑随迁合并；now 单点快照）。
        const decision = decideSweepRecheck({
          expiresAt: ctx.sessionExpiresAt, now: Date.now(),
          cachedAt: this.permCache.get(connection)?.at, ttl: CollabSessionGuardService.PERM_RECHECK_TTL_MS,
        });
        if (decision === 'skip') continue;
        try {
          const re = await this.recheckConnection(connection, document.name);
          this.sweepRecheckFails.delete(connection);   // 复验完成（无论结论）——连续失败计数复位
          if (!re.revoked) {
            if (re.expiresAt) ctx.sessionExpiresAt = re.expiresAt;   // 翻案/刷新：死线快照按新值（下轮按新死线）
            continue;
          }
          this.scheduleSweepClose(connection, 'revoked');
        } catch (err) {
          this.host.logger.warn(`sweep recheck failed for ${document.name}: ${(err as Error).message}`);
          const fails = (this.sweepRecheckFails.get(connection) ?? 0) + 1;
          this.sweepRecheckFails.set(connection, fails);
          if (fails >= 5) this.scheduleSweepClose(connection, 'db-fail');   // 5 连败仍关（≈5min 上限）
        }
      }
    }
  }

  /** ===== Y0b-3 T8：事件驱动即时踢权（spec §3.1"即时"——纯 sweep 5min 兜底撤权退化 ≤6min）=====
   *  权限变更点（team.service removeMember/changeRole/transferOwnership）emit 'collab.perm.changed'
   *  { userId, teamId[, removed] }；监听器只做内存两步（V11 禁慢操作纪律）：①匹配连接的 permCache 失效
   *  （仅 delete 不直接 recheck——T3 契约）；②scheduleImmediateSweep 请求一次立即 tick。
   *  project 删除路径不 emit 本事件——已有 project.gone → handleProjectsGone → closeTeamDocuments
   *  关连接（强于缓存失效；连接亡=WeakMap 键散）。W3b：GW onModuleInit 调用点改 sg.wirePermChangedEvents()。
   *  Y1a+Y1b T5（v11.1④）：removed:true（removeMember 专属）→ 匹配连接**直连 scheduleSweepClose 不复验**
   *  ——removeMember 不触碰 ProjectMember 表，语义 A 复验对显式行档 role 非 null 放行=旧连接仍可写
   *  doc 的越权面；重连走 authenticate 全链重判（显式行档保留访问=REST 同链语义维持）。COLLAB_SWEEP_ENABLED
   *  ='false' 逃生阀同辖本腿（session-expiry 回滚面一致）。 */
  wirePermChangedEvents(): void {
    this.eventEmitter.on('collab.perm.changed', (payload: { userId: string; teamId: string; projectId?: string; removed?: boolean }) => {
      const valveOpen = process.env.COLLAB_SWEEP_ENABLED !== 'false';
      for (const document of this.host.allDocuments().values()) {
        for (const connection of document.connections.keys()) {
          const identity = this.socketIdentity.get(connection.socketId);
          if (!identity || identity.id !== payload.userId || identity.teamId !== payload.teamId) continue;
          this.permCache.delete(connection);   // 事件=缓存失效信号（下一 tick 立即复验）
          if (payload.removed && valveOpen) {
            memberRevokedConns.inc();   // T19（v11.2 ③）：成员移除清理结果计数（入队侧即时值）
            this.scheduleSweepClose(connection, 'revoked');   // T5 removed：直关（通知+grace→close 4401）
          }
        }
      }
      this.scheduleImmediateSweep();
    });
  }

  /** Y0b-3 T8：事件=请求一次立即 tick——仍单一执行路径 sweepSessions（不新增第二执行器）；
   *  sweepKickPending 防惊群（事件风暴合并为一次）。tick 与 event 撞窗的重叠 sweepSessions 为良性：
   *  double close 在 CLOSING 态 no-op + recheck 幂等（permCache 重写）。 */
  private scheduleImmediateSweep(): void {
    if (this.sweepKickPending) return;
    this.sweepKickPending = true;
    setImmediate(() => {
      this.sweepKickPending = false;
      void this.sweepSessions().catch(() => {});
    });
  }

  /** 复验：session resolve（纯读不续期——清扫面不得反向保活 session）+权限链 perm.resolveWithTeam
   *  （F-3 判据单源——与 authenticate 同链；原手写三段查询删除）。⚠ 权限语义 A（P-U②）：
   *  role 非 null 但用户已被移出团队（有显式 ProjectMember 行）=预期行为——REST 同链既有语义，不踢。
   *  cause 分型：no-role（权限链无角色）/session-invalid（会话失效）——T8 事件路径同分型。
   *  Y0b-4 T4：降级/升回改道 writeFreeze 单源（applyWriteFreeze）——降级补 conn-status 通告
   *  （原 :1631-1635 改 readOnly 不通知=静默分叉洞由单源内推送修复）；drain 冻结窗内复验 VIEWER
   *  结论走同一 applyWriteFreeze('viewer',true)——'draining' 原因并存（集合化=prev 快照跟随语义
   *  继任：60s 解除只移 'draining'，viewer 保持——不打穿越权写窗）。
   *  W3b：isShuttingDown→host.isDrainingDerived()（draining——B3 承接账④更名，原 isShuttingDownFlag）；isWritableOrDegraded→persistence 直引（§4.1）。 */
  private async recheckConnection(connection: { context?: { token?: string }; readOnly?: boolean; socketId?: string }, documentName: string): Promise<{ revoked: boolean; cause?: 'no-role' | 'session-invalid'; expiresAt?: Date }> {
    const token = connection.context?.token;
    if (!token) return { revoked: false, expiresAt: undefined };   // 无凭据（authenticate 必播种——理论不可达）不翻案
    const { session } = await this.sessionSvc.resolve(token);
    if (!session) return { revoked: true, cause: 'session-invalid', expiresAt: undefined };   // 过期/登出（resolve 折叠两态）
    const { role } = await this.perm.resolveWithTeam(parseDocName(documentName)?.projectId ?? '', session.userId);
    this.permCache.set(connection, { role, at: Date.now() });   // 会话级结论缓存（T8 事件失效消费——仅清不直接 recheck）
    if (role === 'PROJECT_VIEWER' && !connection.readOnly) {
      this.applyWriteFreeze(connection as unknown as CollabConnection, 'viewer', true);   // E13：降级=修越权写不断连（+conn-status 通告）
      this.rewriteAwarenessRole(connection, 'PROJECT_VIEWER', documentName);
      collabSweepCloseTotal.inc({ cause: 'role-downgraded' });
      return { revoked: false, expiresAt: session.expiresAt };
    }
    // H-5×E13 嵌套继任（集合化）：drain 冻结窗内复验 VIEWER 结论——'viewer' 原因并入冻结集
    //（60s 解除只移 'draining'，viewer 保持=不打穿越权写窗；旧 prev 快照跟随语义的 writeFreeze 继任）。
    if (role === 'PROJECT_VIEWER' && connection.readOnly) {
      this.applyWriteFreeze(connection as unknown as CollabConnection, 'viewer', true);
      return { revoked: false, expiresAt: session.expiresAt };
    }
    // 升回分支（I-2）：停写状态期严禁静默解冻——守卫（draining/spool 熔断/quota 冻结的连接
    // 由 writeFreeze 原因集各自保持：本分支只移除 'viewer' 原因，'draining'/'quota' 并存时
    // readOnly 不翻 false）；降级方向（上一分支）永不加守卫。
    if (role !== null && role !== 'PROJECT_VIEWER' && connection.readOnly
      && !this.host.isDrainingDerived() && this.persistence.isWritableOrDegraded() === 'ok') {
      this.applyWriteFreeze(connection as unknown as CollabConnection, 'viewer', false);   // 升回可写（VIEWER 翻案/授权变化——仅 serving+spool ok 期）
      this.rewriteAwarenessRole(connection, role, documentName);
    }
    return role === null ? { revoked: true, cause: 'no-role', expiresAt: undefined } : { revoked: false, expiresAt: session.expiresAt };
  }

  /** Y0b-3 T8 helper（T7 留定义随消费补）：连接的 socketId 取法 + socketId 名下 clientId 快照。 */
  private socketIdOf(connection: { socketId?: string }): string { return connection?.socketId ?? ''; }
  private ownedClientIdsOf(socketId: string): number[] { return [...(this.ownedClientIds.get(socketId) ?? [])]; }

  /** awareness role 改写（E73——只置 readOnly 不改 awareness=成员表仍显示旧角色）。
   *  Y0b-3 T8 实接。⚠ 时钟门（y-protocols applyAwarenessUpdate 判据 `currClock < clock`，非 null 改写
   *  无相等分支）：服务端直改 states 不动 meta ⇒ 广播帧编出旧 clock ⇒ 对端全丢弃而服务端自以为成功
   *  （假绿型）——必须先递增 meta.clock 再改 states；广播经 aw.emit('update') 走 Document.
   *  handleAwarenessUpdate → broadcastAwarenessUpdate（encode 读新 clock，对端 currClock<clock 通过）。
   *  探针裁注：applyAwarenessUpdate(aw, encode(aw,[cid])) 重入形态不可行——改后 currClock===clock 被
   *  时钟门丢弃（updated 不 push=零广播），直接 emit 同一广播链少一次编解码。origin='local' 非
   *  transaction origin：handleAwarenessUpdate 不动 entry.clients；beforeHandleAwareness 只挂 inbound
   *  scratch 解码链（esm:197-212）——服务端自发广播零拦截。socketIdentity.role 同步改写——否则下一个
   *  入站帧经 guardAwareness ③无条件注入把旧 role 冲回广播。 */
  private rewriteAwarenessRole(connection: { socketId?: string }, role: ProjectRole, documentName: string): void {
    const socketId = this.socketIdOf(connection);
    const document = this.host.allDocuments().get(documentName);
    const aw = document?.awareness;
    if (!aw || !socketId) return;
    const identity = this.socketIdentity.get(socketId);
    if (identity) identity.role = role;   // 防 T7 注入链冲回（下一入站帧的 user 来源）
    for (const clientId of this.ownedClientIdsOf(socketId)) {
      const prevState = aw.states.get(clientId);
      if (!prevState) continue;   // 无本地态的 clientId 无可改写
      const meta = aw.meta.get(clientId);
      aw.meta.set(clientId, { clock: (meta?.clock ?? 0) + 1, lastUpdated: Date.now() });   // ⚠ 先递增（时钟门判据）
      aw.states.set(clientId, { ...prevState, user: { ...(prevState.user ?? {}), role } });
      aw.emit('update', [{ added: [], updated: [clientId], removed: [] }, 'local']);   // 触发 Document 广播链
    }
  }

  /** ===== Y0b-3 T7（E73/spec §3.3）：beforeHandleAwareness——states 归属三分支+身份覆写 =====
   *  载体=payload.states（scratch Map——库在钩子后从它重编码广播〔esm:197-207〕，d.ts 官方契约
   *  "Mutate this map in place to rewrite the update"）；禁碰 payload.awareness.states（文档本体）。
   *  三分支同一趟遍历：①他人登记=伪造→整帧丢弃（不替别人发声）；②首见=登记（同一趟——首帧不被
   *  丢弃）；③owned（含刚登记）→**无条件注入** serverIdentityOf（不依赖帧内 user 字段存在性——
   *  局部帧〔只带 cursor〕跳过覆写=绕过，P0-2）。
   *  scratch 幽灵剔除（4.6.0 实证偏离登记）：库 scratch Awareness 构造器 setLocalState({}) 使每帧
   *  states 混入一个随机 clientId 空态项（真身 clock=0 占位反被 y-protocols 时钟门剥离——guard 实测
   *  frames 全含幽灵）。判据=首见 ∧ 空态 ∧ doc awareness 无此 id ⇒ states.delete（不计登记/上限/
   *  注入——防幽灵吃上限槽位+每帧登记 churn）。**T10 勘误（真身误杀机理）**：真身空态帧同判据被剔
   *  （hook 载荷只有 states 内容，拿不到 scratchDoc.clientID 与幽灵区分）⇒ 零回显 ⇒ 客户端 30s
   *  messageReconnectTimeout 判死重连循环（探针 bare 45s 实证）——客户端已由构造/replayLocalUser
   *  播种非空态锚点 {presence:true} 保证真身帧非空态（apps/web/src/collab/awareness.ts）；
   *  **ghost 计数异常增高=客户端播种退化信号**（runbook 巡检项）。
   *  放行门（P0-1）：非连接来源（DirectConnection/服务端内部写——connection undefined 或 context
   *  undefined 或 socketId 空串）=我们自己写的，整体放行禁删禁改。
   *  onAwarenessUpdate 是观测钩子禁改写（E73 钉死）——本钩子=唯一改写点。
   *  W3b verdict 纯函数化：档位判定=decideAwarenessStrip、归属三分支=decideClientOwnership（§5）；
   *  distinctUsers 并集/states.delete-set/计数/登记/剪枝/漂移探针留壳按 verdict 分支执行（副作用序逐字保持）。 */
  guardAwareness({ states, socketId, context, connection, document }: beforeHandleAwarenessPayload): void {
    try {
      if (!connection || !context || !socketId) return;   // P0-1：非连接来源放行（空串含）
      // Y0b-4 T6/T13（Q-L 剔字段三档统一）：readOnly（连接级）→ solo/over-8（文档级）——三档同一
      // 原语 stripTransientFields：浅拷贝剔 cursor/selection（条目永不删：回显=保活链前提，剥空态
      // 会撞 T10 真身误杀形态）。保持原 meta.clock（禁递增——T0 探针⑤：等时钟回显不覆盖发送者本地
      // cursor，客户端本地态零扰动）。库从 scratch states 重编码广播——对端收 user/presence 无
      // cursor（undefined JSON 序列化丢键）。只计数含 cursor/selection 的帧（无字段的纯 presence 帧
      // 不刷 stripped 计数）。onDisconnect 兜底清场归库（removeAwarenessStates）。
      // readOnly 与 solo 可同时真——reason 记 read-only 优先（更具体语义：单连接冻结 vs 文档级
      // 广播面收缩；先剔后判 solo 也无残余字段可剔=自然幂等）。
      // W3b：档位判定核=decideAwarenessStrip（§5）；distinctUsers 并集计算（读态）留壳仅传去重数——
      // T13（E39）solo/over-8 判=文档全量 getStates() ∪ 本帧 states 的 user.id 去重（P1-6：本帧只含
      // 发帧者，10 人画布单帧会误判 solo——两取数源并集）；本帧 user 为注入前原文——伪造 user.id 只
      // 影响自身帧的档位判定（注入覆写在后，无伪造面）。
      const readOnly = !!(connection as unknown as { readOnly?: boolean }).readOnly;
      let distinctUserCount = 0;
      if (!readOnly) {
        const distinctUsers = new Set<string>();
        for (const s of ((document as any).awareness?.getStates?.() ?? new Map()).values()) {
          const uid = (s as { user?: { id?: string } } | null)?.user?.id;
          if (uid) distinctUsers.add(uid);
        }
        for (const s of states.values()) {
          const uid = (s as { user?: { id?: string } } | null)?.user?.id;
          if (uid) distinctUsers.add(uid);
        }
        distinctUserCount = distinctUsers.size;
      }
      const stripReason = decideAwarenessStrip({ readOnly, distinctUsers: distinctUserCount });
      if (stripReason !== null && this.stripTransientFields(states)) collabAwarenessStrippedTotal.inc({ reason: stripReason });
      // Y0b-4 T12（E38）：解码后 states 4KB 判——三档剔字段（readOnly/solo/over-8）后取广播字节
      // 近似（剔后才是实际要编码广播的量）；整帧丢弃同 forged 先例（丢帧不 close——客户端已有
      // 4KB 前置拒，本判兜底裸帧/旧 bundle 残余）。放身份注入前：注入 user 只增字节，先判少做无效趟。
      // 近似方向声明（T12 二级收口）：判在注入前——剥离后 <4096 判过的帧，注入 user 后实际广播
      // 可超 4096；方向=放行（偏松不偏严），出站超限由 64KB 入站帧闸（AWARENESS_FRAME_LIMIT_BYTES）兜底。
      if (JSON.stringify([...states.values()]).length > AWARENESS_STATES_LIMIT_BYTES) {
        states.clear();
        collabAwarenessRejectTotal.inc({ reason: 'frame-too-large' });
        return;
      }
      const identity = this.socketIdentity.get(socketId);
      if (!identity) return;   // 未认证连接的 awareness 帧（pre-auth 队列外不应出现——防御性放行）
      const libClients = (document as any).getClients?.(connection) as Set<number> | undefined;
      for (const [clientId, state] of [...states]) {
        // W3b：归属三分支判定核=decideClientOwnership（§5）；states.delete/set+计数+登记留壳按 verdict 执行。
        const ownership = decideClientOwnership({
          owner: this.clientIdOwner.get(clientId), socketId,
          emptyState: isEmptyState(state), docHasState: document.awareness.states.has(clientId),
          ownCount: this.ownedClientIds.get(socketId)?.size ?? 0,
        });
        if (ownership === 'forged') {   // ①他人登记=伪造→整帧丢弃（O(1) 判定）
          states.delete(clientId);
          collabAwarenessRejectTotal.inc({ reason: 'forged' });
          continue;
        }
        if (ownership === 'ghost') {   // ②首见 scratch 幽灵——剔除（见方法头注 T10 真身误杀机理）
          states.delete(clientId);
          collabAwarenessRejectTotal.inc({ reason: 'ghost' });   // T10 观测盲区根修：剔除必计数（异常增高=客户端播种退化）
          continue;
        }
        if (ownership === 'owner-limit') {   // ②首见超上限
          states.delete(clientId);
          collabAwarenessRejectTotal.inc({ reason: 'owner-limit' });
          continue;
        }
        if (ownership === 'register') {   // ②首见登记
          this.clientIdOwner.set(clientId, socketId);
          if (!this.ownedClientIds.has(socketId)) this.ownedClientIds.set(socketId, new Set());
          this.ownedClientIds.get(socketId)!.add(clientId);
        }
        states.set(clientId, { ...state, user: serverIdentityOf(identity) });   // ③无条件注入（pass-inject/register 同注入）
      }
      // 剪枝：陈旧 clientId（客户端 setLocalState(null) 移除自身后索引残留——防上限被垃圾占满卡死长会话）。
      // 判据=既不在库 clients 集也不在本帧 states 且 doc awareness.states 已无此 id；只迭代自己名下
      // Set（O(自己)——热路径禁全表扫描）。
      const own = this.ownedClientIds.get(socketId) ?? new Set<number>();   // 空 states 帧（幽灵剔除后零条目）时无登记条目——空安全（否则 for-of 抛进 catch，warn 热路径刷屏）
      for (const cid of own) {
        if (!libClients?.has(cid) && !states.has(cid) && !document.awareness.states.has(cid)) {
          this.clientIdOwner.delete(cid);
          own.delete(cid);
        }
      }
      // spec §3.3 ③一致性校验源：库 clients 集相对归属表的差异=漂移探针（不信赖库内部也为漂移留
      // 观测出口）——lib 有而归属表无=登记链断裂（异常态）；去重防热路径刷屏，恢复即清。
      if (libClients) {
        let drifted = false;
        for (const cid of libClients) if (!own.has(cid)) { drifted = true; break; }
        if (drifted && !this.awarenessDriftLogged.has(socketId)) {
          this.awarenessDriftLogged.add(socketId);
          this.host.logger.warn(JSON.stringify({ event: 'collab_awareness_drift', lib: libClients.size, owned: own.size }));
        } else if (!drifted) {
          this.awarenessDriftLogged.delete(socketId);
        }
      }
    } catch (err) {
      // 观测面禁抛——钩子抛错中断库消息处理链（esm try/finally 不 catch）；swallow 但留痕
      //（对齐 unloadDocument swallow 先例——catch 静默=零观测；不加指标保 reason 枚举）
      this.host.logger.warn(`[y0b-3] awareness guard error: ${(err as Error)?.message}`);
    }
  }

  /** Y0b-4 T13（Q-L）：剔字段原语（三档统一——read-only/solo/over-8 共用）——浅拷贝剔
   *  cursor/selection（条目永不删=回显保活链前提；保持原 meta.clock 禁递增——T0 探针⑤：
   *  等时钟回显不覆盖发送者本地 cursor）。返回是否实际剥离（无 cursor/selection 的纯
   *  presence 帧不刷 stripped 计数）。 */
  private stripTransientFields(states: Map<number, unknown>): boolean {
    let stripped = false;
    for (const [cid, state] of [...states]) {
      const s = state as Record<string, any> | null;
      if (s && (s.cursor !== undefined || s.selection !== undefined)) {
        states.set(cid, { ...s, cursor: undefined, selection: undefined });
        stripped = true;
      }
    }
    return stripped;
  }

  /** ===== Y0b-4 T6（Q-E v5）：awareness 独立限速——共享 awareBuckets+键前缀 aware:${sid} =====
   *  与 msg 桶分账（census ⑥ 定义点恰四处）：msg 桶计一切帧、aware 桶只限 awareness（60 容量+30/s
   *  补充——合法节律 ~4/min/连接，>30/s 必为风暴）。cost=1 显式（census ⑨——帧数桶）。
   *  先于 guardAwareness 调用（其 try/catch 自吞一切——限速 throw 必须在外层才能中止帧）；
   *  超限 close 1008（backoff 档）。非连接来源放行（P0-1 同款——服务端内部写不限速）。 */
  guardAwarenessRate({ connection, context, socketId }: beforeHandleAwarenessPayload): void {
    if (!connection || !context || !socketId) return;   // P0-1：非连接来源放行
    if (!this.awareBuckets.consume(`aware:${socketId}`, 1)) {
      collabAwarenessRateExceededTotal.inc();
      this.hardClose(connection as unknown as CollabConnection, CollabCloseCode.RATE_LIMITED_CLOSE, 'awareness-rate-exceeded');
      throw Object.assign(new Error('awareness rate exceeded'), { code: CollabCloseCode.RATE_LIMITED_CLOSE, reason: 'awareness-rate-exceeded' });
    }
  }

  private scheduleSweepClose(connection: object & { sendStateless?: (p: string) => void; webSocket: { close: (code?: number, reason?: string) => void } }, cause: 'revoked' | 'db-fail') {
    if (this.sweepGrace.has(connection)) return;
    this.sweepGrace.add(connection);
    try { connection.sendStateless?.(JSON.stringify({ type: 'session-expiring' })); }
    catch (err) { this.host.logger.warn(`sweep pre-notice failed: ${(err as Error).message}`); }
    const grace = setTimeout(() => {
      this.sweepGrace.delete(connection);
      try {
        connection.webSocket.close(CollabCloseCode.SESSION_EXPIRED, 'session-expired');
        collabSweepCloseTotal.inc({ cause });
        collabWsCloseTotal.inc({ code: String(CollabCloseCode.SESSION_EXPIRED), reason: 'session-expired' });   // Y0b-3 T6：close 分布面
      } catch (err) {
        this.host.logger.warn(`sweep close failed: ${(err as Error).message}`);   // F11：webSocket.close 调用处自 catch
      }
    }, SESSION_SWEEP_GRACE_MS);
    grace.unref?.();
  }

  /** 批3-2：关停前对存活连接 close(CollabCloseCode.APP_RESTART, "service restart")——客户端据 code 按瞬态服务重启
   *  立即重连，不等 1006 盲区。先复制后关（[...map] 快照）：close 回调可能反噬集合
   *  （连接自清/异常路径），活迭代下漏关未访问项。单个失败各自吞（F11）不阻断其余。 */
  closeAllConnections1012() {
    this.closeAllConnectionsWs(CollabCloseCode.APP_RESTART, 'service restart');
  }

  /** Y1c T9（T8 接线）：全连接关闭泛化面（1012 原语+1011 WAL_FSYNC_EIO fail-stop 档共用——
   *  spool.onWalFailStop→close 全部连接 1011，ADR-01 §4.3 fsync 分档）。 */
  closeAllConnectionsWs(code: number, reason: string) {
    for (const document of [...this.host.allDocuments().values()]) {
      for (const connection of [...document.connections.keys()]) {
        try {
          connection.webSocket.close(code, reason);
          collabWsCloseTotal.inc({ code: String(code), reason });   // Y0b-3 T6：close 分布面
        }
        catch (err) { this.host.logger.warn(`close(${code}) failed for ${document.name}: ${(err as Error).message}`); }
      }
    }
  }

  closeTeamDocuments(projectIds: string[]) {
    for (const projectId of projectIds) {
      const name = this.docRegistry.liveDocName(projectId);   // Y1c T12：canonical wire 名（#g 换代通道——E23 closeTeamDocuments 连带）
      // 批3-4：先复制后关——库 closeConnections 走 Connection.close→removeConnection（活 Map 删键，
      // 不先复制则后续遍历漏连接）；且协议级 CLOSE 依赖客户端配合断开（不配合=connected 僵尸），
      // 逐连接补 webSocket.close 硬关兜底（单个失败各自吞——F11）
      const document = this.host.allDocuments().get(name);
      const connections = document ? [...document.connections.keys()] : [];
      try {
        this.host.closeConnections(name);
      } catch (err) {
        this.host.logger.warn(`closeConnections failed for ${projectId}: ${(err as Error).message}`);
      }
      for (const connection of connections) {
        this.connEstablishedAt.delete(connection.socketId);   // Y0b-3 T6 键控清理：解散清该 doc 全部连接寿命条目（防无界）
        try {
          connection.webSocket.close(CollabCloseCode.NORMAL, 'team disbanded');
          collabWsCloseTotal.inc({ code: String(CollabCloseCode.NORMAL), reason: 'team disbanded' });   // Y0b-3 T6：close 分布面
        }
        catch (err) { this.host.logger.warn(`close webSocket failed for ${projectId}: ${(err as Error).message}`); }
      }
    }
  }

  /** W3b：SG 域定时器族随停（机械提取自 gateway onApplicationShutdown :1890-1891 清理行逐字平移——
   *  sessionSweepTimer/authMapsSweepTimer 两位；GW 壳只剩缝调用，清理段在 unregister readers 之前的
   *  相对序不动〔§2.3〕）。 */
  stopTimers(): void {
    if (this.sessionSweepTimer) { clearTimeout(this.sessionSweepTimer); this.sessionSweepTimer = null; }
    if (this.authMapsSweepTimer) { clearInterval(this.authMapsSweepTimer); this.authMapsSweepTimer = null; }   // Y0b-3 T3：防线 Map 老化 timer 随停
    this.heartbeat.stop();   // R6'：心跳 timer 随停（onApplicationShutdown 随停族）
  }
}
