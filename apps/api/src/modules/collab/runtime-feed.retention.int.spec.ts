// apps/api/src/modules/collab/runtime-feed.retention.int.spec.ts
// C1-1（plan Task C1-1 红⑦——真 PG）：RuntimeEvent 保留期清理迁 worker 的语义组。
// ①对拍夹具：迁移前（api 计数法 skip excess-1）/迁移后（worker 边界法 lastSeq−100_000）删除集+
//   minRetainedSeq 逐值相等（≤100k 稠密域两法恒等）；②显式 unknown：删后首连投影折叠缺槽但真源
//   （NodeExecution）在场 ⇒ envelope.retention.unknownNodeIds 显式列出（非静默空白）；
// ③8 天未打开项目：事件全删 ⇒ 投影空+全员 unknown；④scope ACTIVE：DELETING 项目零触碰；
// ⑤100k 边界法分支：lastSeq>100k 时按 feedSeq 边界删（不数行——计数法全表扫废止的替面）。
// 另：runtime_feed_bytes 计数器维护形态断言（零 projectId 标签——E54 基调）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { register } from 'prom-client';
import { PrismaService } from '../../prisma/prisma.service';
import { RuntimeFeedRetentionService, RUNTIME_EVENT_DELETE_BATCH } from './runtime-feed.retention.service';
import { RuntimeFeedService } from './runtime-feed.service';
import './retention.metrics';   // 副作用注册（runtime_feed_bytes 迁入面——零 projectId 标签断言载体）
import { RUNTIME_EVENT_RETENTION_DAYS, RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT } from '@flowweb/shared';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();
const feedRetention = new RuntimeFeedRetentionService(prisma as unknown as PrismaService);
const feed = new RuntimeFeedService(prisma as unknown as PrismaService);

const DAY = 24 * 3600_000;
const PID = `int-c11-feed-${Date.now()}`;
const PID8 = `${PID}-8d`;
const PID_DEL = `${PID}-del`;
const PID_CAP = `${PID}-cap`;   // P0#1 cap 夹具项目（600 陈旧行——cap 出口/残余/续排空）
const UID = `int-c11-feed-owner-${Date.now()}`;

const sweepEvents = () => prisma.$transaction((tx) => feedRetention.sweepEventsInTx(tx));
const mkEvent = (projectId: string, feedSeq: number, ageMs: number, nodeId: string) => ({
  projectId, generation: 0, feedSeq: BigInt(feedSeq), kind: 'exec.status',
  payload: { v: 1, kind: 'exec.status', nodeId, status: 'done', attempts: 1, nodeVersion: String(feedSeq) } as Prisma.InputJsonValue,
  docSeq: null, createdAt: new Date(Date.now() - ageMs),
});
const mkExec = (projectId: string, nodeId: string) => ({
  projectId, nodeId, generation: 0, execSeq: 1n, nodeVersion: 1n, status: 'succeeded',
});

(hasDb ? describe : describe.skip)('C1-1 红⑦：RuntimeEvent retention 迁 worker（真 PG）', () => {
  let TID = '';

  beforeAll(async () => {
    await prisma.user.upsert({ where: { id: UID }, create: { id: UID, name: UID, email: `${UID}@test.local`, emailVerified: false }, update: {} });
    const team = await prisma.team.create({ data: { name: `int-c11-feed-${Date.now()}`, ownerId: UID } });
    TID = team.id;
    await prisma.canvasProject.create({ data: { id: PID, name: PID, teamId: TID, userId: UID } });
    await prisma.canvasProject.create({ data: { id: PID8, name: PID8, teamId: TID, userId: UID } });
    await prisma.canvasProject.create({ data: { id: PID_DEL, name: PID_DEL, teamId: TID, userId: UID, lifecycleState: 'DELETING' } });
  }, 20_000);

  afterAll(async () => {
    for (const pid of [PID, PID8, PID_DEL, PID_CAP]) {
      await prisma.runtimeEvent.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.runtimeFeedCursor.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.nodeExecution.deleteMany({ where: { projectId: pid } }).catch(() => undefined);
      await prisma.canvasProject.deleteMany({ where: { id: pid } }).catch(() => undefined);
    }
    if (TID) await prisma.team.deleteMany({ where: { id: TID } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: UID } }).catch(() => undefined);
    await prisma.$disconnect();
  }, 20_000);

  it('红⑦a 对拍：删前信封含事件折叠+retention null → sweep → 删除集/minRetainedSeq 与 api 计数法逐值相等 → 删后首连=显式 unknown（非静默空白）', async () => {
    // 夹具：seq 1-3 陈旧（8d）+seq 4 新鲜；真源 NodeExecution 四节点在场；cursor lastSeq=4。
    await prisma.runtimeFeedCursor.create({ data: { projectId: PID, lastSeq: 4n, minRetainedSeq: 0n } });
    await prisma.runtimeEvent.createMany({ data: [
      mkEvent(PID, 1, 8 * DAY, 'n-a'), mkEvent(PID, 2, 8 * DAY, 'n-b'), mkEvent(PID, 3, 8 * DAY, 'n-c'),
      mkEvent(PID, 4, 0, 'n-d'),
    ] });
    await prisma.nodeExecution.createMany({ data: [mkExec(PID, 'n-a'), mkExec(PID, 'n-b'), mkExec(PID, 'n-c'), mkExec(PID, 'n-d')] });

    // 删前首连：四节点全折叠（execStatus 槽在位）+无清除面（retention=null）
    const before = await feed.snapshotEnvelope(PID);
    expect(Object.keys(before.snapshot.nodes).sort()).toEqual(['n-a', 'n-b', 'n-c', 'n-d']);
    expect(before.retention).toBeNull();

    // 迁移前语义（api 计数法——原实现逐句复刻）：≤100k ⇒ 仅时间窗；kth=skip excess-1。
    const cutoff = new Date(Date.now() - RUNTIME_EVENT_RETENTION_DAYS * 24 * 3600_000);
    const total = await prisma.runtimeEvent.count({ where: { projectId: PID } });
    expect(total).toBeLessThanOrEqual(RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT);   // 对拍域=稠密 ≤100k（两法恒等域）
    const staleBefore = await prisma.runtimeEvent.findMany({ where: { projectId: PID, createdAt: { lt: cutoff } }, orderBy: { feedSeq: 'asc' } });
    const expectedDelete = staleBefore.map((e) => e.feedSeq);   // api 计数法（total≤100k）删除集=时间窗外全集

    // 迁移后（worker 边界法）实跑
    const swept = await sweepEvents();
    expect(swept.projects).toBe(1);
    const deleted = await prisma.runtimeEvent.findMany({ where: { projectId: PID }, orderBy: { feedSeq: 'asc' } });
    expect(deleted.map((e) => e.feedSeq)).toEqual([4n]);   // 时间窗内幸存=全集−删除集
    expect((await prisma.runtimeEvent.count({ where: { projectId: PID } }))).toBe(total - expectedDelete.length);   // 删除集对拍（行数）
    expect(swept.deletedBytes).toBeGreaterThan(0);   // RETURNING octet_length 素材（计数器维护面）
    // minRetainedSeq 对拍：现存最小 4 −1 = 3（api 旧语义 minRow.feedSeq−1）
    expect((await prisma.runtimeFeedCursor.findUniqueOrThrow({ where: { projectId: PID } })).minRetainedSeq).toBe(3n);
    expect((await feed.snapshotEnvelope(PID)).minRetainedSeq).toBe('3');

    // 删后首连：折叠缺槽+真源在场 ⇒ 显式 unknown（红⑦ 核心——非静默空白）
    const after = await feed.snapshotEnvelope(PID);
    expect(Object.keys(after.snapshot.nodes).sort()).toEqual(['n-d']);   // n-a/b/c 折叠缺槽
    expect(after.retention).not.toBeNull();
    expect(after.retention!.unknownNodeIds.sort()).toEqual(['n-a', 'n-b', 'n-c']);   // 真源在场显式列出
    expect(after.snapshot.nodes['n-d']?.execStatus?.status).toBe('done');   // 幸存折叠不受影响
  });

  it('红⑦b 8 天未打开项目：事件全删 ⇒ 投影空+全员显式 unknown+minRetainedSeq=lastSeq 快照档', async () => {
    await prisma.runtimeFeedCursor.create({ data: { projectId: PID8, lastSeq: 2n, minRetainedSeq: 0n } });
    await prisma.runtimeEvent.createMany({ data: [mkEvent(PID8, 1, 8 * DAY, 'n-x'), mkEvent(PID8, 2, 9 * DAY, 'n-y')] });
    await prisma.nodeExecution.createMany({ data: [mkExec(PID8, 'n-x'), mkExec(PID8, 'n-y')] });

    const swept = await sweepEvents();
    expect(await prisma.runtimeEvent.count({ where: { projectId: PID8 } })).toBe(0);   // 事件全删（8d 未打开）
    expect((await prisma.runtimeFeedCursor.findUniqueOrThrow({ where: { projectId: PID8 } })).minRetainedSeq).toBe(2n);   // 全删空=lastSeq（api 旧语义快照档）

    const env = await feed.snapshotEnvelope(PID8);
    expect(env.snapshot.nodes).toEqual({});   // 投影空
    expect(env.minRetainedSeq).toBe('2');
    expect(env.retention?.unknownNodeIds.sort()).toEqual(['n-x', 'n-y']);   // 全员显式 unknown（真源在场）
    void swept;
  });

  it('红⑦ scope：DELETING 项目事件/cursor 零触碰（擦除中项目行集与 retention 不相交）', async () => {
    await prisma.runtimeFeedCursor.create({ data: { projectId: PID_DEL, lastSeq: 1n, minRetainedSeq: 0n } });
    await prisma.runtimeEvent.createMany({ data: [mkEvent(PID_DEL, 1, 30 * DAY, 'n-z')] });   // 30d 陈旧=必删候选
    await sweepEvents();
    expect(await prisma.runtimeEvent.count({ where: { projectId: PID_DEL } })).toBe(1);   // 零触碰
    expect((await prisma.runtimeFeedCursor.findUniqueOrThrow({ where: { projectId: PID_DEL } })).minRetainedSeq).toBe(0n);   // cursor 不推进
  });

  it('红⑦ 100k 边界法分支：lastSeq>100_000 ⇒ 按 feedSeq 边界删（不数行——计数法全表扫废止替面）', async () => {
    // 稀疏域夹具：仅 3 行（seq 1/2 新鲜、seq 100_002 新鲜）+cursor lastSeq=100_002 ⇒ boundary=2。
    // （cursor 行红⑦a 已建——upsert 推 lastSeq 模拟分配序推进）
    await prisma.runtimeFeedCursor.upsert({
      where: { projectId: PID },
      create: { projectId: PID, lastSeq: 100_002n, minRetainedSeq: 0n },
      update: { lastSeq: 100_002n, minRetainedSeq: 0n },
    });
    await prisma.runtimeEvent.createMany({ data: [
      mkEvent(PID, 1, 0, 'n-e1'), mkEvent(PID, 2, 0, 'n-e2'), mkEvent(PID, 100_002, 0, 'n-e3'),
    ] });
    const before = await prisma.runtimeEvent.count({ where: { projectId: PID } });
    expect(before).toBe(4);   // 红⑦a 幸存 seq4+本用例三行——行数远小于 100k（计数法于此不删，边界法按分配序删）
    await sweepEvents();
    const kept = (await prisma.runtimeEvent.findMany({ where: { projectId: PID }, orderBy: { feedSeq: 'asc' } })).map((e) => e.feedSeq);
    expect(kept).toEqual([4n, 100_002n]);   // feedSeq≤lastSeq−100_000（≤2）删——时间窗新鲜亦删（分配序即保留窗）；红⑦a 幸存 4 在界内保留
  });

  it('runtime_feed_bytes 计数器维护形态：零 projectId 标签（E54 基调——病态归 top-N 结构化日志）+boot 基线 SUM 单点', async () => {
    const m = register.getSingleMetric('runtime_feed_bytes') as { labelNames: string[] } | undefined;
    expect(m).toBeDefined();
    expect(m!.labelNames ?? []).toEqual([]);   // projectId 标签删除断言
    const baseline = await feedRetention.bytesBaseline();
    expect(baseline).toBeGreaterThanOrEqual(0);   // boot SUM 一次（此后删除批累减——api 每 SUM 扫废止）
  });

  it('红⑦ cap：event 扫面每 tick 批数上界——首 tick 恰 cap 批出口+部分进度已提交（残余在库）+backlog count 回填+第二 tick 续排空', async () => {
    // 夹具：PID_CAP 600 行 8d 陈旧（>1 批——cap=1 首 tick 恰 500、残余 100）；其余项目界内新鲜=零贡献
    await prisma.canvasProject.create({ data: { id: PID_CAP, name: PID_CAP, teamId: TID, userId: UID } });
    await prisma.runtimeFeedCursor.create({ data: { projectId: PID_CAP, lastSeq: 600n, minRetainedSeq: 0n } });
    await prisma.runtimeEvent.createMany({ data: Array.from({ length: 600 }, (_, i) => mkEvent(PID_CAP, i + 1, 8 * DAY, `n-cap-${i}`)) });

    // 首 tick：小 cap 注入=1 批（生产默认 200——可测性注入）+scope 域内化（并行文件共享库隔离缝）——
    // 恰删 1 批、cap 出口、残余在库（部分进度已提交）
    const first = await prisma.$transaction((tx) => feedRetention.sweepEventsInTx(tx, 1, [PID_CAP]));
    expect(first.deleted).toBe(RUNTIME_EVENT_DELETE_BATCH);   // 恰 1 批=500（scope 域内——外域残留零贡献）
    expect(first.capped).toBe(true);                           // cap 出口（≠排空出口——残余行下 tick 续）
    expect(await prisma.runtimeEvent.count({ where: { projectId: PID_CAP } })).toBe(600 - RUNTIME_EVENT_DELETE_BATCH);
    // cap 出口 ⇒ backlog gauge 回填素材（poller 消费面）：按需 count=保留窗外残余恰 100（scope 域内）
    expect(await feedRetention.countRetentionBacklog([PID_CAP])).toBe(600 - RUNTIME_EVENT_DELETE_BATCH);

    // 第二 tick：续排空（残余 100<1 批 ⇒ 非 cap 出口——跨 tick 单调排空收敛；全删空=minRetainedSeq lastSeq 快照档）
    const second = await prisma.$transaction((tx) => feedRetention.sweepEventsInTx(tx, 1, [PID_CAP]));
    expect(second.capped).toBe(false);
    expect(await prisma.runtimeEvent.count({ where: { projectId: PID_CAP } })).toBe(0);   // 排空
    expect((await prisma.runtimeFeedCursor.findUniqueOrThrow({ where: { projectId: PID_CAP } })).minRetainedSeq).toBe(600n);
  });
});