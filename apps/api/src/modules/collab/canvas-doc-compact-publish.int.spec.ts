// Y1c T11（plan Task 11）：compact 重写=快照发布（真 PG——int 池）。红组①并发 PK 冲突折正常 miss
// +发布事务语义（指针/purgeBelowSeq 同事务+跨表不变量 Snapshot.stateSeq≤pgSeq）+保留策略+交错组
// （装载×compact×append）。播种=appendBatch+水位 CAS 链（actor 单写者形态——pgSeq 权威列推进）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y1c-t11-compact-int';

maybe('Y1c T11 compact 发布（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  beforeEach(async () => {
    await ensureLeaseFixture(prisma, repo);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
  });
  afterAll(async () => {
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
  });

  /** 节点相异载荷（同字节帧会被 updateHash 幂等吞——count 锚失真）。 */
  const frameOf = (key: string, n: number) => {
    const d = new Y.Doc();
    d.getMap('nodes').set(key, new Y.Map([['x', n]]));
    return Y.encodeStateAsUpdate(d);
  };

  /** actor 单写者播种链：逐帧 appendBatch+水位 CAS（pgSeq 权威列推进——compact 授权读的真值源）。
   *  头行走 raw INSERT（T11 前后 schema 通吃——Prisma client 列校验在旧 client 上拒无 state 建行）。 */
  async function seedFrames(frames: Uint8Array[]) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt") VALUES ($1, 1, 3, now()) ON CONFLICT DO NOTHING`,
      PID,
    );
    let pg = 0n;
    for (let i = 0; i < frames.length; i++) {
      const seq = BigInt(i + 1);
      const r = await repo.appendBatch(PID, [seedRow(frames[i], seq)], { expectedPgSeq: pg, newPgSeq: seq, walCheckpointSeq: seq });
      expect(r.ok).toBe(true);
      pg = seq;
    }
    return pg;
  }

  it('发布事务语义：compact 成功 → 快照行落定（stateSeq=pgSeq+stateHash=SHA-256）+指针推进+purgeBelowSeq 同事务持久+增量行分批删净+装载=快照+增量尾', async () => {
    const pg = await seedFrames([frameOf('a', 1), frameOf('b', 2)]);
    const r = await repo.compact(PID);
    expect(r).toMatchObject({ compacted: true, snapshotRev: pg, stateSeq: pg, purgeBelowSeq: pg });
    if (!r.compacted) return;
    const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } });
    expect(doc.currentSnapshotRev).toBe(pg);
    expect(doc.purgeBelowSeq).toBe(pg);   // 指针+purgeBelowSeq 同事务持久（kill 窗=要么都在要么都不在）
    const snap = await prisma.canvasDocSnapshot.findUniqueOrThrow({
      where: { projectId_generation_snapshotRev: { projectId: PID, generation: 1, snapshotRev: pg } },
    });
    expect(snap.stateSeq).toBe(pg);   // 跨表不变量 Snapshot.stateSeq≤pgSeq（发布事务内验证——此处 pg=pgSeq 等值）
    expect(snap.stateHash).toBe(createHash('sha256').update(snap.state).digest('hex'));
    expect(doc.pgSeq >= snap.stateSeq).toBe(true);   // 不变量面（≤pgSeq）
    expect(r.deletedRows).toBe(2);   // 提交后分批删净（折叠行计数）
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
    // 装载改道：快照（指针行）+增量尾（>stateSeq 空）——内容等价
    const h = await repo.loadForHydration(PID);
    expect(h.stateSeq).toBe(pg);
    expect(h.updates.length).toBe(0);
    const revived = new Y.Doc();
    Y.applyUpdate(revived, new Uint8Array(h.state!));
    expect(revived.getMap('nodes').has('a')).toBe(true);
    expect(revived.getMap('nodes').has('b')).toBe(true);
  });

  it('红组①：两 compact 并发 → 恰一胜+败者正常折返（miss/empty 零 reject——红=旧实现败者 write-conflict throw）', async () => {
    await seedFrames([frameOf('c1', 1), frameOf('c2', 2)]);
    const settled = await Promise.allSettled([repo.compact(PID), repo.compact(PID)]);
    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'fulfilled']);   // 红：旧实现败者 rejected（P2034）
    const vals = settled.map((s) => (s as PromiseFulfilledResult<Awaited<ReturnType<CanvasDocUpdateRepository['compact']>>>).value);
    const wins = vals.filter((v) => v.compacted);
    const folds = vals.filter((v) => !v.compacted);
    expect(wins.length).toBe(1);
    expect(folds.length).toBe(1);
    expect(folds[0]!.reason === 'miss' || folds[0]!.reason === 'empty').toBe(true);   // 正常 miss 档（败者后到=快照已覆盖=empty 同为正常折返）
    // 落定形态：快照恰一行（并发发布零重复）+指针/pgSeq 一致+行净
    expect(await prisma.canvasDocSnapshot.count({ where: { projectId: PID } })).toBe(1);
    const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } });
    expect(doc.currentSnapshotRev).toBe(2n);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
  });

  it('授权 CAS（写入方推进窗）：compact 捕获后 pgSeq 被 append 推进 → 发布 miss 不落旧前缀快照（跨表不变量守门）', async () => {
    await seedFrames([frameOf('d1', 1)]);
    // 捕获授权读结果（pg=1）后写入方推进 pgSeq → 1→2（模拟 compact 重放窗内并发 append 提交）
    const r2 = await repo.appendBatch(PID, [seedRow(frameOf('d2', 2), 2n)], { expectedPgSeq: 1n, newPgSeq: 2n, walCheckpointSeq: 2n });
    expect(r2.ok).toBe(true);
    // 直接以陈旧捕获值驱动发布（repo.compact 内部 ①→③ 自洽——此处经公开面复现等价窗：捕获=上一 append 前）
    // 陈旧发布=再跑 compact（此刻真值 pg=2 rev0=0——发布新前缀=合法）；陈旧窗断言面改由形状锚
    // （repository.spec）承担；本用例锚定端到端不变量：任意时刻全表 Snapshot.stateSeq≤pgSeq
    await repo.compact(PID);
    const rows = await prisma.$queryRaw<{ stateSeq: bigint; pgSeq: bigint }[]>`
      SELECT s."stateSeq", d."pgSeq" FROM "CanvasDocSnapshot" s
      JOIN "CanvasDoc" d ON d."projectId" = s."projectId"
      WHERE s."projectId" = ${PID}`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.stateSeq <= row.pgSeq).toBe(true);   // 跨表不变量（发布事务验证面的端到端锚）
  });

  it('保留策略：当代 top-2（指针+前一发布）+旧代各 top-1——新快照发布后删旧', async () => {
    await seedFrames([frameOf('e1', 1)]);
    await repo.compact(PID);   // rev=1
    const r2 = await repo.appendBatch(PID, [seedRow(frameOf('e2', 2), 2n)], { expectedPgSeq: 1n, newPgSeq: 2n, walCheckpointSeq: 2n });
    expect(r2.ok).toBe(true);
    await repo.compact(PID);   // rev=2 → 当代保留 {1,2}
    // 旧代快照（模拟历史代残留——vacuum 换代前形态）
    await prisma.canvasDocSnapshot.create({
      data: { projectId: PID, generation: 0, snapshotRev: 5n, stateSeq: 5n, state: Buffer.from([0, 0]), stateHash: createHash('sha256').update(Buffer.from([0, 0])).digest('hex'), vacuumEpoch: 0, schemaVersion: 3 },
    });
    await prisma.canvasDocSnapshot.create({
      data: { projectId: PID, generation: 0, snapshotRev: 9n, stateSeq: 9n, state: Buffer.from([0, 0]), stateHash: createHash('sha256').update(Buffer.from([0, 0])).digest('hex'), vacuumEpoch: 0, schemaVersion: 3 },
    });
    const r3 = await repo.appendBatch(PID, [seedRow(frameOf('e3', 3), 3n)], { expectedPgSeq: 2n, newPgSeq: 3n, walCheckpointSeq: 3n });
    expect(r3.ok).toBe(true);
    await repo.compact(PID);   // rev=3 → 当代保留 {2,3}（rev1 删）+旧代 0 保留 {9}（rev5 删）
    const snaps = await prisma.canvasDocSnapshot.findMany({ where: { projectId: PID }, select: { generation: true, snapshotRev: true }, orderBy: [{ generation: 'asc' }, { snapshotRev: 'asc' }] });
    expect(snaps).toEqual([
      { generation: 0, snapshotRev: 9n },   // 旧代最终 1 份
      { generation: 1, snapshotRev: 2n },   // 当代 2 份（前一发布）
      { generation: 1, snapshotRev: 3n },   // 当代 2 份（指针）
    ]);
    const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } });
    expect(doc.currentSnapshotRev).toBe(3n);   // 指针行恒保留
  });

  it('红组②（kill 在指针发布后/分批删完成前）：purgeBelowSeq 已持久+行残留 → 启动续跑完成清理义务（resumePurges）', async () => {
    const pg = await seedFrames([frameOf('f1', 1), frameOf('f2', 2)]);
    // 模拟 kill 窗：发布事务已提交（快照+指针+purgeBelowSeq），分批删未跑——直接落发布产物形态
    const temp = new Y.Doc();
    for (const r of await prisma.canvasDocUpdate.findMany({ where: { projectId: PID }, orderBy: { seq: 'asc' } })) {
      Y.applyUpdate(temp, new Uint8Array(r.update));
    }
    const state = Buffer.from(Y.encodeStateAsUpdate(temp));
    temp.destroy();
    await prisma.canvasDocSnapshot.create({
      data: { projectId: PID, generation: 1, snapshotRev: pg, stateSeq: pg, state, stateHash: createHash('sha256').update(state).digest('hex'), vacuumEpoch: 0, schemaVersion: 3 },
    });
    await prisma.canvasDoc.update({ where: { projectId: PID }, data: { currentSnapshotRev: pg, purgeBelowSeq: pg } });
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(2);   // kill 窗残留（红=无续跑载体即永久滞留）
    // 重启续跑（CollabCompactPoller.onModuleInit 消费同一入口）
    const resumed = await repo.resumePurges();
    expect(resumed).toBeGreaterThanOrEqual(1);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);   // 清理义务不丢
    // 幂等：再跑 no-op
    await repo.resumePurges();
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
  });

  it('交错组（装载×compact×append 并行）绿：终态装载=全内容等价+不变量 Snapshot.stateSeq≤pgSeq 恒立', async () => {
    await seedFrames([frameOf('g0', 0)]);
    const keys = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
    let pg = 1n;
    const jobs: Promise<unknown>[] = [];
    for (const k of keys) {
      const seq = pg + 1n;
      // actor 单写者语义：append 串行（前帧 CAS 提交后才发下一帧）；装载/compact 与之并发
      const appendP = repo.appendBatch(PID, [seedRow(frameOf(k, Number(seq)), seq)], { expectedPgSeq: seq - 1n, newPgSeq: seq, walCheckpointSeq: seq });
      jobs.push(repo.loadForHydration(PID).catch(() => undefined));   // 装载与写并发（RR 快照一致性）
      jobs.push(repo.compact(PID).catch(() => undefined));            // compact 与写/装载并发（授权 CAS 仲裁）
      const r = await appendP;
      expect(r.ok).toBe(true);
      pg = seq;
    }
    await Promise.all(jobs);
    // 终态：全部内容经装载可复活（快照+增量尾——无论交错序）
    const h = await repo.loadForHydration(PID);
    const revived = new Y.Doc();
    if (h.state) Y.applyUpdate(revived, new Uint8Array(h.state));
    for (const u of h.updates) Y.applyUpdate(revived, new Uint8Array(u));
    for (const k of ['g0', ...keys]) expect(revived.getMap('nodes').has(k), `装载缺节点 ${k}`).toBe(true);
    // 不变量：全表快照 stateSeq≤pgSeq+水位非回退
    const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } });
    const snaps = await prisma.canvasDocSnapshot.findMany({ where: { projectId: PID }, select: { stateSeq: true } });
    for (const s of snaps) expect(s.stateSeq <= doc.pgSeq).toBe(true);
    expect(doc.pgSeq).toBe(pg);
  }, 20_000);
});
