// apps/api/src/modules/media-delivery/binding-reconcile.int.spec.ts —— Y1a+Y1b T16（spec :25 裁决③/
// :80 Z7''-v14/:91 Z18''）：MediaBinding current-state 惰性 reconcile 真 PG 红绿——
//   ①同槽位换 media 改行（red 复现面：v10.1 create-only「当前槽位靠 createdAt 猜」——upsert DO
//     UPDATE mediaId 恰一行非两行）；
//   ②删除节点→binding 行删除（stale 清扫：doc 无引用但 binding 行在→删）；
//   ③跨 team 拒+计数不建行（Media.teamId≠project.teamId——读 ACL 403 兜底在 content 单门）；
//   ④九键全键形（fileId/referenceImage/referenceVideo/referenceAudio/images[].id/allImages/
//     trimmedFileId/videoFileId/audioFileId——collectMediaRefs 单源；images 列表槽 targetItemId=item.id）；
//   ⑤media 行灭失引用拒建（FK 防线——missing-media 计数）；
//   ⑥项目灭失→全行清（stale 兜底）；
//   ⑦post-apply 触发链（requestReconcile 入队→drain 排水恰一轮）。
// doc 读面=stub CollabDocumentService（withSession 直投夹具 Y.Doc——reconcile 的 doc 依赖面
// 单点在 withSession，stub 不掩盖被测逻辑）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { fillDoc,
  type StoredNodeRecord } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { toDocLike } from '../collab/doc-like.util';
import { BindingReconcileService } from './binding-reconcile.service';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();

const PID = `int-t16-${Date.now()}`;
const UID = `int-t16-owner-${Date.now()}`;
let TID = '';
let OTHER_TID = '';

/** 夹具 doc（reconcileProject 经 stub withSession 读到的那份）。 */
let doc: Y.Doc;

const makeDocsStub = (): CollabDocumentService =>
  ({ withSession: async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc) } as unknown as CollabDocumentService);

let svc: BindingReconcileService;

const seedMedia = async (teamId: string, suffix: string) =>
  prisma.media.create({
    data: { userId: UID, teamId, key: `int-t16/${suffix}-${randomUUID().slice(0, 8)}`, originalName: `${suffix}.png`, mimeType: 'image/png', size: 100, type: 'uploaded', status: 'completed' },
  });

const bindingsOf = (nodeId: string) => prisma.mediaBinding.findMany({
  where: { projectId: PID, nodeId },
  orderBy: { targetField: 'asc' },
});

(hasDb ? describe : describe.skip)('Y1b T16：MediaBinding current-state reconcile（真 PG）', () => {
  let M_OLD: string;
  let M_NEW: string;
  let M_MULTI_A: string;
  let M_MULTI_B: string;
  let M_FOREIGN: string;   // 跨 team
  let M_REF: string;
  let M_REFV: string;   // P1#1：referenceVideo 槽
  let M_REFA: string;   // P1#1：referenceAudio 槽
  let M_TRIM: string;
  let M_VID: string;
  let M_AUD: string;

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-t16', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    TID = (await prisma.team.create({ data: { name: 'int-t16-team', ownerId: UID } })).id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    OTHER_TID = (await prisma.team.create({ data: { name: 'int-t16-other', ownerId: UID } })).id;
    await prisma.teamMember.create({ data: { teamId: OTHER_TID, userId: UID, role: 'OWNER' } });
    await prisma.canvasProject.create({ data: { id: PID, name: 'int-t16', userId: UID, teamId: TID } });
    M_OLD = (await seedMedia(TID, 'old')).id;
    M_NEW = (await seedMedia(TID, 'new')).id;
    M_MULTI_A = (await seedMedia(TID, 'multi-a')).id;
    M_MULTI_B = (await seedMedia(TID, 'multi-b')).id;
    M_FOREIGN = (await seedMedia(OTHER_TID, 'foreign')).id;
    M_REFV = (await seedMedia(TID, 'refv')).id;   // P1#1：上传视频引用键用
    M_REFA = (await seedMedia(TID, 'refa')).id;   // P1#1：上传音频引用键用
    M_REF = (await seedMedia(TID, 'ref')).id;
    M_TRIM = (await seedMedia(TID, 'trim')).id;
    M_VID = (await seedMedia(TID, 'vid')).id;
    M_AUD = (await seedMedia(TID, 'aud')).id;

    doc = new Y.Doc();
    svc = new BindingReconcileService(prisma as unknown as PrismaService, makeDocsStub());
  });

  afterAll(async () => {
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID, OTHER_TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  });

  it('①同槽位换 media 改行（current-state upsert——恰一行非 createdAt 猜）', async () => {
    // 节点 n-swap：首代 doc fileId=OLD → reconcile 一行；换 media fileId=NEW → reconcile 改行
    const n = 'n-swap';
    fillDoc(toDocLike(doc), [{ id: n, type: 'imageGen', data: { fileId: M_OLD } } as StoredNodeRecord], []);
    let s = await svc.reconcileProject(PID);
    expect(s.upserted).toBe(1);
    let rows = await bindingsOf(n);
    expect(rows).toHaveLength(1);
    expect(rows[0].mediaId).toBe(M_OLD);

    // 同槽位换 media：删节点重建（fillDoc 不覆盖既有键——nodes.delete 先行）
    doc.getMap('nodes').delete(n);
    fillDoc(toDocLike(doc), [{ id: n, type: 'imageGen', data: { fileId: M_NEW } } as StoredNodeRecord], []);
    s = await svc.reconcileProject(PID);
    expect(s.upserted).toBe(1);
    rows = await bindingsOf(n);
    expect(rows).toHaveLength(1);   // 同槽位一行——create-only 会落数行靠 createdAt 猜（红复现面）
    expect(rows[0].mediaId).toBe(M_NEW);
    expect(s.crossTeamRejected).toBe(0);
    doc.getMap('nodes').delete(n);   // 用例尾清扫（共享 doc 夹具——后续用例计数不受残留节点干扰）
    await svc.reconcileProject(PID);
  });

  it('②删除节点→binding 行删除（stale 清扫——doc 无引用但 binding 行在）', async () => {
    const n = 'n-gone';
    fillDoc(toDocLike(doc), [{ id: n, type: 'imageGen', data: { fileId: M_OLD } } as StoredNodeRecord], []);
    await svc.reconcileProject(PID);
    expect(await bindingsOf(n)).toHaveLength(1);

    doc.getMap('nodes').delete(n);   // 节点删除（projection orphaned 观察点对应面）
    const s = await svc.reconcileProject(PID);
    expect(s.deleted).toBeGreaterThanOrEqual(1);
    expect(await bindingsOf(n)).toHaveLength(0);   // stale 行已删——GC 引用图不再被历史行拖住
  });

  it('③跨 team 拒+计数不建行（Media.teamId≠project.teamId）', async () => {
    const n = 'n-foreign';
    fillDoc(toDocLike(doc), [{ id: n, type: 'imageGen', data: { fileId: M_FOREIGN } } as StoredNodeRecord], []);
    const s = await svc.reconcileProject(PID);
    expect(s.crossTeamRejected).toBe(1);
    expect(await bindingsOf(n)).toHaveLength(0);   // 不建行——读侧 ACL 403 兜底在 content 单门
    doc.getMap('nodes').delete(n);
    await svc.reconcileProject(PID);
  });

  it('④全词表键形扫描（spec 评审 P1#1 后九键——referenceVideo/referenceAudio 含）', async () => {
    const n = 'n-seven';
    fillDoc(toDocLike(doc), [{
      id: n,
      type: 'imageGen',
      data: {
        fileId: M_NEW,
        referenceImage: M_REF,
        referenceVideo: M_REFV,   // P1#1：AddNodeMenu.tsx:249 上传视频引用（updateConfig→mergeNodeData→data）
        referenceAudio: M_REFA,   // P1#1：AudioGenNode.tsx:105 上传音频引用（同路径落 data 单域）
        images: [{ id: M_MULTI_A, url: 'x', name: 'a', status: 'success' }, { id: M_MULTI_B, url: 'y', name: 'b', status: 'success' }],
        allImages: [{ id: M_MULTI_A, url: 'x', name: 'a', status: 'success' }],
        trimmedFileId: M_TRIM,
        videoFileId: M_VID,
        audioFileId: M_AUD,
      },
    } as unknown as StoredNodeRecord], []);
    const s = await svc.reconcileProject(PID);
    expect(s.upserted).toBe(10);   // fileId+referenceImage+referenceVideo+referenceAudio+images×2+allImages×1+trimmed+video+audio
    expect(s.crossTeamRejected).toBe(0);
    const rows = await bindingsOf(n);
    expect(rows.map((r) => [r.targetField, r.targetItemId, r.mediaId]).sort()).toEqual([
      ['allImages', M_MULTI_A, M_MULTI_A],
      ['audioFileId', '', M_AUD],
      ['fileId', '', M_NEW],
      ['images', M_MULTI_A, M_MULTI_A],
      ['images', M_MULTI_B, M_MULTI_B],
      ['referenceAudio', '', M_REFA],
      ['referenceImage', '', M_REF],
      ['referenceVideo', '', M_REFV],
      ['trimmedFileId', '', M_TRIM],
      ['videoFileId', '', M_VID],
    ].sort());
    doc.getMap('nodes').delete(n);
    await svc.reconcileProject(PID);
  });

  it('⑧P1#1 红测：videoGen/audioGen 上传引用（referenceVideo/referenceAudio——updateConfig 域入口）建行', async () => {
    // 形状复现面：上传视频/音频经 AddNodeMenu/AudioGenNode updateConfig 落 data（nodeStore.ts:640-646
    // 终态全量 merge——doc 无独立 config 域）；词表缺此二键 ⇒ binding 不索引+GC doc 终裁不识别
    // ⇒ 被引用媒体软删 7d 后被硬删（media-gc.int.spec 同形状用例）。
    fillDoc(toDocLike(doc), [
      { id: 'n-upv', type: 'videoGen', data: { referenceVideo: M_REFV, status: 'idle' } } as unknown as StoredNodeRecord,
      { id: 'n-upa', type: 'audioGen', data: { referenceAudio: M_REFA, status: 'idle' } } as unknown as StoredNodeRecord,
    ], []);
    const s = await svc.reconcileProject(PID);
    expect(s.upserted).toBe(2);
    const vRows = (await bindingsOf('n-upv')).map((r) => r.targetField);
    const aRows = (await bindingsOf('n-upa')).map((r) => r.targetField);
    expect(vRows).toEqual(['referenceVideo']);
    expect(aRows).toEqual(['referenceAudio']);
    doc.getMap('nodes').delete('n-upv');
    doc.getMap('nodes').delete('n-upa');
    await svc.reconcileProject(PID);
  });

  it('⑤media 行灭失引用拒建（FK 防线——missing-media 计数）', async () => {
    const n = 'n-missing';
    fillDoc(toDocLike(doc), [{ id: n, type: 'imageGen', data: { fileId: 'media-void-404' } } as StoredNodeRecord], []);
    const s = await svc.reconcileProject(PID);
    expect(s.missingMedia).toBe(1);
    expect(await bindingsOf(n)).toHaveLength(0);
    doc.getMap('nodes').delete(n);
    await svc.reconcileProject(PID);
  });

  it('⑦post-apply 触发链：requestReconcile 入队→drain 排水（幂等收敛）', async () => {
    const n = 'n-trigger';
    fillDoc(toDocLike(doc), [{ id: n, type: 'imageGen', data: { fileId: M_OLD } } as StoredNodeRecord], []);
    svc.requestReconcile(PID);
    svc.requestReconcile(PID);   // 双触发去重恰一轮
    const processed = await svc.drain();
    expect(processed).toBe(1);
    expect(await bindingsOf(n)).toHaveLength(1);
    // 二次 drain 空队列零动作（幂等）
    expect(await svc.drain()).toBe(0);
    // P2#6：同 doc 幂等重扫——upserted 净计数回零（改前=admitted 全量虚高）
    const again = await svc.reconcileProject(PID);
    expect(again.upserted).toBe(0);
    expect(again.deleted).toBe(0);
    expect(await bindingsOf(n)).toHaveLength(1);
    doc.getMap('nodes').delete(n);
    await svc.reconcileProject(PID);
  });

  it('⑥项目灭失→全行清（stale 兜底）', async () => {
    const PID2 = `${PID}-gone`;
    await prisma.canvasProject.create({ data: { id: PID2, name: 'int-t16-2', userId: UID, teamId: TID } });
    await prisma.mediaBinding.create({
      data: { mediaId: M_OLD, projectId: PID2, nodeId: 'n-x', teamId: TID, role: 'primary', targetField: 'fileId', targetItemId: '' },
    });
    await prisma.canvasProject.delete({ where: { id: PID2 } });
    const s = await svc.reconcileProject(PID2);
    expect(s.ok).toBe(true);
    expect(s.deleted).toBe(1);
    expect(await prisma.mediaBinding.count({ where: { projectId: PID2 } })).toBe(0);
  });
});
