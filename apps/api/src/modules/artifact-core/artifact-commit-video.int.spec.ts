// apps/api/src/modules/artifact-core/artifact-commit-video.int.spec.ts —— Y1a+Y1b T12 核心一
// （spec Z18''-v14 kind 分支 video=finalize-first；裁决①/⑮/㉔-2/㉔-3）真库红绿：
// video=finalize 单事务建 Media(processing,sourceUrl 专用列+预分配 key)+NodeArtifact state=materializing
// +settle/complete+ArtifactProjection（fileId 交付 mediaId）——doc 只有 fileId（videoUrl 写点根修）；
// materialize 异步（核心二 materialize.int.spec）；processing fact 同事务（UI「处理中」推送来源）。
// 红形态（改前可复现）：ArtifactCommitService.finalizeVideo 全仓不存在（编译级红）；现状 video 旧链
// doc 交付写 videoUrl 而 VideoGenNode 渲染 fileId——404 不可达路径（登记缺陷，本卡根修）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { NodeArtifactService } from './node-artifact.service';
import { MediaRegistrationService } from './media-registration.service';
import { ArtifactCommitService, ARTIFACT_SOURCE_URL_TTL_MS } from './artifact-commit.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const nodeArtifacts = new NodeArtifactService();
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService, teamCredit, nodeArtifacts);

// fake 基础设施（int 不连真对象存储/真外网——finalize 资金/事务面全真；video finalize 事务内零 IO，
// minio/safeFetch 仅满足构造器形状）
const fakeMinio = { upload: vi.fn(async () => undefined) };
const fakeFetch = { fetchBuffer: vi.fn(async () => ({ buffer: Buffer.alloc(0), contentType: null })) };
const registration = new MediaRegistrationService(prisma as unknown as PrismaService, fakeMinio as any);
const artifactCommit = new ArtifactCommitService(
  prisma as unknown as PrismaService, ledger, teamCredit, intentSvc,
  fakeMinio as any, fakeFetch as any, nodeArtifacts, registration,
);

const PID = `int-t12vf-${Date.now()}`;
const UID = `int-t12vf-owner-${Date.now()}`;
let TID = '';
let PRICING: any;

const claimIntent = async (over: Record<string, unknown> = {}) =>
  intentSvc.claim({
    projectId: PID,
    nodeId: over.nodeId as string ?? `n-${randomUUID().slice(0, 8)}`,
    userId: UID,
    kind: 'video',
    paramsHash: `h-${randomUUID().slice(0, 8)}`,
    teamId: TID,
    pricing: PRICING,
    ...over,
  });

const finalizeFor = (c: { intent: any; artifactRev: number }, over: Record<string, unknown> = {}) =>
  artifactCommit.finalizeVideo({
    projectId: PID, nodeId: c.intent.nodeId, teamId: TID, userId: UID,
    intentRowId: c.intent.id, execSeq: c.intent.execSeq, expectedRev: c.artifactRev,
    sourceUrl: `https://provider.example.com/${randomUUID().slice(0, 8)}.mp4`,
    ...over,
  });

const ledgerRows = (intentRowId: string, type: string) =>
  prisma.teamCreditTransaction.findMany({ where: { teamId: TID, referenceId: `intent:${intentRowId}`, type: type as any } });

const slotRow = (nodeId: string) => prisma.nodeArtifact.findUnique({
  where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId, role: 'primary', targetField: 'fileId', targetItemId: '' } },
});

(hasDb ? describe : describe.skip)('Y1a+Y1b T12 核心一：video finalize-first（真 PG；事务/CAS/settle 全真）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-t12vf-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-t12vf-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 100, frozenDelta: 0, referenceId: `it-t12vf-fund-${Date.now()}`,
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

  it('video finalize 三件套：finalize 单事务建 Media(processing)+NodeArtifact materializing+settle/complete+投影 fileId 交付 mediaId', async () => {
    const c = await claimIntent({ jobId: 't12vf-happy' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    const sourceUrl = `https://provider.example.com/v-${randomUUID().slice(0, 8)}.mp4`;
    const out = await artifactCommit.finalizeVideo({
      projectId: PID, nodeId: c.intent.nodeId, teamId: TID, userId: UID,
      intentRowId: c.intent.id, execSeq: c.intent.execSeq, expectedRev: c.artifactRev,
      sourceUrl, sourceMimeType: 'video/mp4',
    });
    expect(out.outcome).toBe('committed');
    expect(out.mediaId).toBeTruthy();
    // ── 件一：Media 行=processing+sourceUrl 专用列+预分配 key+资金锚（㉔-3：建行不 stage 字节——size=0）──
    const media = await prisma.media.findUnique({ where: { id: out.mediaId! } });
    expect(media!.status).toBe('processing');
    expect(media!.sourceUrl).toBe(sourceUrl);
    expect(media!.sourceUrlExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(media!.sourceUrlExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + ARTIFACT_SOURCE_URL_TTL_MS + 5_000);
    expect(media!.mimeType).toBe('video/mp4');
    expect(media!.key).toBe(`artifacts/${TID}/${c.intent.id}/${c.intent.execSeq}/0`);   // 预分配 base（content-addressed 后缀归 materialize）
    expect(media!.size).toBe(0n);
    expect(media!.sourceIntentRowId).toBe(c.intent.id);
    expect(media!.sourceExecSeq).toBe(c.intent.execSeq);
    expect(media!.artifactIndex).toBe(0);
    expect((media!.metadata as any)?.sourceUrl ?? null).toBeNull();   // 禁入 metadata（media-batch spread 泄漏根修——专用列承载）
    // processing fact 同事务在案（UI「处理中」推送来源——spec :45 P1）
    const procFact = await prisma.mediaFactOutbox.findFirst({ where: { mediaId: media!.id, factType: 'state' } });
    expect(procFact).toBeTruthy();
    expect((procFact!.payload as any)).toMatchObject({ status: 'processing' });
    // ── 件二：NodeArtifact=materializing（㉔-2 四态：video finalize 时 materializing）+fileId 槽 ──
    const art = await slotRow(c.intent.nodeId);
    expect(art!.state).toBe('materializing');
    expect(art!.rev).toBe(1);
    expect(art!.mediaId).toBe(out.mediaId);
    expect(art!.source).toBe('generated');
    expect(art!.sourceIntentRowId).toBe(c.intent.id);
    // binding current-state
    const binding = await prisma.mediaBinding.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: c.intent.nodeId, role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(binding!.mediaId).toBe(out.mediaId);
    // ── 件三：settle/complete+投影 fileId 交付 mediaId（T10 过渡模式：投影行 pending）──
    const intent = await prisma.generationIntent.findUnique({ where: { id: c.intent.id } });
    expect(intent!.status).toBe('SUCCEEDED');
    expect(intent!.resultRef).toBe(out.mediaId);        // video 产物锚=mediaId（旧链=URL——本卡改）
    expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(1);
    const proj = await prisma.artifactProjection.findUnique({ where: { artifactId_artifactRev: { artifactId: art!.id, artifactRev: 1 } } });
    expect(proj!.state).toBe('pending');
    expect(proj!.targetField).toBe('fileId');           // doc 交付键唯一 fileId（videoUrl 词表删除面）
    expect(proj!.mediaId).toBe(out.mediaId);
  });

  it('幂等（同 intent+execSeq 重跑零新行零重扣）：finalizeVideo 已成功后复驱 → committed 同 mediaId+全表恰一行+settle 恰一次', async () => {
    const c = await claimIntent({ jobId: 't12vf-idem' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    const first = await finalizeFor(c);
    expect(first.outcome).toBe('committed');
    const second = await finalizeFor(c);   // 同 sourceUrl 同参数重跑（R3 复驱形态）
    expect(second.outcome).toBe('committed');
    expect(second.mediaId).toBe(first.mediaId);
    expect(await prisma.nodeArtifact.count({ where: { projectId: PID, nodeId: c.intent.nodeId } })).toBe(1);
    expect(await prisma.media.count({ where: { teamId: TID, sourceIntentRowId: c.intent.id } })).toBe(1);   // kill 后重跑不重复 Media
    expect(await prisma.artifactProjection.count({ where: { projectId: PID, nodeId: c.intent.nodeId } })).toBe(1);
    expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(1);
  });

  it('intent-stale（行终态）：不 settle+void 旧冻结——零 Media 行零投影零 NodeArtifact（finalize 事务整体回滚）', async () => {
    const c = await claimIntent({ jobId: 't12vf-stale' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    await intentSvc.void_(c.intent.id, 'deadline exceeded（reaper 预演）', c.intent.execSeq);
    const out = await finalizeFor(c);
    expect(out.outcome).toBe('intent-stale');
    expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(0);
    expect(await ledgerRows(c.intent.id, 'release')).toHaveLength(1);
    expect(await slotRow(c.intent.nodeId)).toBeNull();
    expect(await prisma.media.count({ where: { sourceIntentRowId: c.intent.id } })).toBe(0);
    expect(await prisma.artifactProjection.findFirst({ where: { projectId: PID, nodeId: c.intent.nodeId } })).toBeNull();
  });

  it('资金独立判（superseded）：生成在飞用户 replace → 槽位用户值不被覆盖+照常 settle+Media(processing) 行保留（产物入素材库）', async () => {
    const c = await claimIntent({ jobId: 't12vf-sup' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    const userMedia = `media-user-${randomUUID().slice(0, 6)}`;
    await prisma.$transaction((tx) => nodeArtifacts.casUpsert(tx, {
      projectId: PID, nodeId: c.intent.nodeId, teamId: TID, targetField: 'fileId',
      expectedRev: 0, source: 'replace', state: 'stored', mediaId: userMedia,
    }));
    const balanceBefore = (await prisma.teamBalance.findUnique({ where: { teamId: TID } }))!.credits;
    const out = await finalizeFor(c);
    expect(out.outcome).toBe('superseded');
    const art = await slotRow(c.intent.nodeId);
    expect(art!.mediaId).toBe(userMedia);            // 用户值不被覆盖
    // 照常 settle（资金独立判）——禁「CAS 失败静默丢产物」：Media 行在（processing——materialize 照常物化入素材库）
    expect(await ledgerRows(c.intent.id, 'settle')).toHaveLength(1);
    expect(await ledgerRows(c.intent.id, 'refund')).toHaveLength(0);
    expect((await prisma.generationIntent.findUnique({ where: { id: c.intent.id } }))!.status).toBe('SUCCEEDED');
    const media = await prisma.media.findUnique({ where: { id: out.mediaId! } });
    expect(media).toBeTruthy();
    expect(media!.status).toBe('processing');
    expect((await prisma.teamBalance.findUnique({ where: { teamId: TID } }))!.credits).toBe(balanceBefore);
    const proj = await prisma.artifactProjection.findUnique({ where: { artifactId_artifactRev: { artifactId: art!.id, artifactRev: 1 } } });
    expect(proj!.state).toBe('superseded');
    expect(await prisma.artifactProjection.findFirst({ where: { artifactId: art!.id, state: 'pending' } })).toBeNull();
  });

  it('改锚幂等出口回填（T11 replace 后复驱）：committed 必携 mediaId/key——自资金锚 Media 行回填（非 undefined）', async () => {
    const c = await claimIntent({ jobId: 't12vf-reanchored' });
    await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
    const first = await finalizeFor(c);
    expect(first.outcome).toBe('committed');
    await prisma.$transaction((tx) => nodeArtifacts.casUpsert(tx, {
      projectId: PID, nodeId: c.intent.nodeId, teamId: TID, targetField: 'fileId',
      expectedRev: 1, source: 'replace', state: 'stored', mediaId: 'media-user-reanchored',
    }));
    const second = await finalizeFor(c);   // intent 已 SUCCEEDED∧核销但锚行被 replace 改锚——照走全链由幂等分支收敛
    expect(second.outcome).toBe('committed');
    expect(second.mediaId).toBe(first.mediaId);   // 资金锚 Media 行回填（改前红=undefined）
    expect(second.key).toBe(first.key);
    expect(await prisma.media.count({ where: { teamId: TID, sourceIntentRowId: c.intent.id } })).toBe(1);   // 零新行
  });
});
