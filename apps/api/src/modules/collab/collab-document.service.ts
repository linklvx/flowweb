import { Injectable, Inject, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as Y from 'yjs';
import { readRecordsFromMaps, ensureSchemaVersion } from '@flowweb/shared';
import { CollabGateway } from './collab.gateway';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { toDocLike } from './doc-like.util';
import { svSatisfied } from './sv.util';
import { svWaitTimeoutTotal } from './sv-wait.metrics';
import { yjsSnapshotFallbackTotal } from './store.metrics';
import { SnapshotDocCache, type DecodedSnapshot } from './snapshot-doc-cache';

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

  /** doc → plain nodes/edges；sv 提供时等待 server doc 追上（超时降级不抛错，spec 3.1）。
   *  Y0b-2 T3（分源规则钉死）：计费/语义读统一走本活读出口（withDoc——执行恒活读：发起方必有
   *  WS ⇒ doc 常驻 ⇒ 零装载成本；分源判定在受理端点门）；快照出口 readCanvasSnapshotCached
   *  仅无客户端面（video-work 分享/渲染等）。
   *  O0a-2 收编：读实现单源 shared readRecordsFromMaps（docShape——api 读≡web 读，出口=作者态
   *  DocNodeRecord：doc 缺键→出口无键，null 消除在读侧自做；Y.Doc→DocLike 适配见 doc-like.util）。
   *  O0b-0 版本门 v2.1（第五行 REST fail-closed）：ensureSchemaVersion 从全量 doc 读 meta（不依赖
   *  sv 差量）——v1 档/无戳∧有节点拒（明确信息，非按 abs 解释 rel 静默错位）；无戳∧零节点放行
   * （REST 不盖戳——空画布合法档）。挂 sv 等待之前：旧档立即拒，不等 3s。 */
  async readCanvas(projectId: string, sv?: Uint8Array, timeoutMs = 3000): Promise<{ nodes: any[]; edges: any[] }> {
    return this.withDoc(projectId, async (doc) => {
      ensureSchemaVersion(toDocLike(doc));
      if (sv && !svSatisfied(Y.encodeStateVector(doc), sv)) {
        const ok = await this.waitForSV(doc, sv, timeoutMs);
        if (!ok) {
          this.logger.warn(`SV wait timeout projectId=${projectId}`);
          svWaitTimeoutTotal.inc();
        }
      }
      return readRecordsFromMaps(toDocLike(doc));
    });
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

  private waitForSV(doc: Y.Doc, sv: Uint8Array, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const check = () => svSatisfied(Y.encodeStateVector(doc), sv);
      const onUpdate = () => { if (check()) { cleanup(); resolve(true); } };
      const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); doc.off('update', onUpdate); };
      doc.on('update', onUpdate);
      if (check()) { cleanup(); resolve(true); } // 注册后立即检查——函数自洽，不依赖外层守卫时序
    });
  }

  /** 服务端写节点 data 字段（逐键写入，禁止整块替换）。
   *  Y0a-2（X9）：写意图受理门——spool 熔断/容量熔断期拒服务端写（503 瞬态，客户端重试）；
   *  Y0a-3（R4 裁定：必需项非冗余）：门前加租约档——lease 失守/drain 期同样拒（draining 不在
   *  isWritableOrDegraded 判据内，缺此档则失守期写会静默落 spool 等回灌）；
   *  readCanvas/withDoc 本体不 gate（PG 健康+数据在 PG——本地磁盘故障不放大成读不可用）。 */
  async writeNodeData(projectId: string, nodeId: string, patch: Record<string, unknown>) {
    if (!this.gateway.isLeaseServing() || this.gateway.isWritableOrDegraded() !== 'ok')
      throw new ServiceUnavailableException('collab degraded: lease or spool');
    await this.withDoc(projectId, (doc) => {
      const nodeMap = doc.getMap('nodes').get(nodeId);
      if (!(nodeMap instanceof Y.Map)) return;
      let dataMap = nodeMap.get('data');
      if (!(dataMap instanceof Y.Map)) {
        dataMap = new Y.Map();
        nodeMap.set('data', dataMap);
      }
      for (const [k, v] of Object.entries(patch)) dataMap.set(k, v);
    });
  }

  /** B2/F2：exec map 服务端唯一写者（客户端零 exec 写——批0.5 起静态断言）。
   *  写前幂等读：同 nodeId 已终态（done/error）→ 跳过（迟到 loading 不倒退终态）。
   *  patch 语义：逐键补写不整块替换，v undefined 跳过。
   *  投影写失败 ⇒ 服务端有界退避重试（F2——批3 persist-status 同款机制落地前先 log，机制位留好）。 */
  async writeExecStatus(projectId: string, nodeId: string, patch: Record<string, unknown>) {
    // X9 写意图受理门 + Y0a-3 T8 租约档（同 writeNodeData——R4）
    if (!this.gateway.isLeaseServing() || this.gateway.isWritableOrDegraded() !== 'ok')
      throw new ServiceUnavailableException('collab degraded: lease or spool');
    await this.withDoc(projectId, (doc) => {
      const exec = doc.getMap('exec');
      let m = exec.get(nodeId) as Y.Map<any> | undefined;
      if (m instanceof Y.Map) {
        const s = m.get('status');
        if (s === 'done' || s === 'error') return; // 终态不倒退
      } else {
        m = new Y.Map();
        exec.set(nodeId, m);
      }
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v);
    });
  }
}
