// apps/api/src/modules/media-delivery/media-gc.shadow.c3b5.int.spec.ts
// C3b-5 → 卡② K8（spec 2026-11-16-collab-closing-bag §1.5）：**删除判决面红测**（真 PG——vitest.int
// 串行）。shadow 双轨已退役（旧面/预算门/skip-mismatch-stale 三指标/受控 rebuild/回滚开关随删）——
// 在役锚（删旧面后的替代保护证人=isMediaReferenced 三臂：registry∪Binding∪Oracle）：
//  ①registry 臂（GC）：LightingTask.resultMediaId 引用→阻断保留（旧面盲区形态——决策面=三臂单源）；
//  ④大团队超时保守保留（GC 全链形态——C3b-4a ⑦同族）：barrier prepare bail-out（flush-timeout）
//    →全队候选回 ACTIVE 释放持有+valve-bailout 桶保守保留（禁删）；
//  ⑤全链（真 barrier）+安全钉：doc-only 引用（fileId 帧——无 binding）经 prepare（六步序+decision
//    snapshot）→oracle 臂证人→保留；引用消+重扫→放行删除（消费面切换 E2E：GC→barrier→snapshot→
//    并集→删除序）；同 fixture 直调 isMediaReferenced=true 断言（旧面退役后的替代保护证人钉死）；
//  ⑦registry 臂（erasure）：GenerationIntent.resultRef@他项目→detach 保留（旧 erasure 面盲区形态）；
//  ⑧erasure barrier bail-out：删除拍 prepare bail-out→pending-review 保守不删（恢复后收敛）；
//  ⑨(P1-1) erasure release→行删竞窗：批删事务内逐 id in-tx recheck 终裁拦下+下轮漂移释放 detach；
//  ⑩(Minor-1) GC 逐候选预算自查：删除事务跨 expiresAt 后未处理尾段保守保留出循环（已处理段不回卷）；
//  ⊆契约（限 UUID 形态 id）：collectMediaRefs 投影产出 ⊆ scanUuidLeaves 过滤出的 Media id——
//    两算法不同地面（词表投影 vs 全容器 UUID 叶整串正则+JOIN Media），UUID id 结构性成立；非 UUID
//    id（dev 种子）=oracle 已知漏采面由 Binding 臂兜底（oracle-worker 头注自书——不限则必红无解）。
// barrier=真 DeletionBarrierService（stub actor flush——GC 测试无在飞帧，真收敛判据=snapshot CAS 复读）
// ∥stub port（④⑧ bail-out 形态注入）；erasure=stub port（真 barrier 全链归 deletion-barrier.int.spec）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from '../collab/canvas-doc-update.repository';
import { OracleWorkerService } from '../collab/oracle-worker.service';
import { DeletionBarrierService } from '../collab/deletion-barrier.service';
import { DirectDeletionBarrierPort, DeletionBarrierPort } from '../collab/deletion-barrier.port';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ErasureContextService, lockProject } from '../collab/project-lock';
import { ProjectErasureRunPoller } from '../collab/project-erasure.poller';
import { openProjectErasure } from '../collab/project-erasure';
import { executePurgingDbStage } from '../collab/project-erasure.stages';
import { collectMediaRefs, CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';   // Y2 C1：sv 布景常量化
import { toDocLike } from '../collab/doc-like.util';
import { scanUuidLeaves } from '../collab/oracle-worker.service';
import { MediaReferenceService } from '../collab/media-reference.service';
import { MediaGcService } from './media-gc.service';
import { mediaGcOutcomeTotal } from './binding-reconcile.metrics';
import { ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const stamp = Date.now().toString(36);
const UID = `c3b5-owner-${stamp}`;
const TID = `c3b5-gc-team-${stamp}`;      // GC 宇宙（P1 宿主/P2 他项目）
const ER_TID = `c3b5-er-team-${stamp}`;   // erasure 宇宙（PE 被擦/PO 他项目）
const P1 = `c3b5-gc-a-${stamp}`;
const P2 = `c3b5-gc-b-${stamp}`;
const PE = `c3b5-er-a-${stamp}`;
const PO = `c3b5-er-b-${stamp}`;
const GRACE_OLD = new Date(Date.now() - 8 * 24 * 3600_000);

const makeMinioStub = () => ({ delete: vi.fn(async () => undefined) }) as never;

/** 节点键（**逐帧唯一**：两独立帧同键=Y.Map 键 last-writer-wins 随 clientID 定胜负——败者 item
 *  在 doc 结构内但 map 迭代不可达=引用被静默遮蔽，红测假阴性根源）。 */
const nodeKeyOf = (fileId: string): string => `n-ref-${fileId.slice(0, 8)}`;

/** 单节点引用 mediaId 的全态帧（oracle 真扫载体——fileId 词形：collectMediaRefs 词表+UUID 叶双命中）。 */
function refFrame(fileId: string): Uint8Array {
  const doc = new Y.Doc();
  try {
    const node = new Y.Map<unknown>();
    const data = new Y.Map<unknown>();
    data.set('mediaId', fileId);
    node.set('type', 'imageGen');
    node.set('data', data);
    (doc.getMap('nodes') as Y.Map<unknown>).set(nodeKeyOf(fileId), node);
    return Y.encodeStateAsUpdate(doc);
  } finally { doc.destroy(); }
}

/** 删节点全态帧（先应用原帧再删——携带原 item ID 的 tombstone：独立 doc 的删帧对目标 doc 是
 *  异源 item 零效果，必须同源）。 */
function removeNodeFrame(orig: Uint8Array, fileId: string): Uint8Array {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(orig));
    (doc.getMap('nodes') as Y.Map<unknown>).delete(nodeKeyOf(fileId));
    return Y.encodeStateAsUpdate(doc);
  } finally { doc.destroy(); }
}

const emptyFrame = (): Uint8Array => Y.encodeStateAsUpdate(new Y.Doc());

maybe('C3b-5：消费面切换+shadow 对拍+回滚开关（真 PG）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const oracle = new OracleWorkerService(prisma as never, repo as never);
  /** actor flush stub（无在飞帧——appliedSeq=0 恒收敛；真收敛判据=snapshot CAS 复读 pgSeq）。 */
  const actorStub = { appliedSeqOf: () => 0n, flushThrough: async () => ({ targetReached: true, pgSeq: 0n }) } as never;
  const barrierSvc = new DeletionBarrierService(prisma as never, repo as never, actorStub);
  const realPort = new DirectDeletionBarrierPort(barrierSvc);
  let manifestDir: string;

  /** barrier 端口 stub（verified/bail-out 两档——④⑧ 注入形态）。 */
  const okBarrier = (): DeletionBarrierPort => ({
    prepare: async () => ({ outcome: 'verified', barrierId: `stub-${randomUUID()}`, projects: [], expiresAt: Date.now() + 60_000 }),
    release: async () => true,
  }) as unknown as DeletionBarrierPort;
  const bailBarrier = (): DeletionBarrierPort => ({
    prepare: async () => ({ outcome: 'bail-out', reason: 'flush-timeout' }),
    release: async () => true,
  }) as unknown as DeletionBarrierPort;

  const gcSweep = (port: DeletionBarrierPort) =>
    new MediaGcService(prismaService, makeMinioStub(), port).sweep();

  const seedMedia = async (over: Record<string, unknown> = {}) =>
    prisma.media.create({
      data: {
        userId: UID, teamId: TID, key: `c3b5/${randomUUID().slice(0, 8)}`,
        originalName: 'a.mp4', mimeType: 'video/mp4', size: 100, type: 'generated', status: 'completed',
        ...over,
      },
    });

  /** 残留 GC 候选清扫（共享 dev 库——跨文件残留软删行会混入 sweep 扰动精确 delta）。lte 含等号：
   *  前用例按 deletedAt=GRACE_OLD 字面种子的保留残留〔⑩ 尾段保守保留形态〕恰压等值线——lt 会漏扫
   *  （⑪ 实锚：混入第三候选致 deleted 计数漂移）。 */
  const purgeStrayCandidates = () => prisma.media.deleteMany({ where: { deletedAt: { lte: GRACE_OLD } } });

  const seedDoc = async (pid: string, frame: Uint8Array): Promise<void> => {
    await prisma.canvasDoc.create({ data: { projectId: pid, generation: 1, schemaVersion: CANVAS_DOC_SCHEMA_VERSION, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false } });
    await appendFrame(pid, frame);
    await expectOracleFresh(pid);
  };

  /** 追加帧+水位落定+oracle 重扫（union oracle 臂证人=决策级前提）。 */
  const appendFrame = async (pid: string, frame: Uint8Array): Promise<void> => {
    const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: pid }, select: { pgSeq: true } });
    const next = doc.pgSeq + 1n;
    const r = await repo.appendBatch(pid, [seedRow(frame, next)], { expectedPgSeq: doc.pgSeq, newPgSeq: next, walCheckpointSeq: next });
    expect(r).toEqual({ ok: true, rows: 1 });
    await prisma.canvasDoc.updateMany({ where: { projectId: pid }, data: { mediaBindingSeq: next, bindingsDirty: false } });
  };
  const expectOracleFresh = async (pid: string) => {
    const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: pid }, select: { pgSeq: true } });
    expect(await oracle.scanProject(pid)).toMatchObject({ outcome: 'complete', verifiedSeq: doc.pgSeq });
  };

  const metricOf = async (counter: unknown, labels: Record<string, string>): Promise<number> =>
    (await (counter as unknown as { get(): Promise<{ values: { labels: Record<string, string>; value: number }[] }> }).get())
      .values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val))?.value ?? 0;
  const valveOf = () => metricOf(mediaGcOutcomeTotal, { outcome: 'valve-bailout' });

  // ── erasure 装置（⑥⑦⑧——c4c1 同族：tombstone+poller tick+直调执行体；**每用例独立被擦项目**
  //    〔PURGING_OBJECTS 后项目行删除=不可复用〕）──
  const ledger = new CreditLedgerService(prismaService as never);
  const poller = new ProjectErasureRunPoller(prismaService as never, ledger as never, new ErasureContextService(), undefined, undefined, undefined, okBarrier());
  /** 每用例独立被擦项目（doc 建档+oracle 真扫——rebuild/对拍前提）。 */
  const erasureProjects: string[] = [];
  const seedErProject = async (suffix: string): Promise<string> => {
    const pid = `${PE}-${suffix}-${stamp}`;
    await prisma.canvasProject.create({ data: { id: pid, name: pid, userId: UID, teamId: ER_TID } });
    erasureProjects.push(pid);
    await seedDoc(pid, emptyFrame());
    return pid;
  };
  const seedErMedia = async (pid: string, suffix: string) =>
    prisma.media.create({
      data: { id: `${pid}-m-${suffix}`, userId: UID, teamId: ER_TID, projectId: pid, bucket: 'flowai', key: `${pid}/${suffix}.bin`, originalName: suffix, mimeType: 'application/octet-stream', size: 10n, type: 'generated' },
    });
  const tombstone = async (pid: string) => {
    await prisma.$transaction(async (tx) => {
      await lockProject(tx as never, pid);
      return openProjectErasure(tx as never, { projectId: pid, requestedBy: UID });
    });
  };

  beforeAll(async () => {
    manifestDir = mkdtempSync(join(tmpdir(), 'c3b5-manifest-'));
    process.env.ERASURE_MANIFEST_DIR = manifestDir;
    await purgeStrayCandidates();
    // 前次（崩溃）运行残留清扫：per-test 被擦项目的 run 行/项目行（僵尸 run 会占 tick 推进数——
    // manifest 目录已 rmSync=每 tick ENOENT 退避）。
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: { startsWith: 'c3b5-' } } });
    await prisma.canvasProject.deleteMany({ where: { id: { startsWith: 'c3b5-' } } });   // FK Cascade 清 doc/oracle
    await prisma.user.upsert({ where: { id: UID }, update: {}, create: { id: UID, name: 'c3b5', email: `${UID}@test.local`, emailVerified: false } });
    for (const [tid, projects] of [[TID, [P1, P2]], [ER_TID, [PE, PO]]] as const) {
      await prisma.team.create({ data: { id: tid, name: tid, ownerId: UID } });
      await prisma.teamMember.create({ data: { teamId: tid, userId: UID, role: 'OWNER' } });
      for (const pid of projects) await prisma.canvasProject.create({ data: { id: pid, name: pid, userId: UID, teamId: tid } });
    }
    await ensureLeaseFixture(prisma, repo);
    // 四项目 PG doc 建档（空帧）+oracle 真扫（union 证人/受控 rebuild 的 CanvasDoc 前提）
    for (const pid of [P1, P2, PE, PO]) await seedDoc(pid, emptyFrame());
  }, 120_000);

  afterAll(async () => {
    for (const pid of [P1, P2, PE, PO, ...erasureProjects]) {
      await prisma.canvasReferenceOracle.deleteMany({ where: { projectId: pid } });
      await prisma.canvasReferenceOracleScan.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: pid } });
      await prisma.canvasProject.deleteMany({ where: { id: pid } });
    }
    await prisma.deletionBarrier.deleteMany({ where: { teamId: { in: [TID, ER_TID] } } });
    await prisma.lightingTask.deleteMany({ where: { teamId: TID } });
    await prisma.generationIntent.deleteMany({ where: { projectId: PO } });
    await prisma.mediaBinding.deleteMany({ where: { teamId: { in: [TID, ER_TID] } } });
    await prisma.media.deleteMany({ where: { teamId: { in: [TID, ER_TID] } } });
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: { in: [PE, PO, ...erasureProjects] } } });
    for (const tid of [TID, ER_TID]) {
      await prisma.teamMember.deleteMany({ where: { teamId: tid } });
      await prisma.team.deleteMany({ where: { id: tid } });
    }
    await prisma.user.deleteMany({ where: { id: UID } });
    await restoreLeaseRow(prisma);
    rmSync(manifestDir, { recursive: true, force: true });
    delete process.env.ERASURE_MANIFEST_DIR;
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 120_000);

  it('①registry 臂（GC）：LightingTask.resultMediaId 引用→阻断保留（旧面盲区形态——三臂单源）', async () => {
    await purgeStrayCandidates();
    const m = await seedMedia({ deletedAt: GRACE_OLD });
    // LightingTask.resultMediaId=旧 GC 四源+doc 扫外引用（C3b-4 ②b 同形态）——registry 臂独有证人
    await prisma.lightingTask.create({ data: { userId: UID, nodeId: 'n-c3b5-1', projectId: P2, originalImageUrl: 'http://x/l.png', params: {}, resultMediaId: m.id, teamId: TID ,
} });
    const s = await gcSweep(realPort);
    expect(s.guarded).toBeGreaterThanOrEqual(1);          // 阻断保留（决策面=并集）
    expect(s.deleted).toBe(0);
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeTruthy();
    // 清理
    await prisma.lightingTask.deleteMany({ where: { resultMediaId: m.id } });
    await prisma.media.deleteMany({ where: { id: m.id } });
  }, 60_000);

  it('④大团队超时保守保留（GC 全链）：prepare bail-out→回 ACTIVE 释放持有+valve-bailout 桶+禁删', async () => {
    await purgeStrayCandidates();
    const valveBefore = await valveOf();
    const m1 = await seedMedia({ deletedAt: GRACE_OLD });
    const m2 = await seedMedia({ deletedAt: GRACE_OLD });
    const s = await gcSweep(bailBarrier());   // flush-timeout（预算耗尽形态——C3b-4a ⑦同族）
    expect(s.deleted).toBe(0);
    expect(s.guarded).toBeGreaterThanOrEqual(2);
    expect(s.conflicted).toBe(0);             // 非引用冲突=零 conflict 计数
    for (const id of [m1.id, m2.id]) {
      const row = await prisma.media.findUniqueOrThrow({ where: { id } });
      expect(row.deletionState).toBe('ACTIVE');   // 回 ACTIVE 释放持有（下轮任意 worker 重判）
      expect(row).toBeTruthy();
    }
    expect(await valveOf()).toBeGreaterThanOrEqual(valveBefore + 2);   // T19 桶：valve-bailout（扫描面/预算异常≠引用增长）
    await prisma.media.deleteMany({ where: { id: { in: [m1.id, m2.id] } } });
  }, 60_000);

  it('⑤全链（真 barrier）：doc-only 引用（fileId 帧无 binding）→保留；引消+重扫→放行删', async () => {
    await purgeStrayCandidates();
    const m = await seedMedia({ deletedAt: GRACE_OLD });
    const f = refFrame(m.id);
    await appendFrame(P1, f);      // doc 引用（无 binding 行——投影未建窗）
    await expectOracleFresh(P1);
    const s1 = await gcSweep(realPort);          // 真 barrier：prepare 六步序+snapshot verified→oracle 臂证人
    expect(s1.guarded).toBeGreaterThanOrEqual(1);
    expect(s1.deleted).toBe(0);
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeTruthy();
    // 引用消（tombstone 帧——同源 item ID）+oracle 重扫→放行
    await appendFrame(P1, removeNodeFrame(f, m.id));
    await expectOracleFresh(P1);
    const s2 = await gcSweep(realPort);
    expect(s2.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeNull();
  }, 90_000);

  it('⑦registry 臂（erasure）：GenerationIntent.resultRef@他项目（旧面盲区形态）→detach 保留', async () => {
    const pid = await seedErProject('b');
    const mMiss = await seedErMedia(pid, 'miss');
    await seedErMedia(pid, 'exc2');   // 独占伴行（驱动删除窗——sidecar 非空才进窗）
    // resultRef@PO=旧 erasure 引用图外列（spec §3.4-6 v5 入并集）——union registry 臂独有证人
    await prisma.generationIntent.create({
      data: {
        projectId: PO, nodeId: 'n-1', userId: UID, teamId: ER_TID, intentId: `it-c3b5-${stamp}`, kind: 'image',
        paramsHash: 'c3b5-hash', creditCost: 0, heartbeatAt: new Date(), deadlineAt: new Date(), idemKey: `idem-c3b5-${stamp}`, execSeq: 930001n, resultRef: mMiss.id,
      
        authorSlotFrozen: false,   // Y2 B1：NOT NULL 列（fixture 补列）
},
    });
    await tombstone(pid);
    await poller.tick();
    await poller.tick();
    const run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    const r = await executePurgingDbStage({
      prisma: prismaService, run, manifestDir,
      spoolDir: join(process.cwd(), '.data', 'collab-spool'), reviewWindowMs: 0, barrier: okBarrier(),
    });
    expect(r.outcome).toBe('purging-objects');
    const row = await prisma.media.findUniqueOrThrow({ where: { id: mMiss.id } });
    expect(row.projectId).toBeNull();   // 引用命中 detach 保留（旧面 resultRef 不进引用图——改前红=独占删）
  }, 90_000);

  it('⑧erasure barrier bail-out：删除窗 prepare bail-out→pending-review 保守不删（恢复后收敛）', async () => {
    const pid = await seedErProject('c');
    const mExc = await seedErMedia(pid, 'exc3');
    await tombstone(pid);
    await poller.tick();
    await poller.tick();   // 标记
    let run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    const r1 = await executePurgingDbStage({
      prisma: prismaService, run, manifestDir,
      spoolDir: join(process.cwd(), '.data', 'collab-spool'), reviewWindowMs: 0, barrier: bailBarrier(),
    });
    expect(r1).toMatchObject({ outcome: 'pending-review', remainingExclusive: 1 });   // 保守不删（下轮 tick 重试）
    expect(await prisma.media.findUnique({ where: { id: mExc.id } })).toBeTruthy();   // 行保留（复核窗/标记零破坏）
    run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    expect(run.state).toBe('PURGING_DB');
    // 恢复（barrier 复通）→收敛删除
    const r2 = await executePurgingDbStage({
      prisma: prismaService, run, manifestDir,
      spoolDir: join(process.cwd(), '.data', 'collab-spool'), reviewWindowMs: 0, barrier: okBarrier(),
    });
    expect(r2.outcome).toBe('purging-objects');
    expect(await prisma.media.findUnique({ where: { id: mExc.id } })).toBeNull();
  }, 90_000);

  it('⑨(P1-1) erasure release→行删竞窗：release 后新引用（投影照写）→in-tx recheck 拦下保留+下轮收敛 detach', async () => {
    const pid = await seedErProject('d');
    const mExc = await seedErMedia(pid, 'race');
    await tombstone(pid);
    await poller.tick();
    await poller.tick();   // 标记（sidecar=[mExc]）
    const run = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    // 竞窗注入：stub barrier 的 release 回调=fence 抬起后新投影 binding 落地形态（appendBatch 复通
    // →帧落定→binding 投影照写 DELETING 媒体——MediaBinding 无 mediaId FK=悬挂引用无 DB 兜底形态）。
    const raceBarrier: DeletionBarrierPort = {
      prepare: async () => ({ outcome: 'verified', barrierId: `stub-${randomUUID()}`, projects: [], expiresAt: Date.now() + 60_000 }),
      release: async () => {
        await prisma.mediaBinding.create({ data: { mediaId: mExc.id, projectId: PO, nodeId: 'n-p1-race', teamId: ER_TID, role: 'primary', targetField: 'mediaId', targetItemId: '' } });
        return true;
      },
    } as unknown as DeletionBarrierPort;
    const r = await executePurgingDbStage({
      prisma: prismaService, run, manifestDir,
      spoolDir: join(process.cwd(), '.data', 'collab-spool'), reviewWindowMs: 0, barrier: raceBarrier,
    });
    // 窗内算出删除集（竞窗注入在 release 后）→release→批删事务内逐 id recheck 终裁命中→中止保留
    expect(r).toMatchObject({ outcome: 'pending-review', remainingExclusive: 1 });   // 本 tick 不删（收敛下轮）
    const row = await prisma.media.findUniqueOrThrow({ where: { id: mExc.id } });
    expect(row.projectId).toBe(pid);            // 保留且仍挂起（误删=悬挂引用正中红锚——变异 if(false) 红）
    expect(row.deletionState).toBe('DELETING'); // claims 留持有（同 erasureId 幂等再持有面）
    // 下轮收敛：disposition 重判见新引用→复核集漂移释放+detach 保留
    const run2 = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeId: pid } });
    const r2 = await executePurgingDbStage({
      prisma: prismaService, run: run2, manifestDir,
      spoolDir: join(process.cwd(), '.data', 'collab-spool'), reviewWindowMs: 0, barrier: okBarrier(),
    });
    expect(r2.outcome).toBe('purging-objects');
    const row2 = await prisma.media.findUniqueOrThrow({ where: { id: mExc.id } });
    expect(row2.projectId).toBeNull();          // 新引用被尊重→detach 保留
    expect(row2.deletionState).toBe('ACTIVE');  // 漂移释放（conflict 路径）
  }, 90_000);

  it('⑩(Minor-1) GC 逐候选预算自查：删除事务跨 expiresAt→未处理尾段保守保留出循环（已处理段不回卷）', async () => {
    await purgeStrayCandidates();
    const m1 = await seedMedia({ deletedAt: new Date(GRACE_OLD.getTime() - 1_000) });   // deletedAt 序=确定处理序
    const m2 = await seedMedia({ deletedAt: GRACE_OLD });
    const slowMinio = () => ({ delete: vi.fn(async () => { await new Promise((res) => setTimeout(res, 1_200)); }) }) as never;
    const shortBarrier = (): DeletionBarrierPort => ({
      prepare: async () => ({ outcome: 'verified', barrierId: `stub-${randomUUID()}`, projects: [], expiresAt: Date.now() + 500 }),
      release: async () => true,
    }) as unknown as DeletionBarrierPort;
    const svc = new MediaGcService(prismaService, slowMinio(), shortBarrier());
    const s = await svc.sweep();
    expect(s.deleted).toBe(1);   // 首候选照删（其删除事务〔对象删 1.2s 慢桩〕跨 expiresAt 落定）
    expect(await prisma.media.findUnique({ where: { id: m1.id } })).toBeNull();
    const row2 = await prisma.media.findUniqueOrThrow({ where: { id: m2.id } });
    expect(row2.deletionState).toBe('ACTIVE');   // 未处理尾段：回 ACTIVE 释放持有+保守保留（下轮重判）
    expect(s.guarded).toBeGreaterThanOrEqual(1);
  }, 90_000);


  it('⑤补充安全钉（直调）：doc-only 引用（oracle 已扫+header 决策级）→isMediaReferenced=true 直调断言', async () => {
    await purgeStrayCandidates();
    const m = await seedMedia();
    const f = refFrame(m.id);
    await appendFrame(P1, f);      // doc 引用（无 binding 行——投影未建窗）
    await expectOracleFresh(P1);   // expectOracleFresh=包装 scanProject（oracle 已扫+决策级 header）
    const mediaRef = new MediaReferenceService(prismaService);
    expect(await mediaRef.isMediaReferenced(prisma, m.id, { teamId: TID })).toBe(true);   // oracle 臂=旧面退役后的替代保护证人
    await appendFrame(P1, removeNodeFrame(f, m.id));
    await expectOracleFresh(P1);
    expect(await mediaRef.isMediaReferenced(prisma, m.id, { teamId: TID })).toBe(false);  // 引消+重扫=证人消
    await prisma.media.deleteMany({ where: { id: m.id } });
  }, 90_000);

  it('⊆ 契约（限 UUID 形态 id）：collectMediaRefs 投影产出 ⊆ scanUuidLeaves 过滤出的 Media id', async () => {
    const m1 = await seedMedia();
    const m2 = await seedMedia();
    const updates = [refFrame(m1.id), refFrame(m2.id)];   // fileId=UUID 形态（DB @default(uuid())）
    // 投影臂：词表投影（collectMediaRefs——actor/binding-rebuild 单源同款）
    const doc = new Y.Doc();
    for (const u of updates) Y.applyUpdate(doc, new Uint8Array(u));
    const projection = new Set(collectMediaRefs(toDocLike(doc)).map((r) => r.mediaId));
    expect(projection.has(m1.id)).toBe(true);   // 非空证明（防 vacuous 绿）
    expect(projection.has(m2.id)).toBe(true);
    // oracle 臂：全容器 UUID 叶整串正则+JOIN Media（oracle-worker 同算法地面）
    const leaves = new Set(scanUuidLeaves(null, updates.map((u) => Buffer.from(u)), 5_000));
    const medias = new Set((await prisma.media.findMany({ where: { id: { in: [...leaves] } }, select: { id: true } })).map((r) => r.id));
    for (const id of projection) expect(medias.has(id), '投影 id ' + id + ' 须在 oracle 过滤集内（UUID 形态结构性成立——防 SCAN_ROOTS/遍历/正则回归）').toBe(true);
    await prisma.media.deleteMany({ where: { id: { in: [m1.id, m2.id] } } });
  }, 60_000);
});
