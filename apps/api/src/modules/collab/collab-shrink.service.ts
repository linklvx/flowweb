// apps/api/src/modules/collab/collab-shrink.service.ts
// Y0b-4 T8（Q-G，spec §4.1④）：REST 瘦身——影子副本预演（Yjs 无逆 update：scratch 编码测量
// 达标才写活 doc）+TOCTOU（读+算+删收进 withDoc 同一同步段——fn 全同步契约见
// collab-document.service.ts transact 语义）+纯 recalibrate（空体同语义——不删内容也校准）
// +thaw 回灌（冻结态∧shrunk<softExit 时 thawQuota——Y0c T13 根修：删除档判据=影子预演 shrunk
// GC 已执行口径，recalibrate 档=truth；解除冻结+SyncStep1 回灌+广播 ok——T8 外审 Concern ① 冻结前置）
// +shrink 成功未 thaw 时 force 广播 bytes（偏差③——滞回带/未冻结客户端校准）。
// 全局信号量并发 1（编码 8MB×N 并发=CPU 尖峰——排队不拒绝；10s 排队超时 503 SHRINK_BUSY）。
// Y0b-4 T9（Q-H）：export-fresh——墓碑主导文档唯一出路（shrink 影子预演必 422 的真空出口）：
// 源团队/文件夹归属保留+in-flight latch 幂等+fillDoc 干净编码+落地编码校验（超限 warning 不阻断）。
// Y0b-4 T9a（Q-U v6）：vacuum 文档代际替换——七步协议 try/finally（⓪thaw 回灌→①freeze+terminal
// close→②serving 门→③quiesce 硬前置+清态→④离线全根真空→⑤等价断言→⑥lockProject 单事务）+
// 零连接窄版自动（gateway recheckFrozenDocs 判据链经 setVacuumRunner 回调注入）。
import { BadRequestException, HttpException, Injectable, Inject, NotFoundException, ServiceUnavailableException, Optional } from '@nestjs/common';
import * as Y from 'yjs';
import { randomUUID } from 'node:crypto';
import { QUOTA_DEFAULTS, toReadModel } from '@flowweb/shared';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CanvasService } from '../canvas/canvas.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from './collab-document.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabGateway, VACUUM_QUIESCE_POLL_MS, VACUUM_QUIESCE_TIMEOUT_MS } from './collab.gateway';
import { CollabMaintenanceService } from './collab-maintenance.service';
import { createCanvasDoc } from './canvas-doc.factory';
import { applyWriteOpsToDoc } from './collab-doc-writer.service';
import { collabDocExportFreshTotal, collabDocShrinkDuration, collabDocShrinkTotal, collabDocVacuumTotal, yjsDocBytes, yjsDocBytesOverThresholdTotal, DOC_BYTES_OVER_THRESHOLD_BYTES } from './store.metrics';

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

/** T9 export-fresh 出口：bytes=新副本落地编码（census④ 白名单点——fillDoc 后实测）；
 *  warning=新副本编码仍超限（墓碑已剥离但内容真大——告知不阻断，用户决策域）。 */
export interface ExportFreshResult {
  result: 'ok';
  projectId: string;
  name: string;
  bytes: number;
  warning?: 'still-over-limit';
}

/** T9a vacuum 出口（Q-U v6）：generation=新代数（ok 时）；bytes=真空编码字节（ok 时）。
 *  中止档（equivalence-failed/unsupported-root/quiesce-timeout/generation-drift〔T12 收口
 *  I1.2〕）DB 零变更+状态全恢复；skip-low-residue=零连接自动路径残留不足跳过；
 *  **Y1c T27 委托档新增**：in-flight-executions（切代前置=无在飞执行——v5.4⑲）/maintenance-active
 *  （维护状态机在跑——单换代入口互斥）/skip-no-doc（懒建档无 CanvasDoc 头——无真空面）；
 *  error=意外（throw 前计数）。 */
export interface VacuumResult {
  result: 'ok' | 'skip-low-residue' | 'equivalence-failed' | 'unsupported-root' | 'quiesce-timeout' | 'generation-drift' | 'error'
    | 'in-flight-executions' | 'maintenance-active' | 'skip-no-doc';
  generation?: number;
  bytes?: number;
}

@Injectable()
export class CollabShrinkService {
  /** 全局信号量（简版 mutex）：locked+等待队列；wake 直接传递锁（release 原子移交下一位 */
  private locked = false;
  private waiters: Array<() => void> = [];

  /** T9 in-flight latch（键 `${userId}:${pid}`）：在飞导出复用同 Promise（create 调用数=1 不变量
   *  ——连续点击不建多项目）；终态即清（finally——失败后可重试）。 */
  private readonly exportInFlight = new Map<string, Promise<ExportFreshResult>>();

  /** T9a vacuum 信号量尾（与 shrink gate 分立——同款并发 1 语义；vacuum 自带 30s quiesce 上界
   *  不另设排队超时）。Promise 链形态：later 者排队等前者 settle。 */
  private vacuumGateTail: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabDocumentService) private readonly docs: CollabDocumentService,
    @Inject(CollabGateway) private readonly gateway: CollabGateway,
    @Inject(CanvasService) private readonly canvas: CanvasService,   // T9：副本创建（真实签名 create(name,folderId,userId,teamId?)）
    @Inject(PrismaService) private readonly prisma: PrismaService,   // T9：源项目元数据（name/teamId/folderId）
    @Inject(CanvasDocUpdateRepository) private readonly docRepo: CanvasDocUpdateRepository,   // T9a：vacuum ④ 装载读唯一入口+⑥ 代际替换事务（契约 1/10——repository 单源）
    // Y1c T27：vacuum 委托维护状态机（单换代入口——T12 收口）。@Optional=直构旧形态兼容（零委托面）。
    @Optional() @Inject(CollabMaintenanceService) private readonly maintenance?: CollabMaintenanceService | null,
  ) {
    // Y0b-4 T9a：零连接窄版自动 vacuum 回调注入（gateway↔service 循环依赖最小形态——service 单向
    // 持 gateway，gateway 经注入的 runner 反调；无 userId=绕过权限门〔触发判据在 recheck 判据链〕）
    this.gateway.setVacuumRunner((pid) => this.vacuumAuto(pid));
    // Y1c T27：SnapshotDocCache 失效晚绑（maintenance 持 gateway 构造面成 DI 环——本构造器双面在手）
    this.maintenance?.attachSnapshotInvalidator((pid) => this.docs.invalidateSnapshotCache(pid));
  }

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

  /** T9（Q-H，spec §4.1④）：导出到新项目——墓碑主导文档（反复粘贴→删除使 GC 壳/delete set 占
   *  编码主体，shrink 影子预演必 422）唯一出路。in-flight latch：同 user:pid 在飞请求复用同
   *  Promise（新 project 数=1——用户最焦虑时刻不制造垃圾数据）；检查→登记无 await 窗（首个
   *  请求同步占位，后续并发必命中）。不走 shrink 信号量（读段+fill 段均为常规 withDoc 事务，
   *  latch 已限同 user:pid 并发=1）。 */
  async exportFresh(projectId: string, userId: string): Promise<ExportFreshResult> {
    await this.perm.assertEditorWithTeam(projectId, userId);   // 权限恒先（shrink 同门）
    const key = `${userId}:${projectId}`;
    const inflight = this.exportInFlight.get(key);
    if (inflight) {
      collabDocExportFreshTotal.inc({ result: 'in-flight' });   // 并发去重命中（与主请求 ok 分列计）
      return inflight;
    }
    const p = this.exportFreshRun(projectId, userId).finally(() => this.exportInFlight.delete(key));
    this.exportInFlight.set(key, p);
    return p;
  }

  /** 导出执行体：源活读（withDoc——发起方必有 WS⇒doc 常驻）→源元数据（CanvasProject.name/teamId
   *  +Template.folderId——projectId @unique 1:1）→同团队建副本（真实签名 create(name, folderId,
   *  userId, teamId)——不传 teamId=落默认团队=协作者全员失访，外审 P1-6）→fillDoc 干净编码（墓碑
   *  /GC 壳不随行——新 doc 只含 records 真值）→落地编码校验。fillDoc 走 toDocLike 适配（Y.Doc 无
   *  createMap，裸传 throw 被 catch 吞=断言真空——adversarial-readers 先例）；新 doc 装载=空画布
   *  合法档（无戳∧零节点→装载自愈点 stamp，gateway loadDocument 单源——fill 前已有戳）。 */
  private async exportFreshRun(pid: string, userId: string): Promise<ExportFreshResult> {
    const records = await this.docs.withDoc(pid, (doc) => toReadModel(doc));
    const src = await this.prisma.canvasProject.findUnique({
      where: { id: pid },
      include: { templates: { select: { folderId: true } } },
    });
    if (!src) throw new NotFoundException('源项目不存在');
    const created = await this.canvas.create(
      `${src.name}(瘦身副本)`, src.templates[0]?.folderId ?? null, userId, src.teamId,
    );
    const bytes = await this.docs.withDoc(created.projectId, (doc) => {
      // Y0c T12 直写收编：fillDoc 改道 doc 域应用核心（与 writeBatch 同一 Z108/schema 门单点）。
      // T12 勘正：fill 结果 fail-fast——written:false=契约违规（内部 Error throw，消息含 reason 与
      // op 索引），禁把空 doc 编码字节当成功上报。
      const [fill] = applyWriteOpsToDoc(doc, [{ op: 'fillDoc', nodes: records.nodes, edges: records.edges }]);
      if (!fill.written) throw new Error(`exportFresh fillDoc 未写入（契约违规 fail-fast）: index=${fill.index} reason=${fill.reason}——空 doc 编码不得当成功上报`);
      return Y.encodeStateAsUpdate(doc).byteLength;   // 落地编码校验（census④ 生产白名单点——Q-H；同事务不变）
    });
    collabDocExportFreshTotal.inc({ result: 'ok' });
    const result: ExportFreshResult = { result: 'ok', projectId: created.projectId, name: created.name, bytes };
    if (bytes > this.gateway.activeQuota.maxDocBytes) result.warning = 'still-over-limit';   // 超限告知不阻断
    return result;
  }

  /** 同步段（TOCTOU 契约：读 records→解析 victims→影子预演→写活 doc→再编码，全程无 await——
   *  withDoc 的 transact 同步调用回调、事件循环不 yield〔hocuspocus DirectConnection.transact
   *  是裸 Yjs 事务，saveMutex 只包 storeDocument〕=并发写结构性不可达）。 */
  private shrinkSync(pid: string, doc: Y.Doc, body: ShrinkBody): ShrinkResult {
    const start = Date.now();
    try {
      // 空体（三字段全无）=纯 recalibrate 同语义（Q-G"二选一或空体=纯 recalibrate"）
      const recalibrate = body.recalibrate === true || (body.deleteNodeIds === undefined && body.keepNodeIds === undefined);
      const records = toReadModel(doc);
      const victims = recalibrate ? [] : resolveVictims(records, body);
      if (victims.length === 0 && !recalibrate) {
        collabDocShrinkTotal.inc({ result: 'noop' });
        return { result: 'noop', thawed: false };
      }
      let deletedIds: string[] = [];
      let shrunkBytes: number | undefined;   // 删除档影子预演值（GC 已执行口径）——thaw 判据用（Y0c T13 根修 Z120）
      if (victims.length > 0) {
        // 影子预演（编码白名单点②）：scratch 应用删除→再编码测量——不达标不写活 doc（422 带实测值）。
        // Y0c T12 直写收编：预演与活写同走 applyWriteOpsToDoc 单点（预演=即将写的内容同源最强形态）。
        const scratch = createCanvasDoc();
        try {
          Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
          applyWriteOpsToDoc(scratch, [{ op: 'deleteNodes', nodeIds: victims }]);
          shrunkBytes = Y.encodeStateAsUpdate(scratch).byteLength;
          if (shrunkBytes > this.gateway.activeQuota.maxDocBytes) {
            collabDocShrinkTotal.inc({ result: 'still-over' });
            throw new HttpException({ code: 'SHRINK_STILL_OVER', bytes: shrunkBytes, limit: this.gateway.activeQuota.maxDocBytes }, 422);
          }
        } finally {
          scratch.destroy();
        }
        applyWriteOpsToDoc(doc, [{ op: 'deleteNodes', nodeIds: victims }]);   // 达标才写活 doc（同源原语）
        deletedIds = victims;
      }
      // 白名单点③：活文档再编码（预演与实际写之间理论并发窗的系统性低估防线）+truth 校准
      // （prevTruth=校准前值——偏差③ force 广播的"truth 实际变化"判定源）
      const truth = Y.encodeStateAsUpdate(doc).byteLength;
      // Y0b-5 T10 锚③：yjs_doc_bytes 直方图 observe 同一编码值（零新增编码——observe 挂既有事件）
      yjsDocBytes.observe(truth);
      if (truth > DOC_BYTES_OVER_THRESHOLD_BYTES) yjsDocBytesOverThresholdTotal.inc();
      const prevTruth = this.gateway.calibrateTruth(pid, truth);
      // 滞回出口评估（Concern ① 冻结前置）：仅真冻结态（quotaFrozenDocs——isQuotaFrozen 收窄，
      //  freezePending 确认窗不算：pending 定时器自收敛，无 enter 不出 exit=计数配对不虚高）才
      // 评估 thaw；滞回带/以上不 thaw（假冻结出口：大 doc 校准不得误解除冻结）。
      // Y0c T13 根修（Z120/plan P2）：删除档判据用影子预演 shrunkBytes——活 doc truth 含墓碑壳
      // （withDoc 嵌套事务 GC 滞后）系统性偏大，GC 已执行的预演值才是解除时点的真实占用；
      // recalibrate 档（victims=0 无删除）无 GC 滞后，truth 即准确——?? truth 分界。
      const thawed = this.gateway.isQuotaFrozen(pid)
        && (shrunkBytes ?? truth) < Math.floor(this.gateway.activeQuota.maxDocBytes * QUOTA_DEFAULTS.softExitRatio);
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
        reject(new ServiceUnavailableException({ code: 'SHRINK_BUSY', retryAfterSeconds: SHRINK_QUEUE_TIMEOUT_MS / 1000 }));
      }, SHRINK_QUEUE_TIMEOUT_MS);
      timer.unref?.();   // 定时器不阻进程退出（gateway 定时器惯例——fake timers 下照常触发，auth-defense I-2 先例）
      this.waiters.push(wake);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();   // 锁直接移交（locked 保持 true）
    else this.locked = false;
  }

  // ===== Y0b-4 T9a（Q-U v6）：vacuum 文档代际替换——七步协议 =====

  /** REST 显式触发（T11 二次确认后到达）：权限恒先（shrink/export-fresh 同门）；不做 residue
   *  判定（用户确认即执行）。自动路径（recheckFrozenDocs 零连接窄版）走 vacuumAuto。 */
  vacuum(pid: string, userId: string): Promise<VacuumResult> {
    return this.perm.assertEditorWithTeam(pid, userId).then(() => this.runVacuumExclusive(pid));
  }

  /** 零连接窄版自动入口：residue 判据 re-verify（recheck 判定与执行时点间的竞态兜底——
   *  残留不足即 skip，REST 显式路径不做此判定）+vacuumGate 串行（并发 1）。 */
  async vacuumAuto(pid: string): Promise<VacuumResult> {
    if (this.gateway.docResidueOf(pid) <= Math.floor(this.gateway.activeQuota.maxDocBytes * 0.6)) {
      collabDocVacuumTotal.inc({ result: 'skip-low-residue' });
      return { result: 'skip-low-residue' };
    }
    return this.runVacuumExclusive(pid);
  }

  /** vacuum 信号量（并发 1——与 shrink gate 分立；后者继前者排队）。 */
  private runVacuumExclusive(pid: string): Promise<VacuumResult> {
    const run = this.vacuumGateTail.then(() => this.vacuumCore(pid), () => this.vacuumCore(pid));
    this.vacuumGateTail = run.catch(() => {});
    return run;
  }

  /** 七步协议体（**Y1c T27 起委托维护状态机**——spec §6.6 单换代入口：vacuum 只做 rebuild payload；
   *  REQUESTED 行级关闸+FREEZING 4413+DRAINING〔spoolHeadSeq==pgSeq+in-flight drain+常驻释放〕
   *  +SWITCHING 单事务〔vacuumReplace DB 族+同事务 stage 写〕+事务后 close 4410/切 WAL+VERIFYING+COMPLETED
   *  全在 CollabMaintenanceService——「无在飞执行」切代前置对 vacuum 同样生效〔v5.4⑲〕）。
   *  中止映射：payload abort〔unsupported-root/equivalence-failed〕/drain 超时〔quiesce-timeout〕/
   *  generation 漂移〔generation-drift〕=状态机 ABORTED（SWITCHING 前净 abort 解冻——P1-2 中止恢复
   *  契约保持：禁 FAILED 只读滞留）；其余基础设施失败=error 档（FAILED 只读+人工 resume 归 REST 面）。 */
  private async vacuumCore(pid: string): Promise<VacuumResult> {
    const done = (r: VacuumResult): VacuumResult => {
      if (r.result !== 'error') collabDocVacuumTotal.inc({ result: r.result });
      return r;
    };
    if (!this.maintenance) {
      // 委托面缺席=结构性配置错误（生产 DI 恒注入；直构旧形态零委托面禁跑换代）
      collabDocVacuumTotal.inc({ result: 'error' });
      throw new Error('vacuum 委托面缺席（CollabMaintenanceService 未注入——单换代入口结构性要求，T27）');
    }
    const req = await this.maintenance.request({
      projectId: pid,
      idempotencyKey: `vacuum-${pid}-${randomUUID()}`,
      requestedBy: 'vacuum',
      source: 'vacuum',
      requireNoInFlight: true,   // 切代前置=无在飞执行（v5.4⑲——对 vacuum 同样生效）
    });
    if (!req.ok) {
      if (req.code === 'IN_FLIGHT_EXECUTIONS') return done({ result: 'in-flight-executions' });
      if (req.code === 'MAINTENANCE_ACTIVE') return done({ result: 'maintenance-active' });
      if (req.code === 'CANVAS_DOC_MISSING') return done({ result: 'skip-no-doc' });   // 懒建档项目零 doc 态——无真空面（旧链 create 分支语义收窄）
      return done({ result: 'error' });
    }
    let vacuumBytes = 0;
    const run = await this.maintenance.run(req.maintenanceId, {
      drainBudgetMs: VACUUM_QUIESCE_TIMEOUT_MS,
      onDrainTimeout: 'abort',   // drain 超时=quiesce-timeout 净 abort（P1-2：禁 FAILED 只读滞留——vacuum 面中止恢复）
      buildRebuildPayload: async ({ hydrate }) => {
        // ④⑤ 段（vacuum 只做 rebuild payload）：离线全根真空+等价断言——rebuildVacuumDoc/vacuumEquivalent
        // 单源仍在 DR（④ 装载读=状态机 EXPORTING 侧 hydrate 透传——loadForHydration 单源不重读）。
        const oldDoc = createCanvasDoc();
        try {
          if (hydrate.state) Y.applyUpdate(oldDoc, new Uint8Array(hydrate.state));
          for (const u of hydrate.updates) Y.applyUpdate(oldDoc, new Uint8Array(u));
          const newDoc = this.gateway.rebuildVacuumDoc(oldDoc);
          if (newDoc === null) return { ok: false as const, reason: 'unsupported-root' };   // 非 Map 根——DB 零变更
          try {
            if (!this.gateway.vacuumEquivalent(oldDoc, newDoc)) return { ok: false as const, reason: 'equivalence-failed' };   // 把信任 fillDoc 变成验证 fillDoc
            const state = Buffer.from(Y.encodeStateAsUpdate(newDoc));
            vacuumBytes = state.length;
            return { ok: true as const, state, updateRowCount: hydrate.updates.length };
          } finally { newDoc.destroy(); }
        } finally { oldDoc.destroy(); }
      },
    });
    if (run.result === 'completed') return done({ result: 'ok', generation: run.generation, bytes: vacuumBytes });
    if (run.result === 'aborted') {
      const detail = run.detail ?? 'generation-drift';
      if (detail === 'drain-timeout') return done({ result: 'quiesce-timeout' });   // 禁降级继续（三态非空即中止——旧 ③ 段语义承袭）
      if (detail === 'unsupported-root' || detail === 'equivalence-failed' || detail === 'generation-drift') return done({ result: detail });
      return done({ result: 'error' });
    }
    return done({ result: 'error' });   // failed/not-found（基础设施失败——FAILED 只读面归 REST 维护操作者处置）
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
