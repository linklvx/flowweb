// apps/api/src/modules/collab/collab-recovery-accept.controller.ts —— Y1c T25b 面 B5
//（plan :338 登记——spec I-1 承接）：server-restored 只读 recovery 态的管理员裁定接受入口。
// 语义：4410 server-restored（g_client>g_server PITR 回退形态）客户端进入只读恢复（导出草稿+
// 停重连）；**管理员（项目 OWNER/平台 ADMIN）裁定接受服务端现态**→接受方客户端清本地缓存族+
// reload 以 DB 真值 g 重建（acceptance 不改服务端代际——客户端以 fetchProjectMeta 真值重连自然
// 过世代门；本地草稿已在信封文件保全不丢）。服务端职责=裁定门（OWNER/ADMIN）+当前真值返回
//（generation）+审计日志；代际/缓存面不动（只读恢复态的解除是客户端动作——禁服务端代际侧通道）。
import { Controller, ForbiddenException, Inject, Logger, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { readCanvasDocHead } from './canvas-doc-head';   // 契约 1：装载读唯一入口（禁服务内直查 CanvasDoc 拼装载形态）

@Controller('api/collab/doc/:projectId/recovery-accept')
export class CollabRecoveryAcceptController {
  private readonly logger = new Logger(CollabRecoveryAcceptController.name);

  constructor(
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post()
  async accept(@Param('projectId') projectId: string, @Req() req: Request): Promise<{ accepted: true; generation: number }> {
    const user = (req as Request & { user?: { id?: string; role?: string } }).user;
    const role = await this.perm.resolve(projectId, user?.id as string);
    const isAdmin = user?.role === 'ADMIN';
    if (role !== 'PROJECT_OWNER' && !isAdmin) {
      throw new ForbiddenException('server-restored 裁定接受需项目 OWNER 或平台管理员');
    }
    // 契约 1（Y0a-1 冻结扫描）：头行读=canvas-doc-head 三分读（repository 外禁直查 CanvasDoc）
    const head = await readCanvasDocHead(this.prisma, projectId);
    if (head.status !== 'found') throw new NotFoundException('画布文档不存在');
    this.logger.log(`recovery-accept projectId=${projectId} by=${user?.id ?? '?'} role=${isAdmin && role !== 'PROJECT_OWNER' ? 'ADMIN' : role}→generation=${head.row.generation}`);
    return { accepted: true, generation: head.row.generation };
  }
}
