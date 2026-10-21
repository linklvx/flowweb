// apps/api/src/modules/artifact-core/node-artifact.int.spec.ts —— Y1a+Y1b T10 核心一（spec Z18''-v14）：
// NodeArtifact=生成产物唯一权威的 CAS 原语真库红绿——claimCapture（claim 事务内读槽位 rev 作
// expectedRev）+casUpsert（WHERE rev=expectedRev 三用共用：0 行=superseded）+胜者规则不变量
// （v11.1：同节点第二 claim→NodeBusy 维持禁开口子；finalize 原子性⇒后发起者 claim 必见新 rev）。
// 红形态（改前可复现）：casUpsert/claimCapture 全仓不存在（编译级红）；claim 返回无 artifactRev 字段。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService, NodeBusyError } from '../execution/generation-intent.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { NodeArtifactService } from './node-artifact.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const nodeArtifacts = new NodeArtifactService();
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService, teamCredit, nodeArtifacts);

const PID = `int-t10na-${Date.now()}`;
const UID = `int-t10na-owner-${Date.now()}`;
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

const slotKey = (nodeId: string) => ({
  projectId_nodeId_role_targetField_targetItemId: {
    projectId: PID, nodeId, role: 'primary', targetField: 'fileId', targetItemId: '',
  },
});

const casUpsert = (nodeId: string, expectedRev: number, over: Record<string, unknown> = {}) =>
  prisma.$transaction((tx) => nodeArtifacts.casUpsert(tx, {
    projectId: PID, nodeId, teamId: TID, targetField: 'fileId',
    expectedRev, source: 'generated', state: 'stored',
    mediaId: `media-gen-${randomUUID().slice(0, 8)}`,
    ...over,
  }));

(hasDb ? describe : describe.skip)('Y1a T10 核心一：NodeArtifact CAS 原语（真 PG）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-t10na-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-t10na-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null }, creditCost: { gt: 0 } } });
    if (!rule) throw new Error('真库无 active 付费 PricingRule——seed 未跑？');
    PRICING = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
  });

  afterAll(async () => {
    await prisma.artifactProjection.deleteMany({ where: { projectId: PID } });
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID } });
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });
    await ledgerWipe(ledger, { teamId: TID });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  });

  describe('claimCapture（claim 事务内读槽位 rev）', () => {
    it('无槽位行 → artifactRev=0（首代 CAS 以 INSERT 分支胜出）；claim 返回新增 artifactRev 字段', async () => {
      const c = await claimIntent({ jobId: 't10na-cap1' });
      expect((c as any).artifactRev).toBe(0);
      await intentSvc.void_(c.intent.id, 't10na cleanup', c.intent.execSeq);
    });

    it('槽位行 rev=5（前代产物）→ claim 捕获 5 作 expectedRev（PG 权威非 doc）', async () => {
      const nodeId = `n-cap2-${randomUUID().slice(0, 6)}`;
      await prisma.nodeArtifact.create({
        data: { projectId: PID, nodeId, teamId: TID, role: 'primary', targetField: 'fileId', targetItemId: '', rev: 5, state: 'stored', mediaId: 'media-old' },
      });
      const c = await claimIntent({ nodeId, jobId: 't10na-cap2' });
      expect((c as any).artifactRev).toBe(5);
      await intentSvc.void_(c.intent.id, 't10na cleanup', c.intent.execSeq);
    });

    it('kind 分支槽位单源：text→result 槽（image 槽 rev 不串读）', async () => {
      const nodeId = `n-cap3-${randomUUID().slice(0, 6)}`;
      // image 槽已有前代行 rev=7；text claim 读 result 槽（无行=0）——两槽互不串
      await prisma.nodeArtifact.create({
        data: { projectId: PID, nodeId, teamId: TID, role: 'primary', targetField: 'fileId', targetItemId: '', rev: 7, state: 'stored', mediaId: 'media-old' },
      });
      const c = await claimIntent({ nodeId, kind: 'text', jobId: 't10na-cap3' });
      expect((c as any).artifactRev).toBe(0);
      await intentSvc.void_(c.intent.id, 't10na cleanup', c.intent.execSeq);
    });
  });

  describe('casUpsert（WHERE rev=expectedRev——finalize/replace/clear 三用共用）', () => {
    it('首写（无行 expectedRev=0）→ INSERT 分支胜：rev=1+mediaId/state 落槽', async () => {
      const nodeId = `n-cas1-${randomUUID().slice(0, 6)}`;
      const r = await casUpsert(nodeId, 0);
      expect(r.won).toBe(true);
      const row = await prisma.nodeArtifact.findUnique({ where: slotKey(nodeId) });
      expect(row!.rev).toBe(1);
      expect(row!.mediaId).toBe(r.mediaId);
      expect(row!.state).toBe('stored');
      expect(row!.source).toBe('generated');
    });

    it('rev 匹配 → 胜：rev+1+新值覆盖（同槽位换代）', async () => {
      const nodeId = `n-cas2-${randomUUID().slice(0, 6)}`;
      await casUpsert(nodeId, 0);
      const r = await casUpsert(nodeId, 1);
      expect(r.won).toBe(true);
      expect(r.rev).toBe(2);
      const row = await prisma.nodeArtifact.findUnique({ where: slotKey(nodeId) });
      expect(row!.rev).toBe(2);
      expect(row!.mediaId).toBe(r.mediaId);
    });

    it('红（v10.1 fileIdRev 洞 A/B 对应面）：生成在飞用户 replace（rev 已+1）→ finalize 携旧 expectedRev → 0 行=superseded 不覆盖用户值', async () => {
      const nodeId = `n-cas3-${randomUUID().slice(0, 6)}`;
      await casUpsert(nodeId, 0); // 前代产物 rev=1
      // 用户 replace（T11 命令形态预演）：槽位 rev 1→2、mediaId=用户替换值
      const userMedia = `media-user-${randomUUID().slice(0, 6)}`;
      await prisma.$transaction((tx) => nodeArtifacts.casUpsert(tx, {
        projectId: PID, nodeId, teamId: TID, targetField: 'fileId',
        expectedRev: 1, source: 'replace', state: 'stored', mediaId: userMedia,
      }));
      // 旧代 finalize 携过期 expectedRev=1 → 0 行
      const r = await casUpsert(nodeId, 1);
      expect(r.won).toBe(false);
      expect(r.rev).toBe(2); // 槽位当前 rev（superseded 投影行锚）
      const row = await prisma.nodeArtifact.findUnique({ where: slotKey(nodeId) });
      expect(row!.mediaId).toBe(userMedia); // 用户值不被覆盖
      expect(row!.rev).toBe(2);
      expect(row!.source).toBe('replace');
    });

    it('反向：replace 后新 claim 捕获新 rev → finalize 正常覆盖（最新意图优先）', async () => {
      const nodeId = `n-cas4-${randomUUID().slice(0, 6)}`;
      await casUpsert(nodeId, 0);
      await prisma.$transaction((tx) => nodeArtifacts.casUpsert(tx, {
        projectId: PID, nodeId, teamId: TID, targetField: 'fileId',
        expectedRev: 1, source: 'replace', state: 'stored', mediaId: 'media-user-x',
      }));
      // 新 claim（rearm/新意图）捕获 rev=2
      const c = await claimIntent({ nodeId, gestureToken: `t10na-cas4-${randomUUID().slice(0, 6)}`, jobId: 't10na-cas4' });
      expect((c as any).artifactRev).toBe(2);
      const r = await casUpsert(nodeId, 2, { sourceIntentRowId: c.intent.id, sourceExecSeq: c.intent.execSeq });
      expect(r.won).toBe(true);
      const row = await prisma.nodeArtifact.findUnique({ where: slotKey(nodeId) });
      expect(row!.rev).toBe(3);
      expect(row!.mediaId).toBe(r.mediaId); // 新代产物覆盖替换值
      await intentSvc.void_(c.intent.id, 't10na cleanup', c.intent.execSeq);
    });
  });

  describe('胜者规则不变量（v11.1——结构性表述，不引入 activeIntentId 列）', () => {
    it('同节点第二 claim（异 paramsHash）→ NodeBusy（RUNNING 闸 Z94 维持禁开口子）', async () => {
      const nodeId = `n-win1-${randomUUID().slice(0, 6)}`;
      const first = await claimIntent({ nodeId, jobId: 't10na-win1' });
      await expect(claimIntent({ nodeId, jobId: 't10na-win1-b' })).rejects.toBeInstanceOf(NodeBusyError);
      await intentSvc.void_(first.intent.id, 't10na cleanup', first.intent.execSeq);
    });

    it('finalize 原子性（intent CAS 与 NodeArtifact CAS 同事务）⇒ 后发起者 claim 必见新 rev（最新意图优先的结构保证）', async () => {
      const nodeId = `n-win2-${randomUUID().slice(0, 6)}`;
      const gen1 = await claimIntent({ nodeId, gestureToken: `t10na-win2-${randomUUID().slice(0, 6)}`, jobId: 't10na-win2' });
      // gen1 finalize：槽位 0→1 + 行终态 SUCCEEDED（同事务性归 artifact-commit.int.spec 全链红测；此处原子面=claim 捕获值）
      await casUpsert(nodeId, 0, { sourceIntentRowId: gen1.intent.id, sourceExecSeq: gen1.intent.execSeq });
      await intentSvc.complete(gen1.intent.id, 'media-gen1', gen1.intent.execSeq);
      // 后发起者（新手势 token=新意图）claim 必见 finalize 后新 rev=1（非 0）
      const gen2 = await claimIntent({ nodeId, gestureToken: `t10na-win2b-${randomUUID().slice(0, 6)}`, jobId: 't10na-win2b' });
      expect((gen2 as any).artifactRev).toBe(1);
      // gen2 finalize 以新 rev 正常胜出（rev=2）
      const r = await casUpsert(nodeId, 1, { sourceIntentRowId: gen2.intent.id, sourceExecSeq: gen2.intent.execSeq });
      expect(r.won).toBe(true);
      expect(r.rev).toBe(2);
      await intentSvc.void_(gen2.intent.id, 't10na cleanup', gen2.intent.execSeq);
    });
  });
});
