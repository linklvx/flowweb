// apps/api/src/modules/execution/intent-reconcile-r3.int.spec.ts —— T13 R3 红用例主件（真库）
// 五窗收敛（spec Z18''⑥ 动作表）：①settle 后崩溃（SUCCEEDED∧锚行在∧未核销→补 settle）
// ②Media 后崩溃（RUNNING∧stage 行 sourceUrl 在→重下 finalize——provider 不重调）③投影缺失
// （SUCCEEDED∧锚行在∧投影行缺→补建 pending）④node 删除（交付 written:false→orphaned+幂等退款
// ——过渡期 R3 面=FAILED/VOIDED 守卫+deliver-refund int 已锚 written:false 退款本体）⑤源过期
// （MaterializeJob T12 自有重试/终态链——R3 编排不重造，此处锚判据归属）。
// 护栏：每行 pg_advisory_xact_lock+审计行 ReconcileAction+auto_converged/manual_required 分计数+
// 并发双 reconcile 恰一次（零双 settle 零双 refund）+保留矩阵（text 90d/有 artifact 不物理删）。
// 纪律（Z73）：写过去时间戳造红；真库台账链（TeamCreditService/GenerationIntentService 直构）；
// MinIO/SafeRemoteFetch 注入 fake（artifact-commit-fixture——stage 行重下 finalize 的下载/上传面）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService } from './generation-intent.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { makeArtifactCommit } from '../../test-utils/artifact-commit-fixture';
import { IntentReconcileService, SETTLE_STRANDED_GRACE_MS } from './intent-reconcile.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { createIntentFixture, ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService, teamCredit, new NodeArtifactService());
// 真 ArtifactCommitService（R3 动作表单入口——finalize 事务/CAS/settle 全真；下载/上传注入 fake：
// fetchBuffer 计数器=「provider 不重调+重下恰一次」的判别锚）
const { artifactCommit, safeFetch } = makeArtifactCommit(prisma as unknown as PrismaService, ledger, teamCredit, intentSvc);

const reconcile = new IntentReconcileService(
  prisma as unknown as any,
  { isDocResident: () => false, writeExecStatus: vi.fn() } as any,
  { writeBatch: async () => [{ index: 0, op: 'deleteExecOrphans', written: true }] } as any,
  ledger,
  { getJob: async () => null } as any, { getJob: async () => null } as any,
  {} as any, teamCredit,
  artifactCommit,
);

const PID = `int-r3-${Date.now()}`;
const UID = `int-r3-owner-${Date.now()}`;
let TID = '';
let PRICING: { pricingRuleId: string; modelId: string | null; resolutionId: string | null; durationId: string | null; creditCost: number };

const claimIntent = async (over: Record<string, unknown> = {}) =>
  intentSvc.claim({
    projectId: PID,
    nodeId: `n-${randomUUID().slice(0, 8)}`,
    userId: UID,
    gestureToken: `r3-${randomUUID().slice(0, 8)}`,
    kind: 'image',
    paramsHash: `h-${randomUUID().slice(0, 8)}`,
    teamId: TID,
    pricing: PRICING,
    ...over,
  });

const rowOf = async (id: string) => prisma.generationIntent.findUnique({ where: { id } });
const ledgerRows = async (intentRowId: string, type: string) =>
  prisma.teamCreditTransaction.findMany({ where: { teamId: TID, referenceId: `intent:${intentRowId}`, type: type as any } });
const agePastGrace = async (id: string) =>
  prisma.generationIntent.update({ where: { id }, data: { completedAt: new Date(Date.now() - SETTLE_STRANDED_GRACE_MS - 60_000) } });

(hasDb ? describe : describe.skip)('T13 R3：五窗收敛+护栏（真库）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-r3-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-r3-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 500, frozenDelta: 0, referenceId: `it-r3-fund-${Date.now()}`,
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
    await prisma.mediaFactOutbox.deleteMany({ where: { projectId: PID } });
    await prisma.media.deleteMany({ where: { teamId: TID } });
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('窗②（Media 后崩溃）：RUNNING∧stage 行（sourceUrl）在 → 重下 finalize——provider 不重调（fetchBuffer 有数）+SUCCEEDED+真核销+锚行 stored+Media completed+审计行；双跑重下恰一次（幂等预检短路）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id, execSeq: intent.execSeq });
    // 崩溃窗：stage durable 行已落（provider 成功后、finalize 前 worker 死）——直接调 stageImage（真链）
    const stage = await artifactCommit.stageImage({
      projectId: PID, nodeId: intent.nodeId, teamId: TID, userId: UID,
      intentRowId: intent.id, execSeq: intent.execSeq, expectedRev: 0,
      sourceUrl: 'http://provider.example/r3-stage.png',
    });
    const fetchesBefore = (safeFetch.fetchBuffer as ReturnType<typeof vi.fn>).mock.calls.length;
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { heartbeatAt: new Date(Date.now() - 20 * 60_000), deadlineAt: new Date(Date.now() - 25 * 60_000) },
    });   // stale 批判龄（Z73 真值造龄——fake timers 不控 PG 时钟）

    await reconcile.verifyActive();   // stale 批：RUNNING 超龄 → R3 窗② 收敛

    const row = await rowOf(intent.id);
    expect(row!.status).toBe('SUCCEEDED');
    expect(row!.creditsConsumed).toBe(PRICING.creditCost);   // 真核销（非补记账）
    expect(row!.reservedCredits).toBe(0);
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(1);
    const anchor = await prisma.nodeArtifact.findUnique({
      where: { sourceIntentRowId_sourceExecSeq_artifactIndex: { sourceIntentRowId: intent.id, sourceExecSeq: intent.execSeq, artifactIndex: 0 } },
    });
    expect(anchor!.state).toBe('stored');
    expect(anchor!.mediaId).toBe(stage.mediaId);   // stage 行复用（ON CONFLICT 同 mediaId——不建第二 Media）
    expect(await prisma.media.findUnique({ where: { id: stage.mediaId } })).toMatchObject({ status: 'completed' });
    // provider 不重调+重下恰一次：下载面 fetchBuffer 恰 +1（stage sourceUrl）
    const fetchesAfterFirst = (safeFetch.fetchBuffer as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchesAfterFirst - fetchesBefore).toBe(1);

    await reconcile.verifyActive();   // 双跑：幂等预检短路——零重下零双 settle
    expect((safeFetch.fetchBuffer as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchesAfterFirst);
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(1);
    const audits = await prisma.reconcileAction.findMany({ where: { intentRowId: intent.id, action: 'finalize-from-stage' } });
    expect(audits).toHaveLength(1);   // 审计恰一行（advisory 锁内去重）
    expect(audits[0].after).toMatchObject({ status: 'SUCCEEDED', reservedCredits: 0 });
  }, 60_000);

  it('窗①+③（settle 后崩溃+投影缺失）：SUCCEEDED∧锚行在∧reserved>0 → 补 settle；锚行在∧投影行缺 → 补建 pending——双跑零双 settle+审计行', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id, execSeq: intent.execSeq });
    await intentSvc.complete(intent.id, 'm-r3-w13', intent.execSeq);   // SUCCEEDED（settle 崩溃窗）
    await prisma.nodeArtifact.create({
      data: {
        projectId: PID, nodeId: intent.nodeId, teamId: TID, targetField: 'fileId',
        mediaId: 'm-r3-w13', state: 'stored', rev: 1,
        sourceIntentRowId: intent.id, sourceExecSeq: intent.execSeq, artifactIndex: 0,
      },
    });   // 锚行在、投影行缺（窗③）
    await agePastGrace(intent.id);

    await reconcile.verifyActive();
    await reconcile.verifyActive();   // 双跑

    const row = await rowOf(intent.id);
    expect(row!.reservedCredits).toBe(0);
    expect(row!.creditsConsumed).toBe(PRICING.creditCost);
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(1);      // 零双 settle
    await expect(ledgerRows(intent.id, 'refund')).resolves.toHaveLength(0);      // 零退款（产物在案）
    const proj = await prisma.artifactProjection.findMany({ where: { projectId: PID, nodeId: intent.nodeId } });
    expect(proj.some((p) => p.state === 'pending')).toBe(true);                  // 窗③ 补建
    expect(await prisma.reconcileAction.count({ where: { intentRowId: intent.id, action: 'settle-backfill' } })).toBe(1);
  }, 60_000);

  it('窗④（FAILED/VOIDED 守卫）：FAILED∧reserved>0∧无 artifact 无 delivered → voidInTx（release 恰一）；有投影行（交付凭据）→ manual-required 不动钱', async () => {
    // 无凭据：void-terminal
    const a = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: a.intent.id, execSeq: a.intent.execSeq });
    await intentSvc.fail(a.intent.id, 'r3 window4 no-artifact');
    await agePastGrace(a.intent.id);
    await reconcile.verifyActive();
    await reconcile.verifyActive();   // 双跑零双 refund
    expect((await rowOf(a.intent.id))!.reservedCredits).toBe(0);
    await expect(ledgerRows(a.intent.id, 'release')).resolves.toHaveLength(1);   // 恰一次
    expect(await prisma.reconcileAction.count({ where: { intentRowId: a.intent.id, action: 'void-terminal' } })).toBe(1);

    // 有交付凭据（本 intent 资金锚的投影行 pending——T15 收口：凭据查询收窄到 artifactId∈
    // NodeArtifact{sourceIntentRowId=本行}，投影行必联真锚行——生产形态同款）：manual-required——冻结不动
    const b = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: b.intent.id, execSeq: b.intent.execSeq });
    await intentSvc.fail(b.intent.id, 'r3 window4 with-delivery-evidence');
    const anchorB = await prisma.nodeArtifact.create({
      data: {
        projectId: PID, nodeId: b.intent.nodeId, teamId: TID, targetField: 'fileId',
        mediaId: 'm-x', state: 'stored', rev: 1,
        sourceIntentRowId: b.intent.id, sourceExecSeq: b.intent.execSeq, artifactIndex: 0,
      },
    });
    await prisma.artifactProjection.create({
      data: {
        artifactId: anchorB.id, artifactRev: 1, projectId: PID, nodeId: b.intent.nodeId,
        targetField: 'fileId', targetItemId: '', mediaId: 'm-x', state: 'pending',
      },
    });
    await agePastGrace(b.intent.id);
    await reconcile.verifyActive();
    const rowB = await rowOf(b.intent.id);
    expect(rowB!.reservedCredits).toBe(PRICING.creditCost);   // 不动钱（裁决 :27④）
    await expect(ledgerRows(b.intent.id, 'release')).resolves.toHaveLength(0);
    expect(await prisma.reconcileAction.count({ where: { intentRowId: b.intent.id, action: 'manual-required' } })).toBe(1);
  }, 60_000);

  it('并发双 reconcile 恰一次（pg_advisory_xact_lock）：窗①行两实例并行 → settle 恰一次+审计恰一行', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id, execSeq: intent.execSeq });
    await intentSvc.complete(intent.id, 'm-r3-concurrent', intent.execSeq);
    await prisma.nodeArtifact.create({
      data: {
        projectId: PID, nodeId: intent.nodeId, teamId: TID, targetField: 'fileId',
        mediaId: 'm-r3-concurrent', state: 'stored', rev: 1,
        sourceIntentRowId: intent.id, sourceExecSeq: intent.execSeq, artifactIndex: 0,
      },
    });
    await agePastGrace(intent.id);

    await Promise.all([reconcile.verifyActive(), reconcile.verifyActive()]);   // 双实例并行（同进程双并发事务）

    expect((await rowOf(intent.id))!.creditsConsumed).toBe(PRICING.creditCost);
    expect((await rowOf(intent.id))!.reservedCredits).toBe(0);
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(1);   // 恰一次（advisory+CAS 双闸）
    expect(await prisma.reconcileAction.count({ where: { intentRowId: intent.id, action: 'settle-backfill' } })).toBe(1);
  }, 60_000);

  it('窗⑤（源过期）判据归属：Media(processing∧video) 的重试/终态链归 MaterializeJob（T12 自有 attempts/退避/退款）——R3 不重造（本用例=归属锚：R3 面零 video processing 行动作）', async () => {
    // 造一行 video processing 行（模拟 finalize 后 materialize 在飞）——R3 对此行零动作（归属 MaterializeJob）
    const { intent } = await claimIntent({ kind: 'video' });
    await teamCredit.reserve(UID, { intentRowId: intent.id, execSeq: intent.execSeq });
    await artifactCommit.finalizeVideo({
      projectId: PID, nodeId: intent.nodeId, teamId: TID, userId: UID,
      intentRowId: intent.id, execSeq: intent.execSeq, expectedRev: 0,
      sourceUrl: 'http://provider.example/r3-video.mp4', sourceMimeType: 'video/mp4',
    });
    const row = await rowOf(intent.id);
    expect(row!.status).toBe('SUCCEEDED');   // finalize-first：资金已闭（video=即 settle）
    expect(row!.reservedCredits).toBe(0);    // 不进 R3 终态悬留批（reserved=0）——源过期收敛归 MaterializeJob
    const audits = await prisma.reconcileAction.findMany({ where: { intentRowId: intent.id } });
    expect(audits).toHaveLength(0);          // R3 零动作（materialize-job.int.spec 锚 T12 链）
  }, 60_000);

  it('保留矩阵：text（resultText 非空）行 90d 前不删/90d 后删；有 NodeArtifact 锚行的 intent 不物理删（Media.sourceIntentRowId 悬空锚根修）', async () => {
    const old90 = new Date(Date.now() - 91 * 24 * 3600_000);
    const old8 = new Date(Date.now() - 8 * 24 * 3600_000);
    // ① text 行 90d 内（85d）不删
    const t1 = await createIntentFixture(prisma as unknown as PrismaService, { projectId: PID, teamId: TID, nodeId: 'n-r3-t1', userId: UID, intentId: `r3-t1-${Date.now()}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 1, reservedCredits: 0, creditsConsumed: 1, resultText: '长存产物正文', completedAt: new Date(Date.now() - 85 * 24 * 3600_000) });
    // ② text 行 90d 外（91d）删
    const t2 = await createIntentFixture(prisma as unknown as PrismaService, { projectId: PID, teamId: TID, nodeId: 'n-r3-t2', userId: UID, intentId: `r3-t2-${Date.now()}`, kind: 'text', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 1, reservedCredits: 0, creditsConsumed: 1, resultText: '到期产物正文', completedAt: old90 });
    // ③ 普通行 7d 外删
    const t3 = await createIntentFixture(prisma as unknown as PrismaService, { projectId: PID, teamId: TID, nodeId: 'n-r3-t3', userId: UID, intentId: `r3-t3-${Date.now()}`, kind: 'image', paramsHash: 'h', status: 'FAILED', creditCost: 1, reservedCredits: 0, completedAt: old8 });
    // ④ 有锚行的行（7d 外）不物理删
    const t4 = await createIntentFixture(prisma as unknown as PrismaService, { projectId: PID, teamId: TID, nodeId: 'n-r3-t4', userId: UID, intentId: `r3-t4-${Date.now()}`, kind: 'image', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 1, reservedCredits: 0, creditsConsumed: 1, completedAt: old8 });
    await prisma.nodeArtifact.create({ data: { projectId: PID, nodeId: 'n-r3-t4', teamId: TID, targetField: 'fileId', mediaId: 'm-keep', state: 'stored', rev: 1, sourceIntentRowId: t4.id, sourceExecSeq: t4.execSeq, artifactIndex: 0 } });

    await (reconcile as any).cleanTerminalIntents();

    expect(await rowOf(t1.id)).not.toBeNull();   // text 90d 内保留
    expect(await rowOf(t2.id)).toBeNull();       // text 90d 外删
    expect(await rowOf(t3.id)).toBeNull();       // 普通 7d 外删
    expect(await rowOf(t4.id)).not.toBeNull();   // 有 artifact 锚行不物理删（悬空锚根修）
  }, 30_000);

  it('评审 Important#1：悬留窗用户 replace（槽位 rev 前进）⇒ finalizeFromStage 持久 claimRev 失配=superseded——不覆盖用户值+资金独立判照常 settle（红：改前现读 claimCapture 必胜出=旧代产物覆盖用户值）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id, execSeq: intent.execSeq });
    expect((await rowOf(intent.id))!.claimArtifactRev).toBe(0);   // claim 捕获 rev 已持久化（fresh 槽位=0）
    await artifactCommit.stageImage({
      projectId: PID, nodeId: intent.nodeId, teamId: TID, userId: UID,
      intentRowId: intent.id, execSeq: intent.execSeq, expectedRev: 0,
      sourceUrl: 'http://provider.example/r3-replace-window.png',
    });
    // 悬留窗用户 replace（T11 命令同构）：casUpsert 以 claim 捕获 rev=0 胜出 ⇒ 槽位 rev=1+mediaId=用户值
    const nodeArtifacts = new NodeArtifactService();
    await prisma.$transaction(async (tx) => {
      await nodeArtifacts.casUpsert(tx, {
        projectId: PID, nodeId: intent.nodeId, teamId: TID, targetField: 'fileId',
        expectedRev: 0, source: 'replace', state: 'stored', mediaId: 'm-user-replace',
      });
    });
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { heartbeatAt: new Date(Date.now() - 20 * 60_000), deadlineAt: new Date(Date.now() - 25 * 60_000) },
    });

    await reconcile.verifyActive();

    const row = await rowOf(intent.id);
    expect(row!.status).toBe('SUCCEEDED');                       // intent CAS 成功——资金独立判照常核销
    expect(row!.creditsConsumed).toBe(PRICING.creditCost);
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(1);
    const slot = await prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: intent.nodeId, role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(slot!.mediaId).toBe('m-user-replace');                 // 红锚：用户值不被旧代产物覆盖（改前=stage mediaId）
    expect(slot!.rev).toBe(1);                                    // replace 的 rev 保持——未被 finalize 覆写
    expect(await prisma.reconcileAction.count({ where: { intentRowId: intent.id, action: 'finalize-from-stage' } })).toBe(1);
  }, 60_000);

  it('评审 Minor#5：stage 重下第一次下载失败（瞬态）⇒ 不退款次轮重试（失败审计=1+行仍 RUNNING 零 release/refund）→ 恢复后收敛', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id, execSeq: intent.execSeq });
    await artifactCommit.stageImage({
      projectId: PID, nodeId: intent.nodeId, teamId: TID, userId: UID,
      intentRowId: intent.id, execSeq: intent.execSeq, expectedRev: 0,
      sourceUrl: 'http://provider.example/r3-flaky.png',
    });
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { heartbeatAt: new Date(Date.now() - 20 * 60_000), deadlineAt: new Date(Date.now() - 25 * 60_000) },
    });

    safeFetch.fetchBuffer.mockRejectedValueOnce(new Error('ECONNRESET download flaky'));
    await reconcile.verifyActive();

    expect((await rowOf(intent.id))!.status).toBe('RUNNING');     // 未收敛——瞬态不弃已付费产物
    await expect(ledgerRows(intent.id, 'release')).resolves.toHaveLength(0);
    await expect(ledgerRows(intent.id, 'refund')).resolves.toHaveLength(0);
    expect(await prisma.reconcileAction.count({ where: { intentRowId: intent.id, action: 'finalize-from-stage-failed' } })).toBe(1);

    await reconcile.verifyActive();   // 次轮重试（fetchBuffer 恢复 fake 默认）——收敛
    const row = await rowOf(intent.id);
    expect(row!.status).toBe('SUCCEEDED');
    expect(row!.creditsConsumed).toBe(PRICING.creditCost);
    await expect(ledgerRows(intent.id, 'settle')).resolves.toHaveLength(1);
  }, 60_000);

  it('评审 Minor#5：三次下载失败耗尽 ⇒ 放弃重下走退款恰一次（release 恰一+VOIDED 终态——后续轮零重复退款）', async () => {
    const { intent } = await claimIntent();
    await teamCredit.reserve(UID, { intentRowId: intent.id, execSeq: intent.execSeq });
    await artifactCommit.stageImage({
      projectId: PID, nodeId: intent.nodeId, teamId: TID, userId: UID,
      intentRowId: intent.id, execSeq: intent.execSeq, expectedRev: 0,
      sourceUrl: 'http://provider.example/r3-dead.png',
    });
    await prisma.generationIntent.update({
      where: { id: intent.id },
      data: { heartbeatAt: new Date(Date.now() - 20 * 60_000), deadlineAt: new Date(Date.now() - 25 * 60_000) },
    });

    for (let i = 0; i < 3; i += 1) safeFetch.fetchBuffer.mockRejectedValueOnce(new Error('source 410 gone'));
    await reconcile.verifyActive();   // 第 1 次失败
    await reconcile.verifyActive();   // 第 2 次失败
    await reconcile.verifyActive();   // 第 3 次失败=耗尽 → 本轮即落退款分支
    let row = await rowOf(intent.id);
    expect(row!.status).toBe('VOIDED');                            // 退款终态（rollbackRunning——宁退勿吞）
    expect(row!.reservedCredits).toBe(0);
    expect(row!.creditsConsumed).toBe(0);
    await expect(ledgerRows(intent.id, 'release')).resolves.toHaveLength(1);   // 恰一次

    await reconcile.verifyActive();   // 后续轮——行已终态零重复
    await reconcile.verifyActive();
    row = await rowOf(intent.id);
    expect(row!.status).toBe('VOIDED');
    await expect(ledgerRows(intent.id, 'release')).resolves.toHaveLength(1);   // 仍然恰一次
    expect(await prisma.reconcileAction.count({ where: { intentRowId: intent.id, action: 'finalize-from-stage-failed' } })).toBe(3);   // 预算=3
  }, 90_000);

  it('评审 Important#2：投影补建扫龄守卫——7d 外旧锚（retention 删投影行后的常态）不重建（sweep↔retention 复活循环根修）', async () => {
    // 旧锚：SUCCEEDED 行+锚行（updatedAt 推 8d 前）+无投影行——retention 30d 删投影后的形态
    const old = await createIntentFixture(prisma as unknown as PrismaService, { projectId: PID, teamId: TID, nodeId: 'n-r3-old-anchor', userId: UID, intentId: `r3-oa-${Date.now()}`, kind: 'image', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 1, reservedCredits: 0, creditsConsumed: 1, completedAt: new Date(Date.now() - 40 * 24 * 3600_000) });
    await prisma.nodeArtifact.create({
      data: {
        projectId: PID, nodeId: 'n-r3-old-anchor', teamId: TID, targetField: 'fileId',
        mediaId: 'm-old-anchor', state: 'stored', rev: 1,
        sourceIntentRowId: old.id, sourceExecSeq: old.execSeq, artifactIndex: 0,
        updatedAt: new Date(Date.now() - 8 * 24 * 3600_000),   // 龄守卫判据（7d 窗外）
      },
    });
    await (reconcile as any).sweepProjectionBackfill();
    expect(await prisma.artifactProjection.count({ where: { projectId: PID, nodeId: 'n-r3-old-anchor' } })).toBe(0);            // 不重建
    expect(await prisma.reconcileAction.count({ where: { intentRowId: old.id, action: 'projection-backfill' } })).toBe(0);      // 零审计噪声

    // 窗内新锚（竞态/崩溃窗形态）——照常补建恰一次（对照臂）
    const fresh = await createIntentFixture(prisma as unknown as PrismaService, { projectId: PID, teamId: TID, nodeId: 'n-r3-fresh-anchor', userId: UID, intentId: `r3-fa-${Date.now()}`, kind: 'image', paramsHash: 'h', status: 'SUCCEEDED', creditCost: 1, reservedCredits: 0, creditsConsumed: 1 });
    await prisma.nodeArtifact.create({
      data: {
        projectId: PID, nodeId: 'n-r3-fresh-anchor', teamId: TID, targetField: 'fileId',
        mediaId: 'm-fresh-anchor', state: 'stored', rev: 1,
        sourceIntentRowId: fresh.id, sourceExecSeq: fresh.execSeq, artifactIndex: 0,
      },
    });
    await (reconcile as any).sweepProjectionBackfill();
    expect(await prisma.artifactProjection.count({ where: { projectId: PID, nodeId: 'n-r3-fresh-anchor', state: 'pending' } })).toBe(1);
    expect(await prisma.reconcileAction.count({ where: { intentRowId: fresh.id, action: 'projection-backfill' } })).toBe(1);
  }, 30_000);

  it('保留矩阵 retention：ArtifactProjection 终态 30d 清理+MediaFactOutbox published 7d 清理+dead-letter 告警（计数行保留）', async () => {
    await prisma.artifactProjection.create({ data: { artifactId: `art-old-${randomUUID().slice(0, 6)}`, artifactRev: 1, projectId: PID, nodeId: 'n-r3-old', targetField: 'fileId', targetItemId: '', state: 'orphaned', createdAt: new Date(Date.now() - 31 * 24 * 3600_000) } });
    await prisma.artifactProjection.create({ data: { artifactId: `art-new-${randomUUID().slice(0, 6)}`, artifactRev: 1, projectId: PID, nodeId: 'n-r3-new', targetField: 'fileId', targetItemId: '', state: 'orphaned' } });
    const ob1 = `m-ob1-${randomUUID().slice(0, 6)}`;
    const ob2 = `m-ob2-${randomUUID().slice(0, 6)}`;
    await prisma.mediaFactOutbox.create({ data: { mediaId: ob1, projectId: PID, factVersion: 1n, factType: 'state', payload: {}, state: 'published', publishedAt: new Date(Date.now() - 8 * 24 * 3600_000) } });
    await prisma.mediaFactOutbox.create({ data: { mediaId: ob2, projectId: PID, factVersion: 1n, factType: 'state', payload: {}, state: 'dead' } });

    await (reconcile as any).cleanProjectionAndOutbox();

    expect(await prisma.artifactProjection.count({ where: { projectId: PID, nodeId: 'n-r3-old' } })).toBe(0);   // 30d 外删
    expect(await prisma.artifactProjection.count({ where: { projectId: PID, nodeId: 'n-r3-new' } })).toBe(1);   // 30d 内留
    expect(await prisma.mediaFactOutbox.count({ where: { mediaId: ob1 } })).toBe(0);                        // published 7d 外删
    expect(await prisma.mediaFactOutbox.count({ where: { mediaId: ob2, state: 'dead' } })).toBe(1);        // dead 行保留（告警面）
    // 评审 Minor#6：ReconcileAction 审计行 90d 清理（旧删新留——行 id 随机化防跨 run 残留计数）
    const auditNewId = `gi-r3-audit-new-${randomUUID().slice(0, 8)}`;
    const auditOldId = (await prisma.reconcileAction.create({ data: { intentRowId: `gi-r3-audit-old-${randomUUID().slice(0, 8)}`, action: 'settle-backfill', createdAt: new Date(Date.now() - 91 * 24 * 3600_000) } })).id;
    await prisma.reconcileAction.create({ data: { intentRowId: auditNewId, action: 'settle-backfill' } });
    await (reconcile as any).cleanProjectionAndOutbox();
    expect(await prisma.reconcileAction.findUnique({ where: { id: auditOldId } })).toBeNull();
    expect(await prisma.reconcileAction.count({ where: { intentRowId: auditNewId } })).toBe(1);
  }, 30_000);
});
