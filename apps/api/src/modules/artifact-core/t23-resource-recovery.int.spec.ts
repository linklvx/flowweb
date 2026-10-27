// apps/api/src/modules/artifact-core/t23-resource-recovery.int.spec.ts —— Y1c T23（P3 资源回收族）
// 真库红绿四例（spec §6.3 交付状态机与退款 fencing——B12/B17 继承）：
//  红① 旧 run 迟到退款误命中（时序交错）：RefundObligation pinned (intentRowId,execSeq)——换代后
//      迟到旧义务 drain 零资金动作（让位 SETTLED；unique 幂等=重复 drain 恰一次）；
//  红② lease 过期在飞 reservation 被释放（oversale）：StorageReservation ACTIVE 计入配额硬门
//      （Q7「两并发 presign 同过」收口）+终态释放与锚 pending 行原子同发（迟到 confirm 409）；
//  红③ GC 交错误删：ObjectManifest delete-claim 在位未过=GC 禁删（Y2 变体枚举误删在飞对象收口）
//      +claim 过期∧无 Media.key 引用=有界 orphan 清扫；
//  MaterializeRun fencing：claim 建行 RUNNING（materializeRunId+expectedExecSeq 双锚）——旧 run
//      迟到写回（lease 被新代接管）→ FENCED 让位（B12/B17 继承——与 processingLeaseUntil 值 CAS 双闸）。
// 红形态（改前可复现）：ObjectManifestService 全仓不存在（编译级红——materialize.int.spec 头注同款
// 先例）；红①②=运行时断言红（executor/预留面缺席）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationIntentService } from '../execution/generation-intent.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { NodeArtifactService } from './node-artifact.service';
import { MediaRegistrationService } from './media-registration.service';
import { MaterializeJob } from './materialize-job.service';
import { StorageQuotaService } from '../team/storage-quota.service';
import { ObjectManifestService } from './object-manifest.service';
import { ledgerWipe, deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();
const ledger = new CreditLedgerService(prisma as unknown as PrismaService);
const teamCredit = new TeamCreditService(prisma as unknown as PrismaService, ledger);
const nodeArtifacts = new NodeArtifactService();
const intentSvc = new GenerationIntentService(prisma as unknown as PrismaService, teamCredit, nodeArtifacts);

const fakeMinio = {
  upload: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
};
const fakeQuota = { assertCanUpload: vi.fn(async () => undefined) };
/** 存储限=1000 字节（真库订阅面注入不动——配额门谓词单源在 StorageQuotaService） */
const fakeSub = { getLimits: vi.fn(async () => ({ seatLimit: 1, storageLimitBytes: 1000 })) };
const quota = new StorageQuotaService(prisma as unknown as PrismaService, fakeMinio as any, fakeSub as any);
// T23 收口 I-2：quota 注入第三参（@Optional）——presign 配额门禁事务内消费（Team FOR UPDATE 串行化）
const registration = new MediaRegistrationService(prisma as unknown as PrismaService, fakeMinio as any, quota as any);
const manifests = new ObjectManifestService(prisma as unknown as PrismaService, fakeMinio as any);

const PID = `int-t23rr-${Date.now()}`;
const UID = `int-t23rr-owner-${Date.now()}`;
let TID = '';
let PRICING: any;
/** I-3（收口批）：本套件铸造的 intent 行 id（claim 产出行 id=cuid——前任 afterAll 按
 * intentRowId startsWith 'int-t23rr' 清理恒零命中=残留 18 行实锤；改 in 列表精确清理）。 */
const createdIntentRowIds: string[] = [];

const balanceFrozenOf = async () => {
  // fixture 勘正（前任形态读 TeamBalance.frozenCredits——列不存在）：frozen=台账派生（ΣfrozenDelta，
  // team-credit derivedMonthlyUsed 同域）；credits=TeamBalance 现值。
  const b = await prisma.teamBalance.findUnique({ where: { teamId: TID } });
  const agg = await prisma.teamCreditTransaction.aggregate({ _sum: { frozenDelta: true }, where: { teamId: TID } });
  return { credits: b!.credits, frozen: Number(agg._sum.frozenDelta ?? 0) };
};

(hasDb ? describe : describe.skip)('Y1c T23：资源回收族（RefundObligation/StorageReservation/ObjectManifest/MaterializeRun——真 PG）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-t23rr-owner', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-t23rr-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await ledger.runInTx((tx) => ledger.ensureBalance(tx, TID));
    await ledger.runInTx((tx) => ledger.mutate(tx, {
      teamId: TID, operatorUserId: UID, type: 'register_grant', creditType: 'regular',
      balanceDelta: 100, frozenDelta: 0, referenceId: `it-t23rr-fund-${Date.now()}`,
    }));
    const rule = await prisma.pricingRule.findFirst({ where: { active: true, modelId: { not: null }, creditCost: { gt: 0 } } });
    if (!rule) throw new Error('真库无 active 付费 PricingRule——seed 未跑？');
    PRICING = { pricingRuleId: rule.id, modelId: rule.modelId, resolutionId: rule.resolutionId, durationId: rule.durationId, creditCost: rule.creditCost };
  });

  afterAll(async () => {
    // 测试卫生（T21 c1/t26 教训——共享 dev 库零残留）：本卡新表全 wipe+项目 fixture 清理
    await prisma.storageReservation.deleteMany({ where: { teamId: TID } });
    // fixture 勘正：manifest 行 id=cuid（claim 产出行）——按 objectKey 前缀清（原 id 前缀 'gc-test'
    // 恒零命中=残留源）；红③ 断言 swept===0 依赖库内无他残留。
    await prisma.objectManifest.deleteMany({ where: { objectKey: { startsWith: `artifacts/${TID}/` } } });
    // I-3（收口批）：清理谓词改 in 列表（intentRowId=claim 产出行 cuid 永无 'int-t23rr' 前缀——
    // 前任 startsWith 谓词恒零命中，dev 库残留 18 行实锤已另批清零）。
    await prisma.refundObligation.deleteMany({ where: { intentRowId: { in: createdIntentRowIds } } });
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

  // ── 红①：旧 run 迟到退款误命中（RefundObligation pinned execSeq fence）──
  it('红①：迟到旧义务（pinned execSeq）drain——换代后零资金动作让位 SETTLED；重复 drain 幂等', async () => {
    const nodeId = `n1-${randomUUID().slice(0, 8)}`;
    // fixture 勘正①：c1/c2 共用 paramsHash+gestureToken（同 idemKey 才可达 rearm——前任形态
    // 逐 claim 随机 paramsHash=异键新行恒 'new'）；勘正②：token 8-64 位（normalizeRegenToken 门）。
    const paramsHash = `h-${randomUUID().slice(0, 8)}`;
    const c1 = await intentSvc.claim({
      projectId: PID, nodeId, userId: UID, kind: 'text',
      paramsHash, teamId: TID, pricing: PRICING,
      gestureToken: 'g-t23-1a',
      jobId: `t23-${Date.now()}`,
    });
    expect(c1.result).toBe('new');
    createdIntentRowIds.push(c1.intent.id);
    const N1 = c1.intent.execSeq;
    await teamCredit.reserve(UID, { intentRowId: c1.intent.id, execSeq: N1 });
    // 义务先行落档（collect 面产物——drain 崩溃窗重扫等价形态）
    await prisma.refundObligation.create({
      data: { intentRowId: c1.intent.id, execSeq: N1, reversesId: `intent:${c1.intent.id}`, creditAmount: PRICING.creditCost, state: 'PENDING' },
    });
    // 时序交错前置（fixture 勘正③——前任形态缺本步：rearm 只可达于非 RUNNING 行〔claim ⓪ RUNNING 闸
    // 对异 jobId 直接 NodeBusy〕）：deadline reaper 退役旧代（rollbackRunning=VOIDED+release 旧冻结
    // ——「旧代已随 reaper 释放」），随后用户 rearm 开新代、义务 drain 迟到。
    await teamCredit.rollbackRunning(c1.intent.id, 'deadline-voided（红① 时序交错：旧代 reaper 退役）');
    const c2 = await intentSvc.claim({
      projectId: PID, nodeId, userId: UID, kind: 'text',
      paramsHash, teamId: TID, pricing: PRICING,
      gestureToken: 'g-t23-1a', jobId: `t23-2-${Date.now()}`,
    });
    expect(c2.result).toBe('rearm');
    expect(c2.intent.execSeq).toBeGreaterThan(N1);
    await teamCredit.reserve(UID, { intentRowId: c2.intent.id, execSeq: c2.intent.execSeq });
    const before = await balanceFrozenOf();
    expect(before.frozen).toBe(PRICING.creditCost); // 新代冻结在案（旧代已随 rearm 释放）

    // drain（迟到旧义务）——pinned N1 对 RUNNING@N2 行 0 命中：零资金动作让位
    const drain = await (teamCredit as unknown as { drainRefundObligations: () => Promise<{ settled: number; collected: number }> })
      .drainRefundObligations();
    expect(drain.settled).toBeGreaterThanOrEqual(1);
    const after = await balanceFrozenOf();
    expect(after.frozen).toBe(before.frozen);   // 误命中面：旧义务不得动新代冻结
    const row = await prisma.generationIntent.findUniqueOrThrow({ where: { id: c1.intent.id } });
    expect(row.status).toBe('RUNNING');          // 新代在飞不被旧义务终态化
    expect(row.execSeq).toBe(c2.intent.execSeq);
    const ob = await prisma.refundObligation.findUniqueOrThrow({ where: { intentRowId_execSeq: { intentRowId: c1.intent.id, execSeq: N1 } } });
    expect(ob.state).toBe('SETTLED');
    // 幂等：重复 drain 零新动作（unique(intentRowId,execSeq)）
    const again = await (teamCredit as unknown as { drainRefundObligations: () => Promise<{ settled: number; collected: number }> })
      .drainRefundObligations();
    expect(await balanceFrozenOf()).toEqual(after);
    void again;
  });

  it('T23 收口正路：EXEC_FINALIZE collect+drain——RUNNING 意图义务化收口（FAILED+release 逆转 exact reserve 行）', async () => {
    const nodeId = `n2-${randomUUID().slice(0, 8)}`;
    const c1 = await intentSvc.claim({
      projectId: PID, nodeId, userId: UID, kind: 'text',
      paramsHash: `h-${randomUUID().slice(0, 8)}`, teamId: TID, pricing: PRICING,
      gestureToken: 'g-t23-2b', jobId: `t23-3-${Date.now()}`,
    });
    createdIntentRowIds.push(c1.intent.id);
    await teamCredit.reserve(UID, { intentRowId: c1.intent.id, execSeq: c1.intent.execSeq });
    const before = await balanceFrozenOf();
    const created = await (teamCredit as unknown as { collectExecFinalize: (p: string, n: string) => Promise<number> })
      .collectExecFinalize(PID, nodeId);
    expect(created).toBe(1);
    // 幂等：重复 collect 零新行（unique）
    expect(await (teamCredit as unknown as { collectExecFinalize: (p: string, n: string) => Promise<number> })
      .collectExecFinalize(PID, nodeId)).toBe(0);
    const drain = await (teamCredit as unknown as { drainRefundObligations: () => Promise<{ settled: number; collected: number }> })
      .drainRefundObligations();
    expect(drain.collected).toBeGreaterThanOrEqual(1);
    const row = await prisma.generationIntent.findUniqueOrThrow({ where: { id: c1.intent.id } });
    expect(row.status).toBe('FAILED');           // 交付不可能（节点已删）——终态化
    expect((await balanceFrozenOf()).frozen).toBe(before.frozen - PRICING.creditCost); // 冻结释放
    const released = await prisma.teamCreditTransaction.findFirst({
      where: { teamId: TID, referenceId: `intent:${c1.intent.id}`, type: 'release' },
    });
    expect(released).not.toBeNull();             // release 逆转 exact reserve 行
    const ob = await prisma.refundObligation.findUniqueOrThrow({ where: { intentRowId_execSeq: { intentRowId: c1.intent.id, execSeq: c1.intent.execSeq } } });
    expect(ob.state).toBe('SETTLED');
    expect(ob.reversesId).not.toBe(`intent:${c1.intent.id}`); // reversesId=exact 台账行证据（逆转前查询回填）

    // I-1（收口批）：drain 终态 FAILED 后迟到 reserve 必须被拒——reserve gate 缺 status:'RUNNING'
    // 谓词时三谓词（reservedCredits=0∧creditsConsumed=0∧execSeq）全匹配=对 FAILED 行再冻结+多烧
    // 一次外呼+FAILED∧reservedCredits>0 不变量破坏。红=现状 success:true（再冻结推高 frozen）。
    const frozenAfterDrain = (await balanceFrozenOf()).frozen;
    const late = await teamCredit.reserve(UID, { intentRowId: c1.intent.id, execSeq: c1.intent.execSeq });
    expect(late.success).toBe(false);
    expect((await balanceFrozenOf()).frozen).toBe(frozenAfterDrain);   // 零新冻结
  });

  // ── 红②：lease 过期在飞 reservation 被释放（oversale）──
  it('红②a：Q7 真并发双 presign（fire-and-forget 重叠）——Team FOR UPDATE 串行化后恰一方过门（I-2 收口：assert→insert 无锁非原子根修）', async () => {
    // I-2（收口批裁定=根修不降级）：改前形态「先 await #1 落预留再 assert #2」=串行零并发重叠——
    // 真并发形态=双 presign fire-and-forget（assert 与 insert 在各自事务内重叠）。红=现状 assert
    // 在事务外裸调用：双事务互不见对方未提交预留 ⇒ 双方过门（fulfilled=2=oversale）。
    const stamp = Date.now();
    const [a, b] = await Promise.allSettled([
      registration.prepareUpload({
        userId: UID, teamId: TID, clientUploadId: `up-c1-${stamp}`,
        key: `uploads/t23/c1-${stamp}`, fileName: 'f.png', mimeType: 'image/png', size: 800, type: 'uploaded',
      }),
      registration.prepareUpload({
        userId: UID, teamId: TID, clientUploadId: `up-c2-${stamp}`,
        key: `uploads/t23/c2-${stamp}`, fileName: 'f.png', mimeType: 'image/png', size: 800, type: 'uploaded',
      }),
    ]);
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);           // 恰一方过门（红：现状双方过=2）
    const winner = fulfilled[0] as PromiseFulfilledResult<{ id: string }>;
    const r1 = await prisma.storageReservation.findUnique({ where: { mediaId: winner.value.id } });
    expect(r1).not.toBeNull();
    expect(r1!.state).toBe('ACTIVE');
    expect(r1!.upperBoundBytes).toBe(800n);
    await prisma.storageReservation.updateMany({ where: { mediaId: winner.value.id }, data: { state: 'RELEASED' } }); // 复位（后续用例）
  });

  it('红②b：终态释放与锚行原子——TTL sweep 释放预留后迟到 confirm 409（无「字节已让+行仍可确认」oversale 窗）+confirm→SETTLED', async () => {
    const m = await registration.prepareUpload({
      userId: UID, teamId: TID, clientUploadId: `up-2-${Date.now()}`,
      key: `uploads/t23/x2-${Date.now()}`, fileName: 'f.png', mimeType: 'image/png', size: 500, type: 'uploaded',
    });
    // confirm 正路：SETTLED（实字节入账——预留停止双计）
    await registration.confirmUpload({ mediaId: m.id, actualSize: 500, sniffedMimeType: 'image/png' });
    const settled = await prisma.storageReservation.findUniqueOrThrow({ where: { mediaId: m.id } });
    expect(settled.state).toBe('SETTLED');       // 红：无预留行
    // SETTLED 后不再计入在飞门（confirm 已把实字节计入 usage——双计收口）
    await expect(quota.assertCanUpload(TID, 500)).resolves.toBeUndefined();

    // lease 过期（pendingExpiresAt 已过）——释放必与锚行终态原子同发
    const m2 = await registration.prepareUpload({
      userId: UID, teamId: TID, clientUploadId: `up-3-${Date.now()}`,
      key: `uploads/t23/x3-${Date.now()}`, fileName: 'f.png', mimeType: 'image/png', size: 300, type: 'uploaded',
    });
    await prisma.media.update({ where: { id: m2.id }, data: { pendingExpiresAt: new Date(Date.now() - 1) } });
    await registration.sweepExpiredPending();
    const rel = await prisma.storageReservation.findUnique({ where: { mediaId: m2.id } });
    expect(rel).not.toBeNull();
    expect(rel!.state).toBe('RELEASED');         // 红：TTL sweep 不释放预留（面缺席）
    // 迟到 confirm：行已随释放原子离场——409（在飞上传不能在字节让渡后落账=oversale 窗闭合）
    await expect(registration.confirmUpload({ mediaId: m2.id, actualSize: 300, sniffedMimeType: 'image/png' }))
      .rejects.toMatchObject({ status: 409 });
    // 释放后字节已让渡——配额门恢复（fixture 勘正：usage=500〔m 已 confirm〕在档，入场 500=恰满额；
    // 前任形态传 1000=500+1000>1000 恒拒——「门恢复」语义不可达，改为预留 300 释放后的可入场证明）
    await expect(quota.assertCanUpload(TID, 500)).resolves.toBeUndefined();
  });

  it('红②c：upperBoundBytes 必填 fail-closed——size≤0 拒受理（无上界不入账）', async () => {
    await expect(registration.prepareUpload({
      userId: UID, teamId: TID,
      key: `uploads/t23/x0-${Date.now()}`, fileName: 'f.png', mimeType: 'image/png', size: 0, type: 'uploaded',
    })).rejects.toThrow();                        // 红：现状 size=0 照落 pending 行
  });

  // ── 红③：GC 交错误删（ObjectManifest delete-claim）──
  it('红③：delete-claim 在位未过=GC 禁删（在飞物化键保护——Y2 变体枚举误删面收口）', async () => {
    const key = `artifacts/${TID}/inflight-${Date.now()}/0-abc`;
    const owner = `materialize:${randomUUID().slice(0, 8)}`;
    await manifests.claim(key, owner, Date.now() + 60_000);
    const row = await prisma.objectManifest.findUnique({ where: { objectKey: key } });
    expect(row).not.toBeNull();                  // 红：manifest 面全仓不存在
    expect(row!.claimOwner).toBe(owner);
    expect(row!.state).toBe('LIVE');
    fakeMinio.delete.mockClear();
    const swept = await manifests.sweepOrphans();
    expect(swept).toBe(0);                       // claim 在位=零清扫
    expect(fakeMinio.delete).not.toHaveBeenCalled(); // 交错误删面：在飞键对象不被删
    expect((await prisma.objectManifest.findUniqueOrThrow({ where: { objectKey: key } })).state).toBe('LIVE');
  });

  it('红③b：claim 过期∧无 Media.key 引用=有界 orphan 清扫（对象删+行 DELETED）+release 归锚', async () => {
    const key = `artifacts/${TID}/orphan-${Date.now()}/0-dead`;
    const owner = `materialize:${randomUUID().slice(0, 8)}`;
    await manifests.claim(key, owner, Date.now() - 1_000);   // 已过期（fenced 代遗留变体键——Y2 形态）
    fakeMinio.delete.mockClear();
    const swept = await manifests.sweepOrphans();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(fakeMinio.delete).toHaveBeenCalledWith(key);
    const row = await prisma.objectManifest.findUniqueOrThrow({ where: { objectKey: key } });
    expect(row.state).toBe('DELETED');
    // release 归锚（claimOwner CAS——旧 owner 不清新代 claim）
    const key2 = `artifacts/${TID}/rel-${Date.now()}/0-x`;
    await manifests.claim(key2, owner, Date.now() + 60_000);
    await manifests.claim(key2, `materialize:new-${Date.now()}`, Date.now() + 60_000).catch(() => undefined); // 同键新代接管（M-3(spec) 勘正：claim=无条件接管——当次持有者=最后一次 claim；保护语义在 release owner CAS=旧 owner 不清新代 claim）
    await manifests.releaseClaim(key2, owner);   // 旧 owner 释放——不得清新代 claim
    const row2 = await prisma.objectManifest.findUniqueOrThrow({ where: { objectKey: key2 } });
    expect(row2.claimOwner).not.toBe(null);      // 新代 claim 在位
    expect(row2.claimOwner).not.toBe(owner);
  });

  // ── C-1（收口批）：GC 清扫 TOCTOU——删除动作以删除时点谓词为准（select 后窗：候选谓词只在
  //    SELECT 评估一次，逐行 MinIO IO 秒级窗内新代 claim 同键/锚定先行=误删在飞对象）。
  //    红形态注记（T23 复核 2026-10-27）：本两例红=seam 装置差异（修前 sweepOrphans 旧签名忽略
  //    afterSelect 注入参——spy 注入不生效使红因非「保护态行为差」）；行为差由 quality 探针补证：
  //    旧码对在位新 claim 行仍 minio.delete+置 DELETED=误删实锤。 ──
  it('C-1 红①：select 后新代 claim 同键（在位未过）——对象不得删+行不被 DELETED', async () => {
    const key = `artifacts/${TID}/toctou-claim-${Date.now()}/0-k`;
    const owner = `materialize:${randomUUID().slice(0, 8)}`;
    await manifests.claim(key, owner, Date.now() - 1_000);   // 过期 claim（fenced 代遗留变体键形态）
    fakeMinio.delete.mockClear();
    // 并发窗注入：候选 SELECT 之后、行处理之前——代二同源重物化确定性同键 claim(K,未来)+上传
    const swept = await manifests.sweepOrphans(Date.now(), async () => {
      await manifests.claim(key, `materialize:newgen-${Date.now()}`, Date.now() + 60_000);
    });
    expect(swept).toBe(0);                              // 红：现状 swept=1（CAS 缺席——select 时点谓词直删）
    expect(fakeMinio.delete).not.toHaveBeenCalledWith(key);   // 交错误删面：代二刚上传对象不被删
    expect((await prisma.objectManifest.findUniqueOrThrow({ where: { objectKey: key } })).state).toBe('LIVE');
  });

  it('C-1 红②：select 后锚定先行（Media.key 已引用）——对象不得删+行不被 DELETED', async () => {
    const key = `artifacts/${TID}/toctou-anchor-${Date.now()}/0-k`;
    const owner = `materialize:${randomUUID().slice(0, 8)}`;
    await manifests.claim(key, owner, Date.now() - 1_000);   // 过期 claim
    fakeMinio.delete.mockClear();
    // 并发窗注入：锚定先行（materialize 完成事务已把 Media.key 指向该 content-addressed 键）
    const swept = await manifests.sweepOrphans(Date.now(), async () => {
      await prisma.media.create({
        data: {
          userId: UID, teamId: TID, projectId: PID, bucket: 'flowai', key,
          originalName: 'anchored.mp4', mimeType: 'video/mp4', size: 1, type: 'generated', status: 'completed',
        },
      });
    });
    expect(swept).toBe(0);                              // 红：现状 NOT EXISTS 只在 select 评估——照样删
    expect(fakeMinio.delete).not.toHaveBeenCalledWith(key);
    expect((await prisma.objectManifest.findUniqueOrThrow({ where: { objectKey: key } })).state).toBe('LIVE');
  });

  // ── MaterializeRun fencing（materializeRunId/expectedExecSeq 双锚——B12/B17 继承）──
  it('MaterializeRun：claim 建行 RUNNING（expectedExecSeq=sourceExecSeq）——旧 run 迟到写回（lease 换代）FENCED 让位', async () => {
    const nodeId = `n3-${randomUUID().slice(0, 8)}`;
    const fakeRowId = `int-t23rr-${randomUUID().slice(0, 8)}`;
    const execSeq = 7777n;
    const keyBase = `artifacts/${TID}/${fakeRowId}/${execSeq}/0`;
    const media = await prisma.$transaction((tx) => registration.registerInTx(tx, {
      userId: UID, teamId: TID, projectId: PID, nodeId,
      key: keyBase, sourceUrl: `https://provider.example.com/v-${randomUUID().slice(0, 6)}.mp4`,
      sourceUrlExpiresAt: new Date(Date.now() + 24 * 3600_000),
      mimeType: 'video/mp4', originalName: `ai-${nodeId}.mp4`,
      sourceIntentRowId: fakeRowId, sourceExecSeq: execSeq, artifactIndex: 0,
    }));
    // 代一 claim：MaterializeRun 建行 RUNNING（expectedExecSeq=Media.sourceExecSeq——执行代际族锚）
    const job = new MaterializeJob(
      prisma as unknown as PrismaService, fakeMinio as any,
      { fetchBuffer: vi.fn(async () => { throw new Error('download boom'); }) } as any,
      teamCredit, fakeQuota as any, { emitNodeStatus: vi.fn() } as any,
    );
    const claimed1 = await job.claim();
    expect(claimed1.map((r) => r.id)).toContain(media.id);
    const run1 = await prisma.materializeRun.findFirstOrThrow({
      where: { projectId: PID, nodeId, expectedExecSeq: execSeq, state: 'RUNNING' },
    });
    expect(run1.nodeId).toBe(nodeId);
    // 代二接管（lease 过期→新 claim 建新 run 行；run1 留 RUNNING 陈旧）
    await prisma.media.update({ where: { id: media.id }, data: { processingLeaseUntil: new Date(Date.now() - 1_000) } });
    const claimed2 = await job.claim();
    expect(claimed2.map((r) => r.id)).toContain(media.id);
    const run2 = await prisma.materializeRun.findFirstOrThrow({
      where: { projectId: PID, nodeId, expectedExecSeq: execSeq, state: 'RUNNING' },
      orderBy: { createdAt: 'desc' },
    });
    expect(run2.id).not.toBe(run1.id);
    // 旧 run 迟到写回：lease CAS 0 命中→fenced——run 行让位 FENCED（新代 run 不受污染）
    const oldRow = claimed1.find((r) => r.id === media.id)!;
    const r = await job.materializeRow(oldRow);
    expect(r).toBe('fenced');
    expect((await prisma.materializeRun.findUniqueOrThrow({ where: { id: run1.id } })).state).toBe('FENCED');
    expect((await prisma.materializeRun.findUniqueOrThrow({ where: { id: run2.id } })).state).toBe('RUNNING');
  });
});
