// apps/api/src/modules/collab/runtime-feed.t22-g5.int.spec.ts
// Y1c T22 G5 feed 主体（真 PG）：feedSeq 分配（upsert 行锁——分配序≡提交序：并发交错无洞无重）
// +空项目首事件（genesis upsert）+锁序负控（CanvasDoc 行锁下 append 照常完成=plain SELECT 非阻塞
// 〔修正批 #10〕——T22 收口批 I-6：fire-and-forget 持锁真并发重叠；反向锁序恒死锁面由静态 lint+
// 正常序压力替代）+「去 counter」负控（裸裸 INSERT 不走 upsert=期望重号冲突）+outbox claim/delete
// 不出洞+首连快照信封（cursor 三元+minRetainedSeq+historyId）+保留期清理（minRetainedSeq 推进）
// +FEED_TOMBSTONE 义务消费→node.deleted 事件+NODE_DELETED 三清扫（VideoProject 级联/投影拦截/
// MediaBinding reconcile 入队 M-3 注桩）。
// T22 收口批新增：C-3 快照竞态（RR+先 cursor 后 events+≤lastSeq 过滤）+I-5 租约
// 重派崩溃窗+I-9 跨项目同 nodeId 串扰（claim 行 projectId 直用）。
// G5 末轮小收口：C-3 命中窗确定性化（racer 事务持 RuntimeFeedCursor 表 ACCESS EXCLUSIVE 锁+pg_sleep——
// 读面 cursor 读排队至 racer 提交：现码恒绿/父版本 RC 先 events 后 cursor 必红，替换原 8 轮概率迭代）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RuntimeFeedService, foldEventsToSnapshot, slotOfEvent, feedHintPayload } from './runtime-feed.service';
import { LifecycleObligationSweeper } from './lifecycle-obligation.sweeper';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();
const feed = new RuntimeFeedService(prisma as unknown as PrismaService);
const sweeper = new LifecycleObligationSweeper(prisma as unknown as PrismaService, feed);

const PID = `int-t22-feed-${Date.now()}`;
const SEED_UID = `int-t22-feed-owner-${Date.now()}`;
let TID = '';

(hasDb ? describe : describe.skip)('Y1c T22 G5：RuntimeFeedService（真 PG）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: SEED_UID }, create: { id: SEED_UID, name: SEED_UID, email: `${SEED_UID}@t.local`, emailVerified: false }, update: {} });
    const team = await prisma.team.create({ data: { name: `t22-feed-${Date.now()}`, ownerId: SEED_UID } });
    TID = team.id;
    await prisma.canvasProject.create({ data: { id: PID, name: PID, teamId: TID, userId: SEED_UID } });
    await prisma.canvasDoc.create({ data: { projectId: PID, generation: 0, pgSeq: 5n, walCheckpointSeq: 5n, currentSnapshotRev: 0n } });
  }, 20_000);

  afterAll(async () => {
    const PID2 = `${PID}-b`;   // I-9 跨项目用例第二项目（同 TID/team 域）
    for (const pid of [PID, PID2]) {
      await prisma.runtimeEvent.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.nodeLifecycle.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.deliveryFence.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.lifecycleObligation.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.executionOutbox.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.videoProject.deleteMany({ where: { workflowId: pid } }).catch(() => undefined);
      await prisma.artifactProjection.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasProject.deleteMany({ where: { id: pid } }).catch(() => undefined);
    }
    if (TID) await prisma.team.deleteMany({ where: { id: TID } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: SEED_UID } }).catch(() => undefined);
    await prisma.$disconnect();
  }, 20_000);

  it('空项目首事件（genesis upsert）：无 cursor 行首写自建——feedSeq=1+docSeq=CanvasDoc.pgSeq 下界', async () => {
    const r = await feed.appendEvent(PID, 'exec.status', () => ({ nodeId: 'n1', status: 'loading', attempts: 1 }));
    expect(r.feedSeq).toBe(1n);   // upsert 空项目首事件 0 行问题修（spec §7 v5.3⑫）
    expect(r.docSeq).toBe(5n);
    expect(r.generation).toBe(0);
  });

  it('并发交错分配（N=8 双批 Promise.all）：feedSeq 2..9 连续无洞无重（upsert 行锁=分配序≡提交序）', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      feed.appendEvent(PID, 'exec.status', () => ({ nodeId: `n-${i}`, status: 'loading', attempts: 1 }))));
    const seqs = (await prisma.runtimeEvent.findMany({ where: { projectId: PID }, orderBy: { feedSeq: 'asc' } })).map((e) => e.feedSeq);
    expect(seqs).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n]);
  });

  it('锁序（修正批 #10）：CanvasDoc 行被他事务 FOR UPDATE 持锁中——append 照常完成（plain SELECT 非阻塞非锁读）。T22 收口批 I-6：fire-and-forget 持锁=真并发重叠（原 await lockHolder 完整结束后才 append=零重叠假绿——FOR SHARE 也照样过）', async () => {
    let lockTaken = false;
    let holderDone = false;
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "projectId" FROM "CanvasDoc" WHERE "projectId" = ${PID}::text FOR UPDATE`;
      lockTaken = true;
      await new Promise((r) => setTimeout(r, 2_000));   // 持锁窗（append 必须在窗内并发到达——重叠证据）
      return true;
    }).then((v) => { holderDone = true; return v; });
    for (let i = 0; i < 200 && !lockTaken; i += 1) await new Promise((r) => setTimeout(r, 10));   // 锁落位确认（确定性重叠）
    expect(lockTaken).toBe(true);
    const t0 = Date.now();
    const r = await feed.appendEvent(PID, 'exec.status', () => ({ nodeId: 'n-lock', status: 'done', attempts: 1 }));
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2_000);   // 非阻塞（MVCC 快照读——FOR SHARE 则排队等持锁窗结束）
    expect(holderDone).toBe(false);        // append 完成时持锁事务仍在窗内=真并发重叠（I-6 行为证据）
    await holder;
    expect(r.feedSeq).toBeGreaterThan(9n);
  }, 20_000);

  it('「去 counter」负控：绕过 upsert 裸 INSERT 同 feedSeq=唯一冲突拒（期望报错——证 counter 为唯一取号路径）', async () => {
    const cursor = await prisma.runtimeFeedCursor.findUnique({ where: { projectId: PID } });
    await expect(prisma.runtimeEvent.create({ data: {
      projectId: PID, generation: 0, feedSeq: cursor!.lastSeq, kind: 'exec.status',
      payload: { v: 1, kind: 'exec.status', nodeId: 'x', status: 'x', attempts: 0, nodeVersion: '0' } as unknown as Prisma.InputJsonValue,
    } })).rejects.toThrow();   // @@unique([projectId, feedSeq])——「去 counter」直插重号必拒
  });

  it('outbox claim/delete 不出洞：outbox 行 claim/删除后 feed 事件流连续（feed=RuntimeEvent 非 outbox）', async () => {
    await prisma.executionOutbox.createMany({ data: [
      { projectId: PID, generation: 0, businessKey: 'b1', kind: 'x' },
      { projectId: PID, generation: 0, businessKey: 'b2', kind: 'x' },
    ] });
    await prisma.executionOutbox.updateMany({ where: { projectId: PID }, data: { state: 'CLAIMED', claimOwner: 'w1' } });
    await prisma.executionOutbox.deleteMany({ where: { projectId: PID, businessKey: 'b1' } });
    await feed.appendEvent(PID, 'exec.artifact', () => ({ nodeId: 'n-ob', mediaId: 'm-ob', artifactRev: 1 }));
    const seqs = (await prisma.runtimeEvent.findMany({ where: { projectId: PID }, orderBy: { feedSeq: 'asc' } })).map((e) => e.feedSeq);
    for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]!).toBe(seqs[i - 1]! + 1n);   // 连续（outbox churn 零影响）
  });

  it('readAfter 升序 ≤200+latestFeedSeq/historyId 信封（HTTP 游标读面）', async () => {
    const rows = await feed.readAfter(PID, 0n, 200);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.feedSeq).toBe('1');
    for (let i = 1; i < rows.length; i += 1) {
      expect(BigInt(rows[i]!.feedSeq)).toBe(BigInt(rows[i - 1]!.feedSeq) + 1n);
    }
    const latest = await feed.latestFeedSeq(PID);
    expect(latest).toBe(BigInt(rows[rows.length - 1]!.feedSeq));
    const historyId = await feed.currentHistoryId();
    expect(typeof historyId).toBe('string');
    expect(historyId.length).toBeGreaterThan(0);
  });

  it('首连快照：snapshotEnvelope {snapshot,cursor 三元,minRetainedSeq,historyId}——折叠投影槽位正确（execStatus/artifact）', async () => {
    const env = await feed.snapshotEnvelope(PID);
    expect(env.snapshot.projectId).toBe(PID);
    expect(env.cursor.historyId).toBe(env.historyId);
    expect(env.cursor.generation).toBe(0);
    expect(BigInt(env.cursor.feedSeq)).toBe(await feed.latestFeedSeq(PID));
    const n1 = env.snapshot.nodes.n1!;
    expect(n1.execStatus?.status).toBeDefined();
    expect(env.snapshot.nodes['n-lock']?.execStatus?.status).toBe('done');
    expect(env.snapshot.nodes['n-ob']?.artifact?.mediaId).toBe('m-ob');
  });

  it('feed-hint 载荷：{type:"feed-hint",latestFeedSeq}——不带事件体（唯一交付=HTTP 游标）', () => {
    const p = JSON.parse(feedHintPayload(42n)) as { type: string; latestFeedSeq: string };
    expect(p).toEqual({ type: 'feed-hint', latestFeedSeq: '42' });
  });

  it('保留期清理：7d 外事件删+minRetainedSeq 推进到现存最小-1', async () => {
    // 造一行 8d 前的陈旧事件（feedSeq 领先分配——手动插入走 cursor upsert 语义）
    const r = await feed.appendEvent(PID, 'exec.status', () => ({ nodeId: 'n-old', status: 'done', attempts: 1 }));
    await prisma.runtimeEvent.update({ where: { projectId_feedSeq: { projectId: PID, feedSeq: r.feedSeq } }, data: { createdAt: new Date(Date.now() - 8 * 24 * 3600_000) } });
    const before = await prisma.runtimeEvent.count({ where: { projectId: PID } });
    await feed.sweepRetention();
    const after = await prisma.runtimeEvent.count({ where: { projectId: PID } });
    expect(after).toBe(before - 1);   // 8d 陈旧行删（余行 7d 内保留）
    const minRow = await prisma.runtimeEvent.findFirst({ where: { projectId: PID }, orderBy: { feedSeq: 'asc' } });
    expect(await feed.minRetainedSeq(PID)).toBe(minRow!.feedSeq - 1n);
  });

  it('PII 扫描+payload 超限拒写（64KB）+unknown kind 拒写（closed registry）', async () => {
    await expect(feed.appendEvent(PID, 'exec.status', () => ({ nodeId: 'n1', status: 'x', attempts: 1, promptText: '画一只猫' } as never)))
      .rejects.toThrow(/PII_FORBIDDEN/);
    await expect(feed.appendEvent(PID, 'exec.status', () => ({ nodeId: 'n1', status: 'x'.repeat(70_000), attempts: 1 })))
      .rejects.toThrow(/TOO_LARGE/);
    await expect(feed.appendEvent(PID, 'media.fact' as never, () => ({ mediaId: 'm1' } as never)))
      .rejects.toThrow(/KIND_UNKNOWN/);
  });

  it('G5 六语料服务端锚：foldEventsToSnapshot 折叠=shared merge 单源（node.restored 复活+墓碑）', async () => {
    // 纯函数语料（不进 PG——折叠与 slotOfEvent 为发布面纯函数）
    const mk = (feedSeq: number, payload: Record<string, unknown>) => ({
      id: `e${feedSeq}`, feedSeq: String(feedSeq), generation: 0, kind: payload.kind as string,
      payload: { v: 1, ...payload } as never, docSeq: null, createdAtMs: 0,
    });
    const folded = foldEventsToSnapshot(PID, 0, [
      mk(1, { kind: 'node.deleted', nodeId: 'nX', lifecycleSeq: '3', nodeVersion: '1' }),
      mk(2, { kind: 'node.restored', nodeId: 'nX', lifecycleSeq: '4', nodeVersion: '2' }),
      mk(3, { kind: 'exec.artifact', nodeId: 'nX', mediaId: 'mR', artifactRev: 1, nodeVersion: '3' }),
    ], 5n, 3n);
    const entry = folded.nodes.nX!;
    expect(entry.deletedAt).toBeDefined();       // 墓碑保留（历史）
    expect(entry.restored?.lifecycleSeq).toBe('4');
    expect(entry.artifact?.mediaId).toBe('mR');
    // 复活后墓碑非 active（restored=2 ≥ deletedAt=1）
    const { isActiveTombstone } = await import('@flowweb/shared');
    expect(isActiveTombstone(entry)).toBe(false);
    void slotOfEvent;
  });

  it('FEED_TOMBSTONE 义务消费→node.deleted feed 事件投递+义务 DONE（#11 队列转移单源）', async () => {
    await prisma.nodeLifecycle.createMany({ data: [
      { projectId: PID, nodeId: 'n-del', lifecycleSeq: 7n, isCurrent: true, state: 'DELETED', walSeq: 42n },
    ] });
    await prisma.lifecycleObligation.create({ data: { projectId: PID, nodeId: 'n-del', kind: 'FEED_TOMBSTONE', walSeq: 42n } });
    const summary = await sweeper.tick();
    expect(summary.done).toBeGreaterThanOrEqual(1);
    const events = await prisma.runtimeEvent.findMany({ where: { projectId: PID, kind: 'node.deleted' } });
    expect(events.length).toBe(1);
    expect((events[0]!.payload as { nodeId: string; lifecycleSeq: string })).toMatchObject({ nodeId: 'n-del', lifecycleSeq: '7' });
    const obligation = await prisma.lifecycleObligation.findFirst({ where: { projectId: PID, nodeId: 'n-del' } });
    expect(obligation?.state).toBe('DONE');
    // 幂等：复扫零重复事件
    await sweeper.tick();
    expect(await prisma.runtimeEvent.count({ where: { projectId: PID, kind: 'node.deleted' } })).toBe(1);
  });

  it('NODE_DELETED 三清扫：VideoProject 级联删+ArtifactProjection 在飞行置 orphaned+MediaBinding reconcile 入队（M-3 注桩断言）+EXEC_FINALIZE 不被 claim（留 T23）', async () => {
    await prisma.videoProject.create({ data: { teamId: TID, userId: SEED_UID, workflowId: PID, sourceNodeId: 'n-del', title: 'x', data: {} } });
    await prisma.artifactProjection.create({ data: { artifactId: 'art-pending', artifactRev: 1, projectId: PID, nodeId: 'n-del', targetField: 'fileId', targetItemId: '', mediaId: 'm-p', state: 'pending' } });
    await prisma.lifecycleObligation.create({ data: { projectId: PID, nodeId: 'n-del', kind: 'NODE_DELETED', walSeq: 42n } });
    await prisma.lifecycleObligation.create({ data: { projectId: PID, nodeId: 'n-del', kind: 'EXEC_FINALIZE', walSeq: 42n } });
    // T22 收口批 M-3：reconcile 腿注桩断言（①清扫面 @Optional 注入——修前零断言）
    const reconcileCalls: string[] = [];
    const sweeperWithReconciler = new LifecycleObligationSweeper(prisma as unknown as PrismaService, feed, {
      requestReconcile: (pid: string) => { reconcileCalls.push(pid); },
    } as never);
    await sweeperWithReconciler.tick();
    expect(reconcileCalls).toContain(PID);   // ①MediaBinding 惰性入队腿（fence 权威之外的第二清扫面）
    expect(await prisma.videoProject.count({ where: { workflowId: PID, sourceNodeId: 'n-del' } })).toBe(0);   // ③级联（I-9：项目域过滤后）
    expect((await prisma.artifactProjection.findFirst({ where: { projectId: PID, nodeId: 'n-del' } }))?.state).toBe('orphaned');   // ②拦截
    const execFinalize = await prisma.lifecycleObligation.findFirst({ where: { projectId: PID, kind: 'EXEC_FINALIZE' } });
    expect(execFinalize?.state).toBe('PENDING');   // 退款主体归 T23——本卡不 claim
    const nodeDeleted = await prisma.lifecycleObligation.findFirst({ where: { projectId: PID, kind: 'NODE_DELETED' } });
    expect(nodeDeleted?.state).toBe('DONE');
  });

  it('C-3 快照竞态（确定性命中窗——外持 RuntimeFeedCursor 表锁+pg_sleep 注入）：racer 卡在「cursor 已 bump、事件已插、未提交」窗——凡 feedSeq≤cursor 的事件必已折叠（RR+先 cursor 后 events+≤lastSeq 过滤；父版本 RC 先 events 后 cursor=读窗跨 racer 提交⇒cursor 领先折叠事件必红）', async () => {
    // 自播种基线（独立执行不依赖兄弟用例——C2/C3/C13 先例）
    await feed.appendEvent(PID, 'exec.status', () => ({ nodeId: 'n-race-base', status: 'done', attempts: 1 }));
    // 确定性构造（M-10 外持 DeliveryFence 锁先例）：racer 事务持 RuntimeFeedCursor ACCESS EXCLUSIVE 表锁
    // ⇒ 读面的 cursor 读必排队至 racer 提交。本机实证的快照时序非对称=确定性判别源：
    //   现码（RR+先 cursor 后 events）：cursor 读排队但 RR 事务快照先于锁等待锚定（提交前态）⇒ cursor=N-1
    //     +events≤N-1 同一事务快照（提交前态）⇒ 恒绿——且 RR 单快照下「cursor 见 N 而 events 不见其事件」
    //     结构性不可达（red 形态对现码=不可能事件）；racer 事件 >cursor 属未覆盖水位，客户端 after=cursor 追平零丢失；
    //   父版本（RC+先 events 后 cursor）：events 读不阻塞窗内先行（RC 语句级快照=提交前⇒错过 racer 事件）
    //     ⇒ cursor 读排队至提交后（RC 语句级快照在锁等待后取=提交后态⇒见 N）⇒ 信封 cursor=N 领先折叠事件
    //     ⇒ 必红（客户端 seq≤cursorSeq 去重+h≤cursor 忽略=事件永久不可见——原 probe cursorLastSeq=2>maxFoldedEventSeq=1 同形态）。
    let lockTaken = false;
    const racer = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "RuntimeFeedCursor" IN ACCESS EXCLUSIVE MODE`;
      lockTaken = true;
      const cursorRows = await tx.$queryRaw<{ lastSeq: bigint }[]>`
        INSERT INTO "RuntimeFeedCursor" ("projectId", "lastSeq", "minRetainedSeq") VALUES (${PID}::text, 1, 0)
        ON CONFLICT ("projectId") DO UPDATE SET "lastSeq" = "RuntimeFeedCursor"."lastSeq" + 1
        RETURNING "lastSeq"`;
      const seq = cursorRows[0]!.lastSeq;
      await tx.runtimeEvent.create({ data: { projectId: PID, generation: 0, feedSeq: seq, kind: 'exec.status',
        payload: { v: 1, kind: 'exec.status', nodeId: 'n-race2', status: 'done', attempts: 1, nodeVersion: String(seq) } as unknown as Prisma.InputJsonValue } });
      await tx.$executeRaw`SELECT pg_sleep(1.5)`;   // 卡在「cursor 已 bump、事件已插、未提交」窗（读面在窗内发起）
      return seq;
    }, { timeout: 10_000, maxWait: 5_000 });
    for (let i = 0; i < 300 && !lockTaken; i += 1) await new Promise((r) => setTimeout(r, 10));   // 锁落位确认（读面必在窗内到达）
    expect(lockTaken).toBe(true);
    const env = await feed.snapshotEnvelope(PID);   // 与 racer 真并发（读面两语句相对提交时点=竞态窗本体）
    const seq = await racer;
    // 不变量（信封自洽）：凡 feedSeq≤cursor 的 exec.status 事件其节点槽必在折叠投影
    const covered = await prisma.runtimeEvent.findMany({ where: { projectId: PID, feedSeq: { lte: BigInt(env.cursor.feedSeq) } }, orderBy: { feedSeq: 'asc' } });
    expect(covered.length).toBeGreaterThan(0);
    for (const e of covered) {
      const p = e.payload as { kind: string; nodeId?: string };
      if (p.kind !== 'exec.status') continue;
      expect(env.snapshot.nodes[p.nodeId!]?.execStatus, `feedSeq=${e.feedSeq} ≤ cursor=${env.cursor.feedSeq} 未折叠（cursor 领先折叠事件）`).toBeDefined();
    }
    // 确定性收口：racer 事件一旦落入 cursor 水位内（父版本=events 先读错过+cursor 后读见 N）必须被折叠
    if (BigInt(env.cursor.feedSeq) >= seq) {
      expect(env.snapshot.nodes['n-race2']?.execStatus, `cursor=${env.cursor.feedSeq} ≥ racer seq=${seq} 但事件未折叠（读窗跨提交——父版本必红形态）`).toBeDefined();
    }
  }, 20_000);

  it('I-5 租约重派崩溃窗：CLAIMED∧租约过期行被重 claim 执行+attempts 按 lease-expired 计一次（原谓词只 PENDING=崩溃后永久卡死红）', async () => {
    await prisma.nodeLifecycle.create({ data: { projectId: PID, nodeId: 'n-lease', lifecycleSeq: 9n, isCurrent: true, state: 'DELETED', walSeq: 50n } });
    await prisma.lifecycleObligation.create({
      data: { projectId: PID, nodeId: 'n-lease', kind: 'FEED_TOMBSTONE', walSeq: 50n, state: 'CLAIMED', claimOwner: 'obligation-crashed', claimUntilMs: BigInt(Date.now() - 60_000), attempts: 0 },
    });
    const summary = await sweeper.tick();   // 红：修前 PENDING-only 谓词跳过 CLAIMED 过期行=claimed 0/事件不投/行卡死
    expect(summary.claimed).toBeGreaterThanOrEqual(1);
    const tombstones = (await prisma.runtimeEvent.findMany({ where: { projectId: PID, kind: 'node.deleted' } }))
      .filter((e) => (e.payload as { nodeId?: string }).nodeId === 'n-lease');
    expect(tombstones).toHaveLength(1);   // node.deleted 事件投递（崩溃窗恢复）
    const row = await prisma.lifecycleObligation.findFirst({ where: { projectId: PID, nodeId: 'n-lease' } });
    expect(row?.state).toBe('DONE');
    expect(row?.attempts).toBe(1);   // lease-expired 重派计一次尝试（shared nextObligationQueueState 单源语义）
  }, 20_000);

  it('I-9 跨项目同 nodeId 串扰：claim 行 projectId 直用（删全库反查）——清扫/投递各归各项目（原 findFirst desc 反查=两项目都作用于最新行项目）', async () => {
    const PID2 = `${PID}-b`;
    await prisma.canvasProject.create({ data: { id: PID2, name: PID2, teamId: TID, userId: SEED_UID } });
    const SHARED = 'n-shared';
    await prisma.nodeLifecycle.createMany({ data: [
      { projectId: PID, nodeId: SHARED, lifecycleSeq: 1n, isCurrent: true, state: 'DELETED', walSeq: 60n },
      { projectId: PID2, nodeId: SHARED, lifecycleSeq: 1n, isCurrent: true, state: 'DELETED', walSeq: 60n },
    ] });
    await prisma.lifecycleObligation.create({ data: { projectId: PID, nodeId: SHARED, kind: 'FEED_TOMBSTONE', walSeq: 60n } });
    await new Promise((r) => setTimeout(r, 15));   // 错开 createdAt——修前 findFirst desc 反查恒取最新行（PID2）：双执行都作用于 PID2 ⇒ PID 零事件（红确定性）
    await prisma.lifecycleObligation.create({ data: { projectId: PID2, nodeId: SHARED, kind: 'FEED_TOMBSTONE', walSeq: 60n } });
    await prisma.artifactProjection.createMany({ data: [
      { artifactId: 'art-x-a', artifactRev: 1, projectId: PID, nodeId: SHARED, targetField: 'fileId', targetItemId: '', mediaId: 'm-a', state: 'pending' },
      { artifactId: 'art-x-b', artifactRev: 1, projectId: PID2, nodeId: SHARED, targetField: 'fileId', targetItemId: '', mediaId: 'm-b', state: 'pending' },
    ] });
    const summary = await sweeper.tick();
    expect(summary.claimed).toBeGreaterThanOrEqual(2);   // 两行都 claim（含跨项目同 nodeId）
    // FEED_TOMBSTONE：node.deleted 事件各投各项目（修前反查=两事件同落一个项目、另一项目零事件）
    for (const pid of [PID, PID2]) {
      const evs = (await prisma.runtimeEvent.findMany({ where: { projectId: pid, kind: 'node.deleted' } }))
        .filter((e) => (e.payload as { nodeId?: string }).nodeId === SHARED);
      expect(evs, `projectId=${pid} 应恰一条 ${SHARED} 墓碑事件`).toHaveLength(1);
    }
    // NODE_DELETED 清扫面：ArtifactProjection 各项目各自置 orphaned（修前只作用于反查命中项目）
    await prisma.lifecycleObligation.create({ data: { projectId: PID, nodeId: SHARED, kind: 'NODE_DELETED', walSeq: 61n } });
    await new Promise((r) => setTimeout(r, 15));   // 同上：反查恒取 PID2 行（红确定性）
    await prisma.lifecycleObligation.create({ data: { projectId: PID2, nodeId: SHARED, kind: 'NODE_DELETED', walSeq: 61n } });
    await sweeper.tick();
    expect((await prisma.artifactProjection.findFirst({ where: { projectId: PID, nodeId: SHARED } }))?.state).toBe('orphaned');
    expect((await prisma.artifactProjection.findFirst({ where: { projectId: PID2, nodeId: SHARED } }))?.state).toBe('orphaned');
  }, 20_000);
});
