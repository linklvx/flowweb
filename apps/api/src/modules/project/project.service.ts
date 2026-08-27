import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { readCanvasLegacy, buildLegacyDocState } from '../canvas/canvas-legacy.reader';
import { getOwnerTeamId } from '../team/team.util';

interface NodeInput {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: any;
  parentId?: string | null;
  width?: number;
  height?: number;
}

interface EdgeInput {
  id: string;
  sourceId?: string;
  targetId?: string;
  source?: string;
  target?: string;
}

@Injectable()
export class ProjectService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(name: string, userId?: string, nodes?: any[], edges?: any[]) {
    const project = await this.prisma.canvasProject.create({
      data: {
        name,
        userId: userId || null,
        teamId: await getOwnerTeamId(this.prisma, userId),
      },
    });

    if (nodes && nodes.length > 0) {
      // TODO(Task13): withDoc 写入
      await this.prisma.canvasDoc.create({
        data: { projectId: project.id, state: buildLegacyDocState(nodes, edges ?? []) },
      });
    }

    return this.findById(project.id);
  }

  async findById(id: string) {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id },
    });
    if (!project) throw new NotFoundException('Project not found');
    const canvas = await readCanvasLegacy(this.prisma, id);
    return { ...project, nodes: canvas.nodes, edges: canvas.edges };
  }

  /** 画布所属文件夹 id；属主不匹配/未登录/无关联时返回 null（不暴露项目存在性） */
  async getProjectFolder(id: string, userId?: string) {
    if (!userId) return { folderId: null };
    const project = await this.prisma.canvasProject.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!project) return { folderId: null };
    const template = await this.prisma.template.findUnique({
      where: { projectId: id },
      select: { folderId: true },
    });
    return { folderId: template?.folderId ?? null };
  }

  async updateName(id: string, name: string) {
    return this.prisma.canvasProject.update({
      where: { id },
      data: { name },
    });
  }

  async delete(id: string) {
    return this.prisma.canvasProject.delete({ where: { id } });
  }

  async cleanDrafts(userId: string) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.prisma.canvasProject.deleteMany({
      where: {
        userId,
        updatedAt: { lt: cutoff },
        templates: { none: {} },
      },
    });
    return { deletedCount: result.count };
  }
}
