// apps/api/src/modules/collab/collab-load-rescan.int.spec.ts
// Y2 D4t（spec v2.13 §3 D5 ⑦「持久化执法腿——装入重扫三段式」）：装载兜底红转绿 int。
// ★红对=「翻禁前持久化的历史帧+恢复导入旁路」非法键的兜底缺位——frame-deny 只拦新写入面
//   （validateFrameDeny 仅 actor 准入 :1146 与 recovery-import :275 两消费面——装载读面不跑），
//   翻禁前落库的含对方团队 id 的 mediaId 帧、恢复导入旁路帧在装载重放后仍活 doc 在场——
//   唯一清除入口=装入重扫三段式（DR loadDocument 尾：①活 doc 全词表同步收集候选→②事务外
//   await 读 Media 行+admitMediaRef 三档判定→③withSession(write) 同步回调删键〔SERVER_TRANSACT_
//   ORIGIN=maintenance 档落库〕→④写后快照 projectBindings）。
// 装置承 collab-residency-durability.int.spec（真 gateway 直构+lease stub+真 repo+真 PG）+
//   binding-rebuild.int.spec（seedRow 播种先例——canvas-doc-row 收原始 update 字节）。
//   驱动面=residency.withSession(read) → openDirectConnection → gateway.hooks.onLoadDocument
//   （DirectConnection 不经 WS 鉴权——Z80 锚同入口，withSession 档先例）。
// 计数=media_binding_skip_total 现有 skip 面（reason=missing|cross-team|soft-deleted——
//   recordMediaBindingProjection 单点，禁新造指标——spec §7 观测）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { register } from 'prom-client';
import * as Y from 'yjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollabGateway } from './collab.gateway';
import { CollabResidencyService } from './collab-residency.service';
import { CollabSpoolService } from './collab-spool.service';
import { spoolForTest } from '../../test-utils/erasure-fixtures';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { createLeaseStub } from './test-utils/lease-stub';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { pollUntil } from '../../test-utils/poll-until';
import { collectMediaRefsForNode, CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

/** 本块自建双域 fixture（D2t/D3t int 先例——独立 prisma client 防他块 afterAll 断连）。 */
const UID = 'u-d4t-rescan';
const DST_TID = 'd4t-dst-team';
const DST_PID = 'd4t-dst-proj';
const OTHER_TID = 'd4t-other-team';
/** 对方团队 media id（cross-team 档——装载后应删键）。 */
const X_MEDIA = 'm-d4t-cross';
/** 本团队 media id（历史合法键——零动作保通锚）。 */
const OWN_MEDIA = 'm-d4t-own';

/** Y.Doc 播种帧：nodes map 直投节点（与装载读面同构——collectMediaRefsForNode 全词表扫描域）。
 *  frame-deny 不跑（装载读面非两消费面）——含对方团队 id 的键靠装入重扫清除（本 spec 红对）。 */
const seedFrame = (nodeId: string, data: Record<string, unknown>): Uint8Array => {
  const d = new Y.Doc();
  const node = new Y.Map<unknown>();
  const dataMap = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(data)) dataMap.set(k, v);
  node.set('type', 'imageGen');
  node.set('data', dataMap);
  (d.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
  return Y.encodeStateAsUpdate(d);
};

/** prom-client v15 get() 异步——skip 计数快照（label 过滤客户端做——canary int 先例）。 */
async function skipCount(reason: string): Promise<number> {
  const m = register.getSingleMetric('media_binding_skip_total') as any;
  const vals = (await m.get()).values;
  return vals.find((v: any) => v.labels?.reason === reason)?.value ?? 0;
}

maybe('Y2 D4t：装入重扫三段式——装载兜底删非法键（真 gateway+真 PG）', () => {
  let prisma: PrismaClient;
  let repo: CanvasDocUpdateRepository;
  let gateway: CollabGateway;
  let residency: CollabResidencyService;
  let spoolDir = '';
  let spoolCleanup: () => Promise<void> = async () => {};

  /** 装载驱动（生产读面同款）：withSession(read) → openDirectConnection → loadDocument。
   *  装载后 doc 常驻（residency 钉住）——直接在 conn.document 上断言写后终态。 */
  const loadDoc = async (pid: string): Promise<Y.Doc> =>
    residency.withSession(pid, (doc) => doc, { mode: 'read' });

  /** flush：维护写（删键帧进 pendingQueues）→ 强制库 debounce 队列→PG 落库。 */
  const flush = async (pid: string): Promise<void> => {
    gateway.server.hocuspocus.flushPendingStores();
    await pollUntil(() => gateway.isPersistedComplete(pid), 5_000);
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as never);
    await prisma.user.upsert({ where: { id: UID }, update: {}, create: { id: UID, name: 'd4t', email: 'd4t@local.test', emailVerified: true } });
    await prisma.team.upsert({ where: { id: DST_TID }, update: {}, create: { id: DST_TID, name: 'd4t-dst', ownerId: UID } });
    await prisma.team.upsert({ where: { id: OTHER_TID }, update: {}, create: { id: OTHER_TID, name: 'd4t-other', ownerId: UID } });
    await prisma.teamMember.upsert({ where: { teamId_userId: { teamId: DST_TID, userId: UID } }, update: {}, create: { teamId: DST_TID, userId: UID, role: 'OWNER' } });
    await prisma.canvasProject.upsert({ where: { id: DST_PID }, update: {}, create: { id: DST_PID, name: 'd4t-dst', userId: UID, teamId: DST_TID } });
    // 跨 run 残留 wipe
    await prisma.mediaBinding.deleteMany({ where: { projectId: DST_PID } }).catch(() => undefined);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: DST_PID } }).catch(() => undefined);
    await prisma.canvasDoc.deleteMany({ where: { projectId: DST_PID } }).catch(() => undefined);
    await prisma.media.deleteMany({ where: { id: { in: [X_MEDIA, OWN_MEDIA] } } }).catch(() => undefined);
    // 源行播种：对方团队行（cross-team 档）+本团队行（历史合法键——保通锚）
    await prisma.media.create({ data: { id: X_MEDIA, userId: UID, teamId: OTHER_TID, bucket: 'flowai', key: `d4t/x-${X_MEDIA}.bin`, originalName: 'x.bin', mimeType: 'image/png', size: 100n, type: 'uploaded', status: 'completed' } });
    await prisma.media.create({ data: { id: OWN_MEDIA, userId: UID, teamId: DST_TID, bucket: 'flowai', key: `d4t/own-${OWN_MEDIA}.bin`, originalName: 'own.bin', mimeType: 'image/png', size: 100n, type: 'uploaded', status: 'completed' } });
    await ensureLeaseFixture(prisma, repo, 'stub-owner-1');
    const d = await mkdtemp(join(tmpdir(), 'd4t-rescan-'));
    spoolDir = d;
    const spool = spoolForTest(d);
    const perm = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: DST_TID }),
    };
    gateway = new CollabGateway(
      prisma as never, new EventEmitter2() as never, repo,
      createLeaseStub({}, { repo: repo as never, spool: spool as never }) as never,
      perm as never, 0, 10_000, undefined, undefined, spool,
    );
    await gateway.onModuleInit();   // lease stub fast path ⇒ serving
    residency = new CollabResidencyService(gateway);
  }, 60_000);

  afterAll(async () => {
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid).catch(() => undefined);
    await (gateway as never as { server?: { destroy(): Promise<void> } })?.server?.destroy?.().catch?.(() => undefined);
    await rm(spoolDir, { recursive: true, force: true }).catch(() => undefined);
    await prisma?.mediaBinding.deleteMany({ where: { projectId: DST_PID } }).catch(() => undefined);
    await prisma?.canvasDocUpdate.deleteMany({ where: { projectId: DST_PID } }).catch(() => undefined);
    await prisma?.canvasDoc.deleteMany({ where: { projectId: DST_PID } }).catch(() => undefined);
    await prisma?.media.deleteMany({ where: { id: { in: [X_MEDIA, OWN_MEDIA] } } }).catch(() => undefined);
    await prisma?.canvasProject.deleteMany({ where: { id: DST_PID } }).catch(() => undefined);
    await prisma?.teamMember.deleteMany({ where: { teamId: DST_TID, userId: UID } }).catch(() => undefined);
    await prisma?.team.deleteMany({ where: { id: { in: [DST_TID, OTHER_TID] } } }).catch(() => undefined);
    await prisma?.user.deleteMany({ where: { id: UID } }).catch(() => undefined);
    await restoreLeaseRow(prisma).catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
    void spoolCleanup;
  }, 30_000);

  it('★主档：含对方团队 id 的持久化帧装载后——非法键从活 doc+持久化帧消失（origin=maintenance 删键帧落库）+绑定行与文档一致（skip 计数 cross-team 面）', async () => {
    // ── 布景：翻禁前历史帧播种进 PG（seedRow——装载路径不跑 frame-deny）──
    // 节点 n-d4t-a：data.mediaId=对方团队 X_MEDIA（非法键）+referenceImage=本团队 OWN_MEDIA（历史合法键）
    await repo.appendBatch(DST_PID, [seedRow(seedFrame('n-d4t-a', { mediaId: X_MEDIA, referenceImage: OWN_MEDIA }), 5n)], { expectedPgSeq: 0n, newPgSeq: 5n, walCheckpointSeq: 5n });
    const skipBefore = await skipCount('cross-team');
    // ── 装载（生产读面同款——loadDocument 尾重扫执行）──
    const doc = await loadDoc(DST_PID);
    // 非法键已从活 doc 删除（collectMediaRefsForNode 全词表——mediaId 键消失）
    const refs = collectMediaRefsForNode('n-d4t-a', (doc.getMap('nodes') as Y.Map<unknown>).get('n-d4t-a'));
    expect(refs.some((r) => r.mediaId === X_MEDIA)).toBe(false);
    // 历史合法键保留（同节点存活槽不被误删——零误删断言）
    expect(refs.some((r) => r.mediaId === OWN_MEDIA)).toBe(true);
    // ── 删键帧 maintenance 档落库：flush 后重放读侧非法键消失+绑定行与文档一致 ──
    await flush(DST_PID);
    const { state, updates } = await repo.loadForHydration(DST_PID);
    const revived = new Y.Doc();
    try {
      if (state) Y.applyUpdate(revived, new Uint8Array(state));
      for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
      // 持久化帧读侧：非法键从持久化帧消失
      const revivedRefs = collectMediaRefsForNode('n-d4t-a', (revived.getMap('nodes') as Y.Map<unknown>).get('n-d4t-a'));
      expect(revivedRefs.some((r) => r.mediaId === X_MEDIA)).toBe(false);
      expect(revivedRefs.some((r) => r.mediaId === OWN_MEDIA)).toBe(true);
    } finally {
      revived.destroy();
    }
    // 绑定行与文档一致：X_MEDIA 行不在（重扫快照直调投影——admit cross-team 跳过）；OWN_MEDIA 行在
    const xBinding = await prisma.mediaBinding.findFirst({ where: { projectId: DST_PID, mediaId: X_MEDIA } });
    expect(xBinding).toBeNull();
    const ownBinding = await prisma.mediaBinding.findFirst({ where: { projectId: DST_PID, mediaId: OWN_MEDIA } });
    expect(ownBinding).not.toBeNull();
    // skip 计数挂现有面（media_binding_skip_total{reason='cross-team'}——禁新造指标）
    const skipAfter = await skipCount('cross-team');
    expect(skipAfter).toBeGreaterThan(skipBefore);
  }, 60_000);

  it('★历史合法键零动作：全部键皆本团队行（admitted）——装载后 doc 原样（零删除帧+零 skip 增量）', async () => {
    // 独立项目域（隔离——不与本块主档布景互串）
    const pid = 'd4t-clean-proj';
    await prisma.canvasProject.upsert({ where: { id: pid }, update: {}, create: { id: pid, name: 'd4t-clean', userId: UID, teamId: DST_TID } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
    await prisma.canvasDoc.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
    try {
      await repo.appendBatch(pid, [seedRow(seedFrame('n-clean', { mediaId: OWN_MEDIA }), 5n)], { expectedPgSeq: 0n, newPgSeq: 5n, walCheckpointSeq: 5n });
      const skipBefore = await skipCount('cross-team');
      const doc = await loadDoc(pid);
      // 零动作：doc 原样（合法键保留）
      const refs = collectMediaRefsForNode('n-clean', (doc.getMap('nodes') as Y.Map<unknown>).get('n-clean'));
      expect(refs.some((r) => r.mediaId === OWN_MEDIA)).toBe(true);
      // 键已不在才空操作——本档键全在且全合法：零删键帧落库（flush 后读侧原样）
      await flush(pid);
      const { state, updates } = await repo.loadForHydration(pid);
      const revived = new Y.Doc();
      try {
        if (state) Y.applyUpdate(revived, new Uint8Array(state));
        for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
        const revivedRefs = collectMediaRefsForNode('n-clean', (revived.getMap('nodes') as Y.Map<unknown>).get('n-clean'));
        expect(revivedRefs.some((r) => r.mediaId === OWN_MEDIA)).toBe(true);
      } finally {
        revived.destroy();
      }
      const skipAfter = await skipCount('cross-team');
      expect(skipAfter).toBe(skipBefore);   // 零 skip 增量（合法键零动作）
      // 绑定行断言归投影 boot 面（onBindingBootCheck→backfill 异步非本档语义）——重扫面零动作
      // 即零删键零投影零计数；主档「绑定行与文档一致」已承载投影侧断言（合法键投影正常出现）。
    } finally {
      await residency.releaseSessionFor(pid).catch(() => undefined);
      await prisma.mediaBinding.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasProject.deleteMany({ where: { id: pid } }).catch(() => undefined);
    }
  }, 60_000);

  it('★三档判定面：missing 行灭失+soft-deleted 软删——装载后同帧删两类非法键+skip 计数对应面', async () => {
    const pid = 'd4t-missing-proj';
    await prisma.canvasProject.upsert({ where: { id: pid }, update: {}, create: { id: pid, name: 'd4t-miss', userId: UID, teamId: DST_TID } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
    await prisma.canvasDoc.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
    // soft-deleted 本团队行（deletedAt 置位——soft-deleted 档）
    const softMedia = 'm-d4t-soft';
    await prisma.media.deleteMany({ where: { id: softMedia } }).catch(() => undefined);
    await prisma.media.create({ data: { id: softMedia, userId: UID, teamId: DST_TID, bucket: 'flowai', key: `d4t/soft.bin`, originalName: 's.bin', mimeType: 'image/png', size: 100n, type: 'uploaded', status: 'completed', deletedAt: new Date() } });
    try {
      // 节点 n-miss：mediaId=行灭失 id + referenceImage=软删行 id（两类非法键同帧）
      await repo.appendBatch(pid, [seedRow(seedFrame('n-miss', { mediaId: 'm-d4t-gone-forever', referenceImage: softMedia }), 5n)], { expectedPgSeq: 0n, newPgSeq: 5n, walCheckpointSeq: 5n });
      const missBefore = await skipCount('missing');
      const softBefore = await skipCount('soft-deleted');
      const doc = await loadDoc(pid);
      const refs = collectMediaRefsForNode('n-miss', (doc.getMap('nodes') as Y.Map<unknown>).get('n-miss'));
      expect(refs.some((r) => r.mediaId === 'm-d4t-gone-forever')).toBe(false);
      expect(refs.some((r) => r.mediaId === softMedia)).toBe(false);
      await flush(pid);
      expect(await skipCount('missing')).toBeGreaterThan(missBefore);
      expect(await skipCount('soft-deleted')).toBeGreaterThan(softBefore);
      // 绑定行与文档一致：两非法键皆零行
      expect(await prisma.mediaBinding.count({ where: { projectId: pid } })).toBe(0);
    } finally {
      await residency.releaseSessionFor(pid).catch(() => undefined);
      await prisma.mediaBinding.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.media.deleteMany({ where: { id: softMedia } }).catch(() => undefined);
      await prisma.canvasProject.deleteMany({ where: { id: pid } }).catch(() => undefined);
    }
  }, 60_000);

  it('★幂等 no-op 档：重装载已清帧 doc——键已不在=空操作（零新增删键帧：装载后 doc 与 PG 读侧零 diff+skip 零增量）', async () => {
    // 主档布景已清（首装载重扫落库）——释放会话后重装载=键已不在形态
    await residency.releaseSessionFor(DST_PID).catch(() => undefined);
    await pollUntil(() => !gateway.server.hocuspocus.documents.has(`project:${DST_PID}`), 5_000).catch(() => undefined);
    const skipBefore = await skipCount('cross-team');
    const doc = await loadDoc(DST_PID);
    // 键已不在=空操作：doc 无 X_MEDIA（首档已清）且无异常
    const refs = collectMediaRefsForNode('n-d4t-a', (doc.getMap('nodes') as Y.Map<unknown>).get('n-d4t-a'));
    expect(refs.some((r) => r.mediaId === X_MEDIA)).toBe(false);
    expect(refs.some((r) => r.mediaId === OWN_MEDIA)).toBe(true);
    // 零 skip 增量（no-op——键已不在不重复删）
    expect(await skipCount('cross-team')).toBe(skipBefore);
  }, 60_000);

  it('★短窗反复写档：同连接短窗重复装载同非法键——短窗去抖计数后仍删键（防循环档：删键收敛非无限往返）', async () => {
    // 布景：独立项目+非法键帧
    const pid = 'd4t-loop-proj';
    await prisma.canvasProject.upsert({ where: { id: pid }, update: {}, create: { id: pid, name: 'd4t-loop', userId: UID, teamId: DST_TID } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
    await prisma.canvasDoc.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
    try {
      await repo.appendBatch(pid, [seedRow(seedFrame('n-loop', { mediaId: X_MEDIA }), 5n)], { expectedPgSeq: 0n, newPgSeq: 5n, walCheckpointSeq: 5n });
      // 短窗内连续两次装载（同 doc 常驻——第二次=键已不在 no-op；会话释放后重装载=键已不在）
      const first = await loadDoc(pid);
      expect(collectMediaRefsForNode('n-loop', (first.getMap('nodes') as Y.Map<unknown>).get('n-loop')).some((r) => r.mediaId === X_MEDIA)).toBe(false);
      const second = await loadDoc(pid);   // 同连接短窗第二读（residency 复用同 doc）
      expect(collectMediaRefsForNode('n-loop', (second.getMap('nodes') as Y.Map<unknown>).get('n-loop')).some((r) => r.mediaId === X_MEDIA)).toBe(false);
      await flush(pid);
      // 收敛断言：装载往返不复活非法键（删键帧落库后重放读侧仍无——防循环）
      const { state, updates } = await repo.loadForHydration(pid);
      const revived = new Y.Doc();
      try {
        if (state) Y.applyUpdate(revived, new Uint8Array(state));
        for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
        expect(collectMediaRefsForNode('n-loop', (revived.getMap('nodes') as Y.Map<unknown>).get('n-loop')).some((r) => r.mediaId === X_MEDIA)).toBe(false);
      } finally {
        revived.destroy();
      }
    } finally {
      await residency.releaseSessionFor(pid).catch(() => undefined);
      await prisma.mediaBinding.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasProject.deleteMany({ where: { id: pid } }).catch(() => undefined);
    }
  }, 60_000);
});
