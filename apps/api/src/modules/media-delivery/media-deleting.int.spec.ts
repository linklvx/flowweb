// apps/api/src/modules/media-delivery/media-deleting.int.spec.ts
// C3b-4（plan v3 Task C3b-4——spec 2026-11-11-foundation-batch-design.md §3.4-5 :81/§3.4-7 :83/§3.4-10 :86）：
// **DELETING 状态机+删除序**红绿（真 PG）。五红锚（卡文 Step 1 ①-⑤）：
//  ①CAS 抢占：`UPDATE..WHERE deletionState='ACTIVE' RETURNING` 双 worker 并发恰一者得每行
//    （一者零行）+同 run 幂等再持有+陈旧行（MEDIA_DELETING_STALE_MS 外）可接管（对象失败下轮重试的
//    接管面）；
//  ②recheck 命中→中止回 ACTIVE+conflict 计数（media_deletion_conflict_total{reason}）+审计列留痕
//    （deletionRequestedAt/RunId/Reason——回退保留=最近一次尝试的审计面）：②a 旧引用图命中档；
//    ②b **删除事务内 isMediaReferenced recheck 档**（C3b-3 直供 tx——LightingTask.resultMediaId 是
//    旧 GC 引用图盲区〔旧面四源：binding/NodeArtifact/VideoWork/VideoProject+doc 扫描——无 Lighting〕，
//    改前红=行被删=误删实锚）；
//  ③删除序=对象先删（404 容忍）→行删（第六轮 P0-7：行先删则对象失败无重试锚）：③a 违序探针
//    （对象删时行仍在——行先删即红）；③b NoSuchKey 容忍；③c 对象失败→行保留 DELETING+审计落值，
//    陈旧化后下轮重试成功；
//  ④用户恢复（deletedAt=null）→回 ACTIVE——restoreMediaToActive 原语+下轮 GC 不再候选；
//  ⑤facts 端点过滤 DELETING（erasure 路径形态——deletedAt=null 的 DELETING 行）+content 读面
//    仍可读（findReadable——软删才 404，spec :81「DELETING 期 content 仍可读」）。
// 命令面拒新绑定（BindMedia/replace 的 deletionState='ACTIVE' 门）锚在 collab-binding.controller.spec
// （unit where 形状）+collab-media.int.spec（replace 404 实链）；erasure 接线锚在
// project-erasure.purge.c4c1.int.spec（标记时 CAS+复核漂移回退+删除窗所有权）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import {
  MediaGcService, claimMediaForDeletion, restoreMediaToActive, MEDIA_DELETING_STALE_MS,
} from './media-gc.service';
import type { DeletionBarrierPort } from '../collab/deletion-barrier.port';
import { mediaDeletionConflictTotal } from './binding-reconcile.metrics';
import { MediaFactsController } from '../media/media-facts.controller';
import { MediaService } from '../media/media.service';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const prisma = new PrismaClient();
const prismaService = new PrismaService();

const UID = `int-c3b4-owner-${Date.now()}`;
let TID = '';
const PID = `int-c3b4-proj-${Date.now()}`;
const PID_OTHER = `int-c3b4-other-${Date.now()}`;

/** 空 doc（shadow 旧面 doc 扫描零引用——引用命中全由 PG 面承载）。 */
const doc = new Y.Doc();
const makeDocsStub = (): CollabDocumentService =>
  ({ withSession: async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc) } as unknown as CollabDocumentService);

/** C3b-5：barrier 端口 stub（verified 档——本 spec 锚 DELETING 状态机/删除序非 barrier 链；
 *  真 barrier 全链=media-gc.shadow.c3b5 ⑤/deletion-barrier.int.spec）。 */
const okBarrier = (): DeletionBarrierPort => ({
  prepare: async () => ({ outcome: 'verified', barrierId: `stub-${randomUUID()}`, projects: [], expiresAt: Date.now() + 60_000 }),
  release: async () => true,
}) as unknown as DeletionBarrierPort;

/** 对象删除 stub：failKeys 抛非 404；missingKeys 抛 NoSuchKey；违序探针=对象删时行必须仍在。 */
let orderViolated = false;
const makeMinioStub = (opts: { failKeys?: string[]; missingKeys?: string[] } = {}) =>
  ({
    delete: vi.fn(async (key: string) => {
      if (opts.failKeys?.includes(key)) {
        throw Object.assign(new Error('minio down'), { $metadata: { httpStatusCode: 503 } });
      }
      if (opts.missingKeys?.includes(key)) throw Object.assign(new Error('gone'), { name: 'NoSuchKey' });
      const row = await prisma.media.findFirst({ where: { key }, select: { id: true } });
      if (!row) orderViolated = true;   // 行先删=违序（第六轮 P0-7 删除序锚）
    }),
  }) as never;

const seedMedia = async (over: Record<string, unknown> = {}) =>
  prisma.media.create({
    data: {
      userId: UID, teamId: TID, key: `int-c3b4/${randomUUID().slice(0, 8)}`,
      originalName: 'a.mp4', mimeType: 'video/mp4', size: 100, type: 'generated', status: 'completed',
      ...over,
    },
  });

const GRACE_OLD = new Date(Date.now() - 8 * 24 * 3600_000);

const conflictOf = async (reason: string): Promise<number> =>
  (await (mediaDeletionConflictTotal as unknown as { get(): Promise<{ values: { labels: Record<string, string>; value: number }[] }> }).get())
    .values.find((v) => v.labels.reason === reason)?.value ?? 0;

maybe('C3b-4：DELETING 状态机+删除序（真 PG）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-c3b4', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    TID = (await prisma.team.create({ data: { name: 'int-c3b4-team', ownerId: UID } })).id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await prisma.canvasProject.create({ data: { id: PID, name: 'int-c3b4', userId: UID, teamId: TID } });
    await prisma.canvasProject.create({ data: { id: PID_OTHER, name: 'int-c3b4-other', userId: UID, teamId: TID } });
  });

  afterAll(async () => {
    await prisma.lightingTask.deleteMany({ where: { teamId: TID } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: { in: [PID, PID_OTHER] } } });
    await prisma.mediaFact.deleteMany({ where: { media: { teamId: TID } } });
    await prisma.media.deleteMany({ where: { teamId: TID } });
    await prisma.canvasProject.deleteMany({ where: { id: { in: [PID, PID_OTHER] } } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 30_000);

  it('①CAS 抢占：双 worker 并发 claim 恰一者得每行（一者零行）+同 run 幂等+陈旧行接管', async () => {
    const m1 = await seedMedia({ deletedAt: GRACE_OLD });
    const m2 = await seedMedia({ deletedAt: GRACE_OLD });
    const ids = [m1.id, m2.id];
    const [a, b] = await Promise.all([
      claimMediaForDeletion(prisma as never, ids, { runId: 'c3b4-w1', reason: 'media-gc' }),
      claimMediaForDeletion(prisma as never, ids, { runId: 'c3b4-w2', reason: 'media-gc' }),
    ]);
    expect([...a, ...b].sort()).toEqual([...ids].sort());   // 全行被恰一者得
    expect([...a].filter((x) => b.has(x))).toEqual([]);      // 无双得（零行方=lost-race）
    // 同 run 幂等再持有（erasure 跨 tick 复核/删除窗同 erasureId 再 claim 面）
    const again = await claimMediaForDeletion(prisma as never, ids, { runId: 'c3b4-w1', reason: 'media-gc' });
    expect([...again].sort()).toEqual([...a].sort());
    // 他人新鲜 DELETING 行=不可抢（活持有互斥）；陈旧化（>MEDIA_DELETING_STALE_MS）=可接管（死轮重试面）
    const w2Ids = [...b];
    expect(await claimMediaForDeletion(prisma as never, w2Ids, { runId: 'c3b4-w1', reason: 'media-gc' })).toEqual(new Set());
    await prisma.media.updateMany({
      where: { id: { in: w2Ids } },
      data: { deletionRequestedAt: new Date(Date.now() - MEDIA_DELETING_STALE_MS - 60_000) },
    });
    expect([...await claimMediaForDeletion(prisma as never, w2Ids, { runId: 'c3b4-w1', reason: 'media-gc' })].sort())
      .toEqual([...w2Ids].sort());
    // 审计列落值锚
    const row = await prisma.media.findUniqueOrThrow({ where: { id: m1.id } });
    expect(row.deletionState).toBe('DELETING');
    expect(row.deletionRequestedAt).toBeTruthy();
    expect(typeof row.deletionRunId).toBe('string');
    expect(row.deletionReason).toBe('media-gc');
  });

  it('②a 旧引用图命中→中止回 ACTIVE+conflict 计数+审计留痕（guarded 桶）', async () => {
    const before = await conflictOf('media-gc');
    const m = await seedMedia({ deletedAt: GRACE_OLD });
    await prisma.mediaBinding.create({
      data: { mediaId: m.id, projectId: PID, nodeId: 'n-c3b4a', teamId: TID, role: 'primary', targetField: 'fileId', targetItemId: '' },
    });
    const svc = new MediaGcService(prismaService, makeMinioStub(), makeDocsStub(), okBarrier());
    const s = await svc.sweep();
    expect(s.guarded).toBeGreaterThanOrEqual(1);
    expect(s.conflicted ?? 0).toBeGreaterThanOrEqual(1);
    expect(await conflictOf('media-gc')).toBeGreaterThan(before);
    const row = await prisma.media.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.deletionState).toBe('ACTIVE');   // 中止回退（复核窗重置=下轮重判）
    expect(row.deletionReason).toBe('media-gc');   // 审计留痕（回退不擦=最近一次尝试面）
    expect(row.deletionRunId).toBeTruthy();
    expect(row.deletionRequestedAt).toBeTruthy();
  });

  it('②b 删除事务 recheck（isMediaReferenced——LightingTask 旧 GC 面盲区）→中止回 ACTIVE+行保留', async () => {
    const before = await conflictOf('media-gc');
    const m = await seedMedia({ deletedAt: GRACE_OLD });
    // LightingTask.resultMediaId=旧 GC 四源外引用（registry 臂命中——改前红=行被删）
    await prisma.lightingTask.create({
      data: { userId: UID, nodeId: 'n-c3b4b', projectId: PID_OTHER, originalImageUrl: 'http://x/l.png', params: {}, resultMediaId: m.id, teamId: TID },
    });
    const svc = new MediaGcService(prismaService, makeMinioStub(), makeDocsStub(), okBarrier());
    const s = await svc.sweep();
    expect(s.conflicted ?? 0).toBeGreaterThanOrEqual(1);
    expect(await conflictOf('media-gc')).toBeGreaterThan(before);
    const row = await prisma.media.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.deletionState).toBe('ACTIVE');
    expect(row.deletionReason).toBe('media-gc');
  });

  it('③a 删除序=对象先删→行删（违序探针：对象删时行仍在）+行删成功', async () => {
    orderViolated = false;
    const m = await seedMedia({ deletedAt: GRACE_OLD });
    const svc = new MediaGcService(prismaService, makeMinioStub(), makeDocsStub(), okBarrier());
    const s = await svc.sweep();
    expect(s.deleted).toBeGreaterThanOrEqual(1);
    expect(orderViolated).toBe(false);   // 行先删（第六轮 P0-7 撤回形）即红
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeNull();
  });

  it('③b 对象灭失（NoSuchKey）容忍→行删（幂等）', async () => {
    const m = await seedMedia({ deletedAt: GRACE_OLD });
    const svc = new MediaGcService(prismaService, makeMinioStub({ missingKeys: [m.key] }), makeDocsStub(), okBarrier());
    const s = await svc.sweep();
    expect(s.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeNull();
  });

  it('③c 对象失败（非 404）→行保留 DELETING+审计落值；陈旧化后下轮重试成功', async () => {
    const m = await seedMedia({ deletedAt: GRACE_OLD });
    const svcFail = new MediaGcService(prismaService, makeMinioStub({ failKeys: [m.key] }), makeDocsStub(), okBarrier());
    const s1 = await svcFail.sweep();
    expect(s1.objectDeleteFailed).toBeGreaterThanOrEqual(1);
    const row = await prisma.media.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.deletionState).toBe('DELETING');   // 行保留=下轮重试锚（spec §3.4-7）
    expect(row.deletionRunId).toBeTruthy();
    expect(row.deletionReason).toBe('media-gc');
    expect(row.deletionRequestedAt).toBeTruthy();
    // 新鲜 DELETING（他 run 持有）不可抢——立即重扫不删
    const svcHold = new MediaGcService(prismaService, makeMinioStub(), makeDocsStub(), okBarrier());
    await svcHold.sweep();
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeTruthy();
    // 陈旧化（模拟下轮 sweep 时刻>stale 阈）→接管重试→对象删+行删
    await prisma.media.update({ where: { id: m.id }, data: { deletionRequestedAt: new Date(Date.now() - MEDIA_DELETING_STALE_MS - 60_000) } });
    const svcRetry = new MediaGcService(prismaService, makeMinioStub(), makeDocsStub(), okBarrier());
    const s2 = await svcRetry.sweep();
    expect(s2.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeNull();
  });

  it('④用户恢复（deletedAt=null）→回 ACTIVE+下轮 GC 不再候选（行保留）', async () => {
    const m = await seedMedia({ deletedAt: GRACE_OLD });
    const svcFail = new MediaGcService(prismaService, makeMinioStub({ failKeys: [m.key] }), makeDocsStub(), okBarrier());
    await svcFail.sweep();
    expect((await prisma.media.findUniqueOrThrow({ where: { id: m.id } })).deletionState).toBe('DELETING');
    const n = await restoreMediaToActive(prisma as never, [m.id]);
    const row = await prisma.media.findUniqueOrThrow({ where: { id: m.id } });
    expect(n).toBe(1);
    expect(row.deletionState).toBe('ACTIVE');   // spec :81「用户恢复→回 ACTIVE」
    expect(row.deletedAt).toBeNull();
    // 恢复后不再是 GC 候选（deletedAt=null）——健康 sweep 不删
    const svc = new MediaGcService(prismaService, makeMinioStub(), makeDocsStub(), okBarrier());
    await svc.sweep();
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeTruthy();
  });

  it('⑤facts 端点过滤 DELETING（erasure 路径形态——deletedAt=null）+ACTIVE 同批照返；content 读面 DELETING 仍可读', async () => {
    const mActive = await seedMedia({ factVersion: 1n });
    const mDeleting = await seedMedia({ deletionState: 'DELETING', deletionRunId: 'c3b4-erasure', deletionReason: 'project-erasure', deletionRequestedAt: new Date() });
    const mSoft = await seedMedia({ deletedAt: new Date() });
    const now = new Date();
    for (const id of [mActive.id, mDeleting.id]) {
      await prisma.mediaFact.create({
        data: { mediaId: id, factType: 'state', factVersion: 1n, payload: { status: 'completed' }, updatedAt: now },
      });
    }
    const facts = new MediaFactsController(prismaService);
    const rows = await facts.facts({ user: { id: UID } } as never, TID, { mediaIds: [mActive.id, mDeleting.id, mSoft.id] });
    expect(rows.map((r) => r.mediaId)).toEqual([mActive.id]);   // DELETING 过滤+软删过滤（spec :81）
    // content 读面：DELETING 仍可读（软删才 null）
    const content = new MediaService(prismaService, makeMinioStub() as never);
    const readable = await content.findReadable(mDeleting.id, UID);
    expect(readable?.id).toBe(mDeleting.id);
    expect(await content.findReadable(mSoft.id, UID)).toBeNull();
  });
});
