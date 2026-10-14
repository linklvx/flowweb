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
// T16）；T17 统一释放入口 tryRelease 消费 releaseSessionFor 原语（本任务落基础形态）；T18 关停步骤 0
// releaseAllSessions 同源。三释放出口改造禁入本任务范围。
import { Injectable, Inject, Logger, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import type * as Y from 'yjs';
import { CollabAuthReason, SERVER_TRANSACT_ORIGIN } from '@flowweb/shared';
import { CollabGateway, isValidDocName } from './collab.gateway';
import {
  collabAcquireWaitTimeoutTotal, collabResidencyReconcileDriftTotal, collabResidencyReleaseInflightTotal,
  collabWriteSessionReleaseTimeoutTotal, consumeDirectLoad, noteDirectLoad, yjsWithdocOpenDuration,
} from './store.metrics';

/** 直连类型=库 openDirectConnection 返回实例推导（根导出 DirectConnection 接口无 document 成员——
 *  会话表需要 conn.document 直读；推导形态免 @hocuspocus/server 类型导入=worker 闭包面最小化）。 */
type DirectConn = Awaited<ReturnType<CollabGateway['server']['hocuspocus']['openDirectConnection']>>;

/** 会话状态机（A2 冻结契约：held→releasing→released〔=条目移除〕；zombie=释放挂起超时档）。 */
export type ResidentSessionState = 'held' | 'releasing' | 'zombie';

/** 会话表条目。idleTimer（T16 reaper 武装）/bytes（T16 calibrateTruth 复用填）本任务占位。 */
export interface ResidentSession {
  conn: DirectConn;
  refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  state: ResidentSessionState;
  bytes: number;
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

export interface WithSessionOptions {
  mode: 'read' | 'write';
}

interface Acquired {
  conn: DirectConn;
  /** null=未入池（Z111 degraded 瞬态——用完即断，旧行为） */
  entry: ResidentSession | null;
}

@Injectable()
export class CollabResidencyService implements OnApplicationShutdown {
  private readonly logger = new Logger(CollabResidencyService.name);
  /** 会话表（Z59 钉住谓词载体——conn 在即 doc 恒驻）。单键单条目：Map 结构性保证「会话表无双条目」。 */
  private readonly sessions = new Map<string, ResidentSession>();
  /** 同 pid acquire 串行化链（并发窗防双开——两 acquire 同时未命中/撞 releasing 时排队，后继见前驱成果） */
  private readonly acquireChains = new Map<string, Promise<unknown>>();

  constructor(@Inject(CollabGateway) private readonly gateway: CollabGateway) {}

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

    const acquired = await this.acquireSerialized(projectId);
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
      // 纪律违规观测（判据「释放仅对 refCount===0∧held 发起」）；调用方纪律归 T17 tryRelease 统一
      // 收口（判据上移），届时本计数稳态 0。
      this.logger.warn(JSON.stringify({ event: 'collab_residency_release_inflight_refs', pid: projectId, refCount: entry.refCount }));
      collabResidencyReleaseInflightTotal.inc();
    }
    entry.state = 'releasing';
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

  /** 同 pid acquire 串行化（并发窗防双开——链尾消费后自清理，Map 不无界增长）。 */
  private acquireSerialized(projectId: string): Promise<Acquired> {
    const prev = this.acquireChains.get(projectId) ?? Promise.resolve();
    const job = prev.then(() => this.acquire(projectId), () => this.acquire(projectId));
    const tail = job.catch(() => undefined);
    this.acquireChains.set(projectId, tail);
    void tail.finally(() => {
      if (this.acquireChains.get(projectId) === tail) this.acquireChains.delete(projectId);
    });
    return job;
  }

  /** acquire：held 命中=refCount++ 复用（Z59 钉住面零新开）；releasing=有限等待释放完成（超时计数
   *  即新开——Z109 不变量）；zombie/无会话=新开 conn 入表；degraded（Z111）=不入池瞬态。 */
  private async acquire(projectId: string): Promise<Acquired> {
    const existing = this.sessions.get(projectId);
    if (existing && existing.state === 'held' && existing.conn.document) {
      existing.refCount += 1;
      return { conn: existing.conn, entry: existing };
    }
    if (existing && existing.state === 'releasing') {
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
    // Z111 degraded 阻断：不入会话表（本次即用即断=旧行为；整行缺失不可探测面维持每次装载+每次告警）
    if (this.gateway.isDocDegraded(projectId)) {
      this.logger.warn(`residency skip (degraded doc): project:${projectId}——Z111 不入池，本次即用即断`);
      return { conn, entry: null };
    }
    const entry: ResidentSession = { conn, refCount: 1, idleTimer: null, state: 'held', bytes: 0 };
    this.sessions.set(projectId, entry);   // 覆盖 zombie/超时残留条目（旧条目身份守卫自清理）
    return { conn, entry };
  }

  /** withSession finally 释放：入池=refCount--（回零不立即释放——常驻，idleTimer 武装归 T16）；
   *  未入池（Z111 degraded 瞬态）=disconnect 即旧行为收尾。 */
  private async releaseAcquire(acquired: Acquired): Promise<void> {
    if (!acquired.entry) {
      await acquired.conn.disconnect({ unloadImmediately: true });
      return;
    }
    if (acquired.entry.refCount > 0) acquired.entry.refCount -= 1;
  }

  /** 周期对账（Z113②）：不变量=Σ held 条目各自 conn 持有（conn.document 在∧directConnectionsCount≥1）
   *  ===held 条目数；漂移 WARN+计数。zombie/releasing 档例外豁免——库 disconnect 首步 removeDirectConnection
   *  （esm:1148）先于 await，非 held 档 count 恒 0 属机制内形态非泄漏。周期定时器挂载归 T16
   *  （与 reaper 同窗调度避免时序冲突——本任务先落方法+被调点义务）。 */
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

  /** I-3（控制方裁决 a）最小关停钩子：进程关停循环 releaseSessionFor——常驻 conn 不释放则
   *  graceDirectConnections 烧满 2s+destroy 4s race⇒destroy_timeout 假 ERROR 每次必发（Z81 机制链），
   *  本钩子消声。**无预算核算无 Σdirect===0 断言——T18 关停步骤 0 全形态（Z38/Z81：逐会话预算+
   *  Σdirect===0 硬断言+hangReason resident-session-open 档）届时整体替换本方法。 */
  async onApplicationShutdown(): Promise<void> {
    const pids = this.residentProjectIds();
    let released = 0;
    for (const pid of pids) {
      try {
        await this.releaseSessionFor(pid);
        released += 1;
      } catch (e) {
        this.logger.warn(JSON.stringify({ event: 'collab_residency_shutdown_release_error', pid, error: (e as Error).message }));   // 逐项 WARN 不阻后续
      }
    }
    this.logger.log(`collab residency shutdown: released ${released}/${pids.length} sessions`);
  }
}
