import { Injectable, Inject, Logger, Optional, ServiceUnavailableException, type OnApplicationShutdown } from '@nestjs/common';
import * as Y from 'yjs';
import { toReadModel, CANVAS_DOC_SCHEMA_VERSION, CollabAuthReason, SERVER_TRANSACT_ORIGIN, fillDoc, textDomainOf, type StoredNodeRecord, type DocEdgeRecord, type CanvasReadModel, type CanvasReadSnapshot } from '@flowweb/shared';
import { CollabGateway, isValidDocName } from './collab.gateway';
import { canvasDocName } from './doc-name.util';
import { CollabResidencyService, type WithSessionOptions } from './collab-residency.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { toDocLike } from './doc-like.util';
import { createCanvasDoc } from './canvas-doc.factory';
import type { FlushOutcome } from './collab-persistence.service';
import { yjsSnapshotFallbackTotal, yjsWithdocDuration, yjsWithdocOpenDuration, noteDirectLoad, consumeDirectLoad, registerSnapshotCacheEntriesReader, unregisterSnapshotCacheEntriesReader } from './store.metrics';
import { execProjectionDroppedTotal, execOrphanBlockedTotal, execSeqStaleRejected } from '../execution/exec.metrics';
import { SnapshotDocCache } from './snapshot-doc-cache';
import { RuntimeFeedService } from './runtime-feed.service';
import { CollabLifecycleObserverService } from './collab-lifecycle-observer.service';

/** Z111：exec 投影 patch 类型——attempts 必填（编译级；请求级投影传 0 代："0 代不得覆盖任何 ≥1 代"）。 */
export interface ExecStatusPatch {
  status: string;
  attempts: number;
  [key: string]: unknown;
}

/** Z44/Z64：writeNodeData 交付判据返回——written:false=节点已删/结构缺失（交付路径唯一退款凭据）；
 *  drain/租约 503 是抛错（走悬留闭环）非 written:false，两路径分义。 */
export interface WriteNodeDataResult {
  written: boolean;
  // Y1c T15 增容器规则两值（text-domain-protected/no-data-map——见 applyWriteNodeDataToDoc 头注）
  reason?: 'node-deleted' | 'no-node-map' | 'text-domain-protected' | 'no-data-map';
}

@Injectable()
export class CollabDocumentService implements OnApplicationShutdown {
  private readonly logger = new Logger(CollabDocumentService.name);
  /** Y0b-2 T3：进程内 TTL 单飞缓存（纯内存原语字段自建——跨请求缓存归 Redis 层，本层=并发窗去重）。
   *  Y0b-5 T10：容量上界 32+entries gauge 可见化（registerPendingCollector 同族 reader 注册惯例）。 */
  private readonly snapshotCache = new SnapshotDocCache();

  /** Y0c T15（A2）：常驻会话单例——Nest 由 module provider 注入；直构测试不传时自建
   *  （gateway pgBreaker/sessionSvc 兜底自建同惯例）。生产恒走 DI 单例（会话表全局唯一）。 */
  private readonly residency: CollabResidencyService;

  /** Y1c T22（G5 同切片切交付）：RuntimeEvent feed 写面+T26 fence 权威——@Optional 供直构测试
   *  （缺省时 writeExecStatus/deliverArtifact fail-closed throw 非静默回落 doc 写——不变量⑦）。 */
  constructor(
    @Inject(CollabGateway) private readonly gateway: CollabGateway,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
    @Optional() residency?: CollabResidencyService,
    @Optional() private readonly feed: RuntimeFeedService | null = null,
    @Optional() private readonly lifecycle: CollabLifecycleObserverService | null = null,
  ) {
    this.residency = residency ?? new CollabResidencyService(gateway);
    registerSnapshotCacheEntriesReader(() => this.snapshotCache.size);
  }

  /** Y0c T15（A2）：会话式读写透传（withSession 唯一消费入口——读/写路径经 residency 单例
   *  acquire/复用，refCount 计账；mode 语义见 CollabResidencyService.withSession）。 */
  withSession<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>, opts: WithSessionOptions): Promise<T> {
    return this.residency.withSession(projectId, fn, opts);
  }

  /** Y0b-5 T10：collect 闭包随 service 死（gateway reader 同惯例） */
  onApplicationShutdown(): void {
    unregisterSnapshotCacheEntriesReader();
  }

  /** Q1 单实例铁律：业务服务端写 doc 一律走 Hocuspocus 直连；try/finally disconnect 保证 unload flush（S7）。
   *  Y0a-3（P0-1 三入口③）：withDoc 首行租约门——lease 失守/drain 期早退 503（不 openDirectConnection，
   *  不触发装载重连风暴）。消息非协议形态（通用入口，客户端不按 body.code 分型）。
   *  Y0b-4 T9a（Q-U v6/U-3/G-7）：vacuum serving 门——真空窗口拒物化（readServerSV/readCanvas/
   *  writeExecStatus 同挂）；REST 面真 503（COLLAB_NOT_SERVING 族——filter 附 Retry-After: 2）。
   *  Y0b-5 T16：docName 全匹配守卫（三入口③ direct——别名执法分叉根修）。
   *  Y1c T12（偏离 27/E23）：**canonical wire 名开直连**——readWatermark 读 CanvasDoc.generation 真值
   *  →canvasDocName(pid, g)（gen>0=#g 段——换代后裸名 openDirectConnection=第二 doc 实例别名分叉）；
   *  行缺失（懒建档）=0=裸名。世代竞态窗（读后代际推进）：openDirectConnection 触发 onLoadDocument
   *  →DR 装载面世代准入（admitDocNameForGeneration 第二道）拒绝——fail-closed 非别名。
   *  Y0c T15（A2）：**非常驻面专用**——常驻读写已改道 withSession（会话复用零 disconnect 零重装，
   *  Z128）；本方法保留给「用完即走」面（shrink/exportFresh 源读等——census ⑭ registry 同步分类），
   *  既有 gates/origin/disconnect(true) 语义逐字不变。 */
  async withDoc<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
    const wm = await this.repo.readWatermark(projectId);   // T12：generation 真值（PK 读——REST 面既有 PG 往返预算内）
    const canonicalName = canvasDocName(projectId, wm?.generation ?? 0);
    if (!isValidDocName(canonicalName)) {
      throw Object.assign(new Error(`invalid doc name: ${canonicalName}`), { reason: CollabAuthReason.INVALID_DOC_NAME });
    }
    if (!this.gateway.isLeaseServing()) throw new ServiceUnavailableException('collab not serving (lease not held)');   // P0-1 三入口③
    if (this.gateway.isVacuuming(projectId)) {
      throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'doc-vacuuming' });   // 真空窗口 ≤30s 上界——Retry-After 2 由 CollabNotServingFilter 附
    }
    const withdocT0 = Date.now();   // Y0c T0（Z3）：起点前移至 open 之前——装载段并入全路径（原 Y0b-5 T10 从 open 后起算，装载时间不可见）
    noteDirectLoad(projectId);   // Y0c T0：直连开窗标记——装载在本 open 窗内命中即归因 trigger='direct'（yjs_doc_load_total）
    const connection = await this.gateway.server.hocuspocus.openDirectConnection(canonicalName)
      .finally(() => {
        consumeDirectLoad(projectId);   // 装载未触发（doc 常驻/open 失败）清残留；已触发时 loadDocument 已消费（幂等）
        yjsWithdocOpenDuration.observe((Date.now() - withdocT0) / 1000);   // open 段耗时（时长面非成功面——装载失败是最该被看见的慢尾）
      });
    try {
      // Y0c T10（Z6/Z119）：DirectConnection.document 公开类型成员（server index.d.ts:100）——
      // 直开事务以注入 origin（对齐库 transact 的同款防御与错误消息）
      const doc = connection.document;
      if (!doc) throw new Error('direct connection closed');
      let result: T;
      let pending: Promise<void> | undefined;
      doc.transact(() => {
        // transact 不 await 异步回调（hocuspocus 4.6.0 DirectConnection.transact 同步调用且不 await）：
        // 同步 fn 原样在事务内完成；异步 fn 捕获其 Promise 在事务外 await——
        // 否则回调挂起时即返回 undefined 且 finally 提前拆直连（readCanvas SV 等待路径依赖此语义）。
        // Y0c T10（Z6/Z119）：origin=SERVER_TRANSACT_ORIGIN 必须在最外层事务注入——机制依据=
        // DirectConnection.transact 硬编码外层 origin {source:'local',context}（esm:1136-1144）
        // 且 yjs 嵌套 transact 忽略内层 origin（内层传参无效），最外层唯一可行点=withDoc；
        // 契约=withDoc 事务即服务端事务（writeBatch/单写面/读面统一——读面无写零影响；
        // 广播/awareness/store hooks 与 {source:'local'} 完全等价——零行为漂移）。
        const r = fn(doc);
        if (r instanceof Promise) pending = r.then((v) => { result = v; });
        else result = r;
      }, SERVER_TRANSACT_ORIGIN);
      if (pending) await pending;
      return result!;
    } finally {
      await connection.disconnect({ unloadImmediately: true });   // Y0a-4/P24：A6 锚=Connection 级旋钮（B20 双旋钮之一）——B26：库默认即 true，显式 pin=防升级翻转的文档锚
      yjsWithdocDuration.observe((Date.now() - withdocT0) / 1000);   // Y0b-5 T10：全路径含 disconnect（Y0c T0 起点前移——含 open 装载段；卸载 flush 同为该请求成本）
    }
  }

  /** doc → plain nodes/edges。
   *  Y0b-2 T3（分源规则钉死）：计费/语义读统一走本活读出口（执行恒活读）；快照出口
   *  readCanvasSnapshotCached 仅无客户端面（video-work 分享/渲染等）。
   *  Y0b-2 T7：sv 参数/SV 等待退役——客户端同步判定移受理端点 SV 支配门（sync-admission.ts），
   *  执行读恒活读无需客户端 SV。
   *  O0a-2 收编→Y1c T4 改道：读实现单源 shared doc-codec.toReadModel（原 docShape 直读函数收编
   *  codec 内部——api 读≡web 读，出口=作者态 StoredNodeRecord：doc 缺键→出口无键，null 消除在
   *  读侧自做；v3 纯 JSON 值逐位同出口零行为变更）。
   *  T18（Y1b T2）：O0b-0 meta 版本门退役——版本判据=CanvasDoc.schemaVersion PG 列，装载门
   *  （loadDocument 行值≠current 拒载）结构性先于 withSession 回调（读面复用装载门——REST 不再设第二门）。
   *  Y0c T15（A2/Z128）：改道 withSession(read)——共享会话不 disconnect 不武装 debouncer
   *  （旧 withDoc 路径每次 disconnect(true)=每次全量编码 store+计数抖动，终结）。
   *  Y0c T20（Z105 spec :526）：opts.ephemeral=即用即释档（不入会话表）——原消费面=reconcile 5min
   *  周期探针（T13 起 probeArtifacts 删除=doc 探测退款后门根修，R3 判据全量换 PG）；ephemeral 档
   *  保留为 residency 通用能力（冷读防钉常驻池），REST/作业面读缺省入池（T15 常驻语义不变）。 */
  async readCanvas(projectId: string, opts?: { ephemeral?: boolean }): Promise<CanvasReadModel> {
    return this.withSession(projectId, async (doc) => {
      return toReadModel(doc);
    }, { mode: 'read', ephemeral: opts?.ephemeral });
  }

  /** Y0b-2 T7：服务端 doc SV 单源出口——受理端点 SV 支配门（assertSyncAdmitted）唯一读点。
   *  Y0c T15（A2/Z128）：改道 withSession(read)——会话内存级读（零 disconnect 零重装）。 */
  async readServerSV(projectId: string): Promise<Uint8Array> {
    return this.withSession(projectId, (doc) => Y.encodeStateVector(doc), { mode: 'read' });
  }

  /** Y0b-2 T3：快照解码单源——readSnapshotOnly 行集→同 doc 重放→版本门→投影；快照缓存 loader
   *  与直接快照读共用此实现（防两处解码漂移）。不经 openDirectConnection/不装载/不触 store/compact；
   *  陈旧度=进行中编辑未含（去抖窗级，spec §9.9 登记）。
   *  Y1c T19：出口 DecodedSnapshot{nodes,edges} → CanvasReadSnapshot（读模型+水位三元——
   *  缓存键轨 (pid,g,snapshotRev) 与 ETag=pgSeq 新鲜度由水位面承载；BigInt wire=string）。 */
  private async decodeSnapshot(projectId: string): Promise<CanvasReadSnapshot> {
    // T18（Y1b T2）：版本门=CanvasDoc.schemaVersion 行值（readSnapshotOnly 随行——快照出口与装载
    // 出口同一列单源；行值≠current 拒读——旧 doc 档无迁移；行缺失 null=懒建档放行）。
    const { state, updates, schemaVersion, generation, pgSeq, currentSnapshotRev } = await this.repo.readSnapshotOnly(projectId);
    if (schemaVersion != null && schemaVersion !== CANVAS_DOC_SCHEMA_VERSION) {
      throw new Error(`DOC_SCHEMA_STALE: CanvasDoc.schemaVersion=${schemaVersion} ≠ current ${CANVAS_DOC_SCHEMA_VERSION}——快照拒读（版本硬切批无迁移）`);
    }
    const doc = createCanvasDoc();
    try {
      if (state) Y.applyUpdate(doc, new Uint8Array(state));
      for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
      return {
        model: toReadModel(doc),
        generation: generation ?? 0,
        snapshotRev: (currentSnapshotRev ?? 0n).toString(),
        pgSeq: (pgSeq ?? 0n).toString(),
      };
    } finally {
      doc.destroy();
    }
  }

  /** Y0b-2 T3（Z88/Z50 修订）：快照读专用出口（无客户端面：video-work 分享/渲染等）——
   *  快照路径本无租约门（不查 isLeaseServing——谓词满足=drain 已冲刷完成，快照读可正常返回 ✓）；
   *  谓词不满足（drain 进行中 spool 有帧/doc 常驻/在途批——PG 快照可能滞后）→ 活读 fallback
   *  （快照不可信定义性不使用）——活读经 withSession 会话形态（Y0c T15 读路径改道；门同判据：
   *  isLeaseServing ⇒ drain 进行中 503，可达性边界 T9 登记；会话入池钉住——T20 裁决⑥ 同形态，
   *  doc 常驻期复用零装载）+fallback 计数观测（低频边缘：spool 未落库窗内外部分享请求触发会话装载）。
   *  计费/语义读（execution/video-project）走 readCanvas 活读——分源规则见其头注。
   *  Y1c T19：出口 CanvasReadSnapshot（水位面随行——fallback 档=readWatermark 采样包水位
   *  （活读内容可能领先 pgSeq——ETag=pgSeq 口径不超前持久水位，§5.1/G1「ETag 不超前 pgSeq」）。 */
  async readCanvasSnapshotCached(projectId: string): Promise<CanvasReadSnapshot> {
    if (!this.gateway.isPersistedComplete(projectId)) {
      yjsSnapshotFallbackTotal.inc();
      // T19 双评审 Q-I-1 根修：**顺序采样——水位先行**（T_wm ≤ T_model：doc 单调增长 ⇒ 内容 ⊇ pgSeq
      // 帧 ⇒ ETag ≤ 内容水位构造性成立）。原 Promise.all 无序采样在「模型采样后/水位采样前」帧落库时
      // pgSeq 含 F 而模型缺 F ⇒ ETag 声明内容不具备的新鲜度 ⇒ 同 ETag 异内容 304 永久持旧（§8.1 要防
      // 形态）；与 decodeSnapshot/withDoc/residency 先读水位再触 doc 先例同构。内容领先 pgSeq 方向
      //（活读含未持久帧）本就安全（ETag=pgSeq 不超前持久水位——§5.1/G1）。
      const wm = await this.repo.readWatermark(projectId);
      const model = await this.readCanvas(projectId);
      return {
        model,
        generation: wm?.generation ?? 0,
        snapshotRev: (wm?.currentSnapshotRev ?? 0n).toString(),
        pgSeq: (wm?.pgSeq ?? 0n).toString(),
      };
    }
    return this.snapshotCache.get(projectId, () => this.decodeSnapshot(projectId));
  }

  /** Y0b-2 T3 落/T8 修订：快照缓存失效——E71 后失效归 canvas.doc-saved 事件（@OnEvent 双层失效：
   *  进程内 invalidateSnapshotCache+Redis del）；进程内层跨请求存活（TTL 30s 上界），非一次性。 */
  invalidateSnapshotCache(projectId: string): void {
    this.snapshotCache.invalidate(projectId);
  }

  /** Y0a-3（T8）：租约态透传——计费/语义读调用面（execution/video-project）的 503 分型查此档。 */
  isLeaseServing(): boolean {
    return this.gateway.isLeaseServing();
  }

  /** Y0b-2 T5（Z106/Z112）→Y0c T20（Z105）：doc 常驻透传=hasActiveWsConnection(pid)（仅 WS 连接数>0，
   *  与常驻会话无关——gateway 侧定案注释同源）。消费=reaper 投影分治判据（无人看=跳过投影+deferred
   *  计数——「无人在看=不为 UX 投影花钱」语义保留）。 */
  isDocResident(projectId: string): boolean {
    return this.gateway.isDocResident(projectId);
  }

  /** Y0c T9（A1·X9 批面受理门单点根修）：写意图受理门——写入口（writeExecStatus/writeBatch/
   *  deliverArtifact——T15 删 writeNodeData 单写面：交付归投影 poller）共用单点（结构性防漏：
   *  第三处复制粘贴门=T8 批面回归的成因，本方法即终结形态）。
   *  判据与 throw 与提取前逐字一致：租约档（Y0a-3 R4——lease 失守/drain 期拒）+spool 熔断/容量
   *  熔断档（Y0a-2 X9）。真空档维持 in withDoc 不并入（与既有单写面语义严格一致）。
   *  Z40 基础设施档：throw ⇒ writeBatch 全批 thrown ⇒ 调用方按零交付退款。
   *  Y0c T15（A2）：实现单源迁 CollabResidencyService.assertWriteAdmitted（withSession(write)
   *  内部强制过门）——本方法一行委托（writer/测试消费面签名不变）。 */
  assertWriteAdmitted(): void {
    this.residency.assertWriteAdmitted();
  }

  /** Y1c T22（G5 同切片——D9 切交付）：**doc.exec 停写**——writeExecStatus 改 RuntimeEvent
   *  exec.status PG 写（feed 事件与业务事务原子；零 doc 写——不变量⑦服务端派生字段永不进 doc）。
   *  签名/守卫入口不变（写意图受理门+租约档语义原样——调用方 execution.service/worker 通道零改）；
   *  代次守卫（Z99/Z111 attempts/终态不倒退）随 doc 写面退役——feed 端 nodeVersion 单调由客户端
   *  reducer 大者胜承担（迟到旧事件按 nodeVersion 丢弃），服务端不再建 exec 条目（无孤儿面）。
   *  @Optional feed 缺席=fail-closed throw（直构测试面——禁静默回落 doc 写）。 */
  async writeExecStatus(projectId: string, nodeId: string, patch: ExecStatusPatch): Promise<void> {
    // X9 写意图受理门 + Y0a-3 T8 租约档（R4）；Y0c T9 收编单点 assertWriteAdmitted（语义零变化）
    this.residency.assertWriteAdmitted();
    if (!this.feed) throw new Error('RUNTIME_FEED_NOT_CONFIGURED: writeExecStatus 需 RuntimeFeedService（T22 doc.exec 停写——禁回落 doc 写）');
    const { attempts, status } = patch;
    const r = await this.feed.appendEvent(projectId, 'exec.status', () => ({
      nodeId,
      status: String(status),
      attempts: typeof attempts === 'number' ? attempts : 0,
      ...(typeof patch.execSeq === 'string' ? { execSeq: patch.execSeq } : {}),
      ...(typeof patch.errorCode === 'string' ? { errorCode: patch.errorCode } : {}),
      ...(typeof patch.artifactRev === 'number' ? { artifactRev: patch.artifactRev } : {}),
    }));
    this.feed.notifyProject(projectId);   // 事务提交后通知（节流 ≤1/s——feed-hint 不带事件体）
    void r;
  }

  /** T14（plan v11.2 片 S4）透传面：flushDocument 交付判定窄接口（投影 poller 批尾一次 flush 的
   *  调用缝——capturedEpoch=claim 时捕获；语义全谱见 CollabPersistenceService.flushDocument/FlushOutcome）。
   *  经 residency 单例透传（gateway.persistence 同实例——saveMutex/归属地判读单源）。 */
  flushDocument(projectId: string, capturedEpoch: bigint | null): Promise<FlushOutcome> {
    return this.residency.flushDocument(projectId, capturedEpoch);
  }

  /** Y1c T22（G5 同切片——D9 切交付，不变量⑦首达）：deliverArtifact **改 PG 写**——零 doc 写
   *  （data.{fileId|result} 服务端写面退役——服务端派生字段永不进 doc），交付=RuntimeEvent
   *  exec.artifact+exec.status(done) 两事件（与 fence 判定同事务原子提交）。
   *  **node-deleted 权威=deliveryFenceCheckInTx（T26 先行）**——deliverArtifact 弃用 doc
   *  data.written:false 观察：fence 拒档（node-deleted/fence-stale/unregistered）⇒ written:false
   *  reason='node-deleted'（调用方 poller 既有 orphaned+幂等退款流照常——「丢弃不退款」指 fence
   *  判定自身零资金动作，资金收敛归 poller orphaned/R3 窗⑥既有链）。
   *  T26 裁定（unregistered 档三场景=legacy 无行/replayAll 崩溃窗 stale 档/doc-lag 收养整体
   *  stale）：**维持 fail-closed 拒档**——开发期无存量兼容（seedPresence 播种面=T26 已落，
   *  词表内节点恒有行；拒档语义=宁拒勿复活 stale-ACTIVE 逃逸）。
   *  幂等：同 (nodeId, artifactRev) exec.artifact 事件已存在 ⇒ no-op written:true（poller 重投/
   *  ambiguous commit 安全——事件唯一性按业务键非 feedSeq）。 */
  async deliverArtifact(projectId: string, params: {
    nodeId: string;
    targetField: 'fileId' | 'result';
    value: string | null;
    exec: ExecStatusPatch;
  }): Promise<{ data: WriteNodeDataResult; execWritten: boolean }> {
    this.residency.assertWriteAdmitted();   // 写意图受理门（R4——与旧写面同门先行）
    if (!this.feed || !this.lifecycle) {
      throw new Error('RUNTIME_FEED_NOT_CONFIGURED: deliverArtifact 需 RuntimeFeedService+LifecycleObserver（T22 切交付——禁回落 doc 写）');
    }
    const feed = this.feed;
    const lifecycle = this.lifecycle;
    const { nodeId, exec, value } = params;
    // 幂等前置：同 (nodeId, artifactRev) 事件在档 ⇒ no-op（poller 重投/ambiguous commit 安全）
    const artifactRev = typeof exec.artifactRev === 'number' ? exec.artifactRev : 0;
    if (await feed.hasArtifactEvent(projectId, nodeId, artifactRev)) {
      return { data: { written: true }, execWritten: true };
    }
    const outcome = await feed.appendEventTransaction(projectId, async (tx, append) => {
      // ① fence 权威（FOR UPDATE 行锁——判定与事件写同事务不可插队）
      const verdict = await lifecycle.deliveryFenceCheckInTx(tx, projectId, nodeId);
      if (!verdict.allow) {
        return { rejected: true as const, reason: verdict.reason };
      }
      // ② exec.artifact（mediaId/resultRef 引用——尺寸事实走 media-facts 通道不进事件）
      await append('exec.artifact', () => ({
        nodeId,
        ...(params.targetField === 'fileId' && typeof value === 'string' ? { mediaId: value } : {}),
        ...(params.targetField === 'result' && typeof value === 'string' ? { resultRef: value } : {}),
        artifactRev,
      }));
      // ③ exec.status done（attempt/errorCode 随 exec patch——键集同 EXEC_STATUS_KEYS 域）
      await append('exec.status', () => ({
        nodeId,
        status: String(exec.status ?? 'done'),
        attempts: typeof exec.attempts === 'number' ? exec.attempts : 0,
        ...(typeof exec.errorCode === 'string' ? { errorCode: exec.errorCode } : {}),
      }));
      return { rejected: false as const };
    });
    if (outcome.rejected) {
      // T26 裁定三场景（unregistered/stale/node-deleted）一律拒档——reason 归并 'node-deleted'
      //（poller 既有 orphaned+退款流语义不变——交付判据类型化面维持）
      return { data: { written: false, reason: 'node-deleted' }, execWritten: false };
    }
    feed.notifyProject(projectId);   // 事务提交后通知（feed-hint 不带事件体——客户端拉取追平）
    return { data: { written: true }, execWritten: true };
  }
}

// ── Y0c T8：doc 写原语纯函数（writeNodeData/writeExecStatus 方法体与 writeBatch 逐 op 共用——
// 单一写语义真源；置于类后保 withDoc 调用点行号 advisory 稳定）。守卫失败返回类型化结果不 throw
// （Z40②：批面=合法结果进数组；单写面=原样返回给调用方）。 ──

/** Z5 undefined 拒码单源（Y0c T9）：消息含码名 UNDEFINED_PATCH_VALUE——applyWriteNodeDataToDoc
 *  （单写面+批面原语共用）与 writeBatch 进门扫描两 fail-fast 点共此一口，禁漂移。
 *  语义：JSON wire 传不了 undefined，含 undefined=进程内 bug ⇒ fail-fast throw 非 written:false。 */
export function undefinedPatchValueError(opName: string, k: string): Error {
  return new Error(`UNDEFINED_PATCH_VALUE: ${opName} patch 键 ${k} 值为 undefined（Z5 进门 fail-fast——JSON wire 传不了 undefined，进程内 bug）`);
}

/** writeNodeData 写核心（Z44 交付判据：written:false=节点已删/结构缺失——交付路径唯一退款凭据）。
 *  Y0c T9（Z5）：首段 undefined fail-fast（应用前全扫——单写面覆盖；writeBatch 同函数两路径禁漂移）。
 *  Y1c T15 容器规则（服务端写 seam；收口 B①〔Q-I-2〕**逐键拒**——与 web applyIntentToDoc 同尺）：
 *  ①Y.Text 域键（text-domains 词表——audioGen/multiImageGen/textInput.prompt）skip 拒（服务端无
 *  splice 写腿——容器替换对抗面），**非域键照写**（混 patch 不整 op 连坐丢）；written 语义=至少一
 *  键落=true，全键被拒=written:false+text-domain-protected（WriteOpResult A1 冻结形状无逐键明细——
 *  调用面 deliverArtifact 单键 {fileId|result} 非域键结构性不触此档；writeBatch 路径另受 Z108
 *  SERVER_NODE_DATA_KEYS 键白名单先行拦，逐键守卫=直调原语面的防御纵深）；
 *  ②结构缺整 op 拒：node-deleted/no-node-map/no-data-map（缺 data Y.Map=结构错误拒绝不懒建
 *  ——原懒建 Y.Map 掩盖结构错误，§3.5 撤除；**poller 消费面按 reason 分档**——no-data-map ≠
 *  node-deleted，见 projection-outbox.poller）。 */
export function applyWriteNodeDataToDoc(doc: Y.Doc, nodeId: string, patch: Record<string, unknown>): WriteNodeDataResult {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) throw undefinedPatchValueError('writeNodeData', k);
  }
  const entry = doc.getMap('nodes').get(nodeId);
  if (entry === undefined) return { written: false, reason: 'node-deleted' };   // Z44：交付判据类型化（原静默 return void）
  if (!(entry instanceof Y.Map)) return { written: false, reason: 'no-node-map' };
  const dataMap = entry.get('data');
  if (!(dataMap instanceof Y.Map)) return { written: false, reason: 'no-data-map' };
  const nodeType = entry.get('type');
  let landed = 0;
  let rejectedAny = false;
  for (const [k, v] of Object.entries(patch)) {
    if (textDomainOf(nodeType, k)) { rejectedAny = true; continue; }   // 域键 skip 拒——非域键照写
    dataMap.set(k, v);
    landed += 1;
  }
  if (landed === 0 && rejectedAny) return { written: false, reason: 'text-domain-protected' };
  return { written: true };
}

/** writeExecStatus 守卫判定结果——Z40②：守卫失败在批面=合法结果 written:false+reason；
 *  单写面维持 void 静默语义不变（cause 计数在方法内保持）；{written,reason} 上浮调用方=Z69 登记 Y1c-3。
 *  Y0c T11（Z4）：node-deleted=节点不存在（存在性守卫在代次判定之前——不建条目，守卫拦截至此即返；
 *  writeNodeData 的 node-deleted/no-node-map 两档在 exec 域合并为一档——exec 条目无细分处置需求）。 */
export type ExecStatusApplyOutcome =
  | { written: true }
  | { written: false; reason: 'missing-attempts' | 'older-attempts' | 'terminal-superseded' | 'node-deleted' };

/** writeExecStatus 写核心（Z99/Z111 代次守卫 fail-closed——守卫子句语义见方法头注，此处逐条对应）。
 *  Y0c T11（Z4）：首段节点存在性守卫（结构对齐 applyWriteNodeDataToDoc 存在性先行——undefined/非
 *  Y.Map 同拦一档 node-deleted；Z69 减法：不建条目即返，新孤儿结构性不可产生，存量归 sweepOrphanExec）。 */
export function applyWriteExecStatusToDoc(doc: Y.Doc, nodeId: string, patch: ExecStatusPatch): ExecStatusApplyOutcome {
  const node = doc.getMap('nodes').get(nodeId);
  if (!(node instanceof Y.Map)) return { written: false, reason: 'node-deleted' };
  if (typeof patch.attempts !== 'number') return { written: false, reason: 'missing-attempts' };
  const exec = doc.getMap('exec');
  let m = exec.get(nodeId) as Y.Map<any> | undefined;
  if (m instanceof Y.Map) {
    const storedAttempts = typeof m.get('attempts') === 'number' ? (m.get('attempts') as number) : 0;
    if (patch.attempts < storedAttempts) return { written: false, reason: 'older-attempts' };
    const s = m.get('status');
    if (patch.attempts === storedAttempts && (s === 'done' || s === 'error')) {
      return { written: false, reason: 'terminal-superseded' }; // 同代次终态不倒退
    }
  } else {
    m = new Y.Map();
    exec.set(nodeId, m);
  }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v);
  return { written: true };
}

/** deleteNodeDataKeys 写核心（Y0c T9·Z5 显式删键 op——客户端 canvasIntents.updateNodeData
 *  「patch 值===undefined⇒delete 键」本地语义的服务端对应物，该语义永不上线〔JSON wire 不可达〕）：
 *  节点缺失 ⇒ written:false node-deleted（Z44 对齐）；不存在之键 delete no-op；
 *  空数组 ⇒ written:true 合法 no-op（spec §6 ②）；data 子 map 缺失=无物可删（不创建空 map 防膨胀）。 */
export function applyDeleteNodeDataKeysToDoc(doc: Y.Doc, nodeId: string, keys: readonly string[]): WriteNodeDataResult {
  const entry = doc.getMap('nodes').get(nodeId);
  if (entry === undefined) return { written: false, reason: 'node-deleted' };
  if (!(entry instanceof Y.Map)) return { written: false, reason: 'no-node-map' };
  // Y1c T15 容器规则：域容器 canDelete=false（矩阵三操作面）——删域键=容器移除对抗面，拒绝
  const nodeType = entry.get('type');
  for (const k of keys) {
    if (textDomainOf(nodeType, k)) return { written: false, reason: 'text-domain-protected' };
  }
  const dataMap = entry.get('data');
  if (!(dataMap instanceof Y.Map)) return { written: true };
  for (const k of keys) dataMap.delete(k);
  return { written: true };
}

// ── Y0c T12 直写收编三原语（裁决 1——语义原样迁移；transact 自带包裹：applyWriteOpsToDoc 会被
// shrink 影子预演在无外层事务的 scratch doc 上调用，原子边界须原语自持；嵌套于 withDoc 事务时
// 内层 origin 被 yjs 忽略=T10 已证无影响）。三原语 delete/fill 均 no-guard（全量操作无存在性前提）。 ──

/** deleteNodes 写核心（收编 collab-shrink.deleteNodesInDoc——语义原样迁移）：E68 边级联
 *  （引用被删节点的边一并删——悬挂边防护；非 map 边值跳过）+nodes 删；doc.transact 单事务原子。
 *  delete 幂等（不存在的 id=no-op）；exec 条目不在此删（孤儿清扫归 deleteExecOrphans 单点）。 */
export function applyDeleteNodesToDoc(doc: Y.Doc, nodeIds: readonly string[]): WriteNodeDataResult {
  const victims = new Set(nodeIds);
  doc.transact(() => {
    const edges = doc.getMap('edges');
    for (const [id, v] of [...edges.entries()]) {
      if (!(v instanceof Y.Map)) continue;   // E68 全函数：边值可为任意 JSON——非 map 跳过
      const s = v.get('source');
      const t = v.get('target');
      if ((typeof s === 'string' && victims.has(s)) || (typeof t === 'string' && victims.has(t))) edges.delete(id);
    }
    const nodes = doc.getMap('nodes');
    for (const id of victims) nodes.delete(id);
  });
  return { written: true };
}

/** fillDoc 写核心（收编 collab-shrink.exportFreshRun fillDoc 直写——shared fillDoc 单源引用，
 *  toDocLike 适配）：节点/边种子写入。种子路径专用（idempotent:false——无条件 createMap 重放即
 *  新 item），进程内唯一调用点=export-fresh 干净副本构造（T27 端点执法档拒收）。 */
export function applyFillDocToDoc(doc: Y.Doc, nodes: readonly StoredNodeRecord[], edges: readonly DocEdgeRecord[]): WriteNodeDataResult {
  doc.transact(() => {
    fillDoc(toDocLike(doc), nodes, edges);
  });
  return { written: true };
}

/** deleteExecOrphans 写核心（收编 intent-reconcile.sweepOrphanExec 直写——语义原样迁移）：
 *  nodes map 无该 nodeId 的 exec 条目删除（Z4 守卫止新孤儿，本项消化存量）；零孤儿=合法 no-op；
 *  delete 幂等（重扫空集）。 */
export function applyDeleteExecOrphansToDoc(doc: Y.Doc): WriteNodeDataResult {
  doc.transact(() => {
    const exec = doc.getMap('exec');
    const nodes = doc.getMap('nodes');
    for (const id of [...exec.keys()]) {
      if (!nodes.has(id)) exec.delete(id);
    }
  });
  return { written: true };
}
