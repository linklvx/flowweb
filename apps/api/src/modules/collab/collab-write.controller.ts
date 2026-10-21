// apps/api/src/modules/collab/collab-write.controller.ts
// Y0c T27：POST /api/collab/doc/write-batch——worker 内部写端点（P8 单端点；api 进程内直调
// CollabDocWriterService.writeBatch——经本模块 DI，非 HTTP 自环）。端点面职责三钉：
//  ①Z108 内容校验进门=T4 manifest 校验表执法档 requireIdempotentOps:true（Z148①——idempotent:false
//    的 op 直接 4xx 拒收，「端口只收幂等 op」从散文变可执行断言；键集/字节 Σ≤256KB/op 数上限/拒
//    __proto__ 族全七码违规=400+违规清单，非截断非 sanitize）；
//  ②响应=WriteOpResult[] 裸数组（A1 冻结契约——@NoTransform 防 TransformInterceptor 包裹壳破坏
//    HttpCollabWritePort.writeOpsBatch 直接 cast；瞬态〔lease/真空/spool〕=writer throw 503 显式
//    传递不吞不换码——Z99 端点半）；
//  ③幂等=「端口只收幂等 op」原则（Z133）——端点显式不承诺跨请求去重：重试多落 delta 行=有界
//    （≤2×N_chunks）/compact 坍缩/retry 可观测（Z76⑤ 观测面仓内承载=collab_write_http_outcome_total
//    {outcome='transient-retry'}——每重试必计数，冗余 delta 行唯一来源可量化）；禁内存去重表。
// 鉴权=WorkerWriteAuthGuard（bearer WORKER_WRITE_TOKEN 传输层）+T13→T15 收口（plan v11.2 ① 承接）：
//  ④op 白名单=WORKER_CHANNEL_OPS〔exec-only——writeNodeData 已移除：交付归投影 poller（T15），
//    worker token 写 data 域即 403 WORKER_OP_NOT_ALLOWED〕且 writeExecStatus patch.status 禁
//    WORKER_EXEC_FORBIDDEN_STATUSES〔done——exec done=投影 poller deliverArtifact 专写，403〕；
//  ⑤token 作用域化=x-worker-scope HMAC 验签（projectId+intentRowId+execSeq+exp 绑定——伪造他
//    project/intent/execSeq 的写请求 403；裸项目档〔pre-claim 断言路径〕仅放行 writeExecStatus；
//    全档校验 intent 行在场∧projectId/execSeq 匹配∧逐 op nodeId===intent.nodeId）。dev 未设
//    WORKER_WRITE_TOKEN=fail-open（guard 同款）；production 未设=进程拒启（env.ts 单点）。
// AuthGuard 会话面由 auth.guard 精确谓词放行 POST write-batch（静态路径全等）。
import { BadRequestException, Body, Controller, ForbiddenException, Inject, Post, UseGuards, Headers } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { WORKER_CHANNEL_OPS, WORKER_EXEC_FORBIDDEN_STATUSES, validateWriteBatch, type WriteBatchViolation } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { NoTransform } from '../../common/decorators/no-transform.decorator';
import { CollabDocWriterService, type WriteOpResult } from './collab-doc-writer.service';
import { WorkerWriteAuthGuard } from './worker-write-auth.guard';
import { verifyWorkerScopeToken, WORKER_SCOPE_HEADER, type WorkerScopePayload } from './worker-scope-token';

@SkipThrottle()   // worker 内部通道不吃共享 300/min 桶（/api/ready、读端点同惯例）
@Controller('api/collab/doc')
export class CollabWriteController {
  constructor(
    @Inject(CollabDocWriterService) private readonly writer: CollabDocWriterService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post('write-batch')
  @NoTransform()
  @UseGuards(WorkerWriteAuthGuard)
  async writeBatch(
    @Body() body: { projectId?: unknown; ops?: unknown },
    @Headers(WORKER_SCOPE_HEADER) scopeHeader?: string,
  ): Promise<WriteOpResult[]> {
    if (body === null || typeof body !== 'object' || Array.isArray(body)
      || typeof body.projectId !== 'string' || body.projectId === '' || !Array.isArray(body.ops)) {
      throw new BadRequestException({ code: 'WRITE_BATCH_BAD_BODY', message: 'body 须为 { projectId: 非空 string, ops: DocWriteOp[] }' });
    }
    // Z108 执法档（Z148①）：全七码静态内容违规=400+违规清单（业务级拒绝不进事务——与进程内
    // writeBatch ③段同判据同源 manifest；确定纯函数故两端点过门后 writer 内复验恒空——零双分叉）
    const violations: WriteBatchViolation[] = validateWriteBatch(body.ops, { requireIdempotentOps: true });
    if (violations.length > 0) {
      throw new BadRequestException({ code: 'WRITE_BATCH_REJECTED', violations });
    }
    // ── T13→T15 收口（④op 白名单 exec-only+done 禁写+⑤scope 验签）——Z108 之后：先按 manifest
    //    通用键域拒内容违规，再按 worker 通道专属面收窄（403 均不进 writer）。token 未设=dev
    //    fail-open（与 WorkerWriteAuthGuard 同判据同向——生产由 env 拒启承担主防线）。 ──
    const bearer = process.env.WORKER_WRITE_TOKEN;
    if (bearer) {
      const scope = this.verifyScope(bearer, scopeHeader, body.projectId);
      await this.enforceWorkerChannel(body.ops as { op: string; nodeId?: string; patch?: Record<string, unknown> }[], scope);
    }
    return this.writer.writeBatch(body.projectId, body.ops as never[]);
  }

  /** ⑤scope 验签：HMAC+exp+projectId 绑定（伪造他 project/篡改载荷/过期 ⇒ 403——资金语义面）。 */
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

  /** ④op 白名单（exec-only）+done 禁写+全档绑定：逐 op nodeId===intent.nodeId（伪造他
   *  intent/execSeq 的写=换 intent 行/nodeId 即 403）。T15 收口：writeNodeData 全档亦 403
   *  （data 域交付=投影 poller 专写）；writeExecStatus status=done 403（exec done=deliverArtifact
   *  复合 op 专写——Z99 同代终态守卫的通道级前置）。 */
  private async enforceWorkerChannel(
    ops: { op: string; nodeId?: string; patch?: Record<string, unknown> }[],
    scope: WorkerScopePayload,
  ): Promise<void> {
    const channelOps = new Set<string>(WORKER_CHANNEL_OPS);
    const forbiddenStatuses = new Set<string>(WORKER_EXEC_FORBIDDEN_STATUSES);
    for (const op of ops) {
      if (!channelOps.has(op.op)) {
        throw new ForbiddenException({ code: 'WORKER_OP_NOT_ALLOWED', message: `op ${op.op} 不在 worker 通道白名单（${WORKER_CHANNEL_OPS.join('/')}——T15 收口：writeNodeData 已移除，交付归投影 poller）` });
      }
      const status = (op.patch as { status?: unknown } | undefined)?.status;
      if (op.op === 'writeExecStatus' && typeof status === 'string' && forbiddenStatuses.has(status)) {
        throw new ForbiddenException({ code: 'WORKER_EXEC_STATUS_NOT_ALLOWED', message: `writeExecStatus status=${status} 禁经 worker 通道（WORKER_EXEC_FORBIDDEN_STATUSES——done=投影 poller deliverArtifact 复合 op 专写）` });
      }
    }
    if (scope.i !== '') {
      // 全档绑定：intent 行在场∧projectId/execSeq 匹配∧逐 op nodeId 一致（伪造他 intent/execSeq 即 403）
      const row = await this.prisma.generationIntent.findUnique({
        where: { id: scope.i },
        select: { projectId: true, nodeId: true, execSeq: true },
      });
      if (!row || row.projectId !== scope.p || row.execSeq !== BigInt(scope.s)) {
        throw new ForbiddenException({ code: 'WORKER_SCOPE_INTENT_MISMATCH', message: 'scope 令牌 intentRowId/execSeq 与 intent 行不符（伪造他意图/代际的写请求拒）' });
      }
      for (const op of ops) {
        if (op.nodeId !== undefined && op.nodeId !== row.nodeId) {
          throw new ForbiddenException({ code: 'WORKER_SCOPE_NODE_MISMATCH', message: 'op nodeId 与 scope 绑定 intent 行 nodeId 不符——跨节点越权拒' });
        }
      }
    }
  }
}
