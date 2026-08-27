import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import * as Y from 'yjs';
import { CollabDocumentService } from '../collab/collab-document.service';

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
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamService) private readonly teamService: TeamService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
  ) {}

  async create(name: string, userId?: string, nodes?: any[], edges?: any[]) {
    const team = await this.teamService.ensureDefaultTeam(userId || '');
    const project = await this.prisma.canvasProject.create({
      data: {
        name,
        userId: userId || null,
        teamId: team.id,
      },
    });

    if (nodes && nodes.length > 0) {
      // 模板导入：经 Hocuspocus 直连写入（走完整 load→transact→flush 生命周期）
      await this.collabDoc.withDoc(project.id, (doc) => {
        const nodesMap = doc.getMap('nodes');
        for (const n of nodes) {
          const m = new Y.Map();
          m.set('type', n.type);
          if (n.parentId != null) m.set('parentId', n.parentId);
          if (n.width != null) m.set('width', n.width);
          if (n.height != null) m.set('height', n.height);
          const position = new Y.Map();
          position.set('x', n.position?.x ?? 0);
          position.set('y', n.position?.y ?? 0);
          m.set('position', position);
          const data = new Y.Map();
          for (const [k, v] of Object.entries(n.data ?? {})) data.set(k, v);
          m.set('data', data);
          nodesMap.set(n.id, m);
        }
        const edgesMap = doc.getMap('edges');
        for (const e of edges ?? []) {
          const m = new Y.Map();
          m.set('source', e.source ?? e.sourceId ?? '');
          m.set('target', e.target ?? e.targetId ?? '');
          edgesMap.set(e.id, m);
        }
      });
    }

    return this.findById(project.id);
  }

  async findById(id: string) {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id },
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
