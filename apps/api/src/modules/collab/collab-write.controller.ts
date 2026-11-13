// apps/api/src/modules/collab/collab-write.controller.ts
// Y0c T27→Y1c T32：worker 内部写端点（P8 单端点；api 进程内直调 CollabDocumentService——经本模块
// DI，非 HTTP 自环）。T32 改造：write-batch 端点（doc 批写——writeExecStatus/deleteExecOrphans op
// 词汇）随 doc.exec 读写链退役删除（词汇表六 op 收四=纯进程内维护面 writeBatch；worker 通道无合法
// op）。本端点=**exec 状态投影写**（RuntimeEvent feed——CollabDocumentService.writeExecStatus）：
// worker 进程（HttpCollabWritePort）的 exec 投影写改道此面，零 doc 写（T22 切交付后唯一语义）。
// 鉴权=WorkerWriteAuthGuard（bearer WORKER_WRITE_TOKEN 传输层）+T13 作用域化收口（plan v11.2 ①）：
//  ①x-worker-scope HMAC 验签（projectId+intentRowId+execSeq+exp 绑定——伪造他 project/intent/
//    execSeq 的写请求 403；裸项目档〔pre-claim 断言路径〕=仅 projectId 绑定）；
//  ②全档绑定：intent 行在场∧projectId/execSeq 匹配∧nodeId===intent.nodeId（伪造他意图/代际即 403）；
//  ③status 黑名单=done 禁经 worker 通道（WORKER_EXEC_DONE_FORBIDDEN——exec done=投影 poller
//    deliverArtifact 复合事务专写〔exec.artifact+exec.status(done) 同事务〕——Z99 同代终态不倒退
//    守卫的通道级前置；〔loading/skipped/error〕=claim 期在案面合法）。
// dev 未设 WORKER_WRITE_TOKEN=fail-open（guard 同款）；production 未设=进程拒启（env.ts 单点）。
// AuthGuard 会话面由 auth.guard 精确谓词放行 POST exec-status（静态路径全等）。
import { BadRequestException, Body, Controller, ForbiddenException, Inject, Post, UseGuards, Headers } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NoTransform } from '../../common/decorators/no-transform.decorator';
import { CollabDocumentService } from './collab-document.service';
import { CollabSpoolService } from './collab-spool.service';
import { CollectMediaRefsDto } from './dto/collect-media-refs.dto';
import { PurgeScopeDto } from './dto/purge-scope.dto';
import { DeletionBarrierDto } from './dto/deletion-barrier.dto';
import { DeletionBarrierService } from './deletion-barrier.service';
import { mapPrepareToWire } from './deletion-barrier.port';
import { WorkerWriteAuthGuard } from './worker-write-auth.guard';
import { verifyWorkerScopeToken, WORKER_SCOPE_HEADER, type WorkerScopePayload } from './worker-scope-token';

/** T32：worker 通道 exec status 黑名单（本地常量——shared WORKER_EXEC_FORBIDDEN_STATUSES 随
 *  write-batch 词汇退役删除，语义原样迁移：done=deliverArtifact 复合事务专写）。 */
const WORKER_EXEC_DONE_FORBIDDEN = new Set<string>(['done']);

@SkipThrottle()   // worker 内部通道不吃共享 300/min 桶（/api/ready、读端点同惯例）
@Controller('api/collab/doc')
export class CollabWriteController {
  constructor(
    @Inject(CollabDocumentService) private readonly docs: CollabDocumentService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollabSpoolService) private readonly spool: CollabSpoolService,
    @Inject(DeletionBarrierService) private readonly deletionBarrier: DeletionBarrierService,
  ) {}

  /** C4-c1（plan C4——project-erasure）：未 reconcile 引用采集端点（erasure worker PURGING_DB
   *  独占判别的 doc 扫描终裁面——api 进程活 doc 域；worker 跨进程经 httpMediaRefsCollector 调本面）。
   *  body={teamId, excludeProjectId, mediaIds}→{referenced}（mediaIds 子集）；守卫/限批/503 语义见
   *  CollabSpoolService.collectProjectMediaRefs（限批+isLeaseServing——容量事故防护；**docs 端口
   *  per-call 传入**——spool 构造器注入=DI 环〔gateway→spool 回环〕）；Bearer=WORKER_WRITE_TOKEN
   *  传输层（readCanvas 读族同款——非资金写面无 scope 令牌需求）。 */
  @Post('media-refs')
  @NoTransform()
  @UsePipes(new ValidationPipe({ whitelist: true }))   // body-param-ratchet v5 合规形态（DTO-class+pipe——inline/无-pipe 两档棘轮均禁新增）
  @UseGuards(WorkerWriteAuthGuard)
  async collectMediaRefs(@Body() body: CollectMediaRefsDto): Promise<{ referenced: string[] }> {
    const referenced = await this.spool.collectProjectMediaRefs(
      { teamId: body.teamId, excludeProjectId: body.excludeProjectId, mediaIds: body.mediaIds },
      { docs: this.docs, prisma: this.prisma },
    );
    return { referenced };
  }

  /** C4-c2（plan C4——project-erasure）：purgeScope 内部端点（erasure worker PURGING_CACHE 首步——
   *  api 进程内存面清键：spool dedup/水位/世代计数/段索引+段文件 unlink+快照缓存 evict；**这些键以
   *  DB 行为真源而 DB 行已删=永不自愈**，必须显式清）。body={projectIds}→{purgedSegments}；守卫/
   *  限批/503 语义见 CollabSpoolService.purgeErasureScope（collectMediaRefs 同族容量防护
   *  +isLeaseServing；docs 端口 per-call 传入同因 DI 环）；Bearer=WORKER_WRITE_TOKEN 传输层。 */
  @Post('purge-scope')
  @NoTransform()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @UseGuards(WorkerWriteAuthGuard)
  async purgeScope(@Body() body: PurgeScopeDto): Promise<{ purgedSegments: number }> {
    return this.spool.purgeErasureScope(body.projectIds, { docs: this.docs });
  }

  /** C3b-4a（plan Task C3b-4a——spec §3.4-4 :79）：DeletionBarrier loopback 端点（erasure worker 跨
   *  进程经 HttpDeletionBarrierPort 调 api——六步序编排在 api 进程执行〔seal 与 DB 行同进程翻/清〕）。
   *  action 分发：prepare={teamId,excludeProjectId?}→wire 形 verified/bail-out（**verified=fence 在手
   *  至 release——调用方删除本体在窗内执行+配对 release；bail-out=已整体释放零残留**）；
   *  release={teamId,barrierId}→{released}（barrierId 守卫——stale release 零行不动后继）。
   *  Bearer=WORKER_WRITE_TOKEN 传输层（media-refs/purge-scope 同族——非资金面无 scope 令牌）。 */
  @Post('deletion-barrier')
  @NoTransform()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @UseGuards(WorkerWriteAuthGuard)
  async postDeletionBarrier(@Body() body: DeletionBarrierDto): Promise<{ outcome: string; barrierId?: string; projects?: { projectId: string; pgSeq: string }[]; reason?: string } | { released: boolean }> {
    if (body.action === 'prepare') {
      const r = await this.deletionBarrier.prepare(body.teamId, { excludeProjectId: body.excludeProjectId });
      return mapPrepareToWire(r);
    }
    if (body.barrierId === undefined) {
      throw new BadRequestException({ code: 'DELETION_BARRIER_BAD_BODY', message: 'action=release 须携 barrierId（barrierId 守卫——stale release 零行）' });
    }
    return { released: await this.deletionBarrier.release(body.teamId, body.barrierId) };
  }

  /** exec 状态投影写（RuntimeEvent feed——零 doc 写）。body={projectId,nodeId,patch}（patch 键域=
   *  ExecStatusPatch：status/attempts 必携+errorCode/rearmable/intentId/execSeq/artifactRev 等可选）。 */
  @Post('exec-status')
  @NoTransform()
  @UseGuards(WorkerWriteAuthGuard)
  async writeExecStatus(
    @Body() body: { projectId?: unknown; nodeId?: unknown; patch?: unknown },
    @Headers(WORKER_SCOPE_HEADER) scopeHeader?: string,
  ): Promise<{ written: true }> {
    if (body === null || typeof body !== 'object' || Array.isArray(body)
      || typeof body.projectId !== 'string' || body.projectId === ''
      || typeof body.nodeId !== 'string' || body.nodeId === ''
      || body.patch === null || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
      throw new BadRequestException({ code: 'EXEC_STATUS_BAD_BODY', message: 'body 须为 { projectId: 非空 string, nodeId: 非空 string, patch: ExecStatusPatch }' });
    }
    const patch = body.patch as { status?: unknown };
    if (typeof patch.status !== 'string' || patch.status === '') {
      throw new BadRequestException({ code: 'EXEC_STATUS_BAD_PATCH', message: 'patch.status 须为非空 string（ExecStatusPatch 键域）' });
    }
    if (WORKER_EXEC_DONE_FORBIDDEN.has(patch.status)) {
      throw new ForbiddenException({ code: 'WORKER_EXEC_STATUS_NOT_ALLOWED', message: `writeExecStatus status=${patch.status} 禁经 worker 通道（done=投影 poller deliverArtifact 复合事务专写〔exec.artifact+exec.status(done)〕）` });
    }
    // ── T13 作用域化收口（write-batch 语义原样迁移——单条面）：先验签再全档绑定（403 均不进写面）。
    //    token 未设=dev fail-open（与 WorkerWriteAuthGuard 同判据同向——生产由 env 拒启承担主防线）。 ──
    const bearer = process.env.WORKER_WRITE_TOKEN;
    if (bearer) {
      const scope = this.verifyScope(bearer, scopeHeader, body.projectId);
      await this.enforceScopeBinding(body.nodeId, scope);
    }
    await this.docs.writeExecStatus(body.projectId, body.nodeId, body.patch as never);
    return { written: true };
  }

  /** scope 验签：HMAC+exp+projectId 绑定（伪造他 project/篡改载荷/过期 ⇒ 403——资金语义面）。 */
  private verifyScope(bearer: string, scopeHeader: string | undefined, projectId: string): WorkerScopePayload {
    const v = verifyWorkerScopeToken(bearer, scopeHeader);
    if (!v.ok) {
      throw new ForbiddenException({ code: 'WORKER_SCOPE_INVALID', message: `x-worker-scope 验签失败（${v.reason}）——worker 写通道要求作用域令牌（HMAC 绑定 projectId+intentRowId+execSeq+exp）` });
    }
    if (v.payload.p !== projectId) {
      throw new ForbiddenException({ code: 'WORKER_SCOPE_PROJECT_MISMATCH', message: 'scope 令牌 projectId 与 body 不符——跨项目越权拒' });
    }
    return v.payload;
  }

  /** 全档绑定：intent 行在场∧projectId/execSeq 匹配∧nodeId===intent.nodeId（伪造他
   *  intent/execSeq/nodeId 的写=403）。裸项目档（scope.i===''——pre-claim 断言路径）跳过行核。 */
  private async enforceScopeBinding(nodeId: string, scope: WorkerScopePayload): Promise<void> {
    if (scope.i === '') return;
    const row = await this.prisma.generationIntent.findUnique({
      where: { id: scope.i },
      select: { projectId: true, nodeId: true, execSeq: true },
    });
    if (!row || row.projectId !== scope.p || row.execSeq !== BigInt(scope.s)) {
      throw new ForbiddenException({ code: 'WORKER_SCOPE_INTENT_MISMATCH', message: 'scope 令牌 intentRowId/execSeq 与 intent 行不符（伪造他意图/代际的写请求拒）' });
    }
    if (nodeId !== row.nodeId) {
      throw new ForbiddenException({ code: 'WORKER_SCOPE_NODE_MISMATCH', message: 'nodeId 与 scope 绑定 intent 行 nodeId 不符——跨节点越权拒' });
    }
  }
}
