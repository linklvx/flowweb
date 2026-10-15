// apps/api/src/modules/collab/collab-write.controller.ts
// Y0c T27：POST /api/collab/doc/write-batch——worker 内部写端点（P8 单端点；api 进程内直调
// CollabDocWriterService.writeBatch——经本模块 DI，非 HTTP 自环）。端点面职责三钉：
//  ①Z108 内容校验进门=T4 manifest 校验表执法档 requireIdempotentOps:true（Z148①——idempotent:false
//    的 op 直接 4xx 拒收，「端口只收幂等 op」从散文变可执行断言；键集/字节 Σ≤256KB/op 数上限/拒
//    __proto__ 族全七码违规=400+违规清单，非截断非 sanitize；进程内 writeBatch 默认档不产
//    NON_IDEMPOTENT_OP——fillDoc 种子路径专用是合法进程内 op，两档见 spec §0.6 偏离 20）；
//  ②响应=WriteOpResult[] 裸数组（A1 冻结契约——@NoTransform 防 TransformInterceptor 包裹壳破坏
//    HttpCollabWritePort.writeOpsBatch 直接 cast；瞬态〔lease/真空/spool〕=writer throw 503 显式
//    传递不吞不换码——Z99 端点半）；
//  ③幂等=「端口只收幂等 op」原则（Z133）——端点显式不承诺跨请求去重：重试多落 delta 行=有界
//    （≤2×N_chunks）/compact 坍缩/retry 可观测（Z76⑤ 观测面仓内承载=collab_write_http_outcome_total
//    {outcome='transient-retry'}，T24 已落——每重试必计数，冗余 delta 行唯一来源可量化）；禁内存去重表。
// 鉴权=WorkerWriteAuthGuard（T26 模板复用——偏离 32 形态：Bearer WORKER_WRITE_TOKEN+timingSafeEqual；
// production 未设=进程拒启〔env.ts superRefine 单点，api/worker 双进程〕，请求级 403 为纵深冗余；
// dev fail-open）。AuthGuard 会话面由 auth.guard 精确谓词放行 POST write-batch（静态路径全等——
// 无 :projectId 段，无需 regex）。
import { BadRequestException, Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { NoTransform } from '../../common/decorators/no-transform.decorator';
import { validateWriteBatch, type WriteBatchViolation } from '@flowweb/shared';
import { CollabDocWriterService, type WriteOpResult } from './collab-doc-writer.service';
import { WorkerWriteAuthGuard } from './worker-write-auth.guard';

@SkipThrottle()   // worker 内部通道不吃共享 300/min 桶（/api/ready、读端点同惯例）
@Controller('api/collab/doc')
export class CollabWriteController {
  constructor(@Inject(CollabDocWriterService) private readonly writer: CollabDocWriterService) {}

  @Post('write-batch')
  @NoTransform()
  @UseGuards(WorkerWriteAuthGuard)
  async writeBatch(@Body() body: { projectId?: unknown; ops?: unknown }): Promise<WriteOpResult[]> {
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
    return this.writer.writeBatch(body.projectId, body.ops as never[]);
  }
}
