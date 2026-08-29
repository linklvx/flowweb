import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from './project-permission.service';

@Injectable()
export class ProjectMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perm: ProjectPermissionService,
  ) {}

  async list(projectId: string, userId: string) {
    const role = await this.perm.resolve(projectId, userId);
    if (!role) throw new ForbiddenException('非团队成员');
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true, userId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: project.teamId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    const explicit = await this.prisma.projectMember.findMany({ where: { projectId } });
    const explicitMap = new Map(explicit.map((m) => [m.userId, m.role]));
    const items = members.map((m) => {
      const explicitRole = explicitMap.get(m.userId);
      const inherited = m.userId === project.userId
        ? 'PROJECT_OWNER'
        : m.role === 'OWNER' ? 'PROJECT_OWNER' : 'PROJECT_EDITOR';
      return {
        userId: m.userId, name: m.user.name, email: m.user.email,
        teamRole: m.role,
        effectiveRole: explicitRole ?? inherited,
        source: explicitRole ? 'explicit' : 'inherited',
      };
    });
    return { items };
  }

  /** 统一授予规则：PO/Team OWNER/ADMIN 可管理普通角色；设 OWNER 仅 PO/Team OWNER */
  private async assertCanManage(projectId: string, callerId: string, grantRole: 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER') {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    const projectRole = await this.perm.resolve(projectId, callerId);
    const teamMember = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId: callerId } },
      select: { role: true },
    });
    const isProjectOwner = projectRole === 'PROJECT_OWNER';
    const isTeamOwnerOrAdmin = teamMember?.role === 'OWNER' || teamMember?.role === 'ADMIN';
    if (!isProjectOwner && !isTeamOwnerOrAdmin) throw new ForbiddenException('无项目管理权限');
    if (grantRole === 'PROJECT_OWNER' && !isProjectOwner && teamMember?.role !== 'OWNER') {
      throw new ForbiddenException('仅项目所有者或团队 OWNER 可授予项目所有者角色');
    }
  }

  async add(projectId: string, callerId: string, targetUserId: string, role: 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER') {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    // 先校验目标在团（400 语义），再做 caller 权限门（403）——caller 已过 TeamGuard，顺序不影响安全
    const inTeam = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId: targetUserId } },
    });
    if (!inTeam) throw new BadRequestException('目标用户不是团队成员');
    await this.assertCanManage(projectId, callerId, role);
    return this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      update: { role },
      create: { projectId, userId: targetUserId, role },
    });
  }

  async changeRole(projectId: string, callerId: string, targetUserId: string, role: 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER') {
    return this.add(projectId, callerId, targetUserId, role);
  }

  async remove(projectId: string, callerId: string, targetUserId: string) {
    await this.assertCanManage(projectId, callerId, 'PROJECT_EDITOR');
    const record = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: targetUserId } },
    });
    if (!record) throw new NotFoundException('无项目成员记录');
    if (record.role === 'PROJECT_OWNER') {
      const ownerCount = await this.prisma.projectMember.count({
        where: { projectId, role: 'PROJECT_OWNER' },
      });
      if (ownerCount <= 1) throw new BadRequestException('不能移除最后一个项目所有者');
    }
    await this.prisma.projectMember.delete({ where: { id: record.id } });
    return { ok: true };
  }
}
