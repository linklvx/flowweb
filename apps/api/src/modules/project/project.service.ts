import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { toDocLike } from '../collab/doc-like.util';
import { fillDoc, stampDocSchema, stripAuthorState } from '@flowweb/shared';
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
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
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
      // Y0a-3（T8①/P1-3/V19）：种子 PG 侧同事务落库——创建原子化（不依赖领导权、不产"行已建无戳"
      //  半成品、clone 链同受益）；首装载 hydrate state 已含戳——O0b-0 语义不变。
      //  V19：fillDoc 契约=（DocLike, stripAuthorState 输出, edges）——直传原始记录=往快照写非作者态
      //  键（分镜子 position/组帧键按组类型键集表——clone 传入的正是作者态记录）。
      //  O0b-0：无条件盖章（去 nodes.length 闸门——空画布也稳定落 CanvasDoc 行+确定性戳）。
      const seed = new Y.Doc();
      stampDocSchema(toDocLike(seed));
      if (nodes && nodes.length > 0) fillDoc(toDocLike(seed), stripAuthorState(nodes as any), edges ?? []);
      await tx.canvasDoc.upsert({
        where: { projectId: created.id },
        create: { projectId: created.id, state: Buffer.from(Y.encodeStateAsUpdate(seed)), stateSeq: 0n },
        update: {},
      });
      seed.destroy();
      return created;
    });

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
    const deleted = await this.prisma.canvasProject.delete({ where: { id } });
    // Y0a-2（V11）：提交后 emit（emitAsync await 监听器——处理器禁慢操作：内存终态+关连接；
    // 回滚安全：删除失败=异常上抛=无 emit=该项目协作写不受影响）
    await this.eventEmitter.emitAsync('project.gone', { projectIds: [id] });
    return deleted;
  }

  async cleanDrafts(userId: string) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Y0a-2（V11+X13）：**FOR UPDATE 事务**锁定并删除（关掉"查询→deleteMany 间草稿跃过 cutoff→
    // 活项目进终态集"的毒化窗——deleteMany 不返回被删 id 是 Prisma 既有限制，FOR UPDATE 把窗口归零），
    // 提交后按**确实被删的集合** emit。
    const deletedIds = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "CanvasProject"
        WHERE "userId" = ${userId} AND "updatedAt" < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM "Template" WHERE "Template"."projectId" = "CanvasProject"."id")
        FOR UPDATE`;
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) await tx.canvasProject.deleteMany({ where: { id: { in: ids } } });
      return ids;
    });
    if (deletedIds.length > 0) await this.eventEmitter.emitAsync('project.gone', { projectIds: deletedIds });
    return { deletedCount: deletedIds.length };   // Y20：保留既有返回键（controller/前端消费不变——X13 只改 SQL/emit 不破形状）
  }
}
