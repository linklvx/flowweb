import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { TeamFundsGateService } from '../team/team-funds-gate.service';
import { toDocLike } from '../collab/doc-like.util';
import { createCanvasDoc } from '../collab/canvas-doc.factory';
import { ensureCanvasDocHead } from '../collab/canvas-doc-genesis';
import { fenceProject, lockProject } from '../collab/project-lock';
import { openProjectErasure, type ErasureRunView } from '../collab/project-erasure';
import { fillDoc, stripAuthorState, stripDerivedKeys, CANVAS_DOC_SCHEMA_VERSION, CANVAS_PROJECT_ORIGIN_USER, type CanvasProjectOrigin } from '@flowweb/shared';
import { assertTeamMember } from '../team/team.util';
import { ensureProjectGovernance } from '../collab/project-governance.service';

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
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamService) private readonly teamService: TeamService,
    @Inject(TeamFundsGateService) private readonly fundsGate: TeamFundsGateService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(name: string, userId?: string, nodes?: any[], edges?: any[], teamId?: string, origin: CanvasProjectOrigin = CANVAS_PROJECT_ORIGIN_USER) {
    let teamIdResolved: string;
    if (teamId && userId) {
      await assertTeamMember(this.prisma, teamId, userId);
      teamIdResolved = teamId;
    } else {
      teamIdResolved = (await this.teamService.ensureDefaultTeam(userId || '')).id;
    }
    const project = await this.prisma.$transaction(async (tx) => {
      // C4-b（R15 fence 接线·写锁门禁）：创建事务首句 lockProject（advisory·锁序①）。id 客户端
      // 显式生成（randomUUID——id 列 String 无格式约束；ProjectErasureRun erasureId 同源形态）：
      // advisory 锁键须先于行建可知；新 id 无争用者，行缺失折 ACTIVE=fence 天然放行新生项目。
      const plannedId = randomUUID();
      await lockProject(tx, plannedId);
      const created = await tx.canvasProject.create({
        data: {
          id: plannedId,
          name,
          userId: userId || null,
          teamId: teamIdResolved,
        },
      });
      // C2-0（生产就绪收尾批）：governance 必经——OpsGate ('compact',pid,'OPEN') 项目行+origin
      //  谱系单源写点（同事务原子；漏接=该路径项目 compact 永久 fail-closed〔C2-1 两行校验缺项目行
      //  即拒〕——census ㊱ 调用点执法）。C4-a：origin 参数化（'clone' 谱系——VideoWorkCloneService
      //  接线+cleanDrafts 判据消费；缺省 'user'）。
      await ensureProjectGovernance(tx, { projectId: created.id, origin });
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
      if (nodes && nodes.length > 0) {
        // T17 顺修①：stripAuthorState 只走键集表剥键——placement 判别校验未接（order+slot 并存/
        // 非法 order 键可经种子入 doc）。接 stripDerivedKeys 同款（web dispatchProjectionDiff 批尾
        // 断言/api 种子入口共用——零第二 guard 体系）：违例 fail-closed throw，先于 fillDoc/落库。
        const stripped = stripAuthorState(nodes as any);
        const placementViolations = stripDerivedKeys(stripped);
        if (placementViolations.length > 0) {
          throw new BadRequestException(`种子 placement 违例（DOC_NODE_KEYS 判别）：${placementViolations.slice(0, 3).join('；')}`);
        }
        fillDoc(toDocLike(seed), stripped, edges ?? []);
      }
      // Y1c T7（勘误方案 B·Controller 裁定 4）：genesis 双路共用建头 helper——旧 state 种子 upsert
      // 形态逐字保留（update 由内聚 helper 落），同事务追加 Snapshot(g,0,0)+RuntimeFeedCursor 行；
      // SystemHistory 缺失/为零=fail-closed（整事务回滚，无部分写入）。
      await ensureCanvasDocHead(tx, created.id, Buffer.from(Y.encodeStateAsUpdate(seed)));
      seed.destroy();
      return created;
    });

    return this.findById(project.id, userId);   // Y0b-5 T5：新建者即 viewer——世代通道随行
  }

  /** Y0b-5 T5：世代可见通道（E3「鉴权握手返回」）——collabGeneration（CanvasDoc.generation ??
   *  0：doc 懒建于 loadDocument，行缺失=确定性 0 代）+collabSchemaVersion+collabViewerUid（请求者
   *  uid——四维本地缓存键 uid 维）。fetchProjectMeta 先于 initCollab 消费（page.tsx promise 链）
   *  ——零新往返零新端点。
   *  T18（Y1b T2）：collabSchemaVersion 改传**行值**（CanvasDoc.schemaVersion PG 列）。现实性对齐
   *  （评审 P2#6）：列出生即 @default(3)（20261020200300 迁移）——**行值=2 现实不可达**，≠3 档是
   *  防御性面向未来 v4 bump 的语义面（届时旧行=3≠4 ⇒缓存键 s3≠s4 结构性 miss〔IDB 不命中〕+WS
   *  装载列门拒载双锚一致）；行缺失=懒建档形态回落 current 常量——首 store 建行 @default(3) 与回值一致）。 */
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

  /** C4-b（R15 fence 接线）：改名=项目维写——单事务 lockProject→fenceProject（DELETING 拒 409
   *  域——ProjectErasingError 由 controller 例外映射； ACTIVE 放行）。 */
  async updateName(id: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockProject(tx, id);
      await fenceProject(tx, id);
      return tx.canvasProject.update({ where: { id }, data: { name } });
    });
  }

  /** C4-a（plan Task C4-1 红①——tombstone-only）：删项目=单事务 lockProject（advisory·锁序①）→
   *  FOR SHARE fence 校验（③位）→资金门（in-tx 持锁检查——C4-a 扩查三面，不过回滚 409）→置
   *  lifecycleState='DELETING'+插 run 行（PENDING）→提交→emit project.gone→202 返回 run 视图。
   *  物理删除全归 worker saga（C4-c）。幂等：重复删除请求→活跃 run 存在→同 run 返回；DONE 后再删
   *  （restore 形态）→新 run（partial unique）。dryRun=跳过置位（项目不隐藏）不 emit。emit 崩溃
   *  catch-warn（tombstone 已提交=run 行持久恢复锚——kill -9 后重复请求同 run）。 */
  async delete(id: string, requestedBy?: string, opts: { dryRun?: boolean } = {}): Promise<ErasureRunView> {
    const run = await this.prisma.$transaction(async (tx) => {
      await lockProject(tx, id);   // 锁序①：事务首语句（project-lock 单源）
      return openProjectErasure(tx, {
        projectId: id,
        requestedBy: requestedBy ?? '',
        dryRun: opts.dryRun,
        gate: (t) => this.fundsGate.assertSettled(t, { projectId: id }),
      });
    });
    if (!opts.dryRun) {
      // Y0a-2（V11）语义随 tombstone 保留：提交后 emit（处理器禁慢操作——内存终态+关连接）；
      // emit 失败=best-effort warn（红① kill -9 on emit：run 行=恢复锚，重放面归 worker 轮询）
      await this.eventEmitter.emitAsync('project.gone', { projectIds: [id] })
        .catch((e: unknown) => this.logger.warn(`project.gone emit 失败（tombstone 已提交——run 行 ${run.erasureId} 为恢复锚）: ${e}`));
    }
    return run;
  }

  /** C4-a 红②：cleanDrafts 同批 tombstone（判据=`(origin IS NULL OR origin='user')`∧无 Template∧24h
   *  ∧lifecycleState='ACTIVE'——clone 谱系不删）。FOR UPDATE 锁定集→批量资金门（任一未清算整批 409）
   *  →逐项目 tombstone+run→提交后按确实被 tombstone 的集合 emit。 */
  async cleanDrafts(userId: string) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Y0a-2（V11+X13）：**FOR UPDATE 事务**锁定（毒化窗归零——X13 语义随 tombstone 承继），提交后按
    // **确实被 tombstone 的集合** emit。
    const deletedIds = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "CanvasProject"
        WHERE "userId" = ${userId} AND "updatedAt" < ${cutoff}
          AND ("origin" IS NULL OR "origin" = 'user')
          AND "lifecycleState" = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM "Template" WHERE "Template"."projectId" = "CanvasProject"."id")
        FOR UPDATE`;
      const ids = rows.map((r) => r.id);
      // Y0b-1（§1.4ter/Z4）：批量前置清算门——锁定集内任一项目资金未清算 ⇒ 整批 409（tx 同连接同快照；
      // C4-a 扩查三面同门）。逐项目 openProjectErasure 幂等（heal-rare 活跃 run→同 run 返回）不重复过门。
      if (ids.length > 0) await this.fundsGate.assertSettled(tx, { projectIds: ids });
      for (const id of ids) {
        // C4-b（写锁门禁/fence）：批内逐项目补 advisory 锁序①（openProjectErasure 自读 FOR SHARE
        // 与批 FOR UPDATE 同行自锁兼容——advisory 先行统一 doc 序键面）。
        await lockProject(tx, id);
        await openProjectErasure(tx, { projectId: id, requestedBy: userId });
      }
      return ids;
    });
    if (deletedIds.length > 0) await this.eventEmitter.emitAsync('project.gone', { projectIds: deletedIds });
    return { deletedCount: deletedIds.length };   // Y20：保留既有返回键（controller/前端消费不变——C4-a 只改删除形态不破形状）
  }
}
