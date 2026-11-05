// apps/api/src/modules/execution/execution-request.retention.int.spec.ts
// C1-1（plan Task C1-1 红①②③——真 PG）：ExecutionRequest/ExecutionInput retention 扫面组。
// 红①：input 过期∧终态删+未过期/非终态零触碰（判别双档）+**终态重写口径**（受理 31 天后才终态
// →终态后 30d 才删——:449 受理写=now+30d 语义修正）；红②：stuck 计数（ADMITTED∧expiresAt/
// EXECUTING∧GenerationIntent MIN(deadlineAt)）告警不删+scope ACTIVE 零触碰；红③：FAILED→删 input
// →同 requestId replay→幂等返回原值**不读 input**（execution-request.service.ts 幂等前置面）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionRequestRetentionService } from './execution-request.retention.service';
import { ExecutionRequestService } from './execution-request.service';
import { ValidationService } from './validation.service';
import { TopologyService } from './topology.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { PricingResolverService } from './pricing-resolver.service';
import { CanvasDocUpdateRepository } from '../collab/canvas-doc-update.repository';
import { deleteTeamsWithPass, ledgerWipe } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();

const PID = `int-c11-req-${Date.now()}`;
const PID_DELETING = `${PID}-deleting`;
const UID = `int-c11-req-owner-${Date.now()}`;
const DAY = 24 * 3600_000;

// 装置：ExecutionRequestRetentionService（tx 全由测试事务传入）+ExecutionRequestService（红③ replay 面）
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const credit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const retention = new ExecutionRequestRetentionService(prisma as unknown as PrismaService, credit);
const requests = new ExecutionRequestService(
  prisma as unknown as PrismaService,
  new ValidationService(prisma as unknown as PrismaService, new PricingResolverService(prisma as unknown as PrismaService)),
  new TopologyService(),
  credit,
  null as never,
  new CanvasDocUpdateRepository(prisma as unknown as PrismaService),
);

let TID = '';
let HISTORY_ID = '';
const reqIds: string[] = [];
const inputIds: string[] = [];
const intentIds: string[] = [];

/** 直插 ExecutionRequest+ExecutionInput（无 FK 纯列——requestId/input 一对一）。requestExpiresAtMs
 *  默认 1h 前过期（stuck/claim 夹具）；传正值=未来（非终态保留行不污染后续 stuck 计数）。 */
async function insertRequest(opts: {
  id: string; projectId: string; state: string; inputAgeMs: number; reserved?: number; requestExpiresAtMs?: number;
}): Promise<void> {
  const now = Date.now();
  await prisma.executionRequest.create({ data: {
    id: opts.id, requestId: `req-${opts.id}`, projectId: opts.projectId, generation: 0,
    historyId: HISTORY_ID, docSeq: 0n, frozenDocSeq: 0n, userId: UID, teamId: TID,
    kind: 'text', state: opts.state, reservedCredit: opts.reserved ?? 0, totalCredit: 0,
    planHash: 'a'.repeat(64), inputHash: 'b'.repeat(64),
    expiresAt: new Date(now + (opts.requestExpiresAtMs ?? -3600_000)),
  } });
  await prisma.executionInput.create({ data: {
    requestId: opts.id, encoding: 'json+brotli', content: Buffer.from('x'), contentHash: 'b'.repeat(64),
    rawBytes: 1, storedBytes: 1, schemaVersion: 4, expiresAt: new Date(now - opts.inputAgeMs),
  } });
  inputIds.push(opts.id);
}

const sweepInputs = () => prisma.$transaction((tx) => retention.sweepExpiredInputsInTx(tx));
const sweepRequests = () => prisma.$transaction((tx) => retention.sweepExpiredInTx(tx));

(hasDb ? describe : describe.skip)('C1-1 红①②③：ExecutionRequest/ExecutionInput retention（真 PG）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: UID }, create: { id: UID, name: UID, email: `${UID}@test.local`, emailVerified: false }, update: {} });
    const team = await prisma.team.create({ data: { name: `int-c11-${Date.now()}`, ownerId: UID } });
    TID = team.id;
    const history = await prisma.systemHistory.findUnique({ where: { id: 1 } });
    expect(history, '真库 SystemHistory 权威行（admit 幂等前置 :309-313 依赖）').not.toBeNull();
    HISTORY_ID = history!.historyId;
    // void 面 lockBalance 前置（无钱包行=TEAM_BALANCE_MISSING——真链注资走 ensureBalance 单点）
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await prisma.canvasProject.create({ data: { id: PID, name: PID, teamId: TID, userId: UID } });
    await prisma.canvasProject.create({ data: { id: PID_DELETING, name: PID_DELETING, teamId: TID, userId: UID, lifecycleState: 'DELETING' } });
  }, 20_000);

  afterAll(async () => {
    await prisma.executionRequest.deleteMany({ where: { projectId: { startsWith: 'int-c11-req' } } });
    await prisma.executionInput.deleteMany({ where: { requestId: { in: [...reqIds, ...inputIds] } } });
    await prisma.generationIntent.deleteMany({ where: { id: { in: intentIds } } });
    await prisma.canvasProject.deleteMany({ where: { id: { in: [PID, PID_DELETING] } } });
    await ledgerWipe(ledger, { teamId: TID });
    if (TID) await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  // ── 红①：input 扫面判别双档 + scope ACTIVE ───────────────────────────────────────────
  it('红①：过期∧终态删+未过期零触碰+非终态零触碰+DELETING 项目零触碰（判别双档+scope）', async () => {
    const a = randomUUID(); const b = randomUUID(); const c = randomUUID(); const d = randomUUID();
    reqIds.push(a, b, c, d);
    await insertRequest({ id: a, projectId: PID, state: 'COMPLETED', inputAgeMs: DAY });           // 删（过期∧终态）
    await insertRequest({ id: b, projectId: PID, state: 'COMPLETED', inputAgeMs: -DAY });           // 留（未过期）
    await insertRequest({ id: c, projectId: PID, state: 'ADMITTED', inputAgeMs: DAY, requestExpiresAtMs: 3600_000 });   // 留（非终态——request expiresAt 未来，不污染后续 stuck/claim 计数）
    await insertRequest({ id: d, projectId: PID_DELETING, state: 'COMPLETED', inputAgeMs: DAY });    // 留（DELETING scope）

    const deleted = await sweepInputs();
    expect(deleted).toBeGreaterThanOrEqual(1);   // 共库共享 dev 库——计数面取下界，判别双档以行命运断言
    expect(await prisma.executionInput.findUnique({ where: { requestId: a } })).toBeNull();       // 过期∧终态 → 删
    expect(await prisma.executionInput.findUnique({ where: { requestId: b } })).not.toBeNull();    // 未过期 → 零触碰
    expect(await prisma.executionInput.findUnique({ where: { requestId: c } })).not.toBeNull();    // 非终态 → 零触碰
    expect(await prisma.executionInput.findUnique({ where: { requestId: d } })).not.toBeNull();    // DELETING → 零触碰
  });

  it('红① 终态重写口径：受理窗已过 31d 才终态 → expiresAt 重写 now+30d → 终态后 30d 才删（非终态即删缺口根除）', async () => {
    const r = randomUUID();
    reqIds.push(r);
    await insertRequest({ id: r, projectId: PID, state: 'EXECUTING', inputAgeMs: 31 * DAY });       // 受理 31 天前（受理窗早已过）

    await requests.transitionRequestTerminal(r, 'FAILED');   // 终态迁移（COMPLETED|FAILED 档）
    const req = await prisma.executionRequest.findUniqueOrThrow({ where: { id: r } });
    expect(req.state).toBe('FAILED');
    const input = await prisma.executionInput.findUniqueOrThrow({ where: { requestId: r } });
    // 重写=now+30d（受理窗 31d 前已过——不重写则立即删）
    expect(input.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(input.expiresAt.getTime()).toBeLessThan(Date.now() + 31 * DAY);

    expect(await sweepInputs()).toBeGreaterThanOrEqual(0);   // 终态后 <30d：本行不删（计数面下界=共享库其他victim不计）
    expect(await prisma.executionInput.findUnique({ where: { requestId: r } })).not.toBeNull();   // 行命运：不删

    await prisma.executionInput.update({ where: { requestId: r }, data: { expiresAt: new Date(Date.now() - 1000) } });   // 模拟终态后 30d
    expect(await sweepInputs()).toBeGreaterThanOrEqual(1);
    expect(await prisma.executionInput.findUnique({ where: { requestId: r } })).toBeNull();       // 行命运：终态后 30d → 删
  });

  it('红① VOIDED 档同款重写：voidForExecutionRequestInTx CAS 命中 → input expiresAt=now+30d+幂等让位', async () => {
    const r = randomUUID();
    reqIds.push(r);
    await insertRequest({ id: r, projectId: PID, state: 'ADMITTED', inputAgeMs: 32 * DAY, reserved: 0 });

    const first = await prisma.$transaction((tx) => credit.voidForExecutionRequestInTx(tx, r, 'expired-unclaimed'));
    expect(first).toBe(true);
    const req = await prisma.executionRequest.findUniqueOrThrow({ where: { id: r } });
    expect(req.state).toBe('VOIDED');
    const input = await prisma.executionInput.findUniqueOrThrow({ where: { requestId: r } });
    expect(input.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);

    // 幂等让位：已终态再 void → false 零动作（kill -9 续跑/双 worker 并发让位语义）
    expect(await prisma.$transaction((tx) => credit.voidForExecutionRequestInTx(tx, r, 'expired-unclaimed'))).toBe(false);
  });

  // ── 红②：stuck 计数（告警不删）──────────────────────────────────────────────────────
  it('红②：stuck 按状态分——ADMITTED∧expiresAt<now + EXECUTING∧GenerationIntent MIN(deadlineAt)<now；计数不删+scope ACTIVE', async () => {
    const baseline = await prisma.$transaction((tx) => retention.countStuckInTx(tx));   // 共享 dev 库——全局计数取基线差
    const admittedStuck = randomUUID();
    const admittedFresh = randomUUID();
    const executingStuck = randomUUID();
    const executingFresh = randomUUID();
    const deletingAdmitted = randomUUID();
    reqIds.push(admittedStuck, admittedFresh, executingStuck, executingFresh, deletingAdmitted);
    await insertRequest({ id: admittedStuck, projectId: PID, state: 'ADMITTED', inputAgeMs: 0 });
    await prisma.executionRequest.update({ where: { id: admittedStuck }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await insertRequest({ id: admittedFresh, projectId: PID, state: 'ADMITTED', inputAgeMs: 0, requestExpiresAtMs: 3600_000 });
    await insertRequest({ id: executingStuck, projectId: PID, state: 'EXECUTING', inputAgeMs: 0 });
    await insertRequest({ id: executingFresh, projectId: PID, state: 'EXECUTING', inputAgeMs: 0 });
    await insertRequest({ id: deletingAdmitted, projectId: PID_DELETING, state: 'ADMITTED', inputAgeMs: 0 });
    await prisma.executionRequest.update({ where: { id: deletingAdmitted }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const mkIntent = async (requestId: string, deadlineOffsetMs: number) => {
      const id = randomUUID();
      intentIds.push(id);
      await prisma.generationIntent.create({ data: {
        id, projectId: PID, nodeId: `n-${id.slice(0, 8)}`, userId: UID, teamId: TID,
        intentId: `iid-${id}`, kind: 'text', paramsHash: 'c'.repeat(64), status: 'RUNNING',
        creditCost: 0, idemKey: `idem-${id}`, heartbeatAt: new Date(Date.now() - 3600_000),
        deadlineAt: new Date(Date.now() + deadlineOffsetMs), execSeq: BigInt(Date.now()) + BigInt(intentIds.length),
        executionRequestId: requestId,
      } });
    };
    await mkIntent(executingStuck, -1000);    // RUNNING∧deadline 已过 → stuck
    await mkIntent(executingFresh, 3600_000); // RUNNING∧deadline 未过 → 不 stuck

    const stuck = await prisma.$transaction((tx) => retention.countStuckInTx(tx));
    expect(stuck.admitted - baseline.admitted).toBe(1);   // ADMITTED∧expiresAt<now（fresh 未过期/deleting scope 不计）
    expect(stuck.executing - baseline.executing).toBe(1); // EXECUTING∧MIN(deadlineAt)<now（fresh 不计）

    // 告警不删：全部行原样在档（input/request/intent 零删除）
    expect(await prisma.executionRequest.count({ where: { id: { in: [admittedStuck, admittedFresh, executingStuck, executingFresh, deletingAdmitted] } } })).toBe(5);
    expect((await prisma.generationIntent.findMany({ where: { id: { in: intentIds } } })).length).toBe(intentIds.length);

    // request 扫面（红⑤ 单批消费面先行实证）：stuck ADMITTED 行被 claim+void（CAS→VOIDED+保留窗重写）
    const r = await sweepRequests();
    expect(r.claimed).toBeGreaterThanOrEqual(1);
    expect(r.voided).toBeGreaterThanOrEqual(1);
    expect((await prisma.executionRequest.findUniqueOrThrow({ where: { id: admittedStuck } })).state).toBe('VOIDED');
    expect((await prisma.executionInput.findUniqueOrThrow({ where: { requestId: admittedStuck } })).expiresAt.getTime())
      .toBeGreaterThan(Date.now() + 29 * DAY);   // VOIDED 终态重写（红① 口径在 void 面的实证）
  });

  // ── 红③：FAILED→删 input→同 requestId replay 幂等返回原值不读 input ─────────────────────
  it('红③：FAILED→input 扫面删→同 requestId replay 幂等返回原值（不读 input）', async () => {
    const r = randomUUID();
    reqIds.push(r);
    await insertRequest({ id: r, projectId: PID, state: 'ADMITTED', inputAgeMs: 0 });
    // 幂等身份域基线（plan 集与 replay nodeIds 同集）
    await prisma.executionNodePlan.createMany({ data: [
      { requestId: r, nodeId: 'n1', order: 0, type: 'textGen', paramsHash: 'd'.repeat(64), status: 'SETTLED' },
      { requestId: r, nodeId: 'n2', order: 1, type: 'textGen', paramsHash: 'e'.repeat(64), status: 'SKIPPED' },
    ] });
    await requests.transitionRequestTerminal(r, 'FAILED');
    await prisma.executionInput.update({ where: { requestId: r }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await sweepInputs()).toBeGreaterThanOrEqual(1);   // FAILED 终态+过期 → input 已删（含本行）
    expect(await prisma.executionInput.findUnique({ where: { requestId: r } })).toBeNull();   // 行命运：本行已删

    // replay：同 (projectId,requestId) 在档 → 幂等返回原值（:309-332 只读 request/plans——不读 input）
    const original = await prisma.executionRequest.findUniqueOrThrow({ where: { id: r } });
    const outcome = await requests.admit({ projectId: PID, requestId: `req-${r}`, nodeIds: ['n1', 'n2'], docSeq: 0n, userId: UID });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.replayed).toBe(true);
    expect(outcome.id).toBe(r);
    expect(outcome.frozenDocSeq).toBe(original.frozenDocSeq);
    expect(outcome.planHash).toBe(original.planHash);
    expect(outcome.inputHash).toBe(original.inputHash);
    expect(outcome.reservedCredit).toBe(original.reservedCredit);
    expect(outcome.totalCredit).toBe(original.totalCredit);

    // worker 读面随 input 删除不可达（input 扫面只删终态行——FAILED 行的 loadForExecution 无意恢复）
    expect(await requests.loadForExecution(PID, `req-${r}`)).toBeNull();
  });
});