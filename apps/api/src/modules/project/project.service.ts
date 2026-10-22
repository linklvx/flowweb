import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { TeamFundsGateService } from '../team/team-funds-gate.service';
import { toDocLike } from '../collab/doc-like.util';
import { createCanvasDoc } from '../collab/canvas-doc.factory';
import { fillDoc, stripAuthorState, CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';
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
    @Inject(TeamFundsGateService) private readonly fundsGate: TeamFundsGateService,
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
      // Y0a-3（T8①/P1-3/V19）：种子 PG 侧同事务落库——创建原子化（不依赖领导权、不产"行已建"
      //  半成品、clone 链同受益）。T18：meta 戳删除（版本承载=PG 列——建行走 @default(3)，
      //  doc 内容零版本键）；空画布也稳定落 CanvasDoc 行。
      //  V19：fillDoc 契约=（DocLike, stripAuthorState 输出, edges）——直传原始记录=往快照写非作者态
      //  键（分镜子 position/组帧键按组类型键集表——clone 传入的正是作者态记录）。
      const seed = createCanvasDoc();
      if (nodes && nodes.length > 0) fillDoc(toDocLike(seed), stripAuthorState(nodes as any), edges ?? []);
      await tx.canvasDoc.upsert({
        where: { projectId: created.id },
        create: { projectId: created.id, state: Buffer.from(Y.encodeStateAsUpdate(seed)), stateSeq: 0n },
        update: {},
      });
      seed.destroy();
      return created;
    });

    return this.findById(project.id, userId);   // Y0b-5 T5：新建者即 viewer——世代通道随行
  }

  /** Y0b-5 T5：世代可见通道（E3「鉴权握手返回」）——collabGeneration（CanvasDoc.generation ??
   *  0：doc 懒建于 loadDocument，行缺失=确定性 0 代）+collabSchemaVersion+collabViewerUid（请求者
   *  uid——四维本地缓存键 uid 维）。fetchProjectMeta 先于 initCollab 消费（page.tsx promise 链）
   *  ——零新往返零新端点。
   *  T18（Y1b T2）：collabSchemaVersion 改传**行值**（CanvasDoc.schemaVersion PG 列——旧档行=2
   *  ⇒客户端缓存键 s2≠s3 结构性 miss〔IDB 不命中〕且 WS 装载列门拒载双锚一致；行缺失=懒建档
   *  形态，回落 current 常量——首 store 建行 @default(3) 与回值一致）。 */
  async findById(id: string, viewerId?: string | null) {
    const project = await this.prisma.canvasProject.findUnique({
      where: { id },
    });
    if (!project) throw new NotFoundException('Project not found');
    const doc = await this.prisma.canvasDoc.findUnique({
      where: { projectId: id },
      select: { generation: true, schemaVersion: true },
    });
    return {
      ...project,
      collabGeneration: doc?.generation ?? 0,
      collabSchemaVersion: doc?.schemaVersion ?? CANVAS_DOC_SCHEMA_VERSION,
      collabViewerUid: viewerId ?? null,
    };
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
    // Y0b-1（§1.4ter/Z4）：删项目前置清算门——在飞 RUNNING∨冻结>0 ⇒ 409（非事务调用点传 this.prisma，
    // 读后写窗口=reconcile+孤儿巡检兜底）
    await this.fundsGate.assertSettled(this.prisma, { projectId: id });
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
      // Y0b-1（§1.4ter/Z4）：批量前置清算门——锁定集内任一项目资金未清算 ⇒ 整批 409（tx 同连接同快照）
      if (ids.length > 0) await this.fundsGate.assertSettled(tx, { projectIds: ids });
      if (ids.length > 0) await tx.canvasProject.deleteMany({ where: { id: { in: ids } } });
      return ids;
    });
    if (deletedIds.length > 0) await this.eventEmitter.emitAsync('project.gone', { projectIds: deletedIds });
    return { deletedCount: deletedIds.length };   // Y20：保留既有返回键（controller/前端消费不变——X13 只改 SQL/emit 不破形状）
  }
}
