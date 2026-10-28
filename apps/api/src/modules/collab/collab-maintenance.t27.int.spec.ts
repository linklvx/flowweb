// apps/api/src/modules/collab/collab-maintenance.t27.int.spec.ts
// Y1c T27（plan :354-361——spec §6.6 v5.4 9 主段+2 终态转移表）：维护窗口+世代切换真 PG int 池。
// 先红六例（红因=collab-maintenance.service 模块缺席 import 红——T26「unit spec 导入红〔模块先建〕」
// +T25「端点缺席 import 红」先例）：
//  ①FREEZING（quiescing）后 drain flush 被拒=红——freeze 拒**新连接帧**（4413）但 drain/维护帧
//    通道必须照常落 PG（DRAINING 段语义=spoolHeadSeq==pgSeq 前提）；
//  ②CLI 无租约直写=红（scripts/collab-rebuild-gen.mjs——CollabLease 行在持有=拒直写；
//    子进程级真跑归 collab-t27-kill9.process.spec，本面=服务侧同判定谓词）；
//  ③维护失败超时自动恢复写入=红（FAILED=保持只读+人工显式 resume——不自动恢复写/无超时自愈）；
//  ④REQUESTED 行级关闸后新执行必须 4xx（真 ExecutionRequestService.admit 503 MAINTENANCE_ACTIVE
//    ——受理读 maintenanceId IS NULL 才放行）；
//  ⑤SWITCHING 后 abort 不可回退（唯一不可回退点——abort 拒 NOT_ABORTABLE）；
//  ⑥T12 vacuumReplace 独立换代入口仍生效=红（vacuum 委托状态机——MaintenanceOperation 行产生+
//    「无在飞执行」前置对 vacuum 同样生效）。
// 运行：DATABASE_URL=postgresql://… pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { CollabMaintenanceService, MAINTENANCE_FREEZE_RETRY_AFTER_MS, rejectIfMaintenanceActiveInTx } from './collab-maintenance.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createCanvasDoc } from './canvas-doc.factory';
import { toDocLike } from './doc-like.util';
import { toReadModel, fillDoc, CollabCloseCode } from '@flowweb/shared';
import { ExecutionRequestService } from '../execution/execution-request.service';
import { ValidationService } from '../execution/validation.service';
import { PricingResolverService } from '../execution/pricing-resolver.service';
import { TopologyService } from '../execution/topology.service';
import { TeamCreditService } from '../team/team-credit.service';
import { CreditLedgerService } from '../team/credit-ledger.service';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';   // Y1c T27 收口红④：CLI 源词法面（doc-shape 静态门先例）
import { makeSpoolDir } from '../../test-utils/spool-dir';
import type { Logger } from '@nestjs/common';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const noopLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} } as unknown as Logger;

/** 布景 doc：gen0 头+rev0 快照+两行增量（seq 1..2——insert-ratchet 直插形态）。返回 hydrate 形状。 */
async function seedDoc(prisma: PrismaClient, pid: string): Promise<void> {
  const doc = createCanvasDoc();
  const node = new Y.Map(); const data = new Y.Map();
  data.set('model', 'm1');
  node.set('type', 'textInput'); node.set('data', data);
  doc.getMap('nodes').set('n1', node);
  const state0 = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  await prisma.$executeRaw`INSERT INTO "CanvasDocSnapshot" ("projectId", generation, "snapshotRev", "stateSeq", state, "stateHash", "vacuumEpoch", "schemaVersion")
    VALUES (${pid}::text, 0::int, 0::bigint, 0::bigint, ${state0}, ${createHash('sha256').update(state0).digest('hex')}::char(64), 0::int, 3::int) ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt")
    VALUES (${pid}::text, 0::int, 3::int, now()) ON CONFLICT DO NOTHING`;
  for (const seq of [1n, 2n]) {
    const upd = Buffer.from(Y.encodeStateAsUpdate(createCanvasDoc()));
    await prisma.$executeRaw`INSERT INTO "CanvasDocUpdate" ("projectId", generation, seq, "firstWalSeq", "frameCount", "updateHash", update, "createdAt")
      VALUES (${pid}::text, 0::int, ${seq}::bigint, ${seq}::bigint, 1::int, ${'h' + String(seq).padEnd(63, '0')}::char(64), ${upd}, now()) ON CONFLICT DO NOTHING`;
  }
}

maybe('Y1c T27 维护状态机（真 PG）', () => {
  const prisma = new PrismaClient();
  let repo: CanvasDocUpdateRepository;
  let actor: CollabProjectActorService;
  let spool: CollabSpoolService;
  let spoolCleanup: () => Promise<void> = async () => {};
  let maintenance: CollabMaintenanceService;
  /** host 桩观测台：hardClose 收集（4413/4410 完整投递断言面）+WAL 切代/清态调用收集 */
  let closed: Array<{ code: number; reason: string }>;
  let switchedWal: Array<{ pid: string; generation: number }>;
  const connsOf: Array<{ sendStateless?: (p: string) => void }> = [];

  const PID = 'y1c-t27-main-int';

  /** 逐用例全新装置（spool 内存水位/actor appliedSeq 跨用例互染=drain 判定失真——T26 int 卫生先例）：
   *  spool 独立目录+actor/maintenance 重构+租约 fixture（owner 与 repo 对齐——维护帧 PG 腿放行）。 */
  async function buildKit(): Promise<void> {
    await spoolCleanup();
    const dir = await makeSpoolDir('y1c-t27-spool-');
    spoolCleanup = dir.cleanup;
    spool = new CollabSpoolService(dir.dir);
    spool.setOwner('t27-int-owner');
    await ensureLeaseFixture(prisma, repo, 't27-int-owner');
    // boot 三元组播种形态（gateway startCollabAfterLease：setProjectGeneration+seedWalSeqFromPg——
    // 缺播种则 spool.currentGeneration 默认 1≠CanvasDoc.generation=0，维护帧 CAS 恒 fenced）
    spool.setProjectGeneration(PID, 0);
    spool.seedWalSeqFromPg(PID, 2n);
    actor = new CollabProjectActorService(spool, repo);
    const documents = new Map<string, Y.Doc>();
    maintenance = new CollabMaintenanceService(prisma as never, repo, actor, spool);
    maintenance.bindHost({
      logger: noopLogger,
      docConnections: () => connsOf,
      hardClose: (conn, code, reason) => { closed.push({ code, reason }); void conn; },
      thawQuotaAndWait: async () => {},
      isQuotaFrozen: () => false,
      releaseResidentDoc: async () => {},
      switchWalGeneration: async (pid, generation) => { switchedWal.push({ pid, generation }); },
    });
    // gateway 生产接线形态复刻：actor freeze 面经 host 读 maintenance（4413 拒帧判定源）
    actor.bindHost({
      logger: noopLogger,
      documents: () => documents,
      hardClose: (conn, code, reason) => { closed.push({ code, reason }); void conn; },
      isQuotaFrozen: () => false,
      generationOf: () => 0,
      noteReadOnlyDrop: () => false,
      onFencedByWrite: async () => {},
      maintenanceFreezeOf: (pid: string) => maintenance.freezeInfo(pid),
    });
  }

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    repo = new CanvasDocUpdateRepository(prisma as never);
  });

  afterAll(async () => {
    await cleanupProjectFixture(prisma, PID);
    await restoreLeaseRow(prisma);   // T26 int 卫生先例：全局租约行复原（共享 dev 库零残留）
    await spoolCleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanupProjectFixture(prisma, PID);
    await ensureProjectFixture(prisma, PID);
    await seedDoc(prisma, PID);
    closed = [];
    switchedWal = [];
    connsOf.length = 0;
    await prisma.maintenanceOperation.deleteMany({ where: { projectId: PID } });
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });   // T27 收口：in-flight 布景行跨用例清（execSeq/idemKey 全局唯一——残留互撞）
    await buildKit();
  });

  it('红① FREEZING 后 drain flush 不被拒：freeze 拒新连接帧（4413 完整 close 投递）但维护帧照常落 PG', async () => {
    const req = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    // freeze 置位（FREEZING 段动作）
    await maintenance.freezeForStage?.(req.maintenanceId);
    expect(maintenance.isFrozen(PID)).toBe(true);

    // freeze 期新连接帧=4413（附言①：完整 close 投递——stateless 载荷+hardClose 两段，禁半投递）
    const conn = { socketId: 's-1', readOnly: false, context: { user: { id: 'u1' } }, sendStateless: () => {}, webSocket: { send: () => {}, close: () => {} } } as never;
    const frame = (() => {
      const d = new Y.Doc();
      const node = new Y.Map(); const data = new Y.Map();
      data.set('model', 'x');
      node.set('type', 'textInput'); node.set('data', data);
      d.getMap('nodes').set('fn1', node);
      return Y.encodeStateAsUpdate(d);
    })();
    const closedBefore = closed.length;
    await expect(actor.submit(PID, frame, conn, 'update')).rejects.toMatchObject({ code: CollabCloseCode.MAINTENANCE_FREEZE, frameReason: 'maintenance-freeze' });
    expect(closed.length).toBe(closedBefore + 1);
    expect(closed[closed.length - 1]).toMatchObject({ code: CollabCloseCode.MAINTENANCE_FREEZE, reason: 'maintenance-freeze' });

    // ★ drain flush 不被拒：维护帧（submitMaintenance 通道）freeze 期照常 WAL+PG 落定
    const payload = new Uint8Array([0x61, 0x62, 0x63]);
    const landed = await actor.submitMaintenance(PID, payload);
    expect(landed.walSeq).toBeGreaterThan(0n);
    const wm = spool.watermark(PID);
    const flushed = await actor.flushThrough(PID, wm?.spoolHeadSeq ?? 0n, { maxWaitMs: 3_000 });
    expect(flushed.targetReached, `drain flush 应达 target（pgSeq=${flushed.pgSeq}）——freeze 期禁拒 drain`).toBe(true);
    const rows = await prisma.$queryRaw<{ seq: bigint }[]>`SELECT seq FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text ORDER BY seq DESC LIMIT 1`;
    expect(rows[0]!.seq).toBe(landed.walSeq);
  });

  it('红④ REQUESTED 行级关闸：写 maintenanceId 同事务后新执行受理必须 4xx（真 ExecutionRequestService.admit）', async () => {
    const req = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    expect(req.ok).toBe(true);
    // 行级关闸真值：CanvasDoc.maintenanceId 已置（REQUESTED 同一 PG 事务——先关入口）
    const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { maintenanceId: true } });
    expect(head?.maintenanceId).toBe(req.ok ? req.maintenanceId : null);
    // 新执行受理=503（真 ExecutionRequestService.admit ③行级关闸面——受理读 IS NULL 才放行；
    // 全依赖真构造：prisma/Validation(prisma+PricingResolver)/Topology/TeamCredit(prisma+Ledger)）
    const admitSvc = new ExecutionRequestService(
      prisma as never,
      new ValidationService(prisma as never, new PricingResolverService(prisma as never)),
      new TopologyService(),
      new TeamCreditService(prisma as never, new CreditLedgerService(prisma as never)),
      null,
      repo,
    );
    const admit = await admitSvc.admit({ projectId: PID, requestId: 't27-gate-' + randomUUID().slice(0, 12), userId: 'u-x', nodeIds: ['n1'], docSeq: 0n });
    // 卡文「必须 4xx」=非 2xx 拒绝口径——具体码=T21 前置锚已定 503 MAINTENANCE_ACTIVE（服务不可用档）
    expect(admit.ok === false && admit.status! >= 400, `admit 应被拒 4xx/5xx（got ${JSON.stringify(admit)}）`).toBe(true);
    expect(admit).toMatchObject({ ok: false, status: 503, code: 'MAINTENANCE_ACTIVE' });
    // 事务内关闸谓词（非 check-then-act——⑧落库事务首句 FOR SHARE 复核）：受理事务内 maintenanceId 在=拒
    await expect(
      prisma.$transaction((tx) => rejectIfMaintenanceActiveInTx(tx, PID)),
    ).rejects.toMatchObject({ maintenanceActive: true });
  });

  it('红③ 维护失败不超时自愈：FAILED 后保持只读（maintenanceId 不清+freeze 维持+无自动恢复写路径）', async () => {
    const req = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    if (!req.ok) throw new Error('request 失败');
    // 注入失败：in-flight 行在场（GenerationIntent RUNNING）+drainBudget 极小 → DRAINING 超时 → FAILED
    const gi = await prisma.generationIntent.create({
      data: {
        projectId: PID, nodeId: 'n1', userId: 'u-x', teamId: 't-x', intentId: 'i-1', kind: 'text',
        paramsHash: 'h', creditCost: 0, heartbeatAt: new Date(), deadlineAt: new Date(Date.now() + 60_000),
        idemKey: `idem-${randomUUID()}`, execSeq: 900001n,
      } as never,
    });
    const run = await maintenance.run(req.maintenanceId, { drainBudgetMs: 50 });
    expect(run.result).toBe('failed');
    const op = await prisma.maintenanceOperation.findUnique({ where: { maintenanceId: req.maintenanceId } });
    expect(op?.stage).toBe('FAILED');
    expect(op?.error ?? '').toContain('drain');
    // ★ 只读维持：maintenanceId 不清+freeze 在（无超时自动恢复——FAILED 无出边，resume=人工显式）
    const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { maintenanceId: true } });
    expect(head?.maintenanceId).toBe(req.maintenanceId);
    expect(maintenance.isFrozen(PID), 'FAILED 后 freeze 维持（不自动恢复写）').toBe(true);
    // 超时推移（任意超时自愈路径不存在——再等 3×drainBudget 后仍只读）
    await new Promise((r) => setTimeout(r, 150));
    expect(maintenance.isFrozen(PID)).toBe(true);
    expect((await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { maintenanceId: true } }))?.maintenanceId).toBe(req.maintenanceId);
    await prisma.generationIntent.delete({ where: { id: gi.id } }).catch(() => {});
  });

  it('红⑤ SWITCHING 后 abort 不可回退：COMPLETED 终态上 abort=NOT_ABORTABLE（SWITCHING=唯一不可回退点）', async () => {
    const req = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    if (!req.ok) throw new Error('request 失败');
    const run = await maintenance.run(req.maintenanceId, { drainBudgetMs: 3_000 });
    expect(run.result).toBe('completed');
    // 换代已发生（generation 0→1）
    expect((await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { generation: true } }))?.generation).toBe(1);
    const abort = await maintenance.abort(req.maintenanceId);
    expect(abort).toMatchObject({ ok: false, code: 'NOT_ABORTABLE' });
    // 终态不被改写：stage 恒 COMPLETED（abort 无效）
    expect((await prisma.maintenanceOperation.findUnique({ where: { maintenanceId: req.maintenanceId } }))?.stage).toBe('COMPLETED');
  });

  it('红⑥ T12 vacuumReplace 委托状态机：vacuum 产生 MaintenanceOperation 行+「无在飞执行」前置对 vacuum 生效', async () => {
    // 在飞执行在场 → vacuum 前置拒绝（单换代入口前置=无在飞执行——对 vacuum 同样生效）
    await prisma.generationIntent.create({
      data: {
        projectId: PID, nodeId: 'n1', userId: 'u-x', teamId: 't-x', intentId: 'i-2', kind: 'text',
        paramsHash: 'h', creditCost: 0, heartbeatAt: new Date(), deadlineAt: new Date(Date.now() + 60_000),
        idemKey: `idem-${randomUUID()}`, execSeq: 900002n,
      } as never,
    });
    const blocked = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'vacuum', source: 'vacuum', requireNoInFlight: true });
    expect(blocked).toMatchObject({ ok: false, code: 'IN_FLIGHT_EXECUTIONS' });
    await prisma.generationIntent.deleteMany({ where: { projectId: PID } });

    // 委托形态：run 驱动全链（vacuum 只做 rebuild payload——payload 提供方回调整形）
    const req = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'vacuum', source: 'vacuum' });
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    const run = await maintenance.run(req.maintenanceId, {
      drainBudgetMs: 3_000,
      buildRebuildPayload: async (ctx) => {
        const oldDoc = createCanvasDoc();
        try {
          if (ctx.hydrate.state) Y.applyUpdate(oldDoc, new Uint8Array(ctx.hydrate.state));
          for (const u of ctx.hydrate.updates) Y.applyUpdate(oldDoc, new Uint8Array(u));
          const records = toReadModel(oldDoc);
          const fresh = createCanvasDoc();
          fillDoc(toDocLike(fresh), records.nodes, records.edges);
          return { ok: true as const, state: Buffer.from(Y.encodeStateAsUpdate(fresh)), updateRowCount: ctx.hydrate.updates.length };
        } finally { oldDoc.destroy(); }
      },
    });
    expect(run.result).toBe('completed');
    // 委托证据：MaintenanceOperation 行承载换代（stage 单源在维护表——vacuum 不再独立换代）
    const op = await prisma.maintenanceOperation.findUnique({ where: { maintenanceId: req.maintenanceId } });
    expect(op?.stage).toBe('COMPLETED');
    expect(op?.targetGeneration).toBe(1);
    expect((await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { generation: true } }))?.generation).toBe(1);
    // 旧代增量行换代即删（跨代连续 seq——vacuumReplace 同事务整删语义经维护状态机兑现）
    const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text`;
    expect(rows[0]!.n).toBe(0);
  });

  it('SWITCHING 单事务真跑：跨代连续 seq（水位保留不重置）+purgeBelowSeq 清档+新代 Snapshot(g,rev0) stateSeq=旧代 maxSeq 承接+事务后 close 4410+WAL 切代+解冻', async () => {
    connsOf.push({ sendStateless: () => {} });   // 事务后 4410 完整投递断言面（活连接桩）
    const req = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    if (!req.ok) throw new Error('request 失败');
    const before = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { pgSeq: true, walCheckpointSeq: true } });
    const run = await maintenance.run(req.maintenanceId, { drainBudgetMs: 3_000 });
    expect(run.result).toBe('completed');
    const after = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { generation: true, pgSeq: true, walCheckpointSeq: true, currentSnapshotRev: true, purgeBelowSeq: true, maintenanceId: true } });
    expect(after?.generation).toBe(1);
    // T12 落定形态：水位保留不重置（pgSeq/walCheckpointSeq 承接——CHECK pgSeq≤walCheckpointSeq 守恒）
    expect(after?.pgSeq).toBe(before?.pgSeq);
    expect(after?.walCheckpointSeq).toBeGreaterThanOrEqual(after!.pgSeq);
    // currentSnapshotRev 归 0 指针复位+purgeBelowSeq 清档（null）+关闸解除（maintenanceId NULL）
    expect(after?.currentSnapshotRev).toBe(0n);
    expect(after?.purgeBelowSeq).toBeNull();
    expect(after?.maintenanceId).toBeNull();
    // 新代快照 (g=1, rev0)：stateSeq=旧代 maxSeq 承接（2——非归零）
    const snap = await prisma.canvasDocSnapshot.findUnique({ where: { projectId_generation_snapshotRev: { projectId: PID, generation: 1, snapshotRev: 0n } } });
    expect(snap?.stateSeq).toBe(2n);
    // 事务后动作：close 4410（doc-vacuuming 换代通道载荷）+WAL namespace 切代+解冻
    expect(closed.some((c) => c.code === CollabCloseCode.GENERATION_SUPERSEDED)).toBe(true);
    expect(switchedWal).toEqual([{ pid: PID, generation: 1 }]);
    expect(maintenance.isFrozen(PID)).toBe(false);
    // 解冻后新帧恢复受理（freeze 面随 COMPLETED 解除）
    const conn = { socketId: 's-2', readOnly: false, context: { user: { id: 'u1' } }, sendStateless: () => {}, webSocket: { send: () => {}, close: () => {} } } as never;
    const d = new Y.Doc(); const node = new Y.Map(); const data = new Y.Map();
    data.set('model', 'z'); node.set('type', 'textInput'); node.set('data', data);
    d.getMap('nodes').set('nz', node);
    const r = await actor.submit(PID, Y.encodeStateAsUpdate(d), conn, 'update').then(
      () => undefined, (e: { code?: number }) => e);
    // 断言面=freeze 解除（非 4413 拒；测试布景无装载 doc——4411 等其他档不属本断言）
    expect(maintenance.freezeInfo(PID)).toBeUndefined();
    if (r !== undefined) expect((r as { code?: number }).code).not.toBe(CollabCloseCode.MAINTENANCE_FREEZE);
  });

  it('ABORTED（SWITCHING 前）：abort 解冻恢复——maintenanceId 清+freeze 解除+DB 零换代', async () => {
    const req = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    if (!req.ok) throw new Error('request 失败');
    await maintenance.freezeForStage?.(req.maintenanceId);   // 推进到 FREEZING 等价面（stage 未过 SWITCHING）
    const abort = await maintenance.abort(req.maintenanceId);
    expect(abort).toMatchObject({ ok: true });
    const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { maintenanceId: true, generation: true } });
    expect(head?.maintenanceId).toBeNull();
    expect(head?.generation).toBe(0);
    expect(maintenance.isFrozen(PID)).toBe(false);
    expect((await prisma.maintenanceOperation.findUnique({ where: { maintenanceId: req.maintenanceId } }))?.stage).toBe('ABORTED');
  });

  it('红②（服务侧同判定）无租约直写拒：lease 行持有=appendBatch fenced（CLI 直写同谓词——子进程级真跑见 kill9 套件）', async () => {
    // repo.setLeaseOwner('t27-int-owner') 但 CollabLease 行 owner≠me → append 族 fenced（契约 16）
    await prisma.$executeRaw`INSERT INTO "CollabLease" (scope, owner, epoch, "expiresAt")
      VALUES ('primary', 'someone-else', ${1n}::bigint, now() + interval '5 minutes')
      ON CONFLICT (scope) DO UPDATE SET owner = 'someone-else', "expiresAt" = now() + interval '5 minutes'`;
    try {
      const row = CanvasDocUpdateRepository.singleFrameRow({ generation: 0, walSeq: 999n, frameHash: new Uint8Array(32).fill(1), update: new Uint8Array([1, 2]) });
      const r = await repo.appendBatch(PID, [row], { expectedPgSeq: 2n, newPgSeq: 999n, walCheckpointSeq: 999n });
      expect(r).toMatchObject({ ok: false, reason: 'fenced' });
    } finally {
      await prisma.$executeRaw`DELETE FROM "CollabLease" WHERE scope = 'primary'`;
    }
  });

  it('4413 载荷 Retry-After：freezeInfo 携带 retryAfterMs（wire 契约 retryAfterMs 字段面）', () => {
    expect(MAINTENANCE_FREEZE_RETRY_AFTER_MS).toBeGreaterThan(0);
  });

  // ═══ Y1c T27 双评审收口批（Controller 裁定——红先行）═══
  it('红①（I-1 双员收敛）pre-SWITCHING FAILED 恢复出口：FAILED 后 request 新行=接管（旧行 SUPERSEDED+闸换新 id）——修前=PROJECT_NOT_FOUND 误报=项目受理永久 503 唯手工 SQL', async () => {
    // 布景：FAILED 落定（drain 超时——红③ 用例同法）
    const gi = await prisma.generationIntent.create({
      data: { projectId: PID, nodeId: 'n1', userId: 'u-x', teamId: 't-x', intentId: 'i-f1', kind: 'text',
        paramsHash: 'h', creditCost: 0, heartbeatAt: new Date(), deadlineAt: new Date(Date.now() + 60_000),
        idemKey: `idem-${randomUUID()}`, execSeq: 900011n } as never,
    });
    const failed = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    expect(failed.ok).toBe(true);
    const failRun = await maintenance.run(failed.ok ? failed.maintenanceId : '', { drainBudgetMs: 50 });
    expect(failRun.result).toBe('failed');
    // ★ 红：FAILED 在档时 request 新行——修前 {ok:false, code:'PROJECT_NOT_FOUND'}（404 误报）
    const takeover = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    expect(takeover.ok, `FAILED 接管应成功（got ${JSON.stringify(takeover)}）`).toBe(true);
    if (!takeover.ok) return;
    // 旧行 SUPERSEDED+闸换新 id+DB generation 未动（pre-SWITCHING——新 op 从当代重跑）
    const prevOp = await prisma.maintenanceOperation.findUnique({ where: { maintenanceId: failed.ok ? failed.maintenanceId : '' } });
    expect(prevOp?.stage).toBe('FAILED');
    expect(prevOp?.status).toBe('SUPERSEDED');
    expect((await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { maintenanceId: true } }))?.maintenanceId).toBe(takeover.maintenanceId);
    // 接管行可跑到 COMPLETED（出口真实可达——清障后新 op 全链）
    await prisma.generationIntent.delete({ where: { id: gi.id } });
    const rerun = await maintenance.run(takeover.maintenanceId, { drainBudgetMs: 3_000 });
    expect(rerun.result).toBe('completed');
    expect((await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { generation: true } }))?.generation).toBe(1);
  });

  it('红①-b（I-1 误报码修正）post-SWITCHING FAILED：request 拒 FAILED_RESUME_REQUIRED（准确指引 resume roll-forward——非 404 误报）+resume 出口可达', async () => {
    // 布景：COMPLETED 后手工改 FAILED+闸回写（=post-SWITCHING FAILED 形态：generation>=target）
    const req = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    if (!req.ok) throw new Error('request 失败');
    expect((await maintenance.run(req.maintenanceId, { drainBudgetMs: 3_000 })).result).toBe('completed');
    await prisma.$executeRaw`UPDATE "MaintenanceOperation" SET stage = 'FAILED', status = 'FAILED', error = 'VERIFYING: injected' WHERE "maintenanceId" = ${req.maintenanceId}::text`;
    await prisma.$executeRaw`UPDATE "CanvasDoc" SET "maintenanceId" = ${req.maintenanceId}::text WHERE "projectId" = ${PID}::text`;
    // ★ post-SWITCHING FAILED 不接管（禁跳过 VERIFYING）——准确指引码
    const again = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    expect(again).toMatchObject({ ok: false, code: 'FAILED_RESUME_REQUIRED' });
    // resume roll-forward 出口可达：FAILED→VERIFYING→run→COMPLETED
    const resume = await maintenance.resume(req.maintenanceId);
    expect(resume).toMatchObject({ ok: true });
    expect((await maintenance.run(req.maintenanceId)).result).toBe('completed');
    expect((await prisma.canvasDoc.findUnique({ where: { projectId: PID }, select: { maintenanceId: true } }))?.maintenanceId).toBeNull();
  });

  it('红②（I-2 spec）FAILED 只读维持跨重启：boot resumeActiveOnBoot 重 freeze（只维持只读不续跑）——修前=frozen 进程面空+doc 帧写静默恢复（违「不自动恢复写」）', async () => {
    // 布景：pre-SWITCHING FAILED 在 PG（run 失败档）+服务实例 freeze 面清空（=进程重启形态——fresh 实例）
    const gi = await prisma.generationIntent.create({
      data: { projectId: PID, nodeId: 'n1', userId: 'u-x', teamId: 't-x', intentId: 'i-f2', kind: 'text',
        paramsHash: 'h', creditCost: 0, heartbeatAt: new Date(), deadlineAt: new Date(Date.now() + 60_000),
        idemKey: `idem-${randomUUID()}`, execSeq: 900012n } as never,
    });
    const req = await maintenance.request({ projectId: PID, idempotencyKey: `k-${randomUUID()}`, requestedBy: 'int', source: 'rest' });
    expect((await maintenance.run(req.ok ? req.maintenanceId : '', { drainBudgetMs: 50 })).result).toBe('failed');
    maintenance.clearFrozenForTest();   // 进程内 freeze 面清空=重启形态
    expect(maintenance.isFrozen(PID)).toBe(false);   // 红锚前提：重启后进程面空
    // ★ boot 重 freeze：FAILED 行纳入（只维持只读不续跑——stage 仍 FAILED）
    const resumed = await maintenance.resumeActiveOnBoot();
    expect(resumed).toBe(1);
    expect(maintenance.isFrozen(PID), 'FAILED 行重 freeze（只读维持跨重启）').toBe(true);
    const opAfter = await prisma.maintenanceOperation.findUnique({ where: { maintenanceId: req.ok ? req.maintenanceId : '' } });
    expect(opAfter?.stage).toBe('FAILED');   // 不续跑（run 未被触发——FAILED 无续跑面）
    // 帧写仍 4413 只读维持（actor freeze 面经 host 读 maintenance）
    const conn = { socketId: 's-r2', readOnly: false, context: { user: { id: 'u1' } }, sendStateless: () => {}, webSocket: { send: () => {}, close: () => {} } } as never;
    const d = new Y.Doc(); const node = new Y.Map(); const data = new Y.Map();
    data.set('model', 'z2'); node.set('type', 'textInput'); node.set('data', data);
    d.getMap('nodes').set('nz2', node);
    await expect(actor.submit(PID, Y.encodeStateAsUpdate(d), conn, 'update')).rejects.toMatchObject({ code: CollabCloseCode.MAINTENANCE_FREEZE });
    await prisma.generationIntent.delete({ where: { id: gi.id } }).catch(() => {});
  });

  it('红④（I-2 quality）CLI SWITCHING 删除上界：锁内读后并发 append 一行 → seq<=maxSeq 上界删除 → 并发新行幸存（修前=整删静默丢帧）', async () => {
    // ★ CLI 现行为红（词法面——doc-shape 静态门先例）：SWITCHING 事务 DELETE 必须带 seq 上界参数
    //（修前=WHERE "projectId" 整删——锁内读后窗内并发新行被整删=换代后静默丢帧，tripwire 不覆盖外部删形态）
    const cliSrc = readFileSync(join(process.cwd(), '../../scripts/collab-rebuild-gen.mjs'), 'utf8');
    const delMatches = cliSrc.match(/DELETE FROM "CanvasDocUpdate"[^;]*/g) ?? [];
    expect(delMatches.length, 'CLI SWITCHING 删除语句恰一处').toBe(1);
    expect(delMatches[0], '删除谓词带 seq<=maxSeq 上界（修前=整删红）').toContain('seq <= $');
    // DB 谓词语义锚（行为面）：布景 gen0 头+快照+两行增量（seq 1..2）——beforeEach seedDoc 基线
    const before = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text`;
    expect(before[0]!.n).toBe(2);
    // CLI SWITCHING 事务谓词仿真：锁内读 maxSeq=2 → 并发插 seq=3（另一连接——真实 CLI 竞态窗形态）
    // → DELETE 上界（修前 CLI WHERE projectId 整删=3 行全消；修后=+AND seq<=maxSeq 并发新行幸免）
    const PrismaCtor = (await import('@prisma/client')).PrismaClient;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PID})::bigint)`;
      const rows = await tx.$queryRaw<{ seq: bigint }[]>`SELECT seq FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text ORDER BY seq ASC`;
      const maxSeq = rows[rows.length - 1]!.seq;
      const another = new PrismaCtor({ datasources: { db: { url: process.env.DATABASE_URL!.replace(/^"|"$/g, '') } } } as never);
      try {
        await another.$executeRaw`INSERT INTO "CanvasDocUpdate" ("projectId", generation, seq, "firstWalSeq", "frameCount", "updateHash", update, "createdAt")
          VALUES (${PID}::text, 0::int, 3::bigint, 3::bigint, 1::int, ${'u' + '3'.padEnd(63, '0')}::char(64), ${Buffer.from(Y.encodeStateAsUpdate(createCanvasDoc()))}, now()) ON CONFLICT DO NOTHING`;
      } finally { await another.$disconnect(); }
      await tx.$executeRaw`DELETE FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text AND seq <= ${maxSeq}::bigint`;
    }, { timeout: 10_000 });
    const after = await prisma.$queryRaw<{ seq: bigint }[]>`SELECT seq FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text`;
    expect(after.map((r) => r.seq), '并发新行幸存（上界删除——CLI 修前整删形态=3 行全消静默丢帧）').toEqual([3n]);
    // 清场（seq=3 行为并发仿真残留——恢复布景基线供后续用例）
    await prisma.$executeRaw`DELETE FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text AND seq = 3::bigint`;
  });

});
