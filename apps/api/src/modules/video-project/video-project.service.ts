// apps/api/src/modules/video-project/video-project.service.ts
import { Injectable, Inject, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ExecutionService } from '../execution/execution.service';

@Injectable()
export class VideoProjectService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabDocumentService) private readonly collab: CollabDocumentService,
    @Inject(ExecutionService) private readonly execution: ExecutionService, // Task 11 regenerate 用——签名一次到位，避免 Task 11 中途改构造器
  ) {}

  /** upsert by sourceNodeId（@unique）——幂等防双击；update 分支同样全量返回；
   *  teamId 服务端从 workflowId 派生（assertEditor 只验 workflow 编辑权不验 teamId 归属——客户端传 teamId 会造不一致脏行） */
  async upsertByNode(input: { workflowId: string; sourceNodeId: string; userId: string; title: string; data?: unknown }) {
    await this.perm.assertEditor(input.workflowId, input.userId);
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: input.workflowId },
      select: { teamId: true },
    });
    if (!project) throw new BadRequestException('项目不存在'); // 显式抛错（与 Task 10 register 统一）——防 assertEditor 契约变更时 project! 静默 TypeError
    return this.prisma.videoProject.upsert({
      where: { sourceNodeId: input.sourceNodeId },
      create: {
        teamId: project.teamId, userId: input.userId, workflowId: input.workflowId,
        sourceNodeId: input.sourceNodeId, title: input.title,
        data: (input.data ?? { version: 1, fps: 30, tracks: [], clips: {} }) as object,
      },
      update: {}, // 已存在则原样返回全量（title/data 不动——编辑器加载用）
    });
  }

  async getByNode(sourceNodeId: string, userId: string) {
    const proj = await this.prisma.videoProject.findUnique({ where: { sourceNodeId } });
    if (!proj) return null;
    await this.perm.assertEditor(proj.workflowId, userId);
    return proj;
  }

  /** PATCH 单飞配合：乐观锁 baseUpdatedAt ≠ 库内值 → 409 */
  async patch(id: string, userId: string, dto: { data: object; baseUpdatedAt: string }) {
    const proj = await this.prisma.videoProject.findUnique({ where: { id } });
    if (!proj) throw new ConflictException('project not found');
    await this.perm.assertEditor(proj.workflowId, userId);
    if (proj.updatedAt.getTime() !== new Date(dto.baseUpdatedAt).getTime()) {
      throw new ConflictException('project modified elsewhere');
    }
    return this.prisma.videoProject.update({ where: { id }, data: { data: dto.data as object } });
  }

  async deleteByNode(sourceNodeId: string, userId: string) {
    const proj = await this.prisma.videoProject.findUnique({ where: { sourceNodeId } });
    if (!proj) return;
    await this.perm.assertEditor(proj.workflowId, userId);
    await this.prisma.videoProject.delete({ where: { sourceNodeId } });
  }
}
