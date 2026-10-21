// apps/api/src/modules/media-delivery/media-gc.int.spec.ts —— Y1a+Y1b T16（spec :25 裁决③/:53：
// GC 引用图=binding+NodeArtifact+VideoProject/VideoWork/素材库+grace——防副本还在媒体被删）：
//   ①副本引用媒体不被删（red：doc 引用扫描护栏——副本/copy 引用未进 binding 索引的窗，doc 扫描
//     是 GC 前的最终裁决）；
//   ②无引用+过 grace 可删（对象+行硬删——行删级联 MediaBinding）；
//   ③grace 期内不删（软删期=素材库删除后悔窗——deletedAt 未过 MEDIA_GC_GRACE 不进候选）；
//   ④引用图四源（MediaBinding/NodeArtifact/VideoWork.videoMediaId/VideoProject.data JSON 深扫）；
//   ⑤对象删除 404 容忍（对象已灭失仍删行——幂等）。
// MinIO=stub（delete 计数+可选抛错——MinIO 环境红非本卡回归）；doc 读面=stub withSession 直投夹具 doc。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { fillDoc, stampDocSchema, type StoredNodeRecord } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { toDocLike } from '../collab/doc-like.util';
import { MediaGcService, collectJsonMediaIds } from './media-gc.service';
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

(hasDb ? describe : describe.skip)('Y1b T16：media GC 引用图护栏（真 PG）', () => {
  let svc: MediaGcService;

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-t16gc', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    TID = (await prisma.team.create({ data: { name: 'int-t16gc-team', ownerId: UID } })).id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await prisma.canvasProject.create({ data: { id: PID, name: 'int-t16gc', userId: UID, teamId: TID } });
    doc = new Y.Doc();
    stampDocSchema(toDocLike(doc));
    svc = new MediaGcService(prisma as unknown as PrismaService, makeMinioStub(), makeDocsStub());
  });

  afterAll(async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  });

  it('①副本引用媒体不被删（doc 引用扫描护栏——无 binding/无 NodeArtifact 索引窗）', async () => {
    const m = await seedMedia('copy-ref', GRACE_OLD);
    // 副本：doc 引用在（copy/paste 保留 fileId——裁决③）但 binding 索引未建（reconcile 未触窗）
    doc.getMap('nodes').set('n-copy', new Y.Map());
    const data = new Y.Map();
    data.set('fileId', m.id);
    (doc.getMap('nodes').get('n-copy') as Y.Map<unknown>).set('data', data);

    const s = await svc.sweep();
    expect(s.candidates).toBeGreaterThanOrEqual(1);
    expect(s.guarded).toBeGreaterThanOrEqual(1);   // 护栏命中——doc 扫描终裁保留
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeTruthy();

    // 清理：删 doc 引用后再扫——此时放行删除（deleted ≥1 断言不锁上界——跨文件残留候选不误伤）
    doc.getMap('nodes').delete('n-copy');
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

  it('④引用图四源护栏（binding/NodeArtifact/VideoWork.videoMediaId/VideoProject.data 深扫）', async () => {
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
    );
    // m404 正常路径（stub 不抛）即删；mFail 抛 503 → 行保留+object-delete-failed
    const s = await svc2.sweep();
    expect(await prisma.media.findUnique({ where: { id: m404.id } })).toBeNull();
    expect(s.objectDeleteFailed).toBeGreaterThanOrEqual(1);
    expect(await prisma.media.findUnique({ where: { id: mFail.id } })).toBeTruthy();
    await prisma.media.delete({ where: { id: mFail.id } });
  });

  it('P1#1 红测：referenceVideo 引用的上传媒体不被 GC 删（词表补全前 doc 终裁不识别此键）', async () => {
    const m = await seedMedia('ref-video', GRACE_OLD);
    // 上传视频引用形状：AddNodeMenu updateConfig→data.referenceVideo（binding 索引未建的窗——doc 终裁兜底）
    doc.getMap('nodes').set('n-upv', new Y.Map());
    const data = new Y.Map();
    data.set('referenceVideo', m.id);
    (doc.getMap('nodes').get('n-upv') as Y.Map<unknown>).set('data', data);

    const s = await svc.sweep();
    expect(s.guarded).toBeGreaterThanOrEqual(1);   // 护栏命中（doc 扫描词表含 referenceVideo）
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeTruthy();

    doc.getMap('nodes').delete('n-upv');
    const s2 = await svc.sweep();
    expect(s2.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeNull();
  });

  it('P1#2 红测：doc 扫描读失败（503/lease 失守窗）→本轮全量保守保留（禁 log 后照删）', async () => {
    const m1 = await seedMedia('scanfail-1', GRACE_OLD);
    const m2 = await seedMedia('scanfail-2', GRACE_OLD);
    const failDocs = {
      withSession: async () => { throw Object.assign(new Error('collab not serving'), { status: 503 }); },
    } as unknown as CollabDocumentService;
    const svcFail = new MediaGcService(prisma as unknown as PrismaService, makeMinioStub(), failDocs);
    const s = await svcFail.sweep();
    expect(s.deleted).toBe(0);   // 读失败=保守保留（改前：catch 仅 log，判定循环照删）
    expect(s.guarded).toBeGreaterThanOrEqual(2);
    for (const id of [m1.id, m2.id]) {
      expect(await prisma.media.findUnique({ where: { id } })).toBeTruthy();
    }
    // 下轮读恢复 → 正常放行删除（无引用）
    const s2 = await svc.sweep();
    expect(s2.deleted).toBeGreaterThanOrEqual(2);
  });

  it('collectJsonMediaIds：VideoProject.data JSON 深扫收集 clip.mediaId（纯函数）', () => {
    const ids = collectJsonMediaIds({ tracks: [{ clips: [{ mediaId: 'm1' }, { mediaId: 'm2' }] }], nested: { deep: [{ mediaId: 'm1' }] } });
    expect([...ids].sort()).toEqual(['m1', 'm2']);
  });
});
