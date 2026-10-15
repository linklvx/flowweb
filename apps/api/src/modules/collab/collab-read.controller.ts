// apps/api/src/modules/collab/collab-read.controller.ts
// Y0c T26（偏离 29/32）：GET /api/collab/doc/:projectId/canvas——worker 读端点（api 进程内经
// CollabWritePort=Direct 形态直调 CollabDocumentService.readCanvas；worker 侧 HttpCollabWritePort
// .readCanvas 消费——E49 计费读 fail-closed：瞬态 503 耗尽显式 throw 不按空画布外呼）。
// 形态三钉：@NoTransform（裸 {nodes,edges}——TransformInterceptor 包裹壳会破坏端口直接 cast 契约）/
// @SkipThrottle（worker 内部通道不吃共享 300/min 桶——/api/ready 同惯例）/WorkerWriteAuthGuard
// （Bearer WORKER_WRITE_TOKEN+timingSafeEqual——T27 write-batch 复用）。AuthGuard 会话面由
// auth.guard 精确谓词放行 GET canvas 路径（偏离 32——前缀机制覆盖不了 :projectId 段）。
import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { NoTransform } from '../../common/decorators/no-transform.decorator';
import { CollabWritePort } from './collab-write.port';
import { WorkerWriteAuthGuard } from './worker-write-auth.guard';

@SkipThrottle()
@Controller('api/collab/doc')
export class CollabReadController {
  constructor(@Inject(CollabWritePort) private readonly collabDoc: CollabWritePort) {}

  @Get(':projectId/canvas')
  @NoTransform()
  @UseGuards(WorkerWriteAuthGuard)
  async readCanvas(@Param('projectId') projectId: string): Promise<{ nodes: any[]; edges: any[] }> {
    return this.collabDoc.readCanvas(projectId);
  }
}
