// apps/api/src/modules/collab/collab-shrink.service.ts
// Y0b-4 T8（Q-G，spec §4.1④）：REST 瘦身——影子副本预演（Yjs 无逆 update：scratch 编码测量
// 达标才写活 doc）+TOCTOU（读+算+删收进 withDoc 同一同步段——fn 全同步契约见
// collab-document.service.ts transact 语义）+纯 recalibrate（空体同语义——不删内容也校准）
// +thaw 回灌（冻结态∧truth<softExit 时 thawQuota：解除冻结+SyncStep1 回灌+广播 ok——T8 外审
// Concern ① 冻结前置）+shrink 成功未 thaw 时 force 广播 bytes（偏差③——滞回带/未冻结客户端校准）。
// 全局信号量并发 1（编码 8MB×N 并发=CPU 尖峰——排队不拒绝；10s 排队超时 503 SHRINK_BUSY）。
import { BadRequestException, HttpException, Injectable, Inject, ServiceUnavailableException } from '@nestjs/common';
import * as Y from 'yjs';
import { QUOTA_DEFAULTS, readRecordsFromMaps } from '@flowweb/shared';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabDocumentService } from './collab-document.service';
import { CollabGateway } from './collab.gateway';
import { toDocLike } from './doc-like.util';
import { collabDocShrinkDuration, collabDocShrinkTotal } from './store.metrics';

/** 排队超时（进入执行位前的等待上界——已获执行位的请求不被打断；超时者从等待队列摘除不占执行位） */
export const SHRINK_QUEUE_TIMEOUT_MS = 10_000;

/** body：deleteNodeIds/keepNodeIds 二选一（都传 400）；空体或 recalibrate:true=纯校准 */
export interface ShrinkBody {
  deleteNodeIds?: string[];
  keepNodeIds?: string[];
  recalibrate?: boolean;
}

/** shrink 出口：deletedIds=实际删除集（客户端 undoManager.clear 数据源）；watermark=活文档
 *  再编码真值（白名单点③——客户端 localBytesSinceWatermark 重置基线）。 */
export interface ShrinkResult {
  result: 'ok' | 'recalibrated' | 'noop';
  watermark?: number;
  deletedIds?: string[];
  thawed: boolean;
}

/** 在 Y.Doc 上删节点+关联边（引用被删节点的边一并删——悬挂边防护）；doc.transact 包裹（单事务原子）。 */
function deleteNodesInDoc(doc: Y.Doc, nodeIds: string[]): void {
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
}

@Injectable()
export class CollabShrinkService {
  /** 全局信号量（简版 mutex）：locked+等待队列；wake 直接传递锁（release 原子移交下一位 */
  private locked = false;
  private waiters: Array<() => void> = [];

  constructor(
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabDocumentService) private readonly docs: CollabDocumentService,
    @Inject(CollabGateway) private readonly gateway: CollabGateway,
  ) {}

  async shrink(projectId: string, userId: string, body: ShrinkBody): Promise<ShrinkResult> {
    if (body.deleteNodeIds && body.keepNodeIds) {
      throw new BadRequestException('deleteNodeIds 与 keepNodeIds 二选一');
    }
    // 权限恒先于信号量/withDoc（排队位不占给未授权请求；perm 未过者不触达 doc）
    await this.perm.assertEditorWithTeam(projectId, userId);
    await this.acquire();
    try {
      return await this.docs.withDoc(projectId, (doc) => this.shrinkSync(projectId, doc, body));
    } finally {
      this.release();
    }
  }

  /** 同步段（TOCTOU 契约：读 records→解析 victims→影子预演→写活 doc→再编码，全程无 await——
   *  withDoc 的 transact 在库 saveMutex 锁内执行同步回调，事件循环不 yield=并发写结构性不可达）。 */
  private shrinkSync(pid: string, doc: Y.Doc, body: ShrinkBody): ShrinkResult {
    const start = Date.now();
    try {
      // 空体（三字段全无）=纯 recalibrate 同语义（Q-G"二选一或空体=纯 recalibrate"）
      const recalibrate = body.recalibrate === true || (body.deleteNodeIds === undefined && body.keepNodeIds === undefined);
      const records = readRecordsFromMaps(toDocLike(doc));
      const victims = recalibrate ? [] : resolveVictims(records, body);
      if (victims.length === 0 && !recalibrate) {
        collabDocShrinkTotal.inc({ result: 'noop' });
        return { result: 'noop', thawed: false };
      }
      let deletedIds: string[] = [];
      if (victims.length > 0) {
        // 影子预演（编码白名单点②）：scratch 应用删除→再编码测量——不达标不写活 doc（422 带实测值）
        const scratch = new Y.Doc();
        try {
          Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
          deleteNodesInDoc(scratch, victims);
          const shrunk = Y.encodeStateAsUpdate(scratch).byteLength;
          if (shrunk > this.gateway.activeQuota.maxDocBytes) {
            collabDocShrinkTotal.inc({ result: 'still-over' });
            throw new HttpException({ code: 'SHRINK_STILL_OVER', bytes: shrunk, limit: this.gateway.activeQuota.maxDocBytes }, 422);
          }
        } finally {
          scratch.destroy();
        }
        deleteNodesInDoc(doc, victims);   // 达标才写活 doc
        deletedIds = victims;
      }
      // 白名单点③：活文档再编码（预演与实际写之间理论并发窗的系统性低估防线）+truth 校准
      // （prevTruth=校准前值——偏差③ force 广播的"truth 实际变化"判定源）
      const truth = Y.encodeStateAsUpdate(doc).byteLength;
      const prevTruth = this.gateway.calibrateTruth(pid, truth);
      // 滞回出口评估（Concern ① 冻结前置）：仅配额冻结态才评估 thaw（未冻结 doc 校准成功≠冻结
      // 出口——原"truth<softExit 即 thawQuota"对未冻结 doc 产生 exit 计数虚高+全连接冗余
      // SyncStep1 往返+thawCooldown 30s 污染）；滞回带/以上不 thaw（假冻结出口：大 doc 校准
      // 不得误解除冻结）
      const thawed = this.gateway.isQuotaFrozen(pid)
        && truth < Math.floor(this.gateway.activeQuota.maxDocBytes * QUOTA_DEFAULTS.softExitRatio);
      if (thawed) this.gateway.thawQuota(pid);
      // 偏差③：shrink 成功未 thaw（滞回带/未冻结）→ 其他客户端 localDocBytes 需要新 truth——
      // force 广播（dedup 键 {state}:{frozen} 不含 bytes，state/frozen 未变会被吞）。仅 truth
      // 实际变化才 force（truth 未变=bytes 无变化，dedup 吞掉反而正确）；thaw 路径 thawQuota
      // 内部 broadcast('ok') 已带新 truth bytes，不重发。
      if (!thawed && prevTruth !== undefined && prevTruth !== truth) {
        this.gateway.broadcastDocStatusForce(pid);
      }
      const result = victims.length > 0 ? 'ok' : 'recalibrated';
      collabDocShrinkTotal.inc({ result });
      return { result, watermark: truth, deletedIds, thawed };
    } finally {
      collabDocShrinkDuration.observe((Date.now() - start) / 1000);   // 同步段耗时（不含信号量排队）
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked && this.waiters.length === 0) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const wake = () => {
        clearTimeout(timer);
        this.locked = true;
        resolve();
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(wake);
        if (i >= 0) this.waiters.splice(i, 1);   // 超时出队——不占队列执行位
        reject(new ServiceUnavailableException({ code: 'SHRINK_BUSY', retryAfterSeconds: 10 }));
      }, SHRINK_QUEUE_TIMEOUT_MS);
      this.waiters.push(wake);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();   // 锁直接移交（locked 保持 true）
    else this.locked = false;
  }
}

/** victims 解析（fn 内基于最新 records——事务外预解析=TOCTOU 红相）：deleteNodeIds 直接用
 *  （与存在集取交——不存在的 id 不产生假 ok）；keepNodeIds 反推（全集−keep）。 */
function resolveVictims(records: { nodes: Array<{ id: string }> }, body: ShrinkBody): string[] {
  const ids = records.nodes.map((n) => n.id);
  if (body.deleteNodeIds) {
    const wanted = new Set(body.deleteNodeIds);
    return ids.filter((id) => wanted.has(id));
  }
  const keep = new Set(body.keepNodeIds ?? []);
  return ids.filter((id) => !keep.has(id));
}
