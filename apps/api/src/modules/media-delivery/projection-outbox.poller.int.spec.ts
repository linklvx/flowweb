// apps/api/src/modules/media-delivery/projection-outbox.poller.int.spec.ts
// Y1a+Y1b T15（plan v11.2 片 S4 主交付卡；spec Z18''④/:91 v14）：ArtifactProjection 投影 poller
// 真双端证明（真 PG+真 doc 会话+真 CollabLease CAS）——先红（ProjectionOutboxPoller/deliverArtifact
// 全仓不存在=编译级红锚，T14 flushDocument int spec 同源纪律；fileParallelism=false 单行资源串行）。
// 红锚面：
//  - CollabLease fencing（v11.1①：claim 捕获 epoch→循环全程比对；非 holder claim 后 withSession/
//    flush 被拒不耗 attempts——滚动部署/双开复现）；
//  - 投影循环全序（claim SKIP LOCKED→读 NodeArtifact rev≠→superseded→deliverArtifact〔T32：内容等值 fast path 退役〕→
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
import { RuntimeFeedService } from '../collab/runtime-feed.service';
import { CollabLifecycleObserverService } from '../collab/collab-lifecycle-observer.service';
import { CollabLeaseService } from '../collab/collab-lease.service';
import { CollabSpoolService } from '../collab/collab-spool.service';
import { spoolForTest } from '../../test-utils/erasure-fixtures';
import { CanvasDocUpdateRepository } from '../collab/canvas-doc-update.repository';
import { collabFlushDocumentOutcomeTotal } from '../collab/store.metrics';
import { ProjectionOutboxPoller, PROJECTION_MAX_ATTEMPTS } from './projection-outbox.poller';
import { artifactProjectionOutcomeTotal } from './projection-outbox.metrics';
import { ensureProjectFixture, cleanupProjectFixture, restoreLeaseRow, FIXTURE_USER, FIXTURE_TEAM } from '../../test-utils/db-fixtures';
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
let feedSvc: RuntimeFeedService;   // Y3 T3：作废终态单写面（poller 第 6 依赖——真 feed）
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
  // Y1c T22：ACTIVE fence 播种（deliverArtifact 交付放行前提——T26 观察器同构行；无行=unregistered 拒档）
  await prisma.nodeLifecycle.create({ data: { projectId: pid, nodeId, lifecycleSeq: 1n, isCurrent: true, state: 'ACTIVE', walSeq: 0n } }).catch(() => {});
  await prisma.deliveryFence.create({ data: { projectId: pid, nodeId, fenceSeq: 1n, state: 'ACTIVE' } }).catch(() => {});
}

interface SeedOpts {
  mediaId?: string | null;
  resultText?: string | null;
  targetField?: 'mediaId' | 'result';
  rev?: number;
  projectionRev?: number;
  attempts?: number;
  state?: 'pending' | 'dead' | 'orphaned' | 'superseded';
  sourceIntentRowId?: string | null;
}

/** NodeArtifact+ArtifactProjection 成对落行（slot 唯一键=targetItemId ''）。 */
async function seedArtifact(pid: string, nodeId: string, opts: SeedOpts = {}): Promise<{ artifactId: string; projectionId: string }> {
  const targetField = opts.targetField ?? 'mediaId';
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
  await prisma.nodeLifecycle.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.deliveryFence.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.runtimeEvent.deleteMany({ where: { projectId: pid } }).catch(() => {});
  await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: pid } }).catch(() => {});
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
    const spool = spoolForTest(spoolDir);
    const perm = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 'y0a-fixture-team' }),
    };
    const port = 0;   // TD-32/C3 T23：ephemeral（构造期 0；本文件不建客户端 URL）
    lease = new CollabLeaseService(prisma as any, repo, spool);   // 真 lease（epoch 语义红锚面）
    gateway = new CollabGateway(
      prisma as any, new EventEmitter2() as any, repo, lease,
      perm as any, port, DEBOUNCE_MS, undefined, undefined, spool,
    );
    await gateway.onModuleInit();   // 真 CAS 获取→serving（listenCollab 真起）
    expect(lease.isServing()).toBe(true);
    residency = new CollabResidencyService(gateway);
    // Y1c T22（G5 切交付）：deliverArtifact 改 PG 写——真 RuntimeFeedService+真 lifecycle observer
    // （fence 权威=deliveryFenceCheckInTx；node 无 fence 行=unregistered fail-closed 拒档=orphaned 流）
    feedSvc = new RuntimeFeedService(prisma as any);   // Y3 T3：poller 作废终态单写面（真 feed——行级事务）
    const observer = new CollabLifecycleObserverService(prisma as any);
    docSvc = new CollabDocumentService(gateway, repo, residency, feedSvc, observer);
  }, 60_000);

  afterAll(async () => {
    for (const pid of residency?.residentProjectIds() ?? []) await residency.releaseSessionFor(pid).catch(() => {});
    lease?.halt();
    await lease?.release().catch(() => {});
    // Y1c T10：直调 onApplicationShutdown（真关停链——shuttingDown 置位=卸载 drain 豁免窗+destroy
    // 4s race 兜底）；裸 server.destroy() 在卸载拒绝（applied 未 drain）时永不 resolve=hook 30s 超时。
    await gateway?.onApplicationShutdown().catch(() => {});
    await rm(spoolDir, { recursive: true, force: true }).catch(() => {});
    await restoreLeaseRow(prisma);
    await prisma.$disconnect();
  }, 60_000);

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
    poller = new ProjectionOutboxPoller(prisma as any, lease, docSvc, teamCredit, reconciler, feedSvc);
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
    // Y1c T22（切交付）：交付=RuntimeEvent（exec.artifact 携 mediaId+exec.status done——feed 新权威）；
    // doc 零写（不变量⑦——data.fileId 不落+exec map 恒空）
    const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID }, orderBy: { feedSeq: 'asc' } });
    expect(events.map((e) => e.kind)).toEqual(['exec.artifact', 'exec.status']);
    expect((events[0].payload as any).mediaId).toBe('m-happy');
    expect((events[1].payload as any).status).toBe('done');
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON().fileId).toBeUndefined();
    expect(revived.getMap('exec').get('n1')).toBeUndefined();
    expect(await outcomeOf('projected')).toBe(projectedBefore + 1);
    // 复 tick 幂等：projected 终态不再 claim
    const again = await poller.tick();
    expect(again.claimed).toBe(0);
    await teardownProject(PID);
  }, 60_000);

  it('Y1c T32：doc 等值 fast path 退役——doc data.fileId 预置同值仍走 deliverArtifact（幂等=feed 事件 (nodeId,artifactRev) 唯一性）+零 doc 写+exec 恒空', async () => {
    const PID = 't15-proj-fast';
    await seedProject(PID);
    await seedNode(PID, 'n1', { fileId: 'm-fast' });   // 预置等值（T32 前=fast path 跳写判据；T32 后=无效载荷——照走交付事务）
    const { projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-fast' });
    const summary = await poller.tick();
    expect(summary.outcomes.projected ?? 0).toBeGreaterThan(0);
    expect((await projectionRow(projectionId))?.state).toBe('projected');
    const revived = await reviveFromPg(PID);
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-fast');   // doc 值不变（零 doc 写——值自预置）
    expect(revived.getMap('exec').get('n1')).toBeUndefined();   // exec 恒空（doc.exec 停写——T22 起常量）
    expect(await prisma.runtimeEvent.count({ where: { projectId: PID, kind: 'exec.artifact' } })).toBe(1);   // 交付=恰一事件（新权威）
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
    // T25 收口 I-5：unregistered 档独立 surfaced——投影行 lastError 携分档（'node-deleted:fence-unregistered'）
    expect(row?.lastError).toContain('node-deleted:fence-unregistered');
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
    expect((await prisma.runtimeEvent.findFirst({ where: { projectId: PID, kind: 'exec.artifact' } }))?.payload).toMatchObject({ nodeId: 'n-undo', mediaId: 'm-reopen' });   // T22：交付=feed 事件
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
        targetField: 'mediaId', targetItemId: '', state: 'dead', attempts: 99,
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
    expect((await prisma.runtimeEvent.findFirst({ where: { projectId: PID, kind: 'exec.artifact' } }))?.payload).toMatchObject({ nodeId: 'n1', mediaId: 'm-fence2' });   // T22：交付=feed 事件
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
    expect((await prisma.runtimeEvent.findFirst({ where: { projectId: PID, kind: 'exec.artifact' } }))?.payload).toMatchObject({ nodeId: 'n1', mediaId: 'm-spool' });   // T22：交付=feed 事件
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
    expect((revived.getMap('nodes').get('n1') as Y.Map<any>).get('data').toJSON().fileId).toBeUndefined();   // T22：apply=feed 事件零 doc 写——mark 按 recheck 判 superseded（事件已落）
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
    expect(await prisma.runtimeEvent.count({ where: { projectId: PID, kind: 'exec.artifact' } })).toBe(2);   // T22：交付=feed 事件（两节点两事件）
    await teardownProject(PID);
  }, 60_000);

  it('双 poller 恰一（SKIP LOCKED+runId CAS）：两实例并发 tick 同一行 ⇒ 恰一 claim 恰一交付', async () => {
    const PID = 't15-proj-dual';
    await seedProject(PID);
    await seedNode(PID, 'n1');
    const { projectionId } = await seedArtifact(PID, 'n1', { mediaId: 'm-dual' });
    const teamCredit: any = { rollbackDeliveryFailed: vi.fn(async () => true) };
    const reconcilerB: any = { requestReconcile: vi.fn() };   // T16 post-apply 触发桩
    const pollerB = new ProjectionOutboxPoller(prisma as any, lease, docSvc, teamCredit, reconcilerB, feedSvc);
    const [a, b] = await Promise.all([poller.tick(), pollerB.tick()]);
    expect(a.claimed + b.claimed).toBe(1);   // SKIP LOCKED——并发双 claim 恰一
    expect((await projectionRow(projectionId))?.state).toBe('projected');
    expect(await prisma.runtimeEvent.count({ where: { projectId: PID, kind: 'exec.artifact' } })).toBe(1);   // T22：恰一次交付=恰一事件（幂等前置吸收复投）
    await teardownProject(PID);
  }, 60_000);

  it('clear 域（P2-⑥ 钉 null 写语义）：mediaId=null ⇒ data.fileId 落 null（web 消费面 null≡缺失等值——旧链删键退役）→projected；已 null 行复投=fast path（null 等值判据）', async () => {
    const PID = 't15-proj-clear';
    await seedProject(PID);
    await seedNode(PID, 'n-clear1', { fileId: 'm-old', content: 'seed' });   // 清空前形态（fileId 有旧值）
    await seedNode(PID, 'n-clear2', { fileId: null });                       // 已 null 形态（undo/复投窗）
    const a = await seedArtifact(PID, 'n-clear1', { mediaId: null });        // clear 命令行的投影形态（state=stored 夹具默认无害——判据=mediaId）
    await seedArtifact(PID, 'n-clear2', { mediaId: null });
    const summary = await poller.tick();
    expect(summary.outcomes.projected ?? 0).toBe(2);   // Y1c T32：等值判据退役——null 复投照走交付事务（fast-path 标签消亡）
    expect((await projectionRow(a.projectionId))?.state).toBe('projected');
    const revivedClear = await reviveFromPg(PID);
    expect((revivedClear.getMap('nodes').get('n-clear1') as Y.Map<any>).get('data').toJSON().fileId).toBe('m-old');   // T22：doc 零写——clear 语义=feed 事件（无 mediaId 键）非 data 落 null（P2-⑥ 钉 null 写随 doc 写面退役）
    expect((await prisma.runtimeEvent.findFirst({ where: { projectId: PID, kind: 'exec.artifact' } }))?.payload).not.toHaveProperty('mediaId');
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
    expect((revived.getMap('nodes').get('n-text') as Y.Map<any>).get('data').toJSON().result).toBeUndefined();   // T22：doc 零写
    const textEvents = await prisma.runtimeEvent.findMany({ where: { projectId: PID }, orderBy: { feedSeq: 'asc' } });
    expect((textEvents[0]?.payload as any).resultRef).toBe('生成文本产物');   // result 域=resultRef 引用（事件面）
    expect((textEvents[1]?.payload as any).status).toBe('done');
    await teardownProject(PID);
  }, 60_000);

  // ══════════ Y3 Task3⑫：作废终态 poller 单写（v3.0 七步——先红）══════════
  //  processProject ② 段读 NodeArtifact 之前按 `author-void:` 前缀岔开（键解析 ^author-void:(.+):(\d+)$）
  //  不进 deliverable/flushDocument 批次、不被兄弟行 flush 失败卷进 fencedBail；事务前 assertWriteAdmitted
  //  （租约/spool 不可写=作废行 fencedBail 回 pending）；每行单独 appendEventTransaction——
  //  ①再查 epoch ②CanvasProject FOR SHARE ③投影行 FOR UPDATE（串行锁）④锁后按 nodeId+作废键 execSeq+
  //  status=done 查重（命中只跳插入仍标 projected）⑤键读 GenerationIntent（execSeq=键末段非行上现值；
  //  行没了 attempts 0+不写 intentId）⑥行标 projected WHERE id 非 runId CAS（runId CAS 失败只打日志）
  //  ⑦提交后 notifyProject；载荷走 assembleExecStatusPayload（无 fileId——不复用 execDonePatch）。
  describe('Y3 T3⑫：author-void 作废终态单写（v3.0 七步）', () => {
    /** 种作废票据行（author-void:<intentRowId>:<execSeq> 键——state pending）。幂等：先行清（前轮
     *  失败残留防御——GenerationIntent.execSeq 全局唯一/投影键唯一会撞）。 */
    const seedVoidTicket = async (pid: string, nodeId: string, intentRowId: string, execSeq: number, opts: { intentRow?: Record<string, unknown> | null } = {}) => {
      await prisma.generationIntent.deleteMany({ where: { id: intentRowId } }).catch(() => undefined);
      await prisma.artifactProjection.deleteMany({ where: { artifactId: `author-void:${intentRowId}:${execSeq}` } }).catch(() => undefined);
      const projection = await prisma.artifactProjection.create({
        data: {
          artifactId: `author-void:${intentRowId}:${execSeq}`, artifactRev: 0, projectId: pid, nodeId,
          targetField: 'mediaId', targetItemId: '', mediaId: null, resultText: null, state: 'pending', attempts: 0,
        },
      });
      let intentId: string | undefined;
      if (opts.intentRow !== null) {
        const intent = await prisma.generationIntent.create({
          data: {
            id: intentRowId, projectId: pid, nodeId, userId: FIXTURE_USER, teamId: FIXTURE_TEAM,
            intentId: `ivk-${intentRowId}`, kind: 'image', paramsHash: `h-${intentRowId}`, status: 'SUCCEEDED',
            creditCost: 1, creditsConsumed: 1, attempts: 2, execSeq: BigInt(execSeq),
            heartbeatAt: new Date(), deadlineAt: new Date(), idemKey: `idem-${intentRowId}`,
            authorSlotFrozen: false, authorSlotReleased: false,
            ...(opts.intentRow ?? {}),
          },
        });
        intentId = intent.intentId;
      }
      return { projectionId: projection.id, intentId };
    };

    it('主链：作废票据 pending→恰一条 exec.status done（intentId=行 intentId 列/execSeq=作废键末段/attempts=行值/error 键不在）+零 exec.artifact+行变 projected+settle 行数不变；重跑幂等（仍一条事件+行仍 projected）', async () => {
      const PID = 'y3t3-void-main';
      await seedProject(PID);
      await seedNode(PID, 'n-void-main');
      const { projectionId, intentId } = await seedVoidTicket(PID, 'n-void-main', 'iv-row-main', 7);
      const settleBefore = await prisma.teamCreditTransaction.count();
      const summary = await poller.tick();
      expect(summary.outcomes.projected ?? 0).toBeGreaterThan(0);   // 作废行也走 projected 标记（无 exec.artifact 事件）
      const row = await projectionRow(projectionId);
      expect(row?.state).toBe('projected');   // 行标 projected（出站票据收敛）
      // 恰一条 exec.status done——零 exec.artifact 事件（作废无产物交付面）
      const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID }, orderBy: { feedSeq: 'asc' } });
      expect(events.map((e) => e.kind)).toEqual(['exec.status']);   // 无 exec.artifact
      const payload = events[0]!.payload as Record<string, unknown>;
      expect(payload.status).toBe('done');
      expect(payload.intentId).toBe(intentId);   // 行 intentId 列（键读行）
      expect(payload.execSeq).toBe('7');          // 作废键末段
      expect(payload.attempts).toBe(2);           // 行值
      expect('error' in payload).toBe(false);
      expect('fileId' in payload).toBe(false);    // 载荷无 fileId 键（不复用 execDonePatch）
      // settle 结算行数不变（作废票不触资金——settle 在 finalize 已核销）
      expect(await prisma.teamCreditTransaction.count()).toBe(settleBefore);
      // 重跑幂等：仍只有一条事件且行仍标 projected（查重命中只跳插入不漏标）
      const again = await poller.tick();
      expect(again.claimed).toBe(0);   // projected 终态不再 claim
      expect(await prisma.runtimeEvent.count({ where: { projectId: PID } })).toBe(1);
      expect((await projectionRow(projectionId))?.state).toBe('projected');
      await teardownProject(PID);
      await prisma.generationIntent.deleteMany({ where: { id: 'iv-row-main' } }).catch(() => {});
    }, 60_000);

    it('CanvasProject 灭失 ⇒ 零事件行标 orphaned（不用 flush deletedProjects——判据行非争用行）', async () => {
      const PID = 'y3t3-void-gone';
      await seedProject(PID);
      const { projectionId } = await seedVoidTicket(PID, 'n-void-gone', 'iv-row-gone', 3, { intentRow: null });
      await cleanupProjectFixture(prisma, PID);   // 删 CanvasProject（行灭失——判据行不在）
      const summary = await poller.tick();
      expect(summary.outcomes.orphaned ?? 0).toBeGreaterThan(0);
      expect((await projectionRow(projectionId))?.state).toBe('orphaned');
      expect(await prisma.runtimeEvent.count({ where: { projectId: PID } })).toBe(0);   // 零事件
      await prisma.artifactProjection.deleteMany({ where: { projectId: PID } }).catch(() => {});
      await prisma.generationIntent.deleteMany({ where: { id: 'iv-row-gone' } }).catch(() => {});
    }, 60_000);

    it('CanvasProject lifecycleState≠ACTIVE ⇒ 零事件行标 orphaned', async () => {
      const PID = 'y3t3-void-deleting';
      await seedProject(PID);
      const { projectionId } = await seedVoidTicket(PID, 'n-void-del', 'iv-row-del', 3, { intentRow: null });
      await prisma.canvasProject.update({ where: { id: PID }, data: { lifecycleState: 'DELETING' } });
      const summary = await poller.tick();
      expect(summary.outcomes.orphaned ?? 0).toBeGreaterThan(0);
      expect((await projectionRow(projectionId))?.state).toBe('orphaned');
      expect(await prisma.runtimeEvent.count({ where: { projectId: PID } })).toBe(0);
      await teardownProject(PID);
      await prisma.generationIntent.deleteMany({ where: { id: 'iv-row-del' } }).catch(() => {});
    }, 60_000);

    it('fence 未注册/fence-stale 档照写 done（作废分支不参与 fence——node 删后照写收口）', async () => {
      const PID = 'y3t3-void-nofence';
      await seedProject(PID);
      // n-void-nf 不种 fence/nodeLifecycle 行（seedNode 会种——这里手工种 node 只为可读性：作废分支不查 fence）
      await prisma.artifactProjection.deleteMany({ where: { projectId: PID } }).catch(() => {});
      const { projectionId, intentId } = await seedVoidTicket(PID, 'n-void-nf', 'iv-row-nf', 4);
      const summary = await poller.tick();
      expect(summary.outcomes.projected ?? 0).toBeGreaterThan(0);
      expect((await projectionRow(projectionId))?.state).toBe('projected');
      const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID } });
      expect(events).toHaveLength(1);
      expect((events[0]!.payload as Record<string, unknown>).intentId).toBe(intentId);   // 照写（fence 不参与分支）
      await teardownProject(PID);
      await prisma.generationIntent.deleteMany({ where: { id: 'iv-row-nf' } }).catch(() => {});
    }, 60_000);

    it('assertWriteAdmitted 拒（租约失守）⇒ 作废行 fencedBail 回 pending 零事件（不耗 attempts）', async () => {
      const PID = 'y3t3-void-fenced';
      await seedProject(PID);
      const { projectionId } = await seedVoidTicket(PID, 'n-void-fenced', 'iv-row-fenced', 5);
      // 注入：claim 已捕获 epoch 后、七步事务前租约失守——作废分支事务前 assertWriteAdmitted 拒
      // （epoch 已动窗内一切错误按失守处置）。作废行不触 deliverArtifact（注入面=appendEventTransaction）。
      const realAppendTx = feedSvc.appendEventTransaction.bind(feedSvc);
      vi.spyOn(feedSvc, 'appendEventTransaction').mockImplementation(async (projectId: string, body: any) => {
        await lease.release();   // 事务前失守（owner NULL+epoch null ⇒ assertWriteAdmitted 503）
        return realAppendTx(projectId, body);
      });
      const summary = await poller.tick();
      expect(summary.fenced).toBe(true);
      const row = await projectionRow(projectionId);
      expect(row?.state).toBe('pending');   // fencedBail 回 pending
      expect(row?.attempts).toBe(0);       // 不耗 attempts
      expect(await prisma.runtimeEvent.count({ where: { projectId: PID } })).toBe(0);   // 零事件
      await ensureLeaseHeld();
      vi.restoreAllMocks();
      // 租约复得后收敛（重 claim→七步写达）
      await pollUntil(async () => {
        await poller.tick();
        return (await projectionRow(projectionId))?.state === 'projected';
      }, 15_000, 500);
      await teardownProject(PID);
      await prisma.generationIntent.deleteMany({ where: { id: 'iv-row-fenced' } }).catch(() => {});
    }, 60_000);

    it('并发双 poller 同作废行 ⇒ 恰一条事件（查重在投影行锁后——TOCTOU 负控）', async () => {
      const PID = 'y3t3-void-dual';
      await seedProject(PID);
      const { projectionId } = await seedVoidTicket(PID, 'n-void-dual', 'iv-row-dual', 6);
      const teamCreditB: any = { rollbackDeliveryFailed: vi.fn(async () => true) };
      const reconcilerB: any = { requestReconcile: vi.fn() };
      const pollerB = new ProjectionOutboxPoller(prisma as any, lease, docSvc, teamCreditB, reconcilerB, feedSvc);
      const [a, b] = await Promise.all([poller.tick(), pollerB.tick()]);
      expect(a.claimed + b.claimed).toBe(1);   // SKIP LOCKED——恰一 claim
      expect((await projectionRow(projectionId))?.state).toBe('projected');
      expect(await prisma.runtimeEvent.count({ where: { projectId: PID } })).toBe(1);   // 恰一事件（行锁后查重吸收）
      await teardownProject(PID);
      await prisma.generationIntent.deleteMany({ where: { id: 'iv-row-dual' } }).catch(() => {});
    }, 60_000);

    it('行没了（intent 灭失）：日志+attempts 0+不写 intentId+execSeq 仍用键值照写（作废键自持身份）', async () => {
      const PID = 'y3t3-void-rowless';
      await seedProject(PID);
      const { projectionId } = await seedVoidTicket(PID, 'n-void-rowless', 'iv-row-rl', 11, { intentRow: null });
      const summary = await poller.tick();
      expect(summary.outcomes.projected ?? 0).toBeGreaterThan(0);
      expect((await projectionRow(projectionId))?.state).toBe('projected');
      const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID } });
      expect(events).toHaveLength(1);
      const payload = events[0]!.payload as Record<string, unknown>;
      expect(payload.status).toBe('done');
      expect(payload.execSeq).toBe('11');   // 键末段照写
      expect('intentId' in payload).toBe(false);   // 行没了不写 intentId
      expect(payload.attempts).toBe(0);
      await teardownProject(PID);
      await prisma.generationIntent.deleteMany({ where: { id: 'iv-row-rl' } }).catch(() => {});
    }, 60_000);

    it('rearm 换代负控：作废票 pending 期间同节点 rearm ⇒ 票不被 supersedeProjections 灭+poller 写出的 done execSeq=旧代键值', async () => {
      const PID = 'y3t3-void-rearm';
      await seedProject(PID);
      // 作废票：键 execSeq=3（旧代）
      const { projectionId } = await seedVoidTicket(PID, 'n-void-rearm', 'iv-row-rearm', 3);
      // 同节点旧代投影行（rearm 的 supersedeProjections 谓词消费者——author-void 前缀排除后票据不灭）
      // 真链验证：走 supersedeProjections（GenerationIntentService 直构——真库 claim rearm 换代）
      const intentSvc = new (await import('../execution/generation-intent.service')).GenerationIntentService(
        prisma as any,
        { voidInTx: async () => undefined, settleInTx: async () => ({ success: true, settled: true }), void_: async () => undefined, settle: async () => undefined, reserve: async () => undefined } as any,
        new (await import('../artifact-core/node-artifact.service')).NodeArtifactService(),
      );
      // rearm：FAILED 行同键 claim（真库链——新代 execSeq=nextval）
      await prisma.generationIntent.update({ where: { id: 'iv-row-rearm' }, data: { status: 'FAILED' } });
      const rule = await prisma.pricingRule.findFirst({ where: { active: true } });
      await intentSvc.claim({
        projectId: PID, nodeId: 'n-void-rearm', userId: FIXTURE_USER, gestureToken: `y3-${Date.now()}`,
        kind: 'image', paramsHash: `h-rearm-${Date.now()}`, teamId: FIXTURE_TEAM,
        pricing: { pricingRuleId: rule!.id, modelId: null, resolutionId: null, durationId: null, creditCost: 0 },
        authorSlotFrozen: false, authorMediaId: null,
      }).catch(() => undefined);   // 允许 NodeBusy 等（不相关——本用例只观察票据存活）
      const row = await projectionRow(projectionId);
      expect(row?.state).toBe('pending');   // 红：旧谓词会灭 pending 作废票据（superseded）
      // poller 写出的 done：execSeq=作废键末段（旧代 3——非行上新代）
      const summary = await poller.tick();
      expect(summary.outcomes.projected ?? 0).toBeGreaterThan(0);
      const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID } });
      const done = events.find((e) => (e.payload as Record<string, unknown>).execSeq === '3');
      expect(done).toBeTruthy();   // 旧代键值写出（mergeSlot 挡它盖新代 loading）
      await teardownProject(PID);
      await prisma.generationIntent.deleteMany({ where: { projectId: PID } }).catch(() => {});
    }, 60_000);
  });
});
