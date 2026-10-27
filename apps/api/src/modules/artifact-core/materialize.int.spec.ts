// apps/api/src/modules/artifact-core/materialize.int.spec.ts —— Y1a+Y1b T12 核心二（spec Z18''-v14
// video materialize 异步；裁决①/⑮/㉔-2；§3.1 伪码「MaterializeJob」）真库红绿：
// SKIP LOCKED claim 恰一+自有 lease/attempts 与 intent attempts/rearm 解耦（T2 materialize 族列名单源：
// processingAttempts/processingLeaseUntil/nextMaterializeAt）；复用同一次下载算 natural/hash/mime 置
// probeState=done；单事务 status=completed+artifactState stored+factVersion/outbox（state+natural 双 fact）；
// 终态失败→幂等补偿退款（rollbackDeliveryFailed——重跑退款恰一次）+artifactState=failed（不清 fileId）
// +errorCode=MATERIALIZE_FAILED（emit 面）；瞬态失败→attempts+1+nextMaterializeAt 退避（源过期 410 重试面）。
// 红形态（改前可复现）：MaterializeJob 全仓不存在（编译级红）；现状 video 下载=ai-download processor
// 直接 completed+writeNodeData videoUrl（旧链）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, Media } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { NodeArtifactService } from './node-artifact.service';
import { MediaRegistrationService } from './media-registration.service';
import { MaterializeJob, MATERIALIZE_MAX_ATTEMPTS } from './materialize-job.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const nodeArtifacts = new NodeArtifactService();
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService, teamCredit, nodeArtifacts);

// fake 基础设施（T10 fixture 桩模式——MinIO 上传产能+下载注入；资金/claim/事务面全真）
const fakeMinio = { upload: vi.fn(async () => undefined) };
const fakeFetch = { fetchBuffer: vi.fn(async () => ({ buffer: Buffer.alloc(0), contentType: null as string | null })) };
const fakeEmit = { emitNodeStatus: vi.fn() };
const fakeQuota = { assertCanUpload: vi.fn(async () => undefined) };
const registration = new MediaRegistrationService(prisma as unknown as PrismaService, fakeMinio as any);
const job = new MaterializeJob(
  prisma as unknown as PrismaService, fakeMinio as any, fakeFetch as any,
  teamCredit, fakeQuota as any, fakeEmit as any,
);

const PID = `int-t12mz-${Date.now()}`;
const UID = `int-t12mz-owner-${Date.now()}`;
let TID = '';
let PRICING: any;
/** ffmpeg/ffprobe 可用性（收集期探针——spawnSync：it/it.skip 分派在 beforeAll 之前求值，异步探针不可用） */
const hasAvTools = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
let MP4: Buffer | null = null;

/** 真 mp4（ffmpeg lavfi testsrc 64x48 1s——media-probe.int.spec 同款夹具；ffmpeg/ffprobe 缺席时成功路用例 skip） */
async function tinyMp4(): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 't12mz-'));
  try {
    const out = join(dir, 'gen.mp4');
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=10',
        '-t', '1', '-pix_fmt', 'yuv420p', '-y', out,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      proc.stderr?.on('data', (c: Buffer) => { err += c.toString(); });
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err))));
      proc.on('error', reject);
    }).catch(() => undefined);
    return await readFile(out).catch(() => null);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface Seed {
  nodeId: string;
  intentId: string;
  execSeq: bigint;
  mediaId: string;
  keyBase: string;
  sourceUrl: string;
}

/** 夹具：SUCCEEDED+已 settle 意图 + registerInTx processing 行 + NodeArtifact materializing——finalize 成功后的世界 */
async function seedMaterializing(over: Record<string, unknown> = {}): Promise<Seed> {
  const nodeId = `n-${randomUUID().slice(0, 8)}`;
  const c = await intentSvc.claim({
    projectId: PID, nodeId, userId: UID, kind: 'video',
    paramsHash: `h-${randomUUID().slice(0, 8)}`, teamId: TID, pricing: PRICING,
    jobId: over['jobId'] as string ?? `t12mz-${Date.now()}`,
  });
  await teamCredit.reserve(UID, { intentRowId: c.intent.id, execSeq: c.intent.execSeq });
  const sourceUrl = `https://provider.example.com/v-${randomUUID().slice(0, 8)}.mp4`;
  const keyBase = `artifacts/${TID}/${c.intent.id}/${c.intent.execSeq}/0`;
  const media = await prisma.$transaction((tx) => registration.registerInTx(tx, {
    userId: UID, teamId: TID, projectId: PID, nodeId,
    key: keyBase, sourceUrl,
    sourceUrlExpiresAt: new Date(Date.now() + 24 * 3600_000),
    mimeType: 'video/mp4', originalName: `ai-${nodeId}.mp4`,
    sourceIntentRowId: c.intent.id, sourceExecSeq: c.intent.execSeq, artifactIndex: 0,
  }));
  await prisma.$transaction((tx) => nodeArtifacts.casUpsert(tx, {
    projectId: PID, nodeId, teamId: TID, targetField: 'fileId',
    expectedRev: 0, source: 'generated', state: 'materializing', mediaId: media.id,
    sourceIntentRowId: c.intent.id, sourceExecSeq: c.intent.execSeq, artifactIndex: 0,
  }));
  // 意图终态 SUCCEEDED+settle（finalize 事务已跑过的等价世界——materialize 只面对这两行）
  await intentSvc.complete(c.intent.id, media.id, c.intent.execSeq);
  await teamCredit.settle({ intentRowId: c.intent.id, execSeq: c.intent.execSeq });
  return { nodeId, intentId: c.intent.id, execSeq: c.intent.execSeq, mediaId: media.id, keyBase, sourceUrl };
}

const ledgerRows = (intentRowId: string, type: string) =>
  prisma.teamCreditTransaction.findMany({ where: { teamId: TID, referenceId: `intent:${intentRowId}`, type: type as any } });

const balanceOf = async () => (await prisma.teamBalance.findUnique({ where: { teamId: TID } }))!.credits;

const anchoredArtifact = (s: Seed) => prisma.nodeArtifact.findUnique({
  where: { sourceIntentRowId_sourceExecSeq_artifactIndex: { sourceIntentRowId: s.intentId, sourceExecSeq: s.execSeq, artifactIndex: 0 } },
});

(hasDb ? describe : describe.skip)('Y1a+Y1b T12 核心二：MaterializeJob（真 PG；MinIO/下载/emit 注入——T10 fixture 桩模式）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-t12mz-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-t12mz-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 100, frozenDelta: 0, referenceId: `it-t12mz-fund-${Date.now()}`,
    }));
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null }, creditCost: { gt: 0 } } });
    if (!rule) throw new Error('真库无 active 付费 PricingRule——seed 未跑？');
    PRICING = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
    MP4 = hasAvTools ? await tinyMp4() : null;
    if (hasAvTools && !MP4) throw new Error('ffmpeg 可用但夹具生成失败（t12mz）');
  });

  afterAll(async () => {
    // Y1c T23 收口（跨套件卫生——claim 自 T23 建 MaterializeRun 行）：run 观测行随项目 fixture 清
    await prisma.materializeRun.deleteMany({ where: { projectId: PID } });
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

  it('双 materialize claim 恰一（SKIP LOCKED/lease CAS）：并发双 claim → 恰一得行+processingLeaseUntil 置位', async () => {
    const s = await seedMaterializing();
    const [a, b] = await Promise.all([job.claim(), job.claim()]);
    const winners = [a, b].filter((rows) => rows.some((r: Media) => r.id === s.mediaId));
    expect(winners).toHaveLength(1);   // 恰一 claim（另一侧 SKIP LOCKED 跳过）
    const row = await prisma.media.findUnique({ where: { id: s.mediaId } });
    expect(row!.processingLeaseUntil!.getTime()).toBeGreaterThan(Date.now());   // lease 置位（列名断言——T2 单源）
    // 复位夹具（后续用例从 processing/无 lease 起跑）
    await prisma.media.update({ where: { id: s.mediaId }, data: { processingLeaseUntil: null, processingAttempts: 0, nextMaterializeAt: null, status: 'failed' } });
  });

  it('claim 门：非 video MIME 的 processing 行不吃（image stage 行排除——mimeType 路由）', async () => {
    const s = await seedMaterializing();
    await prisma.media.update({ where: { id: s.mediaId }, data: { mimeType: 'image/png' } });   // 伪装 image stage 行
    expect(await job.claim()).toEqual([]);
    await prisma.media.update({ where: { id: s.mediaId }, data: { mimeType: 'video/mp4', status: 'failed' } });   // 复位+出池
  });

  (hasAvTools ? it : it.skip)('成功 materialize（真 mp4）：单事务 completed+content-addressed key+复用下载算 natural/hash/mime 置 probeState=done+artifactState stored+state/natural 双 fact', async () => {
    const s = await seedMaterializing();
    fakeFetch.fetchBuffer.mockClear();
    fakeFetch.fetchBuffer.mockResolvedValueOnce({ buffer: MP4!, contentType: 'video/mp4' });
    fakeMinio.upload.mockClear();
    const claimed = await job.claim();
    expect(claimed.map((r: Media) => r.id)).toContain(s.mediaId);
    const r = await job.materializeRow(claimed.find((row: Media) => row.id === s.mediaId)!);
    expect(r).toBe('completed');
    // Media：completed+content-addressed key（base-sha256）+size/sha/sniff+natural（复用同一次下载）+probeState=done
    const media = await prisma.media.findUnique({ where: { id: s.mediaId } });
    const sha = createHash('sha256').update(MP4!).digest('hex');
    expect(media!.status).toBe('completed');
    expect(media!.key).toBe(`${s.keyBase}-${sha}`);
    expect(media!.objectSha256).toBe(sha);
    expect(media!.size).toBe(BigInt(MP4!.length));
    expect(media!.sniffedMimeType).toBe('video/mp4');
    expect(media!.probeState).toBe('done');              // 免 probe 二次下载（spec :45 P1）
    expect(media!.naturalWidth).toBe(64);
    expect(media!.naturalHeight).toBe(48);
    // 同一次下载恰一次（kill 后重跑不重复下载的用例锚）+对象上传恰一次
    expect(fakeFetch.fetchBuffer).toHaveBeenCalledTimes(1);
    expect(fakeMinio.upload).toHaveBeenCalledTimes(1);
    expect(fakeMinio.upload).toHaveBeenCalledWith(`${s.keyBase}-${sha}`, MP4!, 'video/mp4');
    // artifactState：materializing→stored（同事务）
    expect((await anchoredArtifact(s))!.state).toBe('stored');
    expect((await anchoredArtifact(s))!.mediaId).toBe(s.mediaId);   // fileId 不清（交付锚保留）
    // fact outbox：state completed+natural 双 fact 同 factVersion
    const facts = await prisma.mediaFactOutbox.findMany({ where: { mediaId: s.mediaId }, orderBy: { factVersion: 'asc' } });
    const stateDone = facts.filter((f) => f.factType === 'state' && (f.payload as any).status === 'completed');
    const natural = facts.filter((f) => f.factType === 'natural');
    expect(stateDone).toHaveLength(1);
    expect(natural).toHaveLength(1);
    expect(stateDone[0].factVersion).toBe(natural[0].factVersion);
    // kill 后重跑：completed 出池——claim 零命中+复驱 fenced+零二次下载
    expect(await job.claim()).toEqual([]);
    const again = await job.materializeRow(media!);
    expect(again).toBe('fenced');
    expect(fakeFetch.fetchBuffer).toHaveBeenCalledTimes(1);   // 不重复下载
    expect(await prisma.media.count({ where: { teamId: TID, sourceIntentRowId: s.intentId } })).toBe(1);   // 不重复 Media
  }, 60_000);

  it('瞬态失败退避（源过期 410/重试）：fetch 抛 → attempts+1+nextMaterializeAt 未来+lease 清+仍 processing+零退款', async () => {
    const s = await seedMaterializing();
    fakeFetch.fetchBuffer.mockReset();
    fakeFetch.fetchBuffer.mockRejectedValueOnce(new Error('safe-fetch HTTP 410'));   // provider 源过期形态
    const balanceBefore = await balanceOf();
    const claimed = await job.claim();
    const row = claimed.find((r: Media) => r.id === s.mediaId)!;
    const r = await job.materializeRow(row);
    expect(r).toBe('retry-scheduled');
    const media = await prisma.media.findUnique({ where: { id: s.mediaId } });
    expect(media!.status).toBe('processing');                          // 非终态——重试面
    expect(media!.processingAttempts).toBe(1);                          // 自有 attempts（与 intent attempts 解耦）
    expect(media!.nextMaterializeAt!.getTime()).toBeGreaterThan(Date.now());   // 退避（热循环红线：非立即重投）
    expect(media!.processingLeaseUntil).toBeNull();                     // lease 释放（下轮到期可再 claim）
    expect((await prisma.generationIntent.findUnique({ where: { id: s.intentId } }))!.status).toBe('SUCCEEDED');   // 资金面零动作
    expect(await ledgerRows(s.intentId, 'refund')).toHaveLength(0);
    expect(await balanceOf()).toBe(balanceBefore);
    // 退避期 claim 零命中（nextMaterializeAt 未到）
    expect((await job.claim()).some((x: Media) => x.id === s.mediaId)).toBe(false);
    await prisma.media.update({ where: { id: s.mediaId }, data: { status: 'failed' } });   // 复位出池
  });

  it('mismatch 永久类（provider 200 但字节非视频）：一轮即终态——failed+补偿退款+artifactState failed（不清 mediaId）', async () => {
    const s = await seedMaterializing();
    const balanceBefore = await balanceOf();   // seed 已 settle（-c）——退款净零口径（共享钱包前序用例已消耗）
    fakeFetch.fetchBuffer.mockReset();
    // PNG 魔数（sniff 判 image/png——provider 声明 video 但内容非视频）
    fakeFetch.fetchBuffer.mockResolvedValueOnce({
      buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]),
      contentType: 'video/mp4',
    });
    const claimed = await job.claim();
    const r = await job.materializeRow(claimed.find((row: Media) => row.id === s.mediaId)!);
    expect(r).toBe('terminal');
    const media = await prisma.media.findUnique({ where: { id: s.mediaId } });
    expect(media!.status).toBe('failed');
    expect(media!.processingAttempts).toBe(1);   // permanent 一轮即终（非 MAX 才终）
    const art = await anchoredArtifact(s);
    expect(art!.state).toBe('failed');
    expect(art!.mediaId).toBe(s.mediaId);        // 不清 fileId——UI 失败/重试（非撤回交付）
    // 幂等补偿退款：intent VOIDED+refund 恰一+余额回冲（reserve(-c)→settle→refund(+c)=恢复 reserve 前水位）
    expect((await prisma.generationIntent.findUnique({ where: { id: s.intentId } }))!.status).toBe('VOIDED');
    expect(await ledgerRows(s.intentId, 'refund')).toHaveLength(1);
    expect(await balanceOf()).toBe(balanceBefore + PRICING.creditCost);
    // 告警面（emit errorCode=MATERIALIZE_FAILED——api-role/单进程形态下有义；worker 进程=计数 no-op）
    expect(fakeEmit.emitNodeStatus).toHaveBeenCalledWith(PID, expect.objectContaining({
      nodeId: s.nodeId, status: 'error', error: expect.stringContaining('MATERIALIZE_FAILED'),
    }));
    // P1：errorCode durable 进事实流（failed fact payload——T16 pendingFacts 消费=UI 失败/重试真实通道；
    // worker EmitPort=no-op，事实流是双进程拓扑下唯一可达载道）
    const failedFact = await prisma.mediaFactOutbox.findFirst({
      where: { mediaId: s.mediaId, factType: 'state' }, orderBy: { factVersion: 'desc' },
    });
    expect((failedFact!.payload as any)).toMatchObject({ status: 'failed', errorCode: 'MATERIALIZE_FAILED' });
    expect((failedFact!.payload as any).error).toEqual(expect.stringContaining('MATERIALIZE_FAILED'));   // intent.error 同源锚
  });

  it('终态失败（attempts 耗尽）补偿退款幂等：重跑退款恰一次（rollbackDeliveryFailed CAS 语义）', async () => {
    const s = await seedMaterializing();
    await prisma.media.update({ where: { id: s.mediaId }, data: { processingAttempts: MATERIALIZE_MAX_ATTEMPTS - 1 } });
    fakeFetch.fetchBuffer.mockReset();
    fakeFetch.fetchBuffer.mockRejectedValue(new Error('safe-fetch HTTP 410'));
    fakeEmit.emitNodeStatus.mockClear();
    const claimed = await job.claim();
    const r1 = await job.materializeRow(claimed.find((row: Media) => row.id === s.mediaId)!);
    expect(r1).toBe('terminal');
    expect((await prisma.generationIntent.findUnique({ where: { id: s.intentId } }))!.status).toBe('VOIDED');
    expect(await ledgerRows(s.intentId, 'refund')).toHaveLength(1);
    const balanceAfterFirst = await balanceOf();
    // 重跑（终态后迟归 worker/人工重驱形态）：refund 恰一次（幂等）+零二次 emit
    const staleRow = await prisma.media.findUnique({ where: { id: s.mediaId } });
    const r2 = await job.materializeRow(staleRow!);
    expect(r2).toBe('fenced');
    expect(await ledgerRows(s.intentId, 'refund')).toHaveLength(1);   // 重跑退款恰一次
    expect(await balanceOf()).toBe(balanceAfterFirst);
    expect(fakeEmit.emitNodeStatus).toHaveBeenCalledTimes(1);
    expect((await anchoredArtifact(s))!.state).toBe('failed');
  });

  it('P2-② lease fence：旧代 lease 过期被新代接管 → 旧代 fail/终态写回 0 行——不清新代 lease/不叠 attempts/不投退避/零退款', async () => {
    // ── 瞬态面：旧代迟归失败写回被 lease CAS 拦截 ──
    const s1 = await seedMaterializing();
    const gen1 = await job.claim();
    const row1 = gen1.find((r: Media) => r.id === s1.mediaId)!;
    expect(row1.processingLeaseUntil).toBeTruthy();   // 本代 lease（claim 置位——写回 CAS 锚）
    // 模拟 lease 过期+新代接管（旧 worker 仍在下载中——长视频窗）
    await prisma.media.update({ where: { id: s1.mediaId }, data: { processingLeaseUntil: new Date(Date.now() - 1_000) } });
    const gen2 = await job.claim();
    const row2 = gen2.find((r: Media) => r.id === s1.mediaId)!;
    const newLease = row2.processingLeaseUntil!;
    expect(newLease.getTime()).not.toBe(row1.processingLeaseUntil!.getTime());
    fakeFetch.fetchBuffer.mockReset();
    fakeFetch.fetchBuffer.mockRejectedValue(new Error('safe-fetch HTTP 410'));
    const r1 = await job.materializeRow(row1);   // 旧代迟归失败
    expect(r1).toBe('fenced');                    // 旧红：现状写回命中（status-only 守卫）→ 'retry-scheduled' 污染新代
    const media1 = await prisma.media.findUnique({ where: { id: s1.mediaId } });
    expect(media1!.processingAttempts).toBe(0);                                 // 不叠计数
    expect(media1!.nextMaterializeAt).toBeNull();                               // 不投退避（新代正持有）
    expect(media1!.processingLeaseUntil!.getTime()).toBe(newLease.getTime());   // 新代 lease 不被清（并发双下载窗根修）
    expect(media1!.status).toBe('processing');
    expect((await prisma.generationIntent.findUnique({ where: { id: s1.intentId } }))!.status).toBe('SUCCEEDED');   // 零资金动作
    // ── 终态面：旧代 attempts 耗尽的迟归终态——lease 失守即放弃（不退款不置 failed）──
    const s2 = await seedMaterializing();
    await prisma.media.update({ where: { id: s2.mediaId }, data: { processingAttempts: MATERIALIZE_MAX_ATTEMPTS - 1 } });
    const g1 = await job.claim();
    const old2 = g1.find((r: Media) => r.id === s2.mediaId)!;
    await prisma.media.update({ where: { id: s2.mediaId }, data: { processingLeaseUntil: new Date(Date.now() - 1_000) } });
    const g2 = await job.claim();   // 新代接管 s2
    expect(g2.some((r: Media) => r.id === s2.mediaId)).toBe(true);
    const r2 = await job.materializeRow(old2);   // 旧代 attempts=MAX 迟归 → 终态路径
    expect(r2).toBe('fenced');                    // 旧红：现状照发退款+置 failed——新代在飞被终结
    const media2 = await prisma.media.findUnique({ where: { id: s2.mediaId } });
    expect(media2!.status).toBe('processing');
    expect(media2!.processingAttempts).toBe(MATERIALIZE_MAX_ATTEMPTS - 1);   // 不叠计数
    expect(await ledgerRows(s2.intentId, 'refund')).toHaveLength(0);          // 终态退款也不发（lease 失守放弃）
    expect((await prisma.generationIntent.findUnique({ where: { id: s2.intentId } }))!.status).toBe('SUCCEEDED');
    expect((await anchoredArtifact(s2))!.state).toBe('materializing');        // 不被旧代终结
  });

  it('Critical#1：退款抛错（瞬态 lock_timeout 族）→ 终态放弃（行留 processing 未置 failed 零 emit）；重 claim 重走终态 → 退款恰一次+failed 收敛', async () => {
    const s = await seedMaterializing();
    await prisma.media.update({ where: { id: s.mediaId }, data: { processingAttempts: MATERIALIZE_MAX_ATTEMPTS - 1 } });
    fakeFetch.fetchBuffer.mockReset();
    fakeFetch.fetchBuffer.mockRejectedValue(new Error('safe-fetch HTTP 410'));
    fakeEmit.emitNodeStatus.mockClear();
    // 第一轮：退款抛错（模拟 lock_timeout/死锁/池超时瞬态）——终态必须放弃
    const rollbackSpy = vi.spyOn(teamCredit, 'rollbackDeliveryFailed').mockRejectedValueOnce(new Error('db lock timeout'));
    const c1 = await job.claim();
    const r1 = await job.materializeRow(c1.find((row: Media) => row.id === s.mediaId)!);
    expect(r1).toBe('fenced');   // 旧红：现状 catch 吞错继续置 failed → 'terminal'（退款永不发生面）
    const m1 = await prisma.media.findUnique({ where: { id: s.mediaId } });
    expect(m1!.status).toBe('processing');                                  // 不置 failed（置了=failed 行永不再 claim→退款永不发生）
    expect(m1!.processingLeaseUntil).toBeNull();                            // 本代已释放（best-effort）——下轮 claim 即重试
    expect(fakeEmit.emitNodeStatus).not.toHaveBeenCalled();                 // 未终态零 emit
    expect(await ledgerRows(s.intentId, 'refund')).toHaveLength(0);
    expect((await prisma.generationIntent.findUnique({ where: { id: s.intentId } }))!.status).toBe('SUCCEEDED');
    rollbackSpy.mockRestore();
    // 第二轮：重 claim（lease 已释放）→ 同瞬态失败 → attempts 仍达 MAX → 终态重走：退款成功恰一次+收敛
    const c2 = await job.claim();
    expect(c2.some((row: Media) => row.id === s.mediaId)).toBe(true);
    const r2 = await job.materializeRow(c2.find((row: Media) => row.id === s.mediaId)!);
    expect(r2).toBe('terminal');
    expect(await ledgerRows(s.intentId, 'refund')).toHaveLength(1);   // 退款恰一次（重试收敛）
    expect((await prisma.generationIntent.findUnique({ where: { id: s.intentId } }))!.status).toBe('VOIDED');
    expect((await prisma.media.findUnique({ where: { id: s.mediaId } }))!.status).toBe('failed');
    expect((await anchoredArtifact(s))!.state).toBe('failed');
    const failedFact = await prisma.mediaFactOutbox.findFirst({
      where: { mediaId: s.mediaId, factType: 'state' }, orderBy: { factVersion: 'desc' },
    });
    expect((failedFact!.payload as any).errorCode).toBe('MATERIALIZE_FAILED');
  });
});
