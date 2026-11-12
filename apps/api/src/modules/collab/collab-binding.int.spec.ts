// apps/api/src/modules/collab/collab-binding.int.spec.ts
// C3a-7（plan v3 Task C3a-7——spec 2026-11-11-foundation-batch-design.md §3.2-4 单写者+命令面两改）：
// BindMedia 真库用例——命令=校验+NodeArtifact/Projection 写（**零 MediaBinding 直写**——绑定经投影
// 出现）；CloneBinding 已删（命令删除锚在 controller.spec 坏 body 档）。三族：
//   ①copy/paste 投影族：客户端粘贴帧（doc 副本携 fileId——canvasStore paste 路径）→appendBatch
//     flush（C3a-5 组合闭包真投影器）→目标节点 binding 经投影出现+零裂图（粘贴后 binding 行在=渲染面引用证人）；
//   ②BindMedia 零 binding 读写：命令前后 MediaBinding 行数不变（布景区分——经投影的行不在命令面断言域）；
//   ③真库 ACL/CAS 档承前（跨队 403+CAS 409+HTTP wire 面）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import * as Y from 'yjs';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { CollabBindingController } from './collab-binding.controller';
import { MEDIA_REFS_READ_PORT, type MediaRefsReadPort } from './media-refs-read.port';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { projectBindings } from './media-binding-projector';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { collectMediaRefsForNode } from '@flowweb/shared';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'c3a7-command-plane-int';
const OTHER_PID = 'c3a7-command-plane-frame';
const UID = 'u-c3a7-owner';

let prisma: PrismaClient;
let repo: CanvasDocUpdateRepository;
let app: INestApplication;
let baseUrl = '';
let controller: CollabBindingController;

const req = () => ({ user: { id: UID } }) as any;

/** doc 兜底端口 mock（unit spec 已锁分档四例——int 侧只走命中形态）。 */
const port: MediaRefsReadPort = { readNodeRefs: vi.fn() };

async function seedMedia(id: string, teamId: string) {
  await prisma.media.upsert({
    where: { id },
    update: { teamId, deletedAt: null, deletionState: 'ACTIVE' },
    create: { id, userId: UID, bucket: 'flowai', key: `c3a7/${id}.bin`, originalName: `${id}.bin`, mimeType: 'image/png', size: 100n, teamId, status: 'completed', type: 'uploaded' },
  });
}

/** 客户端粘贴帧（doc 副本携 fileId——canvasStore paste 路径的帧形态）。 */
const pasteFrame = (nodeId: string, mediaId: string): Uint8Array => {
  const d = new Y.Doc();
  const node = new Y.Map<unknown>();
  const data = new Y.Map<unknown>();
  data.set('fileId', mediaId);
  node.set('type', 'image');
  node.set('data', data);
  (d.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
  return Y.encodeStateAsUpdate(d);
};

maybe('C3a-7：命令面读写两改——BindMedia 零 binding 写+粘贴帧投影（真 PG）', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as never);
    await ensureProjectFixture(prisma, PID);
    await ensureProjectFixture(prisma, OTHER_PID);
    await prisma.user.upsert({ where: { id: UID }, update: {}, create: { id: UID, name: 'c3a7', email: 'c3a7-x@local.test', emailVerified: true } });
    // 跨 run 残留 wipe
    for (const pid of [PID, OTHER_PID]) {
      await prisma.mediaBinding.deleteMany({ where: { projectId: pid } });
      await prisma.artifactProjection.deleteMany({ where: { projectId: pid } });
      await prisma.nodeArtifact.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
    }
    await prisma.media.deleteMany({ where: { id: { in: ['m-c3a7-own', 'm-c3a7-x'] } } });
    await prisma.team.upsert({ where: { id: 'c3a7-other-team' }, update: {}, create: { id: 'c3a7-other-team', name: 'c3a7-x', ownerId: UID } });
    await seedMedia('m-c3a7-own', 'y0a-fixture-team');   // ensureProjectFixture 默认队（FIXTURE_TEAM）
    await seedMedia('m-c3a7-x', 'c3a7-other-team');
    // 源节点 n-src 的 pairArtifact 腿（唯一腿——NodeArtifact 面）
    await prisma.nodeArtifact.create({
      data: { projectId: PID, nodeId: 'n-src', teamId: 'y0a-fixture-team', role: 'primary', targetField: 'fileId', targetItemId: '', rev: 1, source: 'replace', state: 'stored', mediaId: 'm-c3a7-own' },
    });

    const nodeArtifacts = new NodeArtifactService();
    const perm = {
      assertEditorWithTeam: vi.fn(async () => ({ role: 'PROJECT_EDITOR' as const, teamId: 'y0a-fixture-team' })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [CollabBindingController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectPermissionService, useValue: perm },
        { provide: NodeArtifactService, useValue: nodeArtifacts },
        { provide: MEDIA_REFS_READ_PORT, useValue: port },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    const addr = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    controller = moduleRef.get(CollabBindingController);
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    for (const pid of [PID, OTHER_PID]) {
      await prisma?.mediaBinding.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma?.artifactProjection.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma?.nodeArtifact.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await cleanupProjectFixture(prisma, pid);
    }
    await prisma?.media.deleteMany({ where: { id: { in: ['m-c3a7-own', 'm-c3a7-x'] } } }).catch(() => undefined);
    await prisma?.team.deleteMany({ where: { id: 'c3a7-other-team' } }).catch(() => undefined);
    await prisma?.user.deleteMany({ where: { id: UID } }).catch(() => undefined);
    await prisma?.$disconnect();
  }, 30_000);

  // ── 族②：BindMedia 零 binding 读写（spec §3.2-4——bindInTx 退役，绑定经投影出现）──
  it('BindMedia（pairArtifact 腿）：NodeArtifact CAS+投影 pending 落地+★MediaBinding 零直写（命令前后行数不变）', async () => {
    const before = await prisma.mediaBinding.count({ where: { projectId: PID } });
    const out = await controller.command(PID, { type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm-c3a7-own', targetNodeId: 'n-tgt', expectedRev: 0 }, req());
    expect(out).toEqual({ type: 'BindMedia', rev: 1, mediaId: 'm-c3a7-own' });
    const artifact = await prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: 'n-tgt', role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(artifact?.rev).toBe(1);
    expect(artifact?.mediaId).toBe('m-c3a7-own');
    expect(artifact?.state).toBe('stored');
    const projection = await prisma.artifactProjection.findFirst({ where: { artifactId: artifact!.id, artifactRev: 1 } });
    expect(projection?.state).toBe('pending');
    // ★零 binding 直写：命令不写 MediaBinding（目标槽 binding 由客户端 doc 帧→投影出现——族①）
    const after = await prisma.mediaBinding.count({ where: { projectId: PID } });
    expect(after).toBe(before);
    expect(await prisma.mediaBinding.findFirst({ where: { projectId: PID, nodeId: 'n-tgt' } })).toBeNull();
  });

  it('BindMedia（doc 兜底腿）：pairArtifact 缺→端口 refs 命中→放行+零 binding 直写', async () => {
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { nodeId: 'n-doc', mediaId: 'm-c3a7-own', role: 'primary', targetField: 'fileId', targetItemId: '' },
    ]);
    const before = await prisma.mediaBinding.count({ where: { projectId: PID } });
    const out = await controller.command(PID, { type: 'BindMedia', sourceNodeId: 'n-doc', mediaId: 'm-c3a7-own', targetNodeId: 'n-tgt2', expectedRev: 0 }, req());
    expect(out).toEqual({ type: 'BindMedia', rev: 1, mediaId: 'm-c3a7-own' });
    expect(port.readNodeRefs).toHaveBeenCalledWith(PID, 'n-doc');
    expect(await prisma.mediaBinding.count({ where: { projectId: PID } })).toBe(before);
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockReset();
  });

  it('★BindMedia 跨团队 ACL 档（真库）：源 media 团队≠目标项目团队→403+零写（NodeArtifact/binding 均无行）', async () => {
    await expect(controller.command(PID, { type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm-c3a7-x', targetNodeId: 'n-x', expectedRev: 0 }, req()))
      .rejects.toMatchObject({ status: 403 });
    expect(await prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: 'n-x', role: 'primary', targetField: 'fileId', targetItemId: '' } },
    })).toBeNull();   // fail-closed：ACL 拒档零 NodeArtifact 行
    expect(await prisma.mediaBinding.findFirst({ where: { projectId: PID, nodeId: 'n-x' } })).toBeNull();
  });

  it('BindMedia 真库 CAS：expectedRev 过时（rev 已 1 再以 0 提交）→409 ARTIFACT_REV_CONFLICT 零换代', async () => {
    await expect(controller.command(PID, { type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm-c3a7-own', targetNodeId: 'n-tgt', expectedRev: 0 }, req()))
      .rejects.toMatchObject({ status: 409, errorCode: 'ARTIFACT_REV_CONFLICT' });
    const artifact = await prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: 'n-tgt', role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(artifact?.rev).toBe(1);   // 旧 rev 保持（禁静默覆盖）
  });

  it('真 HTTP 面：POST /api/projects/:pid/collab/bindings 路由可达（403 档经 wire 形态透出）；CloneBinding 已删（404 面=路由 body 400）', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PID}/collab/bindings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm-c3a7-x', targetNodeId: 'n-wire', expectedRev: 0 }),
    });
    expect(res.status).toBe(403);   // 跨团队档 wire 透出（ACL 真库负控经 HTTP 面）
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain('跨团队');
    // CloneBinding 命令删除：typed body 不再受理（400 BINDING_COMMAND_BAD_BODY）
    const res2 = await fetch(`${baseUrl}/api/projects/${PID}/collab/bindings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-wire' }),
    });
    expect(res2.status).toBe(400);
  });

  // ── 族①：copy/paste 投影族（客户端 doc 帧自足→目标节点 binding 经投影出现+零裂图）──
  it('★粘贴帧→flush→binding 在：客户端 doc 帧（doc 副本携 fileId）经 appendBatch 组合闭包真投影→MediaBinding 行出现+水位推进', async () => {
    await ensureLeaseFixture(prisma, repo);
    // 帧路径布景：CanvasDoc 建档（干净水位 0）
    await prisma.canvasDoc.create({
      data: { projectId: OTHER_PID, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false },
    });
    // 客户端粘贴帧：actor 帧路径单源转换（touched node→collectMediaRefsForNode 终态——collab-project-actor 同款）
    const nodeId = 'pasted-node';
    const replay = new Y.Doc();
    try {
      Y.applyUpdate(replay, pasteFrame(nodeId, 'm-c3a7-own'));
      const delta = new Map([[nodeId, collectMediaRefsForNode(nodeId, (replay.getMap('nodes') as Y.Map<unknown>).get(nodeId))]]);
      // flush（C3a-5 组合闭包形态——SAVEPOINT+真投影器；闭包结构=collab-project-actor.flushPrefixToPg 同款）
      const r = await repo.appendBatch(OTHER_PID, [seedRow(pasteFrame(nodeId, 'm-c3a7-own'), 5n)], { expectedPgSeq: 0n, newPgSeq: 5n, walCheckpointSeq: 5n },
        async (tx: Prisma.TransactionClient) => {
          await tx.$executeRaw`SAVEPOINT media_binding_projection`;
          try {
            const teamId = (await tx.canvasProject.findUnique({ where: { id: OTHER_PID }, select: { teamId: true } }))?.teamId;
            if (teamId == null) throw new Error('CanvasProject 行缺失');
            await projectBindings(tx, OTHER_PID, teamId, delta);
            await tx.$executeRaw`RELEASE SAVEPOINT media_binding_projection`;
            return { bindingCovered: true };
          } catch {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT media_binding_projection`;
            await tx.canvasDoc.updateMany({ where: { projectId: OTHER_PID }, data: { bindingsDirty: true } });
            return { bindingCovered: false };
          }
        });
      expect(r).toEqual({ ok: true, rows: 1 });
    } finally {
      replay.destroy();
    }
    // 目标节点 binding 经投影出现（零裂图——渲染面引用证人在）
    const binding = await prisma.mediaBinding.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: OTHER_PID, nodeId, role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(binding?.mediaId).toBe('m-c3a7-own');
    // 干净 flush：binding 水位随帧水位推进（连续前缀落定）
    const doc = await prisma.canvasDoc.findUnique({ where: { projectId: OTHER_PID } });
    expect(doc?.pgSeq).toBe(5n);
    expect(doc?.mediaBindingSeq).toBe(5n);
    expect(doc?.bindingsDirty).toBe(false);
    // 清场（帧路径布景不泄漏到命令面用例）
    await restoreLeaseRow(prisma);
    await prisma.mediaBinding.deleteMany({ where: { projectId: OTHER_PID } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: OTHER_PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: OTHER_PID } });
  });
});
