import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from './project-permission.service';
import { AuditService } from '../../common/audit/audit.service';

@Injectable()
export class ProjectMemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perm: ProjectPermissionService,
    private readonly audit: AuditService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
  ) {}

  private async userName(userId: string): Promise<string> {
    return (await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? '未知';
  }

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

  async add(
    projectId: string,
    callerId: string,
    targetUserId: string,
    role: 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER',
    auditAction: 'add_project_member' | 'change_project_role' = 'add_project_member',
  ) {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    // 默认团队（个人项目）画布：服务端不变量，拒绝一切协作者添加
    const team = await this.prisma.team.findUnique({ where: { id: project.teamId }, select: { isDefault: true } });
    if (team?.isDefault) throw new BadRequestException('个人项目画布不支持添加协作者');
    // 先校验目标在团（400 语义），再做 caller 权限门（403）——caller 已过 TeamGuard，顺序不影响安全
    const inTeam = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId: targetUserId } },
    });
    if (!inTeam) throw new BadRequestException('目标用户不是团队成员');
    await this.assertCanManage(projectId, callerId, role);
    const result = await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: targetUserId } },
      update: { role },
      create: { projectId, userId: targetUserId, role },
    });
    this.emitPermChanged(targetUserId, project.teamId);   // Y0b-3 T8 评审修复：显式授权变更面（spec §3.1 字面项——changeRole 委托本方法自动覆盖）
    await this.audit.log({
      operatorId: callerId,
      operatorName: await this.userName(callerId),
      teamId: project.teamId,
      targetType: 'PROJECT_MEMBER',
      targetId: targetUserId,
      action: auditAction,
      afterValue: { role },
    });
    return result;
  }

  async changeRole(projectId: string, callerId: string, targetUserId: string, role: 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER') {
    return this.add(projectId, callerId, targetUserId, role, 'change_project_role');
  }

  async remove(projectId: string, callerId: string, targetUserId: string) {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
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
    this.emitPermChanged(targetUserId, project.teamId);   // Y0b-3 T8 评审修复：显式行撤权核心面（不 emit=复验判据真实输入变更零信号，越权写感知窗退化 sweep 兜底 9-11min）
    await this.audit.log({
      operatorId: callerId,
      operatorName: await this.userName(callerId),
      teamId: project.teamId,
      targetType: 'PROJECT_MEMBER',
      targetId: targetUserId,
      action: 'remove_project_member',
    });
    return { ok: true };
  }

  /** Y0b-3 T8 评审修复：显式 ProjectMember 行变更=resolveWithTeam 显式档输入（WS 复验判定真实
   *  输入）——变更点 emit 事件触发 gateway permCache 失效+立即 sweep（team.service 同款形态）。 */
  private emitPermChanged(userId: string, teamId: string): void {
    this.eventEmitter.emit('collab.perm.changed', { userId, teamId });
  }
}
