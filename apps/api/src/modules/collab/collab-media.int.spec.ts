// apps/api/src/modules/collab/collab-media.int.spec.ts —— Y1a+Y1b T11（spec Z11''③/Z18''）：
// replaceMedia/clearMedia 命令真库红绿——POST /api/projects/:id/collab/nodes/:nodeId/media
//   ①replace：PG NodeArtifact CAS（rev+1+source='replace'+state='stored'）+新 ArtifactProjection
//     pending（[artifactId,artifactRev]）+旧 pending 投影 superseded+MediaBinding current-state upsert
//     ——doc 交付归投影 poller（T15 收口：本命令零 doc 直写，pending 行驱动异步收敛）；
//   ②clear：CAS（mediaId 清空+state='none'）+新 pending 投影（mediaId=null）——doc 键删同归 poller
//     （deliverArtifact targetField 等值面：clear 行 mediaId=null=skip 写、recheck 判 superseded 归
//     fast path 判定——见 projection-outbox.poller.int.spec）；
//   ③409 ARTIFACT_REV_CONFLICT：expectedRev 过期（0 行=superseded）→槽位不被覆盖；
//   ④GET 槽位状态：{targetField,rev,mediaId}——客户端初始 expectedRev 来源；
//   ⑤权限：VIEWER→403；跨团队 mediaId→403（读侧 ACL 团队级 Z7''-v14 的写面同构）。
// 红形态（改前可复现）：CollabMediaController 全仓不存在（编译级红）；doc 写面零接入。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { fillDoc, stampDocSchema, type StoredNodeRecord } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';
import { CollabMediaController } from './collab-media.controller';
import { toDocLike } from './doc-like.util';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const perm = new ProjectPermissionService(prisma as unknown as PrismaService);
const nodeArtifacts = new NodeArtifactService();
const registration = new MediaRegistrationService(prisma as unknown as PrismaService, {} as never);

let controller: CollabMediaController;
let doc: Y.Doc;

const PID = `int-t11-${Date.now()}`;
const UID = `int-t11-owner-${Date.now()}`;
const VIEWER_ID = `int-t11-viewer-${Date.now()}`;
let TID = '';
let OTHER_TID = '';

const NODE = `n-t11-${randomUUID().slice(0, 8)}`;

const seedNode = (id: string, data: Record<string, unknown> = { status: 'idle' }): StoredNodeRecord =>
  ({ id, type: 'imageGen', data } as StoredNodeRecord);

const seedSlot = async (nodeId: string, rev: number, mediaId: string) => {
  await prisma.nodeArtifact.create({
    data: { projectId: PID, nodeId, teamId: TID, role: 'primary', targetField: 'fileId', targetItemId: '', rev, state: 'stored', mediaId },
  });
};
const seedMedia = async (teamId: string, suffix: string) =>
  prisma.media.create({
    data: { userId: UID, teamId, key: `int-t11/${suffix}`, originalName: `${suffix}.png`, mimeType: 'image/png', size: 1_000, type: 'uploaded', status: 'completed' },
  });

const slotRow = (nodeId: string) => prisma.nodeArtifact.findUnique({
  where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId, role: 'primary', targetField: 'fileId', targetItemId: '' } },
});

(hasDb ? describe : describe.skip)('Y1a T11：replaceMedia/clearMedia 命令（真 PG）', () => {
  let MEDIA_OLD: string;
  let MEDIA_NEW: string;

  beforeAll(async () => {
    // ── 真库夹具：owner（编辑权）+viewer（只读）+本项目与他队各一 Media 行 ──
    for (const uid of [UID, VIEWER_ID]) {
      await prisma.user.upsert({
        where: { id: uid },
        create: { id: uid, name: `int-t11-${uid}`, email: `${uid}@test.local`, emailVerified: false },
        update: {},
      });
    }
    TID = (await prisma.team.create({ data: { name: 'int-t11-team', ownerId: UID } })).id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await prisma.teamMember.create({ data: { teamId: TID, userId: VIEWER_ID, role: 'MEMBER' } });
    OTHER_TID = (await prisma.team.create({ data: { name: 'int-t11-other-team', ownerId: UID } })).id;
    await prisma.teamMember.create({ data: { teamId: OTHER_TID, userId: UID, role: 'OWNER' } });
    await prisma.canvasProject.create({ data: { id: PID, name: 'int-t11', userId: UID, teamId: TID } });
    // 项目成员显式记录：viewer 挂 PROJECT_VIEWER（权限链显式记录 > 创建者 > 团队角色回退）
    await prisma.projectMember.create({ data: { projectId: PID, userId: VIEWER_ID, role: 'PROJECT_VIEWER' } });
    MEDIA_OLD = (await seedMedia(TID, 'old')).id;
    MEDIA_NEW = (await seedMedia(TID, 'new')).id;

    // ── doc 夹具：bare Y.Doc 种目标节点（writeBatch 直写的应用面） ──
    doc = new Y.Doc();
    stampDocSchema(toDocLike(doc));
    fillDoc(toDocLike(doc), [seedNode(NODE, { status: 'done', fileId: MEDIA_OLD })], []);

    controller = new CollabMediaController(
      perm,
      prisma as unknown as PrismaService,
      nodeArtifacts,
      registration,
    );
  });

  afterAll(async () => {
    // 零资金路径：无台账行——team 级联删（带 GUC 通行证）覆盖 Media/MediaBinding/user 关系
    await prisma.artifactProjection.deleteMany({ where: { projectId: PID } });
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });
    await prisma.projectMember.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID, OTHER_TID]);
    await prisma.user.deleteMany({ where: { id: { in: [UID, VIEWER_ID] } } });
    await prisma.$disconnect();
  });

  describe('GET 槽位状态（初始 expectedRev 来源）', () => {
    it('无槽位行 → {targetField:"fileId", rev:0, mediaId:null}', async () => {
      const r = await controller.getSlot(PID, `n-get-${randomUUID().slice(0, 6)}`, { user: { id: UID } } as never);
      expect(r).toEqual({ targetField: 'fileId', rev: 0, mediaId: null });
    });

    it('有槽位行（rev=1+mediaId）→ 回读真值', async () => {
      const nodeId = `n-get2-${randomUUID().slice(0, 6)}`;
      await seedSlot(nodeId, 1, MEDIA_OLD);
      const r = await controller.getSlot(PID, nodeId, { user: { id: UID } } as never);
      expect(r).toEqual({ targetField: 'fileId', rev: 1, mediaId: MEDIA_OLD });
    });
  });

  describe('POST replace（变换保存/手工换图路径）', () => {
    it('CAS 胜：rev+1+source=replace+state=stored+新 pending 投影+旧 pending 投影 superseded+binding upsert——T15：零 doc 直写（交付归投影 poller）', async () => {
      await seedSlot(NODE, 1, MEDIA_OLD);
      // 旧代 pending 投影（T10 finalize 形态）——胜者命令后必须 superseded
      const artifactId = (await slotRow(NODE))!.id;
      await prisma.artifactProjection.create({
        data: { artifactId, artifactRev: 1, projectId: PID, nodeId: NODE, targetField: 'fileId', targetItemId: '', mediaId: MEDIA_OLD, state: 'pending' },
      });

      const r = await controller.command(PID, NODE, { action: 'replace', mediaId: MEDIA_NEW, expectedRev: 1 }, { user: { id: UID } } as never);

      expect(r).toEqual({ action: 'replace', rev: 2, mediaId: MEDIA_NEW });
      // PG 权威面
      const row = await slotRow(NODE);
      expect(row!.rev).toBe(2);
      expect(row!.mediaId).toBe(MEDIA_NEW);
      expect(row!.source).toBe('replace');
      expect(row!.state).toBe('stored');
      // 投影面：新 pending（[artifactId,2]）+旧 pending superseded
      const projections = await prisma.artifactProjection.findMany({ where: { artifactId }, orderBy: { artifactRev: 'asc' } });
      expect(projections.map((p) => [p.artifactRev, p.state, p.mediaId])).toEqual([
        [1, 'superseded', MEDIA_OLD],
        [2, 'pending', MEDIA_NEW],
      ]);
      // binding current-state upsert（键 [projectId,nodeId,role,targetField,targetItemId]）
      const binding = await prisma.mediaBinding.findUnique({
        where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: NODE, role: 'primary', targetField: 'fileId', targetItemId: '' } },
      });
      expect(binding?.mediaId).toBe(MEDIA_NEW);
      // T15 收口：命令零 doc 直写（doc data 不被命令触碰——pending 投影行驱动 poller 异步收敛；
      // poll 驱动的 doc 终态断言归 projection-outbox.poller.int.spec 真双端面）
      const data = (doc.getMap('nodes').get(NODE) as Y.Map<any>).get('data') as Y.Map<any>;
      expect(data.get('fileId')).toBe(MEDIA_OLD);
    });

    it('409：expectedRev 过期（槽位已换代）→ ARTIFACT_REV_CONFLICT+槽位不被覆盖', async () => {
      const row = await slotRow(NODE);
      const staleRev = row!.rev - 1;
      await expect(
        controller.command(PID, NODE, { action: 'replace', mediaId: MEDIA_OLD, expectedRev: staleRev }, { user: { id: UID } } as never),
      ).rejects.toMatchObject({ status: 409, errorCode: 'ARTIFACT_REV_CONFLICT' });
      const after = await slotRow(NODE);
      expect(after!.rev).toBe(row!.rev); // 槽位未被覆盖
      expect(after!.mediaId).toBe(MEDIA_NEW);
      // 409 后客户端复读槽位 → 新 expectedRev → 重试成功（重试一轮完成）
      const slot = await controller.getSlot(PID, NODE, { user: { id: UID } } as never);
      const retry = await controller.command(PID, NODE, { action: 'replace', mediaId: MEDIA_OLD, expectedRev: slot.rev }, { user: { id: UID } } as never);
      expect(retry).toEqual({ action: 'replace', rev: slot.rev + 1, mediaId: MEDIA_OLD });
    });

    it("跨团队 mediaId → 403（读侧 ACL 团队级 Z7''-v14 的写面同构——跨队引用拒）", async () => {
      const other = await seedMedia(OTHER_TID, 'other-team');
      const nodeId = `n-xteam-${randomUUID().slice(0, 6)}`;
      await seedSlot(nodeId, 0, MEDIA_OLD);
      await expect(
        controller.command(PID, nodeId, { action: 'replace', mediaId: other.id, expectedRev: 0 }, { user: { id: UID } } as never),
      ).rejects.toMatchObject({ status: 403 });
      expect((await slotRow(nodeId))!.mediaId).toBe(MEDIA_OLD);
    });
  });

  describe('POST clear（Angle3D 清空路径）', () => {
    it('CAS 胜：mediaId 清空+state=none+新 pending 投影（mediaId=null）——T15：零 doc 直写（键删归 poller）', async () => {
      const nodeId = `n-clear-${randomUUID().slice(0, 6)}`;
      await seedSlot(nodeId, 1, MEDIA_NEW);
      fillDoc(toDocLike(doc), [seedNode(nodeId, { status: 'done', fileId: MEDIA_NEW, referenceImage: 'ref-1' })], []);

      const r = await controller.command(PID, nodeId, { action: 'clear', expectedRev: 1 }, { user: { id: UID } } as never);

      expect(r).toEqual({ action: 'clear', rev: 2, mediaId: null });
      const row = await slotRow(nodeId);
      expect(row!.rev).toBe(2);
      expect(row!.mediaId).toBeNull();
      expect(row!.state).toBe('none');
      expect(row!.source).toBe('replace');
      const projection = await prisma.artifactProjection.findFirst({ where: { artifactId: row!.id, artifactRev: 2 } });
      expect(projection?.state).toBe('pending');
      expect(projection?.mediaId).toBeNull();
      // T15 收口：命令零 doc 直写（doc fileId 键不被命令触碰——clear 投影行 mediaId=null 归 poller 判定）
      const data = (doc.getMap('nodes').get(nodeId) as Y.Map<any>).get('data') as Y.Map<any>;
      expect(data.get('fileId')).toBe(MEDIA_NEW);
      expect(data.get('referenceImage')).toBe('ref-1');   // 客户端写域不被触碰
    });
  });

  describe('权限', () => {
    it('VIEWER POST → 403（写命令=编辑权）', async () => {
      await expect(
        controller.command(PID, NODE, { action: 'clear', expectedRev: 0 }, { user: { id: VIEWER_ID } } as never),
      ).rejects.toMatchObject({ status: 403 });
    });
    it('非成员 GET → 403（读槽位=项目成员门）', async () => {
      await expect(
        controller.getSlot(PID, NODE, { user: { id: `int-t11-stranger-${randomUUID().slice(0, 6)}` } } as never),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  // ════════ 质评收口（Important#1 软删 media + Minor#2 expectedRev 上界 + Minor#3 written:false 留痕）════════
  describe('质评收口', () => {
    it('红①软删 media replace 拒（Important#1）：deletedAt 行 → 404 媒体不存在+槽位/投影零变更（「绑定即可读」不变量——软删 content 读侧 404，绑定落地=渲染永久 404）', async () => {
      const nodeId = `n-softdel-${randomUUID().slice(0, 6)}`;
      await seedSlot(nodeId, 1, MEDIA_OLD);
      const softDeleted = await prisma.media.create({
        data: { userId: UID, teamId: TID, key: `int-t11/softdel-${randomUUID().slice(0, 6)}`, originalName: 'softdel.png', mimeType: 'image/png', size: 1_000, type: 'uploaded', status: 'completed', deletedAt: new Date() },
      });
      await expect(
        controller.command(PID, nodeId, { action: 'replace', mediaId: softDeleted.id, expectedRev: 1 }, { user: { id: UID } } as never),
      ).rejects.toMatchObject({ status: 404 });
      const row = await slotRow(nodeId);
      expect(row!.rev).toBe(1);                    // 槽位不被覆盖
      expect(row!.mediaId).toBe(MEDIA_OLD);
      const binding = await prisma.mediaBinding.findFirst({ where: { projectId: PID, nodeId } });
      expect(binding).toBeNull();                  // 软删不建 binding
    });

    it('红②expectedRev 上界（Minor#2）：2^31-1 → 400 MEDIA_COMMAND_BAD_BODY（防无槽位 INSERT rev=2^31 溢出 int4→22003→500 噪声）；上界内 2^31-2 合法（INSERT rev=2147483647 恰容）', async () => {
      const nodeId = `n-overflow-${randomUUID().slice(0, 6)}`;   // 无槽位行——INSERT 分支才触溢出面
      await expect(
        controller.command(PID, nodeId, { action: 'clear', expectedRev: 2_147_483_647 }, { user: { id: UID } } as never),
      ).rejects.toMatchObject({ status: 400, errorCode: 'MEDIA_COMMAND_BAD_BODY' });
      expect(await slotRow(nodeId)).toBeNull();    // 400 在 PG 之前——零行零副作用
      // 上界内恰容：2^31-2 → INSERT rev=2147483647=int4 max
      const okNodeId = `n-boundary-${randomUUID().slice(0, 6)}`;
      const r = await controller.command(PID, okNodeId, { action: 'clear', expectedRev: 2_147_483_646 }, { user: { id: UID } } as never);
      expect(r.rev).toBe(2_147_483_647);
    });

    it('红③（T15 形态迁移）：node 并发删除——命令面零 doc 观察（PG 权威照常成功+pending 投影行在案；node 删除→orphaned 收敛归 poller apply 守卫——旧 Minor#3 直写 warn 面随直写退役）', async () => {
      const nodeId = `n-gone-${randomUUID().slice(0, 6)}`;   // 槽位在 PG、节点不在 doc（并发删除形态）
      await seedSlot(nodeId, 1, MEDIA_OLD);
      const r = await controller.command(PID, nodeId, { action: 'replace', mediaId: MEDIA_NEW, expectedRev: 1 }, { user: { id: UID } } as never);
      expect(r.rev).toBe(2);                     // PG 权威面照常成功（CAS 不因投影基础设施回退）
      const projection = await prisma.artifactProjection.findFirst({ where: { nodeId, artifactRev: 2 } });
      expect(projection?.state).toBe('pending'); // 交付有 owner（poller apply written:false→orphaned 终态）
    });
  });
});
