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

  async create(name: string) {
    return this.prisma.canvasProject.create({
      data: { name },
    });
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
      data: nodes.map((n) => ({
        id: n.id,
        projectId,
        type: n.type,
        position: n.position,
        data: n.data,
      })),
    });
    return this.prisma.canvasNode.findMany({ where: { projectId } });
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

  async delete(id: string) {
    return this.prisma.canvasProject.delete({ where: { id } });
  }
}
