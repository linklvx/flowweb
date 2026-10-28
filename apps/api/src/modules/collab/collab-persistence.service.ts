// apps/api/src/modules/collab/collab-persistence.service.ts
// Y0c T40（B1）：Persistence 切出——store/spool/drain/pending 的 doc 持久化状态单一所有者（Z24；
// E29 原动机=不启 WS Server 可独立实例化——RC2 验收面=collab-persistence.service.spec 全链用例）。
// 行数锚 ≤1037（§0.6 偏离 65；T40 B1 实测 950→T14 flushDocument 窄接口叠加实测重标——check-collab-module-size 同批）。构造器零 gateway/Server 依赖（显式 @Inject=esbuild 无 metadata 先例）；
// DI/直构双兼容（gateway 尾参缺省自建+bindHost——31 处直构零改动；自建传同 pgBreaker 防脑裂）。
// 零 @hocuspocus/server import（PersistenceDocument 最小结构面——census ⑮ 闭包纯净）。行为零变化
// 红线：方法体=gateway 前文逐字平移，仅 host 缝机械替换+eventEmitter 可选链（@Optional 缺席语义
// 等价）。doc-name 解析经 doc-name.util（偏离 67）。

import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabSpoolService } from './collab-spool.service';
import { CollabPgBreakerService } from './collab-pg-breaker.service';
import { isFkGone } from './pg-error.util';
import { isGateApplyOrigin, classifyDocUpdateOrigin } from '@flowweb/shared';
import { parseDocName, projectDocName } from './doc-name.util';
import { captureCollabException } from '../../utils/sentry-scrub';
import { docUpdateOriginTotal, storeInFlightDocs, collabLeaseRowMissingTotal, collabDrainDurationSeconds, collabDrainProjectsTotal, collabFlushDocumentOutcomeTotal, yjsStoreAppendFailureTotal, yjsStoreCompactFailureTotal, yjsStoreDrainTotal, yjsStoreTailAnomalyTotal, yjsStoreUnexpectedThrowTotal, yjsUnloadHandoffFailureTotal, yjsUpdatesDiscardedDeletedTotal, yjsStorePayloadBytes, yjsStoreDuration, yjsCompactDuration, yjsCompactDeletedRows, yjsCompactTombstoneBytes, yjsStoreTotal, type CollabStoreTrigger } from './store.metrics';

/** 批3-4：compact 门限由行数（原 COMPACT_THRESHOLD=32）改时间门限——debounce 收紧（5s→1/2s）会让
 *  行数门限的 compact 频率同步放大（advisory lock+重放+deleteMany 成本不低）。loadDocument 播种
 *  基线，距上次 compact ≥60s 才再 compact（env 可调）。B1 随域迁（census ㉒ 历史豁免条目同迁）。 */
export const COMPACT_INTERVAL_MS = Number(process.env.COMPACT_INTERVAL_MS) || 60_000;

/** 批3-4 persist-status 退避梯（doc 级活 doc 队列再 flush+detached spool 帧通道两阶段）。
 *  Y0a-2（spec v2.4 §2.3）：退避**无上限**——spool 已保底（BOI），梯子只加速恢复，永不"耗尽"弃守；
 *  前 5 档 [1,2,5,15,30]s，rung≥5 恒 60s 封顶循环（锚 A5：库不补——重试由梯子自身永续承担）。 */
export function persistRetryDelayMs(rung: number): number {
  const table = [1_000, 2_000, 5_000, 15_000, 30_000];
  return rung < table.length ? table[rung] : 60_000;
}

/** X10（Y0a-2）：WS 消息路径禁 mergeUpdates——入队只 push，跨软阈（64 条/1MB）才闩锁 setImmediate
 *  提前 store（跨阈代价=一次整批 store 的 debounce 等待；低于软阈维持库 debounce 批量语义）。
 *  PENDING_MAX_ENTRIES=64 语义由"原地折叠触发点"改为"提前 flush 触发点"（折叠全部移出 WS 路径）。 */
const PENDING_MAX_ENTRIES = 64;
/** 软阈字节档：条数少但字节大（大图/长文本粘贴）同样提前 flush。 */
const FLUSH_SOFT_BYTES = 1_048_576;
/** Y7 硬阈（Y24 内存上界）：只在 store 取批点收口——超阈就地折并（splice 原地、数组身份恒定）。
 *  裁定注记（Y7 gate 裁定）：**不加 inFlight 门**——一切 store 入口（库 debounce/断连/退避梯/drain/
 *  软阈 flush）都经 saveMutex 串行，取批与折并同锁零交织窗；update 监听器在折并 await 窗口内只会
 *  push（X10 禁 merge），I-2 批尾引用锚是唯一竞态兜底。门本身结构性死锁（双败故障期 inFlight 恒置位
 *  ——X2 落定口径——带门的折并永不执行=Y24 上界破约），故直接删除门形态。 */
const COALESCE_MAX_ENTRIES = 512;
const COALESCE_MAX_BYTES = 8 * 1024 * 1024;

/** 批字节累加（软阈判定用——Uint8Array.byteLength 求和） */
const queueBytes = (q: Uint8Array[]): number => q.reduce((s, u) => s + u.byteLength, 0);

/** 库 Document 最小结构面（CollabConnection 同形先例——零 @hocuspocus/server import）：saveMutex=
 *  Serialized 串行锁（A14）；broadcastStateless/connections=persist-status 广播面。 */
export interface PersistenceDocument extends Y.Doc {
  saveMutex: { runExclusive<T>(fn: () => T | Promise<T>): Promise<T> };
  broadcastStateless(payload: string): void;
  connections: Map<{ sendStateless(payload: string): void }, unknown>;
}

/** B1 host 最小接口（W1 设计批准形态）：service 对 gateway 留域语义的唯一反向依赖——bindHost 后置
 *  绑定。logger=共享 gateway Logger 实例（spyLogger 断言面保）；onUpdateDelta=docDelta 转发（Q-B
 *  「update 监听唯一写者」守卫在 gateway 实现）；onFencedByWrite=RC4（fenced→selfIsolate→closeAll→
 *  spool 入账=同 async 流 inline await）；calibrateTruth/observeDocBytes=truth 族单点留 gateway；
 *  三谓词=collabState+shuttingDown 读面；onSpoolRecoveredFlip=P-Q spool 支。isReplaying 位（W1 设计
 *  稿列举）经核无消费方——replaying 读写两点均在本域内闭合，从简（报告披露）。 */
export interface CollabPersistenceHost {
  readonly logger: Logger;
  getDocument(name: string): PersistenceDocument | undefined;
  docStats(): { loadedDocs: number; connections: number; directConns: number };
  onUpdateDelta(pid: string, bytes: number, origin: unknown): void;
  onFencedByWrite(): Promise<void>;
  calibrateTruth(pid: string, bytes: number): number | undefined;
  observeDocBytes(bytes: number): void;
  isIsolated(): boolean;
  isServingState(): boolean;
  isShuttingDownFlag(): boolean;
  onSpoolRecoveredFlip(): void;
  /** T14（plan v11.1①）：当前租约代 epoch 读（接线=CollabLeaseService.currentEpoch——本接口零
   *  @hocuspocus 依赖红线保持）。null=未持有（任何捕获值比对必不等⇒fenced）。消费=flushDocument
   *  提交前校验；捕获点=调用方 claim/会话开始时读同一缝。 */
  currentLeaseEpoch(): bigint | null;
  /** Y1c T12（偏离 27/E23 内部寻址连带）：世代 canonical wire 名解析缝（gateway 实现=DR.liveDocName
   *  转发——#g 换代通道下活 doc 寻址单源）。可选：极简直构测试缺省=折 projectDocName(pid)〔gen0
   *  canonical 等价——存量装置零触碰〕。 */
  docNameOf?(projectId: string): string;
}

/** X7：op 套 deadline——超时返回 fallback（op 自身继续跑，结果被弃）。B1 形态自裁=export 单源
 *  （「双持」候选否=复制漂移面）；消费=本文件 drain 族+gateway 关停步骤 6 lease release。 */
export async function raceDeadline<T>(op: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([op, new Promise<T>((r) => { setTimeout(() => r(fallback), ms).unref?.(); })]);
}

/** ===== T14（plan v11.2 片 S4——v10.1 T6c 载体维持；Z18''④/spec :30 四分叉裁定④+:91 v13b）：
 *  flushDocument 带理由窄接口——交付判定载体（T15 投影 poller 推进唯一凭据；boolean flush 推进
 *  投影水位=No-Go）。窄接口先行裁定：storeDocumentUnlocked 的 boolean 五分支**不动**（判别联合
 *  重构降后续独立硬化卡——本文件是 BOI 契约最密集载体），flushDocument=显式 storeDocumentSerialized
 *  （saveMutex 内）+ 落定后状态判读。 ===== */

/** 交付判定判别式（spec :322-328/:516 G58）：
 *  - persisted：批已落 PG（store true）；或 noop∧isPersistedComplete（三态空=内存与 PG 同步——
 *    交付判定等价：「目标已匹配」复核归调用方 T15，PG canonical 已含本批语义由此承载）。
 *  - retry/spooled：批在 spool（fsync 磁盘安全）——**无限重试不耗 attempts、无 deadline**（G58：
 *    PG 停机>1h 保持 pending 非 failed——「判死磁盘安全帧」=假失败）；告警=本方法 WARN+
 *    collabFlushDocumentOutcomeTotal{retry-spooled} 持续可见。
 *  - retry/failed：批仍滞留内存队列（连 spool 都未落——BOI 归属地=队列）——调用方耗 attempts；
 *    failed 档死判=耗 maxAttempts ∨ spoolDeadline 1h 兜底（行级状态机归 T15 poller——本服务零行级账）。
 *  - terminal/fenced：epoch 易主（提交前校验：会话捕获时 epoch≠当前 CollabLease.epoch——长会话在
 *    租约易主后不得继续落库；v11.1①）或 store 语句级 fenced/进程已隔离——停 claim 等租约
 *    （「停」=调用方语义——claim 归 T15，本接口只判定不建 poller）。
 *  - terminal/fk：项目已删（deletedProjects 终态集——事件路径 or store/梯 FK 发现点登记）→调用方
 *    orphaned（T15）；不重试不死循环（终态集命中即短路，零 PG 触达）。 */
export type FlushOutcome =
  | { kind: 'persisted' }
  | { kind: 'retry'; reason: 'spooled' | 'failed' }
  | { kind: 'terminal'; reason: 'fenced' | 'fk' };

/** failed 档兜底 deadline（spec :30/:91——1h）：耗 maxAttempts **或** 投影行自起算超此时仍 failed
 *  =dead+告警（磁盘安全帧由 retry/spooled 档保护——超时只判 failed 档，G58「spooled 保持 pending」
 *  不受它约束）。归属=T15 poller 行级判定（本常量=接口契约文档载体+T15 消费锚）；T14 单测钉值。 */
export const SPOOL_DEADLINE_MS = 3_600_000;

/** ===== Y0a-2 持久化契约声明（spec v2.4 §2.1，钉死；B1 随域迁本文件）=====
 *  PG=单实例 delta 并集日志（append-only）；CRDT 幂等收敛（重复/乱序 apply 安全）；锁只管 compact；
 *  内存 pending 队列=去抖窗口非持久层；spool 文件=store 故障期唯一权威待落库台账；
 *  onStoreDocument 任何路径不 throw（失败→spool→返回 false；自有 hook 抛错跳链=库锚 A1/A5 前提）。
 *  BOI（契约 §4.3-11）：任何批次任意时刻至少归属于 {doc 队列, spool 已 fsync, PG 已提交} 之一；
 *  离开旧归属必须先进入新归属——queue.splice 永远在新家落定之后。 */
@Injectable()
export class CollabPersistenceService {
  private host!: CollabPersistenceHost;
  /** Y0b-5 T16：PG 熔断器（store 短路——直构缺省自建；gateway 自建路径传同实例防脑裂） */
  private readonly pgBreaker: CollabPgBreakerService;
  /** Y0a-2（V4）：批次第一归属地=权威 Map（projectId 键控）——库 onClose 无条件卸载
   *  会销毁 Document 与一切 WeakMap 键控态；队列改自有 Map 后 doc 消亡≠批消失（P0-3）。
   *  数组身份恒定不变量沿用：一切变更只 push/splice，禁 set 替换。 */
  private readonly pendingQueues = new Map<string, Uint8Array[]>();
  /** doc→projectId 关联（loadDocument 播种；update 回调/stash 检查用）——doc 消亡仅失关联不失批 */
  private readonly docProject = new WeakMap<Y.Doc, string>();
  /** Y11：update 监听注册判定源（原 pendingUpdates.has 的"已注册"语义——V4 拆键后与队列条目解耦） */
  private readonly docListeners = new WeakSet<Y.Doc>();
  /** X10：软阈提前 flush 闩锁（projectId 键）——重复跨阈触发合并为一次 setImmediate（WS 路径
   *  零合并零重复排程；回调内队列空/doc 不在即静默返回，批由退避梯/断连/drain 路径兜底）。 */
  private readonly flushScheduled = new Set<string>();
  /** Y0b-5 T14（E54⑤）：doc 未 flush 窗口起点台账（projectId→epoch ms）——pending 队列空→非空
   *  转变时播种（update 监听单点=唯一 push 位）；排空由 reader 自愈除账（oldestUnflushedAt——
   *  清账点散布在 splice/FK/discard 诸路，结构性兜底胜过逐点补删）。 */
  private readonly pendingSince = new Map<string, number>();
  /** 批3-4：compact 时间门限基线（projectId → 上次 compact 时点；loadDocument 播种） */
  private readonly lastCompactAt = new Map<string, number>();
  /** Y0c T16（Z110）：store append 失败 doc 标记（projectId 键）——库故意不卸载 store 失败 doc
   *  （esm:1540-1549 "Document stays in memory"），reaper 见标记走强制淘汰路径（spool 交接+清会话
   *  条目+unloadDocument 直调）。add=append 失败点单点；delete=store 成功落定+真卸载终态两点。公有=gateway 委托 getter 消费面。 */
  readonly storeFailedDocs = new Set<string>();
  /** 批3-4 persist-status：unhealthy 电平（**归一 bare 键**=projectDocName(pid)——Y1c T12：#g wire
   *  名与裸名解析同 pid，读写两侧归一防键漂移；write=setPersistStatus/pushPersistStatus 入口单点）。公有=gateway authenticateInner 补推判定消费。 */
  readonly persistUnhealthy = new Set<string>();
  /** 批3-4 persist-status：有界退避台账（documentName → rung+timer） */
  private readonly persistRetry = new Map<string, { rung: number; timer: ReturnType<typeof setTimeout> | null }>();
  /** 批3-4 persist-status：已补推连接去重 */
  private readonly persistStatusPushed = new WeakSet<object>();
  /** 审查 I-2：retryPersist 在飞标志改 per-documentName 集合——单布尔在 A 项目在飞窗（跨 saveMutex
   *  等待+append 5s 事务上界）会误罩 B 项目（独立 saveMutex）的三处排程守卫（降级支 spool 失败/
   *  spool 回退 catch/尾部守卫）→ B 批滞留无恢复路径。retryPersist 内层 storeDocument 仍不自排
   *  定时器（梯子推进只归 retryPersist——否则档位取值错档）。 */
  private readonly retryingPersistDocs = new Set<string>();
  /** Y0a-2（契约 14/P5）：in-flight 口径（projectId 键控——与队列归属同键）；维护对见 enterInFlight/leaveInFlight */
  private readonly inFlightProjects = new Set<string>();
  /** Y0a-2（spec §2.5+V10/V11+X1）：项目消失终态集——**永久无界**（spec §9.10；可见地接受：
   *  yjs_deleted_projects gauge，V25——gauge set 在 gateway handleProjectsGone 读 size）。X1：
   *  discardForGoneProject 在**事件处理器内**调用（唯一必然执行点——doc 卸载后 store 拦截分支结构性
   *  不可达，不清则僵尸队列令 computePending 恒>0→drain_complete 永不打印+G-1 barrier 超时）；
   *  storeDocumentUnlocked 首行拦截保留兜底。spool 段收割=FK 双形状（V6）。 */
  readonly deletedProjects = new Set<string>();
  /** 重放抑制：只包裹每个 applyReplayed 的同步段（yjs update 事件在事务清理期同步发放——实测重放行与
   *  pendingDs 延迟整合均在 apply 同步栈内发放、被精确抑制；await 窗口内写入不被抑制、进 pending） */
  private readonly replaying = new WeakSet<Y.Doc>();
  private lastSpoolState: 'ok' | 'spool-unwritable' = 'ok';   // spool 恢复翻转检测（清空并集的 spool 支——谓词非集合，消费点记上一态）
  private spoolReconcilerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    // 显式 @Inject token（esbuild 无 metadata 先例）；@Optional 双尾参真可选——gateway 直构传同实例，Nest 注入单例；pgBreaker 缺省自建=独立实例化自足
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
    @Inject(CollabSpoolService) private readonly spool: CollabSpoolService,
    @Optional() @Inject(EventEmitter2) private readonly eventEmitter?: EventEmitter2,
    @Optional() @Inject(CollabPgBreakerService) pgBreaker?: CollabPgBreakerService,
  ) {
    this.pgBreaker = pgBreaker ?? new CollabPgBreakerService();
  }

  /** host 后置绑定（setLeaseOwner/registerResidentSessionReleaser 同形先例）——业务方法消费前必 bind。 */
  bindHost(host: CollabPersistenceHost): void {
    this.host = host;
  }

  /** Y1c T12：活 doc canonical 名解析（host.docNameOf 缝——gateway 转发 DR.liveDocName；缺省折
   *  裸名=gen0 canonical 等价）。本文件四 flush/直灌寻址点（ensurePersistedOutcome/maintenance/
   *  soft/drainAll）+retryPersist 消费——#g 换代通道下活 doc 恒命中（E23 内部寻址连带）。 */
  private liveName(projectId: string): string {
    return this.host.docNameOf?.(projectId) ?? projectDocName(projectId);
  }

  /** Y1c T12：persist 台账归一 bare 键（#g/裸名同 pid 折 projectDocName——读写两侧键漂移防线）。 */
  private persistKey(documentName: string): string {
    return projectDocName(parseDocName(documentName)?.projectId ?? '');
  }

  /** Y11：队列 get-or-create+update 监听注册（B1 自 loadDocument 内联块提取——set 替换=静默丢批〔V4〕；
   *  数组身份恒定〔只 push/splice〕；注册须在装载第一个 await 之前〔spec v4 不变量 5〕——调用位原时序）。 */
  observeDocument(document: Y.Doc, projectId: string, documentName: string): void {
    this.docProject.set(document, projectId);
    if (!this.pendingQueues.has(projectId)) this.pendingQueues.set(projectId, []);
    if (!this.docListeners.has(document)) {   // 监听防重复注册（update 事件一次）
      this.docListeners.add(document);
      document.on('update', (u: Uint8Array, origin: unknown) => {
        // Y1c T24（spec v5.4⑤ origin 枚举）：doc_update_origin_total{origin} 单点计数（replay 抑制
        // 早退**之前**——load 档=装载/恢复重放事件也计）；仅 server-direct 命中时告警（越 allowlist
        // 的服务端写——节流 1 次/pid/小时防刷屏；load/import/maintenance=合法受控路径零告警）。
        const originKind = classifyDocUpdateOrigin(origin, { replaying: this.replaying.has(document) });
        docUpdateOriginTotal.inc({ origin: originKind });
        if (originKind === 'server-direct') this.warnServerDirectWrite(this.docProject.get(document) ?? '-', u.byteLength);
        if (this.replaying.has(document)) return;
        const pid = this.docProject.get(document)!;
        const q = this.pendingQueues.get(pid);
        if (!q) { this.host.logger.error(`update for untracked doc ${documentName}: dropped`); return; }
        // Y0b-4 T3（Q-B）：delta 触发器累加——host 缝转发（「未建键不计/已清理跳过/SERVER_TRANSACT_
        // ORIGIN 不计〔Z119②〕」守卫逐字随迁 gateway 实现；update 监听唯一写者语义不变）。
        this.host.onUpdateDelta(pid, u.byteLength, origin);
        // Y1c T9（偏离 38① 所有权切换）：connection 帧（gate apply origin）=actor 管线（WAL+PG 归其
        // 单写者）——禁二次入队（双写实锤红①修复）；本队列=维护写独立 append 通道（server-direct/
        // local 档写），soft/disconnect/retry/drain 四直调点 flush。
        if (isGateApplyOrigin(origin)) return;
        if (q.length === 0) this.pendingSince.set(pid, Date.now());   // Y0b-5 T14：空→非空转变=未 flush 窗口起点（唯一 push 位单点播种）
        q.push(u);   // X10：维护写路径只 push（禁合并编码——3000 条积压实测同步折并 4.8s 阻塞消息路径）
        // 软阈跨点（超过 64 条/1MB——严格 >）→ 闩锁 setImmediate 提前 store；维护写 debounce 替代面
        // （onStoreDocument 旧链已拆——小批由 maintenance 短窗承接）
        if (q.length > PENDING_MAX_ENTRIES || queueBytes(q) > FLUSH_SOFT_BYTES) this.scheduleSoftFlush(projectId);
        else this.scheduleMaintenanceFlush(projectId);
      });
    }
  }

  /** Y1c T24：server-direct serving 写告警节流台账（pid→上次告警时间——1 次/小时防刷屏）。 */
  private readonly serverDirectWarnAt = new Map<string, number>();

  /** server-direct 写结构告警（origin 未识别=越 allowlist 的服务端 doc 写——观测面非阻断；
   *  分类细则见 shared doc-update-origin.ts 头注）。 */
  private warnServerDirectWrite(pid: string, bytes: number): void {
    const now = Date.now();
    const last = this.serverDirectWarnAt.get(pid) ?? 0;
    if (now - last < 3_600_000) return;
    this.serverDirectWarnAt.set(pid, now);
    this.host.logger.warn(`doc_update_origin_total{server-direct} serving 写（pid=${pid} bytes=${bytes}）——越 allowlist 的服务端 doc 写（load/replay/maintenance 外路径）`);
  }

  /** 重放抑制窗（B1 自 loadDocument applyReplayed 闭包提取）：只包裹 apply 同步段——update 事件在
   *  事务清理期同步发放被精确抑制；await 窗口内写入不被抑制、进 pending。 */
  withReplaySuppressed(document: Y.Doc, u: Uint8Array): void {
    this.replaying.add(document);
    try { Y.applyUpdate(document, u); } finally { this.replaying.delete(document); }
  }

  /** 批3-4：compact 时间门限基线播种（首次 load 起算 60s 窗——B1 自 loadDocument 播种点提取）。 */
  seedCompactBaseline(projectId: string): void {
    if (!this.lastCompactAt.has(projectId)) this.lastCompactAt.set(projectId, Date.now());
  }

  /** Y0b-4 T3（Q-O 产生侧对齐）：持久化合并单元上限 1MB——贪心切批（顺序累计 ≤上限一组；单个
   *  update 自身超限=独立一组——CRDT 帧结构性不可再分，T4 帧闸后入站上界 2×maxTxBytes 自闭合）。
   *  消费点=store 主路径（PG 行）/降级 spool-first/spool 兜底/卸载交接（spool 帧）——>4MB 病态行
   *  自产生侧结构性不可产生（装载侧照读不拒，Q-O）。 */
  private static readonly PERSIST_MERGE_MAX_BYTES = 1_048_576;
  private splitPersistChunks(parts: Uint8Array[]): Uint8Array[][] {
    const chunks: Uint8Array[][] = [];
    let cur: Uint8Array[] = []; let bytes = 0;
    for (const p of parts) {
      if (cur.length > 0 && bytes + p.byteLength > CollabPersistenceService.PERSIST_MERGE_MAX_BYTES) { chunks.push(cur); cur = []; bytes = 0; }
      cur.push(p); bytes += p.byteLength;
    }
    if (cur.length > 0) chunks.push(cur);
    return chunks;
  }

  /** Y0a-2 BOI 主路径（spec v2.4 §2.3 + V1/V12）：copy-first——merge 不动队列，splice 恒在新家
   *  落定（append r.ok===true 或 spool fsync 成功）之后；任何路径不 throw（契约 3）；
   *  fenced=终态（契约 15）：批走 spool+不排退避梯（selfIsolate 经 host.onFencedByWrite 归 gateway——RC4 inline await）。
   *  **confirm 语义（V1，防 P0-1 蒸发）**：spool 帧只在"内容已被 PG 成功接收"时 confirm（本批 peek 出的
   *  旧帧集合）；失败路径 spool.append 只写**本批**（旧帧不并入——各自独立帧，防 O(n²) 重写放大）；
   *  恢复时一次 append 合并全部未 confirm 帧+PG 已有内容，confirm 旧帧→段回收。
   *  **降级态 spool-first（V12）**：persistUnhealthy 态下批先落 spool（fsync）再试 PG——故障腿窗口
   *  =一个 debounce 窗+fsync（PG 挂起时 append 有 5s 事务上界兜底）；稳态 PG-first 零写放大。
   *  storeInFlight（契约 14/P5，**X2 四落定点**——非 try/finally）：①append ok ②spool fsync
   *  成功（含 V12 降级/交接/force-spool）③FK/终态丢弃 ④project.gone 丢弃；spool 失败回队列**不清**
   *  （批未落定=flush-at-risk）；意外异常兜底 leave=本方法外层 catch（Y2——钩子路径不经 Serialized，
   *  兜底必须在此层）。 */
  async storeDocumentUnlocked(
    { document: _document, documentName }: { document: Y.Doc; documentName: string },
    trigger: CollabStoreTrigger = 'debounce',   // Y0c T0：调用方归因（hooks 直通=debounce；既有白盒直调零参=默认档兼容）
  ): Promise<boolean> {
    const projectId = parseDocName(documentName)?.projectId ?? '';
    if (this.deletedProjects.has(projectId)) return this.discardForGoneProject(projectId);   // V10：显式清账+点名
    const queue = this.pendingQueues.get(projectId);
    if (!queue) {
      this.host.logger.error(`store for unobserved doc ${documentName}: listener never registered`);   // tripwire：!lastSV 同构物不得静默
      return false;
    }
    let storeT0: number | null = null;   // Y0b-5 T10：store 耗时（取批→落定主体段；noop 空转档不计时——readCanvas 空转近 0 样本稀释直方图）
    try {   // Y2：兜底 catch 在此层（钩子直通本方法——Serialized 的 catch 盖不到；spool 失败的正常 return false 不经过这里）
      const stashFrames = await this.peekSpoolFrames(projectId);
      if (queue.length === 0 && stashFrames.length === 0) { yjsStoreDrainTotal.inc({ result: 'noop' }); return false; }
      storeT0 = Date.now();   // noop 早退后起算（真实取批→落定段）
      yjsStoreTotal.inc({ trigger });   // Y0c T0（Z3）：非 noop 落库计数
      // Y7 硬阈（Y24 内存上界）：超过 512 条/8MB 就地折并（splitPersistChunks ≤1MB 贪心分组重排——数组身份恒定）
      if (queue.length > COALESCE_MAX_ENTRIES || queueBytes(queue) > COALESCE_MAX_BYTES) {
        const regrouped = this.splitPersistChunks(queue).map((chunk) => chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk));
        queue.splice(0, queue.length, ...regrouped);
      }
      this.enterInFlight(projectId);                               // enter storeInFlight（projectId 级）
      // —— Y1c T9（偏离 38①）维护写独立 append 通道：merged chunk → maintenanceSink（gateway 接线
      //    =actor.submitMaintenance——WAL 帧 fsync+PG 行+confirm 单写者串行段；stash 旧帧同载〔spool
      //    去重命中=原 walSeq 幂等行〕）。sink reject=WAL 失败（容量/EIO 档）——批留队列+保 inFlight+
      //    排梯（旧 V12 降级 spool-first/spool 兜底两分支由 sink 内在 spool-first 语义收编；连接帧
      //    已不进本队列——actor 管线唯一写者）。——
      const n = queue.length;
      const stashIds = stashFrames.map((f) => f.frameId);          // 吸收旧帧 id（成功支显式 confirm——段回收判据）
      const parts = [...stashFrames.map((f) => f.payload), ...queue.slice(0, n)];
      const tailRef = parts[parts.length - 1];                     // Y8：取批时批尾引用（身份校验锚）
      try {
        for (const chunk of this.splitPersistChunks(parts)) {
          const payload = chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk);
          await this.runMaintenanceChannel(projectId, payload);    // resolve=WAL fsync 落定（PG 行/confirm 归通道内部）
        }
      } catch (e2) {
        // sink 失败分档（旧链终态族语义承继——帧已 WAL 落定者由 spool 未 confirm 帧承载，队列留存
        // 双保险：重发幂等〔spool 去重命中原 walSeq 行〕；未落定前缀同理留队）
        const err = e2 as { fenced?: boolean; leaseRowMissing?: boolean; leaseNotHeld?: boolean; pgPending?: boolean; pgBreakerOpen?: boolean; fk?: boolean };
        if (err.fk || isFkGone(e2)) {
          // V6/T14：FK=项目已删写路径发现点——丢弃+终态集登记（spool 段收割归 replayAll 同判）
          queue.splice(0, n);
          yjsUpdatesDiscardedDeletedTotal.inc({ source: 'gateway' });
          this.leaveInFlight(projectId);
          this.onProjectGone(projectId);
          this.host.logger.warn(`maintenance sink hit FK for ${projectId}——batch discarded (project deleted)`);
          return false;
        }
        // —— post-WAL 族（帧已 fsync 未 confirm）：批出队（新家已落定——旧 spool 兜底 splice 语义）——
        if (err.pgPending || err.fenced || err.leaseNotHeld || err.leaseRowMissing || err.pgBreakerOpen) {
          if (queue.length < n || (n > 0 && queue[n - 1] !== tailRef)) {
            yjsStoreTailAnomalyTotal.inc();
            this.host.logger.error(`store tail anomaly (maintenance post-WAL) for ${documentName}: queue mutated during sink（跳过 splice，批留队重发）`);
          } else {
            queue.splice(0, n);
          }
          this.leaveInFlight(projectId);   // X2 落定点②：WAL fsync 已落定
        }
        if (err.pgPending && !err.fenced && !err.leaseNotHeld && !err.leaseRowMissing) {
          // PG 瞬态（WAL 已落定、帧未 confirm）：Z110 标记+电平+退避梯（PG 回灌由梯/reconciler 承接）
          this.storeFailedDocs.add(projectId);
          this.setPersistStatus(documentName, false);
          if (!this.retryingPersistDocs.has(documentName)) this.schedulePersistRetry(documentName);
          return false;
        }
        if (err.fenced) {
          // fenced=终态禁梯（重试无意义且掩盖失守）；隔离链（RC4——selfIsolate 单点）
          this.host.logger.error(`maintenance sink fenced for ${projectId}（租约失守——不排退避梯）`);
          this.setPersistStatus(documentName, false);
          await this.host.onFencedByWrite();
          return false;
        }
        if (err.leaseNotHeld) {
          // 过渡窗（隔离/释放中 owner=null）：非失守不隔离（V13/I5 旧语义）；帧已 WAL——梯不排（过渡窗无意义）
          this.host.logger.error(JSON.stringify({ event: 'lease_owner_not_set', projectId, note: '过渡窗——帧已 WAL（BOI）不排梯' }));
          this.setPersistStatus(documentName, false);
          return false;
        }
        if (err.leaseRowMissing) {
          // 配置错误重试无用——帧已 WAL 安全（梯不排，修复=补行后重发/回灌）
          collabLeaseRowMissingTotal.inc();
          this.host.logger.error(JSON.stringify({ event: 'lease_row_missing', projectId, note: '帧已 WAL（BOI）；修复=补 CollabLease 行后重发' }));
          this.setPersistStatus(documentName, false);
          return false;
        }
        // —— pre-WAL（spool 写失败）/PG 瞬态：WAL 未落定前缀留队（BOI 归属地不变）+退避梯 ——
        this.host.logger.error(`maintenance sink failed for ${projectId}, batch retained in queue: ${(e2 as Error).message}`);
        this.storeFailedDocs.add(projectId);   // Z110：PG 失败标记（reaper 强制淘汰路径——清点=store 成功/真卸载）
        this.setPersistStatus(documentName, false);
        if (!this.retryingPersistDocs.has(documentName)) this.schedulePersistRetry(documentName);
        return false;                                              // 任何路径不 throw（契约 3）
      }
      // —— 落定成功：splice 旧归属（新家=WAL/PG 已落定）——
      if (queue.length < n || (n > 0 && queue[n - 1] !== tailRef)) {
        yjsStoreTailAnomalyTotal.inc();
        this.host.logger.error(`store tail anomaly (maintenance channel) for ${documentName}: queue mutated during sink（折并交织窗——跳过 splice，批留队重发）`);
      } else {
        queue.splice(0, n);
      }
      this.leaveInFlight(projectId);                               // X2 落定点②：WAL fsync 成功
      this.storeFailedDocs.delete(projectId);
      // 吸收的旧帧（merged 进本批 PG 行——内容已入 PG）显式 confirm：段回收判据=全部帧 confirmed
      // （合并产物帧+旧帧——缺此=旧帧永滞段、下轮 peek 再吸收=写放大循环；actor 只 confirm 本批新帧）
      if (stashIds.length) await this.spool.confirm(projectId, stashIds);
      yjsStoreDrainTotal.inc({ result: 'appended' });
      // E71：store 成功路径 emit（doc 已落 PG——双层失效；监听器自兜底不抛）
      this.eventEmitter?.emit('canvas.doc-saved', { projectId });
      this.cancelPersistRetry(documentName);
      this.cancelMaintenanceFlush(projectId);
      this.setPersistStatus(documentName, true);
      try { await this.maybeCompact(projectId); }
      catch (err) {
        // compact 是优化不是不变量载体：行已落库，失败只 WARN 绝不抛（同旧语义）
        yjsStoreCompactFailureTotal.inc();
        this.host.logger.warn(`compact failed for ${projectId} (rows already durable): ${(err as Error).message}`);
        captureCollabException(err, { docName: documentName, reason: 'compact-failed', connectionId: '-' });
      }
      return true;
    } catch (err) {   // Y2 兜底：意外异常（Y.mergeUpdates 炸/IO 逃逸等）——leave 防漂移+ERROR 留痕；正常失败路径（上文 return false）不经此
      this.leaveInFlight(projectId);
      yjsStoreUnexpectedThrowTotal.inc();   // Y0b-3 T4：兜底命中可观测（原仅 ERROR 日志）
      this.host.logger.error(`store unexpected throw for ${documentName}: ${(err as Error).message}——契约 3 最后一道闸（批保留原归属地）`);
      return false;
    } finally {
      if (storeT0 !== null) yjsStoreDuration.observe((Date.now() - storeT0) / 1000);   // Y0b-5 T10：时长面（成功/失败均计时——noop 空转早退除外）
    }
  }

  /** V10：终态拦截的显式清账——丢弃是对的，静默丢弃不是。Y1：丢弃=归属落定——leaveInFlight
   *  （Set.delete 幂等；事件到达时 store 在飞的窗口由此收口，防已删项目永久占用 storeInFlight）。B3 承接账②：documentName 形参删除（体内零消费——eslint unused 收口；调用点两处同文件内同步）。 */
  private discardForGoneProject(projectId: string): boolean {
    const q = this.pendingQueues.get(projectId);
    const batches = q?.length ?? 0;
    if (q && batches > 0) {
      const bytes = (q ?? []).reduce((s, u) => s + u.byteLength, 0);
      q.splice(0);
      // Task 6 Minor 1：零批=没发生丢弃——不计数不点名（告警面干净）；有批才显式接受
      yjsUpdatesDiscardedDeletedTotal.inc({ source: 'gateway' });
      this.host.logger.warn(JSON.stringify({ event: 'project_gone_discard', projectId, batches, bytes }));
    }
    this.leaveInFlight(projectId);   // Y1：X2 落定点④无条件执行（幂等 delete——事件到达时 store 在飞窗由此收口）
    return false;
  }

  /** 提前 drain 的帧读（IO 错误不阻断主路径——帧留待下次；正常态键集判定零 IO）。公有=loadDocument 回灌消费+façade spy 缝。
   *  T11：随 SpoolFrame 透出 walSeq（purgeBelowSeq 消费面=maybeCompact confirm 授权判据）。 */
  async peekSpoolFrames(projectId: string): Promise<{ frameId: string; payload: Uint8Array; walSeq: bigint }[]> {
    try { return this.spool.hasFrames(projectId) ? await this.spool.peek(projectId) : []; }
    catch (err) {
      this.host.logger.error(`spool peek failed for ${projectId}（帧跳过本次合并，留待下次）: ${(err as Error).message}`);
      return [];
    }
  }

  /** Y0a-2：直调点的串行包装（A14——库已持锁调钩子，钩子路径直通 Unlocked 禁再包）。
   *  Y0c T0：trigger 透传（soft/retry/disconnect/drain 四直调点显式——归因 yjs_store_total）。 */
  storeDocumentSerialized(p: { document: PersistenceDocument; documentName: string }, trigger: CollabStoreTrigger): Promise<boolean> {
    return p.document.saveMutex.runExclusive(() => this.storeDocumentUnlocked(p, trigger));
  }

  /** T14：flushDocument 交付判定窄接口（FlushOutcome 注释=分支语义全谱）。显式 flush 原语=
   *  storeDocumentSerialized（saveMutex 内——**替代 ephemeral-disconnect 当 flush 原语**：disconnect
   *  会卸载 doc、recheck 需重载，spec Z18''④ 裁定）。任何路径不 throw（契约 3 同源——判定载体非
   *  新异步链；调用方=T15 投影 poller/residency 透传面）。序：①epoch 提交前校验（拒绝提交——先于
   *  一切，noop 亦被 fence：交付判定权属当前代）→②终态集短路→③noop 分支显式→④doc 缺席=保磁盘
   *  安全（队列批交接 spool/帧-only 天然 spooled）→⑤显式 store→⑥落定后状态判读（**终态优先于
   *  retry**——fenced/fk 不得被 spool 在盘状态掩盖）。 */
  async flushDocument(projectId: string, capturedEpoch: bigint | null): Promise<FlushOutcome> {
    const outcome = (o: FlushOutcome): FlushOutcome => {
      collabFlushDocumentOutcomeTotal.inc({ outcome: o.kind === 'persisted' ? 'persisted' : o.kind === 'retry' ? `retry-${o.reason}` : `terminal-${o.reason}` });
      if (o.kind === 'retry' && o.reason === 'spooled') this.host.logger.warn(JSON.stringify({ event: 'collab_flush_spooled', projectId, note: '批磁盘安全（spool fsync）——无限重试不耗 attempts；PG 恢复后回灌（G58 告警面）' }));
      return o;
    };
    // ① epoch 提交前校验（v11.1①）：会话捕获时 epoch≠当前代（含当前已失守 null）→拒绝提交。
    //    飞行中夺锁的兜底=语句级 owner 断言（契约 15——store 路径 fenced→onFencedByWrite→⑥ 判读）。
    const currentEpoch = this.host.currentLeaseEpoch();
    if (currentEpoch === null || currentEpoch !== capturedEpoch) {
      this.host.logger.warn(JSON.stringify({ event: 'collab_flush_fenced_epoch', projectId, capturedEpoch: capturedEpoch?.toString() ?? null, currentEpoch: currentEpoch?.toString() ?? null, note: '租约易主/失守——拒绝提交（停 claim 等租约）' }));
      return outcome({ kind: 'terminal', reason: 'fenced' });
    }
    // ② 项目消失终态集（事件路径登记 or store/梯 FK 发现点登记）——不触 store 不重试。
    if (this.deletedProjects.has(projectId)) return outcome({ kind: 'terminal', reason: 'fk' });
    const documentName = this.liveName(projectId);   // Y1c T12：canonical wire 名（#g 换代通道）
    const queueEmpty = !this.hasPendingWrites(projectId);
    // ③ noop 分支显式：无未落库变更（pending 空∧spool 空）∧isPersistedComplete→persisted 等价
    //    （交付判定语义——零 store 触达）；!complete（在飞 store 未落定）不短路——落到⑤（saveMutex
    //    排队=在飞落定的自然 join 点，届时按落定后状态判读）。
    if (queueEmpty && !this.spool.hasFrames(projectId) && this.isPersistedComplete(projectId)) return outcome({ kind: 'persisted' });
    const document = this.host.getDocument(documentName);
    if (!document) {
      // ④ doc 已卸载（reaper/断连窗）：批的 PG 落定归退避梯/下轮 flush（调用方 withSession 会重载）；
      //    本调用只保磁盘安全——队列批交接 spool（既有原语：fsync 落定才 splice，BOI），帧-only 天然 spooled。
      if (!queueEmpty) {
        const handed = await this.handoffPendingToSpool(projectId);
        return outcome(handed ? { kind: 'retry', reason: 'spooled' } : { kind: 'retry', reason: 'failed' });
      }
      return outcome({ kind: 'retry', reason: 'spooled' });   // 帧-only（noop 分支已排除双空）
    }
    // ⑤ 显式 flush 原语（trigger='flush' 归因）——永不 reject（契约 3）。
    const ok = await this.storeDocumentSerialized({ document, documentName }, 'flush');
    if (ok) return outcome({ kind: 'persisted' });
    // ⑥ 落定后状态判读（窄接口先行：boolean 不动，按归属地/终态信号判别）——
    if (this.deletedProjects.has(projectId)) return outcome({ kind: 'terminal', reason: 'fk' });   // store FK 发现点（onProjectGone 登记）
    if (this.host.isIsolated()) return outcome({ kind: 'terminal', reason: 'fenced' });            // fenced-by-write→selfIsolate（RC4 inline await 后同步可见）/进程已隔离
    if (this.spool.hasFrames(projectId)) return outcome({ kind: 'retry', reason: 'spooled' });     // 批在盘（PG 停机窗）——磁盘安全无假失败
    if (this.isPersistedComplete(projectId)) return outcome({ kind: 'persisted' });                // noop 等价（并发 store 已落定/取批点后即本调用 noop 早退窗）
    return outcome({ kind: 'retry', reason: 'failed' });                                          // 批滞留内存队列（连 spool 未落）——耗 attempts 档（兜底=T15 行级 spoolDeadline）
  }

  /** Y1c T9：维护写独立 append 通道 sink（gateway 接线=actor.submitMaintenance——WAL 帧+PG 行+
   *  confirm 的单写者串行段；本服务不再直接 repo.append/spool.append〔PG 腿全部经 sink——新表
   *  行 walSeq/generation 口径由 actor 统一〕）。resolve=WAL fsync 落定（Spooled 档）。 */
  private maintenanceSink: ((projectId: string, payload: Uint8Array) => Promise<unknown>) | null = null;
  setMaintenanceSink(fn: (projectId: string, payload: Uint8Array) => Promise<unknown>): void {
    this.maintenanceSink = fn;
  }

  /** Y1c T26 二轮 R-1①：生命周期观察器 face 注入（gateway 经 setter 传 projectActor.lifecycleObserverFace
   *  ——setMaintenanceSink 先例）——reconcileSpool 的 replayAll 入口（:879 生产在役）两档（adopt 外来段
   *  形/ownPending 裸形）均带 stale 面（stale-ACTIVE 交付逃逸窗收口）；未注入（直构/测试）=null 不带。
   *  Y1c T27 收尾 I-3'（Controller 裁定 (a) 接线）：face 扩 derive+persist 两可选面——reconciler 30s
   *  回灌帙**重派生 lifecycle/义务/fence 行**（boot 预算耗尽残帧/adopt 外来段帙的派生缺档=doc-lag 窗
   *  〔T26 F-1 anchor 点名〕根修；boot 路径 gateway startCollabAfterLease 三回调直连不动）。
   *  并发面=appendBatch 恢复 per-project advisory 锁先行（I-3'）——flush↔reconciler 串行化，第二写者
   *  险有界闭合；缺任一面=stale-only 现行最小正确形态。 */
  private lifecycleObserverFace: {
    staleProjectFencesInTx(tx: import('@prisma/client').Prisma.TransactionClient, projectId: string): Promise<number>;
    /** 派生面（gateway 注入=projectActor.deriveLifecycleFramesForReplay——memo 携带轮界基线）。 */
    deriveLifecycleFramesForReplay?(projectId: string, frames: ReadonlyArray<{ walSeq: bigint; payload: Uint8Array }>, memo: import('./collab-spool.service').ReplayDeriveMemo): Promise<import('./collab-spool.service').ReplayDerivedBatch | ReadonlyArray<{ walSeq: bigint; effects: readonly import('@flowweb/shared').FrameEffect[] }> | null>;
    /** persist 面（observer.persistFramesInTx——重派生行与回灌帙同事务）。 */
    persistFramesInTx?(tx: import('@prisma/client').Prisma.TransactionClient, projectId: string, frames: ReadonlyArray<{ walSeq: bigint; effects: readonly import('@flowweb/shared').FrameEffect[] }>): Promise<unknown>;
  } | null = null;
  setLifecycleObserver(face: {
    staleProjectFencesInTx(tx: import('@prisma/client').Prisma.TransactionClient, projectId: string): Promise<number>;
    deriveLifecycleFramesForReplay?(projectId: string, frames: ReadonlyArray<{ walSeq: bigint; payload: Uint8Array }>, memo: import('./collab-spool.service').ReplayDeriveMemo): Promise<import('./collab-spool.service').ReplayDerivedBatch | ReadonlyArray<{ walSeq: bigint; effects: readonly import('@flowweb/shared').FrameEffect[] }> | null>;
    persistFramesInTx?(tx: import('@prisma/client').Prisma.TransactionClient, projectId: string, frames: ReadonlyArray<{ walSeq: bigint; effects: readonly import('@flowweb/shared').FrameEffect[] }>): Promise<unknown>;
  } | null | undefined): void {
    this.lifecycleObserverFace = face ?? null;
  }

  /** 维护通道统一出口：sink 接线（gateway 生产形态）=actor.submitMaintenance 单写者串行段；未接线
   *  （直构/actor 缺席面）=内置回退——spool.appendTracked（WAL fsync+walSeq）→repo.appendBatch 单帧行
   *  →confirm（与 actor 同序同语义；仅存在于 sink 缺席时，不与 actor 并存=无第二写者面）。 */
  private async runMaintenanceChannel(projectId: string, payload: Uint8Array): Promise<void> {
    if (this.maintenanceSink) {
      await this.maintenanceSink(projectId, payload);
      return;
    }
    const t = await this.spool.appendTracked(projectId, payload);   // WAL-first（BOI：新家先落定）
    // 熔断面②（T16 承继）：open 期 PG 腿首行短路（零 PG 等待）——帧已 WAL 安全未 confirm，
    // throw 交退避梯（half-open 放行=本次即探测）
    if (this.pgBreaker.isOpen()) throw Object.assign(new Error('maintenance pg-breaker open'), { pgBreakerOpen: true, pgPending: true });
    const { CanvasDocUpdateRepository: Repo } = await import('./canvas-doc-update.repository');
    const { createHash } = await import('node:crypto');
    try {
      const r = await this.repo.appendBatch(projectId, [Repo.singleFrameRow({
        generation: this.spool.currentGeneration(projectId),
        walSeq: t.walSeq,
        frameHash: createHash('sha256').update(payload).digest(),
        update: payload,
      })]);
      if (!r.ok) throw Object.assign(new Error('maintenance fallback fenced'), { fenced: true, pgPending: true });
      this.pgBreaker.recordSuccess();
    } catch (err) {
      if (!(err as { pgBreakerOpen?: boolean })?.pgBreakerOpen && !(err as { fenced?: boolean })?.fenced) {
        this.pgBreaker.recordFailure(err);   // PG 健康样本（连接族推闸）
      }
      // PG 段失败（WAL 已落定）——pgPending 信号（leaseRowMissing 亦在此：repo 抛出）
      throw Object.assign(err as Error, { pgPending: true });
    }
    await this.spool.confirm(projectId, [t.frameId]);
  }

  /** 维护写 debounce 替代面（onStoreDocument 旧链拆除后小批承接——250ms 短窗去抖；软阈/断连/
   *  退避梯/drain 四直调点不变）。 */
  private readonly maintenanceFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private scheduleMaintenanceFlush(projectId: string): void {
    if (this.maintenanceFlushTimers.has(projectId)) return;
    const t = setTimeout(() => {
      this.maintenanceFlushTimers.delete(projectId);
      const q = this.pendingQueues.get(projectId);
      if (!q || q.length === 0) return;
      const documentName = this.liveName(projectId);   // Y1c T12：canonical wire 名（#g 换代通道）
      const document = this.host.getDocument(documentName);
      if (!document) return;   // doc 不活——detached 通道（retryPersist）承接
      void this.storeDocumentSerialized({ document, documentName }, 'maintenance').catch(() => {});
    }, 250);
    t.unref?.();
    this.maintenanceFlushTimers.set(projectId, t);
  }
  private cancelMaintenanceFlush(projectId: string): void {
    const t = this.maintenanceFlushTimers.get(projectId);
    if (t) { clearTimeout(t); this.maintenanceFlushTimers.delete(projectId); }
  }

  /** 维护通道强制面（detached 通道消费——统一出口 runMaintenanceChannel：sink/内置回退双形态）。 */
  private async maintenanceSinkOrThrow(projectId: string, payload: Uint8Array): Promise<void> {
    await this.runMaintenanceChannel(projectId, payload);
  }

  /** X10 软阈提前 flush（update 监听器跨 64 条/1MB 时闩锁触发）：setImmediate 出 WS 消息路径——
   *  经 storeDocumentSerialized 与库 debounce/断连同锁串行；doc 已卸载时不触发（批留队列，
   *  断连/退避梯/shutdown drain 兜底）。storeDocumentUnlocked 契约 3 永不 reject（void 即弃）。 */
  private scheduleSoftFlush(projectId: string): void {
    if (this.flushScheduled.has(projectId)) return;
    this.flushScheduled.add(projectId);
    setImmediate(() => {
      this.flushScheduled.delete(projectId);
      const q = this.pendingQueues.get(projectId);
      if (!q || q.length === 0) return;
      const documentName = this.liveName(projectId);   // Y1c T12：canonical wire 名（#g 换代通道）
      const document = this.host.getDocument(documentName);
      if (!document) return;
      void this.storeDocumentSerialized({ document, documentName }, 'soft');   // Y0c T0：软阈提前归因
    });
  }

  /** V22+X2：storeInFlight 维护对（projectId 键控）。enter=Unlocked 取批路径；leave=**四落定点显式调用**
   *  （见 storeDocumentUnlocked 头注释）+Y2 兜底 catch+Y1 rearm/detached——非 try/finally 单点。 */
  private enterInFlight(projectId: string): void {
    this.inFlightProjects.add(projectId);          // Set.add 幂等——重试再进入不双计（P5）
    storeInFlightDocs.set(this.inFlightProjects.size);
  }
  private leaveInFlight(projectId: string): void { // 唯一减点=归属落定/兜底——drain force-spool 复用（契约 14）
    this.inFlightProjects.delete(projectId);
    storeInFlightDocs.set(this.inFlightProjects.size);
  }
  /** Y0a-2（P1+V4 单源派生+Y5 键名）：pending 快照——遍历**自有 pendingQueues**（B2：不依赖库
   *  documents Map，测试与生产同构）；字段 `projects`（按 projectId 计——drain/日志/用例/drill 同名消费）；
   *  G-1/G-2 演练轮询面（/api/metrics collect 回调）+Y0a-3 /api/ready.pending 消费同一实现。
   *  Y0a-3 R3/P16：spoolFiles/spoolBytes=own 口径（部署门）；stranded*=外来段（depth 分区透传——
   *  gauge 侧取 total）。Y0a-4/N16：connections 口径=getConnectionsCount()（勿再加任何分量）——B1 经
   *  host.docStats()（库读面留 gateway）。Y0c T20（Z47）：residentDocs/directConns=**显式分解字段**
   *  （禁混入 connections——常驻会话抬升合计⇒「有用户在线」误读；WS-only 数=connections−directConns）。 */
  computePending(): { projects: number; batches: number; storeInFlight: number; spoolFiles: number; spoolBytes: number; strandedFiles: number; strandedBytes: number; loadedDocs: number; connections: number; residentDocs: number; directConns: number } {
    let projects = 0, batches = 0;
    for (const q of this.pendingQueues.values()) {
      if (q.length > 0) { projects += 1; batches += q.length; }
    }
    const d = this.spool.depth();
    const stats = this.host.docStats();   // B1 host 缝：库四连接计数（residentDocs=loadedDocs 同源）
    return {
      projects, batches, storeInFlight: this.inFlightProjects.size,
      spoolFiles: d.ownFiles, spoolBytes: d.ownBytes, strandedFiles: d.strandedFiles, strandedBytes: d.strandedBytes,
      loadedDocs: stats.loadedDocs,
      connections: stats.connections,
      residentDocs: stats.loadedDocs,
      directConns: stats.directConns,
    };
  }

  /** pendingSince 台账消费单点：自愈漏清（队列已空=窗口已闭→除账——splice/FK/discard 诸清账点外的
   *  结构性兜底）+返回最老未 flush 窗口起点（无= null）。 */
  oldestUnflushedAt(): number | null {
    let oldest: number | null = null;
    for (const [pid, since] of this.pendingSince) {
      if ((this.pendingQueues.get(pid)?.length ?? 0) === 0) { this.pendingSince.delete(pid); continue; }
      if (oldest === null || since < oldest) oldest = since;
    }
    return oldest;
  }

  /** yjs_oldest_unflushed_age_seconds gauge reader——同一台账同一自愈（浮点秒=Prometheus 惯例）。 */
  oldestUnflushedAgeSeconds(): number {
    const oldest = this.oldestUnflushedAt();
    return oldest === null ? 0 : (Date.now() - oldest) / 1000;
  }

  /** 批3-4：compact 时间门限（≥COMPACT_INTERVAL_MS 一档；基线 load 播种、compact 后重置）。
   *  Y0a-1（spec v2.4 §1.3）：仅 compacted===true 开新窗——abandoned 不开窗（窗口仍从上次成功起算，
   *  早已过期⇒下次 store 立即重试）；empty 同不开窗（无行时 attempt=一次 findMany(0)，代价可忽略）。
   *  Y0b-4 T3（Q-B 白名单点②）：成功后真值校准——仅 pending 队列空时采纳（newSnapshot=持久化真值
   *  口径，活 doc 含未 store delta 时非空跳过，留待下一测量点）；truth 族留 gateway=经 host 缝。 */
  async maybeCompact(projectId: string): Promise<void> {
    const last = this.lastCompactAt.get(projectId);
    if (last !== undefined && Date.now() - last < COMPACT_INTERVAL_MS) return;
    const compactT0 = Date.now();   // Y0b-5 T10：compact 耗时（门早退不计时——只测 repo.compact 实跑）
    let r: Awaited<ReturnType<CanvasDocUpdateRepository['compact']>>;
    try {
      r = await this.repo.compact(projectId);
    } finally {
      yjsCompactDuration.observe((Date.now() - compactT0) / 1000);   // 采集挂 finally（家族纪律）：compact throw 的慢尾恰是最该被看见的样本
    }
    if (r.compacted) {
      // Y0b-5 T10 锚②compact 全量编码：snapshotBytes=repo 既有实测编码（零新增）+删除行数/tombstone
      // 字节（repo.compact 契约字段——_count 口径即 compact 次数）
      this.host.observeDocBytes(r.snapshotBytes);
      yjsCompactDeletedRows.observe(r.deletedRows);
      yjsCompactTombstoneBytes.observe(r.tombstoneBytes);
      this.lastCompactAt.set(projectId, Date.now());
      // Y1c T11：WAL 段清理走 spool 现有 confirm/purge 面——purgeBelowSeq 消费（walSeq≤purgeBelowSeq
      // 的未 confirm 帧=内容已证在 PG 前缀〔purgeBelowSeq≤pgSeq 且发布快照即该前缀〕，confirm 授权
      // 段回收；kill 窗残留帧由启动回灌 replayAll 承接——本处零容错语义：peek/confirm 失败仅 WARN，
      // 下次 compact/store 重试）。
      // Q-M6（T11 双评审）断言锚：C1 修复后（计数器 PG 播种+appendBatch tripwire）**新帧 walSeq 恒
      // >doc.pgSeq≥本阈值**——本过滤只应命中「发布前纪」残留帧；新纪帧进 confirm 集=播种面破洞
      // （红组钉锚：collab-persistence.service.spec WAL 段清理用例+canvas-doc-walseq-seeding.int.spec）。
      if (this.spool.hasFrames(projectId)) {
        try {
          const frames = await this.peekSpoolFrames(projectId);
          const consumed = frames.filter((f) => f.walSeq <= r.purgeBelowSeq);
          if (consumed.length > 0) await this.spool.confirm(projectId, consumed.map((f) => f.frameId));
        } catch (err) {
          this.host.logger.warn(`purgeBelowSeq spool confirm failed for ${projectId}（帧留待回灌/重试）: ${(err as Error).message}`);
        }
      }
      if ((this.pendingQueues.get(projectId)?.length ?? 0) === 0) this.host.calibrateTruth(projectId, r.snapshotBytes);
    }
  }

  /** Y0b-2 T3（Z50 修订→Y0c T17 Z104 拆分）：PG 完整性谓词「PG 快照滞后度」三态合一——in-flight
   *  store/pending 队列/spool 帧任一非空 ⇒ 快照可能滞后 ⇒ false；三态全空=内存与 PG 同步。
   *  **doc 常驻（documents.has）不再是滞后信号**（Z104）。消费=readCanvasSnapshotCached 缓存门+vacuum quiesce。 */
  isPersistedComplete(projectId: string): boolean {
    return !this.inFlightProjects.has(projectId)
      && (this.pendingQueues.get(projectId)?.length ?? 0) === 0 && !this.spool.hasFrames(projectId);
  }

  /** Y0c T16（Z141）：reaper 判据读出口①——pending 队列非空（去抖窗批未取走）。 */
  hasPendingWrites(projectId: string): boolean {
    return (this.pendingQueues.get(projectId)?.length ?? 0) > 0;
  }

  /** Y0c T16（Z141）：reaper 判据读出口②——在飞 store（取批未落定；「队列空」≠「批已落定」——
   *  saveMutex 属库内部字段生产不读，可观测面即此集合〔Z149-①〕）。 */
  hasInFlightStore(projectId: string): boolean {
    return this.inFlightProjects.has(projectId);
  }

  /** writesSettled（⓪ thaw 回灌收敛判定——gateway beginVacuumEra 消费）：pending 队列空+spool 无帧+
   *  无在飞 store（不要求卸载——Z104 拆分后与 isPersistedComplete 同一三态口径）。 */
  writesSettled(pid: string): boolean {
    return (this.pendingQueues.get(pid)?.length ?? 0) === 0 && !this.spool.hasFrames(pid)
      && !this.inFlightProjects.has(pid);
  }

  /** V13+X9：受理面判据（**粒度修正：只读降级而非停服**——gateway 保留公有委托位，既有消费面零触碰）。 */
  isWritableOrDegraded(): 'ok' | 'spool-unwritable' {
    return this.spool.isWritable() && !this.spool.overCapacity() ? 'ok' : 'spool-unwritable';
  }

  /** spool 状态判定+恢复翻转检测（清空并集的 spool 支——翻转时经 host.onSpoolRecoveredFlip 清
   *  refusalCache〔P-Q 单点〕；gateway authenticateInner 消费）。 */
  spoolStateForAuth(): 'ok' | 'spool-unwritable' {
    const s = this.isWritableOrDegraded();
    if (this.lastSpoolState === 'spool-unwritable' && s === 'ok') this.host.onSpoolRecoveredFlip();
    this.lastSpoolState = s;
    return s;
  }

  /** 批3-4 persist-status：成功/失败转折点广播（只在电平翻转时发——重试期重复失败不刷屏；
   *  客户端只驱动横幅/诊断，不进 hasUnsavedWork——拦截⇒不断开⇒废掉断开 flush 兜底）。 */
  private setPersistStatus(documentName: string, healthy: boolean) {
    const key = this.persistKey(documentName);   // Y1c T12：归一 bare 键（#g/裸名同 pid）
    if (healthy) {
      if (!this.persistUnhealthy.delete(key)) return;   // 无转折不广播
    } else {
      if (this.persistUnhealthy.has(key)) return;   // 已 unhealthy：重复失败非转折
      this.persistUnhealthy.add(key);
    }
    const document = this.host.getDocument(documentName);
    if (!document) return;   // doc 已卸载：无观察者，只维护电平（重连后补推/下次转折覆盖）
    try {
      document.broadcastStateless(JSON.stringify({ type: 'persist-status', healthy }));
      for (const connection of document.connections.keys()) this.persistStatusPushed.add(connection);
    } catch (err) {
      this.host.logger.warn(`persist-status broadcast failed for ${documentName}: ${(err as Error).message}`);
    }
  }

  /** 批3-4：unhealthy 电平期新连接补推（authenticate 后延迟半秒——连接注册完成的保守窗口）。 */
  pushPersistStatus(documentName: string) {
    if (!this.persistUnhealthy.has(this.persistKey(documentName))) return;
    const document = this.host.getDocument(this.liveName(parseDocName(documentName)?.projectId ?? ''));   // Y1c T12：归一键+canonical 解析
    if (!document) return;
    const payload = JSON.stringify({ type: 'persist-status', healthy: false });
    for (const connection of [...document.connections.keys()]) {
      if (this.persistStatusPushed.has(connection)) continue;
      try { connection.sendStateless(payload); this.persistStatusPushed.add(connection); }
      catch (err) { this.host.logger.warn(`persist-status push failed for ${documentName}: ${(err as Error).message}`); }
    }
  }

  private schedulePersistRetry(documentName: string) {
    if (this.host.isIsolated()) return;   // 必办⑧/I-3：fenced/revoked=终态禁梯——重试无意义且掩盖失守
    // CI 首跑实证（2026-10-08）：关停步骤 1 取消梯子后，drain 内 store 失败（degraded 态跳过 spool 兜底）
    // 的尾部会**重新武装**梯子——进程将退出，重试无意义（批已由 drain_complete/undrained 如实点名，G-2a）；
    // 且关停后连发=日志噪声。关停闸与 isolated 门同判。
    if (this.host.isShuttingDownFlag()) return;
    // Y0a-2（X6）：熔断自检首行——spool 不可写期不排梯（probe 恢复经 onRecovered seam→rearmQueues 唤醒，
    // 否则梯内 store 首行 spool 失败→批留队列但梯空转烧档位）。
    // I-3：限定 ioBroken 才停排——容量态下 PG 腿完全健康可消化帧（confirm 自评解除容量+唤醒 seam）；
    // 容量态也停排会级联 X9 readOnly：无 store 触发→容量永不解除=死锁（梯继续=自愈通道）。
    // （Y0b-5 T16：retryPausedByCircuit 标志随死代码处置删除——只写不读零读者，禁留考古层。）
    if (!this.spool.isWritable() && !this.spool.overCapacity()) return;
    const entry = this.persistRetry.get(documentName) ?? { rung: 0, timer: null };
    if (entry.timer) return;   // 已排程（失败叠加不提前触发）
    entry.timer = setTimeout(() => {   // Y0a-2：耗尽 return 删——退避无上限，rung≥5 恒 60s 封顶重排
      entry.timer = null;
      void this.retryPersist(documentName);
    }, persistRetryDelayMs(entry.rung));
    entry.timer.unref?.();
    this.persistRetry.set(documentName, entry);
  }

  private cancelPersistRetry(documentName: string) {
    const entry = this.persistRetry.get(documentName);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.persistRetry.delete(documentName);
  }

  /** Y0a-2（X5）：无界退避重试双通道——doc 级（活 doc 队列再 flush，经 saveMutex 串行）→
   *  detached 态（doc 不活/队列空）队列通道+spool 帧通道；成功广播 healthy、失败留队续排
   *  （退避无上限——60s 封顶循环永不"耗尽"；下次 load 回灌/启动回灌兜底仍在，R1 拒绝理由
   *  由此自洽：回灌失败项目经退避梯运行期自愈，无需独立后台 timer）。公有=B1 可测性判据（Z24）。 */
  async retryPersist(documentName: string) {
    const entry = this.persistRetry.get(documentName);
    if (!entry) return;
    const projectId = parseDocName(documentName)?.projectId ?? '';
    const document = this.host.getDocument(this.liveName(projectId));   // Y1c T12：canonical 解析（键=调用方原值不动）
    try {
      if (document && (this.pendingQueues.get(this.docProject.get(document) ?? '')?.length ?? 0) > 0) {
        this.retryingPersistDocs.add(documentName);   // 审查 I-2：per-doc 在飞标志（旧单布尔跨项目误罩）
        try {
          // I-1：消费布尔返回——false=批滞留队列/spool，必须 throw 进 catch（rung 推进+退避重排+
          // 电平维持 unhealthy）。旧实现忽略 false → 尾部无条件 cancel+setPersistStatus(true)：
          // 批滞留却广播 healthy+刚排的重试定时器被杀=自断自愈通道。
          const ok = await this.storeDocumentSerialized({ document, documentName }, 'retry');   // doc 级：doc 仍被观察且队列非空（A14——saveMutex 串行）；Y0c T0：退避梯归因
          if (!ok) throw new Error('persist retry failed（批保留——退避梯续排）');
        } finally {
          this.retryingPersistDocs.delete(documentName);
        }
      } else {
        // X5：detached 态（doc 不活/队列空）双通道——先看 gateway 队列（V4 后 doc 卸载队列仍在），
        // 再看 spool 帧；皆空才 cancel。队列通道=spool-first（写 spool 成功即归属落定，帧由后续三段式回灌）。
        const queue = this.pendingQueues.get(projectId);
        if (queue && queue.length > 0) {
          // Y1c T9：detached 队列通道=维护 sink（WAL-first；splice 以身份锚守卫——sink 落定即新家）
          const n = queue.length;
          const tailRef = queue[n - 1];                          // I-2：批尾引用锚（splice 前身份校验）
          for (const chunk of this.splitPersistChunks(queue.slice(0, n))) {
            await this.maintenanceSinkOrThrow(projectId, chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk));
          }
          if (queue.length < n || (n > 0 && queue[n - 1] !== tailRef)) {
            yjsStoreTailAnomalyTotal.inc();
            this.host.logger.error(`detached retry tail anomaly for ${projectId}: queue mutated during sink（折并/并发改写——splice 跳过，批留队列重发）`);
          } else {
            queue.splice(0, n);
          }
          this.leaveInFlight(projectId);
        } else {
          const frames = await this.peekSpoolFrames(projectId);  // 帧通道：sink 重载（spool 去重命中=原 walSeq 幂等行；confirm 归 actor PG 成功面）
          if (frames.length === 0) { this.cancelPersistRetry(documentName); return; }
          for (const f of frames) {
            try {
              await this.maintenanceSinkOrThrow(projectId, f.payload);
            } catch (err) {
              if (isFkGone(err) || (err as { fk?: boolean })?.fk) {   // M3/必办⑨：已删项目帧终态收割（V6——actor FK reject 形态/重抛双判）
                await this.spool.confirm(projectId, [f.frameId]);
                yjsUpdatesDiscardedDeletedTotal.inc({ source: 'spool' });
                this.deletedProjects.add(projectId);
                this.host.logger.warn(`persist retry frames for ${projectId} discarded (project deleted, FK)`);
                continue;
              }
              throw err;   // 重走 catch 退避（帧未 confirm——安全）
            }
          }
        }
      }
      this.cancelPersistRetry(documentName);
      this.setPersistStatus(documentName, true);
    } catch (err) {
      entry.rung += 1;
      // Y0a-2：退避无上限（60s 封顶循环）——"耗尽"分支删除；批的归属地（队列/spool）不变，梯子永续
      //（下次 load 回灌/启动回灌仍为兜底——R1 拒绝理由由此自洽：回灌失败项目经退避梯运行期自愈）
      this.host.logger.error(`persist retry ${entry.rung} failed for ${projectId}: ${(err as Error).message}`);
      this.schedulePersistRetry(documentName);
    }
  }

  /** X5+Y1+Y10：统一唤醒——"每个非空队列恒有恢复路径"单一不变量。Y1：覆盖面=pendingQueues 非空
   *  ∪ spool.keys()（帧-only 滞留面：重启回灌预算耗尽残留/卸载交接后的帧——只遍历队列会漏）；
   *  排程前清 inFlight（rearm 时旧 store 尝试已死——批带着标志滞留会永久抬高 yjs_store_in_flight_docs；
   *  重试 enter 幂等重新置位）。消费=gateway listenCollab/spool.onRecovered seam/startCollabAfterLease。 */
  rearmQueues(): void {
    const ids = new Set<string>([
      ...[...this.pendingQueues.entries()].filter(([, q]) => q.length > 0).map(([pid]) => pid),
      ...this.spool.keys(),
    ]);
    for (const pid of ids) {
      this.leaveInFlight(pid);
      this.schedulePersistRetry(`project:${pid}`);
    }
  }

  /** 关停步骤（B1 提取——onApplicationShutdown「定时器随停——drain 主动接管」点）。
   *  Y1c T9：维护短窗定时器随停族同撤（drain 主动接管——250ms 窗与关停排空竞争=点名噪声）。 */
  cancelAllRetries(): void {
    for (const [name] of [...this.persistRetry]) this.cancelPersistRetry(name);
    for (const [pid] of [...this.maintenanceFlushTimers]) this.cancelMaintenanceFlush(pid);
  }

  startSpoolReconciler(): void {
    if (this.spoolReconcilerTimer) clearInterval(this.spoolReconcilerTimer);   // M2②：clear-first（幂等——rejoin 不泄漏定时器）
    this.spoolReconcilerTimer = setInterval(() => { void this.reconcileSpool().catch(() => {}); }, 30_000);
    this.spoolReconcilerTimer.unref?.();
  }
  /** SV4/Z11+I4：收养静默外来段（boot 后新出现的前任残余）→定向回灌（replayAll{projectIds} 单源）→段回收。
   *  守卫含 own（V10/I4：隔离期落 spool 的自有段无客户端重连时也要有恢复驱动——只看 foreign=own 帧永滞）。
   *  ENOENT 全程容错（P2-2：并发 confirm 先收走）。
   *  契约注记②（锁定增补）：adoptSilentForeignSegments 重建 meta 的 quarantinedRange=null ∧ 坏尾段
   *  goodBytes<bytes ⇒ confirm 判 tailSettled 恒 false=段永不 unlink=磁盘滞留——回灌前先按本 owner 档
   *  隔离坏尾（sidecar 先落盘 V3 语义不变），tailSettled 才可闭合。 */
  private async reconcileSpool(): Promise<void> {
    if (!this.host.isServingState()) return;
    const d = this.spool.depth();   // 廉价守卫（零 IO——depth 走内存 index；无外来段且 own 无段即返）
    if (d.strandedFiles === 0 && d.ownFiles === 0) return;
    const adopted = d.strandedFiles > 0 ? await this.spool.adoptSilentForeignSegments(60_000) : [];
    const ownPending = d.ownFiles > 0;
    if (adopted.length === 0 && !ownPending) return;
    const byProject = [...new Set(adopted.map((s) => s.projectId))];
    for (const p of byProject) await this.spool.quarantineTruncatedFrames(p).catch(() => 0);   // 注记②：坏尾先隔离（adopt 重建的 meta 无 quarantinedRange——不补则段永不回收）
    // Y1c T26 二轮 R-1①：两档（adopt 点名形/ownPending 裸形）均带 lifecycleObserver——回灌帙与
    // 项目级 fence stale 同事务（stale-ACTIVE 交付逃逸窗收口：PG 瞬断 flush 失败→含删帧滞留→
    // 30s 机械重插无 stale 无义务→空闲项目窗持续）。
    // Y1c T27 收尾 I-3'（Controller 裁定 (a) 接线）：face 两面齐备时 derive+persist 随载——回灌帙
    // 重派生 lifecycle/义务/fence（恢复链终态=与首次 apply 等价——doc-lag 窗缺档根修；缺面=stale-only）。
    const face = this.lifecycleObserverFace;
    await this.spool.replayAll(this.repo, {
      ...(byProject.length ? { projectIds: byProject } : {}),
      ...(face ? { lifecycleObserver: face } : {}),
      ...(face?.deriveLifecycleFramesForReplay && face?.persistFramesInTx ? {
        deriveLifecycleFrames: (pid: string, frames: ReadonlyArray<{ walSeq: bigint; payload: Uint8Array }>, memo: import('./collab-spool.service').ReplayDeriveMemo) => face.deriveLifecycleFramesForReplay!(pid, frames, memo),
        lifecyclePersist: (tx: import('@prisma/client').Prisma.TransactionClient, pid: string, frames: ReadonlyArray<{ walSeq: bigint; effects: readonly import('@flowweb/shared').FrameEffect[] }>) => face.persistFramesInTx!(tx, pid, frames),
      } : {}),
    });
    if (ownPending) this.rearmQueues();   // own 段的驱动=退避梯（replayAll 不点名全量——幂等回灌无害）
    this.host.logger.warn(JSON.stringify({ event: 'spool_reconcile_adopted', projects: byProject, segments: adopted.length, ownPending }));
  }

  /** Y0c T16（Z110/Z129）：强制淘汰 spool 交接——pendingQueues[pid] 批交 spool 台账（fsync 落定才
   *  splice，BOI；handoffOnUnload 同款形态复用）。返回 false=交接失败/折并交织窗⇒调用方（residency
   *  reaper，经 gateway 委托位）拒绝淘汰该会话——Z129/Z143「拒绝释放非放弃」，批留队列由退避梯承接。 */
  async handoffPendingToSpool(projectId: string): Promise<boolean> {
    const queue = this.pendingQueues.get(projectId);
    if (!queue || queue.length === 0) return true;
    const n = queue.length;
    const tailRef = queue[n - 1];                              // I-2：批尾引用锚（splice 前身份校验）
    try {
      for (const chunk of this.splitPersistChunks(queue.slice(0, n))) {
        await this.runMaintenanceChannel(projectId, chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk));   // Y1c T9：维护通道（WAL fsync——单写者串行）
      }
    } catch (e2) {
      const err = e2 as { pgPending?: boolean; fk?: boolean };
      // Y1c T9：WAL 已 fsync 而 PG 未落定（帧未 confirm）——磁盘安全=交接成立（旧「spool 可用⇒true」
      // 语义承继；PG 归退避梯）。WAL 未落定 ⇒ 批留队列（BOI 归属地不变）。
      if (!err.pgPending) return false;
      if (err.fk) {   // 项目已删——批终态处置（帧收割归 replayAll 同判）
        queue.splice(0, n);
        this.onProjectGone(projectId);
        yjsUpdatesDiscardedDeletedTotal.inc({ source: 'gateway' });
        return true;
      }
      if (queue.length < n || queue[n - 1] !== tailRef) { yjsStoreTailAnomalyTotal.inc(); return false; }
      queue.splice(0, n);
      return true;
    }
    if (queue.length < n || queue[n - 1] !== tailRef) {
      yjsStoreTailAnomalyTotal.inc();
      return false;                                            // 交织窗——拒淘汰（批留队列重发，CRDT 幂等吸收）
    }
    queue.splice(0, n);                                        // 新家（WAL/PG）已落定——移出旧归属
    return true;
  }

  /** Y0a-2 Task 7（B1 提取——unloadDocument 钩子①②③段；X4 意外异常兜底留 gateway 钩子本体）：
   *  ①cancel 退避梯→②交接（best-effort 落 spool——fsync 落定才 splice，BOI；失败批留队列+③重排梯
   *  保活）。裁定注记：②不进 inFlight（批全程留队列=归属地恒在）；交接成功的 leave 为防御性收口。
   *  残留 spool 帧不触盘处理（V11——失败支由退避梯 detached/drain/启动回灌三路径承接，J4 口径）。 */
  async handoffOnUnload(projectId: string, documentName: string): Promise<void> {
    this.cancelPersistRetry(documentName);                       // ①
    const queue = this.pendingQueues.get(projectId);
    if (queue && queue.length > 0) {
      const n = queue.length;
      const tailRef = queue[n - 1];                              // I-2：批尾引用锚（splice 前身份校验）
      try {
        // Y0b-4 T3（Q-O 产生侧对齐）：交接帧切批 ≤1MB 逐帧 fsync——中途失败余片留队
        // （已落帧与队列双份，CRDT 幂等吸收——catch 支重排梯续发）；全部成功才按整批 splice。
        for (const chunk of this.splitPersistChunks(queue.slice(0, n))) {
          await this.runMaintenanceChannel(projectId, chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk));   // Y1c T9：维护通道（WAL fsync 落定——单写者串行）
        }
        if (queue.length < n || queue[n - 1] !== tailRef) {      // I-2：await 窗口并发取批/折并——跳过 splice
          yjsStoreTailAnomalyTotal.inc();
          this.host.logger.error(`unload handoff tail anomaly for ${documentName}: queue mutated during sink（批留队列重发——CRDT 幂等吸收）`);
        } else {
          queue.splice(0, n);                                    // 新家（WAL/PG）已落定——移出旧归属
        }
        this.leaveInFlight(projectId);                           // X2 落定点②（卸载交接变体）
      } catch (err) {
        yjsUnloadHandoffFailureTotal.inc();
        this.host.logger.error(`unload handoff failed for ${documentName}, batch retained in queue: ${(err as Error).message}`);
        this.schedulePersistRetry(documentName);                 // ③保活梯（①cancel 之后重排——entry.timer 真值）
      }
    }
  }

  /** 关停排空（onApplicationShutdown 消费）：排空窗口只管"仍在 debounce 中"的 store——主力是 drainAllDocuments。 */
  async pollPendingDrained(budgetMs: number): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
      const p = this.computePending();
      if (p.projects === 0 && p.batches === 0) return;   // Y5：projects 键名（v3 此处读 p.docs=改名后恒 undefined）
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** 自管 drain（步骤 4 主力）——X7+Y12：hardDeadline（t0+18s）透传+两级闸（总闸 8s 遍历预算+每 doc
   *  min(2s, remaining) race）；drain 循环内 peekSpoolFrames 套 500ms race（磁盘挂起穿透防护）；
   *  force-spool **每次 append 套 Promise.race 可切断+按返回值判定**（J5：`ids!==null` 才 splice——
   *  race 超时且 append 实际失败时 splice=批蒸发；超时后成功=重复帧由 CRDT 幂等吸收，宁可重复不误删）。
   *  **race 超时分支不 leave**（Y12 修正 X7 注记错误：超时=store 挂起=批未落定=undrained 点名应含它——
   *  leave 会破坏 G-2a ii 的 storeInFlight===projects 断言；仅 catch（意外异常）leave）。
   *  G-2a：归属要么落定、要么被如实点名。
   *  M-1（复审登记，保守方向不修）：force-spool 成功清空后不回打 drain_complete（drain_complete 只在
   *  主循环后判定点打一次）——统一落 shutdown_undrained（batches=0+forcedSpool≥1）；race 超时后迟到的
   *  真成功=spool 重复回灌且 undrained 仍点名——虚报偏保守（宁多点名，不虚报成功）。 */
  async drainAllDocuments(hardDeadline: number): Promise<void> {
    const drainStart = Date.now();
    let enteredDocs = 0;   // Y0c T18（Z114①）：本次 drain 进入处理的 doc 数（自然口径：主循环过空判 continue 后计数——store race 与 detached 直灌两腿均含；8s 总闸未及遍历的不计）
    try {
      for (const [projectId, q] of [...this.pendingQueues]) {      // V4：单源遍历
        if (Date.now() - drainStart > 8_000) break;                // X7：总闸——剩余转 force-spool
        const frames = await raceDeadline(this.peekSpoolFrames(projectId), 500, []);   // 磁盘挂起防护
        if (q.length === 0 && frames.length === 0) continue;
        enteredDocs += 1;
        const name = this.liveName(projectId);   // Y1c T12：canonical wire 名（#g 换代通道）
        const document = this.host.getDocument(name);
        if (!document) {
          await this.drainDetachedProject(projectId, hardDeadline);
          continue;
        }
        const remaining = Math.max(200, Math.min(2_000, hardDeadline - Date.now()));
        try {
          await Promise.race([
            this.storeDocumentSerialized({ document, documentName: name }, 'drain'),   // Y0c T0：关停排空归因
            new Promise<void>((r) => { setTimeout(r, remaining).unref?.(); }),
          ]);   // race 超时=resolve 不进 catch——不 leave（Y12：挂起中批未落定，点名应含）
        } catch (err) {
          this.host.logger.warn(`drain store failed for ${name}: ${(err as Error).message}`);
          this.leaveInFlight(projectId);                           // 仅意外异常 leave（幂等——迟到的真 leave 无双扣）
        }
        if (Date.now() > hardDeadline) break;
      }
      const p = this.computePending();
      if (p.projects === 0 && p.batches === 0) {
        this.host.logger.log(JSON.stringify({ event: 'shutdown_drain_complete', pending: p, spoolResidual: { files: p.spoolFiles, bytes: p.spoolBytes }, storeInFlight: this.inFlightProjects.size }));   // X17：spoolResidual 显式（防误读"全部落 PG"）
        return;
      }
      // force-spool（每次 append 可切断——剩余 hardDeadline 为界；J5 按返回值判定）
      let forced = 0;
      for (const [projectId, q] of [...this.pendingQueues]) {
        if (q.length === 0) continue;
        if (Date.now() > hardDeadline) break;                      // X7：硬切断——点名其余
        const n = q.length;
        const tailRef = q[n - 1];                                  // I-2 终审收口：force-spool 是关停窗内 splice——并发 append 竞速下队列结构可能已变（折并/取批交织），无锚 splice 会误删未落定批（唯一残余蒸发窗）——与队列其余三处 splice 同形补锚
        try {
          // Y0b-4 T3（Q-O）：spool 帧切批 ≤1MB 逐帧 fsync（每帧套剩余预算）——全帧落定才 splice；
          // 中途 race 超时=已落帧与队列双份（J5：后到的成功帧=重复回灌，幂等吸收）。
          let allLanded = true;
          for (const chunk of this.splitPersistChunks(q.slice(0, n))) {   // copy——不动队列
            const payload = chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk);
            const ids = await raceDeadline(this.spool.append(projectId, payload), Math.max(200, hardDeadline - Date.now()), null);
            if (ids === null) { allLanded = false; break; }
          }
          if (allLanded) {
            if (q.length < n || (n > 0 && q[n - 1] !== tailRef)) {   // I-2：await 窗口队列被折并/并发改写（q[n-1] 身份断）——跳过 splice 留队列点名
              yjsStoreTailAnomalyTotal.inc();
              this.host.logger.error(`force-spool tail anomaly for ${projectId}: queue mutated during spool append（折并/并发改写——splice 跳过，批留队列点名）`);
            } else {
              q.splice(0, n);                                        // J5：真写成才 splice（null=race 超时未落定——留队列点名；后到的成功帧=重复回灌，幂等吸收）
              this.leaveInFlight(projectId);
              forced += 1;
            }
          }
        } catch { /* 留队列——点名 */ }
      }
      const p2 = this.computePending();
      this.host.logger.error(JSON.stringify({ event: 'shutdown_undrained', batches: p2.batches, projects: p2.projects, spoolFiles: p2.spoolFiles, spoolBytes: p2.spoolBytes, storeInFlight: this.inFlightProjects.size, forcedSpool: forced }));
    } finally {
      // Y0c T18（Z114①）：drain 两数落档——时长 gauge（单次关停单值，last 即档）+处理 doc 数 counter。
      collabDrainProjectsTotal.inc(enteredDocs);
      collabDrainDurationSeconds.set((Date.now() - drainStart) / 1000);
    }
  }

  /** V4：doc 已卸载但归属仍在——spool 帧三段式直灌（append→confirm，每帧套剩余预算）。归属修正
   *  （B0 标 DocRegistry→B1 实证 Persistence）。I-2（复审）：整腿 deadline 背书——peek 套 500ms race
   *  （磁盘挂起防护，与主循环同口径）；append 套 race min(5s, remaining)——race 超时 r===null→不
   *  confirm→帧保留点名（J5 同哲学；V8 修复后 repo.append 自身 5s 事务上界是第二道）。 */
  private async drainDetachedProject(projectId: string, hardDeadline: number): Promise<void> {
    const frames = await raceDeadline(this.peekSpoolFrames(projectId), 500, []);   // I-2：磁盘挂起防护（与主循环 500ms 同口径）
    for (const f of frames) {
      if (Date.now() > hardDeadline) return;
      const remaining = Math.max(200, Math.min(5_000, hardDeadline - Date.now()));
      try {
        await raceDeadline(this.maintenanceSinkOrThrow(projectId, f.payload), remaining, null);
      } catch { /* 帧保留——点名 */ }
    }
  }

  /** Y0a-2（V10/V11 单点收敛）项目消失终态的 persistence 子步（B1 提取——truth/冻结/代际族清理与关连接
   *  留 gateway）。X1：discardForGoneProject=唯一必然执行点；Z11①：cancel 后保收割梯。V11 禁慢操作随迁：零磁盘 I/O。 */
  onProjectGone(projectId: string): void {
    this.deletedProjects.add(projectId);
    this.cancelPersistRetry(`project:${projectId}`);            // 定时器随清
    if (this.spool.hasFrames(projectId)) this.schedulePersistRetry(`project:${projectId}`);   // Z11①（TD-28 修复：与 :918 cancel 同键——裸 pid 会被 retryPersist 的 parseDocName 折空串→探空即 cancel，收割梯空转退化为启动回灌兜底）
    this.lastCompactAt.delete(projectId);                       // 卸载清理的第二入口（Task 7 钩子为第一入口）
    this.persistUnhealthy.delete(`project:${projectId}`);       // 陈旧电平（重连会补推失效横幅）
    this.discardForGoneProject(projectId);   // X1：显式清队列+点名
    this.recycleEmptyQueue(projectId);                           // M6：空队列条目回收（X17 同款——discard 后空数组条目随清）
  }

  /** vacuum ③ 清进程态的 persistence 子步（purgeDocState 普查表 Persistence 行——writeFreeze/overPush 行留 gateway；空队列回收经 recycleEmptyQueue 原位另调）。 */
  purgePersistenceState(pid: string): void {
    this.lastCompactAt.delete(pid);
    this.persistUnhealthy.delete(`project:${pid}`);
  }

  /** 卸载钩子 finally 的 persistence 子步（④清理残留 M1——连接寿命/awareness 归属清理留 gateway）。 */
  onDocumentUnload(projectId: string, documentName: string): void {
    this.lastCompactAt.delete(projectId);
    this.persistUnhealthy.delete(this.persistKey(documentName));
    this.cancelMaintenanceFlush(projectId);   // Y1c T9：维护短窗随 doc 卸载撤（doc 不活=窗口空转）
  }

  /** 空队列条目回收（三点归并：onProjectGone M6/purgeDocState/unloadDocument finally I-1——
   *  documentName 提供时须库 doc 真已消失才回收：取消卸载窗重连复用 doc 不重跑 loadDocument=条目
   *  不重建，update 命中 !q 丢弃=活编辑静默蒸发窗（X17 与库取消卸载语义的交织）。 */
  recycleEmptyQueue(projectId: string, documentName?: string): void {
    const q = this.pendingQueues.get(projectId);
    if (q && q.length === 0 && (documentName === undefined || !this.host.getDocument(documentName))) this.pendingQueues.delete(projectId);
  }

  /** heap gauge reader（registerHeapObserverReader pendingBytes 数据源：Σ 队列字节，现算零台账）。 */
  pendingBytesTotal(): number {
    return [...this.pendingQueues.values()].reduce((s, q) => s + queueBytes(q), 0);
  }
}
