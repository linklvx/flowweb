// apps/api/src/modules/collab/collab-residency.service.ts
// Y0c T15（片 A2 常驻化首任务——spec :519 目标形态 1 全文）：会话表+钉住谓词（Z59 机制定案）+读写二分。
//
// 会话表 `projectId→{conn, refCount, idleTimer, state:'held'|'releasing'|'zombie', bytes}`——
// **conn 在⇒directConnectionsCount≥1⇒库 shouldUnloadDocument 恒 false⇒全部 4 条卸载入口
// （store 完成 esm:1550/Skip 分支 esm:1541/WS 关页 esm:1385/direct disconnect esm:1171）静默 no-op**
// （esm:1576 首行守卫）——零 patch 零 fork（Z59：库无任何官方常驻旋钮，持有 DirectConnection 是唯一机制；
// 方案 B=实例覆盖谓词 index.d.ts:227 仅登记不落）。idleTimer 占位（T16 reaper 武装）；bytes 占位 0
// （T16 calibrateTruth 复用填——禁造第二真源）。
//
// withSession 读写二分（Z128）：read=共享会话直接执行（**不 disconnect 不武装 debouncer**——
// 旧 withDoc 读路径每次 disconnect(true)=每次全量编码 store+计数抖动，本服务终结之）；write=会话
// acquire+doc.transact 最外层 SERVER_TRANSACT_ORIGIN（与 withDoc 同款——Z6/Z119：DirectConnection.
// transact 硬编码外层 origin esm:1136-1144+yjs 嵌套 transact 忽略内层，最外层唯一可行点）。
//
// Z83 释放窗口并发协议：应用层 acquire 遇 releasing⇒await 释放完成⇒新开 conn 入表（串行化——防新
// conn 脱离会话表管理）；库层三时点双闭合自证安全（disconnect esm:1145-1174 内部：store await 窗新写
// ⇒:1160 count 检查见新连接跳过卸载；:1160 后到达⇒unloadDocument 首行谓词 no-op；卸载后到达⇒新装载）。
//
// v6 三补：①degraded 阻断常驻（Z111）——装载降级 doc（pendingStructs/pendingDs 非空）不入会话表
// （退化为每次装载+每次告警——整行缺失不可探测，常驻把分钟级盲区拉成小时级）；②releaseSessionFor
// try/finally（Z113①——异常时 conn 引用必清理，上游 #846/#895/#954 泄漏成因）+reconcileSessions
// 周期对账（Z113②——不变量「held 条目 conn.document 在∧directConnectionsCount≥1」，漂移 WARN+计数；
// 周期定时器挂载归 T16——避免与 reaper 时序冲突，本任务先落方法+被调点）；③硬超时 zombie 档（Z109）。
//
// Z109 硬超时：releaseSessionFor disconnect 5s 上界（与 repo.append 事务上界同源——disconnect→store→
// spool fsync 磁盘挂起无界）⇒conn 置 zombie+计数+**懒重建**（不即时重开——下次 acquire 自然新开并替换
// 条目；裁决依据：releaseSessionFor 调用方=释放出口〔vacuum/reaper/drain 释放它正因为不需要它〕，即时
// 重开会重新装载对抗释放目的；spec「直接新开 conn 入表」的实质=不阻塞后续 acquire，acquire 路径的
// zombie→新开分支即达此效）；acquire 遇 releasing 有限等待同一上界，超时即新开——**不变量：同 pid
// acquire 永不因 releasing 无界等待**。
//
// reaper 消费面（spec 应用层协议句）：释放仅对 `refCount===0 ∧ state==='held'` 会话发起（判据上移
// T16）；T17 统一释放入口 tryRelease 消费 releaseSessionFor 原语（releaseSessionFor 生产调用点自此
// 唯一=tryRelease 内部）——三出口（drain/self-isolate/vacuum）+reaper 逐出+Z110 强制淘汰+关停钩子
// 全经 tryRelease 准入；T18 关停步骤 0 releaseAllSessions 同源（预算核算+Σdirect 断言全形态）。
//
// Y0c T16（reaper 武装——本文件 idleTimer/bytes 占位的本任务兑现）：周期 tick（15s 常数）五序
// （Z126② 优先级）：①heap tripped 字节驱逐（Z126①——「拒绝服务换释放资源」）②store 失败强制淘汰
// （Z110：spool 交接 Z129+unloadDocument 直调 Z65 唯一调用点+PG 熔断期跳过 disconnect 面）③双层约束
// （Z106/Z142：字节主约束 384MiB 显式默认+条目 64 近似——永不拒载 Z55）④TTL/degraded 扫描（Z107
// 120s+偏离 24 degraded 提前逐出——idleTimer 即时路径+tick 兜底）⑤reconcileSessions（Z113② 挂载）。
import { Injectable, Inject, Logger, OnModuleInit, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import type * as Y from 'yjs';
import { CollabAuthReason, SERVER_TRANSACT_ORIGIN } from '@flowweb/shared';
import { CollabGateway, isValidDocName } from './collab.gateway';
import {
  collabAcquireWaitTimeoutTotal, collabResidencyReconcileDriftTotal, collabResidencyReleaseInflightTotal,
  collabWriteSessionReleaseTimeoutTotal, consumeDirectLoad, noteDirectLoad, registerResidentReader,
  yjsDocEvictedResidencySeconds, yjsDocEvictedTotal, yjsForceEvictFailureTotal, yjsReleaseBudgetExceededTotal,
  yjsReleaseHandoffFailedTotal, yjsReleaseWithPendingTotal, yjsResidentOverLimitTotal, yjsShutdownDirectLeakTotal,
  yjsWithdocOpenDuration,
} from './store.metrics';

/** 直连类型=库 openDirectConnection 返回实例推导（根导出 DirectConnection 接口无 document 成员——
 *  会话表需要 conn.document 直读；推导形态免 @hocuspocus/server 类型导入=worker 闭包面最小化）。 */
type DirectConn = Awaited<ReturnType<CollabGateway['server']['hocuspocus']['openDirectConnection']>>;

/** 会话状态机（A2 冻结契约：held→releasing→released〔=条目移除〕；zombie=释放挂起超时档）。 */
export type ResidentSessionState = 'held' | 'releasing' | 'zombie';

/** 会话表条目。bytes=docTruth+delta 缓存（reaper tick 刷新——单源 gateway.docBytesOf，禁造第二真源）。 */
export interface ResidentSession {
  conn: DirectConn;
  refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  state: ResidentSessionState;
  bytes: number;
  /** 会话创建时点（Z93 驱逐时驻留时长直方图起算）。 */
  heldSince: number;
  /** refCount 归零时点（TTL 判据+tick 扫描兜底载体——acquire 命中即清除；undefined=在用）。 */
  idleSince?: number;
  /** releasing 档在飞释放 promise（acquire 有限等待/Z83 幂等去重载体；settle 后自清理条目） */
  releasePromise?: Promise<void>;
  /** releasing 档底层 disconnect 真实 settle 信号（成功/抛错/超时后挂起段的最终 settle——
   *  acquire 有限等待接此非 releasePromise：后者在 5s 硬超时即 resolve（Z109 fire-and-forget），
   *  前者才代表「可以安全新开/释放真正了结」。acquire 自有同长上界由此成为可达防御边界）。 */
  releaseSettled?: Promise<void>;
}

/** 释放/acquire 等待共同上界（Z109：与 repo.append 事务上界 5s 同源——append→store→spool fsync
 *  是 disconnect await 链的主体挂起段）。 */
export const RELEASE_TIMEOUT_MS = 5_000;

/** T17 统一释放入口动机（Z129 字面+两特批档）：drain/self-isolate/vacuum/reaper=常规档
 *  （Z141 两前置准入——批在途即拒）；force-evict/shutdown=允许带批档（spool 交接先行）。 */
export type TryReleaseMotive = 'drain' | 'self-isolate' | 'vacuum' | 'reaper' | 'force-evict' | 'shutdown';

/** tryRelease 结果四态（Z129/Z143+T18）：released=已释放（含幂等复调/无条目）/rejected-pending=常规档
 *  Z141 两前置或 refCount 在用拒绝/rejected-handoff=带批档 spool 交接失败拒绝（条目保留 hold）/
 *  budget-exceeded=disconnect 段超逐会话预算（T18——条目留表 zombie 档自延续，非释放完成）。 */
export type TryReleaseOutcome = 'released' | 'rejected-pending' | 'rejected-handoff' | 'budget-exceeded';

// ── Y0c T16 使用点默认值（Z107/Z132/Z142：env 三键 T0 已注册 optional 无 default——默认值落
//    使用点纪律，防双源 P3；构造器直读=census ㉒ 允许面） ──
/** 空闲 TTL 默认 120_000（Z132① 双向定标：下界=AI 作业单段间隔分钟级〔30s 会使 loading→deliver
 *  段间释放重载=常驻化对长作业失效〕；上界=SIGKILL 丢数据窗与常驻 doc 数权衡——A2 实测调）。 */
export const DEFAULT_SESSION_IDLE_TTL_MS = 120_000;
/** 字节主约束默认 384MiB 显式（Z142①——依据=api old-space 同量级；**禁默认关闭**：T0 注册 optional
 *  无 default，若使用点亦无默认=主约束死键而条目反推值反而活着=假门禁形态）。 */
export const DEFAULT_MAX_RESIDENT_BYTES = 402_653_184;
/** 条目次约束默认 64（Z132②——384MiB÷典型 doc p95≈300KB 的 1/20 余量，待实测校准近似〔T22 以
 *  T0.5 实测 p95 字节回填〕；team 并发项目 >64 时=LRU 抖动可接受——病态护栏非容量目标）。 */
export const DEFAULT_MAX_RESIDENT_DOCS = 64;
/** reaper tick 周期（常数不进 env——env 键注册面 T0 已定死三键，新增键=census 红）。 */
export const REAP_TICK_MS = 15_000;

/** T18 关停/隔离全形态释放预算（spec :522）：逐会话 disconnect 段 ≤300ms/总 ≤2s——spool 交接
 *  不计入 300ms（Z143① 计时分离）。 */
export const RELEASE_SESSION_BUDGET_MS = 300;
export const RELEASE_TOTAL_BUDGET_MS = 2_000;

export interface WithSessionOptions {
  mode: 'read' | 'write';
  /** Y0c T20（Z105 spec :526）：即用即释档——acquire 走 Z111 degraded 同款 entry:null 路径（新开
   *  conn 用完即 disconnect，**不入会话表**——releaseAcquire 既有收尾，非第二套开连逻辑）。消费面=
   *  reconcile 5min 周期探针（probeArtifacts→readCanvas）——防 5min 一次把几十个无人项目钉在内存；
   *  REST/作业面读缺省入池（T15 常驻语义不变）。 */
  ephemeral?: boolean;
}

interface Acquired {
  pid: string;
  conn: DirectConn;
  /** null=未入池（Z111 degraded 瞬态——用完即断，旧行为） */
  entry: ResidentSession | null;
}

@Injectable()
export class CollabResidencyService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabResidencyService.name);
  /** 会话表（Z59 钉住谓词载体——conn 在即 doc 恒驻）。单键单条目：Map 结构性保证「会话表无双条目」。 */
  private readonly sessions = new Map<string, ResidentSession>();
  /** 同 pid acquire 串行化链（并发窗防双开——两 acquire 同时未命中/撞 releasing 时排队，后继见前驱成果） */
  private readonly acquireChains = new Map<string, Promise<unknown>>();
  /** T16 三键（构造器一次读入——运行期不再读 env；测试经 (svc as any) 直覆写定标）。 */
  private idleTtlMs: number;
  private maxResidentBytes: number;
  private maxResidentDocs: number;
  private reapTimer: ReturnType<typeof setInterval> | null = null;
  /** tick 重入闸（mass-zombie 期单 tick 可达 N×5s——防周期定时器堆叠）。 */
  private ticking = false;
  /** T18 质量收尾 I-1：预算已点名 pid 集（实例级 latch）——releaseAllSessions 双调路径（Nest DI 反序
   *  钩子 #1+gateway 步骤 0 #2）对已点名 pid 不再等待/计数/计入 released（Z143 三面计数不双烧+
   *  released 不虚高——「留 hold 交兜底」是首次点名时已立的处置决定，复调不翻案）。 */
  private readonly budgetNamedPids = new Set<string>();
  /** T18 质量收尾 M-1：Σdirect 泄漏断言首报 latch（进程关停内只计首报——双调各跑一次断言，
   *  direct_leak 不双烧+双 ERROR 噪音同消）。 */
  private leakAsserted = false;

  constructor(@Inject(CollabGateway) private readonly gateway: CollabGateway) {
    // Y0c T16（Z107/Z132/Z142）：三键构造器直读（census ㉒ 构造器读面），默认值见常量注。
    this.idleTtlMs = Number(process.env.COLLAB_SESSION_IDLE_TTL_MS) || DEFAULT_SESSION_IDLE_TTL_MS;
    this.maxResidentBytes = Number(process.env.COLLAB_MAX_RESIDENT_BYTES) || DEFAULT_MAX_RESIDENT_BYTES;
    this.maxResidentDocs = Number(process.env.COLLAB_MAX_LOADED_DOCS) || DEFAULT_MAX_RESIDENT_DOCS;
    // Z106③ gauge 供数（gateway reader 注册惯例——bytes=Σ held 缓存〔tick 刷新〕/docs=held 条目数
    // 〔Minor-3 口径统一：zombie/releasing 过渡档不计——与 bytes Σheld 对齐，mass-zombie 期不虚高〕）
    registerResidentReader(() => ({ bytes: this.sumHeldBytes(), docs: this.heldSessionCount() }));
    // Y0c T17（Z129）：统一释放入口反向注入 gateway（setVacuumRunner 同款形态——residency→gateway
    // 单向依赖，三出口〔beginDraining/selfIsolate/vacuum quiesce〕经 gateway 转发触达 tryRelease 单点）。
    // pid=null ⇒ 全部常驻会话（drain/隔离出口）；单 pid ⇒ vacuum quiesce 每轮消费。
    // ?.＝mock gateway 直构测试兼容（生产 CollabGateway 恒有该方法）。
    // Y0c T18：shutdown/self-isolate 全量出口路由 releaseAllSessions 全形态（预算+Σdirect 断言）；
    // drain 等常规档维持 T17 逐会话无预算形态（60s 窗退避梯承接——非紧急路径）。
    this.gateway.registerResidentSessionReleaser?.(async (pid, motive) => {
      if (pid === null) {
        if (motive === 'shutdown' || motive === 'self-isolate') return this.releaseAllSessions(motive);
        for (const p of this.residentProjectIds()) {
          try { await this.tryRelease(p, motive); } catch (e) { this.logger.warn(JSON.stringify({ event: 'collab_residency_release_error', pid: p, motive, error: (e as Error).message })); }
        }
        return;
      }
      await this.tryRelease(pid, motive);
    });
    // Y0c T18：residency 条目读面注册（gateway hangReason resident-session-open 档判据——条目非空=
    // 步骤 0 预算/交接拒绝留 hold；?.＝mock gateway 直构测试兼容）。
    this.gateway.registerResidentSessionsProbe?.(() => this.sessions.size);
  }

  /** X9/Y0a-3 R4 写意图受理门（lease 失守/spool 熔断/容量熔断拒——503 瞬态）。
   *  实现单源迁此（T15 起 withSession(write) 内部强制过门；CollabDocumentService.assertWriteAdmitted
   *  一行委托本方法——三写入口/writer 单点语义不变）。 */
  assertWriteAdmitted(): void {
    if (!this.gateway.isLeaseServing() || this.gateway.isWritableOrDegraded() !== 'ok')
      throw new ServiceUnavailableException('collab degraded: lease or spool');
  }

  /** 会话式读写（Z128 读写二分唯一入口——生产面=CollabDocumentService.withSession 透传）。
   *  受理门语义对齐 withDoc：docName 校验+isLeaseServing+isVacuuming；mode:'write' 追加
   *  assertWriteAdmitted（degraded 写门——read 不加，读面本地故障不放大）。 */
  async withSession<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>, opts: WithSessionOptions): Promise<T> {
    if (!isValidDocName(`project:${projectId}`)) {
      throw Object.assign(new Error(`invalid doc name: project:${projectId}`), { reason: CollabAuthReason.INVALID_DOC_NAME });
    }
    if (!this.gateway.isLeaseServing()) throw new ServiceUnavailableException('collab not serving (lease not held)');   // P0-1 三入口③对齐
    if (this.gateway.isVacuuming(projectId)) {
      throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'doc-vacuuming' });   // Y0b-4 T9a 真空窗口 ≤30s——Retry-After 由 filter 附
    }
    if (opts.mode === 'write') this.assertWriteAdmitted();

    const acquired = await this.acquireSerialized(projectId, opts.ephemeral === true);
    try {
      const doc = acquired.conn.document;
      if (!doc) throw new Error('direct connection closed');
      if (opts.mode === 'write') {
        // withDoc 同款最外层 transact（Z6/Z119）：transact 不 await 异步回调——同步 fn 原样在事务内
        // 完成；异步 fn 捕获其 Promise 在事务外 await（readCanvas SV 等待路径同款语义）。
        let result!: T;
        let pending: Promise<void> | undefined;
        doc.transact(() => {
          const r = fn(doc);
          if (r instanceof Promise) pending = r.then((v) => { result = v; });
          else result = r;
        }, SERVER_TRANSACT_ORIGIN);
        if (pending) await pending;
        return result;
      }
      return await fn(doc);   // 读路径：不 transact 不 disconnect 不武装 debouncer（零抖动零重复 store）
    } finally {
      await this.releaseAcquire(acquired);
    }
  }

  /** Z65 不变量消费面（A2 冻结契约名——「!residency.holds(pid) ∧ getConnectionsCount()===0 ⇒
   *  !documents.has(pid)」；held 档即钉住面，zombie/releasing 不算持有）。 */
  holds(projectId: string): boolean {
    return this.sessions.get(projectId)?.state === 'held';
  }

  /** 会话状态读数（观测/测试/健康面——undefined=无条目）。 */
  sessionState(projectId: string): ResidentSessionState | undefined {
    return this.sessions.get(projectId)?.state;
  }

  /** 会话表 pid 快照（Z92 residentDocs 口径供数预备+测试面）。 */
  residentProjectIds(): string[] {
    return [...this.sessions.keys()];
  }

  /** 释放握手原语（A2 冻结契约形状：置 releasing→await disconnect({unloadImmediately:true})→
   *  条目移除；T17 tryRelease 三出口/T18 releaseAllSessions 消费——本任务落基础形态）。
   *  幂等：无条目 no-op；releasing 中复调=返回同一在飞 promise（Z83 去重）；zombie=已有挂起释放
   *  （其自清理延续在飞，复调 no-op）。 */
  async releaseSessionFor(projectId: string): Promise<void> {
    const entry = this.sessions.get(projectId);
    if (!entry) return;
    if (entry.state === 'releasing') return entry.releasePromise;
    if (entry.state === 'zombie') return;
    if (entry.refCount > 0) {
      // M-5 refCount 入口守卫（**仅可见性**——不 return 不改行为）：释放时仍有在飞会话引用=调用方
      // 纪律违规观测（判据「释放仅对 refCount===0∧held 发起」）；常规档调用方纪律已由 T17 tryRelease
      // 统一收口（判据上移——本计数常规稳态 0），现世触达面=shutdown 档豁免强释（I-1）的观测载体。
      this.logger.warn(JSON.stringify({ event: 'collab_residency_release_inflight_refs', pid: projectId, refCount: entry.refCount }));
      collabResidencyReleaseInflightTotal.inc();
    }
    entry.state = 'releasing';
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }   // T16：离开空闲态即撤计时
    entry.releasePromise = this.doRelease(projectId, entry);
    return entry.releasePromise;
  }

  /** 释放主体（Z113① 全路径 try/finally——异常/超时 conn 引用必清理）。 */
  private async doRelease(projectId: string, entry: ResidentSession): Promise<void> {
    const removeIfOwned = () => {
      if (this.sessions.get(projectId) === entry) this.sessions.delete(projectId);   // 身份守卫：条目已被 acquire 超时路径替换时不误删新条目
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = entry.conn.disconnect({ unloadImmediately: true });   // 库 esm:1149 以 true 调 storeDocumentHooks⇒executeNow 兜底 flush——「debouncer 是否在飞」判定权交回库
      entry.releaseSettled = pending.then(() => undefined, () => undefined);   // 真实 settle 信号（acquire 有限等待消费——见字段注）
      const outcome = await Promise.race([
        pending.then(() => 'done' as const),
        new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), RELEASE_TIMEOUT_MS); }),
      ]);
      if (outcome === 'timeout') {
        // Z109③ zombie 档：懒重建（裁决见文件头注——不即时重开，下次 acquire 自然新开并替换条目）；
        // 挂起 disconnect 挂自清理延续（终将 settle——身份守卫防误删替换后的新条目）。
        entry.state = 'zombie';
        collabWriteSessionReleaseTimeoutTotal.inc();
        void pending.then(removeIfOwned, removeIfOwned);
        return;
      }
      removeIfOwned();
    } catch (e) {
      // Z113①：disconnect 抛错⇒conn 引用必清理（上游 #846/#895/#954 泄漏成因——swallow+WARN 非 reject）
      this.logger.warn(JSON.stringify({ event: 'collab_residency_release_error', pid: projectId, error: (e as Error).message }));
      removeIfOwned();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** ===== Y0c T17：统一释放入口 tryRelease（Z129 单点） ===== */

  /** 统一释放入口（Z129——释放动作准入收口，releaseSessionFor 原语唯一生产消费者）：
   *  常规档（drain/self-isolate/vacuum/reaper）两前置（Z141 字面）=pendingQueues 空∧无在飞 store，
   *  违反任一⇒拒绝+重置 idleTimer+计数 release_with_pending（reaper 特有前置 refCount===0∧held
   *  中 refCount 部分对全部档收口于此——M-5 入口守卫由此稳态 0）；带批档（force-evict/shutdown）允许
   *  带批但必先 spool 交接（Z129 给 Z110 直卸路径补的交接义务——先于 disconnect，交接不计入逐会话
   *  预算的计时分离面归 T18），交接失败⇒拒绝**该会话**（条目保留 hold 交 drainAllDocuments 兜底）
   *  +ERROR 点名——非放弃整批（Z143）。 */
  async tryRelease(pid: string, motive: TryReleaseMotive, opts?: { disconnectBudgetMs?: number; handoffBudgetMs?: number }): Promise<TryReleaseOutcome> {
    const entry = this.sessions.get(pid);
    if (!entry) return 'released';   // 无条目=幂等成功
    if (entry.state === 'releasing') {
      const waitMs = opts?.disconnectBudgetMs;
      if (waitMs === undefined) { await entry.releasePromise; return 'released'; }   // Z83 复调=同一在飞释放
      // I-1（T18 质量收尾）：复调等待同受预算约束——生产双调路径（Nest DI 反序钩子 #1+gateway 步骤 0
      // #2）第二次进此分支时预算被无视=await 界滑到 doRelease 5s 硬超时。等待信号=releasePromise
      // （Z83「同一在飞释放」的去重载体，5s 必 resolve 含 zombie 档）非 acquire 的 releaseSettled：
      // 预算问「在飞释放能否预算内完成」非「底层 disconnect 真实了结」——接 releaseSettled 则挂起段
      // 永不出果，竞速必超时=每次复调误报 budget-exceeded。
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        (entry.releasePromise ?? Promise.resolve()).then(() => 'released' as const),
        new Promise<'budget-exceeded'>((r) => { timer = setTimeout(() => r('budget-exceeded'), waitMs); }),
      ]);
      if (timer) clearTimeout(timer);
      return outcome;
    }
    if (entry.state === 'zombie') return 'released';   // 已有挂起释放（自清理延续——复调 no-op）
    if (entry.refCount > 0 && motive !== 'shutdown') {
      // 释放原语纪律「仅对 refCount===0∧held 发起」收口（常规档拒绝——M-5 稳态 0 载体）；在用会话不
      // 武装 idleTimer（refCount 回零时 releaseAcquire 自然武装）。shutdown 档豁免（I-1 终局档：进程
      // 将殁，在飞读同属必终结面——仍强释，否则关停撞在飞读⇒direct conn 残留⇒Z81 destroy_timeout
      // 假 ERROR 复发〔T15 I-3 裁决 a 消声面〕；WARN+release_inflight 计数由 releaseSessionFor
      // M-5 入口守卫承载）。
      yjsReleaseWithPendingTotal.inc({ motive });
      return 'rejected-pending';
    }
    if (motive === 'force-evict' || motive === 'shutdown') {
      if (this.gateway.hasInFlightStore(pid)) {   // 取批在飞窗不交接（splice 竞态——Z141 同源）
        yjsReleaseWithPendingTotal.inc({ motive });
        this.armIdleTimer(pid);
        return 'rejected-pending';
      }
      // I-2（T18 质量收尾）：handoff await 套 race——本段是关停路径唯一未裹预算的 spool.append 调用点
      // （对照 force-spool/drainDetachedProject 全部 raceDeadline 包裹）；首会话 spool fsync 挂起⇒控制
      // 流永不回循环⇒总预算无机会触发⇒步骤 0 整体无限挂（Z109「spool fsync 磁盘挂起无界」原文复现段）。
      // 预算=剩余 totalMs 透传（与 Z143① 计时分离最自洽：交接不占 300ms disconnect 段，但整段墙钟
      // 〔含交接〕受总 2s 约束——挂起交接吃满总窗即按失败处理）。超时与 false 同属「本次窗内交接未落定」
      // 失败一族：同路 rejected-handoff+同计数 release_handoff_failed——处置同一（批留队列交 drain 兜底，
      // 迟到的成功帧=重复回灌幂等吸收，J5 同源），单独 label 扩指标面而无处置差异，不拆。
      let handoffTimedOut = false;
      let handed: boolean;
      const handoffMs = opts?.handoffBudgetMs;
      if (handoffMs === undefined) {
        handed = await this.gateway.handoffPendingToSpool(pid);   // 非预算调用方（reaper force-evict 等）——T17 既有形态
      } else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        handed = await Promise.race([
          this.gateway.handoffPendingToSpool(pid),
          new Promise<false>((r) => { timer = setTimeout(() => { handoffTimedOut = true; r(false); }, handoffMs); }),
        ]);
        if (timer) clearTimeout(timer);
      }
      if (!handed) {
        yjsReleaseHandoffFailedTotal.inc();
        this.logger.error(`release refused (spool handoff ${handoffTimedOut ? 'timeout' : 'failed'}): project:${pid} motive=${motive}——Z129/Z143 拒绝该会话非放弃，批留队列由退避梯/drain 兜底`);
        this.armIdleTimer(pid);
        return 'rejected-handoff';   // 条目保留 hold
      }
      // I-1 重验（T16 质量评审防线——handoff await 窗内并发 acquire 复用防护；spool 批已落定，
      // 条目留表交下轮 tick/关停链）。refCount 部分对 shutdown 档豁免（终局档强释——窗内新 acquire
      // 同属必终结面，仅观测经 releaseSessionFor M-5 守卫 WARN+计数）。
      if (this.sessions.get(pid) !== entry || entry.state !== 'held' || (entry.refCount !== 0 && motive !== 'shutdown')) {
        this.logger.warn(JSON.stringify({ event: 'collab_release_reacquired', pid, motive }));
        yjsReleaseWithPendingTotal.inc({ motive });
        return 'rejected-pending';
      }
    } else if (this.gateway.hasPendingWrites(pid) || this.gateway.hasInFlightStore(pid)) {
      // 常规档两项前置（Z141 字面）——违反任一拒绝+重置空闲计时（TTL 判据再等一轮，Z112 同源）。
      yjsReleaseWithPendingTotal.inc({ motive });
      this.armIdleTimer(pid);
      return 'rejected-pending';
    }
    const budgetMs = opts?.disconnectBudgetMs;
    if (budgetMs === undefined) {
      await this.releaseSessionFor(pid);
      return 'released';
    }
    // Y0c T18（Z143①）：预算只裹 disconnect 段——handoff 已于上文 await 完毕（交接不计入 300ms）。
    // 超预算=停止等待非释放完成：条目留表（releasing——doRelease 5s 档自延续 zombie/懒清理）。
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      this.releaseSessionFor(pid).then(() => 'released' as const),
      new Promise<'budget-exceeded'>((r) => { timer = setTimeout(() => r('budget-exceeded'), budgetMs); }),
    ]);
    if (timer) clearTimeout(timer);
    return outcome;
  }

  /** 同 pid acquire 串行化（并发窗防双开——链尾消费后自清理，Map 不无界增长）。ephemeral 透传
   *  （T20：即用即释读不撞池分支，但仍排队——doc 级开连天然串行语义不变）。 */
  private acquireSerialized(projectId: string, ephemeral = false): Promise<Acquired> {
    const prev = this.acquireChains.get(projectId) ?? Promise.resolve();
    const job = prev.then(() => this.acquire(projectId, ephemeral), () => this.acquire(projectId, ephemeral));
    const tail = job.catch(() => undefined);
    this.acquireChains.set(projectId, tail);
    void tail.finally(() => {
      if (this.acquireChains.get(projectId) === tail) this.acquireChains.delete(projectId);
    });
    return job;
  }

  /** acquire：held 命中=refCount++ 复用（Z59 钉住面零新开）；releasing=有限等待释放完成（超时计数
   *  即新开——Z109 不变量）；zombie/无会话=新开 conn 入表；degraded（Z111）=不入池瞬态；
   *  ephemeral（T20/Z105）=跳过池分支直开+不入表（Z111 同款 entry:null 收尾）。 */
  private async acquire(projectId: string, ephemeral = false): Promise<Acquired> {
    const existing = this.sessions.get(projectId);
    if (!ephemeral && existing && existing.state === 'held' && existing.conn.document) {
      existing.refCount += 1;
      if (existing.idleTimer) { clearTimeout(existing.idleTimer); existing.idleTimer = null; }   // T16：活跃复用即撤销空闲计时
      existing.idleSince = undefined;
      return { pid: projectId, conn: existing.conn, entry: existing };
    }
    if (!ephemeral && existing && existing.state === 'releasing') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // 等待信号=releaseSettled（disconnect 真实 settle）非 releasePromise（其 5s 自超时即 resolve——
      // 接它则 acquire 超时分支永不可达=死计数）。released=释放真正了结（成功/失败/超时后挂起段终局）。
      const settled = existing.releaseSettled ?? existing.releasePromise ?? Promise.resolve();
      const outcome = await Promise.race([
        settled.then(() => 'released' as const),
        new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), RELEASE_TIMEOUT_MS); }),
      ]).finally(() => { if (timer) clearTimeout(timer); });
      if (outcome === 'timeout') {
        collabAcquireWaitTimeoutTotal.inc();   // Z109：等待超时——新开 conn（下方 fresh-open），旧条目由在飞释放自清理（身份守卫）
      }
      // released：条目已移除——fall through 新开
    }
    // fresh open（zombie/无会话/等待后）：直连开窗标记语义与 withDoc 一致（yjs_doc_load_total 归因）
    const openT0 = Date.now();
    noteDirectLoad(projectId);
    const conn = await this.gateway.server.hocuspocus.openDirectConnection(`project:${projectId}`)
      .finally(() => {
        consumeDirectLoad(projectId);   // 装载未触发（doc 常驻/open 失败）清残留；已触发时 loadDocument 已消费（幂等）
        yjsWithdocOpenDuration.observe((Date.now() - openT0) / 1000);   // open 段耗时（含装载段——与 withDoc 同一观测面）
      });
    // Y0c T20（Z105 spec :526）：ephemeral 即用即释——不入会话表（reconcile 5min 探针面防钉住无人
    // 项目；doc 已被池持有时任开第二条 direct 也无害：disconnect 时 count>0 ⇒ 不卸载；store 钩子链
    // 仍触但空批 noop 早退——esm:1145-1174 无条件 storeDocumentHooks(immediately=true)，count 门
    // :1160 只挡卸载尾程不挡 store；应用层 storeDocumentUnlocked 空批 noop〔yjs_store_drain_total{noop}〕）。
    // entry:null=Z111 degraded 同款形态（releaseAcquire finally 即 disconnect）——参数化分支非第二套开连逻辑。
    if (ephemeral) {
      return { pid: projectId, conn, entry: null };
    }
    // Z111 degraded 阻断：不入会话表（本次即用即断=旧行为；整行缺失不可探测面维持每次装载+每次告警）
    if (this.gateway.isDocDegraded(projectId)) {
      this.logger.warn(`residency skip (degraded doc): project:${projectId}——Z111 不入池，本次即用即断`);
      return { pid: projectId, conn, entry: null };
    }
    const entry: ResidentSession = { conn, refCount: 1, idleTimer: null, state: 'held', bytes: 0, heldSince: Date.now() };
    this.sessions.set(projectId, entry);   // 覆盖 zombie/超时残留条目（旧条目身份守卫自清理）
    return { pid: projectId, conn, entry };
  }

  /** withSession finally 释放：入池=refCount--（回零不立即释放——常驻：T16 起记 idleSince+武装
   *  idleTimer〔TTL 后 reapOne〕）；未入池（Z111 degraded 瞬态）=disconnect 即旧行为收尾。 */
  private async releaseAcquire(acquired: Acquired): Promise<void> {
    if (!acquired.entry) {
      await acquired.conn.disconnect({ unloadImmediately: true });
      return;
    }
    if (acquired.entry.refCount > 0) acquired.entry.refCount -= 1;
    if (acquired.entry.refCount === 0 && acquired.entry.state === 'held') {
      acquired.entry.idleSince = Date.now();
      this.armIdleTimer(acquired.pid);
    }
  }

  /** 周期对账（Z113②）：不变量=Σ held 条目各自 conn 持有（conn.document 在∧directConnectionsCount≥1）
   *  ===held 条目数；漂移 WARN+计数。zombie/releasing 档例外豁免——库 disconnect 首步 removeDirectConnection
   *  （esm:1148）先于 await，非 held 档 count 恒 0 属机制内形态非泄漏。周期挂载=T16 reapTick ⑤。 */
  reconcileSessions(): void {
    let drift = 0;
    for (const [pid, entry] of this.sessions) {
      if (entry.state !== 'held') continue;
      const doc = entry.conn.document;
      if (!doc || doc.directConnectionsCount < 1) {
        drift += 1;
        this.logger.warn(JSON.stringify({ event: 'collab_residency_drift', pid, state: entry.state, hasDoc: !!doc }));
      }
    }
    if (drift > 0) collabResidencyReconcileDriftTotal.inc(drift);
  }

  /** ===== Y0c T16：reaper（周期 tick+单会话 idleTimer 即时路径） ===== */

  /** Nest 装配实例周期定时器启动（直构测试不触发——测试直调 reapTick；15s 常数注见 REAP_TICK_MS）。 */
  onModuleInit(): void {
    this.reapTimer = setInterval(() => {
      void this.reapTick().catch((e) => this.logger.warn(`reapTick error: ${(e as Error).message}`));
    }, REAP_TICK_MS);
    this.reapTimer.unref?.();
  }

  /** tick 五序（Z126② 优先级=tripped 高于 TTL）：①heap tripped 字节驱逐 ②store 失败强制淘汰
   *  ③双层约束 ④TTL/degraded 扫描（idleTimer 兜底——timer 丢失/错过时 idleSince 台账仍可逐出）
   *  ⑤reconcileSessions（Z113② 周期挂载义务——T15 遗留）。 */
  async reapTick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.refreshSessionBytes();
      if (this.gateway.isHeapPressureTripped()) await this.evictForHeapPressure();
      await this.forceEvictStoreFailed();
      await this.enforceResidentBudgets();
      await this.scanIdleSessions();
      this.reconcileSessions();
    } finally {
      this.ticking = false;
    }
  }

  /** reaper 通用准入（Z62 三条件+Z83 应用层协议）：held∧refCount===0∧pending 队列空∧无在飞
   *  store（Z141 两前置——「队列空」≠「批已落定」；saveMutex 属库内部字段生产不读，不可观测部分
   *  归库谓词兜底〔Z112/Z149-①〕）。 */
  private isReapable(pid: string, entry: ResidentSession): boolean {
    return entry.state === 'held' && entry.refCount === 0
      && !this.gateway.hasPendingWrites(pid) && !this.gateway.hasInFlightStore(pid);
  }

  /** 候选快照（快照与执行间有 await 窗——pending/inflight 由 evictViaRelease 执行时再验）。 */
  private reapableCandidates(): { pid: string; entry: ResidentSession }[] {
    const out: { pid: string; entry: ResidentSession }[] = [];
    for (const [pid, entry] of this.sessions) {
      if (entry.state === 'held' && entry.refCount === 0) out.push({ pid, entry });
    }
    return out;
  }

  /** 驱逐单条（常规路径——Y0c T17 改道 tryRelease(pid,'reaper')，Z62「释放一律经 releaseSessionFor」
   *  收口为「一律经 tryRelease」）：执行时再验判据（await 交织窗内会话可能被 acquire 复用——
   *  isReapable 的 refCount===0∧held 是 reaper 特有前置）；实卸（条目移除）才计 evicted+驻留时长
   *  （「实卸 M」口径——zombie 档未卸不计）。 */
  private async evictViaRelease(pid: string, reason: 'ttl' | 'lru' | 'degraded' | 'forced'): Promise<void> {
    const entry = this.sessions.get(pid);
    if (!entry || !this.isReapable(pid, entry)) return;
    const outcome = await this.tryRelease(pid, 'reaper');
    if (outcome === 'released' && this.sessions.get(pid) !== entry) {
      yjsDocEvictedTotal.inc({ reason });
      yjsDocEvictedResidencySeconds.observe((Date.now() - entry.heldSince) / 1000);
    }
  }

  /** 武装单会话空闲计时器（releaseAcquire refCount→0 即时路径；TTL 后 reapOne）。 */
  private armIdleTimer(pid: string): void {
    const entry = this.sessions.get(pid);
    if (!entry || entry.state !== 'held') return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => { void this.reapOne(pid); }, this.idleTtlMs);
    entry.idleTimer.unref?.();
  }

  /** 单会话逐出判定（idleTimer 到期/tick 扫描两入口）：三条件不满足⇒**重置计时器不释放**（Z112——
   *  显式检查是防御〔省一次无效 disconnect〕，库谓词是兜底）。 */
  async reapOne(pid: string): Promise<void> {
    const entry = this.sessions.get(pid);
    if (!entry) return;
    entry.idleTimer = null;
    if (!this.isReapable(pid, entry)) {
      this.armIdleTimer(pid);
      return;
    }
    await this.evictViaRelease(pid, 'ttl');
  }

  /** tick ①（Z126①——heap 闸常驻旁路修法）：常驻集内 tripped⇒字节驱逐 reason='forced'——
   *  「拒绝服务换释放资源」（常驻架构下正确的压力响应）。驱逐目标=逐出至 Σbytes 回落字节主约束内
   *  （**字节主序 DESC**——压力期单次驱逐释放最多内存；tie=idleSince 旧者先。不取「全部 idle 逐出」
   *  形态：Σ≤限而 RSS tripped=压力源非 doc 常驻，盲目清池徒损常驻命中）；:881/:1008 冷 doc 拒新
   *  物化判据不动——被驱逐 doc 变冷后自然受该闸。 */
  private async evictForHeapPressure(): Promise<void> {
    const cands = this.reapableCandidates()
      .sort((a, b) => b.entry.bytes - a.entry.bytes || (a.entry.idleSince ?? 0) - (b.entry.idleSince ?? 0));
    let sum = this.sumHeldBytes();
    for (const { pid } of cands) {
      if (sum <= this.maxResidentBytes) break;
      const entry = this.sessions.get(pid);
      if (!entry) continue;
      const freed = entry.bytes;
      await this.evictViaRelease(pid, 'forced');
      if (this.sessions.get(pid) !== entry) sum -= freed;
    }
  }

  /** tick ②（Z110+Z129）：store 失败 doc 强制淘汰——不依赖 disconnect 成功（库 esm:1540-1549 故意
   *  留驻 store 失败 doc，disconnect 的 store 尾程不可依赖）。Y0c T17 改道：spool 交接+I-1 重验+
   *  释放（清会话条目）全段上移 tryRelease(pid,'force-evict') 带批档——本方法保留 storeFailed 特有
   *  前置（PG 熔断期跳过整个 disconnect 面——Z110 放大循环防护）+evicted{forced} 观测+
   *  unloadDocument 直调（Z65 唯一调用点；disconnect 尾程落定后 doc 仍留驻〔store 失败故意留驻〕
   *  即直调真卸载——「不依赖 disconnect 成功」语义由此承载）。 */
  private async forceEvictStoreFailed(): Promise<void> {
    for (const pid of [...this.gateway.storeFailedDocs]) {
      const entry = this.sessions.get(pid);
      if (!entry || entry.state !== 'held' || entry.refCount !== 0) continue;
      if (this.gateway.isPgBreakerOpen()) {
        this.logger.warn(`force evict deferred (pg breaker open): project:${pid}——Z110 熔断期不撞 store，交 heap 闸观测`);
        continue;
      }
      const outcome = await this.tryRelease(pid, 'force-evict');   // 交接+重验+释放（拒绝=批留队列退避梯承接，下轮 tick 重试）
      if (outcome !== 'released') continue;
      // M-5 复验对称（evictViaRelease 同款）：releasing 复调路径返 released（与 drain/self-isolate 在飞
      // 释放并发）时条目可能仍是原条目（zombie 档自清理延续中）——非实卸不计 evicted+不 observe 旧 entry。
      if (this.sessions.get(pid) !== entry) {
        yjsDocEvictedTotal.inc({ reason: 'forced' });
        yjsDocEvictedResidencySeconds.observe((Date.now() - entry.heldSince) / 1000);
      }
      const document = this.gateway.server.hocuspocus.documents.get(`project:${pid}`);   // 释放尾程可能已并发卸载
      if (!document) continue;   // 已不在——条目已清即达淘汰目的
      try {
        await this.gateway.server.hocuspocus.unloadDocument(document);   // 并发卸载由库 unloadingDocuments 去重（esm:1578）
      } catch (e) {
        yjsForceEvictFailureTotal.inc();
        this.logger.warn(`force evict unloadDocument failed: project:${pid}: ${(e as Error).message}——条目已清，doc 卸载交库谓词/disconnect 尾程`);
      }
    }
  }

  /** tick ③（Z106/Z142 双层约束）：字节主约束（挡触顶病态 doc——正常 doc 72-366KB 无威胁）+条目
   *  次约束（防 map 失控）。超限=临时超过+WARN+over_limit 计数——**永不拒载**（Z55：拒载归 Y1c-3
   *  准入）。回收=LRU：字节约束=字节主序 DESC（同 tick ① 键）；条目约束=最旧空闲先（Z55「回收最旧
   *  空闲非拒载」——idleSince 升序）。 */
  private async enforceResidentBudgets(): Promise<void> {
    const sum = this.sumHeldBytes();
    if (sum > this.maxResidentBytes) {
      yjsResidentOverLimitTotal.inc();
      this.logger.warn(JSON.stringify({ event: 'collab_resident_over_limit', kind: 'bytes', sum, limit: this.maxResidentBytes }));
      const cands = this.reapableCandidates()
        .sort((a, b) => b.entry.bytes - a.entry.bytes || (a.entry.idleSince ?? 0) - (b.entry.idleSince ?? 0));
      let remaining = sum;
      for (const { pid } of cands) {
        if (remaining <= this.maxResidentBytes) break;
        const entry = this.sessions.get(pid);
        if (!entry) continue;
        const freed = entry.bytes;
        await this.evictViaRelease(pid, 'lru');
        if (this.sessions.get(pid) !== entry) remaining -= freed;
      }
    }
    const docs = this.heldSessionCount();   // Minor-3：held 计数（旧 sessions.size 含 releasing/zombie——mass-zombie 期虚高驱动空 WARN+对 held idle 条目无效驱逐循环）
    if (docs > this.maxResidentDocs) {
      yjsResidentOverLimitTotal.inc();
      this.logger.warn(JSON.stringify({ event: 'collab_resident_over_limit', kind: 'docs', size: docs, limit: this.maxResidentDocs }));
      const cands = this.reapableCandidates()
        .sort((a, b) => (a.entry.idleSince ?? Infinity) - (b.entry.idleSince ?? Infinity));
      for (const { pid } of cands) {
        if (this.heldSessionCount() <= this.maxResidentDocs) break;
        await this.evictViaRelease(pid, 'lru');
      }
    }
  }

  /** tick ④：TTL/degraded 扫描（idleTimer 即时路径的兜底——timer 丢失/错过时 idleSince 台账仍可
   *  逐出）。degraded（偏离 24）：运行期退化（装载后 pendingStructs/pendingDs 转非空——Z111 只挡
   *  装载时入池）的 held 会话**不等 TTL** 即逐出——恢复「每装一警」可观测性，下次装载走 Z111 瞬态
   *  路径；频次=装载质量信号（诊断价值高于并入 'ttl'）。 */
  private async scanIdleSessions(): Promise<void> {
    const now = Date.now();
    for (const [pid, entry] of [...this.sessions]) {
      if (entry.state !== 'held' || entry.refCount !== 0) continue;
      if (this.gateway.isDocDegraded(pid)) {
        await this.evictViaRelease(pid, 'degraded');
        continue;
      }
      if (entry.idleSince !== undefined && now - entry.idleSince >= this.idleTtlMs) await this.reapOne(pid);
    }
  }

  /** 会话 bytes 缓存刷新（tick 供数/判据前——单源 gateway.docBytesOf(truth+delta)，禁造第二真源）。 */
  private refreshSessionBytes(): void {
    for (const [pid, entry] of this.sessions) {
      if (entry.state === 'held') entry.bytes = this.gateway.docBytesOf(pid);
    }
  }

  /** Σ held 条目 bytes（zombie/releasing 过渡档不计——自清理延续中）。 */
  private sumHeldBytes(): number {
    let sum = 0;
    for (const e of this.sessions.values()) if (e.state === 'held') sum += e.bytes;
    return sum;
  }

  /** held 条目数（Minor-3 口径统一——docs gauge 供数+条目次约束判据同源；与 sumHeldBytes
   *  过滤口径对齐：zombie/releasing 过渡档不计，mass-zombie 期不虚高）。 */
  private heldSessionCount(): number {
    let n = 0;
    for (const e of this.sessions.values()) if (e.state === 'held') n += 1;
    return n;
  }

  /** ===== Y0c T18：关停步骤 0 全形态（Z38/Z81 硬前置+Z143 双计数+Σdirect===0 断言——整体替换
   *  T15 最小关停钩子） ===== */

  /** 全形态批量释放（gateway 步骤 0/self-isolate 出口经 releaser 路由至此）：逐会话 disconnect 段
   *  ≤300ms（spool 交接不计入——Z143①；超预算=条目留表〔zombie 档自延续〕+点名+
   *  budget_exceeded{session}）+总 ≤2s（破=停止处理剩余会话+逐个点名+budget_exceeded{total}——留
   *  hold 交 drainAllDocuments〔shutdown〕/reaper TTL〔self-isolate〕兜底，Z143「继续 hold 交步骤
   *  4」）+shutdown 档收尾 Σdirect===0 断言（非零=ERROR+direct_leak 计数——泄漏非预算，两口径分离）。
   *  releasing 复调路径（Z83）同受 disconnectBudgetMs 约束（I-1）；handoff await 套剩余总预算 race
   *  （I-2）；双调路径经 budgetNamedPids/leakAsserted 两 latch 首报去重（I-1/M-1）。 */
  async releaseAllSessions(motive: 'shutdown' | 'self-isolate', opts?: { perSessionMs?: number; totalMs?: number }): Promise<void> {
    const perSessionMs = opts?.perSessionMs ?? RELEASE_SESSION_BUDGET_MS;
    const totalMs = opts?.totalMs ?? RELEASE_TOTAL_BUDGET_MS;
    const t0 = Date.now();
    const pids = this.residentProjectIds();
    let released = 0;
    for (let i = 0; i < pids.length; i += 1) {
      const pid = pids[i];
      if (this.budgetNamedPids.has(pid)) continue;   // I-1：本进程已点名（前次调用 {session}/{total}）——不再等待/计数/计入 released
      if (Date.now() - t0 >= totalMs) {
        for (const rest of pids.slice(i)) {
          if (this.budgetNamedPids.has(rest)) continue;   // 已点名不重计（I-1 双调双烧防线）
          this.budgetNamedPids.add(rest);
          yjsReleaseBudgetExceededTotal.inc({ scope: 'total' });
          this.logger.error(`release budget exceeded (total ${totalMs}ms): project:${rest} motive=${motive}——留 hold 交${motive === 'shutdown' ? ' drainAllDocuments' : ' reaper TTL'}兜底（Z143 继续持有非放弃）`);
        }
        break;
      }
      let outcome: TryReleaseOutcome;
      try {
        // handoffBudgetMs=剩余总预算透传（I-2——交接段不占 300ms〔Z143① 计时分离〕但整段墙钟受总 2s 约束）
        outcome = await this.tryRelease(pid, motive, { disconnectBudgetMs: perSessionMs, handoffBudgetMs: totalMs - (Date.now() - t0) });
      } catch (e) {
        this.logger.warn(JSON.stringify({ event: 'collab_residency_release_error', pid, motive, error: (e as Error).message }));   // 逐项 WARN 不阻后续
        continue;
      }
      if (outcome === 'budget-exceeded') {
        this.budgetNamedPids.add(pid);
        yjsReleaseBudgetExceededTotal.inc({ scope: 'session' });
        this.logger.error(`release budget exceeded (session ${perSessionMs}ms): project:${pid} motive=${motive}——disconnect 段超预算，条目留表（zombie 档自延续）交后续关停步兜底（Z143）`);
      } else if (outcome === 'released') {
        released += 1;
      }
      // rejected-handoff/rejected-pending：T17 既有计数+点名（此处不重复计——Z143 两拒绝分离口径）
    }
    if (motive === 'shutdown') {
      // Σdirect===0 断言（graceDirectConnections count() 同款口径——Z81 硬失败，与逐会话超预算两
      // 口径分离）：交接失败/取批在飞窗 rejected-pending/总预算跳过留 hold 的会话仍持 direct conn。
      // ?.＝mock gateway 直构兼容。M-1 首报 latch——Nest DI 反序双调各跑一次断言，只计首报。
      let direct = 0;
      for (const d of this.gateway.server.hocuspocus.documents?.values() ?? []) direct += d.directConnectionsCount ?? 0;
      if (direct > 0 && !this.leakAsserted) {
        this.leakAsserted = true;
        yjsShutdownDirectLeakTotal.inc();
        this.logger.error(`shutdown direct leak: ΣdirectConnectionsCount=${direct}——步骤 0 释放后仍非零（交接失败/取批在飞窗 rejected-pending/预算跳过留 hold——留 hold 会话仍持 direct conn），destroy_timeout 必发前显式点名（Z81）`);
      }
    }
    this.logger.log(`collab residency release-all(${motive}): ${released}/${pids.length} released in ${Date.now() - t0}ms`);
  }

  /** Y0c T18：钩子=仅清 timer+委托全形态（Nest DI 反序本钩子先于 gateway 调——gateway 步骤 0 显式
   *  化后双调安全：releaser 幂等，第二次无条目 no-op）。 */
  async onApplicationShutdown(): Promise<void> {
    if (this.reapTimer) { clearInterval(this.reapTimer); this.reapTimer = null; }   // 先清周期定时器再释放会话
    for (const [, entry] of this.sessions) {
      if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
    }
    await this.releaseAllSessions('shutdown');
  }
}
