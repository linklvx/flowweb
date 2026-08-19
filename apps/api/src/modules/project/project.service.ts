import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface NodeInput {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: any;
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

  async updateViewport(id: string, viewport: { x: number; y: number; zoom: number }) {
    return this.prisma.canvasProject.update({
      where: { id },
      data: { viewport },
    });
  }

  async syncNodes(projectId: string, nodes: NodeInput[]) {
    await this.prisma.canvasNode.deleteMany({ where: { projectId } });
    if (nodes.length === 0) return [];
    await this.prisma.canvasNode.createMany({
      data: nodes.map((n: any) => ({
        id: n.id,
        projectId,
        type: n.type,
        position: n.position,
        data: n.data,
        width: n.width ?? 280,
        height: n.height ?? 120,
      })),
    });
    return this.prisma.canvasNode.findMany({ where: { projectId } });
  }

  async updateDimensions(
    projectId: string,
    dto: { id: string; width: number; height: number }[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        dto.map(({ id, width, height }) =>
          tx.canvasNode.updateMany({ where: { id }, data: { width, height } }),
        ),
      );
    });
  }

  async syncEdges(projectId: string, edges: EdgeInput[]) {
    await this.prisma.canvasEdge.deleteMany({ where: { projectId } });
    if (edges.length === 0) return [];
    await this.prisma.canvasEdge.createMany({
      data: edges.map((e) => ({
        id: e.id,
        projectId,
        sourceId: e.sourceId || e.source || '',
        targetId: e.targetId || e.target || '',
      })),
    });
    return this.prisma.canvasEdge.findMany({ where: { projectId } });
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
