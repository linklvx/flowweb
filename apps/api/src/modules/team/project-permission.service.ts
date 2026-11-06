import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProjectRole } from '@prisma/client';

@Injectable()
export class ProjectPermissionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** spec 1.2 权限解析优先级链：显式记录 > 创建者 > 团队角色回退 */
  async resolve(projectId: string, userId: string): Promise<ProjectRole | null> {
    return (await this.resolveWithTeam(projectId, userId)).role;
  }

  /** Y0b-1（三轮 P1-4）：resolve 同链随结果带出 teamId（resolve 本就 select teamId——零额外查询）。
   *  claim 固化入参（teamId 必填）的取值源。
   *  C4-b（P2-7 承接）：随带 team.status（relation select 同查询零额外往返——collab session guard
   *  DISBANDING/DISBANDED 拒新连接判据；既有消费面按需读取，缺省不破）。 */
  async resolveWithTeam(projectId: string, userId: string): Promise<{ role: ProjectRole | null; teamId: string; teamStatus?: string }> {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id: projectId },
      select: { teamId: true, userId: true, team: { select: { status: true } } },
    });
    if (!project) throw new NotFoundException('项目不存在');
    const teamStatus = project.team?.status;
    const explicit = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (explicit) return { role: explicit.role, teamId: project.teamId, teamStatus };
    if (project.userId === userId) return { role: 'PROJECT_OWNER', teamId: project.teamId, teamStatus };
    const teamMember = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
      select: { role: true },
    });
    if (!teamMember) return { role: null, teamId: project.teamId, teamStatus };
    return { role: teamMember.role === 'OWNER' ? 'PROJECT_OWNER' : 'PROJECT_EDITOR', teamId: project.teamId, teamStatus };
  }

  /** C4-b（WS fast-path 拒帧·PROJECT_ERASED 分义）：lifecycleState **无过滤** raw 读（读路径 Proxy
   *  对 canvasProject delegate 读注入 ACTIVE 谓词——DELETING 行 404；本读=分义面：DELETING vs 真缺失）。
   *  session-guard NotFoundException 消费（terminal 4414 vs NOT_FOUND 档）。 */
  async lifecycleStateOf(projectId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ lifecycleState: string | null }[]>`
      SELECT "lifecycleState" FROM "CanvasProject" WHERE "id" = ${projectId}::text`;
    return rows[0]?.lifecycleState ?? null;
  }

  /** ≥ EDITOR 校验（执行等写操作，spec 全局约定） */
  async assertEditor(projectId: string, userId: string): Promise<ProjectRole> {
    const { role } = await this.resolveWithTeam(projectId, userId);
    if (!role || role === 'PROJECT_VIEWER') throw new ForbiddenException('无项目编辑权限');
    return role;
  }

  /** Y0b-1（三轮 P1-4）：assertEditor 同门——编辑权放行同时带出 teamId（claim 固化入参）。
   *  付费扩面 controller（ai-image-edit/lighting）用本门取 teamId，零额外查询。 */
  async assertEditorWithTeam(projectId: string, userId: string): Promise<{ role: ProjectRole; teamId: string }> {
    const { role, teamId } = await this.resolveWithTeam(projectId, userId);
    if (!role || role === 'PROJECT_VIEWER') throw new ForbiddenException('无项目编辑权限');
    return { role, teamId };
  }
}
