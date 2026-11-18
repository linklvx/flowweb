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
// （桩注入——int 池无 S3；bucket=源行列）/失败清理档。**本 commit 槽写未就位**——CopyObject 成功后
// 不写槽（D3t 落地）；pending 行由 TTL 清扫兜底。
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
    const moduleRef = await Test.createTestingModule({
      controllers: [CollabBindingController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectPermissionService, useValue: perm },
        { provide: NodeArtifactService, useValue: nodeArtifacts },
        { provide: MEDIA_REFS_READ_PORT, useValue: port },
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
  // Y2 D2t：受理层落地后正路=占坑+拷贝（同团队源 m-c3a7-own 归 m-c3a7-x 档后的同队正路——
  // 本族钉「零槽写/零 binding 写」不变量：命令面 MediaBinding/NodeArtifact/Projection 三零写。
  it('BindMedia（pairArtifact 腿）：★零 NodeArtifact/Projection/binding 写（受理层占坑+拷贝——命令面三零写不变量维持）', async () => {
    const before = await prisma.mediaBinding.count({ where: { projectId: PID } });
    const out = await controller.command(PID, { type: 'BindMedia', sourceProjectId: PID, sourceNodeId: 'n-src', mediaId: 'm-c3a7-own', targetNodeId: 'n-tgt', commandId: `cmd-c3a7-pa-${Date.now()}` }, req());
    expect(out.type).toBe('BindMedia');
    expect(out.mediaId).not.toBe('m-c3a7-own');   // 新行 id（占坑先行——D2t）
    expect(await prisma.nodeArtifact.findFirst({ where: { projectId: PID, nodeId: 'n-tgt' } })).toBeNull();   // CAS 段已删禁加回
    expect(await prisma.artifactProjection.findFirst({ where: { projectId: PID, nodeId: 'n-tgt' } })).toBeNull();
    const after = await prisma.mediaBinding.count({ where: { projectId: PID } });
    expect(after).toBe(before);
    expect(await prisma.mediaBinding.findFirst({ where: { projectId: PID, nodeId: 'n-tgt' } })).toBeNull();
  });

  it('BindMedia（doc 兜底腿）：pairArtifact 缺→端口 refs 命中→放行（源项目域读）+零 binding 直写', async () => {
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID, nodeId: 'n-doc' } });
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { nodeId: 'n-doc', mediaId: 'm-c3a7-own', role: 'primary', targetField: 'mediaId', targetItemId: '' },
    ]);
    const before = await prisma.mediaBinding.count({ where: { projectId: PID } });
    const out = await controller.command(PID, { type: 'BindMedia', sourceProjectId: PID, sourceNodeId: 'n-doc', mediaId: 'm-c3a7-own', targetNodeId: 'n-tgt2', commandId: `cmd-c3a7-doc-${Date.now()}` }, req());
    expect(out.type).toBe('BindMedia');
    expect(out.mediaId).not.toBe('m-c3a7-own');
    expect(port.readNodeRefs).toHaveBeenCalledWith(PID, 'n-doc');
    expect(await prisma.nodeArtifact.findFirst({ where: { projectId: PID, nodeId: 'n-tgt2' } })).toBeNull();
    expect(await prisma.mediaBinding.count({ where: { projectId: PID } })).toBe(before);
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
      copyStub.minio as MinioService, quota, registration,
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
  it('正路：跨团队粘贴→pending 行（新键/三幂等列/bucket=源行/不复制关联列）+预留 ACTIVE+回执新 id；源行源键不动', async () => {
    const out = await ctl.command(DST_PID, bindBody(), reqOf(D2T_UID));
    expect(out.type).toBe('BindMedia');
    expect(out.mediaId).not.toBe(SRC_MEDIA);   // 新行 id
    expect(out.mediaId).toBeTruthy();
    const pending = await prisma2.media.findUniqueOrThrow({ where: { id: out.mediaId } });
    expect(pending.status).toBe('pending');
    expect(pending.teamId).toBe(DST_TID);   // teamId=目标团队
    expect(pending.bucket).toBe('flowai');   // bucket=源行 bucket 列
    expect(pending.size).toBe(SRC_SIZE);   // BigInt 列保持
    expect(pending.key).not.toBe((await prisma2.media.findUniqueOrThrow({ where: { id: SRC_MEDIA } })).key);   // 新键≠源键
    expect(pending.bindCommandId).toBeTypeOf('string');
    expect(pending.bindSourceMediaId).toBe(SRC_MEDIA);
    expect(pending.bindTargetProjectId).toBe(DST_PID);
    expect(pending.pendingExpiresAt).not.toBeNull();   // TTL 兜底锚（24h 窗）
    expect(pending.probeState).toBe('pending');
    // 不复制关联列
    expect(pending.projectId).toBeNull();
    expect(pending.nodeId).toBeNull();
    expect(pending.taskId).toBeNull();
    expect(pending.clientUploadId).toBeNull();
    expect(pending.sourceRegistrationKey).toBeNull();
    // 占坑同事务：StorageReservation(ACTIVE, upperBoundBytes=源.size)
    const resv = await prisma2.storageReservation.findUnique({ where: { mediaId: out.mediaId } });
    expect(resv?.state).toBe('ACTIVE');
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
    // 本 commit 槽写未就位：不写槽（零 NodeArtifact/Projection——B4 后命令面零写维持）
    expect(await prisma2.nodeArtifact.findFirst({ where: { projectId: DST_PID, nodeId: 'n-d2t-tgt' } })).toBeNull();
    expect(await prisma2.mediaBinding.findFirst({ where: { projectId: DST_PID, nodeId: 'n-d2t-tgt' } })).toBeNull();
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
    const out = await ctl.command(DST_PID, bindBody(), reqOf(D2T_UID));
    expect(out.mediaId).not.toBe(SRC_MEDIA);
    // doc 兜底腿：删 NodeArtifact 锚行→端口读源项目 doc refs 命中 mediaId（读毕复原锚行——后续用例两腿面复用）
    await prisma2.nodeArtifact.deleteMany({ where: { projectId: SRC_PID, nodeId: 'n-d2t-src' } });
    (d2tPort.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { nodeId: 'n-d2t-src', mediaId: SRC_MEDIA, role: 'primary', targetField: 'mediaId', targetItemId: '' },
    ]);
    const out2 = await ctl.command(DST_PID, bindBody({ sourceNodeId: 'n-d2t-doc', commandId: `cmd-doc-${Math.random().toString(36).slice(2)}` }), reqOf(D2T_UID));
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
    // completed 档：正路行已占坑——提升为 completed 后同 commandId 重发返原 id
    const first = await ctl.command(DST_PID, bindBody({ commandId: 'cmd-idem-1' }), reqOf(D2T_UID));
    await prisma2.media.update({ where: { id: first.mediaId }, data: { status: 'completed', pendingExpiresAt: null } });
    const again = await ctl.command(DST_PID, bindBody({ commandId: 'cmd-idem-1' }), reqOf(D2T_UID));
    expect(again.mediaId).toBe(first.mediaId);   // 返回已有 id
    expect(await prisma2.media.count({ where: { teamId: DST_TID, bindCommandId: 'cmd-idem-1' } })).toBe(1);   // 不建新行
    // pending 档：pending 行直接重发——沿用行上新键（零新行零新预留）
    const p1 = await ctl.command(DST_PID, bindBody({ commandId: 'cmd-idem-2' }), reqOf(D2T_UID));
    const p2 = await ctl.command(DST_PID, bindBody({ commandId: 'cmd-idem-2' }), reqOf(D2T_UID));
    expect(p2.mediaId).toBe(p1.mediaId);   // 沿用行上新 id
    expect(await prisma2.media.count({ where: { teamId: DST_TID, bindCommandId: 'cmd-idem-2' } })).toBe(1);
    expect(await prisma2.storageReservation.count({ where: { teamId: DST_TID, state: 'ACTIVE', mediaId: p1.mediaId } })).toBe(1);
  });

  // ── 档⑤：409 BIND_COMMAND_MISMATCH（换源/换项目——应用层比对三幂等列）──
  it('★409 BIND_COMMAND_MISMATCH：同 commandId 换源 media/换目标项目均 409——应用层比对（唯一约束多 NULL 挡不住）', async () => {
    // 换源比对锚：第二个有效源行（同团队——两腿/权限门全过、仅 bindSourceMediaId 不同）
    await seedSourceMedia({ id: 'm-d2t-alt' });
    await prisma2.nodeArtifact.create({
      data: { projectId: SRC_PID, nodeId: 'n-d2t-alt', teamId: SRC_TID, role: 'primary', targetField: 'mediaId', targetItemId: '', rev: 1, source: 'replace', state: 'stored', mediaId: 'm-d2t-alt' },
    });
    const first = await ctl.command(DST_PID, bindBody({ commandId: 'cmd-mm-1', sourceNodeId: 'n-d2t-src' }), reqOf(D2T_UID));
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
    expect(row.status).toBe('pending');
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
    const tightCtl = new CollabBindingController(realPerm, prisma2 as unknown as PrismaService, d2tPort, copyStub.minio as MinioService, tightQuota, tightReg);
    const stamp = Date.now();
    const results = await Promise.allSettled([
      tightCtl.command(DST_PID, bindBody({ commandId: `cmd-race-a-${stamp}` }), reqOf(D2T_UID)),
      tightCtl.command(DST_PID, bindBody({ commandId: `cmd-race-b-${stamp}` }), reqOf(D2T_UID)),
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
    const failCtl = new CollabBindingController(realPerm, prisma2 as unknown as PrismaService, d2tPort, failStub.minio as MinioService, quota, failReg);
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
    const out = await ctl.command(DST_PID, bindBody({ commandId: `cmd-dedup-${Date.now()}` }), reqOf(D2T_UID));
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
