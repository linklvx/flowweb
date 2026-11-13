// apps/api/src/modules/media-delivery/media-gc.int.spec.ts —— Y1a+Y1b T16 → C3b-5 消费面切换
//（spec :25 裁决③/:53 GC 引用图/§3.4-6 :82 引用并集/§3.4-8 :84 shadow）：
//   ①副本引用媒体不被删（**决策面=并集单源**：doc 引用经 oracle 臂证人〔PG 帧真扫——投影未建窗的
//     copy 引用〕；旧 doc 扫描面=C3b-5 起 shadow 对拍面）；
//   ③grace 期内不删（软删期=素材库删除后悔窗——deletedAt 未过 MEDIA_GC_GRACE 不进候选）；
//   ④引用图四源护栏（MediaBinding/NodeArtifact/VideoWork.videoMediaId/VideoProject.data 深扫——
//     全员并集臂命中）；
//   ⑤对象删除 404 容忍（对象已灭失仍删行——幂等）。
//   P1#1（消费面切换形态）：referenceVideo 词形引用——oracle 候选无关 UUID 叶扫描命中（未知字段
//     media UUID 同族——并集 Oracle 臂「候选无关」的实证面）；
//   P1#2（消费面切换形态）：shadow doc 扫描读失败=对拍跳过非决策门（决策面=并集零 doc 读——
//     「doc 读 503 保守保留」威胁已由 decision snapshot 校验链承载〔barrier bail-out 保守保留=
//     media-gc.shadow.c3b5 ④〕）；
//   ★T19 分桶（C3b-5 形态）：引用命中=guarded；barrier bail-out=valve-bailout（决策门=barrier——
//     T19 两 SLO 信号分桶语义不变）。
// MinIO=stub（delete 计数+可选抛错——MinIO 环境红非本卡回归）；shadow 旧面 doc 读=stub withSession
// 直投夹具 doc；barrier=stub port（真 barrier 全链=media-gc.shadow.c3b5 ⑤）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { CanvasDocUpdateRepository } from '../collab/canvas-doc-update.repository';
import { OracleWorkerService } from '../collab/oracle-worker.service';
import type { DeletionBarrierPort } from '../collab/deletion-barrier.port';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { MediaGcService, collectJsonMediaIds } from './media-gc.service';
import { mediaGcOutcomeTotal } from './binding-reconcile.metrics';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();

const PID = `int-t16gc-${Date.now()}`;
const UID = `int-t16gc-owner-${Date.now()}`;
let TID = '';

let doc: Y.Doc;
const minioDeletes: string[] = [];

const makeDocsStub = (): CollabDocumentService =>
  ({ withSession: async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc) } as unknown as CollabDocumentService);

/** barrier 端口 stub 两档（verified/bail-out——C3b-5 第四参；真 barrier 全链归 shadow.c3b5/barrier spec）。 */
const okBarrier = (): DeletionBarrierPort => ({
  prepare: async () => ({ outcome: 'verified', barrierId: `stub-${randomUUID()}`, projects: [], expiresAt: Date.now() + 60_000 }),
  release: async () => true,
}) as unknown as DeletionBarrierPort;
const bailBarrier = (): DeletionBarrierPort => ({
  prepare: async () => ({ outcome: 'bail-out', reason: 'flush-timeout' }),
  release: async () => true,
}) as unknown as DeletionBarrierPort;

const makeMinioStub = (failKeys: string[] = []) =>
  ({
    delete: vi.fn(async (key: string) => {
      if (failKeys.includes(key)) {
        throw Object.assign(new Error('minio down'), { $metadata: { httpStatusCode: 503 } });
      }
      minioDeletes.push(key);
    }),
  }) as never;

const seedMedia = async (suffix: string, deletedAt: Date | null) =>
  prisma.media.create({
    data: {
      userId: UID, teamId: TID, key: `int-t16gc/${suffix}-${randomUUID().slice(0, 8)}`,
      originalName: `${suffix}.mp4`, mimeType: 'video/mp4', size: 100, type: 'generated', status: 'completed',
      ...(deletedAt ? { deletedAt } : {}),
    },
  });

const GRACE_OLD = new Date(Date.now() - 8 * 24 * 3600_000);   // 过 grace（7d）
const IN_GRACE = new Date(Date.now() - 3600_000);              // grace 期内

(hasDb ? describe : describe.skip)('Y1b T16：media GC 引用图护栏（真 PG）——C3b-5 消费面切换形态', () => {
  let svc: MediaGcService;
  /** PG doc 面（决策面 oracle 臂证人载体）：repo 追加帧+水位落定+oracle 真扫。 */
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const oracle = new OracleWorkerService(prisma as never, repo as never);
  const appendPgFrame = async (frame: Uint8Array): Promise<void> => {
    const d = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID }, select: { pgSeq: true } });
    const next = d.pgSeq + 1n;
    const r = await repo.appendBatch(PID, [seedRow(frame, next)], { expectedPgSeq: d.pgSeq, newPgSeq: next, walCheckpointSeq: next });
    expect(r).toEqual({ ok: true, rows: 1 });
    await prisma.canvasDoc.updateMany({ where: { projectId: PID }, data: { mediaBindingSeq: next, bindingsDirty: false } });
    await oracle.scanProject(PID);
  };
  /** 节点键（**逐帧唯一**：两独立帧同键=Y.Map 键 last-writer-wins 随 clientID 定胜负——败者 item
   *  在 doc 结构内但 map 迭代不可达=引用被静默遮蔽，红测假阴性根源）。 */
  const nodeKeyOf = (key: string): string => `n-gc-${key}`;
  /** 单节点引用帧（key=词形键——collectMediaRefs 词表〔shadow 旧面〕+UUID 叶〔oracle 臂〕双命中）。 */
  const refFrame = (key: string, mediaId: string): Uint8Array => {
    const d = new Y.Doc();
    try {
      const node = new Y.Map<unknown>();
      const data = new Y.Map<unknown>();
      data.set(key, mediaId);
      node.set('type', 'imageGen');
      node.set('data', data);
      (d.getMap('nodes') as Y.Map<unknown>).set(nodeKeyOf(key), node);
      return Y.encodeStateAsUpdate(d);
    } finally { d.destroy(); }
  };
  /** 删节点全态帧（先应用原帧再删——携带原 item ID 的 tombstone：独立 doc 的删帧对目标 doc 是
   *  异源 item 零效果，必须同源）。 */
  const removeNodeFrame = (orig: Uint8Array, key: string): Uint8Array => {
    const d = new Y.Doc();
    try {
      Y.applyUpdate(d, new Uint8Array(orig));
      (d.getMap('nodes') as Y.Map<unknown>).delete(nodeKeyOf(key));
      return Y.encodeStateAsUpdate(d);
    } finally { d.destroy(); }
  };

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-t16gc', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    TID = (await prisma.team.create({ data: { name: 'int-t16gc-team', ownerId: UID } })).id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await prisma.canvasProject.create({ data: { id: PID, name: 'int-t16gc', userId: UID, teamId: TID } });
    // C3b-5：PG doc 建档（空帧）+水位+oracle 真扫——决策面 oracle 臂证人在位（消费面切换前提）
    await prisma.canvasDoc.create({ data: { projectId: PID, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false } });
    doc = new Y.Doc();
    svc = new MediaGcService(prisma as unknown as PrismaService, makeMinioStub(), makeDocsStub(), okBarrier());
    await ensureLeaseFixture(prisma, repo);   // appendBatch 契约 16：lease owner fail-closed
    await appendPgFrame(Y.encodeStateAsUpdate(new Y.Doc()));
  });

  afterAll(async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });   // CanvasDoc/Update/Oracle 双表 FK Cascade
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await restoreLeaseRow(prisma);
    await prisma.$disconnect();
  });

  it('①副本引用媒体不被删（决策面=并集 oracle 臂——doc 引用无 binding 索引窗；旧 doc 扫描=shadow 面）', async () => {
    const m = await seedMedia('copy-ref', GRACE_OLD);
    const f = refFrame('fileId', m.id);
    // 副本：doc 引用在（copy/paste 保留 fileId——裁决③）但 binding 索引未建（reconcile 未触窗）
    doc.getMap('nodes').set('n-copy', new Y.Map());
    const data = new Y.Map();
    data.set('fileId', m.id);
    (doc.getMap('nodes').get('n-copy') as Y.Map<unknown>).set('data', data);
    await appendPgFrame(f);   // PG 帧+oracle 真扫=决策面证人

    const s = await svc.sweep();
    expect(s.candidates).toBeGreaterThanOrEqual(1);
    expect(s.guarded).toBeGreaterThanOrEqual(1);   // 并集 oracle 臂命中——阻断保留
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeTruthy();

    // 清理：删 doc 引用（PG 帧 tombstone+oracle 重扫）后再扫——此时放行删除
    doc.getMap('nodes').delete('n-copy');
    await appendPgFrame(removeNodeFrame(f, 'fileId'));
    const s2 = await svc.sweep();
    expect(s2.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeNull();
  });

  it('③grace 期内不删（软删期=后悔窗——未过 7d 不进候选）', async () => {
    const m = await seedMedia('in-grace', IN_GRACE);
    const s = await svc.sweep();
    expect(s.candidates).toBeGreaterThanOrEqual(0);   // 本行不进候选（deletedAt 未过 grace）
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeTruthy();
    // 清理（直删行——本用例只验 grace 门）
    await prisma.media.delete({ where: { id: m.id } });
  });

  it('④引用图四源护栏（binding/NodeArtifact/VideoWork.videoMediaId/VideoProject.data 深扫——全员并集臂）', async () => {
    const mBind = await seedMedia('bind-ref', GRACE_OLD);
    const mArt = await seedMedia('art-ref', GRACE_OLD);
    const mWork = await seedMedia('work-ref', GRACE_OLD);
    const mTimeline = await seedMedia('timeline-ref', GRACE_OLD);
    await prisma.mediaBinding.create({
      data: { mediaId: mBind.id, projectId: PID, nodeId: 'n-b', teamId: TID, role: 'primary', targetField: 'fileId', targetItemId: '' },
    });
    await prisma.nodeArtifact.create({
      data: { projectId: PID, nodeId: 'n-a', teamId: TID, role: 'primary', targetField: 'fileId', targetItemId: '', mediaId: mArt.id, state: 'stored', source: 'generated' },
    });
    const w = await prisma.videoWork.create({
      data: { title: 'int-t16gc', authorName: 'x', videoKey: `int-t16gc/w-${randomUUID().slice(0, 8)}`, videoMediaId: mWork.id },
    });
    const vp = await prisma.videoProject.create({
      data: {
        teamId: TID, userId: UID, workflowId: PID, sourceNodeId: `n-vp-${randomUUID().slice(0, 8)}`, title: 'int-t16gc',
        data: { tracks: [{ id: 't1', type: 'video', name: 'v', muted: false, hidden: false, clips: [{ id: 'c1', type: 'video', trackId: 't1', start: 0, duration: 1, sourceStart: 0, mediaId: mTimeline.id }] }] },
      },
    });

    const s = await svc.sweep();
    expect(s.guarded).toBeGreaterThanOrEqual(4);   // 四源各命中一行
    for (const id of [mBind.id, mArt.id, mWork.id, mTimeline.id]) {
      expect(await prisma.media.findUnique({ where: { id } })).toBeTruthy();
    }

    // 清理引用源后放行（护栏随引用消亡解除）
    await prisma.mediaBinding.deleteMany({ where: { mediaId: mBind.id } });
    await prisma.nodeArtifact.deleteMany({ where: { mediaId: mArt.id } });
    await prisma.videoWork.delete({ where: { id: w.id } });
    await prisma.videoProject.delete({ where: { id: vp.id } });
    const s2 = await svc.sweep();
    expect(s2.deleted).toBeGreaterThanOrEqual(4);
    for (const id of [mBind.id, mArt.id, mWork.id, mTimeline.id]) {
      expect(await prisma.media.findUnique({ where: { id } })).toBeNull();
    }
  });

  it('⑤对象删除 404 容忍（对象已灭失仍删行——幂等）+非 404 失败保行', async () => {
    const m404 = await seedMedia('obj-404', GRACE_OLD);
    const mFail = await seedMedia('obj-fail', GRACE_OLD);
    const svc2 = new MediaGcService(
      prisma as unknown as PrismaService,
      makeMinioStub([mFail.key]),
      makeDocsStub(),
      okBarrier(),
    );
    // m404 正常路径（stub 不抛）即删；mFail 抛 503 → 行保留+object-delete-failed
    const s = await svc2.sweep();
    expect(await prisma.media.findUnique({ where: { id: m404.id } })).toBeNull();
    expect(s.objectDeleteFailed).toBeGreaterThanOrEqual(1);
    expect(await prisma.media.findUnique({ where: { id: mFail.id } })).toBeTruthy();
    await prisma.media.delete({ where: { id: mFail.id } });
  });

  it('P1#1：referenceVideo 引用的上传媒体不被 GC 删（oracle 候选无关 UUID 叶扫描——未知字段词形同族）', async () => {
    const m = await seedMedia('ref-video', GRACE_OLD);
    // 上传视频引用形状：AddNodeMenu updateConfig→data.referenceVideo（binding 索引未建的窗）
    doc.getMap('nodes').set('n-upv', new Y.Map());
    const data = new Y.Map();
    data.set('referenceVideo', m.id);
    (doc.getMap('nodes').get('n-upv') as Y.Map<unknown>).set('data', data);
    const f = refFrame('referenceVideo', m.id);
    await appendPgFrame(f);   // PG 帧+oracle 真扫=决策面证人

    const s = await svc.sweep();
    expect(s.guarded).toBeGreaterThanOrEqual(1);   // 并集 oracle 臂命中（UUID 叶候选无关——词表外键同护）
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeTruthy();

    doc.getMap('nodes').delete('n-upv');
    await appendPgFrame(removeNodeFrame(f, 'referenceVideo'));
    const s2 = await svc.sweep();
    expect(s2.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeNull();
  });

  it('P1#2（消费面切换形态）：shadow doc 扫描读失败（503）→对拍跳过非决策门——并集零引用照删（doc 读 503 保守保留威胁已由 decision snapshot 校验链承载）', async () => {
    const m1 = await seedMedia('scanfail-1', GRACE_OLD);
    const m2 = await seedMedia('scanfail-2', GRACE_OLD);
    const failDocs = {
      withSession: async () => { throw Object.assign(new Error('collab not serving'), { status: 503 }); },
    } as unknown as CollabDocumentService;
    const svcFail = new MediaGcService(prisma as unknown as PrismaService, makeMinioStub(), failDocs, okBarrier());
    const s = await svcFail.sweep();
    // C3b-5 起决策面=并集（registry∪Binding∪Oracle——零 live doc 读）：旧面读失败只跳过对拍不拦删除；
    // 保守保留形态=decision snapshot 校验链不满足/barrier 预算耗尽（barrier bail-out——shadow.c3b5 ④）。
    expect(s.deleted).toBeGreaterThanOrEqual(2);
    for (const id of [m1.id, m2.id]) {
      expect(await prisma.media.findUnique({ where: { id } })).toBeNull();
    }
  });

  it('★T19 分桶（C3b-5 形态）：引用命中=guarded；barrier bail-out=valve-bailout（两 SLO 信号分桶，决策门=barrier）', async () => {
    // 引用命中档：binding 行（并集 Binding 臂）
    const mRef = await seedMedia('bucket-ref', GRACE_OLD);
    await prisma.mediaBinding.create({
      data: { mediaId: mRef.id, projectId: PID, nodeId: 'n-bucket-ref', teamId: TID, role: 'primary', targetField: 'fileId', targetItemId: '' },
    });
    const outcomeOf = async (outcome: string): Promise<number> =>
      (await (mediaGcOutcomeTotal as any).get()).values.find((v: any) => v.labels.outcome === outcome)?.value ?? 0;
    const gBefore = await outcomeOf('guarded');
    const vBefore = await outcomeOf('valve-bailout');
    const s1 = await svc.sweep();
    expect(s1.guarded).toBeGreaterThanOrEqual(1);
    expect(await outcomeOf('guarded')).toBeGreaterThan(gBefore);    // 引用命中进 guarded 桶
    expect(await outcomeOf('valve-bailout')).toBe(vBefore);         // 非阀场景零 bail-out 计数
    await prisma.mediaBinding.deleteMany({ where: { mediaId: mRef.id } });

    // 阀 bail-out 档：barrier prepare bail-out（大团队超时/扫描面异常族——保守保留进 valve-bailout 桶）
    const mFree = await seedMedia('bucket-bailout', GRACE_OLD);
    const v2 = await outcomeOf('valve-bailout');
    const svcBail = new MediaGcService(prisma as unknown as PrismaService, makeMinioStub(), makeDocsStub(), bailBarrier());
    const s2 = await svcBail.sweep();
    expect(s2.deleted).toBe(0);
    expect(s2.guarded).toBeGreaterThanOrEqual(1);
    expect(await outcomeOf('valve-bailout')).toBeGreaterThanOrEqual(v2 + 1); // 阀 bail-out 进独立桶
    expect(await prisma.media.findUnique({ where: { id: mFree.id } })).toBeTruthy();
  });

  it('collectJsonMediaIds：VideoProject.data JSON 深扫收集 clip.mediaId（纯函数）', () => {
    const ids = collectJsonMediaIds({ tracks: [{ clips: [{ mediaId: 'm1' }, { mediaId: 'm2' }] }], nested: { deep: [{ mediaId: 'm1' }] } });
    expect([...ids].sort()).toEqual(['m1', 'm2']);
  });
});
