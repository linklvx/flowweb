import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { toDocLike } from '../collab/doc-like.util';
import { fillDoc, normalizeLoadedCanvas, stripAuthorState } from '@flowweb/shared';
import { assertTeamMember } from '../team/team.util';

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
  source: string;
  target: string;
}

@Injectable()
export class ProjectService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamService) private readonly teamService: TeamService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
  ) {}

  async create(name: string, userId?: string, nodes?: any[], edges?: any[], teamId?: string) {
    let teamIdResolved: string;
    if (teamId && userId) {
      await assertTeamMember(this.prisma, teamId, userId);
      teamIdResolved = teamId;
    } else {
      teamIdResolved = (await this.teamService.ensureDefaultTeam(userId || '')).id;
    }
    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.canvasProject.create({
        data: {
          name,
          userId: userId || null,
          teamId: teamIdResolved,
        },
      });
      if (userId) {
        await tx.projectMember.create({
          data: { projectId: created.id, userId, role: 'PROJECT_OWNER' },
        });
      }
      return created;
    });

    if (nodes && nodes.length > 0) {
      // 模板导入：经 Hocuspocus 直连写入（走完整 load→transact→flush 生命周期）；
      // 写侧经 shared fillDoc 单源（O0a-2 收编——api 本地手抄本整删，meta 戳/data 全量
      // 写入/edges 单形状随函数同源）；记录经 stripAuthorState 剥键回作者态（spec ③记录契约：
      // fillDoc 只接受其输出——分镜子 position/组帧键按组类型键集表）
      await this.collabDoc.withDoc(project.id, (doc) => {
        // R1b Task 20：写 doc 前过 normalizeLoadedCanvas（幂等保险——与浏览器 applyDocToStore 同一函数，非补齐依赖）
        const seeded = normalizeLoadedCanvas(nodes as any);
        fillDoc(toDocLike(doc), stripAuthorState(seeded), edges ?? []);
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

  /** 画布所属文件夹 id；非本团队成员/未登录/teamId 缺失/无关联时返回 null（不暴露项目存在性） */
  async getProjectFolder(id: string, userId?: string, teamId?: string) {
    if (!userId || !teamId) return { folderId: null };
    const project = await this.prisma.canvasProject.findFirst({
      where: { id, teamId },
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
