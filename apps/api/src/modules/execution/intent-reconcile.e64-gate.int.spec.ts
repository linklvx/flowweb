// apps/api/src/modules/execution/intent-reconcile.e64-gate.int.spec.ts —— E64 锚用例（Y3 启动门）
// 锚原文（总目录 :119 验收锚——Y3 删 socket.io 前置条件）：「kill collab 进程→执行完成的节点在
// 恢复 30s 内必达 done」。v11 勘误：该锚至今无测试载体——本文件=补锚并变绿（绿后才准启动 Y3 批）。
//
// 杀窗形态（进程内等价承载——R3 既有用例同款先例，勿模拟进程 fork）：执行完成但交付未收敛——
// 意图行 SUCCEEDED∧已核销（settle 已达、creditsConsumed=cost/reserved=0）+NodeArtifact 锚行在
// ∧投影行缺（finalize 投影 createMany 与交付事务原子——kill 恰落在两者之间）。
// 「恢复」=IntentReconcileService 启动扫（onModuleInit 首句 fire-and-forget verifyActive——覆盖
// 「部署杀在飞任务」；测试走真实启动形态 onModuleInit，收敛窗以 E64 原文墙钟语义断言）。
// 30s 判据：E64 原文是墙钟 30s——恢复起点 Date.now 起计时，pollUntil 30s 窗内收敛必达（真实
// 耗时断言非只查终态）+锚常量断言（本杀窗收敛通道=窗③反连接扫，唯一窗参数扫龄窗 7d 域
// ——新鲜杀窗行必在窗内，重启即扫中，无任何 >30s 的等待面）。
// 「节点必达 done」：验收读面=投影行在（pending——交付 poller 的 claim 候选，Feed 终态链
// 投影 poller 单点推进 projected/exec.status done 事件）+行态（SUCCEEDED∧已核销）双断言。
//
// 夹具族形态照抄 intent-reconcile-r3.int.spec.ts（真库 hasDb 门/真台账链/真 ArtifactCommitService——
// makeArtifactCommit 装置；MinIO/SafeRemoteFetch fake）。红相预告：服务端恢复链已在库
// （R3 窗③=sweepProjectionBackfill 反连接扫）——预期直接绿，红相以负控腿承载（不跑启动扫
// ⇒ 投影行悬缺不收敛——证明判据判别力），如实登记勿伪造。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService } from './generation-intent.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { makeArtifactCommit } from '../../test-utils/artifact-commit-fixture';
import { IntentReconcileService, PROJECTION_BACKFILL_MAX_AGE_MS } from './intent-reconcile.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';
import { pollUntil } from '../../test-utils/poll-until';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService, teamCredit, new NodeArtifactService());
const { artifactCommit } = makeArtifactCommit(prisma as unknown as PrismaService, ledger, teamCredit, intentSvc);

const reconcile = new IntentReconcileService(
  prisma as unknown as any,
  {
    isDocResident: () => false,
    writeExecStatus: vi.fn(),
    readAuthorSlot: async (_projectId: string, intentRowId: string) => ({
      nodeId: intentRowId, kind: 'image', frozen: true, authorMediaId: null, liveMediaId: null,
    }),
    releaseAuthorSlot: async () => ({
      released: true, deletedSlot: false,
      bindingStats: { written: 0, skipped: { missing: 0, 'cross-team': 0, 'soft-deleted': 0 } },
    }),
  } as any,
  ledger,
  { getJob: async () => null } as any, { getJob: async () => null } as any,
  {} as any, teamCredit,
  artifactCommit,
);

const PID = `int-e64-${Date.now()}`;
const UID = `int-e64-owner-${Date.now()}`;
let TID = '';
let PRICING: { pricingRuleId: string; modelId: string | null; resolutionId: string | null; durationId: string | null; creditCost: number };

const claimIntent = () =>
  intentSvc.claim({
    projectId: PID,
    nodeId: `n-${randomUUID().slice(0, 8)}`,
    userId: UID,
    gestureToken: `e64-${randomUUID().slice(0, 8)}`,
    kind: 'image',
    paramsHash: `h-${randomUUID().slice(0, 8)}`,
    teamId: TID,
    pricing: PRICING,

    authorSlotFrozen: false,   // Y2 B1：B1~B2 占位（D8 禁现读）
    authorMediaId: null,
  });

const rowOf = async (id: string) => prisma.generationIntent.findUnique({ where: { id } });
const projRows = async (nodeId: string) =>
  prisma.artifactProjection.findMany({ where: { projectId: PID, nodeId } });

(hasDb ? describe : describe.skip)('E64 门（Y3 启动锚）：kill collab 进程→执行完成节点恢复 30s 内必达 done（真库）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-e64-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-e64-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 500, frozenDelta: 0, referenceId: `it-e64-fund-${Date.now()}`,
    }));
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null }, creditCost: { gt: 0 } } });
    if (!rule) throw new Error('真库无 active 付费 PricingRule——seed 未跑？');
    PRICING = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
  }, 20_000);

  afterAll(async () => {
    const rows = await prisma.generationIntent.findMany({ where: { projectId: PID }, select: { id: true } });
    await prisma.reconcileAction.deleteMany({ where: { intentRowId: { in: rows.map((r) => r.id) } } }).catch(() => undefined);
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID } });
    await prisma.artifactProjection.deleteMany({ where: { projectId: PID } });
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('负控腿：不跑启动扫——杀窗行悬置不收敛（投影行缺+行态滞留，判据有判别力）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id, execSeq: intent.execSeq });
    await intentSvc.complete(intent.id, 'm-e64-nc', intent.execSeq);   // SUCCEEDED
    await teamCredit.settle({ intentRowId: intent.id, execSeq: intent.execSeq });   // 真核销——已核销态
    await prisma.nodeArtifact.create({
      data: {
        projectId: PID, nodeId: intent.nodeId, teamId: TID, targetField: 'mediaId',
        mediaId: 'm-e64-nc', state: 'stored', rev: 1,
        sourceIntentRowId: intent.id, sourceExecSeq: intent.execSeq, artifactIndex: 0,
      },
    });   // 锚行在、投影行缺（杀窗形态本体）

    // 负控：恢复进程「未启动」——不调 onModuleInit/verifyActive，等一个真实墙钟窗（投影 poller 的
    // claim 周期数量级——PROJECTION_POLL_INTERVAL_MS 同域），断言交付未收敛（无启动扫则永悬）。
    await new Promise((r) => setTimeout(r, 5_000));
    expect(await projRows(intent.nodeId)).toHaveLength(0);   // 投影行仍缺——交付读面无「done」凭据
  }, 60_000);

  it('E64 主锚：kill collab 进程（SUCCEEDED 已核销+锚行在+投影缺）→ 启动扫恢复——节点在 30s 墙钟内必达 done（投影行在=交付 poller claim 候选+Δt<30s）', async () => {
    // ── 杀窗：执行完成但交付未收敛（最小形态——R3 窗③同族，意图行已核销故不进终态悬留批，
    //    唯收敛通道=启动扫 sweepProjectionBackfill 反连接批） ──
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id, execSeq: intent.execSeq });
    await intentSvc.complete(intent.id, 'm-e64', intent.execSeq);   // SUCCEEDED（执行完成）
    await teamCredit.settle({ intentRowId: intent.id, execSeq: intent.execSeq });   // 真核销（creditsConsumed=cost/reserved=0）
    const anchor = await prisma.nodeArtifact.create({
      data: {
        projectId: PID, nodeId: intent.nodeId, teamId: TID, targetField: 'mediaId',
        mediaId: 'm-e64', state: 'stored', rev: 1,
        sourceIntentRowId: intent.id, sourceExecSeq: intent.execSeq, artifactIndex: 0,
      },
    });   // 锚行在、投影行缺——「执行完成的节点」交付未收敛面

    // 杀窗行态自检（负控腿同形态——红相判别锚）
    const strandedRow = await rowOf(intent.id);
    expect(strandedRow!.status).toBe('SUCCEEDED');
    expect(strandedRow!.reservedCredits).toBe(0);
    expect(strandedRow!.creditsConsumed).toBe(PRICING.creditCost);
    expect(await projRows(intent.nodeId)).toHaveLength(0);

    // ── 恢复：进程重启=onModuleInit 启动扫（真实启动形态——onModuleInit 首句 fire-and-forget
    //    verifyActive，与生产同构；收敛以 E64 原文语义承载：恢复后 30s 墙钟窗内必达） ──
    const t0 = Date.now();
    await reconcile.onModuleInit();   // 启动扫入口（fire-and-forget——恢复进程「已拉起」即计时起点）
    await pollUntil(async () => (await projRows(intent.nodeId)).length === 1, 30_000, 100);
    const recovered = await rowOf(intent.id);
    const proj = await projRows(intent.nodeId);
    const dtMs = Date.now() - t0;

    // ── 「节点必达 done」（双断言：行态+交付读面） ──
    expect(recovered!.status).toBe('SUCCEEDED');   // 执行完成态保持（恢复链不倒退）
    expect(proj).toHaveLength(1);   // 投影行必达（pending——交付 poller claim 候选=Feed 终态链入口，节点 done 读面凭据）
    expect(proj[0]!.state).toBe('pending');
    expect(proj[0]!.mediaId).toBe(anchor.mediaId);
    expect(await prisma.reconcileAction.count({ where: { intentRowId: intent.id, action: 'projection-backfill' } })).toBe(1);

    // ── 30s 判据（E64 原文是墙钟 30s）：真实耗时断言（Date.now 前后差）+锚常量断言——本杀窗
    //    （SUCCEEDED 已核销）不进终态悬留批（reserved=0 谓词），SETTLE_STRANDED_GRACE_MS 宽限
    //    与本窗无关；收敛通道=窗③反连接扫，唯一窗参数=扫龄窗 PROJECTION_BACKFILL_MAX_AGE_MS
    //    （7d——杀窗行龄必在窗内，重启即扫中，无任何 >30s 的等待面） ──
    expect(dtMs).toBeLessThan(30_000);   // 恢复收敛耗时 <30s（墙钟）
    expect(PROJECTION_BACKFILL_MAX_AGE_MS).toBe(7 * 24 * 3600_000);   // 扫龄窗（7d 域）——恒覆盖新鲜杀窗行

    // 双跑幂等（恢复后周期扫不重投影——审计恰一行）
    await reconcile.verifyActive();
    expect(await projRows(intent.nodeId)).toHaveLength(1);
    expect(await prisma.reconcileAction.count({ where: { intentRowId: intent.id, action: 'projection-backfill' } })).toBe(1);

    await reconcile.onApplicationShutdown();
  }, 90_000);
});
