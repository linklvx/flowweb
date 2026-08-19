import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';

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
}
