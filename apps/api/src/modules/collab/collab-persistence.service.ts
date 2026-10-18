// apps/api/src/modules/collab/collab-persistence.service.ts
// Y0c T40（B1）：Persistence 切出——store/spool/drain/pending 的 doc 持久化状态单一所有者（Z24；
// E29 原动机=不启 WS Server 可独立实例化——RC2 验收面=collab-persistence.service.spec 全链用例）。
// 行数锚 ≤950（§0.6 偏离 65）。构造器零 gateway/Server 依赖（显式 @Inject=esbuild 无 metadata 先例）；
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
import { parseDocName } from './doc-name.util';
import { captureCollabException } from '../../utils/sentry-scrub';
import { storeInFlightDocs, collabLeaseRowMissingTotal, collabDrainDurationSeconds, collabDrainProjectsTotal, yjsStoreAppendFailureTotal, yjsStoreCompactFailureTotal, yjsStoreDrainTotal, yjsStoreTailAnomalyTotal, yjsStoreUnexpectedThrowTotal, yjsUnloadHandoffFailureTotal, yjsUpdatesDiscardedDeletedTotal, yjsStorePayloadBytes, yjsStoreDuration, yjsCompactDuration, yjsCompactDeletedRows, yjsCompactTombstoneBytes, yjsStoreTotal, type CollabStoreTrigger } from './store.metrics';

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
}

/** X7：op 套 deadline——超时返回 fallback（op 自身继续跑，结果被弃）。B1 形态自裁=export 单源
 *  （「双持」候选否=复制漂移面）；消费=本文件 drain 族+gateway 关停步骤 6 lease release。 */
export async function raceDeadline<T>(op: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([op, new Promise<T>((r) => { setTimeout(() => r(fallback), ms).unref?.(); })]);
}

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
  /** 批3-4 persist-status：unhealthy 电平（documentName 键）。公有=gateway authenticateInner 补推判定消费。 */
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

  /** Y11：队列 get-or-create+update 监听注册（B1 自 loadDocument 内联块提取——set 替换=静默丢批〔V4〕；
   *  数组身份恒定〔只 push/splice〕；注册须在装载第一个 await 之前〔spec v4 不变量 5〕——调用位原时序）。 */
  observeDocument(document: Y.Doc, projectId: string, documentName: string): void {
    this.docProject.set(document, projectId);
    if (!this.pendingQueues.has(projectId)) this.pendingQueues.set(projectId, []);
    if (!this.docListeners.has(document)) {   // 监听防重复注册（update 事件一次）
      this.docListeners.add(document);
      document.on('update', (u: Uint8Array, origin: unknown) => {
        if (this.replaying.has(document)) return;
        const pid = this.docProject.get(document)!;
        const q = this.pendingQueues.get(pid);
        if (!q) { this.host.logger.error(`update for untracked doc ${documentName}: dropped`); return; }
        // Y0b-4 T3（Q-B）：delta 触发器累加——host 缝转发（「未建键不计/已清理跳过/SERVER_TRANSACT_
        // ORIGIN 不计〔Z119②〕」守卫逐字随迁 gateway 实现；update 监听唯一写者语义不变）。
        this.host.onUpdateDelta(pid, u.byteLength, origin);
        if (q.length === 0) this.pendingSince.set(pid, Date.now());   // Y0b-5 T14：空→非空转变=未 flush 窗口起点（唯一 push 位单点播种）
        q.push(u);   // X10：WS 消息路径只 push（禁合并编码——3000 条积压实测同步折并 4.8s 阻塞消息路径）
        // 软阈跨点（超过 64 条/1MB——严格 >，第 65 条/超 1MB 触发）→ 闩锁 setImmediate 提前 store；硬阈折并在 store 取批点收口（同锁零交织）
        if (q.length > PENDING_MAX_ENTRIES || queueBytes(q) > FLUSH_SOFT_BYTES) this.scheduleSoftFlush(projectId);
      });
    }
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
      const degraded = this.persistUnhealthy.has(documentName);    // V12：降级态
      const stashFrames = await this.peekSpoolFrames(projectId);
      if (queue.length === 0 && stashFrames.length === 0) { yjsStoreDrainTotal.inc({ result: 'noop' }); return false; }
      storeT0 = Date.now();   // noop 早退后起算（真实取批→落定段）
      yjsStoreTotal.inc({ trigger });   // Y0c T0（Z3）：非 noop 落库计数（落库尝试面——Z107 判据 C 锚：单调 ≤⌈编辑窗/maxDebounce⌉+2）
      // Y7 硬阈（Y24 内存上界）：超过 512 条/8MB（严格 >，第 513 条触发）就地折并——splice 原地保数组身份；内容全保留。
      // 无 inFlight 门（裁定见常量块注记）：与取批同锁串行，push-only WS 路径零交织；双败期折并照常
      // 执行=上界收敛（600k 条 → ≤ceil(bytes/1MB) 个合并元素），I-2 批尾锚为唯一竞态兜底。
      // Y0b-4 T3 外审修复（第七处切批缺口）：折并产物=合并产物**可再分**（"CRDT 帧结构性不可再分"
      // 只对原始入站帧成立——T4 帧闸后入站上界 2×maxTxBytes 自闭合）——旧"整批单 merge"会造出
      // ≤8MB 单元素，经 splitPersistChunks"单 update 超限独立成组"不拆 → PG 行/spool 帧可超 1MB
      // （Q-O"超限行结构性不可产生"破约）。改分组落回：splitPersistChunks ≤1MB 贪心分组、逐组合并
      // 一元素；splice 展开原地替换（数组身份恒定不变量不变；Y8/tailRef 语义不变——折并后批尾必是
      // 新元素，交织窗身份判据照常命中 anomaly-skip）。
      if (queue.length > COALESCE_MAX_ENTRIES || queueBytes(queue) > COALESCE_MAX_BYTES) {
        const regrouped = this.splitPersistChunks(queue).map((chunk) => chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk));
        queue.splice(0, queue.length, ...regrouped);
      }
      this.enterInFlight(projectId);                               // enter storeInFlight（projectId 级）
      const stashIds = stashFrames.map((f) => f.frameId);
      // —— 降级态（V12）：本批先落 spool（新家先落定），再连带旧帧试 PG ——
      if (degraded && queue.length > 0) {
        const n0 = queue.length;
        const tailRef0 = queue[n0 - 1];                            // I-2：取批时批尾引用（splice 前身份校验锚）
        try {
          // Y0b-4 T3（Q-O）：spool 帧切批 ≤1MB 逐帧 fsync——中途失败余片留队（已落帧与队列双份，
          // CRDT 幂等吸收——与交织窗同处置）；全部成功才按整批 splice。
          for (const chunk of this.splitPersistChunks(queue.slice(0, n0))) {
            const own = chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk);
            const ids = await this.spool.append(projectId, own);   // fsync 完成才返回（本批安全先落盘）
            stashFrames.push({ frameId: ids[0], payload: own });   // 并入本次 PG 尝试集
            stashIds.push(ids[0]);
          }
          // I-2：splice 前身份判据——await 交织窗折并（合并元素含快照后内容）→ 跳过 splice：
          // 本批已落 spool fsync，队列留双份 CRDT 幂等吸收；leaveInFlight/confirm 记账按落定点②照常。
          if (queue.length < n0 || queue[n0 - 1] !== tailRef0) {
            yjsStoreTailAnomalyTotal.inc();
            this.host.logger.error(`store tail anomaly (V12 spool-first) for ${documentName}: queue mutated during spool append（折并交织窗——跳过 splice，批留队重发）`);
          } else {
            queue.splice(0, n0);                                   // 本批新家=spool 已落定
          }
          this.leaveInFlight(projectId);                           // X2 落定点②：spool fsync 成功（批已安全——后续 PG 尝试是回收不是保命）
        } catch (e2) {
          // M2：降级支 spool 失败与非降级支同形——批留队列+保 inFlight+排重试（同归属态同口径，
          // 不再上抛 Y2 兜底；本支在 append 尝试前，fenced 恒 false）
          this.host.logger.error(`spool append failed for ${projectId}, batch retained in queue: ${(e2 as Error).message}`);
          this.setPersistStatus(documentName, false);
          // T3 残留收口：retryingPersistDocs 在飞（doc 级重试通道）不自排——梯子推进只归 retryPersist catch
          //（审查 I-2：per-doc 集合——A 项目在飞不误罩本项目；缺失只致档位节奏漂移，无数据风险）
          if (!this.retryingPersistDocs.has(documentName)) this.schedulePersistRetry(documentName);
          return false;
        }
      }
      const n = queue.length;
      const parts = [...stashFrames.map((f) => f.payload), ...queue.slice(0, n)];
      const tailRef = parts[parts.length - 1];                     // Y8：取批时批尾引用（身份校验锚——splice 前比较）
      let appended = false; let fenced = false; let rowMissing = false; let notHeld = false;
      // Y0b-4 T3（Q-O）：PG 行切批 ≤1MB 逐片 append（多行）——**全片成功**才走完整成功路径（splice/
      // confirm 按整批，Y8 语义不变）；部分成功=已落片内容幂等在 PG，余片随整批走下方 spool 兜底
      // （重复无害——宁重复不误删）。≤1MB 批（常态）单片直通=与既有单 append 行为零差异。
      const chunks = this.splitPersistChunks(parts);
      // Y0b-5 T16 熔断面②（调用点③ store 短路——retryPausedByCircuit 同族先例的接线形态）：
      // open 期 PG 分支首行短路=零 PG 等待，批经下方 spool 兜底落盘（与「不拒 append」同语义——
      // 数据仍进 spool 契约 BOI）；half-open 放行=本循环即探测，成功→closed+confirm 补排空旧帧。
      const pgBreakerOpen = this.pgBreaker.isOpen();
      for (let ci = 0; !pgBreakerOpen && ci < chunks.length; ci++) {
        const payload = chunks[ci].length === 1 ? chunks[ci][0] : Y.mergeUpdates(chunks[ci]);
        try {
          const r = await this.repo.append(projectId, payload);    // AppendResult（契约 15）+5s 事务上界（V8）
          if (r.ok) { this.pgBreaker.recordSuccess(); yjsStorePayloadBytes.observe(payload.byteLength); if (ci === chunks.length - 1) appended = true; continue; }   // Y0b-5 T10：append 增量逐片 observe（成功路径）+T16 PG 健康样本
          // AppendResult fenced 单失败档（no-row 已删——0 行只可能是 fenced 或 throw，T3 repo 实证）
          fenced = true;
          this.host.logger.error(`append fenced for ${projectId}（租约失守——批走 spool，不排退避梯）`);
          await this.host.onFencedByWrite();   // 必办①：常驻释放先行+closeAll1012+listener 释放+lost{cause} 单点计数（gateway selfIsolate('fenced-by-write')——T17 起 async 释放出口先行；RC4 inline await）
          break;
        } catch (err) {
          if ((err as { leaseRowMissing?: boolean })?.leaseRowMissing) {
            // SV13/W11/I5：配置错误重试无用——但**照常走下方 spool 兜底**（早退=批只留内存，重启即丢=BOI 实质失效）
            rowMissing = true;
            collabLeaseRowMissingTotal.inc();
            this.host.logger.error(JSON.stringify({ event: 'lease_row_missing', projectId, note: '批落 spool（BOI）；修复=补 CollabLease 行后重启回灌' }));
            break;
          }
          if ((err as { leaseNotHeld?: boolean })?.leaseNotHeld) {
            // V13/I5：隔离/释放过渡窗在飞 store 撞 owner=null（P7 throw）——与 fenced 同处置（落 spool+不排梯），
            // 不进通用分支（否则误报 DB 故障+failure 计数污染——日志事件区分）
            notHeld = true;
            this.host.logger.error(JSON.stringify({ event: 'lease_owner_not_set', projectId, note: '隔离/释放过渡窗——批落 spool（BOI）不排梯' }));
            break;
          }
          if (isFkGone(err)) {                                     // V6：FK 判别=isFkGone（pg-error.util 单源——X15）
            queue.splice(0, n);
            yjsUpdatesDiscardedDeletedTotal.inc({ source: 'gateway' });
            this.leaveInFlight(projectId);                         // X2 落定点③：FK/终态丢弃
            this.host.logger.warn(`store append hit FK for ${projectId}——batch discarded (project deleted)`);
            return false;
          }
          this.host.logger.error(`store append failed for ${projectId}, ${parts.length} updates: ${(err as Error).message}`);
          yjsStoreAppendFailureTotal.inc();
          this.storeFailedDocs.add(projectId);   // Y0c T16（Z110）：reaper 强制淘汰标记（清点=store 成功/真卸载）
          this.pgBreaker.recordFailure(err);   // Y0b-5 T16：PG 健康采样（连接族推闸——FK/租约分支=业务/终态不算）
          captureCollabException(err, { docName: documentName, reason: 'store-append-failed', connectionId: '-' });   // T11：store 失败样本（onStoreDocumentPayload 无 socketId——'-'）
          break;
        }
      }
      if (appended) {
        // Y8：splice **前**判据（v3 的 splice 后 queue.length<n 恒真=健康路径刷 anomaly）——
        // await 期间 push 只增不减：length<n ⇒ 有人并发取批（saveMutex 被绕过）；
        // queue[n-1]!==tailRef ⇒ 结构性变更（Y7 coalesce 竞争／I-2 折并交织窗——合并元素含快照后
        // 新更新）→ 跳过 splice：合并元素留队下次 store 重发，CRDT 幂等吸收（已落 PG 部分重复
        // apply 无害——宁可重复不要误删，J5 同哲学）。
        if (queue.length < n || (n > 0 && queue[n - 1] !== tailRef)) {
          yjsStoreTailAnomalyTotal.inc();
          this.host.logger.error(`store tail anomaly for ${documentName}: queue mutated during append（折并交织窗/并发取批——跳过 splice，合并元素留队重发）`);
        } else {
          queue.splice(0, n);                                      // 新家（PG）已落定——移出旧归属
        }
        this.leaveInFlight(projectId);                             // X2 落定点①：append ok
        this.storeFailedDocs.delete(projectId);                    // Y0c T16（Z110）：store 成功落定即撤销强制淘汰标记
        if (stashIds.length) await this.spool.confirm(projectId, stashIds);   // 旧帧内容已入 PG——可回收（契约 12）
        yjsStoreDrainTotal.inc({ result: 'appended' });
        // E71（Y0b-2 T8）：store 成功路径 emit——doc 已落 PG，消费面（video-work process 快照）双层失效。
        //  emit 非 emitAsync（V11 纪律：store 取批点在 saveMutex 内，不等监听器；监听器自兜底不抛）。
        this.eventEmitter?.emit('canvas.doc-saved', { projectId });   // B1：@Optional 可选链（生产 Nest/直构路径恒有实例——语义等价）
        this.cancelPersistRetry(documentName);   // 批3-4：成功即撤销退避定时器
        this.setPersistStatus(documentName, true);
        try { await this.maybeCompact(projectId); }
        catch (err) {
          // compact 是优化不是不变量载体：行已落库，失败只 WARN 绝不抛——否则被库当 store 失败 → doc 永不卸载 → destroy 挂死
          yjsStoreCompactFailureTotal.inc();
          this.host.logger.warn(`compact failed for ${projectId} (rows already durable): ${(err as Error).message}`);
          captureCollabException(err, { docName: documentName, reason: 'compact-failed', connectionId: '-' });   // T11：compact 放弃样本
        }
        return true;
      }
      // append 失败（含 fenced）：批必须入账——spool=唯一真修法（E43②：入账先于一切）。
      // V1：只写"本批"（降级态已提前写过则跳过）——旧帧留在 spool 各自独立，恢复时合并读
      if (!degraded && queue.length > 0) {
        try {
          const n2 = queue.length;
          const tailRef2 = queue[n2 - 1];                          // I-2：快照时批尾引用（splice 前身份校验锚）
          // Y0b-4 T3（Q-O）：spool 帧切批 ≤1MB 逐帧 fsync——中途失败余片留队（已落帧与队列双份，
          // CRDT 幂等吸收）；全部成功才按整批 splice。
          for (const chunk of this.splitPersistChunks(queue.slice(0, n2))) {
            await this.spool.append(projectId, chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk));   // fsync 完成才 resolve；新帧不 confirm（V1）
          }
          // I-2：同款身份判据——折并交织窗跳过 splice（本批已落 spool fsync，队列合并元素留双份，幂等吸收）
          if (queue.length < n2 || queue[n2 - 1] !== tailRef2) {
            yjsStoreTailAnomalyTotal.inc();
            this.host.logger.error(`store tail anomaly (spool fallback) for ${documentName}: queue mutated during spool append（折并交织窗——跳过 splice，批留队重发）`);
          } else {
            queue.splice(0, n2);                                   // 新家（spool）已落定——移出旧归属
          }
          this.leaveInFlight(projectId);                           // X2 落定点②：spool fsync 成功
        } catch (e2) {
          // spool 也失败：队列不动（BOI）——**不清 inFlight 标志**（X2：批未落定=flush-at-risk 口径，契约 14 原文；
          // finally 形态会把 G-2a ii 档清零=自断言红）
          this.host.logger.error(`spool append failed for ${projectId}, batch retained in queue: ${(e2 as Error).message}`);
          this.setPersistStatus(documentName, false);
          // 审查 I-2：retryingPersistDocs 在飞（doc 级重试通道）不自排——梯子推进只归 retryPersist catch
          //（per-doc 集合：A 项目在飞不误罩本项目；此处自排会取错档位+与 catch 重排叠加——守卫为 BASE 先例形态）
          if (!fenced && !rowMissing && !notHeld && !this.retryingPersistDocs.has(documentName)) this.schedulePersistRetry(documentName);
          return false;                                            // 任何路径不 throw（契约 3）——熔断计数在 spool 内
        }
      }
      if (queue.length === 0) this.leaveInFlight(projectId);       // 队列空=批全在 spool（fsync 已完成=契约 14 落定点；帧后续落 PG 归回灌——非 at-risk，J4 注）
      this.setPersistStatus(documentName, false);
      if (!fenced && !rowMissing && !notHeld && !this.retryingPersistDocs.has(documentName)) this.schedulePersistRetry(documentName);        // fenced/rowMissing/notHeld=终态/配置错禁退避梯；审查 I-2：per-doc 在飞不自排（A 项目在飞不误罩本项目；档位推进归 retryPersist catch）
      return false;                                                // 任何路径不 throw（契约 3）
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

  /** 提前 drain 的帧读（IO 错误不阻断主路径——帧留待下次；正常态键集判定零 IO）。公有=loadDocument 回灌消费+façade spy 缝。 */
  async peekSpoolFrames(projectId: string): Promise<{ frameId: string; payload: Uint8Array }[]> {
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
      const documentName = `project:${projectId}`;
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
    if (healthy) {
      if (!this.persistUnhealthy.delete(documentName)) return;   // 无转折不广播
    } else {
      if (this.persistUnhealthy.has(documentName)) return;   // 已 unhealthy：重复失败非转折
      this.persistUnhealthy.add(documentName);
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
    if (!this.persistUnhealthy.has(documentName)) return;
    const document = this.host.getDocument(documentName);
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
    const document = this.host.getDocument(documentName);
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
          const n = queue.length;
          const tailRef = queue[n - 1];                          // I-2：批尾引用锚（unload 交接/store 三处同款——splice 前身份校验）
          // Y0b-4 T3（Q-O）：spool 帧切批 ≤1MB 逐帧 fsync——中途失败余片留队（throw 重走 catch 退避）
          for (const chunk of this.splitPersistChunks(queue.slice(0, n))) {
            await this.spool.append(projectId, chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk));   // 失败 throw 重走 catch 退避（不 cancel——批仍需保活）
          }
          // I-2：await 窗口锁内折并改写前缀（两处锁外 splice 之一——unload 交接同为此列，均 I-2 批尾锚守卫）——身份不符跳过 splice：
          // merged 含未落库新内容留队由梯子重发（CRDT 幂等吸收）；本批已落 spool fsync=归属落定，leave 无条件。
          if (queue.length < n || (n > 0 && queue[n - 1] !== tailRef)) {
            yjsStoreTailAnomalyTotal.inc();
            this.host.logger.error(`detached retry tail anomaly for ${projectId}: queue mutated during spool append（折并/并发改写——splice 跳过，批留队列重发）`);
          } else {
            queue.splice(0, n);                                  // 新家（spool）已落定——移出旧归属
          }
          this.leaveInFlight(projectId);                         // Y1：detached 队列通道落定点②（批可能带着 Unlocked 留下的在飞标志进梯——此处落 spool 即落定）
        } else {
          const frames = await this.peekSpoolFrames(projectId);  // 帧通道=三段式（peek→append→confirm）
          if (frames.length === 0) { this.cancelPersistRetry(documentName); return; }
          for (const f of frames) {
            try {
              const r = await this.repo.append(projectId, f.payload);
              if (!r.ok) throw new Error(`append fenced (${r.reason})`);
              await this.spool.confirm(projectId, [f.frameId]);
            } catch (err) {
              if (isFkGone(err)) {   // M3/必办⑨：已删项目帧无终态出口——与 store 主路径 FK 分支同形（旧实现 throw 卡批=段永滞盘）
                await this.spool.confirm(projectId, [f.frameId]);
                yjsUpdatesDiscardedDeletedTotal.inc({ source: 'spool' });
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

  /** 关停步骤（B1 提取——onApplicationShutdown「定时器随停——drain 主动接管」点）。 */
  cancelAllRetries(): void {
    for (const [name] of [...this.persistRetry]) this.cancelPersistRetry(name);
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
    await this.spool.replayAll(this.repo, byProject.length ? { projectIds: byProject } : undefined);
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
        await this.spool.append(projectId, chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk));   // fsync 落定才 resolve
      }
      if (queue.length < n || queue[n - 1] !== tailRef) {
        yjsStoreTailAnomalyTotal.inc();
        return false;                                          // 交织窗——拒淘汰（批留队列重发，CRDT 幂等吸收）
      }
      queue.splice(0, n);                                      // 新家（spool）已落定——移出旧归属
      return true;
    } catch {
      return false;                                            // spool append 失败——批留队列（BOI 归属地不变）
    }
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
          await this.spool.append(projectId, chunk.length === 1 ? chunk[0] : Y.mergeUpdates(chunk));   // fsync 完成才 resolve——新家落定
        }
        if (queue.length < n || queue[n - 1] !== tailRef) {      // I-2：await 窗口并发取批/折并——跳过 splice
          yjsStoreTailAnomalyTotal.inc();
          this.host.logger.error(`unload handoff tail anomaly for ${documentName}: queue mutated during spool append（批留队列重发——CRDT 幂等吸收）`);
        } else {
          queue.splice(0, n);                                    // 新家（spool）已落定——移出旧归属
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
        const name = `project:${projectId}`;
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
        const r = await raceDeadline(this.repo.append(projectId, f.payload), remaining, null);
        if (r?.ok) await this.spool.confirm(projectId, [f.frameId]);
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
    this.persistUnhealthy.delete(documentName);
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
