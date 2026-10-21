// apps/api/src/modules/artifact-core/artifact-commit.int.spec.ts —— Y1a+Y1b T10 核心二（spec Z18''-v14 ②③④⑥）：
// ArtifactCommitService=资金五路径唯一 finalize 真库红绿——finalize CAS（superseded 不覆盖用户值）/
// 资金独立判（intent CAS 成功∧provider 成功→照常 settle 产物入素材库；intent CAS 失败→void 旧冻结——
// 禁「CAS 失败静默丢产物」与「无条件退款」两错分支）/finalize 锁序 balance→intent（ABBA 死锁注入零
// 40P01 泄漏+锁等待注入不恶化）/stage durable 全 kind 落 sourceUrl（kill -9 后凭 processing 行重下
// finalize）/幂等（同 intent+execSeq 重跑零新行）/settle 失败整体回滚。
// 红形态（改前可复现）：ArtifactCommitService/registerInTx 全仓不存在（编译级红）；现状 image 产物
// provider URL 仅存内存窗口（崩溃即只能退款）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { NodeArtifactService } from './node-artifact.service';
import { MediaRegistrationService } from './media-registration.service';
import { ArtifactCommitService } from './artifact-commit.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const nodeArtifacts = new NodeArtifactService();
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService, teamCredit, nodeArtifacts);

// fake 基础设施（int 不连真对象存储/真外网——MinIO 产能+SafeRemoteFetch 下载注入；finalize 资金/事务面全真）
const PNG_BUFFER = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG 魔数（sniff 可判 image/png）
  Buffer.alloc(64, 0x42),
]);
const fakeMinio = { upload: vi.fn(async () => undefined) };
const fakeFetch = { fetchBuffer: vi.fn(async () => ({ buffer: PNG_BUFFER, contentType: 'image/png' })) };
const registration = new MediaRegistrationService(prisma as unknown as PrismaService, fakeMinio as any);
const artifactCommit = new ArtifactCommitService(
  prisma as unknown as PrismaService, ledger, teamCredit, intentSvc,
  fakeMinio as any, fakeFetch as any, nodeArtifacts, registration,
);

const PID = `int-t10ac-${Date.now()}`;
const UID = `int-t10ac-owner-${Date.now()}`;
let TID = '';
let PRICING: any;

const claimIntent = async (over: Record<string, unknown> = {}) =>
  intentSvc.claim({
    projectId: PID,
    nodeId: over.nodeId as string ?? `n-${randomUUID().slice(0, 8)}`,
    userId: UID,
    kind: 'image',
    paramsHash: `h-${randomUUID().slice(0, 8)}`,
    teamId: TID,
    pricing: PRICING,
    ...over,
  });

const commitFor = (c: { intent: any; artifactRev: number }, over: Record<string, unknown> = {}) =>
  artifactCommit.commitImage({
    projectId: PID, nodeId: c.intent.nodeId, teamId: TID, userId: UID,
    intentRowId: c.intent.id, execSeq: c.intent.execSeq, expectedRev: c.artifactRev,
    sourceUrl: `https://provider.example.com/${randomUUID().slice(0, 8)}.png`,
    ...over,
  });

const ledgerRows = (intentRowId: string, type: string) =>
  prisma.teamCreditTransaction.findMany({ where: { teamId: TID, referenceId: `intent:${intentRowId}`, type: type as any } });

const balanceOf = async () => (await prisma.teamBalance.findUnique({ where: { teamId: TID } }))!.credits;

const slotRow = (nodeId: string) => prisma.nodeArtifact.findUnique({
  where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId, role: 'primary', targetField: 'fileId', targetItemId: '' } },
});

/** 回滚用例销毁 TeamBalance 后重建+复充（后续用例 reserve 依赖） */
const restoreBalance = async () => {
  await ledger.runInTx(async (tx) => {
    await ledger.ensureBalance(tx, TID);
    await ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 100, frozenDelta: 0, referenceId: `it-t10ac-restore-${Date.now()}`,
    });
  });
};

(hasDb ? describe : describe.skip)('Y1a T10 核心二：ArtifactCommit finalize/stage（真 PG；MinIO/fetch 注入）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-t10ac-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-t10ac-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 100, frozenDelta: 0, referenceId: `it-t10ac-fund-${Date.now()}`,
    }));
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null }, creditCost: { gt: 0 } } });
    if (!rule) throw new Error('真库无 active 付费 PricingRule——seed 未跑？');
    PRICING = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
  });

  afterAll(async () => {
    await prisma.artifactProjection.deleteMany({ where: { projectId: PID } });
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID } });
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });
    await prisma.mediaFactOutbox.deleteMany({ where: { projectId: PID } });
    await prisma.media.deleteMany({ where: { teamId: TID } });
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  });

  it('image 同步链 happy：stage→下载→sha/sniff→上传→finalize 单事务——Media completed（content-addressed key）+NodeArtifact stored rev=1+binding+投影 pending+settle', async () => {
    const c = await claimIntent({ jobId: 't10ac-happy' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    const out = await commitFor(c);
    expect(out.outcome).toBe('committed');
    expect(out.mediaId).toBeTruthy();
    // Media 行：completed+content-addressed key（artifacts/{teamId}/{intentRowId}/{execSeq}/{index}-{sha256}）+sniffed
    const media = await prisma.media.findUnique({ where: { id: out.mediaId! } });
    expect(media!.status).toBe('completed');
    expect(media!.key).toMatch(new RegExp(`^artifacts/${TID}/${c.intent.id}/${c.intent.execSeq}/0-[0-9a-f]{64}$`));
    expect(media!.sniffedMimeType).toBe('image/png');
    expect(media!.size).toBe(BigInt(PNG_BUFFER.length));
    expect(media!.sourceUrl).toContain('provider.example.com');
    // NodeArtifact：stored+rev=1+mediaId+资金锚
    const art = await slotRow(c.intent.nodeId);
    expect(art!.state).toBe('stored');
    expect(art!.rev).toBe(1);
    expect(art!.mediaId).toBe(out.mediaId);
    expect(art!.sourceIntentRowId).toBe(c.intent.id);
    expect(art!.sourceExecSeq).toBe(c.intent.execSeq);
    // binding current-state + 投影 pending
    const binding = await prisma.mediaBinding.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: c.intent.nodeId, role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(binding!.mediaId).toBe(out.mediaId);
    const proj = await prisma.artifactProjection.findUnique({ where: { artifactId_artifactRev: { artifactId: art!.id, artifactRev: 1 } } });
    expect(proj!.state).toBe('pending');
    expect(proj!.mediaId).toBe(out.mediaId);
    // intent SUCCEEDED+settle 恰一次（冻结转实扣）
    const intent = await prisma.generationIntent.findUnique({ where: { id: c.intent.id } });
    expect(intent!.status).toBe('SUCCEEDED');
    expect(intent!.resultRef).toBe(out.mediaId);
    expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(1);
    expect(await balanceOf()).toBe(100 - PRICING.creditCost);
  });

  it('红（finalize CAS）：生成在飞用户 replace（rev 已+1）→ finalize 0 行=superseded——不覆盖用户值+投影 superseded', async () => {
    const c = await claimIntent({ jobId: 't10ac-sup' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    // 用户 replace（T11 命令形态预演）：槽位 rev 0→1+用户 mediaId
    const userMedia = `media-user-${randomUUID().slice(0, 6)}`;
    await prisma.$transaction((tx) => nodeArtifacts.casUpsert(tx, {
      projectId: PID, nodeId: c.intent.nodeId, teamId: TID, targetField: 'fileId',
      expectedRev: 0, source: 'replace', state: 'stored', mediaId: userMedia,
    }));
    const out = await commitFor(c);
    expect(out.outcome).toBe('superseded');
    // 槽位：用户值不被覆盖
    const art = await slotRow(c.intent.nodeId);
    expect(art!.mediaId).toBe(userMedia);
    expect(art!.rev).toBe(1);
    expect(art!.source).toBe('replace');
    // 投影 superseded（槽位当前 rev 锚）——不投影（无 pending 行）
    const proj = await prisma.artifactProjection.findUnique({ where: { artifactId_artifactRev: { artifactId: art!.id, artifactRev: 1 } } });
    expect(proj!.state).toBe('superseded');
    expect(await prisma.artifactProjection.findFirst({ where: { artifactId: art!.id, state: 'pending' } })).toBeNull();
  });

  it('资金独立判 A（禁「CAS 失败静默丢产物」+禁「无条件退款」）：superseded 但 intent CAS 成功∧provider 成功 → 照常 settle+产物入素材库——零退款', async () => {
    const c = await claimIntent({ jobId: 't10ac-fundA' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    await prisma.$transaction((tx) => nodeArtifacts.casUpsert(tx, {
      projectId: PID, nodeId: c.intent.nodeId, teamId: TID, targetField: 'fileId',
      expectedRev: 0, source: 'replace', state: 'stored', mediaId: 'media-user-a',
    }));
    const balanceBefore = await balanceOf();
    const out = await commitFor(c);
    expect(out.outcome).toBe('superseded');
    // 产物照常入库（用户从素材库取）：Media completed 保留
    const media = await prisma.media.findUnique({ where: { id: out.mediaId! } });
    expect(media!.status).toBe('completed');
    // 照常 settle（冻结转实扣）——非退款非静默丢。余额口径：reserve 已扣（balanceDelta=-c）、settle
    // 零余额变化（frozen→consumed）⇒ 恰 balanceBefore；无条件退款分支=+cost 即红、静默丢=settle 缺行即红。
    expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(1);
    expect(await ledgerRows(c.intent.id, 'refund')).toHaveLength(0);
    expect(await balanceOf()).toBe(balanceBefore);
    const intent = await prisma.generationIntent.findUnique({ where: { id: c.intent.id } });
    expect(intent!.status).toBe('SUCCEEDED');
  });

  it('资金独立判 B：intent CAS 失败（行已被收敛终态）→ 不 settle+void 旧冻结——零产物行零投影', async () => {
    const c = await claimIntent({ jobId: 't10ac-fundB' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    // reaper 收敛语义预演：行终态化（VOIDED）——finalize 的 intent CAS 必败
    await intentSvc.void_(c.intent.id, 'deadline exceeded（reaper 预演）', c.intent.execSeq);
    const out = await commitFor(c);
    expect(out.outcome).toBe('intent-stale');
    // 不 settle；冻结已 void（release 冲销）——不是静默悬挂
    expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(0);
    expect(await ledgerRows(c.intent.id, 'release')).toHaveLength(1);
    // 零产物行零投影（finalize 事务整体回滚——NodeArtifact CAS 不留痕）
    expect(await slotRow(c.intent.nodeId)).toBeNull();
    expect(await prisma.artifactProjection.findFirst({ where: { projectId: PID, nodeId: c.intent.nodeId } })).toBeNull();
  });

  it('幂等（同 intent+execSeq 重跑零新行）：finalize 已成功后重跑 commitImage → 幂等返回+零新行', async () => {
    const c = await claimIntent({ jobId: 't10ac-idem' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    const first = await commitFor(c);
    expect(first.outcome).toBe('committed');
    const second = await commitFor(c); // 同 sourceUrl 同参数重跑（R3 复驱形态）
    expect(second.outcome).toBe('committed');
    expect(second.mediaId).toBe(first.mediaId);
    expect(await prisma.nodeArtifact.count({ where: { projectId: PID, nodeId: c.intent.nodeId } })).toBe(1);
    expect(await prisma.media.count({ where: { teamId: TID, sourceIntentRowId: c.intent.id } })).toBe(1);
    expect(await prisma.artifactProjection.count({ where: { projectId: PID, nodeId: c.intent.nodeId } })).toBe(1);
    expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(1); // 恰一次实扣
  });

  it('质评收口 Important#2：commitImage 幂等重驱预检——已 SUCCEEDED∧锚行在 ⇒ 零重下载零重上传+mediaId/key 回填（provider URL 过期复驱白耗 attempts 面根修）', async () => {
    const c = await claimIntent({ jobId: 't10ac-redrive' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    fakeFetch.fetchBuffer.mockClear();
    fakeMinio.upload.mockClear();
    const first = await commitFor(c);
    expect(first.outcome).toBe('committed');
    expect(fakeFetch.fetchBuffer).toHaveBeenCalledTimes(1);   // 首程恰一次下载
    expect(fakeMinio.upload).toHaveBeenCalledTimes(1);
    // 复驱（同参数 R3/重试形态）——零第二次下载/上传，幂等出口回填 mediaId+key
    const second = await commitFor(c);
    expect(second.outcome).toBe('committed');
    expect(second.mediaId).toBe(first.mediaId);
    expect(second.key).toBe(first.key);                       // Important#1：幂等路径 key 回填（非 undefined）
    expect(fakeFetch.fetchBuffer).toHaveBeenCalledTimes(1);   // 红：改前第二次复驱必再下载（URL 过期即 throw）
    expect(fakeMinio.upload).toHaveBeenCalledTimes(1);
  });

  it('质评收口 Minor#8：finalizeText superseded 分支——result 槽用户替换（rev 已+1）→ 0 行=superseded 不覆盖用户值+投影 superseded+照常 settle', async () => {
    const c = await claimIntent({ kind: 'text', jobId: 't10ac-text-sup' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    // 用户 replace text 产物（T11 命令形态预演）：result 槽 rev 0→1+用户文本
    await prisma.$transaction((tx) => nodeArtifacts.casUpsert(tx, {
      projectId: PID, nodeId: c.intent.nodeId, teamId: TID, targetField: 'result',
      expectedRev: 0, source: 'replace', state: 'stored', resultText: '用户已替换的文本',
    }));
    const out = await artifactCommit.finalizeText({
      projectId: PID, nodeId: c.intent.nodeId, teamId: TID, userId: UID,
      intentRowId: c.intent.id, execSeq: c.intent.execSeq, expectedRev: c.artifactRev,
      resultText: '旧代生成的文本',
    });
    expect(out.outcome).toBe('superseded');
    // 槽位：用户值不被覆盖（result 槽 text 消费面）
    const art = await prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: c.intent.nodeId, role: 'primary', targetField: 'result', targetItemId: '' } },
    });
    expect(art!.resultText).toBe('用户已替换的文本');
    expect(art!.rev).toBe(1);
    expect(art!.source).toBe('replace');
    // 投影 superseded（无 pending 行）+照常 settle（资金独立判）
    const proj = await prisma.artifactProjection.findUnique({ where: { artifactId_artifactRev: { artifactId: art!.id, artifactRev: 1 } } });
    expect(proj!.state).toBe('superseded');
    expect(await prisma.artifactProjection.findFirst({ where: { artifactId: art!.id, state: 'pending' } })).toBeNull();
    expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(1);
    expect(await ledgerRows(c.intent.id, 'refund')).toHaveLength(0);
    expect((await prisma.generationIntent.findUnique({ where: { id: c.intent.id } }))!.status).toBe('SUCCEEDED');
  });

  it('stage durable 全 kind 落 sourceUrl（红：现状 provider URL 仅内存窗口）：stage 后 kill -9 → processing 行+sourceUrl 在——R3 凭行重下并 finalize', async () => {
    const c = await claimIntent({ jobId: 't10ac-stage' });
    const sourceUrl = `https://provider.example.com/stage-${randomUUID().slice(0, 8)}.png`;
    // worker 在 stage 后、finalize 前被 kill -9（stage 短事务已提交；后续步骤全未发生）
    const stage = await artifactCommit.stageImage({
      projectId: PID, nodeId: c.intent.nodeId, teamId: TID, userId: UID,
      intentRowId: c.intent.id, execSeq: c.intent.execSeq, expectedRev: c.artifactRev, sourceUrl,
    });
    const media = await prisma.media.findUnique({ where: { id: stage.mediaId } });
    expect(media!.status).toBe('processing');
    expect(media!.sourceUrl).toBe(sourceUrl);           // R3 重下面
    expect(media!.sourceUrlExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(media!.sourceIntentRowId).toBe(c.intent.id);
    expect(media!.sourceExecSeq).toBe(c.intent.execSeq);
    // processing fact 同事务在案（UI「处理中」推送来源）
    expect(await prisma.mediaFactOutbox.findFirst({ where: { mediaId: stage.mediaId } })).toBeTruthy();
    // R3 复驱：凭 stage 行（(bucket,key) 幂等复用）重下+finalize——同一 Media 行收敛 completed
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    const out = await artifactCommit.commitImage({
      projectId: PID, nodeId: c.intent.nodeId, teamId: TID, userId: UID,
      intentRowId: c.intent.id, execSeq: c.intent.execSeq, expectedRev: c.artifactRev, sourceUrl,
    });
    expect(out.outcome).toBe('committed');
    expect(out.mediaId).toBe(stage.mediaId);            // 复用 stage 行（零新行）
    expect((await prisma.media.findUnique({ where: { id: stage.mediaId } }))!.status).toBe('completed');
    expect(await prisma.media.count({ where: { teamId: TID, sourceIntentRowId: c.intent.id } })).toBe(1);
  });

  it('text kind 分支：finalizeText——NodeArtifact resultText/state=stored（无 Media）+投影 pending+settle', async () => {
    const c = await claimIntent({ kind: 'text', jobId: 't10ac-text' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    const out = await artifactCommit.finalizeText({
      projectId: PID, nodeId: c.intent.nodeId, teamId: TID, userId: UID,
      intentRowId: c.intent.id, execSeq: c.intent.execSeq, expectedRev: c.artifactRev,
      resultText: '生成文本正文',
    });
    expect(out.outcome).toBe('committed');
    const art = await prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: c.intent.nodeId, role: 'primary', targetField: 'result', targetItemId: '' } },
    });
    expect(art!.state).toBe('stored');
    expect(art!.resultText).toBe('生成文本正文');
    expect(art!.mediaId).toBeNull();                    // text=跳过 Media（v13b kind 分支）
    expect(await prisma.media.count({ where: { sourceIntentRowId: c.intent.id } })).toBe(0);
    const proj = await prisma.artifactProjection.findUnique({ where: { artifactId_artifactRev: { artifactId: art!.id, artifactRev: 1 } } });
    expect(proj!.state).toBe('pending');
    expect(proj!.resultText).toBe('生成文本正文');
    expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(1);
  });

  it('settle 失败整体回滚：finalize 事务内 lockBalance 抛（TeamBalance 灭失）→ NodeArtifact/投影/Media 提升全回滚+冻结完好', async () => {
    const c = await claimIntent({ jobId: 't10ac-rollback' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    // 台账直删（ledgerWipe 同款 GUC 通行证）——finalize 首句 lockBalance 即 TEAM_BALANCE_MISSING
    await ledgerWipe(ledger, { teamId: TID });
    try {
      await expect(commitFor(c)).rejects.toMatchObject({ errorCode: 'TEAM_BALANCE_MISSING' });
      const intent = await prisma.generationIntent.findUnique({ where: { id: c.intent.id } });
      expect(intent!.status).toBe('RUNNING');            // 未终态化（整体回滚）
      expect(intent!.reservedCredits).toBe(PRICING.creditCost); // 冻结完好（未被动）
      expect(await slotRow(c.intent.nodeId)).toBeNull();  // 零产物行
      expect(await prisma.artifactProjection.findFirst({ where: { projectId: PID, nodeId: c.intent.nodeId } })).toBeNull();
    } finally {
      await restoreBalance();   // 后续锁序用例依赖钱包行（断言失败也必须重建）
      // cleanup：解冻避免夹具残留冻结
      await teamCredit.void_({ intentRowId: c.intent.id, execSeq: c.intent.execSeq }).catch(() => {});
    }
  });

  describe('finalize 锁序 balance→intent（契约 20——ABBA 死锁防线）', () => {
    it('ABBA 死锁注入：partner 反序（先锁 intent 行+150ms 后碰 TeamBalance）→ finalize 有界重试收敛零 40P01 泄漏', async () => {
      const c = await claimIntent({ jobId: 't10ac-abba' });
      await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
      const t0 = Date.now();
      // partner=反序竞争者（模拟「先碰 intent 再碰 balance」的错误实现面/reserve 对手）：死锁环成立时
      // PG deadlock detector（~1s）选牺牲者——finalize 侧 40P01/55P03 进有界重试，不裸抛。
      const partner = prisma.$transaction(async (t) => {
        await t.$queryRaw`SELECT "id" FROM "GenerationIntent" WHERE "id" = ${c.intent.id} FOR UPDATE`;
        await new Promise((r) => setTimeout(r, 150));
        await t.$executeRaw`SET LOCAL app.ledger_tx = 'on'`;
        await t.$executeRaw`UPDATE "TeamBalance" SET "version" = "version" + 1 WHERE "teamId" = ${TID}`;
      }).catch(() => 'deadlocked-ok'); // partner 被选为牺牲者=合法终态（40P01）
      const out = await commitFor(c);
      await partner;
      expect(out.outcome).toBe('committed');           // 有界重试后必达——零 40P01 裸抛
      expect(Date.now() - t0).toBeLessThan(15_000);    // 锁等待注入不恶化（重试预算内收敛）
      expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(1);
    }, 30_000);

    it('100ms sleep 锁等待注入：partner 持 TeamBalance 行锁 150ms → finalize 等待后照常完成（不超时不恶化）', async () => {
      const c = await claimIntent({ jobId: 't10ac-wait' });
      await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
      const t0 = Date.now();
      const partner = prisma.$transaction(async (t) => {
        await t.$executeRaw`SET LOCAL app.ledger_tx = 'on'`;
        await t.$queryRaw`SELECT "teamId" FROM "TeamBalance" WHERE "teamId" = ${TID} FOR UPDATE`;
        await new Promise((r) => setTimeout(r, 150));  // 注入锁等待窗（<lock_timeout 3s）
      });
      const out = await commitFor(c);
      await partner;
      expect(out.outcome).toBe('committed');
      expect(Date.now() - t0).toBeLessThan(10_000);
    }, 30_000);

    it('同 team 并发双 finalize（异 intent）：lockBalance 全序串行化——零死锁双 committed', async () => {
      const a = await claimIntent({ jobId: 't10ac-par-a' });
      const b = await claimIntent({ jobId: 't10ac-par-b' });
      await Promise.all([
        teamCredit.reserve(UID, { intentRowId: a.intent.id, execSeq: a.intent.execSeq }),
        teamCredit.reserve(UID, { intentRowId: b.intent.id, execSeq: b.intent.execSeq }),
      ]);
      const [ra, rb] = await Promise.all([commitFor(a), commitFor(b)]);
      expect(ra.outcome).toBe('committed');
      expect(rb.outcome).toBe('committed');
    }, 30_000);
  });
});
