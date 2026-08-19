import { Injectable, Inject, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';
import { validateTemplateData } from '../template/template.validation';

@Injectable()
export class CanvasService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectService) private readonly projectService: ProjectService,
    @Inject(FolderService) private readonly folderService: FolderService,
    @Inject(TemplateService) private readonly templateService: TemplateService,
  ) {}

  async create(name: string, folderId: string | null, userId: string) {
    if (folderId) {
      const folder = await this.prisma.folder.findFirst({ where: { id: folderId, userId } });
      if (!folder) throw new BadRequestException('目标文件夹不存在');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const project = await tx.canvasProject.create({
        data: { name, userId, viewport: { x: 0, y: 0, zoom: 1 } },
      });
      const template = await tx.template.create({
        data: { name, userId, projectId: project.id, folderId, status: 'DRAFT', isPublic: false },
      });
      return { templateId: template.id, projectId: project.id };
    });
    this.templateService.clearCache();
    if (folderId) await this.folderService.touch([folderId]);
    return result;
  }

  async save(projectId: string, input: { name: string; description?: string; isPublic?: boolean }, userId: string) {
    const project = await this.projectService.findById(projectId);
    if (project.userId !== null && project.userId !== userId) {
      throw new ForbiddenException('无权保存此工程');
    }

    const nodes = (project.nodes || []).map((n: any) => ({
      id: n.id, type: n.type, position: n.position, data: n.data,
    }));
    const edges = (project.edges || []).map((e: any) => ({
      id: e.id,
      source: e.sourceId || e.source || '',
      target: e.targetId || e.target || '',
    }));
    const templateData = { nodes, edges, viewport: project.viewport };

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
