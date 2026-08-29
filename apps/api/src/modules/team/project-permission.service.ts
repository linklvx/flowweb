import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProjectRole } from '@prisma/client';

@Injectable()
export class ProjectPermissionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** spec 1.2 权限解析优先级链：显式记录 > 创建者 > 团队角色回退 */
  async resolve(projectId: string, userId: string): Promise<ProjectRole | null> {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true, userId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    const explicit = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (explicit) return explicit.role;
    if (project.userId === userId) return 'PROJECT_OWNER';
    const teamMember = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
      select: { role: true },
    });
    if (!teamMember) return null;
    return teamMember.role === 'OWNER' ? 'PROJECT_OWNER' : 'PROJECT_EDITOR';
  }

  /** ≥ EDITOR 校验（执行等写操作，spec 全局约定） */
  async assertEditor(projectId: string, userId: string): Promise<ProjectRole> {
    const role = await this.resolve(projectId, userId);
    if (!role || role === 'PROJECT_VIEWER') throw new ForbiddenException('无项目编辑权限');
    return role;
  }
}
