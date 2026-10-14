import { Injectable, Inject, Logger, Optional, ServiceUnavailableException, type OnApplicationShutdown } from '@nestjs/common';
import * as Y from 'yjs';
import { readRecordsFromMaps, ensureSchemaVersion, CollabAuthReason, SERVER_TRANSACT_ORIGIN, fillDoc, type DocNodeRecord, type DocEdgeRecord } from '@flowweb/shared';
import { CollabGateway, isValidDocName } from './collab.gateway';
import { CollabResidencyService, type WithSessionOptions } from './collab-residency.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { toDocLike } from './doc-like.util';
import { createCanvasDoc } from './canvas-doc.factory';
import { yjsSnapshotFallbackTotal, yjsDocLoadedByReconcilerTotal, yjsWithdocDuration, yjsWithdocOpenDuration, noteDirectLoad, consumeDirectLoad, registerSnapshotCacheEntriesReader, unregisterSnapshotCacheEntriesReader } from './store.metrics';
import { execProjectionDroppedTotal, execOrphanBlockedTotal } from '../execution/exec.metrics';
import { SnapshotDocCache, type DecodedSnapshot } from './snapshot-doc-cache';

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
  reason?: 'node-deleted' | 'no-node-map';
}

/** Z98：ArtifactProbe 结果项——found=doc 有产物；unknownKind=kind 不在产物键白名单（不裁决）。 */
export interface ArtifactProbeResult {
  nodeId: string;
  kind: string;
  found: boolean;
  unknownKind?: boolean;
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

  constructor(
    @Inject(CollabGateway) private readonly gateway: CollabGateway,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
    @Optional() residency?: CollabResidencyService,
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
   *  Y0b-5 T16：docName 全匹配守卫（三入口③ direct——`project:${projectId}` 须全匹配，别名执法分叉根修）。
   *  Y0c T15（A2）：**非常驻面专用**——常驻读写已改道 withSession（会话复用零 disconnect 零重装，
   *  Z128）；本方法保留给「用完即走」面（shrink/exportFresh 源读等——census ⑭ registry 同步分类），
   *  既有 gates/origin/disconnect(true) 语义逐字不变。 */
  async withDoc<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
    if (!isValidDocName(`project:${projectId}`)) {
      throw Object.assign(new Error(`invalid doc name: project:${projectId}`), { reason: CollabAuthReason.INVALID_DOC_NAME });
    }
    if (!this.gateway.isLeaseServing()) throw new ServiceUnavailableException('collab not serving (lease not held)');   // P0-1 三入口③
    if (this.gateway.isVacuuming(projectId)) {
      throw new ServiceUnavailableException({ code: 'COLLAB_NOT_SERVING', message: 'doc-vacuuming' });   // 真空窗口 ≤30s 上界——Retry-After 2 由 CollabNotServingFilter 附
    }
    const withdocT0 = Date.now();   // Y0c T0（Z3）：起点前移至 open 之前——装载段并入全路径（原 Y0b-5 T10 从 open 后起算，装载时间不可见）
    noteDirectLoad(projectId);   // Y0c T0：直连开窗标记——装载在本 open 窗内命中即归因 trigger='direct'（yjs_doc_load_total）
    const connection = await this.gateway.server.hocuspocus.openDirectConnection(`project:${projectId}`)
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
   *  O0a-2 收编：读实现单源 shared readRecordsFromMaps（docShape——api 读≡web 读，出口=作者态
   *  DocNodeRecord：doc 缺键→出口无键，null 消除在读侧自做；Y.Doc→DocLike 适配见 doc-like.util）。
   *  O0b-0 版本门 v2.1（第五行 REST fail-closed）：ensureSchemaVersion 从全量 doc 读 meta（不依赖
   *  sv 差量）——v1 档/无戳∧有节点拒（明确信息，非按 abs 解释 rel 静默错位）；无戳∧零节点放行
   * （REST 不盖戳——空画布合法档）。挂 sv 等待之前：旧档立即拒，不等 3s。
   *  Y0c T15（A2/Z128）：改道 withSession(read)——共享会话不 disconnect 不武装 debouncer
   *  （旧 withDoc 路径每次 disconnect(true)=每次全量编码 store+计数抖动，终结）。 */
  async readCanvas(projectId: string): Promise<{ nodes: any[]; edges: any[] }> {
    return this.withSession(projectId, async (doc) => {
      ensureSchemaVersion(toDocLike(doc));
      return readRecordsFromMaps(toDocLike(doc));
    }, { mode: 'read' });
  }

  /** Y0b-2 T7：服务端 doc SV 单源出口——受理端点 SV 支配门（assertSyncAdmitted）唯一读点。
   *  Y0c T15（A2/Z128）：改道 withSession(read)——会话内存级读（零 disconnect 零重装）。 */
  async readServerSV(projectId: string): Promise<Uint8Array> {
    return this.withSession(projectId, (doc) => Y.encodeStateVector(doc), { mode: 'read' });
  }

  /** Y0b-2 T3：快照解码单源——readSnapshotOnly 行集→同 doc 重放→版本门→投影；快照缓存 loader
   *  与直接快照读共用此实现（防两处解码漂移）。不经 openDirectConnection/不装载/不触 store/compact；
   *  陈旧度=进行中编辑未含（去抖窗级，spec §9.9 登记）。 */
  private async decodeSnapshot(projectId: string): Promise<DecodedSnapshot> {
    const { state, updates } = await this.repo.readSnapshotOnly(projectId);
    const doc = createCanvasDoc();
    try {
      if (state) Y.applyUpdate(doc, new Uint8Array(state));
      for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
      ensureSchemaVersion(toDocLike(doc));
      return readRecordsFromMaps(toDocLike(doc));
    } finally {
      doc.destroy();
    }
  }

  /** Y0b-2 T3（Z88/Z50 修订）：快照读专用出口（无客户端面：video-work 分享/渲染等）——
   *  快照路径本无租约门（不查 isLeaseServing——谓词满足=drain 已冲刷完成，快照读可正常返回 ✓）；
   *  谓词不满足（drain 进行中 spool 有帧/doc 常驻/在途批——PG 快照可能滞后）→ 活读 fallback
   *  （快照不可信定义性不使用）——活读经 withDoc 撞租约门 ⇒ drain 进行中 503（可达性边界 T9
   *  登记）+fallback 计数观测（低频边缘：卸载后 spool 未落库窗内外部分享请求触发 withDoc 装载）。
   *  计费/语义读（execution/video-project）走 readCanvas 活读——分源规则见其头注。 */
  async readCanvasSnapshotCached(projectId: string): Promise<DecodedSnapshot> {
    if (!this.gateway.isPersistedComplete(projectId)) {
      yjsSnapshotFallbackTotal.inc();
      return this.readCanvas(projectId);
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

  /** Y0b-2 T5（Z106/Z112）：doc 常驻透传——reaper 投影分治判据（非常驻=跳过投影+deferred 计数）。 */
  isDocResident(projectId: string): boolean {
    return this.gateway.isDocResident(projectId);
  }

  /** Y0c T9（A1·X9 批面受理门单点根修）：写意图受理门——三写入口（writeNodeData/writeExecStatus/
   *  writeBatch）共用单点（结构性防漏：第三处复制粘贴门=T8 批面回归的成因，本方法即终结形态）。
   *  判据与 throw 与提取前逐字一致：租约档（Y0a-3 R4——lease 失守/drain 期拒）+spool 熔断/容量
   *  熔断档（Y0a-2 X9）。真空档维持 in withDoc 不并入（与既有单写面语义严格一致）。
   *  Z40 基础设施档：throw ⇒ writeBatch 全批 thrown ⇒ 调用方按零交付退款。
   *  Y0c T15（A2）：实现单源迁 CollabResidencyService.assertWriteAdmitted（withSession(write)
   *  内部强制过门）——本方法一行委托（writer/测试消费面签名不变）。 */
  assertWriteAdmitted(): void {
    this.residency.assertWriteAdmitted();
  }

  /** 服务端写节点 data 字段（逐键写入，禁止整块替换）。写核心=applyWriteNodeDataToDoc 原语
   *  （Y0c T8 起 writeBatch 同事务逐 op 复用同一函数——两路径禁漂移）。
   *  Y0a-2（X9）：写意图受理门——spool 熔断/容量熔断期拒服务端写（503 瞬态，客户端重试）；
   *  Y0a-3（R4 裁定：必需项非冗余）：门前加租约档——lease 失守/drain 期同样拒（draining 不在
   *  isWritableOrDegraded 判据内，缺此档则失守期写会静默落 spool 等回灌）；
   *  readCanvas/withDoc 本体不 gate（PG 健康+数据在 PG——本地磁盘故障不放大成读不可用）。
   *  Y0c T9：受理门收编单点 assertWriteAdmitted（判据零变化纯去重）。
   *  Y0c T15（A2）：改道 withSession(write)——会话 acquire+SERVER_TRANSACT_ORIGIN 最外层事务
   *  （与 withDoc 同款）；degraded/租约档由 withSession 内部 assertWriteAdmitted 强制（写门单点
   *  随实现迁 residency——显式前置调用移除=同一门恰好执行一次）。 */
  async writeNodeData(projectId: string, nodeId: string, patch: Record<string, unknown>): Promise<WriteNodeDataResult> {
    return this.withSession(projectId, (doc) => applyWriteNodeDataToDoc(doc, nodeId, patch), { mode: 'write' });
  }

  /** B2/F2：exec map 服务端唯一写者（客户端零 exec 写——批0.5 起静态断言）。
   *  Y0b-2 T5（Z99/Z111）守卫代次化 fail-closed 两子句：
   *   ① typeof patch.attempts !== 'number' ⇒ drop（缺字段即拦——JS 语义 undefined<=5 为 false，
   *     单子句判据 fail-open；计数 exec_projection_dropped_total{cause='missing-attempts'}）；
   *   ② patch.attempts < stored.attempts ⇒ drop（严格更老一律丢**不看终态**——老代 error(1)
   *     不得覆盖新代 loading(2)——用户在 attempt2 在飞时看到 error 去点重试；cause='older-attempts'）；
   *   ③ equal ∧ stored 终态（done/error）⇒ drop（原意图——同代次迟到 loading 不倒退终态；
   *     skipped 非终态〔Z88〕——在飞 worker 的 done 照常落地）。
   *  stored.attempts ?? 0 兜改动前遗留 doc 条目（无 attempts 键视作 0 代）。
   *  Y0c T11（Z4/Z69 减法）：存在性守卫在原语层（单写面+批面双面生效）——节点不存在⇒不建条目
   *  （新孤儿结构性不可产生）+计数 exec_orphan_blocked_total（并列投影丢弃全集观测
   *  cause='node-deleted'——专项信号与全集观测并存）；签名不改（Promise<void>）。
   *  patch 语义：逐键补写不整块替换，v undefined 跳过。写核心=applyWriteExecStatusToDoc 原语
   *  （Y0c T8 起 writeBatch 同事务逐 op 复用同一函数——两路径禁漂移；T11 守卫已落原语层）。
   *  投影写失败 ⇒ 服务端有界退避重试（F2——批3 persist-status 同款机制落地前先 log，机制位留好）。 */
  async writeExecStatus(projectId: string, nodeId: string, patch: ExecStatusPatch): Promise<void> {
    // X9 写意图受理门 + Y0a-3 T8 租约档（同 writeNodeData——R4）；Y0c T9 收编单点 assertWriteAdmitted；
    // Y0c T15 改道 withSession(write)——受理门/degraded 档由会话内部强制（判据零变化）。
    await this.withSession(projectId, (doc) => {
      const outcome = applyWriteExecStatusToDoc(doc, nodeId, patch);
      if (!outcome.written && outcome.reason === 'node-deleted') {
        execOrphanBlockedTotal.inc();   // Y0c T11 Z4 专项信号
      }
      if (!outcome.written && outcome.reason !== 'terminal-superseded') {
        execProjectionDroppedTotal.inc({ cause: outcome.reason });   // 计数语义与提取前逐点一致（终态倒退静默不计数）
      }
    }, { mode: 'write' });
  }

  /** Y0b-2 T5（Z98 端口反转）：ArtifactProbe——settleStranded 的产物探测唯一出口（intent-reconcile
   *  零 readCanvas——资金分支禁入规则⑤；探针在 collab 侧=活读含 spool 帧无假阴性）。
   *  产物键白名单（Z102）：text=result / image=resultUrl / video=videoUrl；未知 kind 不裁决
   *  （unknownKind 标记——调用方计数告警，永不把"不知道"当"无产物"）；节点已删=found:false（无产物）。
   *  Z112：非常驻 doc 探测=强制装载（钱事实允许但有界）——装载计数归因 heap 闸。
   *  探针结果可能过期——CAS（rollbackStranded 三重守卫）才是权威。 */
  async probeArtifacts(projectId: string, items: Array<{ nodeId: string; kind: string }>): Promise<ArtifactProbeResult[]> {
    const wasResident = this.gateway.isDocResident(projectId);
    const { nodes } = await this.readCanvas(projectId);
    if (!wasResident) yjsDocLoadedByReconcilerTotal.inc();
    const dataOf = new Map(nodes.map((n: any) => [n.id as string, (n.data ?? {}) as Record<string, unknown>]));
    return items.map(({ nodeId, kind }) => {
      const data = dataOf.get(nodeId);
      if (data === undefined) return { nodeId, kind, found: false }; // 节点已删=无产物
      if (kind === 'text') return { nodeId, kind, found: data.result != null };
      if (kind === 'image') return { nodeId, kind, found: data.resultUrl != null };
      if (kind === 'video') return { nodeId, kind, found: data.videoUrl != null };
      return { nodeId, kind, found: false, unknownKind: true };
    });
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
 *  Y0c T9（Z5）：首段 undefined fail-fast（应用前全扫——单写面覆盖；writeBatch 同函数两路径禁漂移）。 */
export function applyWriteNodeDataToDoc(doc: Y.Doc, nodeId: string, patch: Record<string, unknown>): WriteNodeDataResult {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) throw undefinedPatchValueError('writeNodeData', k);
  }
  const entry = doc.getMap('nodes').get(nodeId);
  if (entry === undefined) return { written: false, reason: 'node-deleted' };   // Z44：交付判据类型化（原静默 return void）
  if (!(entry instanceof Y.Map)) return { written: false, reason: 'no-node-map' };
  let dataMap = entry.get('data');
  if (!(dataMap instanceof Y.Map)) {
    dataMap = new Y.Map();
    entry.set('data', dataMap);
  }
  for (const [k, v] of Object.entries(patch)) dataMap.set(k, v);
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
export function applyFillDocToDoc(doc: Y.Doc, nodes: readonly DocNodeRecord[], edges: readonly DocEdgeRecord[]): WriteNodeDataResult {
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
