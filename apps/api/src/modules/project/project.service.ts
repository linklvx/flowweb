import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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

  async create(
    name: string,
    userId?: string,
    nodes?: any[],
    edges?: any[],
    viewport?: { x: number; y: number; zoom: number },
  ) {
    const viewportData = viewport || { x: 0, y: 0, zoom: 1 };
    const project = await this.prisma.canvasProject.create({
      data: {
        name,
        userId: userId || null,
        viewport: viewportData,
      },
    });

    // If nodes provided, create them
    if (nodes && nodes.length > 0) {
      await this.prisma.canvasNode.createMany({
        data: nodes.map((n: any) => ({
          id: n.id,
          projectId: project.id,
          type: n.type,
          position: n.position || { x: 0, y: 0 },
          data: n.data || {},
        })),
      });
    }

    // If edges provided, create them
    if (edges && edges.length > 0) {
      await this.prisma.canvasEdge.createMany({
        data: edges.map((e: any) => ({
          id: e.id,
          projectId: project.id,
          sourceId: e.source || '',
          targetId: e.target || '',
        })),
      });
    }

    return this.findById(project.id);
  }

  async findById(id: string) {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id },
      include: { nodes: true, edges: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
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

  async updateViewport(id: string, viewport: { x: number; y: number; zoom: number }) {
    return this.prisma.canvasProject.update({
      where: { id },
      data: { viewport },
    });
  }

  /** 画布整体原子同步（自动保存）：乐观锁 version 校验 + nodes/edges 同事务重写 */
  async syncCanvas(projectId: string, nodes: NodeInput[], edges: EdgeInput[], version: number) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.canvasProject.updateMany({
        where: { id: projectId, version },
        data: { version: version + 1 },
      });
      if (updated.count === 0) {
        const exists = await tx.canvasProject.findUnique({
          where: { id: projectId },
          select: { version: true },
        });
        if (!exists) throw new NotFoundException('Project not found');
        throw new ConflictException('画布已被他人修改');
      }
      await tx.canvasNode.deleteMany({ where: { projectId } });
      if (nodes.length > 0) {
        const sorted = [...nodes].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
        await tx.canvasNode.createMany({
          data: sorted.map((n) => ({
            id: n.id,
            projectId,
            type: n.type,
            position: n.position,
            data: n.data,
            width: n.width ?? null,
            height: n.height ?? null,
            parentId: n.parentId ?? null,
          })),
        });
      }
      await tx.canvasEdge.deleteMany({ where: { projectId } });
      if (edges.length > 0) {
        await tx.canvasEdge.createMany({
          data: edges.map((e) => ({
            id: e.id,
            projectId,
            sourceId: e.sourceId || e.source || '',
            targetId: e.targetId || e.target || '',
          })),
        });
      }
      return { version: version + 1 };
    });
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
