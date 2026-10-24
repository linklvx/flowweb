// apps/api/src/modules/media-delivery/projection-outbox.poller.int.spec.ts
// Y1a+Y1b T15（plan v11.2 片 S4 主交付卡；spec Z18''④/:91 v14）：ArtifactProjection 投影 poller
// 真双端证明（真 PG+真 doc 会话+真 CollabLease CAS）——先红（ProjectionOutboxPoller/deliverArtifact
// 全仓不存在=编译级红锚，T14 flushDocument int spec 同源纪律；fileParallelism=false 单行资源串行）。
// 红锚面：
//  - CollabLease fencing（v11.1①：claim 捕获 epoch→循环全程比对；非 holder claim 后 withSession/
//    flush 被拒不耗 attempts——滚动部署/双开复现）；
//  - 投影循环全序（claim SKIP LOCKED→读 NodeArtifact rev≠→superseded→内容等值 fast path→
//    withSession apply〔deliverArtifact 复合 op：data.{fileId|result}+exec done〕→批尾 typed flush
//    →逐行 recheck rev→一致才 projected）；
//  - 六终态（node 删→orphaned 不重试+幂等退款/replace 新代→superseded/耗尽→dead/undo 恢复→
//    orphaned 可 re-open）；
//  - spool 不耗 attempts（G58：retry/spooled 无限重试永不判死）+批按 project 一次 flush。
// 装置：真 CollabLeaseService（真 CAS/epoch 换代）+真 gateway（真 doc 会话/residency/persistence）
// ——write-endpoint int spec 邻近复用形态（lease 换真实例——epoch 语义是本卡红锚面）。
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollabGateway } from '../collab/collab.gateway';
import { CollabResidencyService } from '../collab/collab-residency.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { CollabLeaseService } from '../collab/collab-lease.service';
import { CollabSpoolService } from '../collab/collab-spool.service';
import { CanvasDocUpdateRepository } from '../collab/canvas-doc-update.repository';
import { collabFlushDocumentOutcomeTotal } from '../collab/store.metrics';
import { ProjectionOutboxPoller, PROJECTION_MAX_ATTEMPTS } from './projection-outbox.poller';
import { artifactProjectionOutcomeTotal } from './projection-outbox.metrics';
import { ensureProjectFixture, cleanupProjectFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { pollUntil } from '../../test-utils/poll-until';

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const DEBOUNCE_MS = 10_000;

const outcomeOf = async (outcome: string): Promise<number> =>
  (await (artifactProjectionOutcomeTotal as any).get()).values.find((v: any) => v.labels.outcome === outcome)?.value ?? 0;
const flushOutcomeOf = async (outcome: string): Promise<number> =>
  (await (collabFlushDocumentOutcomeTotal as any).get()).values.find((v: any) => v.labels.outcome === outcome)?.value ?? 0;

let prisma: PrismaClient;
let repo: CanvasDocUpdateRepository;
let gateway: CollabGateway;
let residency: CollabResidencyService;
let docSvc: CollabDocumentService;
let lease: CollabLeaseService;
let spoolDir: string;
let poller: ProjectionOutboxPoller;
/** 退款 stub（orphaned 幂等退款断言面——资金链全真归 deliver-refund int spec）。 */
let refundCalls: Array<{ intentRowId: string; reason: string }>;

/** PG 行装载重放（「写达 PG」的读侧——Z144 装置）。 */
async function reviveFromPg(pid: string): Promise<Y.Doc> {
  const { state, updates } = await repo.loadForHydration(pid);
  const revived = new Y.Doc();
  if (state) Y.applyUpdate(revived, new Uint8Array(state));
  for (const u of updates) Y.applyUpdate(revived, new Uint8Array(u));
  return revived;
}

async function seedProject(pid: string): Promise<void> {
  await ensureProjectFixture(prisma, pid);
  await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
  await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
  await prisma.artifactProjection.deleteMany({ where: { projectId: pid } });
  await prisma.nodeArtifact.deleteMany({ where: { projectId: pid } });
}

/** doc 种节点（data 键值可指定——fast path 判别锚）。 */
async function seedNode(pid: string, nodeId: string, data: Record<string, unknown> = { content: 'seed' }): Promise<void> {
  await residency.withSession(pid, (doc) => {
    const n = new Y.Map();
    n.set('data', new Y.Map(Object.entries(data)));
    doc.getMap('nodes').set(nodeId, n);
  }, { mode: 'write' });
}

interface SeedOpts {
  mediaId?: string | null;
  resultText?: string | null;
  targetField?: 'fileId' | 'result';
  rev?: number;
  projectionRev?: number;
  attempts?: number;
  state?: 'pending' | 'dead' | 'orphaned' | 'superseded';
  sourceIntentRowId?: string | null;
}

/** NodeArtifact+ArtifactProjection 成对落行（slot 唯一键=targetItemId ''）。 */
async function seedArtifact(pid: string, nodeId: string, opts: SeedOpts = {}): Promise<{ artifactId: string; projectionId: string }> {
  const targetField = opts.targetField ?? 'fileId';
  const artifact = await prisma.nodeArtifact.create({
    data: {
      projectId: pid, nodeId, teamId: 'y0a-fixture-team', role: 'primary', targetField, targetItemId: '',
      mediaId: opts.mediaId ?? null, resultText: opts.resultText ?? null,
      source: 'generated', sourceIntentRowId: opts.sourceIntentRowId ?? null, state: 'stored',
      rev: opts.rev ?? 1,
    },
  });
  const projection = await prisma.artifactProjection.create({
    data: {
      artifactId: artifact.id, artifactRev: opts.projectionRev ?? artifact.rev, projectId: pid, nodeId,
      targetField, targetItemId: '', mediaId: opts.mediaId ?? null, resultText: opts.resultText ?? null,
      state: opts.state ?? 'pending', attempts: opts.attempts ?? 0,
    },
  });
  return { artifactId: artifact.id, projectionId: projection.id };
}

const projectionRow = (id: string) => prisma.artifactProjection.findUnique({ where: { id } });

/** ArtifactProjection/NodeArtifact 无 project FK——显式清（cleanupProjectFixture 只清 canvas 链）。 */
async function teardownProject(pid: string): Promise<void> {
  await prisma.artifactProjection.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.nodeArtifact.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await cleanupProjectFixture(prisma, pid);
}

d('T15 ArtifactProjection 投影 poller（真双端：六终态+fencing+fast path+批 flush）', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as any);
    await restoreLeaseRow(prisma as any);   // 清残留 fixture owner——首获 WHERE owner IS NULL 可达
    // 卫生扫：他文件 int 残留 pending/projecting 行会使全局 claim 断言失真（claimed 恰一/批数）——
    // int 纪律本要求各文件自清，此扫为确定性兜底（无 FK 不能靠 cascade）。
    await prisma.artifactProjection.deleteMany({ where: { state: { in: ['pending', 'projecting'] } } }).catch(() => {});
    spoolDir = await mkdtemp(join(tmpdir(), 't15-proj-int-'));
    const spool = new CollabSpoolService(spoolDir);
    const perm = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 'y0a-fixture-team' }),
    };
    const port = 20000 + Math.floor(Math.random() * 20000);
    lease = new CollabLeaseService(prisma as any, repo, spool);   // 真 lease（epoch 语义红锚面）
    gateway = new CollabGateway(
      prisma as any, new EventEmitter2() as any, repo, lease,
      perm as any, port, DEBOUNCE_MS, undefined, undefined, spool,
    );
    await gateway.onModuleInit();   // 真 CAS 获取→serving（listenCollab 真起）
    expect(lease.isServing()).toBe(true);
    residency = new CollabResidencyService(gateway);
    docSvc = new CollabDocumentService(gateway, repo, residency);
  }, 60_000);

  afterAll(async () => {
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid).catch(() => {});
    lease?.halt();
    await lease?.release().catch(() => {});
    await (gateway as any)?.server.destroy().catch(() => {});
    await rm(spoolDir, { recursive: true, force: true }).catch(() => {});
    await restoreLeaseRow(prisma);
    await prisma.$disconnect();
  }, 30_000);

  beforeEach(() => {
    refundCalls = [];
    const teamCredit: any = {
      rollbackDeliveryFailed: vi.fn(async (intentRowId: string, reason: string) => {
        refundCalls.push({ intentRowId, reason });
        return true;
      }),
    };
    // T16：post-apply 触发桩（requestReconcile 仅入队——int 用例不驱动 reconcile drain）
    const reconciler: any = { requestReconcile: vi.fn() };
    poller = new ProjectionOutboxPoller(prisma as any, lease, docSvc, teamCredit, reconciler);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  /** 释放后复得（换代 epoch+1）——fenced 用例后复原装置。 */
  async function ensureLeaseHeld(): Promise<void> {
    if (!lease.isServing()) expect(await lease.tryAcquireFast()).toBe(true);
  }

  it('happy path：claim→apply（deliverArtifact 复合 op）→flush persisted→recheck 一致→projected；doc data.fileId+exec done 落 PG canonical', async () => {
    const PID = 't15-proj-happy';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    const { projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-happy', sourceIntentRowId: null });
    const projectedBefore = await outcomeOf('projected');
    const summary = await poller.tick();
    expect(summary.claimed).toBe(1);
    expect(summary.outcomes.projected ?? 0).toBeGreaterThan(0);
    const row = await projectionRow(projectionId);
    expect(row?.state).toBe('projected');
    expect(row?.projectedAt).not.toBeNull();
    expect(row?.attempts).toBe(0);
    // doc 终态（PG canonical——投影 poller 是 fileId 唯一交付写者）
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-happy');
    expect((revived.getMap('exec').get('n1') as Y.Map<any>).toJSON().status).toBe('done');
    expect(await outcomeOf('projected')).toBe(projectedBefore + 1);
    // 复 tick 幂等：projected 终态不再 claim
    const again = await poller.tick();
    expect(again.claimed).toBe(0);
    await teardownProject(PID);
  }, 60_000);

  it('内容等值 fast path：doc data.fileId==artifact.mediaId ⇒ 跳 apply（exec 无 done 条目）直接 flush+projected', async () => {
    const PID = 't15-proj-fast';
    await seedProject(PID);
    await seedNode(PID, 'n1', { fileId: 'm-fast' });   // 预置等值（裁决 :53：非权威判据——fast path 专用）
    const { projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-fast' });
    const fastBefore = await outcomeOf('fast-path');
    const summary = await poller.tick();
    expect(summary.outcomes['fast-path'] ?? 0).toBeGreaterThan(0);
    expect((await projectionRow(projectionId))?.state).toBe('projected');
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-fast');
    expect(revived.getMap('exec').get('n1')).toBeUndefined();   // apply 跳过——exec done 不写（fast path 判别锚）
    expect(await outcomeOf('fast-path')).toBe(fastBefore + 1);
    await teardownProject(PID);
  }, 60_000);

  it('superseded（用户 replace+新代）：NodeArtifact.rev≠投影行 artifactRev ⇒ superseded 终态不重试零 doc 写', async () => {
    const PID = 't15-proj-sup';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    // 种子批先落 PG（判别前提：n1 在 canonical——superseded 零写断言才可判）
    expect(await docSvc.flushDocument(PID, lease.currentEpoch())).toEqual({ kind: 'persisted' });
    const { projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-old', rev: 2, projectionRev: 1 });   // 投影锚旧代
    const summary = await poller.tick();
    expect(summary.outcomes.superseded ?? 0).toBeGreaterThan(0);
    expect((await projectionRow(projectionId))?.state).toBe('superseded');
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON()).toEqual({ content: 'seed' });   // 零 doc 写（无 fileId）
    expect((await projectionRow(projectionId))?.attempts).toBe(0);
    await teardownProject(PID);
  }, 60_000);

  it('orphaned（node 删除）：apply written:false=node-deleted 权威观察点 ⇒ orphaned 终态不重试+幂等退款（资金锚）', async () => {
    const PID = 't15-proj-orphan';
    await seedProject(PID);
    await seedNode(PID, 'n-keep');
    // n-gone 不种——apply 存在性守卫 written:false node-deleted（谁观察 node 删除的权威观察点=投影 apply）
    const { projectionId } = await seedArtifact(PID, 'n-gone', { mediaId: 'm-orphan', sourceIntentRowId: 'ir-t15-orphan' });
    const summary = await poller.tick();
    expect(summary.outcomes.orphaned ?? 0).toBeGreaterThan(0);
    const row = await projectionRow(projectionId);
    expect(row?.state).toBe('orphaned');
    expect(refundCalls).toEqual([{ intentRowId: 'ir-t15-orphan', reason: expect.stringContaining('node-deleted') }]);
    // 终态不重试：复 tick 零 claim 该行
    const again = await poller.tick();
    expect(again.claimed).toBe(0);
    await teardownProject(PID);
  }, 60_000);

  it('undo 恢复节点→orphaned 行可 re-open（admin retry）：orphaned→pending→tick→projected', async () => {
    const PID = 't15-proj-reopen';
    await seedProject(PID);
    const { projectionId } = await seedArtifact(PID, 'n-undo', { mediaId: 'm-reopen', state: 'orphaned' });
    // undo 恢复：节点回来了
    await seedNode(PID, 'n-undo');
    const reopened = await poller.retryProjection(projectionId);
    expect(reopened.requeued).toBe(true);
    expect((await projectionRow(projectionId))?.state).toBe('pending');
    const summary = await poller.tick();
    expect(summary.outcomes.projected ?? 0).toBeGreaterThan(0);
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n-undo') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-reopen');
    await teardownProject(PID);
  }, 60_000);

  it('dead（真 apply 失败耗尽）：非 fenced apply 失败计数→attempts≥MAX ⇒ dead+告警计数', async () => {
    const PID = 't15-proj-dead';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    const { projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-dead', attempts: PROJECTION_MAX_ATTEMPTS - 1 });
    // 注入真 apply 失败（非 fenced——epoch 未动）：deliverArtifact 抛非租约错误
    vi.spyOn(docSvc, 'deliverArtifact').mockRejectedValue(new Error('injected apply boom'));
    const deadBefore = await outcomeOf('dead');
    const summary = await poller.tick();
    expect(summary.outcomes.dead ?? 0).toBeGreaterThan(0);
    const row = await projectionRow(projectionId);
    expect(row?.state).toBe('dead');
    expect(row?.attempts).toBe(PROJECTION_MAX_ATTEMPTS);
    expect(row?.lastError).toContain('injected apply boom');
    expect(await outcomeOf('dead')).toBe(deadBefore + 1);
    await teardownProject(PID);
  }, 60_000);

  it('dead 行 on-load reconcile：requeueDeadOnLoad 重驱近期 dead 行→pending→tick→projected（远期不重驱）', async () => {
    const PID = 't15-proj-onload';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    const recent = await seedArtifact(PID, 'n1', { mediaId: 'm-onload', state: 'dead', attempts: 99 });
    const stale = await prisma.artifactProjection.create({
      data: {
        artifactId: recent.artifactId, artifactRev: 999, projectId: PID, nodeId: 'n1',
        targetField: 'fileId', targetItemId: '', state: 'dead', attempts: 99,
        createdAt: new Date(Date.now() - 90 * 24 * 3600_000),   // 远期（窗外）
      },
    });
    const requeued = await poller.requeueDeadOnLoad();
    expect(requeued).toBeGreaterThanOrEqual(1);
    expect((await projectionRow(recent.projectionId))?.state).toBe('pending');
    expect((await projectionRow(stale.id))?.state).toBe('dead');   // 窗外不重驱
    const summary = await poller.tick();
    expect(summary.outcomes.projected ?? 0).toBeGreaterThan(0);
    expect((await projectionRow(recent.projectionId))?.state).toBe('projected');
    await teardownProject(PID);
  }, 60_000);

  it('fencing（epoch 易主@apply）：claim 后失守→withSession 503 ⇒ fenced 不耗 attempts（行回 pending）', async () => {
    const PID = 't15-proj-fence-apply';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    const { projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-fence' });
    // 注入滚动部署/双开形态：apply 时点失守（release=owner NULL+epoch 缓存 null）+503
    vi.spyOn(docSvc, 'deliverArtifact').mockImplementation(async () => {
      await lease.release();   // 注入滚动部署/双开形态：apply 时点失守（owner NULL+epoch 缓存 null）+503
      const { ServiceUnavailableException } = await import('@nestjs/common');
      throw new ServiceUnavailableException('collab not serving (lease not held)');
    });
    const summary = await poller.tick();
    expect(summary.fenced).toBe(true);
    const row = await projectionRow(projectionId);
    expect(row?.state).toBe('pending');
    expect(row?.attempts).toBe(0);   // 红：朴素实现把 503 当失败耗 attempts
    await ensureLeaseHeld();
    // 租约复得后正常收敛（releaseRows 退避〔3s poll 间隔〕后重 claim——tick 循环驱动至终态）
    vi.restoreAllMocks();
    await pollUntil(async () => {
      await poller.tick();
      return (await projectionRow(projectionId))?.state === 'projected';
    }, 15_000, 500);
    await teardownProject(PID);
  }, 60_000);

  it('fencing（epoch 易主@flush）：apply 落 doc 后失守→flushDocument terminal/fenced ⇒ 行回 pending 不耗 attempts', async () => {
    const PID = 't15-proj-fence-flush';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    const { projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-fence2' });
    const real = docSvc.deliverArtifact.bind(docSvc);
    vi.spyOn(docSvc, 'deliverArtifact').mockImplementation(async (...args: Parameters<typeof real>) => {
      const r = await real(...args);          // apply 先落 doc（pending 队列批）
      await lease.release();                  // flush 前失守（epoch=null）
      return r;
    });
    const summary = await poller.tick();
    expect(summary.fenced).toBe(true);
    const row = await projectionRow(projectionId);
    expect(row?.state).toBe('pending');
    expect(row?.attempts).toBe(0);
    await ensureLeaseHeld();
    vi.restoreAllMocks();
    // 复得后收敛（doc 批随下次 flush 落 PG——退避后重 claim，tick 循环驱动至终态）
    await pollUntil(async () => {
      await poller.tick();
      return (await projectionRow(projectionId))?.state === 'projected';
    }, 15_000, 500);
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-fence2');
    await teardownProject(PID);
  }, 60_000);

  it('spool 不耗 attempts（G58）：PG 故障→批落真 spool（fsync）⇒ retry/spooled 无限重试 attempts 不动；恢复后回灌→projected', async () => {
    const PID = 't15-proj-spooled';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    const { projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-spool' });
    const spy = vi.spyOn(repo, 'appendBatch').mockRejectedValue(new Error('injected pg down'));
    const summary = await poller.tick();
    expect(summary.outcomes['retry-spooled'] ?? 0).toBeGreaterThan(0);
    const row = await projectionRow(projectionId);
    expect(row?.state).toBe('pending');
    expect(row?.attempts).toBe(0);   // G58：spooled≠delivered 也≠失败——磁盘安全帧永不耗 attempts
    spy.mockRestore();   // PG 恢复——下轮 claim 回灌 spool 帧（退避 2s 后——tick 循环驱动）
    await pollUntil(async () => {
      const s = await poller.tick();
      return s.claimed > 0 && (await projectionRow(projectionId))?.state === 'projected';
    }, 15_000, 500);
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-spool');
    await teardownProject(PID);
  }, 60_000);

  it('recheck rev（flush 后复核）：apply+flush persisted 后 artifact rev 又进 ⇒ superseded 非 projected', async () => {
    const PID = 't15-proj-recheck';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    const { artifactId, projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-recheck' });
    // flush 窗注入用户 replace（rev 进）：flush 期间换代
    const realFlush = docSvc.flushDocument.bind(docSvc);
    vi.spyOn(docSvc, 'flushDocument').mockImplementation(async (...args: Parameters<typeof realFlush>) => {
      await prisma.nodeArtifact.update({ where: { id: artifactId }, data: { rev: 2, mediaId: 'm-user-replaced', source: 'replace' } });
      return realFlush(...args);
    });
    const summary = await poller.tick();
    expect(summary.outcomes.superseded ?? 0).toBeGreaterThan(0);
    expect((await projectionRow(projectionId))?.state).toBe('superseded');   // rev 又进——一致才 projected 的反例
    // 用户值不被投影覆盖：doc 仍无 m-recheck（m-user-replaced 属新代投影行——不在本测试面）
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-recheck');   // 本代 apply 已落（写在前）——mark 按 recheck 判 superseded
    await teardownProject(PID);
  }, 60_000);

  it('批按 project 一次 flush：同 project 两行（两节点）一次 tick ⇒ 两次 apply 恰一次 flushDocument persisted', async () => {
    const PID = 't15-proj-batch';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    await seedNode(PID, 'n2');
    await seedArtifact(PID, 'n1', { mediaId: 'm-b1' });
    await seedArtifact(PID, 'n2', { mediaId: 'm-b2' });
    const persistedBefore = await flushOutcomeOf('persisted');
    const summary = await poller.tick();
    expect(summary.claimed).toBe(2);
    expect(summary.outcomes.projected ?? 0).toBeGreaterThanOrEqual(2);
    expect(await flushOutcomeOf('persisted')).toBe(persistedBefore + 1);   // 批按 project 分组——恰一次 flush
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-b1');
    expect((revived.getMap('nodes').get('n2') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-b2');
    await teardownProject(PID);
  }, 60_000);

  it('双 poller 恰一（SKIP LOCKED+runId CAS）：两实例并发 tick 同一行 ⇒ 恰一 claim 恰一交付', async () => {
    const PID = 't15-proj-dual';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    const { projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-dual' });
    const teamCredit: any = { rollbackDeliveryFailed: vi.fn(async () => true) };
    const reconcilerB: any = { requestReconcile: vi.fn() };   // T16 post-apply 触发桩
    const pollerB = new ProjectionOutboxPoller(prisma as any, lease, docSvc, teamCredit, reconcilerB);
    const [a, b] = await Promise.all([poller.tick(), pollerB.tick()]);
    expect(a.claimed + b.claimed).toBe(1);   // SKIP LOCKED——并发双 claim 恰一
    expect((await projectionRow(projectionId))?.state).toBe('projected');
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-dual');   // 恰一次交付
    await teardownProject(PID);
  }, 60_000);

  it('clear 域（P2-⑥ 钉 null 写语义）：mediaId=null ⇒ data.fileId 落 null（web 消费面 null≡缺失等值——旧链删键退役）→projected；已 null 行复投=fast path（null 等值判据）', async () => {
    const PID = 't15-proj-clear';
    await seedProject(PID);
    await seedNode(PID, 'n-clear1', { fileId: 'm-old', content: 'seed' });   // 清空前形态（fileId 有旧值）
    await seedNode(PID, 'n-clear2', { fileId: null });                       // 已 null 形态（undo/复投窗）
    const a = await seedArtifact(PID, 'n-clear1', { mediaId: null });        // clear 命令行的投影形态（state=stored 夹具默认无害——判据=mediaId）
    await seedArtifact(PID, 'n-clear2', { mediaId: null });
    const fastBefore = await outcomeOf('fast-path');
    const summary = await poller.tick();
    expect(summary.outcomes.projected ?? 0).toBeGreaterThan(0);
    expect(summary.outcomes['fast-path'] ?? 0).toBeGreaterThan(0);   // n-clear2：null===null 等值——跳 apply
    expect((await projectionRow(a.projectionId))?.state).toBe('projected');
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n-clear1') as Y.Map<any>).get('data').toJSON().fileId).toBe(null);   // null 写（非删键）
    expect((revived.getMap('nodes').get('n-clear2') as Y.Map<any>).get('data').toJSON().fileId).toBe(null);
    expect(await outcomeOf('fast-path')).toBe(fastBefore + 1);
    await teardownProject(PID);
  }, 60_000);

  it('text 域（targetField=result）：deliverArtifact 写 data.result+exec done→projected', async () => {
    const PID = 't15-proj-text';
    await seedProject(PID);
    await seedNode(PID, 'n-text');
    const { projectionId } = await seedArtifact(PID, 'n-text', { targetField: 'result', resultText: '生成文本产物' });
    const summary = await poller.tick();
    expect(summary.outcomes.projected ?? 0).toBeGreaterThan(0);
    expect((await projectionRow(projectionId))?.state).toBe('projected');
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n-text') as Y.Map<any>).get('data').toJSON().result).toBe('生成文本产物');
    expect((revived.getMap('exec').get('n-text') as Y.Map<any>).toJSON().status).toBe('done');
    await teardownProject(PID);
  }, 60_000);
});
