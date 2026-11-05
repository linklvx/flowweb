// apps/api/src/modules/collab/retention.sweeper.poller.int.spec.ts
// C1-1（plan Task C1-1 红④⑤⑥——真 PG）：advisory 单飞双 worker 并发（pg_try_advisory_xact_lock
// 同键第二取锁者必然失败→skip+计数）+1000 行积压多 tick 排空（claim ≤50 FOR UPDATE SKIP LOCKED
// 批界）+kill -9 续跑幂等（claim/void CAS 键语义——批后即断言续跑收敛）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { register } from 'prom-client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionRequestRetentionService, RETENTION_REQUEST_CLAIM_BATCH } from '../execution/execution-request.retention.service';
import { RuntimeFeedRetentionService } from './runtime-feed.retention.service';
import { RetentionSweeperPoller } from './retention.sweeper.poller';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { TeamCreditService } from '../team/team-credit.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();
const prismaB = new PrismaClient();   // 红④ 第二实例（双 worker 并发）

const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const credit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const requestRetention = new ExecutionRequestRetentionService(prisma as unknown as PrismaService, credit);
const feedRetention = new RuntimeFeedRetentionService(prisma as unknown as PrismaService);
const poller = new RetentionSweeperPoller(prisma as unknown as PrismaService, requestRetention, feedRetention);

const PID = `int-c11-sweep-${Date.now()}`;
const UID = `int-c11-sweep-owner-${Date.now()}`;
const N_BACKLOG = 1000;
const reqIds: string[] = [];
let TID = '';

const metricValue = async (name: string, labels: Record<string, string> = {}): Promise<number> => {
  const m = (await register.getMetricsAsJSON()).find((x) => x.name === name) as
    { values: { labels: Record<string, string>; value: number }[] } | undefined;
  return m?.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val))?.value ?? 0;
};

const expiredAdmitted = (ids: readonly string[]) =>
  prisma.executionRequest.count({ where: { id: { in: [...ids] }, state: 'ADMITTED' } });

(hasDb ? describe : describe.skip)('C1-1 红④⑤⑥：RetentionSweeperPoller（真 PG）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: UID }, create: { id: UID, name: UID, email: `${UID}@test.local`, emailVerified: false }, update: {} });
    const team = await prisma.team.create({ data: { name: `int-c11-sweep-${Date.now()}`, ownerId: UID } });
    TID = team.id;
    await prisma.canvasProject.create({ data: { id: PID, name: PID, teamId: TID, userId: UID } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
  }, 20_000);

  afterAll(async () => {
    await prisma.executionRequest.deleteMany({ where: { id: { in: reqIds } } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    if (TID) await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
    await prismaB.$disconnect();
  }, 20_000);

  it('红④：双 worker 并发 tick 单飞——第二实例 advisory 锁失败 ⇒ skip+计数+零删；锁释放后下一 tick ok', async () => {
    const skipBefore = await metricValue('retention_sweeper_tick_total', { result: 'skip-singleflight' });
    // worker A：独立连接（prismaB）事务内取同键锁（阻塞形态）——lockTaken 门同步「已持锁」再开 worker B
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let lockTaken!: () => void;
    const lockTakenGate = new Promise<void>((r) => (lockTaken = r));
    const holder = prismaB.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flowweb:retention'))`;
      lockTaken();
      await gate;
    });
    try {
      await lockTakenGate;   // A 已持锁（xact 域——事务提交即释放）
      // worker B（poller——prisma）：tick 事务首句 pg_try_advisory_xact_lock 同键 ⇒ 必然失败
      await poller.tick();
      expect(await metricValue('retention_sweeper_tick_total', { result: 'skip-singleflight' })).toBeGreaterThan(skipBefore);
    } finally {
      release();   // 失败路径也必释放（否则 xact 锁悬挂 → 后续 tick 恒 skip 的级联红）
      await holder;
    }
    // 锁已释放（A 事务提交=xact 锁自动释放）⇒ 下一 tick 正常取锁（红④ 单飞互斥的可重入半边）
    const okBefore = await metricValue('retention_sweeper_tick_total', { result: 'ok' });
    await poller.tick();
    expect(await metricValue('retention_sweeper_tick_total', { result: 'ok' })).toBeGreaterThan(okBefore);
  });

  it('红⑤：1000 行过期积压 ⇒ 首 tick 恰 claim ≤50（批界）+多 tick 排空 +backlog gauge 按需 count', async () => {
    // 积压播种：1000 行 ADMITTED∧expiresAt 过期（reservedCredit 0——void 批轻载；reserved>0 面
    // 已在 execution-request.retention.int.spec 红② 覆盖）
    const chunk = 250;
    for (let i = 0; i < N_BACKLOG / chunk; i += 1) {
      const batch = Array.from({ length: chunk }, () => {
        const id = randomUUID();
        reqIds.push(id);
        return {
          id, requestId: `req-${id}`, projectId: PID, generation: 0, historyId: 'int-c11-sweep-history',
          docSeq: 0n, frozenDocSeq: 0n, userId: UID, teamId: TID, kind: 'text', state: 'ADMITTED',
          reservedCredit: 0, totalCredit: 0, planHash: 'a'.repeat(64), inputHash: 'b'.repeat(64),
          expiresAt: new Date(Date.now() - 1000),
        };
      });
      await prisma.executionRequest.createMany({ data: batch });
    }
    expect(await expiredAdmitted(reqIds)).toBe(N_BACKLOG);

    // 首 tick：claim 批界恰 ≤50（红⑤ 小批断言——积压 1000 行只动 50）
    await poller.tick();
    const afterFirst = await expiredAdmitted(reqIds);
    expect(N_BACKLOG - afterFirst).toBe(RETENTION_REQUEST_CLAIM_BATCH);   // 恰 50（批上界即批实绩）
    expect(await prisma.executionRequest.count({ where: { id: { in: reqIds }, state: 'VOIDED' } })).toBe(RETENTION_REQUEST_CLAIM_BATCH);

    // 多 tick 排空（poller 间隔驱动——int 直连循环收敛；上界=1000/50+余量）
    let ticks = 1;
    for (; ticks < 40 && await expiredAdmitted(reqIds) > 0; ticks += 1) {
      await poller.tick();
    }
    expect(await expiredAdmitted(reqIds)).toBe(0);   // 排空
    expect(ticks).toBeGreaterThanOrEqual(N_BACKLOG / RETENTION_REQUEST_CLAIM_BATCH);   // ≥20 tick（多 tick 断言）
    const voided = await prisma.executionRequest.count({ where: { id: { in: reqIds }, state: 'VOIDED' } });
    expect(voided).toBe(N_BACKLOG);   // 全员 VOIDED（无丢失/无双计）

    // backlog gauge：排空后 claim 不满批 ⇒ 回零
    expect(await metricValue('retention_backlog_rows', { table: 'execution_request' })).toBe(0);
  });

  it('红⑥：kill -9 续跑幂等——排空后追加 tick 零新 void/零状态漂移（claim/void CAS 键语义）', async () => {
    const voidedBefore = await prisma.executionRequest.count({ where: { id: { in: reqIds }, state: 'VOIDED' } });
    const metricVoidBefore = await metricValue('retention_void_total');
    // 模拟 kill -9 后重启续跑（进程态零持久——DB 行状态即全部）：续跑 3 tick
    for (let i = 0; i < 3; i += 1) await poller.tick();
    expect(await prisma.executionRequest.count({ where: { id: { in: reqIds }, state: 'VOIDED' } })).toBe(voidedBefore);   // 零新 void
    expect(await prisma.executionRequest.count({ where: { id: { in: reqIds }, state: 'ADMITTED' } })).toBe(0);            // 无复活
    expect(await metricValue('retention_void_total')).toBe(metricVoidBefore);   // 计数面同步零增（CAS 让位不计）
    // 资金面：reservedCredit 全零（void 批已收口——release 台账 idempotencyKey 幂等键语义见 team-credit 既有面）
    const reserved = await prisma.executionRequest.aggregate({ _sum: { reservedCredit: true }, where: { id: { in: reqIds } } });
    expect(reserved._sum.reservedCredit ?? 0).toBe(0);
  });
});