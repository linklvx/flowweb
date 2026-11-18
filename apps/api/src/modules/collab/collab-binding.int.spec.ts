// apps/api/src/modules/collab/collab-binding.int.spec.ts
// C3a-7（plan v3 Task C3a-7——spec 2026-11-11-foundation-batch-design.md §3.2-4 单写者+命令面两改）：
// BindMedia 真库用例——命令=校验+NodeArtifact/Projection 写（**零 MediaBinding 直写**——绑定经投影
// 出现）；CloneBinding 已删（命令删除锚在 controller.spec 坏 body 档）。三族：
//   ①copy/paste 投影族：客户端粘贴帧（doc 副本携 mediaId——canvasStore paste 路径，Y2 B3 后作者键）→appendBatch
//     flush（C3a-5 组合闭包真投影器）→目标节点 binding 经投影出现+零裂图（粘贴后 binding 行在=渲染面引用证人）；
//   ②BindMedia 零 binding 读写：命令前后 MediaBinding 行数不变（布景区分——经投影的行不在命令面断言域）；
//   ③真库 ACL/CAS 档承前（跨队 403+CAS 409+HTTP wire 面）。
// Y2 D2t（spec v2.13 §3 D5 第④条「跨团队拷贝=占坑先行」）：受理层真库九档——权限三查/两腿改查
// 源项目/幂等查（含 409 BIND_COMMAND_MISMATCH）/事务内占坑（真 PG 行锁并发）/同桶 CopyObject 去重
// （桩注入——int 池无 S3；bucket=源行列）/失败清理档。
// Y2 D3t：槽条件写三档+同团队三档+完成独立函数+快照直调真库七档（spec §8 字节拷贝顺序钉死的
// CopyObject 后段）；槽写端口=COLLAB_SLOT_WRITE_PORT mock（真 withSession 装置在
// collab-document.service.spec/author-slot.service.spec 面——int 侧 controller 分档逻辑为主断言面）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import * as Y from 'yjs';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { CollabBindingController } from './collab-binding.controller';
import { MEDIA_REFS_READ_PORT, type MediaRefsReadPort } from './media-refs-read.port';
import { COLLAB_SLOT_WRITE_PORT, type CollabSlotWritePort, type SlotWriteOutcome } from './slot-write.port';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { projectBindings } from './media-binding-projector';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';
import { StorageQuotaService } from '../team/storage-quota.service';
import { MinioService } from '../minio/minio.service';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { collectMediaRefsForNode, CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';   // Y2 C1：sv 布景常量化

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

/** 客户端粘贴帧（doc 副本携 mediaId——Y2 B3 后 paste 路径的帧形态：作者键=mediaId）。 */
const pasteFrame = (nodeId: string, mediaId: string): Uint8Array => {
  const d = new Y.Doc();
  const node = new Y.Map<unknown>();
  const data = new Y.Map<unknown>();
  data.set('mediaId', mediaId);
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
    // D2t 三查②：UID 补 FIXTURE_TEAM 成员行（源媒体 m-c3a7-own 归属队——assertTeamMember 真库查）
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: 'y0a-fixture-team', userId: UID } },
      update: {},
      create: { teamId: 'y0a-fixture-team', userId: UID, role: 'MEMBER' },
    });
    await seedMedia('m-c3a7-own', 'y0a-fixture-team');   // ensureProjectFixture 默认队（FIXTURE_TEAM）
    await seedMedia('m-c3a7-x', 'c3a7-other-team');
    // 源节点 n-src 的 pairArtifact 腿（唯一腿——NodeArtifact 面）
    await prisma.nodeArtifact.create({
      data: { projectId: PID, nodeId: 'n-src', teamId: 'y0a-fixture-team', role: 'primary', targetField: 'mediaId', targetItemId: '', rev: 1, source: 'replace', state: 'stored', mediaId: 'm-c3a7-own' },
    });

    const nodeArtifacts = new NodeArtifactService();
    const perm = {
      assertEditorWithTeam: vi.fn(async () => ({ role: 'PROJECT_EDITOR' as const, teamId: 'y0a-fixture-team' })),
      resolveWithTeam: vi.fn(async () => ({ role: 'PROJECT_EDITOR' as const, teamId: 'y0a-fixture-team' })),
    };
    // D2t：占坑/拷贝面桩（正路占坑+拷贝走桩——int 池无 S3；旧族用例只钉零槽写不变量）
    const legacyCopyStub = makeCopyStub();
    // D3t：旧族槽写端口桩——空槽直写回执（真 conditionalWrite 同构——快照单格 mediaId/媒体引用；
    // 本族正路=同团队档〔perm 桩恒回 fixture 队=源行同队〕，绑定经投影出现为合法产物）
    const legacySlotDoc = new Y.Doc();
    const legacySlotPort: CollabSlotWritePort = {
      async conditionalWrite(_pid: string, nodeId: string, slotId: string) {
        const node = new Y.Map<unknown>();
        const data = new Y.Map<unknown>();
        data.set('mediaId', slotId);
        node.set('type', 'image');
        node.set('data', data);
        (legacySlotDoc.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
        return { slot: 'empty', snapshot: collectMediaRefsForNode(nodeId, node) };
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [CollabBindingController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectPermissionService, useValue: perm },
        { provide: NodeArtifactService, useValue: nodeArtifacts },
        { provide: MEDIA_REFS_READ_PORT, useValue: port },
        { provide: COLLAB_SLOT_WRITE_PORT, useValue: legacySlotPort },
        { provide: MinioService, useValue: legacyCopyStub.minio },
        { provide: StorageQuotaService, useValue: { assertCanUploadInTx: vi.fn(async () => undefined) } },
        { provide: MediaRegistrationService, useValue: { deletePending: vi.fn(async () => 0) } },
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
    await prisma?.teamMember.deleteMany({ where: { teamId: 'y0a-fixture-team', userId: UID } }).catch(() => undefined);
    await prisma?.storageReservation.deleteMany({ where: { teamId: 'y0a-fixture-team' } }).catch(() => undefined);   // D2t 占坑族清理（Media 行已删——预留先显式清）
    await prisma?.team.deleteMany({ where: { id: 'c3a7-other-team' } }).catch(() => undefined);
    await prisma?.user.deleteMany({ where: { id: UID } }).catch(() => undefined);
    await prisma?.$disconnect();
  }, 30_000);

  // ── 族②：BindMedia 零 binding 读写（spec §3.2-4——bindInTx 退役，绑定经投影出现）──
  // Y2 B4（v5 改死四）：删生成 CAS 段——命令面零 NodeArtifact/Projection 写维持。
  // Y2 D3t 勘正：源 m-c3a7-own 与目标 PID 同队（ensureProjectFixture 默认队 FIXTURE_TEAM——
  // perm 桩恒回 y0a-fixture-team）⇒ D3t 后本族正路=**同团队档**（槽条件写原 id+快照投影——零
  // 拷贝零新行）；「零 NodeArtifact/Projection 写」不变量锚维持（命令面零写）；MediaBinding 行
  // 经投影合法出现（槽写正路产物——非命令面直插）。
  it('BindMedia（pairArtifact 腿）：★零 NodeArtifact/Projection 写（同团队档槽条件写——命令面零写不变量维持）', async () => {
    const out = await controller.command(PID, { type: 'BindMedia', sourceProjectId: PID, sourceNodeId: 'n-src', mediaId: 'm-c3a7-own', targetNodeId: 'n-tgt', commandId: `cmd-c3a7-pa-${Date.now()}` }, req());
    expect(out.type).toBe('BindMedia');
    expect(out.mediaId).toBe('m-c3a7-own');   // 同团队档返回原 id（D3t——判源=源 media id）
    expect(await prisma.nodeArtifact.findFirst({ where: { projectId: PID, nodeId: 'n-tgt' } })).toBeNull();   // CAS 段已删禁加回
    expect(await prisma.artifactProjection.findFirst({ where: { projectId: PID, nodeId: 'n-tgt' } })).toBeNull();
    // 零拷贝零新行（同团队无新行无新键）
    expect(await prisma.media.count({ where: { teamId: 'y0a-fixture-team', bindCommandId: { not: null } } })).toBe(0);
    // 绑定经投影出现（槽写正路产物——非命令面直插；后续用例 before/after 基线含本行）
    const binding = await prisma.mediaBinding.findFirst({ where: { projectId: PID, nodeId: 'n-tgt' } });
    expect(binding?.mediaId).toBe('m-c3a7-own');
  });

  it('BindMedia（doc 兜底腿）：pairArtifact 缺→端口 refs 命中→放行（源项目域读）——同团队档返回原 id+绑定经投影出现', async () => {
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID, nodeId: 'n-doc' } });
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { nodeId: 'n-doc', mediaId: 'm-c3a7-own', role: 'primary', targetField: 'mediaId', targetItemId: '' },
    ]);
    const out = await controller.command(PID, { type: 'BindMedia', sourceProjectId: PID, sourceNodeId: 'n-doc', mediaId: 'm-c3a7-own', targetNodeId: 'n-tgt2', commandId: `cmd-c3a7-doc-${Date.now()}` }, req());
    expect(out.type).toBe('BindMedia');
    expect(out.mediaId).toBe('m-c3a7-own');   // 同团队档原 id
    expect(port.readNodeRefs).toHaveBeenCalledWith(PID, 'n-doc');
    expect(await prisma.nodeArtifact.findFirst({ where: { projectId: PID, nodeId: 'n-tgt2' } })).toBeNull();
    const binding = await prisma.mediaBinding.findFirst({ where: { projectId: PID, nodeId: 'n-tgt2' } });
    expect(binding?.mediaId).toBe('m-c3a7-own');
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockReset();
  });

  it('★BindMedia 跨团队 ACL 档（真库）：非源团队成员（三查②）→403+零写（NodeArtifact/binding 均无行）', async () => {
    await expect(controller.command(PID, { type: 'BindMedia', sourceProjectId: PID, sourceNodeId: 'n-src', mediaId: 'm-c3a7-x', targetNodeId: 'n-x', commandId: `cmd-c3a7-x-${Date.now()}` }, req()))
      .rejects.toMatchObject({ status: 403 });
    expect(await prisma.nodeArtifact.findFirst({ where: { projectId: PID, nodeId: 'n-x' } })).toBeNull();   // fail-closed：ACL 拒档零 NodeArtifact 行
    expect(await prisma.mediaBinding.findFirst({ where: { projectId: PID, nodeId: 'n-x' } })).toBeNull();
  });

  it('真 HTTP 面：POST /api/projects/:pid/collab/bindings 路由可达（403 档经 wire 形态透出）；CloneBinding 已删（404 面=路由 body 400）', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PID}/collab/bindings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'BindMedia', sourceProjectId: PID, sourceNodeId: 'n-src', mediaId: 'm-c3a7-x', targetNodeId: 'n-wire', commandId: `cmd-wire-${Date.now()}` }),
    });
    expect(res.status).toBe(403);   // 非源团队成员档 wire 透出（ACL 真库负控经 HTTP 面）
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain('成员');   // 三查② assertTeamMember 403 文案（「非团队成员」）
    // CloneBinding 命令删除：typed body 不再受理（400 BINDING_COMMAND_BAD_BODY）
    const res2 = await fetch(`${baseUrl}/api/projects/${PID}/collab/bindings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-wire' }),
    });
    expect(res2.status).toBe(400);
  });

  // ── 族①：copy/paste 投影族（客户端 doc 帧自足→目标节点 binding 经投影出现+零裂图）──
  it('★粘贴帧→flush→binding 在：客户端 doc 帧（doc 副本携 mediaId）经 appendBatch 组合闭包真投影→MediaBinding 行出现+水位推进', async () => {
    await ensureLeaseFixture(prisma, repo);
    // 帧路径布景：CanvasDoc 建档（干净水位 0）
    await prisma.canvasDoc.create({
      data: { projectId: OTHER_PID, generation: 1, schemaVersion: CANVAS_DOC_SCHEMA_VERSION, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false },
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
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: OTHER_PID, nodeId, role: 'primary', targetField: 'mediaId', targetItemId: '' } },
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

// ════════ Y2 D2t（spec v2.13 §3 D5 ④——跨团队粘贴受理层「占坑先行」真库九档）══════════════
// 布景双域：源（SRC_TID/SRC_PID——NodeArtifact 锚行+源 Media+源 doc 引用两腿）+目标（DST_TID/
// DST_PID——粘贴落点；同队复用 a3a7-own 不适用——本块自建全链）。MinIO=桩（int 池无 S3——
// copyObject 调用录制断言面；media-registration.int 先例同款）；配额门=真 StorageQuotaService
//（TeamSubscriptionService 桩注入 storageLimitBytes=t23 先例）；CopyObject 失败档=桩抛错。
const D2T_UID = 'u-d2t-binder';const SRC_TID = 'd2t-src-team';
const DST_TID = 'd2t-dst-team';
const SRC_PID = 'd2t-src-proj';
const DST_PID = 'd2t-dst-proj';
/** 非源团队成员（权限三查第②查拒档）。 */
const OUTSIDER = 'u-d2t-outsider';
/** 源团队成员但目标项目无编辑权（权限三查第①查拒档）。 */
const SRC_ONLY = 'u-d2t-src-only';
/** 源团队成员但源项目只读（第③查 role!=null 放行——三查全过正路用例走 D2T_UID）。 */
const SRC_VIEWER = 'u-d2t-src-viewer';
const SRC_MEDIA = 'm-d2t-src';
/** 源 size（BigInt 列——占坑 upperBoundBytes 同值）。 */
const SRC_SIZE = 4_000n;

/** CopyObject 桩（s3 send mock 先例形态——MinioService 实例换 send；调用录制=断言面）。 */
type CopyCall = { sourceBucket: string; sourceKey: string; destKey: string };
const makeCopyStub = (opts: { failOn?: number } = {}) => {
  const calls: CopyCall[] = [];
  const svc = new MinioService({ endpoint: 'http://127.0.0.1:9000', accessKey: 'a', secretKey: 's', bucket: 'flowai', useSsl: false });
  let n = 0;
  (svc as unknown as { s3Client: { send: unknown } }).s3Client = {
    send: vi.fn(async (cmd: { input: { Bucket?: string; Key?: string; CopySource?: string } }) => {
      n += 1;
      if (opts.failOn === n) throw { $metadata: { httpStatusCode: 500 }, name: 'InternalError' };
      // CopyObjectCommand 桩：CopySource="bucket/key" 形态——首个 '/' 前为桶、余为键（键可含 '/'）
      if (cmd?.input?.CopySource != null) {
        const src = String(cmd.input.CopySource);
        const slash = src.indexOf('/');
        calls.push({ sourceBucket: src.slice(0, slash), sourceKey: src.slice(slash + 1), destKey: String(cmd.input.Key) });
      }
      return {};
    }),
  };
  return { minio: svc, calls };
};

maybe('Y2 D2t：跨团队粘贴受理层——权限三查+两腿查源项目+幂等+占坑+去重拷贝（真 PG）', () => {
  let prisma2: PrismaClient;
  let ctl: CollabBindingController;
  let copyStub: ReturnType<typeof makeCopyStub>;
  /** 幂等/两腿/占坑面共享端口（doc 兜底腿）。 */
  const d2tPort: MediaRefsReadPort = { readNodeRefs: vi.fn() };
  /** 槽条件写端口 mock（D3t——Y.Doc 直投形态照 author-slot.service.spec docsStub 先例：
   *  conditionalWrite 在真 Y.Doc 上读槽/写槽+collectMediaRefsForNode 快照——分档逻辑经
   *  controller 真库面断言；transact 零 await 语义由生产 withSession 承载）。 */
  const slotDoc = new Y.Doc();
  const slotWritePort: CollabSlotWritePort & { setSlot(nodeId: string, mediaId: string | null): void } = {
    setSlot(nodeId, mediaId) {
      const node = new Y.Map<unknown>();
      const data = new Y.Map<unknown>();
      if (mediaId != null) data.set('mediaId', mediaId);
      node.set('type', 'image');
      node.set('data', data);
      (slotDoc.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
    },
    async conditionalWrite(_pid: string, nodeId: string, slotId: string): Promise<SlotWriteOutcome> {
      const entry = (slotDoc.getMap('nodes') as Y.Map<unknown>).get(nodeId);
      const data = entry instanceof Y.Map ? entry.get('data') : undefined;
      const current = data instanceof Y.Map ? data.get('mediaId') : undefined;
      const slotValue = typeof current === 'string' && current !== '' ? current : null;
      if (slotValue == null && data instanceof Y.Map) {
        data.set('mediaId', slotId);   // 槽空才写（data 容器在场——D2t 族布景先 setSlot 后直写）
        return { slot: 'empty', snapshot: collectMediaRefsForNode(nodeId, entry) };
      }
      if (slotValue == null) {
        // 节点/data 容器缺席（D2t 族布景未播种目标节点）——真 conditionalWrite 的「空槽随写随建」同构
        const node = new Y.Map<unknown>();
        const d = new Y.Map<unknown>();
        d.set('mediaId', slotId);
        node.set('type', 'image');
        node.set('data', d);
        (slotDoc.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
        return { slot: 'empty', snapshot: collectMediaRefsForNode(nodeId, node) };
      }
      return slotValue === slotId
        ? { slot: 'mine', snapshot: collectMediaRefsForNode(nodeId, entry) }
        : { slot: 'foreign', snapshot: collectMediaRefsForNode(nodeId, entry) };
    },
  };
  let quota: StorageQuotaService;

  const bindBody = (over: Record<string, unknown> = {}) => ({
    type: 'BindMedia', sourceProjectId: SRC_PID, sourceNodeId: 'n-d2t-src', mediaId: SRC_MEDIA,
    targetNodeId: 'n-d2t-tgt', commandId: `cmd-${Math.random().toString(36).slice(2)}`, ...over,
  });
  const reqOf = (uid: string) => ({ user: { id: uid } }) as any;

  /** 源行创建（两腿布景变体：withArtifact=true 走 pairArtifact 腿；false 走 doc 兜底腿）。 */
  const seedSourceMedia = async (over: { id?: string; size?: bigint; thumbnailKey?: string | null; objectKey?: string | null } = {}) => {
    return prisma2.media.create({
      data: {
        id: over.id ?? SRC_MEDIA, userId: D2T_UID, teamId: SRC_TID, bucket: 'flowai',
        key: `d2t/src-${over.id ?? SRC_MEDIA}.bin`, originalName: 'src.bin', mimeType: 'image/png',
        size: over.size ?? SRC_SIZE, type: 'uploaded', status: 'completed',
        thumbnailKey: over.thumbnailKey ?? null, objectKey: over.objectKey ?? null,
      },
    });
  };

  beforeAll(async () => {
    prisma2 = new PrismaClient();
    // ── 双域全链 fixture：用户×4+双队（源/目标）+双项目+源 Media ──
    for (const uid of [D2T_UID, OUTSIDER, SRC_ONLY, SRC_VIEWER]) {
      await prisma2.user.upsert({
        where: { id: uid }, update: {},
        create: { id: uid, name: `d2t-${uid}`, email: `${uid}@local.test`, emailVerified: true },
      });
    }
    for (const [tid, owner] of [[SRC_TID, D2T_UID], [DST_TID, D2T_UID]] as const) {
      await prisma2.team.upsert({ where: { id: tid }, update: {}, create: { id: tid, name: `d2t-${tid}`, ownerId: owner } });
    }
    // D2T_UID=源队 OWNER+目标队 OWNER；SRC_ONLY=仅源队成员；SRC_VIEWER=源队成员+源项目显式 VIEWER。
    for (const [tid, uid, role] of [
      [SRC_TID, D2T_UID, 'OWNER'], [SRC_TID, SRC_ONLY, 'MEMBER'], [SRC_TID, SRC_VIEWER, 'MEMBER'],
      [DST_TID, D2T_UID, 'OWNER'],
    ] as const) {
      await prisma2.teamMember.upsert({ where: { teamId_userId: { teamId: tid, userId: uid } }, update: {}, create: { teamId: tid, userId: uid, role } });
    }
    await prisma2.canvasProject.upsert({ where: { id: SRC_PID }, update: {}, create: { id: SRC_PID, name: 'd2t-src', userId: D2T_UID, teamId: SRC_TID } });
    await prisma2.canvasProject.upsert({ where: { id: DST_PID }, update: {}, create: { id: DST_PID, name: 'd2t-dst', userId: D2T_UID, teamId: DST_TID } });
    // 源项目 VIEWER 行（SRC_VIEWER——resolveWithTeam 显式档 role=PROJECT_VIEWER 非空=能读源项目）
    await prisma2.projectMember.upsert({ where: { projectId_userId: { projectId: SRC_PID, userId: SRC_VIEWER } }, update: {}, create: { projectId: SRC_PID, userId: SRC_VIEWER, role: 'PROJECT_VIEWER' } });
    await seedSourceMedia();
    // 源 NodeArtifact 锚行（pairArtifact 腿——源项目域三维对齐）
    await prisma2.nodeArtifact.create({
      data: { projectId: SRC_PID, nodeId: 'n-d2t-src', teamId: SRC_TID, role: 'primary', targetField: 'mediaId', targetItemId: '', rev: 1, source: 'replace', state: 'stored', mediaId: SRC_MEDIA },
    });

    copyStub = makeCopyStub();
    const fakeSub = { getLimits: vi.fn(async () => ({ seatLimit: 1, storageLimitBytes: 6 * 1024 * 1024 * 1024 })) } as any;
    quota = new StorageQuotaService(prisma2 as unknown as PrismaService, copyStub.minio as any, fakeSub);
    const registration = new MediaRegistrationService(prisma2 as unknown as PrismaService, copyStub.minio as any, quota as any);
    const realPerm = new ProjectPermissionService(prisma2 as unknown as PrismaService);
    ctl = new CollabBindingController(
      realPerm, prisma2 as unknown as PrismaService, d2tPort,
      copyStub.minio as MinioService, quota, registration, slotWritePort,
    );
  }, 60_000);

  afterAll(async () => {
    // 自建全链清理（Media 级联随 team；StorageReservation 随 media deleteMany 前显式清）
    await prisma2.storageReservation.deleteMany({ where: { teamId: { in: [SRC_TID, DST_TID] } } }).catch(() => undefined);
    await prisma2.media.deleteMany({ where: { teamId: { in: [SRC_TID, DST_TID] } } }).catch(() => undefined);
    await prisma2.nodeArtifact.deleteMany({ where: { projectId: { in: [SRC_PID, DST_PID] } } }).catch(() => undefined);
    await prisma2.projectMember.deleteMany({ where: { projectId: { in: [SRC_PID, DST_PID] } } }).catch(() => undefined);
    await prisma2.mediaBinding.deleteMany({ where: { projectId: { in: [SRC_PID, DST_PID] } } }).catch(() => undefined);
    await prisma2.canvasProject.deleteMany({ where: { id: { in: [SRC_PID, DST_PID] } } }).catch(() => undefined);
    await prisma2.teamMember.deleteMany({ where: { teamId: { in: [SRC_TID, DST_TID] } } }).catch(() => undefined);
    await prisma2.team.deleteMany({ where: { id: { in: [SRC_TID, DST_TID] } } }).catch(() => undefined);
    await prisma2.user.deleteMany({ where: { id: { in: [D2T_UID, OUTSIDER, SRC_ONLY, SRC_VIEWER] } } }).catch(() => undefined);
    await prisma2.$disconnect().catch(() => undefined);
  }, 30_000);

  // ── 档⑨（先钉正路形态）：跨团队源配对两腿命中+CopyObject 成功——源对象仍在（拷贝非移动）──
  // Y2 D3t：槽条件写闭环后正路终态=行 completed（完成独立小函数——D2t 时点的 pending 中间态
  // 由 D3t 块崩溃窗档专测）；预留 SETTLED；绑定经快照直调投影出现。
  it('正路：跨团队粘贴→行（新键/三幂等列/bucket=源行/不复制关联列）completed+预留 SETTLED+回执新 id；源行源键不动', async () => {
    const out = await ctl.command(DST_PID, bindBody(), reqOf(D2T_UID));
    expect(out.type).toBe('BindMedia');
    expect(out.mediaId).not.toBe(SRC_MEDIA);   // 新行 id
    expect(out.mediaId).toBeTruthy();
    const pending = await prisma2.media.findUniqueOrThrow({ where: { id: out.mediaId } });
    expect(pending.status).toBe('completed');   // D3t 完成独立小函数（CAS+SETTLED+fact 同 tx）
    expect(pending.teamId).toBe(DST_TID);   // teamId=目标团队
    expect(pending.bucket).toBe('flowai');   // bucket=源行 bucket 列
    expect(pending.size).toBe(SRC_SIZE);   // BigInt 列保持
    expect(pending.key).not.toBe((await prisma2.media.findUniqueOrThrow({ where: { id: SRC_MEDIA } })).key);   // 新键≠源键
    expect(pending.bindCommandId).toBeTypeOf('string');
    expect(pending.bindSourceMediaId).toBe(SRC_MEDIA);
    expect(pending.bindTargetProjectId).toBe(DST_PID);
    expect(pending.pendingExpiresAt).toBeNull();   // 离开 pending 态——TTL 不再命中（D3t 完成清）
    expect(pending.probeState).toBe('pending');   // 不覆写——探针重算（禁整段 confirmInTx 根因锚）
    // 不复制关联列
    expect(pending.projectId).toBeNull();
    expect(pending.nodeId).toBeNull();
    expect(pending.taskId).toBeNull();
    expect(pending.clientUploadId).toBeNull();
    expect(pending.sourceRegistrationKey).toBeNull();
    // 占坑预留终态：StorageReservation SETTLED（upperBoundBytes=源.size——实字节入账）
    const resv = await prisma2.storageReservation.findUnique({ where: { mediaId: out.mediaId } });
    expect(resv?.state).toBe('SETTLED');
    expect(resv?.upperBoundBytes).toBe(SRC_SIZE);
    // CopyObject 桩断言：源桶显式=源行 bucket 列（勿抄 'flowai' 字面量——跨桶方法）+源键=源行 key
    expect(copyStub.calls).toHaveLength(1);
    expect(copyStub.calls[0].sourceBucket).toBe('flowai');
    expect(copyStub.calls[0].sourceKey).toBe(`d2t/src-${SRC_MEDIA}.bin`);
    expect(copyStub.calls[0].destKey).toBe(pending.key);
    // 源行原样（拷贝非移动——status/bucket/key 不动）
    const src = await prisma2.media.findUniqueOrThrow({ where: { id: SRC_MEDIA } });
    expect(src.status).toBe('completed');
    expect(src.key).toBe(`d2t/src-${SRC_MEDIA}.bin`);
    // 槽写成（D3t）：零 NodeArtifact 维持；绑定经投影出现（非命令面直插）
    expect(await prisma2.nodeArtifact.findFirst({ where: { projectId: DST_PID, nodeId: 'n-d2t-tgt' } })).toBeNull();
    const binding = await prisma2.mediaBinding.findFirst({ where: { projectId: DST_PID, nodeId: 'n-d2t-tgt' } });
    expect(binding?.mediaId).toBe(out.mediaId);
  });

  // ── 档①：权限三查各拒 ──
  it('权限三查拒档：非目标编辑→403；非源团队成员→403；源项目无读权（他队无成员行）→403——零 pending 行', async () => {
    const before = await prisma2.media.count({ where: { teamId: DST_TID, bindCommandId: { not: null } } });
    // ①非目标项目编辑（SRC_ONLY：仅源队成员——目标 resolveWithTeam role=null→403）
    await expect(ctl.command(DST_PID, bindBody(), reqOf(SRC_ONLY))).rejects.toMatchObject({ status: 403 });
    // ②非源团队成员（OUTSIDER：目标队 OWNER 但源队无成员行——assertTeamMember→403）
    await expect(ctl.command(DST_PID, bindBody(), reqOf(OUTSIDER))).rejects.toMatchObject({ status: 403 });
    // ③源项目无读权（OUTSIDER 对 SRC_PID resolveWithTeam role=null→403）
    await expect(ctl.command(DST_PID, bindBody(), reqOf(OUTSIDER))).rejects.toMatchObject({ status: 403 });
    expect(await prisma2.media.count({ where: { teamId: DST_TID, bindCommandId: { not: null } } })).toBe(before);
  });

  // ── 档②：跨项目源配对命中（两腿改查源项目）──
  it('跨项目两腿：pairArtifact 腿查源项目域（源在另一项目命中）+doc 兜底腿读源项目 doc——命中各自放行占坑', async () => {
    // pairArtifact 腿：源 NodeArtifact 行在 SRC_PID（非目标 DST_PID）——旧域查目标必 miss，新域命中
    // （目标节点唯一化——D3t 槽条件写下同节点他 id 再写=409 档）
    const out = await ctl.command(DST_PID, bindBody({ targetNodeId: 'n-d2t-tgt-pair' }), reqOf(D2T_UID));
    expect(out.mediaId).not.toBe(SRC_MEDIA);
    // doc 兜底腿：删 NodeArtifact 锚行→端口读源项目 doc refs 命中 mediaId（读毕复原锚行——后续用例两腿面复用；
    // 目标节点唯一化——D3t 槽条件写下同节点再写=他 id 409 档）
    await prisma2.nodeArtifact.deleteMany({ where: { projectId: SRC_PID, nodeId: 'n-d2t-src' } });
    (d2tPort.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { nodeId: 'n-d2t-src', mediaId: SRC_MEDIA, role: 'primary', targetField: 'mediaId', targetItemId: '' },
    ]);
    const out2 = await ctl.command(DST_PID, bindBody({ sourceNodeId: 'n-d2t-doc', targetNodeId: 'n-d2t-tgt-doc', commandId: `cmd-doc-${Math.random().toString(36).slice(2)}` }), reqOf(D2T_UID));
    expect(d2tPort.readNodeRefs).toHaveBeenCalledWith(SRC_PID, 'n-d2t-doc');   // ★读源项目（非目标项目）
    expect(out2.mediaId).not.toBe(SRC_MEDIA);
    (d2tPort.readNodeRefs as ReturnType<typeof vi.fn>).mockReset();
    await prisma2.nodeArtifact.create({
      data: { projectId: SRC_PID, nodeId: 'n-d2t-src', teamId: SRC_TID, role: 'primary', targetField: 'mediaId', targetItemId: '', rev: 1, source: 'replace', state: 'stored', mediaId: SRC_MEDIA },
    });
  });

  // ── 档③：源 size 空/零拒——不落 pending 行 ──
  it('源 size 零拒档：size=0 拒（空值不得当 0 字节过配额门——DB NOT NULL 无空行形态，实现按 !size fail-closed）+零 pending 行', async () => {
    await seedSourceMedia({ id: 'm-d2t-zero', size: 0n });
    const before = await prisma2.media.count({ where: { teamId: DST_TID, bindCommandId: { not: null } } });
    await expect(ctl.command(DST_PID, bindBody({ mediaId: 'm-d2t-zero' }), reqOf(D2T_UID))).rejects.toMatchObject({ status: 400 });
    expect(await prisma2.media.count({ where: { teamId: DST_TID, bindCommandId: { not: null } } })).toBe(before);
  });

  // ── 档④：幂等——命中 bindCommandId 不二次拷贝 ──
  it('幂等档：completed→返原 id 不拷贝；pending→沿用行上新键续走（不走第二次占坑事务）', async () => {
    // completed 档：正路行已占坑——提升为 completed 后同 commandId 重发返原 id（目标节点唯一化——D3t 槽写）
    const first = await ctl.command(DST_PID, bindBody({ commandId: 'cmd-idem-1', targetNodeId: 'n-d2t-idem1' }), reqOf(D2T_UID));
    await prisma2.media.update({ where: { id: first.mediaId }, data: { status: 'completed', pendingExpiresAt: null } });
    const again = await ctl.command(DST_PID, bindBody({ commandId: 'cmd-idem-1', targetNodeId: 'n-d2t-idem1' }), reqOf(D2T_UID));
    expect(again.mediaId).toBe(first.mediaId);   // 返回已有 id
    expect(await prisma2.media.count({ where: { teamId: DST_TID, bindCommandId: 'cmd-idem-1' } })).toBe(1);   // 不建新行
    // pending 档（D3t 崩溃续走形态）：行回拨 pending+预留回拨 ACTIVE+槽=本行 id——重发沿用行上
    // id 续走（零新行零新预留）→槽=本行 id 崩溃续走档→补绑定+完成（SETTLED）
    const p1 = await ctl.command(DST_PID, bindBody({ commandId: 'cmd-idem-2', targetNodeId: 'n-d2t-idem2' }), reqOf(D2T_UID));
    await prisma2.media.update({ where: { id: p1.mediaId }, data: { status: 'pending', pendingExpiresAt: new Date(Date.now() + 24 * 3600_000) } });
    await prisma2.storageReservation.updateMany({ where: { mediaId: p1.mediaId }, data: { state: 'ACTIVE' } });
    slotWritePort.setSlot('n-d2t-idem2', p1.mediaId);   // 槽=本行 id（上次崩溃在写槽后完成前）
    const p2 = await ctl.command(DST_PID, bindBody({ commandId: 'cmd-idem-2', targetNodeId: 'n-d2t-idem2' }), reqOf(D2T_UID));
    expect(p2.mediaId).toBe(p1.mediaId);   // 沿用行上新 id
    expect(await prisma2.media.count({ where: { teamId: DST_TID, bindCommandId: 'cmd-idem-2' } })).toBe(1);
    expect(await prisma2.storageReservation.count({ where: { teamId: DST_TID, state: 'ACTIVE', mediaId: p1.mediaId } })).toBe(0);   // 完成→SETTLED（ACTIVE 归零）
    expect((await prisma2.media.findUniqueOrThrow({ where: { id: p1.mediaId } })).status).toBe('completed');
    expect(await prisma2.storageReservation.count({ where: { teamId: DST_TID, state: 'SETTLED', mediaId: p1.mediaId } })).toBe(1);
  });

  // ── 档⑤：409 BIND_COMMAND_MISMATCH（换源/换项目——应用层比对三幂等列）──
  it('★409 BIND_COMMAND_MISMATCH：同 commandId 换源 media/换目标项目均 409——应用层比对（唯一约束多 NULL 挡不住）', async () => {
    // 换源比对锚：第二个有效源行（同团队——两腿/权限门全过、仅 bindSourceMediaId 不同）
    await seedSourceMedia({ id: 'm-d2t-alt' });
    await prisma2.nodeArtifact.create({
      data: { projectId: SRC_PID, nodeId: 'n-d2t-alt', teamId: SRC_TID, role: 'primary', targetField: 'mediaId', targetItemId: '', rev: 1, source: 'replace', state: 'stored', mediaId: 'm-d2t-alt' },
    });
    const first = await ctl.command(DST_PID, bindBody({ commandId: 'cmd-mm-1', sourceNodeId: 'n-d2t-src', targetNodeId: 'n-d2t-mm' }), reqOf(D2T_UID));
    // 换源 media（行上 bindSourceMediaId 不同）
    await expect(ctl.command(DST_PID, bindBody({ commandId: 'cmd-mm-1', sourceNodeId: 'n-d2t-alt', mediaId: 'm-d2t-alt' }), reqOf(D2T_UID)))
      .rejects.toMatchObject({ errorCode: 'BIND_COMMAND_MISMATCH', status: 409 });
    // 换目标项目（行上 bindTargetProjectId 不同——同队第二目标项目）
    const pid2 = 'd2t-dst-proj2';
    await prisma2.canvasProject.upsert({ where: { id: pid2 }, update: {}, create: { id: pid2, name: 'd2t-dst2', userId: D2T_UID, teamId: DST_TID } });
    await expect(ctl.command(pid2, bindBody({ commandId: 'cmd-mm-1' }), reqOf(D2T_UID)))
      .rejects.toMatchObject({ errorCode: 'BIND_COMMAND_MISMATCH', status: 409 });
    await prisma2.canvasProject.deleteMany({ where: { id: pid2 } });
    // mismatch 拒档不删已有行
    const row = await prisma2.media.findUniqueOrThrow({ where: { id: first.mediaId } });
    expect(row.status).toBe('completed');   // D3t 正路完成态（mismatch 拒档不删已有行）
  });

  // ── 档⑥：并发两笔超限只一笔过门（真 PG 行锁——media-registration.int 并发先例同款）──
  it('★并发超限恰一笔过门：Team FOR UPDATE 行锁串行化（assertCanUploadInTx）——败方 400 超限+零行零预留', async () => {
    // 基线复位：前序用例占坑的 ACTIVE 预留先 RELEASE（本用例 storageLimitBytes=一源即满——
    // 不复位则 reserved 已超限、双笔均拒恰一性失真）
    await prisma2.storageReservation.updateMany({ where: { teamId: DST_TID, state: 'ACTIVE' }, data: { state: 'RELEASED' } });
    // 前序用例已有 completed 行入 usage（幂等档提升行）——门限自校准：恰余一源之窗
    const usageAgg = await prisma2.media.aggregate({ _sum: { size: true }, where: { teamId: DST_TID, status: 'completed', deletedAt: null } });
    const resvAgg = await prisma2.storageReservation.aggregate({ _sum: { upperBoundBytes: true }, where: { teamId: DST_TID, state: 'ACTIVE' } });
    const baseline = Number(usageAgg._sum.size ?? 0) + Number(resvAgg._sum.upperBoundBytes ?? 0);
    const tightSub = { getLimits: vi.fn(async () => ({ seatLimit: 1, storageLimitBytes: baseline + Number(SRC_SIZE) })) } as any;
    const tightQuota = new StorageQuotaService(prisma2 as unknown as PrismaService, copyStub.minio as any, tightSub);
    const tightReg = new MediaRegistrationService(prisma2 as unknown as PrismaService, copyStub.minio as any, tightQuota as any);
    const realPerm = new ProjectPermissionService(prisma2 as unknown as PrismaService);
    const tightCtl = new CollabBindingController(realPerm, prisma2 as unknown as PrismaService, d2tPort, copyStub.minio as MinioService, tightQuota, tightReg, slotWritePort);
    const stamp = Date.now();
    const results = await Promise.allSettled([
      tightCtl.command(DST_PID, bindBody({ commandId: `cmd-race-a-${stamp}`, targetNodeId: 'n-d2t-race' }), reqOf(D2T_UID)),
      tightCtl.command(DST_PID, bindBody({ commandId: `cmd-race-b-${stamp}`, targetNodeId: 'n-d2t-race' }), reqOf(D2T_UID)),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);   // 恰一过门（真 PG 行锁串行化——双并发互见对方预留）
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as { status?: number }).status).toBe(400);   // 超限拒档（非 500）
  });

  // ── 档⑦：CopyObject 中途失败→已拷新键删除（404 容忍）+无 pending 残留+不写槽 ──
  it('★CopyObject 失败清理档：删本轮已拷新键（404 容忍）+deletePending（行+预留 RELEASED 同事务）+零槽写', async () => {
    const failStub = makeCopyStub({ failOn: 1 });   // 第一笔 CopyObject 即失败
    const failReg = new MediaRegistrationService(prisma2 as unknown as PrismaService, failStub.minio as any, quota as any);
    const realPerm = new ProjectPermissionService(prisma2 as unknown as PrismaService);
    const failCtl = new CollabBindingController(realPerm, prisma2 as unknown as PrismaService, d2tPort, failStub.minio as MinioService, quota, failReg, slotWritePort);
    const cmdId = `cmd-fail-${Date.now()}`;
    const activeBefore = await prisma2.storageReservation.count({ where: { teamId: DST_TID, state: 'ACTIVE' } });
    await expect(failCtl.command(DST_PID, bindBody({ commandId: cmdId }), reqOf(D2T_UID))).rejects.toThrow();
    // 无 pending 残留：行已删+预留随 deletePending RELEASED（ACTIVE 行数不增）
    expect(await prisma2.media.findFirst({ where: { teamId: DST_TID, bindCommandId: cmdId } })).toBeNull();
    expect(await prisma2.storageReservation.count({ where: { teamId: DST_TID, state: 'ACTIVE' } })).toBe(activeBefore);
    // 零槽写维持
    expect(await prisma2.nodeArtifact.findFirst({ where: { projectId: DST_PID, nodeId: 'n-d2t-tgt' } })).toBeNull();
  });

  // ── 档⑧：三把新键与源不同+两源键同对象共用同一把新键 ──
  it('★三键去重拷贝：key/thumbnailKey/objectKey 各自新键且与源不同；源键同对象（key=objectKey）共用同一把新键+不建 ObjectManifest 行', async () => {
    // 源行三键：key 独立+thumbnailKey 独立+objectKey=key（同对象——生成 stage 行形态）
    await prisma2.media.update({
      where: { id: SRC_MEDIA },
      data: { thumbnailKey: `d2t/thumb-${SRC_MEDIA}.png`, objectKey: `d2t/src-${SRC_MEDIA}.bin` },
    });
    const out = await ctl.command(DST_PID, bindBody({ commandId: `cmd-dedup-${Date.now()}`, targetNodeId: 'n-d2t-dedup' }), reqOf(D2T_UID));
    const pending = await prisma2.media.findUniqueOrThrow({ where: { id: out.mediaId } });
    expect(pending.key).not.toBe(`d2t/src-${SRC_MEDIA}.bin`);   // 新键≠源键
    expect(pending.thumbnailKey).not.toBe(`d2t/thumb-${SRC_MEDIA}.png`);
    expect(pending.thumbnailKey).not.toBe(pending.key);   // 两源键不同对象→两把新键
    // objectKey=key（同对象）→共用 pending.key 同一把新键
    expect(pending.objectKey).toBe(pending.key);
    // 桩录制：两源键不同对象=两笔 CopyObject（key+thumbnailKey——objectKey 同对象不再单拷）
    expect(copyStub.calls.filter((c) => c.destKey === pending.key)).toHaveLength(1);
    expect(copyStub.calls.filter((c) => c.destKey === pending.thumbnailKey)).toHaveLength(1);
    // 源行原样（拷贝非移动）
    const src = await prisma2.media.findUniqueOrThrow({ where: { id: SRC_MEDIA } });
    expect(src.thumbnailKey).toBe(`d2t/thumb-${SRC_MEDIA}.png`);
    expect(src.objectKey).toBe(`d2t/src-${SRC_MEDIA}.bin`);
  });
});

// ════════ Y2 D3t（spec v2.13 §3 D5 ④——槽条件写三档+同团队三档+完成独立函数+快照直调）════════
// 装置复用 D2t 双域 fixture（同 describe 外自建第二块——独立 prisma client 防 D2t afterAll 断连）。
// 槽写端口=COLLAB_SLOT_WRITE_PORT mock（Y.Doc 直投+setSlot 布景器——真 withSession 语义面在
// collab-document.service.spec/author-slot.service.spec；int 主断言面=controller 分档+真 PG 行）。
// 同团队档复用 DST_PID 侧新源行（teamId=DST_TID 与目标同队——「同团队不拷贝不建行返回原 id」）。
const D3T_UID = 'u-d3t-binder';
const D3T_SRC_TID = 'd3t-src-team';
const D3T_DST_TID = 'd3t-team';
const D3T_SRC_PID = 'd3t-src-proj';
const D3T_DST_PID = 'd3t-dst-proj';
/** 跨团队源行（teamId=源队≠目标队——跨团队档：占坑+拷贝+新行 id 判源）。 */
const D3T_CROSS_MEDIA = 'm-d3t-cross';
/** 同团队源行（teamId=目标队——同团队档：零拷贝零新行返回原 id，判源=源 media id）。 */
const D3T_SAME_MEDIA = 'm-d3t-same';
const D3T_SIZE = 2_500n;

/** 快照收集校验面：conditionalWrite 恒在真 Y.Doc 回调内 collectMediaRefsForNode（与写帧原子）。 */
const makeSlotPort = () => {
  const doc = new Y.Doc();
  const port: CollabSlotWritePort & { setSlot(nodeId: string, mediaId: string | null): void; readSlot(nodeId: string): string | null } = {
    setSlot(nodeId, mediaId) {
      const node = new Y.Map<unknown>();
      const data = new Y.Map<unknown>();
      if (mediaId != null) data.set('mediaId', mediaId);
      node.set('type', 'imageGen');
      node.set('data', data);
      (doc.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
    },
    readSlot(nodeId) {
      const entry = (doc.getMap('nodes') as Y.Map<unknown>).get(nodeId);
      const data = entry instanceof Y.Map ? entry.get('data') : undefined;
      const v = data instanceof Y.Map ? data.get('mediaId') : undefined;
      return typeof v === 'string' && v !== '' ? v : null;
    },
    async conditionalWrite(_pid: string, nodeId: string, slotId: string): Promise<SlotWriteOutcome> {
      const entry = (doc.getMap('nodes') as Y.Map<unknown>).get(nodeId);
      const data = entry instanceof Y.Map ? entry.get('data') : undefined;
      const current = data instanceof Y.Map ? data.get('mediaId') : undefined;
      const slotValue = typeof current === 'string' && current !== '' ? current : null;
      if (slotValue == null && data instanceof Y.Map) {
        data.set('mediaId', slotId);   // 槽空才写
        return { slot: 'empty', snapshot: collectMediaRefsForNode(nodeId, entry) };
      }
      if (slotValue == null) {
        // 节点/data 容器缺席（未播种目标节点）——真 conditionalWrite 的「空槽随写随建」同构
        const node = new Y.Map<unknown>();
        const d = new Y.Map<unknown>();
        d.set('mediaId', slotId);
        node.set('type', 'imageGen');
        node.set('data', d);
        (doc.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
        return { slot: 'empty', snapshot: collectMediaRefsForNode(nodeId, node) };
      }
      return {
        slot: slotValue === slotId ? 'mine' : 'foreign',
        snapshot: collectMediaRefsForNode(nodeId, entry),
      };
    },
  };
  return { port, doc };
};

maybe('Y2 D3t：槽条件写三档+同团队三档+完成事务+快照直调（真 PG）', () => {
  let prisma3: PrismaClient;
  let ctl: CollabBindingController;
  let slot: ReturnType<typeof makeSlotPort> | undefined;
  let copyStub: ReturnType<typeof makeCopyStub>;
  let quota: StorageQuotaService;
  const refsPort: MediaRefsReadPort = { readNodeRefs: vi.fn() };
  /** slot port 布景器（beforeAll 后可用——直投真 Y.Doc 形态）。 */
  const slotPort = () => slot!.port;
  const setSlot = (nodeId: string, mediaId: string | null) => slot!.port.setSlot(nodeId, mediaId);
  const readSlot = (nodeId: string) => slot!.port.readSlot(nodeId);
  const slotDocOf = () => slot!.doc;

  const body = (over: Record<string, unknown> = {}) => ({
    type: 'BindMedia', sourceProjectId: D3T_SRC_PID, sourceNodeId: 'n-d3t-src', mediaId: D3T_CROSS_MEDIA,
    targetNodeId: 'n-d3t-tgt', commandId: `cmd-${Math.random().toString(36).slice(2)}`, ...over,
  });
  const reqOf = (uid: string) => ({ user: { id: uid } }) as any;

  beforeAll(async () => {
    prisma3 = new PrismaClient();
    await prisma3.user.upsert({ where: { id: D3T_UID }, update: {}, create: { id: D3T_UID, name: 'd3t', email: 'd3t@local.test', emailVerified: true } });
    for (const tid of [D3T_SRC_TID, D3T_DST_TID]) {
      await prisma3.team.upsert({ where: { id: tid }, update: {}, create: { id: tid, name: `d3t-${tid}`, ownerId: D3T_UID } });
      await prisma3.teamMember.upsert({ where: { teamId_userId: { teamId: tid, userId: D3T_UID } }, update: {}, create: { teamId: tid, userId: D3T_UID, role: 'OWNER' } });
    }
    // 源项目归源队（跨团队域）；目标项目归目标队——源 NodeArtifact 锚行同域。
    await prisma3.canvasProject.upsert({ where: { id: D3T_SRC_PID }, update: {}, create: { id: D3T_SRC_PID, name: 'd3t-src', userId: D3T_UID, teamId: D3T_SRC_TID } });
    await prisma3.canvasProject.upsert({ where: { id: D3T_DST_PID }, update: {}, create: { id: D3T_DST_PID, name: 'd3t-dst', userId: D3T_UID, teamId: D3T_DST_TID } });
    // 跨团队源行（源队）+同团队源行（目标队——两套判源锚分行承载）
    await prisma3.media.upsert({
      where: { id: D3T_CROSS_MEDIA },
      update: { teamId: D3T_SRC_TID, deletedAt: null, deletionState: 'ACTIVE' },
      create: { id: D3T_CROSS_MEDIA, userId: D3T_UID, teamId: D3T_SRC_TID, bucket: 'flowai', key: `d3t/src-${D3T_CROSS_MEDIA}.bin`, originalName: 'src.bin', mimeType: 'image/png', size: D3T_SIZE, type: 'uploaded', status: 'completed', sniffedMimeType: 'image/png' },
    });
    await prisma3.media.upsert({
      where: { id: D3T_SAME_MEDIA },
      update: { teamId: D3T_DST_TID, deletedAt: null, deletionState: 'ACTIVE' },
      create: { id: D3T_SAME_MEDIA, userId: D3T_UID, teamId: D3T_DST_TID, bucket: 'flowai', key: `d3t/same-${D3T_SAME_MEDIA}.bin`, originalName: 'same.bin', mimeType: 'image/png', size: D3T_SIZE, type: 'uploaded', status: 'completed' },
    });
    // 源 NodeArtifact 锚行（源项目域——pairArtifact 腿命中形态；两源行各一锚）
    await prisma3.nodeArtifact.create({
      data: { projectId: D3T_SRC_PID, nodeId: 'n-d3t-src', teamId: D3T_SRC_TID, role: 'primary', targetField: 'mediaId', targetItemId: '', rev: 1, source: 'replace', state: 'stored', mediaId: D3T_CROSS_MEDIA },
    });
    await prisma3.nodeArtifact.create({
      data: { projectId: D3T_SRC_PID, nodeId: 'n-d3t-same-src', teamId: D3T_DST_TID, role: 'primary', targetField: 'mediaId', targetItemId: '', rev: 1, source: 'replace', state: 'stored', mediaId: D3T_SAME_MEDIA },
    });

    slot = makeSlotPort();
    copyStub = makeCopyStub();
    const fakeSub = { getLimits: vi.fn(async () => ({ seatLimit: 1, storageLimitBytes: 6 * 1024 * 1024 * 1024 })) } as any;
    quota = new StorageQuotaService(prisma3 as unknown as PrismaService, copyStub.minio as any, fakeSub);
    const registration = new MediaRegistrationService(prisma3 as unknown as PrismaService, copyStub.minio as any, quota as any);
    const realPerm = new ProjectPermissionService(prisma3 as unknown as PrismaService);
    ctl = new CollabBindingController(
      realPerm, prisma3 as unknown as PrismaService, refsPort,
      copyStub.minio as MinioService, quota, registration, slot.port,
    );
  }, 60_000);

  afterAll(async () => {
    await prisma3.storageReservation.deleteMany({ where: { teamId: { in: [D3T_SRC_TID, D3T_DST_TID] } } }).catch(() => undefined);
    await prisma3.media.deleteMany({ where: { teamId: { in: [D3T_SRC_TID, D3T_DST_TID] } } }).catch(() => undefined);
    await prisma3.nodeArtifact.deleteMany({ where: { projectId: { in: [D3T_SRC_PID, D3T_DST_PID] } } }).catch(() => undefined);
    await prisma3.mediaBinding.deleteMany({ where: { projectId: { in: [D3T_SRC_PID, D3T_DST_PID] } } }).catch(() => undefined);
    await prisma3.canvasProject.deleteMany({ where: { id: { in: [D3T_SRC_PID, D3T_DST_PID] } } }).catch(() => undefined);
    await prisma3.teamMember.deleteMany({ where: { teamId: { in: [D3T_SRC_TID, D3T_DST_TID] } } }).catch(() => undefined);
    await prisma3.team.deleteMany({ where: { id: { in: [D3T_SRC_TID, D3T_DST_TID] } } }).catch(() => undefined);
    await prisma3.user.deleteMany({ where: { id: D3T_UID } }).catch(() => undefined);
    await prisma3.$disconnect().catch(() => undefined);
  }, 30_000);

  // ── 档①：槽三档×同团队/跨团队——判源两套比较对象（同团队判源=源 media id/跨团队判源=新行 id）──
  it('★跨团队槽空→写新行 id+快照直调 projectBindings+完成四件事（completed+SETTLED+factVersion+1+state fact）+同节点其余槽绑定仍在', async () => {
    setSlot('n-d3t-tgt', null);
    setSlot('n-d3t-other', 'm-d3t-other-keep');   // 同项目他节点他槽——差分不误删面
    const out = await ctl.command(D3T_DST_PID, body(), reqOf(D3T_UID));
    expect(out.type).toBe('BindMedia');
    expect(out.mediaId).not.toBe(D3T_CROSS_MEDIA);
    expect(readSlot('n-d3t-tgt')).toBe(out.mediaId);   // 槽=新行 id（跨团队判源=新行 id）
    // 完成四件事（独立小函数——同 tx）：completed CAS+pendingExpiresAt 清+预留 SETTLED+factVersion+1+state fact
    const row = await prisma3.media.findUniqueOrThrow({ where: { id: out.mediaId } });
    expect(row.status).toBe('completed');
    expect(row.probeState).toBe('pending');   // 不覆写——探针重算（禁整段 confirmInTx 的根因锚）
    expect(row.sniffedMimeType).toBe('image/png');   // 粘贴留复制值（不覆写）
    expect(row.size).toBe(D3T_SIZE);
    expect(row.pendingExpiresAt).toBeNull();   // 离开 pending 态——TTL 不再命中
    expect(row.factVersion).toBe(1n);
    const fact = await prisma3.mediaFact.findUnique({ where: { mediaId_factType: { mediaId: out.mediaId, factType: 'state' } } });
    expect(fact?.payload).toMatchObject({ status: 'completed' });
    const resv = await prisma3.storageReservation.findUniqueOrThrow({ where: { mediaId: out.mediaId } });
    expect(resv.state).toBe('SETTLED');
    // 快照直调：目标节点 primary/mediaId 绑定经投影出现（单格 delta——同节点其余槽本档无；他节点不动面见下档）
    const binding = await prisma3.mediaBinding.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: D3T_DST_PID, nodeId: 'n-d3t-tgt', role: 'primary', targetField: 'mediaId', targetItemId: '' } },
    });
    expect(binding?.mediaId).toBe(out.mediaId);
    expect(await prisma3.nodeArtifact.findFirst({ where: { projectId: D3T_DST_PID, nodeId: 'n-d3t-tgt' } })).toBeNull();   // 全程零 NodeArtifact
  });

  it('★直调 projectBindings 差分面：同节点其余槽（referenceImage 等）绑定仍在——回调内快照全量承载', async () => {
    // 布景：目标节点已有 referenceImage 槽（他媒体）+旧 primary 绑定行（他 media）
    setSlot('n-d3t-tgt2', 'm-d3t-foreign-old');
    const data = new Y.Map<unknown>();
    data.set('mediaId', 'm-d3t-foreign-old');
    data.set('referenceImage', 'm-d3t-ref-keep');
    const node = new Y.Map<unknown>();
    node.set('type', 'imageGen');
    node.set('data', data);
    (slotDocOf().getMap('nodes') as Y.Map<unknown>).set('n-d3t-tgt2', node);
    await prisma3.media.upsert({ where: { id: 'm-d3t-ref-keep' }, update: { deletedAt: null, deletionState: 'ACTIVE' }, create: { id: 'm-d3t-ref-keep', userId: D3T_UID, teamId: D3T_DST_TID, bucket: 'flowai', key: 'd3t/ref-keep.bin', originalName: 'ref.bin', mimeType: 'image/png', size: 10n, type: 'uploaded', status: 'completed' } });
    // 旧 primary 绑定行（布景——diff 换 mediaId 的对方面）
    await prisma3.mediaBinding.create({ data: { id: 'mb-d3t-old', projectId: D3T_DST_PID, teamId: D3T_DST_TID, nodeId: 'n-d3t-tgt2', role: 'primary', targetField: 'mediaId', targetItemId: '', mediaId: 'm-d3t-foreign-old' } });
    // 槽=他 id → 409 档先钉差分安全（不误删同节点其余槽——本用例先证 foreign 档不投影不改槽）
    await expect(ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-tgt2', commandId: 'cmd-d3t-fk' }), reqOf(D3T_UID)))
      .rejects.toMatchObject({ errorCode: 'SLOT_OCCUPIED', status: 409 });
    // 同节点其余槽绑定（布景行）——409 档零投影动作不误删
    const refBinding = await prisma3.mediaBinding.findFirst({ where: { projectId: D3T_DST_PID, nodeId: 'n-d3t-tgt2', targetField: 'referenceImage' } });
    expect(refBinding).toBeNull();   // 布景未投影 referenceImage（零动作面维持——409 档禁投影）
    // 清槽重发：槽空→条件写+快照（全量=mediaId+referenceImage 两槽）→直调投影——referenceImage 绑定出现
    setSlot('n-d3t-tgt2', null);
    // 重挂 referenceImage 槽（setSlot 重建 data 域——保留 referenceImage）
    const d2 = new Y.Map<unknown>();
    d2.set('referenceImage', 'm-d3t-ref-keep');
    const n2 = new Y.Map<unknown>();
    n2.set('type', 'imageGen');
    n2.set('data', d2);
    (slotDocOf().getMap('nodes') as Y.Map<unknown>).set('n-d3t-tgt2', n2);
    const out = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-tgt2', commandId: 'cmd-d3t-fk2' }), reqOf(D3T_UID));
    expect(readSlot('n-d3t-tgt2')).toBe(out.mediaId);
    const primary = await prisma3.mediaBinding.findUnique({ where: { projectId_nodeId_role_targetField_targetItemId: { projectId: D3T_DST_PID, nodeId: 'n-d3t-tgt2', role: 'primary', targetField: 'mediaId', targetItemId: '' } } });
    expect(primary?.mediaId).toBe(out.mediaId);   // 旧值条件替换（ON CONFLICT 差分换值）
    const refAfter = await prisma3.mediaBinding.findUnique({ where: { projectId_nodeId_role_targetField_targetItemId: { projectId: D3T_DST_PID, nodeId: 'n-d3t-tgt2', role: 'primary', targetField: 'referenceImage', targetItemId: '' } } });
    expect(refAfter?.mediaId).toBe('m-d3t-ref-keep');   // ★同节点其余槽绑定仍在（快照全量承载——单格误删防线）
  });

  it('★跨团队槽=本行 id（并发同 commandId 第二次）——不删第一次的对象只补绑定+完成（命令重试/在途命中形态）', async () => {
    const cmdId = 'cmd-d3t-mine';
    setSlot('n-d3t-mine', null);
    const first = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-mine', commandId: cmdId }), reqOf(D3T_UID));
    const firstRow = await prisma3.media.findUniqueOrThrow({ where: { id: first.mediaId } });
    expect(firstRow.status).toBe('completed');
    const copiesAfterFirst = copyStub.calls.length;
    // 第二次同 commandId：幂等查命中 completed→返回原 id（不再拷贝不再占坑）
    const second = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-mine', commandId: cmdId }), reqOf(D3T_UID));
    expect(second.mediaId).toBe(first.mediaId);
    expect(copyStub.calls.length).toBe(copiesAfterFirst);   // 不二次拷贝
    // 并发窗形态（槽=本行 id+行仍 pending——上次崩溃在写槽后完成前）：预置 pending 行+槽=本行 id
    const cmdId2 = 'cmd-d3t-mine2';
    const pre = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-mine2', commandId: cmdId2 }), reqOf(D3T_UID));
    await prisma3.media.update({ where: { id: pre.mediaId }, data: { status: 'pending', pendingExpiresAt: new Date(Date.now() + 24 * 3600_000) } });
    await prisma3.storageReservation.updateMany({ where: { mediaId: pre.mediaId }, data: { state: 'ACTIVE' } });
    setSlot('n-d3t-mine2', pre.mediaId);   // ★槽=本行 id（上次崩溃续走形态）
    const retry = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-mine2', commandId: cmdId2 }), reqOf(D3T_UID));
    expect(retry.mediaId).toBe(pre.mediaId);   // 幂等查 pending→沿用行上 id
    // 不删对象（源行零 delete 调用——桩录制面：无 delete 键）+按全量快照补绑定+完成
    const rowAfter = await prisma3.media.findUniqueOrThrow({ where: { id: pre.mediaId } });
    expect(rowAfter.status).toBe('completed');
    expect(rowAfter.deletedAt).toBeNull();
    const srcRow = await prisma3.media.findUniqueOrThrow({ where: { id: D3T_CROSS_MEDIA } });
    expect(srcRow.deletedAt).toBeNull();   // 源行不动
    const resv = await prisma3.storageReservation.findUniqueOrThrow({ where: { mediaId: pre.mediaId } });
    expect(resv.state).toBe('SETTLED');
  });

  it('★完成 CAS 0 行两分诊：已 completed→返原 id 不删对象；仍 pending→只重试完成不进失败清理', async () => {
    // 分诊 A：行已 completed（并发完成先到）——重试返回原 id 不删对象
    const cmdId = 'cmd-d3t-cas';
    setSlot('n-d3t-cas', null);
    const first = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-cas', commandId: cmdId }), reqOf(D3T_UID));
    // 行已 completed（正路完成）——同 commandId 重发=幂等查 completed 档返原 id（零 CAS 面）
    const again = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-cas', commandId: cmdId }), reqOf(D3T_UID));
    expect(again.mediaId).toBe(first.mediaId);
    const row = await prisma3.media.findUniqueOrThrow({ where: { id: first.mediaId } });
    expect(row.status).toBe('completed');
    expect(row.deletedAt).toBeNull();
    // 分诊 B：仍 pending（完成事务 0 行后重读仍 pending——模拟=直接驱动完成重试档）：
    // 预置 pending 行+槽=本行 id，完成事务已由重试驱动完成（不进失败清理=行/预留/对象全保留）
    const cmdId2 = 'cmd-d3t-cas2';
    setSlot('n-d3t-cas2', null);
    const pre = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-cas2', commandId: cmdId2 }), reqOf(D3T_UID));
    // 回拨 pending（模拟完成前崩溃——行 pending+槽=本行 id+预留 ACTIVE）
    await prisma3.media.update({ where: { id: pre.mediaId }, data: { status: 'pending', pendingExpiresAt: new Date(Date.now() + 24 * 3600_000) } });
    await prisma3.storageReservation.updateMany({ where: { mediaId: pre.mediaId }, data: { state: 'ACTIVE' } });
    setSlot('n-d3t-cas2', pre.mediaId);
    const retry = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-cas2', commandId: cmdId2 }), reqOf(D3T_UID));
    expect(retry.mediaId).toBe(pre.mediaId);
    const row2 = await prisma3.media.findUniqueOrThrow({ where: { id: pre.mediaId } });
    expect(row2.status).toBe('completed');   // 只重试完成——不进失败清理（行不删）
    const resv = await prisma3.storageReservation.findUniqueOrThrow({ where: { mediaId: pre.mediaId } });
    expect(resv.state).toBe('SETTLED');
    expect(row2.deletedAt).toBeNull();
  });

  it('★跨团队槽=他 id→删已拷新键+deletePending（预留 RELEASED）+doc 保持对方值+409 SLOT_OCCUPIED', async () => {
    setSlot('n-d3t-foreign', 'm-d3t-other-member');   // 他成员已写
    const activeBefore = await prisma3.storageReservation.count({ where: { teamId: D3T_DST_TID, state: 'ACTIVE' } });
    const mediaBefore = await prisma3.media.count({ where: { teamId: D3T_DST_TID, bindCommandId: { not: null } } });
    await expect(ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-foreign', commandId: 'cmd-d3t-foreign' }), reqOf(D3T_UID)))
      .rejects.toMatchObject({ errorCode: 'SLOT_OCCUPIED', status: 409 });
    // doc 保持对方值（槽不被覆盖——条件写零写面）
    expect(readSlot('n-d3t-foreign')).toBe('m-d3t-other-member');
    // 删已拷新键（桩 delete 404 容忍面由 controller 走 minio.delete）+deletePending（行删+预留 RELEASED）
    expect(await prisma3.media.count({ where: { teamId: D3T_DST_TID, bindCommandId: { not: null } } })).toBe(mediaBefore);   // 零行残留
    expect(await prisma3.storageReservation.count({ where: { teamId: D3T_DST_TID, state: 'ACTIVE' } })).toBe(activeBefore);   // 预留不挂账
    expect(copyStub.calls.length).toBeGreaterThan(0);   // 已拷新键在（本轮拷贝发生——随后被删键清理）
  });

  it('★同团队三档：槽空→写原 id（零拷贝零新行）；槽=源 id→只补全量绑定快照+完成；槽=他 id→409 零对象删除', async () => {
    // 同团队档：源行 teamId=目标队 D3T_DST_TID（D3T_SAME_MEDIA——源项目行挂在 SRC_PID 但行属目标队，
    // 「两个项目共用一行」形态）——判源=源 media id（非新行 id：★两套比较对象勿混）
    const sameBody = (over: Record<string, unknown> = {}) => body({
      sourceNodeId: 'n-d3t-same-src', mediaId: D3T_SAME_MEDIA, ...over,
    });
    const beforeMedia = await prisma3.media.count({ where: { teamId: D3T_DST_TID } });
    const copiesBefore = copyStub.calls.length;
    // 档 a：槽空→写原 id（同团队无新行无拷贝——回执=源 id）
    setSlot('n-d3t-same', null);
    const outA = await ctl.command(D3T_DST_PID, sameBody({ targetNodeId: 'n-d3t-same', commandId: 'cmd-d3t-same-a' }), reqOf(D3T_UID));
    expect(outA.mediaId).toBe(D3T_SAME_MEDIA);   // ★返回原 id（判源=源 media id——非新行）
    expect(readSlot('n-d3t-same')).toBe(D3T_SAME_MEDIA);
    expect(await prisma3.media.count({ where: { teamId: D3T_DST_TID } })).toBe(beforeMedia);   // 零新行
    expect(copyStub.calls.length).toBe(copiesBefore);   // 零拷贝
    const sameBinding = await prisma3.mediaBinding.findUnique({ where: { projectId_nodeId_role_targetField_targetItemId: { projectId: D3T_DST_PID, nodeId: 'n-d3t-same', role: 'primary', targetField: 'mediaId', targetItemId: '' } } });
    expect(sameBinding?.mediaId).toBe(D3T_SAME_MEDIA);   // 绑定经投影出现（原 id）
    // 档 b：槽=源 id（上次崩溃在写槽后）→不删对象、按全量快照补绑定、再完成（幂等重发返原 id）
    const outB = await ctl.command(D3T_DST_PID, sameBody({ targetNodeId: 'n-d3t-same', commandId: 'cmd-d3t-same-a' }), reqOf(D3T_UID));
    expect(outB.mediaId).toBe(D3T_SAME_MEDIA);
    expect(await prisma3.mediaBinding.findUnique({ where: { projectId_nodeId_role_targetField_targetItemId: { projectId: D3T_DST_PID, nodeId: 'n-d3t-same', role: 'primary', targetField: 'mediaId', targetItemId: '' } } })).toMatchObject({ mediaId: D3T_SAME_MEDIA });
    // 档 c：槽=他 id→409 SLOT_OCCUPIED 不删任何对象（同团队无新行无新键——纯 409）
    setSlot('n-d3t-same2', 'm-d3t-other-member');
    const activeBefore = await prisma3.storageReservation.count({ where: { teamId: D3T_DST_TID, state: 'ACTIVE' } });
    await expect(ctl.command(D3T_DST_PID, sameBody({ targetNodeId: 'n-d3t-same2', commandId: 'cmd-d3t-same-c' }), reqOf(D3T_UID)))
      .rejects.toMatchObject({ errorCode: 'SLOT_OCCUPIED', status: 409 });
    expect(readSlot('n-d3t-same2')).toBe('m-d3t-other-member');   // doc 保持对方值
    expect(await prisma3.media.count({ where: { teamId: D3T_DST_TID } })).toBe(beforeMedia);   // 零行零删
    expect(copyStub.calls.length).toBe(copiesBefore);   // 零拷贝
    expect(await prisma3.storageReservation.count({ where: { teamId: D3T_DST_TID, state: 'ACTIVE' } })).toBe(activeBefore);   // 零预留挂账
  });

  it('★槽写成后崩溃窗（projectBindings 后完成前）——可构造形态：行仍 pending+槽=本行 id+绑定已投影+预留 ACTIVE', async () => {
    // 崩溃窗形态断言（本 commit 不驱动 D4t 装入重扫——只证窗口三态可构造+重试链收敛）：
    // 预置=正路完成行回拨 pending（等价于「projectBindings 已跑、完成事务未提交」中间态）。
    const cmdId = 'cmd-d3t-crash';
    setSlot('n-d3t-crash', null);
    const out = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-crash', commandId: cmdId }), reqOf(D3T_UID));
    // 回拨：行 pending+预留 ACTIVE（完成事务未提交形态）——槽/绑定保持已写已投影态
    await prisma3.media.update({ where: { id: out.mediaId }, data: { status: 'pending', pendingExpiresAt: new Date(Date.now() + 24 * 3600_000) } });
    await prisma3.storageReservation.updateMany({ where: { mediaId: out.mediaId }, data: { state: 'ACTIVE' } });
    // 窗口三态断言（构造面）：doc 槽=本行 id（resolve 非空——本 commit 窗口侧证；D4t 清扫后=missing 行 resolve 空）
    expect(readSlot('n-d3t-crash')).toBe(out.mediaId);
    const binding = await prisma3.mediaBinding.findUnique({ where: { projectId_nodeId_role_targetField_targetItemId: { projectId: D3T_DST_PID, nodeId: 'n-d3t-crash', role: 'primary', targetField: 'mediaId', targetItemId: '' } } });
    expect(binding?.mediaId).toBe(out.mediaId);   // 绑定已投影（projectBindings 后）
    const row = await prisma3.media.findUniqueOrThrow({ where: { id: out.mediaId } });
    expect(row.status).toBe('pending');   // 完成未提交（完成前）
    // 同 commandId 重试→崩溃续走档收敛：槽=本行 id→不删对象补绑定+完成（幂等闭环）
    const retry = await ctl.command(D3T_DST_PID, body({ targetNodeId: 'n-d3t-crash', commandId: cmdId }), reqOf(D3T_UID));
    expect(retry.mediaId).toBe(out.mediaId);
    const rowAfter = await prisma3.media.findUniqueOrThrow({ where: { id: out.mediaId } });
    expect(rowAfter.status).toBe('completed');
    const resv = await prisma3.storageReservation.findUniqueOrThrow({ where: { mediaId: out.mediaId } });
    expect(resv.state).toBe('SETTLED');
  });
});
