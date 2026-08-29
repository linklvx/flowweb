import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';
import { validateTemplateData } from '../template/template.validation';
import { TeamService } from '../team/team.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { assertTeamMember } from '../team/team.util';

@Injectable()
export class CanvasService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectService) private readonly projectService: ProjectService,
    @Inject(FolderService) private readonly folderService: FolderService,
    @Inject(TemplateService) private readonly templateService: TemplateService,
    @Inject(TeamService) private readonly teamService: TeamService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
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
        data: { name: finalName, userId, teamId: teamIdResolved, projectId: project.id, folderId, status: 'DRAFT', isPublic: false },
      });
      return { templateId: template.id, projectId: project.id, name: finalName };
    });
    this.templateService.clearCache();
    if (folderId) await this.folderService.touch([folderId]);
    return result;
  }

  async getNextUntitledName(userId: string): Promise<string> {
    const teamId = (await this.teamService.ensureDefaultTeam(userId)).id;
    return CanvasService.nextUntitledName(this.prisma, teamId);
  }

  private static async nextUntitledName(db: { template: { findMany: Function } }, teamId: string): Promise<string> {
    const templates = await db.template.findMany({ where: { teamId }, select: { name: true } });
    let max = 0;
    for (const t of templates) {
      const m = /^画布(\d+)$/.exec(t.name);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `画布${max + 1}`;
  }

  async save(projectId: string, input: { name: string; description?: string; isPublic?: boolean; viewport?: { x: number; y: number; zoom: number } }, userId: string, sv?: Uint8Array) {
    const project = await this.projectService.findById(projectId);
    await this.perm.assertEditor(projectId, userId);

    const canvas = await this.collabDoc.readCanvas(projectId, sv);
    const nodes = canvas.nodes.map((n: any) => ({
      id: n.id, type: n.type, position: n.position, data: n.data,
    }));
    const edges = canvas.edges.map((e: any) => ({
      id: e.id,
      source: e.sourceId || e.source || '',
      target: e.targetId || e.target || '',
    }));
    const templateData = { nodes, edges, viewport: input.viewport || { x: 0, y: 0, zoom: 1 } };

    try {
      validateTemplateData(templateData);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '画布数据验证失败';
      throw new BadRequestException(message);
    }

    const existing = await this.prisma.template.findUnique({ where: { projectId } });
    this.templateService.clearCache();

    if (existing) {
      return this.prisma.template.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          description: input.description,
          isPublic: input.isPublic ?? existing.isPublic,
          templateData,
          status: 'SAVED',
          category: input.isPublic ? 'COMMUNITY' : undefined,
        },
      });
    }

    try {
      return await this.prisma.template.create({
        data: {
          name: input.name,
          description: input.description,
          isPublic: input.isPublic ?? false,
          projectId,
          userId,
          teamId: project.teamId,
          templateData,
          status: 'SAVED',
          category: input.isPublic ? 'COMMUNITY' : undefined,
        },
      });
    } catch (e: any) {
      // 并发首存：另一请求已创建，回退为更新
      if (e?.code === 'P2002') {
        const raced = await this.prisma.template.findUnique({ where: { projectId } });
        if (raced) {
          return this.prisma.template.update({
            where: { id: raced.id },
            data: {
              name: input.name,
              description: input.description,
              isPublic: input.isPublic ?? raced.isPublic,
              templateData,
              status: 'SAVED',
              category: input.isPublic ? 'COMMUNITY' : undefined,
            },
          });
        }
      }
      throw e;
    }
  }
}
