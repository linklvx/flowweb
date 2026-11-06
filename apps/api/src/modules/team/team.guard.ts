import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
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
  // 评审 P1-2 装置面：显式 @Inject（AuthGuard 同款——esbuild 无 emitDecoratorMetadata 下类
  // provider 构造注入不解析，int HTTP 装置（app.listen 真守卫链）需显式令牌；tsc 生产面同值零行为变化）
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    // C4-a（红⑥-a）：DISBANDING 拦截统一 status!=='ACTIVE' 拒——URL 路由面（充值/成员/项目等 :id
    // 路由）403；解散进行中团队不得再收任何路由资源（DISBANDED 既有拒承继）。
    if (team.status !== 'ACTIVE') throw new ForbiddenException('团队已解散或解散中');

    req.teamId = teamId;
    req.teamRole = member.role;
    return true;
  }
}
