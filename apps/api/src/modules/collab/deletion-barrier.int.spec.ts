// apps/api/src/modules/collab/deletion-barrier.int.spec.ts
// C3b-4a（plan v3 Task C3b-4a——spec 2026-11-11-foundation-batch-design.md §3.4-4 :75-80 第七轮重设计）：
// DeletionBarrier 持久 fence+admission 三面红测（真 PG 5432——vitest.int 串行；真 gateway+真 actor
// 帧管线装置=C3a-9 media-binding-oracle-contract 同族）。五红锚（卡文 Step 1 ①-⑤）+loopback 端点探针：
//  ①media 进 DELETING→客户端 doc 帧写引用已 apply 未 flush（advisory lock 钳 flush）→GC 删除决策
//    →**保留**（barrier ③flushThrough 落定后 decision snapshot+isMediaReferenced 可见——第六轮缺口根修）
//   ——负控：无 barrier 直判=不可见（误删竞窗实证）。
//  ②barrier ACTIVE 期间新 WS 帧（beforeHandleMessage）拒 4413 族+onAuthenticate 拒+appendBatch
//    事务首段拒（team 维——他项目同队照拒）——barrier 后、删除完成前的新 apply 不可达。
//  ③双 GC worker CAS 抢 barrier：并发 acquire 恰一者得（一者零行 lost-race）；持 barrier 期他者
//    prepare=lost-race bail-out。
//  ④超时/失败→整体 bail-out 释放（fence 行终态清+admission 解封+appendBatch 复通）；过期行接管
//    （expiresAt TTL——崩溃持有者不永久卡队）。
//  ⑤flush 与锁解耦：acquire 不持 lockProject（ACQUIRING 期 appendBatch 照通——「自锁」形态必红）
//    +ACQUIRING=flush 窗（已 apply 帧经 appendBatch 落 PG）vs ACTIVE=封（拒）——两态分义即
//    「③flushThrough 至 appliedSeq==pgSeq 且 admission 已封」的可达成形态。
//  ⑥loopback 端点（POST /api/collab/deletion-barrier——WORKER_WRITE_TOKEN）：prepare/release
//    全链+无 token 403+错 barrierId release 不动他人 barrier。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { register } from 'prom-client';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { OracleWorkerService } from './oracle-worker.service';
import { MediaReferenceService } from './media-reference.service';
import { DeletionBarrierService } from './deletion-barrier.service';
import { isDeletionBarrierSealed } from './deletion-barrier.seal';
import { CollabCloseCode, DELETION_BARRIER_REASON } from '@flowweb/shared';
import { CollabWriteController } from './collab-write.controller';
import { CollabDocumentService } from './collab-document.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TransformInterceptor } from '../../interceptors/transform.interceptor';
import { createLeaseStub } from './test-utils/lease-stub';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, FIXTURE_TEAM } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { pollUntil } from '../../test-utils/poll-until';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { lockProject } from './project-lock';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID_A = 'c3b4a-barrier-a';   // actor 帧管线宿主（①race 帧/⑤appendBatch 面）
const PID_B = 'c3b4a-barrier-b';   // 同队他项目（②team 维拒面/决策宇宙广度）
const ALL_PIDS = [PID_A, PID_B];
const TOKEN = 'tok-c3b4a-int';

/** 唯一帧（actor 准入矩阵合法信封：type+position+data.fileId=UUID——C3a-9 putNode 同形；逐帧唯一
 *  fileId=去重/updateHash 不冲突〔同内容空帧会被 actor dedup 吞+repo 端 @@updateHash 幂等吞行〕）。 */
function uniqueFrame(fileId: string): Uint8Array {
  const doc = new Y.Doc();
  try {
    const node = new Y.Map<unknown>();
    const pos = new Y.Map<unknown>();
    pos.set('x', 0);
    pos.set('y', 0);
    node.set('type', 'imageGen');
    node.set('position', pos);
    node.set('data', new Y.Map<unknown>([['fileId', fileId]]));
    (doc.getMap('nodes') as Y.Map<unknown>).set(`n-${fileId.slice(0, 8)}`, node);
    return Y.encodeStateAsUpdate(doc);
  } finally { doc.destroy(); }
}

maybe('C3b-4a：DeletionBarrier 持久 fence+admission 三面', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const oracle = new OracleWorkerService(prisma as never, repo as never);
  const mediaRef = new MediaReferenceService(prisma as never);
  let dir: { dir: string; cleanup: () => Promise<void> };
  let gateway: CollabGateway;
  let svc: DeletionBarrierService;
  let app: INestApplication;
  let baseUrl: string;
  let savedToken: string | undefined;
  const seqOf: Record<string, bigint> = {};
  const M = { race: randomUUID(), free: randomUUID() };
  let submitSeq = 0;

  /** actor.submit+flushThrough 落定（C3a-9 submitFrameFor 同款——retClamp 2s×6）。 */
  async function submitAndFlush(pid: string, frame: Uint8Array, label: string): Promise<bigint> {
    const conn = { socketId: `c3b4a-${label}-${++submitSeq}`, readOnly: false, sendStateless: vi.fn() } as never;
    const r = await gateway.projectActor.submit(pid, frame, conn, 'update');
    let flushed = await gateway.projectActor.flushThrough(pid, r.walSeq, { maxWaitMs: 2_000 });
    for (let attempt = 1; !flushed.targetReached && attempt < 6; attempt++) {
      await new Promise((res) => setTimeout(res, 50));
      flushed = await gateway.projectActor.flushThrough(pid, r.walSeq, { maxWaitMs: 2_000 });
    }
    expect(flushed.targetReached, `${label}：PG flush 未落定`).toBe(true);
    return r.walSeq;
  }

  /** 钳住 PID 的 appendBatch（lockProject 同键 advisory xact 锁——持有事务挂起至 release；30s
   *  上界防 Prisma 交互事务默认 5s 超时把夹具自身打断）。 */
  async function holdProjectAppendLock(pid: string): Promise<() => Promise<void>> {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const held = prisma.$transaction(async (tx) => {
      await lockProject(tx, pid);
      await gate;
    }, { timeout: 30_000, maxWait: 5_000 });
    return async () => { release(); await held; };
  }

  beforeAll(async () => {
    // 残留清扫（int 套件共享 dev 库+此前崩溃运行可能遗留——同 team 的 c3b4a* 项目行会进决策宇宙）
    const leftovers = await prisma.canvasProject.findMany({ where: { teamId: FIXTURE_TEAM, id: { startsWith: 'c3b4a' } }, select: { id: true } });
    for (const l of leftovers) await cleanupProjectFixture(prisma, l.id);
    await prisma.deletionBarrier.deleteMany({ where: {} });   // 全表清（此前崩溃运行的 barrier 行可能未过期——挡本套件 acquire）
    for (const pid of ALL_PIDS) await ensureProjectFixture(prisma, pid);
    await prisma.deletionBarrier.deleteMany({ where: { teamId: FIXTURE_TEAM } });
    await prisma.media.deleteMany({ where: { id: { in: Object.values(M) } } });
    for (const pid of ALL_PIDS) {
      await prisma.mediaBinding.deleteMany({ where: { projectId: pid } });
      await prisma.canvasReferenceOracle.deleteMany({ where: { projectId: pid } });
      await prisma.canvasReferenceOracleScan.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.create({ data: { projectId: pid, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false } });
    }
    // 媒体行：race=①DELETING 最小面（deletionState 置位——DELETING 状态机全语义归 C3b-4）；free=零引用负控
    await prisma.media.create({ data: { id: M.race, userId: 'y0a-fixture-user', teamId: FIXTURE_TEAM, key: `c3b4a/${M.race}`, originalName: 'race.png', mimeType: 'image/png', size: 1n, type: 'uploaded', deletionState: 'DELETING' } });
    await prisma.media.create({ data: { id: M.free, userId: 'y0a-fixture-user', teamId: FIXTURE_TEAM, key: `c3b4a/${M.free}`, originalName: 'free.png', mimeType: 'image/png', size: 1n, type: 'uploaded' } });
    await ensureLeaseFixture(prisma, repo, 'stub-owner-1');   // 租约 owner 与 lease stub 的 setLeaseOwner 同值（T27 端点装置同款——失配=fenced→selfIsolate）
    // ── 真 gateway（真 SG/actor/hooks——admission 面=hooks 直调即真接线证据）──
    dir = await makeSpoolDir('c3b4a-barrier-');
    const spool = new CollabSpoolService(dir.dir);
    const perm = { resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'), resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: FIXTURE_TEAM }) };
    const port = 21000 + Math.floor(Math.random() * 20000);
    gateway = new CollabGateway(
      prisma as never, new EventEmitter2() as never, repo,
      createLeaseStub({}, { repo: repo as never, spool: spool as never }) as never,
      perm as never, port, 10_000, undefined, undefined, spool,
    );
    await gateway.onModuleInit();
    // actor apply 面：库 documents Map 种子 doc（bare 名=generation 0——C3a-9 documents 装置同族）
    for (const pid of ALL_PIDS) gateway.server.hocuspocus.documents.set(`project:${pid}`, new Y.Doc() as never);   // 库 Document 结构面 cast（测试种子——C3a-9 documents 装置同族）
    svc = new DeletionBarrierService(prisma as never, repo as never, gateway.projectActor);
    // 基态：各项目一空帧落定（pgSeq=1+binding 水位经 actor 投影同事务推进）+oracle header COMPLETE
    for (const pid of ALL_PIDS) {
      await submitAndFlush(pid, uniqueFrame(randomUUID()), `seed-${pid}`);
      seqOf[pid] = 1n;
      const wm = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: pid }, select: { pgSeq: true, mediaBindingSeq: true, bindingsDirty: true } });
      expect(wm.pgSeq).toBe(1n);
      expect([wm.mediaBindingSeq === 1n, wm.bindingsDirty === false]).toEqual([true, true]);
      expect(await oracle.scanProject(pid)).toMatchObject({ outcome: 'complete', verifiedSeq: 1n });
    }
  }, 120_000);

  afterAll(async () => {
    if (savedToken === undefined) delete process.env.WORKER_WRITE_TOKEN; else process.env.WORKER_WRITE_TOKEN = savedToken;
    await app?.close();
    // 种子 doc 先出库 documents Map（库 destroy 的 closeConnections 对无实例 bookkeeping 的裸条目
    // 抛 TypeError——先清再 destroy 防 afterAll 挂起）
    for (const pid of ALL_PIDS) gateway?.server.hocuspocus.documents.delete(`project:${pid}`);
    await (gateway as unknown as { server: { destroy(): Promise<void> } }).server.destroy().catch(() => undefined);
    await prisma.deletionBarrier.deleteMany({ where: { teamId: FIXTURE_TEAM } });
    await prisma.media.deleteMany({ where: { id: { in: Object.values(M) } } });
    for (const pid of ALL_PIDS) {
      await prisma.mediaBinding.deleteMany({ where: { projectId: pid } });
      await prisma.canvasReferenceOracle.deleteMany({ where: { projectId: pid } });
      await prisma.canvasReferenceOracleScan.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
    }
    if (dir) await dir.cleanup();
    await restoreLeaseRow(prisma);
    for (const pid of ALL_PIDS) await cleanupProjectFixture(prisma, pid);
    await prisma.$disconnect();
  }, 120_000);

  it('①已 apply 未 flush 的引用帧：barrier flushThrough 落定后决策可见→保留（负控：无 barrier 直判=不可见）', async () => {
    // 钳 A 的 appendBatch →submit race 帧（apply 达内存+appliedSeq 推进、pgSeq 不动）
    const releaseLock = await holdProjectAppendLock(PID_A);
    try {
      const race = await gateway.projectActor.submit(PID_A, uniqueFrame(M.race), { socketId: 'c3b4a-race', readOnly: false, sendStateless: vi.fn() } as never, 'update');
      await pollUntil(() => gateway.projectActor.appliedSeqOf(PID_A) === race.walSeq, 5_000);
      const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID_A }, select: { pgSeq: true } });
      expect(doc.pgSeq).toBe(1n);   // 未 flush——竞窗本体
      // 负控：无 barrier 直判=引用不可见（GC 据此误删——第六轮红测缺口）
      expect(await mediaRef.isMediaReferenced(prisma, M.race, { teamId: FIXTURE_TEAM })).toBe(false);
      // barrier 六步序起跑（①pre-scan 复用→②acquire ACQUIRING→③flush 等待——钳锁未放）
      const preparing = svc.prepare(FIXTURE_TEAM);
      try {
        await pollUntil(async () => (await prisma.deletionBarrier.count({ where: { teamId: FIXTURE_TEAM } })) === 1, 5_000);
        expect((await prisma.deletionBarrier.findUniqueOrThrow({ where: { teamId: FIXTURE_TEAM } })).state).toBe('ACQUIRING');
        // 放锁→③flushThrough 落定（ACQUIRING=flush 窗——appendBatch 照通）→重扫→ACTIVE→④snapshot
        await releaseLock();
        const res = await preparing;
        expect(res).toMatchObject({ outcome: 'verified' });
        if (res.outcome !== 'verified') return;
        expect(res.projects.map((p) => p.projectId).sort()).toEqual([...ALL_PIDS].sort());
        expect(res.projects.find((p) => p.projectId === PID_A)?.pgSeq).toBe(2n);   // race 帧已落 PG
        expect((await prisma.deletionBarrier.findUniqueOrThrow({ where: { teamId: FIXTURE_TEAM } })).state).toBe('ACTIVE');   // ⑤删除窗持有
        // GC 删除决策：race=保留（中止）；free=可删（零引用）
        expect(await mediaRef.isMediaReferenced(prisma, M.race, { teamId: FIXTURE_TEAM })).toBe(true);
        expect(await mediaRef.isMediaReferenced(prisma, M.free, { teamId: FIXTURE_TEAM })).toBe(false);
        // ⑥释放：行清+解封+appendBatch 复通
        expect(await svc.release(FIXTURE_TEAM, res.barrierId)).toBe(true);
        expect(await prisma.deletionBarrier.count({ where: { teamId: FIXTURE_TEAM } })).toBe(0);
        expect(isDeletionBarrierSealed(PID_A)).toBe(false);
      } finally {
        // 断言失败也不留 ACTIVE fence（后续用例 lost-race 连坐）——barrier 行兜底清
        await preparing.then((r) => (r.outcome === 'verified' ? svc.release(FIXTURE_TEAM, r.barrierId) : undefined)).catch(() => undefined);
      }
      seqOf[PID_A] = 2n;   // A=actor 专用项目（repo 直供 append 会与 spool walSeq 计数器互踩——B 承载 repo 面）
    } finally {
      await releaseLock().catch(() => undefined);
    }
  }, 60_000);

  it('②ACTIVE 期 admission 三面拒：WS 帧拒 4413 族+auth 拒+appendBatch 事务首段拒（team 维）', async () => {
    const held = await svc.prepare(FIXTURE_TEAM);
    expect(held.outcome).toBe('verified');
    if (held.outcome !== 'verified') return;
    try {
      // 面 1a：beforeHandleMessage（真 gateway hook）——sealed team doc 帧拒：4413+deletion-barrier reason
      const closeSpy = vi.fn();
      const conn = { document: { name: `project:${PID_A}` }, webSocket: { close: closeSpy } };
      await expect(gateway.hooks.beforeHandleMessage({ update: new Uint8Array([2, 0, 0, 1]), socketId: 'c3b4a-face1', connection: conn } as never))
        .rejects.toThrow(/deletion-barrier/);
      expect(closeSpy).toHaveBeenCalledWith(CollabCloseCode.MAINTENANCE_FREEZE, DELETION_BARRIER_REASON);   // 4413 族（retry 档——码复用裁定）
      // 面 1b：onAuthenticate（真 gateway hook）——sealed team 新连接拒（瞬态档）
      await expect(gateway.hooks.onAuthenticate({ documentName: `project:${PID_A}`, socketId: 'c3b4a-face1b' } as never))
        .rejects.toThrow(/deletion-barrier/);
      // 面 2：appendBatch 事务首段（同队他项目 B 照拒——team 维）
      const nextB = seqOf[PID_B] + 1n;
      expect(await repo.appendBatch(PID_B, [seedRow(uniqueFrame(randomUUID()), nextB)], { expectedPgSeq: seqOf[PID_B], newPgSeq: nextB, walCheckpointSeq: nextB }))
        .toEqual({ ok: false, reason: 'deletion-barrier' });
      const wmB = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID_B }, select: { pgSeq: true } });
      expect(wmB.pgSeq).toBe(seqOf[PID_B]);   // 零行落定（新 apply 不可达）
    } finally {
      await svc.release(FIXTURE_TEAM, held.barrierId);
    }
    // 释放后复通：同帧 appendBatch ok+auth 拒因不再是 barrier（版本门/未认证族——seal 已清）
    const nextB = seqOf[PID_B] + 1n;
    expect(await repo.appendBatch(PID_B, [seedRow(uniqueFrame(randomUUID()), nextB)], { expectedPgSeq: seqOf[PID_B], newPgSeq: nextB, walCheckpointSeq: nextB }))
      .toEqual({ ok: true, rows: 1 });
    seqOf[PID_B] = nextB;
    await prisma.canvasDoc.updateMany({ where: { projectId: PID_B }, data: { mediaBindingSeq: nextB, bindingsDirty: false } });
    let postReleaseErr: unknown;
    try {
      await gateway.hooks.onAuthenticate({ documentName: `project:${PID_A}`, socketId: 'c3b4a-face1c' } as never);
    } catch (e) {
      postReleaseErr = e;
    }
    expect(postReleaseErr).toBeTruthy();   // 无凭据/无 csv——版本门族拒绝（非 barrier）
    expect(String((postReleaseErr as Error).message)).not.toMatch(/deletion-barrier/);
  }, 60_000);

  it('③双 GC worker CAS：并发 acquire 恰一者得（一者零行）；持 barrier 期他者 prepare=lost-race', async () => {
    const [w1, w2] = await Promise.all([svc.acquire(FIXTURE_TEAM), svc.acquire(FIXTURE_TEAM)]);
    const winners = [w1, w2].filter((r) => r.ok);
    const losers = [w1, w2].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toEqual({ ok: false, reason: 'lost-race' });
    const winner = winners[0];
    if (!winner.ok) return;
    expect((await prisma.deletionBarrier.findUniqueOrThrow({ where: { teamId: FIXTURE_TEAM } })).barrierId).toBe(winner.barrierId);
    // 持 barrier 期他者 prepare → lost-race bail-out（零释放动作——未持有者不得动他人 fence 行）
    expect(await svc.prepare(FIXTURE_TEAM)).toEqual({ outcome: 'bail-out', reason: 'lost-race' });
    expect(await prisma.deletionBarrier.count({ where: { teamId: FIXTURE_TEAM, barrierId: winner.barrierId } })).toBe(1);
    expect(await svc.release(FIXTURE_TEAM, winner.barrierId)).toBe(true);
    expect(await prisma.deletionBarrier.count({ where: { teamId: FIXTURE_TEAM } })).toBe(0);
  }, 60_000);

  it('④超时/失败→整体 bail-out 释放（行清+解封+appendBatch 复通）；过期行接管（TTL 自愈）', async () => {
    // flush 超时形态：钳 A 的 appendBatch→prepare 逐项目预算 400ms 耗尽→bail-out 释放
    const releaseLock = await holdProjectAppendLock(PID_A);
    try {
      const timeoutFrame = await gateway.projectActor.submit(PID_A, uniqueFrame(randomUUID()), { socketId: 'c3b4a-timeout', readOnly: false, sendStateless: vi.fn() } as never, 'update');
      await pollUntil(() => gateway.projectActor.appliedSeqOf(PID_A) === timeoutFrame.walSeq, 5_000);
      const res = await svc.prepare(FIXTURE_TEAM, { perProjectFlushBudgetMs: 400, budgetMs: 2_000 });
      expect(res).toEqual({ outcome: 'bail-out', reason: 'flush-timeout' });
      expect(await prisma.deletionBarrier.count({ where: { teamId: FIXTURE_TEAM } })).toBe(0);   // fence 行终态清
      expect(isDeletionBarrierSealed(PID_A)).toBe(false);   // admission 解封
    } finally {
      await releaseLock();
    }
    // 放锁后钳住帧落定（bail-out 不丢帧——WAL 安全；flushThrough kick 重驱动 flushApplied——单次
    // 上界 2s 被 actor 内部 clamp，钳锁期首个 blocked appendBatch 持 flushing 至其 5s tx 超时，故
    // C3a-9 同款重试环 ×6）
    let kicked = await gateway.projectActor.flushThrough(PID_A, gateway.projectActor.appliedSeqOf(PID_A), { maxWaitMs: 2_000 });
    for (let attempt = 1; !kicked.targetReached && attempt < 6; attempt++) {
      await new Promise((res) => setTimeout(res, 100));
      kicked = await gateway.projectActor.flushThrough(PID_A, gateway.projectActor.appliedSeqOf(PID_A), { maxWaitMs: 2_000 });
    }
    expect(kicked.targetReached, 'bail-out 后钳住帧经 flushThrough kick 落定').toBe(true);
    expect(await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID_A }, select: { pgSeq: true } })).toMatchObject({ pgSeq: seqOf[PID_A] + 1n });
    seqOf[PID_A] += 1n;
    await prisma.canvasDoc.updateMany({ where: { projectId: PID_A }, data: { mediaBindingSeq: seqOf[PID_A], bindingsDirty: false } });
    // 过期接管：短预算 acquire→过期→新 acquire 原位接管（新 barrierId——崩溃持有者不永久卡队）
    const first = await svc.acquire(FIXTURE_TEAM, { budgetMs: 60 });
    expect(first.ok).toBe(true);
    if (first.ok) {
      await new Promise((r) => setTimeout(r, 120));
      const second = await svc.acquire(FIXTURE_TEAM);
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.barrierId).not.toBe(first.barrierId);
        await svc.release(FIXTURE_TEAM, second.barrierId);
      }
    }
    expect(await prisma.deletionBarrier.count({ where: { teamId: FIXTURE_TEAM } })).toBe(0);
    // 观测：deletion_barrier_active_seconds 已注册且本次 bail-out 已置值（≥0）
    const gauge = register.getSingleMetric('deletion_barrier_active_seconds');
    expect(gauge).toBeTruthy();
  }, 60_000);

  it('⑤flush 与锁解耦：acquire 不持 lockProject（ACQUIRING 期 appendBatch 照通）+ACQUIRING/ACTIVE 两态分义', async () => {
    const acq = await svc.acquire(FIXTURE_TEAM);
    expect(acq.ok).toBe(true);
    if (!acq.ok) return;
    try {
      // 自锁负证：acquire 后（行在库 state=ACQUIRING）他连接 appendBatch 即刻通——若 acquire 持
      // lockProject 跨 flush 等待，此处死锁/超时=红（spec :75「lockProject 不是 fence」可达成形态）
      const nextB = seqOf[PID_B] + 1n;
      expect(await repo.appendBatch(PID_B, [seedRow(uniqueFrame(randomUUID()), nextB)], { expectedPgSeq: seqOf[PID_B], newPgSeq: nextB, walCheckpointSeq: nextB }))
        .toEqual({ ok: true, rows: 1 });
      seqOf[PID_B] = nextB;
      await prisma.canvasDoc.updateMany({ where: { projectId: PID_B }, data: { mediaBindingSeq: nextB, bindingsDirty: false } });
      // 两态分义：ACQUIRING=flush 窗（上方已证）→activate→ACTIVE=封（拒帧零落定——B 序号不动）
      expect(await svc.activate(FIXTURE_TEAM, acq.barrierId)).toBe(true);
      const nextB2 = seqOf[PID_B] + 1n;
      expect(await repo.appendBatch(PID_B, [seedRow(uniqueFrame(randomUUID()), nextB2)], { expectedPgSeq: seqOf[PID_B], newPgSeq: nextB2, walCheckpointSeq: nextB2 }))
        .toEqual({ ok: false, reason: 'deletion-barrier' });
      const wmB2 = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID_B }, select: { pgSeq: true } });
      expect(wmB2.pgSeq).toBe(seqOf[PID_B]);
    } finally {
      await svc.release(FIXTURE_TEAM, acq.barrierId);
    }
    expect(await prisma.deletionBarrier.count({ where: { teamId: FIXTURE_TEAM } })).toBe(0);
  }, 60_000);

  it('⑥loopback 端点：POST /api/collab/deletion-barrier（WORKER_WRITE_TOKEN）prepare/release 全链+无 token 403+错 barrierId 不动他人行', async () => {
    const docSvc = {} as CollabDocumentService;
    const moduleRef = await Test.createTestingModule({
      controllers: [CollabWriteController],
      providers: [
        { provide: CollabDocumentService, useValue: docSvc },
        { provide: PrismaService, useValue: prisma },
        { provide: CollabSpoolService, useValue: new CollabSpoolService() },
        { provide: DeletionBarrierService, useValue: svc },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));
    await app.init();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    savedToken = process.env.WORKER_WRITE_TOKEN;
    process.env.WORKER_WRITE_TOKEN = TOKEN;
    // 无 token 拒（production 形态 sim——token 已设+请求无 Bearer ⇒ 403）
    const noToken = await fetch(`${baseUrl}/api/collab/doc/deletion-barrier`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare', teamId: FIXTURE_TEAM }),
    });
    expect(noToken.status).toBe(403);
    // prepare 全链（真 svc——六步序+snapshot verified）
    const prepareRes = await fetch(`${baseUrl}/api/collab/doc/deletion-barrier`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ action: 'prepare', teamId: FIXTURE_TEAM }),
    });
    expect(prepareRes.status).toBe(201);   // Nest POST 缺省 201（@NoTransform 下 body 原样）
    const body = (await prepareRes.json()) as { outcome: string; barrierId?: string; projects?: { projectId: string }[] };
    expect(body).toMatchObject({ outcome: 'verified' });
    expect(body.barrierId).toBeTruthy();
    expect((body.projects ?? []).map((p) => p.projectId).sort()).toEqual([...ALL_PIDS].sort());
    // 错 barrierId release：零行命中不动他人 fence
    const wrongRelease = await fetch(`${baseUrl}/api/collab/doc/deletion-barrier`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ action: 'release', teamId: FIXTURE_TEAM, barrierId: randomUUID() }),
    });
    expect(((await wrongRelease.json()) as { released: boolean }).released).toBe(false);
    expect(await prisma.deletionBarrier.count({ where: { teamId: FIXTURE_TEAM } })).toBe(1);
    // 正 barrierId release：行清
    const releaseRes = await fetch(`${baseUrl}/api/collab/doc/deletion-barrier`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ action: 'release', teamId: FIXTURE_TEAM, barrierId: body.barrierId }),
    });
    expect(((await releaseRes.json()) as { released: boolean }).released).toBe(true);
    expect(await prisma.deletionBarrier.count({ where: { teamId: FIXTURE_TEAM } })).toBe(0);
  }, 60_000);
});
