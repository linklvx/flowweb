import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';
import { TeamService } from '../team/team.service';
import { assertTeamMember } from '../team/team.util';

@Injectable()
export class CanvasService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FolderService) private readonly folderService: FolderService,
    @Inject(TemplateService) private readonly templateService: TemplateService,
    @Inject(TeamService) private readonly teamService: TeamService,
  ) {}

  async create(name: string, folderId: string | null, userId: string, teamId?: string) {
    let teamIdResolved: string;
    if (teamId) {
      await assertTeamMember(this.prisma, teamId, userId);
      teamIdResolved = teamId;
    } else {
      teamIdResolved = (await this.teamService.ensureDefaultTeam(userId)).id;
    }
    if (folderId) {
      const folder = await this.prisma.folder.findFirst({ where: { id: folderId, teamId: teamIdResolved } });
      if (!folder) throw new BadRequestException('目标文件夹不存在');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      let finalName = name;
      if (!name?.trim()) {
        // 同团队并发空名创建串行化，消除编号 read-modify-write 竞态；事务结束自动释放
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'canvas_untitled:' + teamIdResolved}))`;
        finalName = await CanvasService.nextUntitledName(tx, teamIdResolved);
      }
      const project = await tx.canvasProject.create({
        data: { name: finalName, userId, teamId: teamIdResolved },
      });
      const template = await tx.template.create({
        data: { name: finalName, userId, teamId: teamIdResolved, projectId: project.id, folderId },
      });
      return { templateId: template.id, projectId: project.id, name: finalName, teamId: teamIdResolved };
    });
    this.templateService.clearCache();
    if (folderId) await this.folderService.touch([folderId]);
    return result;
  }

  async getNextUntitledName(userId: string, teamId?: string): Promise<string> {
    const resolved = teamId ?? (await this.teamService.ensureDefaultTeam(userId)).id;
    if (teamId) await assertTeamMember(this.prisma, teamId, userId);
    return CanvasService.nextUntitledName(this.prisma, resolved);
  }

  private static async nextUntitledName(db: { template: { findMany: (args: {
    where: { teamId: string };
    select: { name: true };
  }) => Promise<{ name: string }[]> } }, teamId: string): Promise<string> {
    const templates = await db.template.findMany({ where: { teamId }, select: { name: true } });
    let max = 0;
    for (const t of templates) {
      const m = /^画布(\d+)$/.exec(t.name);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `画布${max + 1}`;
  }
}
