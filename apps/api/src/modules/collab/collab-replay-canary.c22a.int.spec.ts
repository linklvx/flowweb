// apps/api/src/modules/collab/collab-replay-canary.c22a.int.spec.ts
// C2-2a（plan Task C2-2 捕获侧——生产就绪收尾批 C2 卡 replay-canary 第三任务·红先行）：canary
// 捕获面真 PG int 池（比对侧 worker/verify 归 C2-2b——本文件只钉捕获侧契约）。
//  ★红④（两态双断言承 v3——v4 误写已反转）：真 actor+真 withFrozenPrefix——冻结临界区内队列帧
//    不进捕获坐标（pgSeqAt/appliedSeq 不含之；活 doc==PG@appliedSeq）→release→队列帧 apply→
//    pgSeq 前进含之。确定性时序=帧在临界区内入队（freeze mutex 持有=drain 每批让位——「先塞 5 帧
//    仍排队未 apply」的唯一确定性交错；冻结前塞帧与 drain 抢批=真竞态非断言面）。
//  捕获协议五步（v3.1 竞态三修）：①CanvasDoc FOR SHARE+②快照选择 stateSeq≤pgSeqAt 最新行
//    （无满足→genesis rev 0 回退）+③INSERT CAPTURING pin+④SV+canonical hash（pendingStructs===null
//    口径+尺寸阈值超限 hashSkipped 只取 SV）+⑤UPDATE READY（失败→DELETE pin）。
//  ★红⑤-a（创建窗）：CAPTURING 已落库期并发 compact publish+prune→pin 存活谓词挡住（prune/
//    purge 删除语句内部 NOT EXISTS 谓词——跳过 (pin.stateSeq, pin.pgSeqAt] 与 pinned 快照行）
//    →readAt 仍可读；过期后 resumePurges 收敛（义务闭环）。
//  ★红⑤-b（vacuum）：pin 存活期 vacuumReplace→{aborted:'canary-pin-active'} defer 本轮零换代
//    零删行（谓词进 vacuumReplace 事务）；pin 过期→换代照常可行。
//  poller：TTL 过期清扫（每 tick 顺带）+skip 判定链（首步 isLeaseServing→lifecycleState→维护窗
//    →活跃 pin）+游标写（lastCheckedAt/lastResult/generation）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { captureCanaryPin, CANARY_PIN_TTL_MS, writeCanaryCursor, CANARY_HASH_VERSION } from './collab-replay-canary.service';
import { CollabReplayCanaryPoller } from './collab-replay-canary.poller';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { canvasDocName } from './doc-name.util';
import type { Logger } from '@nestjs/common';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const noopLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} } as unknown as Logger;

const PID = `int-c22a-canary-${Date.now()}`;

/** 节点相异载荷（同字节帧被去重/幂等吞——count 锚失真）。 */
const frameOf = (key: string, n: number) => {
  const d = new Y.Doc();
  const node = new Y.Map(); const data = new Y.Map();
  data.set('model', `m-${n}`);
  node.set('type', 'textInput'); node.set('data', data);
  (d.getMap('nodes') as Y.Map<unknown>).set(key, node);
  return Y.encodeStateAsUpdate(d);
};
const modelOf = (d: Y.Doc, key: string): unknown =>
  ((d.getMap('nodes').get(key) as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('model');

maybe('C2-2a canary 捕获面（真 PG——红④⑤+捕获协议+poller）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  let spool: CollabSpoolService;
  let spoolCleanup: () => Promise<void> = async () => {};
  let actor: CollabProjectActorService;
  let doc: Y.Doc;
  const gen = 1;   // fixture 代（c21 seedFrames 同款——懒建档形态 gen=1）

  /** actor 单写者播种链（c21 seedFrames 同款）：头行 raw INSERT+逐帧 appendBatch+水位 CAS 链。 */
  async function seedFrames(pid: string, frames: Uint8Array[], startPg: bigint): Promise<bigint> {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt") VALUES ($1, 1, 3, now()) ON CONFLICT DO NOTHING`,
      pid,
    );
    let pg = startPg;
    for (let i = 0; i < frames.length; i++) {
      const seq = pg + 1n;   // 连续 seq（c21 原版 BigInt(i+1) 仅适用 startPg=0 单段——本 spec 跨段链式续播）
      const r = await repo.appendBatch(pid, [seedRow(frames[i], seq)], { expectedPgSeq: pg, newPgSeq: seq, walCheckpointSeq: seq });
      expect(r.ok).toBe(true);
      pg = seq;
    }
    return pg;
  }

  async function buildKit(): Promise<void> {
    await spoolCleanup();
    const dir = await makeSpoolDir('c22a-spool-');
    spoolCleanup = dir.cleanup;
    spool = new CollabSpoolService(dir.dir);
    spool.setOwner('c22a-owner');
    await ensureLeaseFixture(prisma, repo, 'c22a-owner');
    doc = new Y.Doc();
    const documents = new Map<string, Y.Doc>([[canvasDocName(PID, gen), doc]]);
    actor = new CollabProjectActorService(spool, repo as never);
    (actor as unknown as { bindHost(h: unknown): void }).bindHost({
      logger: noopLogger,
      documents: () => documents,
      hardClose: () => {},
      isQuotaFrozen: () => false,
      generationOf: () => gen,
      noteReadOnlyDrop: () => false,
      onFencedByWrite: async () => {},
    });
  }

  /** actor 提交用连接（t27 int 同款形状——context.user.id 供 actorRanges 装配）。 */
  const conn = { socketId: 'c22a-conn', readOnly: false, context: { user: { id: 'c22a-user' } }, sendStateless: () => {} } as never;

  /** 等待谓词真（有界轮询——水位/apply 异步落定）。 */
  async function waitUntil(pred: () => Promise<boolean> | boolean, ms = 5_000): Promise<boolean> {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await pred()) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  const watermark = async () => (await repo.readWatermark(PID))?.pgSeq ?? 0n;

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  beforeEach(async () => {
    await prisma.canaryPin.deleteMany({ where: {} });
    await prisma.collabCanaryCursor.deleteMany({ where: {} });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await buildKit();
  });
  afterAll(async () => {
    await cleanupProjectFixture(prisma, PID);
    await restoreLeaseRow(prisma);
    await spoolCleanup();
    await prisma.$disconnect();
  });

  // ═══ 红④：两态双断言（捕获坐标不含队列帧 → release 后含之） ═══

  it('红④ 冻结临界区捕获坐标不含队列中 5 帧（活 doc==PG@appliedSeq）；release 后 apply→pgSeq 前进含之', async () => {
    // 前置 1 帧落定（applied=pg=1）
    const p0 = actor.submit(PID, frameOf('k0', 0), conn, 'update');
    expect(await waitUntil(async () => (await watermark()) === 1n && actor.appliedSeqOf(PID) === 1n), '前置帧应落定 pgSeq=applied=1').toBe(true);
    await p0;

    let queued: Array<Promise<unknown>> = [];
    const r = await actor.withFrozenPrefix(PID, async (ctx) => {
      // 临界区内塞 5 帧（freeze mutex 在持=drain 每批让位——帧只入队不 apply）
      queued = [1, 2, 3, 4, 5].map((i) => actor.submit(PID, frameOf(`q${i}`, i), conn, 'update'));
      for (let i = 0; i < 15; i++) await new Promise((res) => setTimeout(res, 10));   // 跨多拍让 drain 有机会违规
      // ── 态一【不含】：捕获坐标 pgSeqAt/appliedSeq 不含该 5 帧 ──
      expect(ctx.appliedSeq).toBe(1n);
      expect(ctx.pgSeq).toBe(1n);
      expect(actor.appliedSeqOf(PID)).toBe(1n);
      // 冻结临界区内活 doc==PG@appliedSeq（doc 无队列帧内容）
      for (let i = 1; i <= 5; i++) expect(doc.getMap('nodes').get(`q${i}`), `冻结 doc 不应含 q${i}`).toBeUndefined();
      expect(modelOf(doc, 'k0')).toBe('m-0');
      // PG 真值复核（坐标=PG@appliedSeq）
      expect(await watermark()).toBe(1n);
      return { pgSeqAt: ctx.pgSeq, appliedSeq: ctx.appliedSeq };
    }, { gateBudgetMs: 2_000, flushBudgetMs: 3_000 });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.value).toEqual({ pgSeqAt: 1n, appliedSeq: 1n });

    // ── 态二【含】：release 后队列帧 apply→pgSeq 前进含之 ──
    await Promise.all(queued);
    expect(await waitUntil(async () => (await watermark()) === 6n && actor.appliedSeqOf(PID) === 6n), 'release 后 5 帧应 apply+落 PG（pgSeq=6）').toBe(true);
    expect(actor.appliedSeqOf(PID)).toBe(6n);
    for (let i = 1; i <= 5; i++) expect(modelOf(doc, `q${i}`)).toBe(`m-${i}`);
  });

  // ═══ 捕获协议五步（pin-first——真 withFrozenPrefix 载体） ═══

  it('捕获协议：短事务 pin-first 五步——快照选择回退 genesis rev 0+CAPTURING→READY+contentHash（compact stateHash 同口径）', async () => {
    // 真 actor 落 2 帧（懒建档——无快照行 ⇒ ② 快照选择回退 genesis rev 0）
    actor.submit(PID, frameOf('c1', 1), conn, 'update').catch(() => {});
    actor.submit(PID, frameOf('c2', 2), conn, 'update').catch(() => {});
    expect(await waitUntil(async () => (await watermark()) === 2n && actor.appliedSeqOf(PID) === 2n), '两帧应落定').toBe(true);

    const r = await actor.withFrozenPrefix(PID, async (ctx) =>
      captureCanaryPin(prisma, { projectId: PID, generation: ctx.generation ?? gen, pgSeqAt: ctx.pgSeq, doc: ctx.doc }),
    { gateBudgetMs: 2_000, flushBudgetMs: 3_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ ok: true, snapshotRev: 0n, stateSeq: 0n, pgSeqAt: 2n, hashSkipped: false });
    // contentHash=SHA-256(encodeStateAsUpdate(冻结 doc))——compact stateHash 同口径独立复算
    const expectedHash = createHash('sha256').update(Y.encodeStateAsUpdate(doc)).digest('hex');
    expect((r.value as { contentHash: string | null }).contentHash).toBe(expectedHash);

    const pin = await prisma.canaryPin.findUnique({ where: { projectId: PID } });
    expect(pin).toMatchObject({
      status: 'READY', generation: gen, snapshotRev: 0n, stateSeq: 0n, pgSeqAt: 2n,
      contentHash: expectedHash, hashSkipped: false, hashVersion: CANARY_HASH_VERSION,
    });
    // TTL/lease 断言走 SQL 侧同钟比较（timestamp 列+raw now() 写入=会话钟面——JS 绝对比较跨时区漂移面；
    // 生产谓词〔sweep/capture/defer〕全 SQL 侧 now() 同钟自洽）
    const ttl = await prisma.$queryRaw<{ exp: number; lease: number }[]>`
      SELECT EXTRACT(EPOCH FROM ("expiresAt" - now()))::float8 AS exp, EXTRACT(EPOCH FROM ("leaseUntil" - now()))::float8 AS lease
      FROM "CanaryPin" WHERE "projectId" = ${PID}::text`;
    expect(ttl[0]!.exp).toBeLessThanOrEqual(CANARY_PIN_TTL_MS / 1000);
    expect(ttl[0]!.exp).toBeGreaterThanOrEqual(CANARY_PIN_TTL_MS / 1000 - 30);
    expect(ttl[0]!.lease).toBeGreaterThan(0);
    expect(pin!.stateVector).not.toBeNull();   // ④ SV 恒落（hashSkipped 档只取 SV——本档 hash+SV 双落）

    // readAt（genesis 回退坐标）：state=null+增量 (0,2]——C2-2b worker 重放输入面（actor 批落库
    // 帧行贪心合并：两帧一行=常态，重放内容为判据非行数）
    const read = await repo.readAt(PID, gen, 0n, 2n);
    expect(read.state).toBeNull();
    expect(read.stateSeq).toBe(0n);
    expect(read.updates.length).toBeGreaterThanOrEqual(1);
    const replayDoc = new Y.Doc();
    for (const u of read.updates) Y.applyUpdate(replayDoc, new Uint8Array(u));
    expect(modelOf(replayDoc, 'c1')).toBe('m-1');
    expect(modelOf(replayDoc, 'c2')).toBe('m-2');
    replayDoc.destroy();
  });

  it('捕获协议-尺寸阈值：超限 hashSkipped=true 只取 SV（contentHash 空）', async () => {
    expect(await seedFrames(PID, [frameOf('h1', 1)], 0n)).toBe(1n);
    const rows = await prisma.$queryRaw<{ update: Buffer }[]>`
      SELECT update FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text AND seq = 1::bigint`;
    const d = new Y.Doc();
    Y.applyUpdate(d, new Uint8Array(rows[0]!.update));
    const r = await captureCanaryPin(prisma, { projectId: PID, generation: gen, pgSeqAt: 1n, doc: d, maxHashBytes: 4 });   // 测试缝：阈值压到 4B（帧必超）
    expect(r).toMatchObject({ ok: true, hashSkipped: true, contentHash: null });
    const pin = await prisma.canaryPin.findUnique({ where: { projectId: PID } });
    expect(pin).toMatchObject({ status: 'READY', hashSkipped: true, contentHash: null, stateSeq: 0n, pgSeqAt: 1n });
    d.destroy();
  });

  it('捕获协议-漂移守卫：pgSeqAt≠CanvasDoc.pgSeq（冻结读后并发推进形态）→拒捕获零 pin', async () => {
    expect(await seedFrames(PID, [frameOf('d1', 1), frameOf('d2', 2)], 0n)).toBe(2n);
    const d = new Y.Doc();
    const r = await captureCanaryPin(prisma, { projectId: PID, generation: gen, pgSeqAt: 1n, doc: d });   // pgSeqAt=1≠DB 2
    expect(r).toMatchObject({ ok: false, reason: 'pg-drift' });
    expect(await prisma.canaryPin.count({ where: { projectId: PID } })).toBe(0);   // 零 pin 残留
    d.destroy();
  });

  // ═══ 红⑤-a：创建窗（CAPTURING 已落库期并发 compact publish+prune） ═══

  it('红⑤-a pin 存活谓词挡住 prune/purge 删除区间：pinned 快照行+增量 (stateSeq,pgSeqAt] 幸存→readAt 仍可读；过期后 resumePurges 收敛', async () => {
    // 布景：两次 compact（快照 rev4/rev6——第三次发布后 pinned rev6 落出当代 top-2）
    let pg = await seedFrames(PID, [frameOf('a1', 1), frameOf('a2', 2), frameOf('a3', 3), frameOf('a4', 4)], 0n);
    expect((await repo.compact(PID)).compacted).toBe(true);   // rev4 发布+行 1..4 purge
    pg = await seedFrames(PID, [frameOf('a5', 5), frameOf('a6', 6)], pg);
    expect((await repo.compact(PID)).compacted).toBe(true);   // rev6 发布+行 5..6 purge（快照 {4,6}）
    pg = await seedFrames(PID, [frameOf('a7', 7), frameOf('a8', 8)], pg);   // 行 7..8 活（未折）
    expect(pg).toBe(8n);

    // 创建窗时序压缩：捕获事务已提交（CAPTURING 坐标=快照选择真值 rev6/6/8）、④⑤ 未完成——
    // 此窗并发 compact publish+prune（红③ FOR UPDATE 互斥使 pin 先可见，删除面由本谓词挡）
    await prisma.$executeRaw`
      INSERT INTO "CanaryPin" ("projectId", status, generation, "snapshotRev", "stateSeq", "pgSeqAt", "hashVersion", "leaseUntil", "expiresAt")
      VALUES (${PID}::text, 'CAPTURING', ${gen}::int, 6::bigint, 6::bigint, 8::bigint, ${CANARY_HASH_VERSION}::int, now() + interval '15 minutes', now() + interval '15 minutes')`;

    // 并发 compact×2（publish 不被 pin 挡——发布后 prune 使 rev6 落出 top-2）
    expect((await repo.compact(PID)).compacted).toBe(true);   // rev8：purgeBelow(8) 保护 (6,8]——行 7..8 幸存
    await seedFrames(PID, [frameOf('a9', 9), frameOf('a10', 10)], pg);
    expect((await repo.compact(PID)).compacted).toBe(true);   // rev10：当代 top-2={10,8}——无谓词时 rev6 被删

    // pin 谓词挡住（红断言面）
    expect(await prisma.canvasDocSnapshot.count({ where: { projectId: PID, generation: gen, snapshotRev: 6n } }), 'pinned 快照行幸存').toBe(1);
    expect(await prisma.canvasDocSnapshot.count({ where: { projectId: PID, generation: gen, snapshotRev: 4n } }), '非 pinned 旧快照照常 prune').toBe(0);
    const liveRows = await prisma.canvasDocUpdate.findMany({ where: { projectId: PID, generation: gen }, orderBy: { seq: 'asc' } });
    expect(liveRows.map((r) => r.seq)).toEqual([7n, 8n]);   // (6,8] 保护；行 9..10 已折入 rev10 未保护——照常 purge
    // 义务不衰减（保护残余在——boot/tick resumePurges 续跑面）
    const head = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } });
    expect(head.purgeBelowSeq).not.toBeNull();

    // readAt 仍可读（红⑤-a 主断言）：pinned 坐标→快照 rev6 state+增量 (6,8]
    const read = await repo.readAt(PID, gen, 6n, 8n);
    expect(read.state).not.toBeNull();
    expect(read.stateSeq).toBe(6n);
    expect(read.updates).toHaveLength(2);
    const replay = new Y.Doc();
    Y.applyUpdate(replay, new Uint8Array(read.state!));
    for (const u of read.updates) Y.applyUpdate(replay, new Uint8Array(u));
    expect(modelOf(replay, 'a7')).toBe('m-7');
    expect(modelOf(replay, 'a8')).toBe('m-8');
    replay.destroy();

    // 过期后收敛（TTL 语义闭环）：义务续跑把保护区间清掉+义务衰减
    await prisma.$executeRaw`UPDATE "CanaryPin" SET "expiresAt" = now() - interval '1 second' WHERE "projectId" = ${PID}::text`;
    await repo.resumePurges();
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID, generation: gen } })).toBe(0);
    expect(await prisma.canvasDocSnapshot.count({ where: { projectId: PID, generation: gen, snapshotRev: 6n } })).toBe(0);
    expect((await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } })).purgeBelowSeq).toBeNull();
  });

  // ═══ 红⑤-b：pin 存活期 vacuumReplace defer 本轮 ═══

  it('红⑤-b pin 存活期 vacuumReplace → {aborted:"canary-pin-active"} 零换代零删行；pin 过期后换代照常', async () => {
    const pg = await seedFrames(PID, [frameOf('v1', 1), frameOf('v2', 2)], 0n);
    const rows = await prisma.canvasDocUpdate.findMany({ where: { projectId: PID }, orderBy: { seq: 'asc' } });
    const d = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } });
    await prisma.$executeRaw`
      INSERT INTO "CanaryPin" ("projectId", status, generation, "snapshotRev", "stateSeq", "pgSeqAt", "hashVersion", "leaseUntil", "expiresAt")
      VALUES (${PID}::text, 'READY', ${gen}::int, 0::bigint, 0::bigint, ${pg}::bigint, ${CANARY_HASH_VERSION}::int, now() + interval '15 minutes', now() + interval '15 minutes')`;
    const state = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));
    const r = await repo.vacuumReplace(PID, state, rows.length, d.generation);
    expect(r).toEqual({ aborted: 'canary-pin-active' });   // defer 本轮（返回契约档）
    // 零换代零删行
    expect((await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } })).generation).toBe(d.generation);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(Number(pg));
    // pin 过期→换代照常（defer 非死锁）
    await prisma.$executeRaw`UPDATE "CanaryPin" SET "expiresAt" = now() - interval '1 second' WHERE "projectId" = ${PID}::text`;
    const r2 = await repo.vacuumReplace(PID, state, rows.length, d.generation);
    expect(r2).toEqual({ generation: d.generation + 1 });
  });

  // ═══ poller：TTL 清扫+skip 判定链+捕获+游标写 ═══

  /** poller 装置（captureScope 测试隔离缝——auditScope C1-1 同族；serving/maintenance 桩面）。 */
  const buildPoller = (serving = () => true, frozen: string[] = []) =>
    new CollabReplayCanaryPoller(prisma as never, actor, { isLeaseServing: serving }, { isFrozen: (pid: string) => frozen.includes(pid) });

  it('poller 首步 isLeaseServing：非 serving skip（不触 withFrozenPrefix 零写面）', async () => {
    await seedFrames(PID, [frameOf('p1', 1)], 0n);
    const poller = buildPoller(() => false);
    await poller.tick();
    expect(await prisma.canaryPin.count({ where: { projectId: PID } })).toBe(0);
    expect(await prisma.collabCanaryCursor.count({ where: { projectId: PID } })).toBe(0);
  });

  it('poller TTL 过期清扫：过期 pin 删除+存活 pin 保留（每 tick 顺带）', async () => {
    await prisma.$executeRaw`
      INSERT INTO "CanaryPin" ("projectId", status, generation, "snapshotRev", "stateSeq", "pgSeqAt", "hashVersion", "leaseUntil", "expiresAt")
      VALUES ('int-c22a-expired'::text, 'READY', 1::int, 0::bigint, 0::bigint, 0::bigint, 1::int, now(), now() - interval '1 minute'),
             ('int-c22a-alive'::text, 'READY', 1::int, 0::bigint, 0::bigint, 0::bigint, 1::int, now() + interval '5 minutes', now() + interval '15 minutes')`;
    const poller = buildPoller(() => false);   // 非 serving 也清扫（TTL 面独立于捕获面）
    await poller.tick();
    expect(await prisma.canaryPin.count({ where: { projectId: 'int-c22a-expired' } })).toBe(0);
    expect(await prisma.canaryPin.count({ where: { projectId: 'int-c22a-alive' } })).toBe(1);
    await prisma.canaryPin.deleteMany({ where: { projectId: { in: ['int-c22a-expired', 'int-c22a-alive'] } } });
  });

  it('poller skip 链：lifecycleState 非 ACTIVE→skip；维护窗（maintenanceId 在）→skip；活跃 pin→skip（不重复捕获）+游标 lastResult=pin-active', async () => {
    await seedFrames(PID, [frameOf('s1', 1)], 0n);
    // lifecycle skip
    await prisma.$executeRaw`UPDATE "CanvasProject" SET "lifecycleState" = 'DELETING' WHERE "id" = ${PID}::text`;
    const poller = buildPoller();
    poller.captureScope = [PID];
    await poller.tick();
    expect(await prisma.canaryPin.count({ where: { projectId: PID } })).toBe(0);
    await prisma.$executeRaw`UPDATE "CanvasProject" SET "lifecycleState" = 'ACTIVE' WHERE "id" = ${PID}::text`;
    // 维护窗 skip（DB 行级关闸——REQUESTED 起）
    await prisma.$executeRaw`UPDATE "CanvasDoc" SET "maintenanceId" = 'mt-x' WHERE "projectId" = ${PID}::text`;
    await poller.tick();
    expect(await prisma.canaryPin.count({ where: { projectId: PID } })).toBe(0);
    await prisma.$executeRaw`UPDATE "CanvasDoc" SET "maintenanceId" = NULL WHERE "projectId" = ${PID}::text`;
    // 活跃 pin skip（worker verify 承接——不重复捕获）+游标写
    await prisma.$executeRaw`
      INSERT INTO "CanaryPin" ("projectId", status, generation, "snapshotRev", "stateSeq", "pgSeqAt", "hashVersion", "leaseUntil", "expiresAt")
      VALUES (${PID}::text, 'READY', 1::int, 0::bigint, 0::bigint, 1::bigint, 1::int, now() + interval '5 minutes', now() + interval '15 minutes')`;
    await poller.tick();
    expect(await prisma.canaryPin.count({ where: { projectId: PID } })).toBe(1);   // 原 pin 不动（未重复捕获）
    const cur = await prisma.collabCanaryCursor.findUnique({ where: { projectId: PID } });
    expect(cur).toMatchObject({ projectId: PID, generation: gen, lastResult: 'pin-active' });
    expect(cur!.lastCheckedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('poller 全链捕获：真 actor doc 在场→withFrozenPrefix→pin READY+游标 captured', async () => {
    actor.submit(PID, frameOf('f1', 1), conn, 'update').catch(() => {});
    expect(await waitUntil(async () => (await watermark()) === 1n && actor.appliedSeqOf(PID) === 1n), '帧应落定').toBe(true);
    const poller = buildPoller();
    poller.captureScope = [PID];
    await poller.tick();
    const pin = await prisma.canaryPin.findUnique({ where: { projectId: PID } });
    expect(pin).toMatchObject({ status: 'READY', generation: gen, pgSeqAt: 1n, hashSkipped: false });
    expect(pin!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const cur = await prisma.collabCanaryCursor.findUnique({ where: { projectId: PID } });
    expect(cur).toMatchObject({ projectId: PID, generation: gen, lastResult: 'captured' });
    const due = await prisma.$queryRaw<{ s: number }[]>`
      SELECT EXTRACT(EPOCH FROM ("nextDueAt" - now()))::float8 AS s FROM "CollabCanaryCursor" WHERE "projectId" = ${PID}::text`;
    expect(due[0]!.s).toBeGreaterThan(0);   // 排程占位（N 公式归 C2-2b）——SQL 侧同钟
  });

  it('writeCanaryCursor：游标 upsert 换代重置（generation 随捕获真值覆写）', async () => {
    await writeCanaryCursor(prisma, PID, 1, 'captured', 60);
    await writeCanaryCursor(prisma, PID, 2, 'captured', 60);
    const cur = await prisma.collabCanaryCursor.findUniqueOrThrow({ where: { projectId: PID } });
    expect(cur.generation).toBe(2);   // 新代覆写（旧代游标永 skip 根除）
    const due = await prisma.$queryRaw<{ s: number }[]>`
      SELECT EXTRACT(EPOCH FROM ("nextDueAt" - now()))::float8 AS s FROM "CollabCanaryCursor" WHERE "projectId" = ${PID}::text`;
    expect(due[0]!.s).toBeGreaterThan(0);   // SQL 侧同钟（timestamp 列 raw now() 写入会话钟面）
  });
});
