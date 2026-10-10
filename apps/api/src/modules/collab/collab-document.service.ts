import { Injectable, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as Y from 'yjs';
import { readRecordsFromMaps, ensureSchemaVersion } from '@flowweb/shared';
import { CollabGateway } from './collab.gateway';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { toDocLike } from './doc-like.util';
import { yjsSnapshotFallbackTotal, yjsDocLoadedByReconcilerTotal } from './store.metrics';
import { execProjectionDroppedTotal } from '../execution/exec.metrics';
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
export class CollabDocumentService {
  private readonly logger = new Logger(CollabDocumentService.name);
  /** Y0b-2 T3：进程内 TTL 单飞缓存（纯内存原语字段自建——跨请求缓存归 Redis 层，本层=并发窗去重） */
  private readonly snapshotCache = new SnapshotDocCache();

  constructor(
    @Inject(CollabGateway) private readonly gateway: CollabGateway,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
  ) {}

  /** Q1 单实例铁律：业务服务端写 doc 一律走 Hocuspocus 直连；try/finally disconnect 保证 unload flush（S7）。
   *  Y0a-3（P0-1 三入口③）：withDoc 首行租约门——lease 失守/drain 期早退 503（不 openDirectConnection，
   *  不触发装载重连风暴）。消息非协议形态（通用入口，客户端不按 body.code 分型）。 */
  async withDoc<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
    if (!this.gateway.isLeaseServing()) throw new ServiceUnavailableException('collab not serving (lease not held)');   // P0-1 三入口③
    const connection = await this.gateway.server.hocuspocus.openDirectConnection(`project:${projectId}`);
    try {
      let result: T;
      let pending: Promise<void> | undefined;
      await connection.transact((doc: Y.Doc) => {
        // transact 不 await 异步回调（hocuspocus 4.6.0 DirectConnection.transact 同步调用且不 await）：
        // 同步 fn 原样在事务内完成；异步 fn 捕获其 Promise 在事务外 await——
        // 否则回调挂起时即返回 undefined 且 finally 提前拆直连（readCanvas SV 等待路径依赖此语义）
        const r = fn(doc);
        if (r instanceof Promise) pending = r.then((v) => { result = v; });
        else result = r;
      });
      if (pending) await pending;
      return result!;
    } finally {
      await connection.disconnect({ unloadImmediately: true });   // Y0a-4/P24：A6 锚=Connection 级旋钮（B20 双旋钮之一）——B26：库默认即 true，显式 pin=防升级翻转的文档锚
    }
  }

  /** doc → plain nodes/edges。
   *  Y0b-2 T3（分源规则钉死）：计费/语义读统一走本活读出口（withDoc——执行恒活读：发起方必有
   *  WS ⇒ doc 常驻 ⇒ 零装载成本）；快照出口 readCanvasSnapshotCached
   *  仅无客户端面（video-work 分享/渲染等）。
   *  Y0b-2 T7：sv 参数/SV 等待退役——客户端同步判定移受理端点 SV 支配门（sync-admission.ts），
   *  执行读恒活读无需客户端 SV。
   *  O0a-2 收编：读实现单源 shared readRecordsFromMaps（docShape——api 读≡web 读，出口=作者态
   *  DocNodeRecord：doc 缺键→出口无键，null 消除在读侧自做；Y.Doc→DocLike 适配见 doc-like.util）。
   *  O0b-0 版本门 v2.1（第五行 REST fail-closed）：ensureSchemaVersion 从全量 doc 读 meta（不依赖
   *  sv 差量）——v1 档/无戳∧有节点拒（明确信息，非按 abs 解释 rel 静默错位）；无戳∧零节点放行
   * （REST 不盖戳——空画布合法档）。挂 sv 等待之前：旧档立即拒，不等 3s。 */
  async readCanvas(projectId: string): Promise<{ nodes: any[]; edges: any[] }> {
    return this.withDoc(projectId, async (doc) => {
      ensureSchemaVersion(toDocLike(doc));
      return readRecordsFromMaps(toDocLike(doc));
    });
  }

  /** Y0b-2 T7：服务端 doc SV 单源出口——受理端点 SV 支配门（assertSyncAdmitted）唯一读点。
   *  withDoc 内存级（发起方必有 WS⇒doc 常驻⇒零装载成本）。 */
  async readServerSV(projectId: string): Promise<Uint8Array> {
    return this.withDoc(projectId, (doc) => Y.encodeStateVector(doc));
  }

  /** Y0b-2 T3：快照解码单源——readSnapshotOnly 行集→同 doc 重放→版本门→投影；快照缓存 loader
   *  与直接快照读共用此实现（防两处解码漂移）。不经 openDirectConnection/不装载/不触 store/compact；
   *  陈旧度=进行中编辑未含（去抖窗级，spec §9.9 登记）。 */
  private async decodeSnapshot(projectId: string): Promise<DecodedSnapshot> {
    const { state, updates } = await this.repo.readSnapshotOnly(projectId);
    const doc = new Y.Doc();
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

  /** Y0b-2 T3：快照缓存失效——video-work process 处理完成后调（进程内层不跨请求存活，
   *  跨请求缓存归 Redis 300s 层）。 */
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

  /** 服务端写节点 data 字段（逐键写入，禁止整块替换）。
   *  Y0a-2（X9）：写意图受理门——spool 熔断/容量熔断期拒服务端写（503 瞬态，客户端重试）；
   *  Y0a-3（R4 裁定：必需项非冗余）：门前加租约档——lease 失守/drain 期同样拒（draining 不在
   *  isWritableOrDegraded 判据内，缺此档则失守期写会静默落 spool 等回灌）；
   *  readCanvas/withDoc 本体不 gate（PG 健康+数据在 PG——本地磁盘故障不放大成读不可用）。 */
  async writeNodeData(projectId: string, nodeId: string, patch: Record<string, unknown>): Promise<WriteNodeDataResult> {
    if (!this.gateway.isLeaseServing() || this.gateway.isWritableOrDegraded() !== 'ok')
      throw new ServiceUnavailableException('collab degraded: lease or spool');
    return this.withDoc(projectId, (doc) => {
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
    });
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
   *  patch 语义：逐键补写不整块替换，v undefined 跳过。
   *  投影写失败 ⇒ 服务端有界退避重试（F2——批3 persist-status 同款机制落地前先 log，机制位留好）。 */
  async writeExecStatus(projectId: string, nodeId: string, patch: ExecStatusPatch): Promise<void> {
    // X9 写意图受理门 + Y0a-3 T8 租约档（同 writeNodeData——R4）
    if (!this.gateway.isLeaseServing() || this.gateway.isWritableOrDegraded() !== 'ok')
      throw new ServiceUnavailableException('collab degraded: lease or spool');
    await this.withDoc(projectId, (doc) => {
      if (typeof patch.attempts !== 'number') {
        execProjectionDroppedTotal.inc({ cause: 'missing-attempts' });
        return;
      }
      const exec = doc.getMap('exec');
      let m = exec.get(nodeId) as Y.Map<any> | undefined;
      if (m instanceof Y.Map) {
        const storedAttempts = typeof m.get('attempts') === 'number' ? (m.get('attempts') as number) : 0;
        if (patch.attempts < storedAttempts) {
          execProjectionDroppedTotal.inc({ cause: 'older-attempts' });
          return;
        }
        const s = m.get('status');
        if (patch.attempts === storedAttempts && (s === 'done' || s === 'error')) return; // 同代次终态不倒退
      } else {
        m = new Y.Map();
        exec.set(nodeId, m);
      }
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v);
    });
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
