import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { CollabDocumentService } from '../collab/collab-document.service';
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
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
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
      return created;
    });

    // O0b-0 版本门 v2.1：REST 种子唯一戳点——withDoc 无条件执行（去 nodes.length>0 闸门：
    // 闸门内=REST 建项目 controller:17 传 undefined 永不落 doc 不盖章；副作用=空画布也稳定
    // 产生 CanvasDoc 行+盖章——空档无戳∧零节点在 WS loadDocument 自愈兜底前先有确定性戳）。
    // 带节点链（clone 传数组/import 随 (a1) 删）经同一回调。
    await this.collabDoc.withDoc(project.id, (doc) => {
      stampDocSchema(toDocLike(doc));
      if (nodes && nodes.length > 0) {
        // 模板导入：经 Hocuspocus 直连写入（走完整 load→transact→flush 生命周期）；
        // 写侧经 shared fillDoc 单源（O0a-2 收编——data 全量写入/edges 单形状随函数同源）；
        // 记录经 stripAuthorState 剥键回作者态（spec ③记录契约：fillDoc 只接受其输出——
        // 分镜子 position/组帧键按组类型键集表）。O0b-0：normalizeLoadedCanvas 补缺层整删
        //（翻转后 doc=完整作者态，补几何语义死——种子直读 strip 输出）
        fillDoc(toDocLike(doc), stripAuthorState(nodes as any), edges ?? []);
      }
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
