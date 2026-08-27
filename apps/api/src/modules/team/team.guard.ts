import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

export const TEAM_SOURCE = 'team:id-source';
/** :id 路由参数语义——'team'（默认）直接当 teamId；'project' 先查 project.teamId */
export const TeamSource = (source: 'team' | 'project') => SetMetadata(TEAM_SOURCE, source);

export const SKIP_TEAM_GUARD = 'team:skip-guard';
/** 非成员可访问的团队端点（如提交加入申请） */
export const SkipTeamGuard = () => SetMetadata(SKIP_TEAM_GUARD, true);

@Injectable()
export class TeamGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.get<boolean>(SKIP_TEAM_GUARD, context.getHandler())) return true;
    const source = this.reflector.get<string>(TEAM_SOURCE, context.getHandler()) ?? 'team';
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('未登录');

    const id = req.params.id;
    if (!id) return true; // 无 :id 的路由（如 mine）不涉团队上下文，放行
    let teamId = id;
    if (source === 'project') {
      const project = await this.prisma.canvasProject.findUnique({
        where: { id },
        select: { teamId: true },
      });
      if (!project) throw new NotFoundException('项目不存在');
      teamId = project.teamId;
    }

    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('非团队成员');

    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { status: true } });
    if (!team) throw new NotFoundException('团队不存在');
    if (team.status === 'DISBANDED') throw new ForbiddenException('团队已解散');

    req.teamId = teamId;
    req.teamRole = member.role;
    return true;
  }
}
