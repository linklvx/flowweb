// apps/api/src/modules/collab/collab-canvas-read.controller.ts —— Y1c T25b 微批 C-1（双员同阻断）：
// 会话鉴权用户面画布读端点 GET /api/projects/:projectId/collab/canvas——B 场景裁定「当前」侧
// 服务端真值读径（fetchServerCanvas 消费面）。
// ★为何不沿用 GET /collab/doc/:pid/canvas：该路径=worker 内部通道（WorkerWriteAuthGuard 只认
// Bearer WORKER_WRITE_TOKEN——apiFetch 零 Authorization 头生产恒 403+@NoTransform 裸 {nodes,edges}
// vs apiFetch {code:0} envelope 契约击穿）；本端点=全局 AuthGuard 会话面+assertEditor 门+
// 标准 TransformInterceptor envelope（apiFetch 契约）。worker 端点零改动（偏离 32 谓词不动）。
// 读芯=CollabWritePort.readCanvas（api 进程 Direct 形态——Y1c T19 CanvasReadModel 唯一共享读类型）。
import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { CanvasReadModel } from '@flowweb/shared';
import { CollabWritePort } from './collab-write.port';
import { ProjectPermissionService } from '../team/project-permission.service';

@Controller('api/projects/:projectId/collab')
export class CollabCanvasReadController {
  constructor(
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabWritePort) private readonly collabDoc: CollabWritePort,
  ) {}

  /** 用户面画布读（B 场景裁定 current 侧真值——非 EDITOR 403：裁定面=编辑权语义。
   *  userId 缺席兜 ''（生产=AuthGuard 会话面前置恒有值；防御直调/替身面=resolve null→403 fail-closed）。 */
  @Get('canvas')
  async readCanvasView(
    @Param('projectId') projectId: string,
    @Req() req: Request,
  ): Promise<CanvasReadModel> {
    const userId = (req as Request & { user?: { id?: string } }).user?.id ?? '';
    await this.perm.assertEditor(projectId, userId);
    return this.collabDoc.readCanvas(projectId);
  }
}
