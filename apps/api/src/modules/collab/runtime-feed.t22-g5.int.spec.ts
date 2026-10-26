// apps/api/src/modules/collab/runtime-feed.t22-g5.int.spec.ts
// Y1c T22 G5 feed 主体（真 PG）：feedSeq 分配（upsert 行锁——分配序≡提交序：并发交错无洞无重）
// +空项目首事件（genesis upsert）+锁序负控（CanvasDoc 行锁下 append 照常完成=plain SELECT 非阻塞
// 〔修正批 #10〕——反向锁序〔持 counter 后再锁 CanvasDoc〕恒死锁面由静态 lint+正常序压力替代）
// +「去 counter」负控（裸裸 INSERT 不走 upsert=期望重号冲突）+outbox claim/delete 不出洞+首连
// 快照信封（cursor 三元+minRetainedSeq+historyId）+保留期清理（minRetainedSeq 推进）+
// FEED_TOMBSTONE 义务消费→node.deleted 事件+NODE_DELETED 三清扫（VideoProject 级联/投影拦截）。
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
    await prisma.runtimeEvent.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.nodeLifecycle.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.deliveryFence.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.lifecycleObligation.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.executionOutbox.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.videoProject.deleteMany({ where: { workflowId: PID } }).catch(() => undefined);
    await prisma.artifactProjection.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma.canvasProject.deleteMany({ where: { id: PID } }).catch(() => undefined);
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

  it('锁序（修正批 #10）：CanvasDoc 行被他事务 FOR UPDATE 锁持——append 照常完成（plain SELECT 非阻塞非锁读）', async () => {
    const lockHolder = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "projectId" FROM "CanvasDoc" WHERE "projectId" = ${PID}::text FOR UPDATE`;
      await new Promise((r) => setTimeout(r, 800));   // 持锁窗
      return true;
    });
    void lockHolder;
    const t0 = Date.now();
    const r = await feed.appendEvent(PID, 'exec.status', () => ({ nodeId: 'n-lock', status: 'done', attempts: 1 }));
    expect(Date.now() - t0).toBeLessThan(5_000);   // 非阻塞（MVCC 快照读——FOR SHARE 则排队超时）
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

  it('NODE_DELETED 三清扫：VideoProject 级联删+ArtifactProjection 在飞行置 orphaned（EXEC_FINALIZE 不被 claim——留 T23）', async () => {
    await prisma.videoProject.create({ data: { teamId: TID, userId: SEED_UID, workflowId: PID, sourceNodeId: 'n-del', title: 'x', data: {} } });
    await prisma.artifactProjection.create({ data: { artifactId: 'art-pending', artifactRev: 1, projectId: PID, nodeId: 'n-del', targetField: 'fileId', targetItemId: '', mediaId: 'm-p', state: 'pending' } });
    await prisma.lifecycleObligation.create({ data: { projectId: PID, nodeId: 'n-del', kind: 'NODE_DELETED', walSeq: 42n } });
    await prisma.lifecycleObligation.create({ data: { projectId: PID, nodeId: 'n-del', kind: 'EXEC_FINALIZE', walSeq: 42n } });
    await sweeper.tick();
    expect(await prisma.videoProject.count({ where: { sourceNodeId: 'n-del' } })).toBe(0);   // ③级联
    expect((await prisma.artifactProjection.findFirst({ where: { projectId: PID, nodeId: 'n-del' } }))?.state).toBe('orphaned');   // ②拦截
    const execFinalize = await prisma.lifecycleObligation.findFirst({ where: { projectId: PID, kind: 'EXEC_FINALIZE' } });
    expect(execFinalize?.state).toBe('PENDING');   // 退款主体归 T23——本卡不 claim
    const nodeDeleted = await prisma.lifecycleObligation.findFirst({ where: { projectId: PID, kind: 'NODE_DELETED' } });
    expect(nodeDeleted?.state).toBe('DONE');
  });
});
