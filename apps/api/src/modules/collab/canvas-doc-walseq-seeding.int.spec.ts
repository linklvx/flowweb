// apps/api/src/modules/collab/canvas-doc-walseq-seeding.int.spec.ts
// Y1c T11 双评审 C1（Critical——静默丢数据链）红→绿：hydration 游标改道 stateSeq 后，spool walSeq
// 计数器「段全回收+重启→自 1 重起」变致命。端到端链（评审员实测形态等价重建）：
//   era1 写帧→PG 行落定→compact 发布快照（stateSeq=N）+purge 行→confirm 全确认段 unlink（PG 落地
//   稳态）→新实例 scan()/rebuildRuntimeStateFromIndex 只从幸存段重建（零段→计数器 1n）→新会话合法帧
//   落 seq=1..N<已发布 stateSeq→appendBatch cas-miss「row.pgSeq≥newPg→ok」静默成功→readConsistent
//   尾谓词 seq>stateSeq 跳过（行在库/装载尾长 0/内容不可见）→计数器越过 stateSeq 后 compact 只重放
//   (stateSeq0,pg] 发布快照不含重置纪行→purgeBelow 永久删除。
// 根修双保险（红测钉锚）：①PG 播种 seedWalSeqFromPg=max(scan 重建值, CanvasDoc.pgSeq+1)
// （boot 面+loadDocument 缝——两缝同方法单源）；②appendBatch fail-closed tripwire（新帧
// lastWalSeq≤doc.pgSeq 且非幂等重放在档→拒收+告警——播种缺席=计数器重置即侦测）。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import * as Y from 'yjs';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y1c-walseq-seed-int';
const OWNER = 't11-c1-owner';

const frameHash = (u: Uint8Array) => createHash('sha256').update(u).digest();

function docWithNode(key: string, n: number): Uint8Array {
  const d = new Y.Doc();
  d.getMap('nodes').set(key, new Y.Map([['x', n]]));
  return Y.encodeStateAsUpdate(d);
}

maybe('C1（T11 双评审 Critical）：walSeq 计数器 PG 恒真播种+appendBatch fail-closed tripwire（真 PG+真 spool 端到端）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as any);
  let dir = '';
  let cleanupDir: () => Promise<void> = () => Promise.resolve();

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    const made = await makeSpoolDir('y1c-c1-walseq-');
    dir = made.dir;
    cleanupDir = made.cleanup;
  });
  beforeEach(async () => {
    await ensureLeaseFixture(prisma, repo);
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await rm(dir, { recursive: true, force: true });   // spool 目录随用例重置（未 confirm 残段跨用例污染计数器面——append/scan 按需自建目录）
  });
  afterAll(async () => {
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await cleanupDir();
    await prisma.$disconnect();
  });

  /** 新 spool 实例（同目录=重启形态）。 */
  const newSpool = () => {
    const s = new CollabSpoolService(dir);
    s.setOwner(OWNER);
    s.setWalHistory('t11-c1-history');
    return s;
  };

  /** era1 稳态布景：3 帧→PG 行（CAS 推 pgSeq=3）→compact 发布快照 stateSeq=3+purge 行→confirm
   *  全确认段 unlink（段全回收=链第一环：PG 落地稳态下 WAL 无幸存段）。 */
  async function seedEra1(): Promise<Uint8Array[]> {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt") VALUES ($1, 1, 3, now()) ON CONFLICT DO NOTHING`,
      PID,
    );
    const s1 = newSpool();
    const payloads = [docWithNode('a', 1), docWithNode('b', 2), docWithNode('c', 3)];
    const appended = await s1.appendBatch(PID, payloads);
    expect(appended.map((f) => f.walSeq)).toEqual([1n, 2n, 3n]);
    for (const f of appended) s1.noteApplied(PID, f.walSeq);   // actor 序：append→apply→noteApplied→PG flush→confirm
    let pg = 0n;
    for (let i = 0; i < appended.length; i++) {
      const r = await repo.appendBatch(PID, [CanvasDocUpdateRepository.singleFrameRow({
        generation: 1, walSeq: appended[i].walSeq, frameHash: frameHash(payloads[i]), update: payloads[i],
      })], { expectedPgSeq: pg, newPgSeq: appended[i].walSeq, walCheckpointSeq: appended[i].walSeq });
      expect(r.ok).toBe(true);
      pg = appended[i].walSeq;
    }
    const c = await repo.compact(PID);
    expect(c.compacted).toBe(true);   // 快照发布：stateSeq=3+增量行 purge（重置纪 INSERT 无 PK 冲突的前提）
    await s1.confirm(PID, appended.map((f) => f.frameId));
    expect(s1.hasFrames(PID), '段全回收（PG 落地稳态——链第一环）').toBe(false);
    return payloads;
  };

  it('链根因钉锚：段全回收+重启→scan 仅从幸存段重建→计数器 1n（scan 面无 PG 真值——播种义务在 PG 侧）', async () => {
    await seedEra1();
    const s2 = newSpool();
    await s2.scan();
    expect(s2.peekNextWalSeq(PID), '零幸存段=scan 重建值 1n（C1 根因——修复不改 scan 面，改播种面）').toBe(1n);
  });

  it('C1① PG 播种：scan+seedWalSeqFromPg(pgSeq)→下一帧 walSeq=pgSeq+1（非 1）→PG 行落定+装载尾可见（内容不丢）', async () => {
    const era1 = await seedEra1();
    const s2 = newSpool();
    await s2.scan();
    const wm = await repo.readWatermark(PID);
    expect(wm!.pgSeq).toBe(3n);
    s2.seedWalSeqFromPg(PID, wm!.pgSeq);   // 播种面（gateway boot 面/loadDocument 缝同方法单源）
    expect(s2.peekNextWalSeq(PID), '播种后=pgSeq+1 非 1').toBe(4n);
    const frame4 = docWithNode('d', 4);
    const appended = await s2.appendBatch(PID, [frame4]);
    expect(appended[0].walSeq).toBe(4n);
    const w = s2.watermark(PID);
    const r = await repo.appendBatch(PID, [CanvasDocUpdateRepository.singleFrameRow({
      generation: 1, walSeq: appended[0].walSeq, frameHash: frameHash(frame4), update: frame4,
    })], { expectedPgSeq: w?.pgSeq ?? 0n, newPgSeq: 4n, walCheckpointSeq: 4n });
    expect(r.ok).toBe(true);
    const h = await repo.loadForHydration(PID);
    expect(h.stateSeq).toBe(3n);
    expect(h.updates.length, 'seq=4>stateSeq=3 → 装载尾含帧（红=重置纪 seq=1..3 帧尾长 0 不可见）').toBe(1);
    const revived = new Y.Doc();
    if (h.state) Y.applyUpdate(revived, new Uint8Array(h.state));
    for (const u of h.updates) Y.applyUpdate(revived, new Uint8Array(u));
    for (const key of ['a', 'b', 'c', 'd']) expect(revived.getMap('nodes').has(key), `内容可见：${key}`).toBe(true);
    void era1;
  });

  it('C1② tripwire：播种缺席（计数器重置=1）→appendBatch 新帧（lastWalSeq≤doc.pgSeq 且非幂等在档）fail-closed 拒收——静默 ok 红链断点', async () => {
    await seedEra1();
    const s2 = newSpool();
    await s2.scan();
    expect(s2.peekNextWalSeq(PID), '播种缺席=计数器自 1 重起').toBe(1n);
    const resetFrame = docWithNode('reset', 9);
    const appended = await s2.appendBatch(PID, [resetFrame]);
    expect(appended[0].walSeq).toBe(1n);   // ≤doc.pgSeq=3（行已被 compact purge——槽位空）
    const w = s2.watermark(PID);
    const r = await repo.appendBatch(PID, [CanvasDocUpdateRepository.singleFrameRow({
      generation: 1, walSeq: appended[0].walSeq, frameHash: frameHash(resetFrame), update: resetFrame,
    })], { expectedPgSeq: w?.pgSeq ?? 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
    expect(r, '红=旧实现 cas-miss row.pgSeq≥newPg→ok 静默成功（行在库/尾长 0/内容不可见）').toEqual({ ok: false, reason: 'wal-seq-reset' });
    // 拒收后 PG 零污染：无新行+水位不动+装载尾仍空（静默丢数据链在 PG 腿被断绝）
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
    expect((await repo.readWatermark(PID))!.pgSeq).toBe(3n);
    expect((await repo.loadForHydration(PID)).updates.length).toBe(0);
  });

  it('C1② 豁免面：幂等重放在档（committed-未-confirm 重试形态）不触发 tripwire——同 seq 同 updateHash 行在=合法重发', async () => {
    await seedEra1();
    // 布景：era1 帧 2 已提交 PG（行在——confirm 丢失前 crash 窗：doc.pgSeq 已被该批推到 3）+段幸存；
    // 重发同帧（actor committed-未-confirm 重试形态：expected=actor 内存水位〔批前值〕，doc 已超前）
    const frame2 = docWithNode('b', 2);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDocUpdate" ("projectId", generation, seq, "firstWalSeq", "frameCount", "updateHash", update, "createdAt")
       VALUES ($1, 1, 2, 2, 1, $2, $3, now()) ON CONFLICT DO NOTHING`,
      PID, CanvasDocUpdateRepository.batchUpdateHash([frameHash(frame2)]), Buffer.from(frame2),
    );
    const r = await repo.appendBatch(PID, [CanvasDocUpdateRepository.singleFrameRow({
      generation: 1, walSeq: 2n, frameHash: frameHash(frame2), update: frame2,
    })], { expectedPgSeq: 2n, newPgSeq: 2n, walCheckpointSeq: 2n });
    expect(r, '幂等重发（行在+同 hash）不拒——ordered-commit 纪律下 walSeq≤pgSeq 且在档=重放').toEqual({ ok: true, rows: 0 });
  });

  it('C1① max 语义：幸存段承载未落 PG 帧时 scan 重建值更高——播种不回拨（seed=max(scan,pgSeq+1)）', async () => {
    await seedEra1();
    const s1 = newSpool();
    await s1.scan();   // 段已全回收——计数器自 1（await=禁与后续 seed/append 竞争——scan 异步体重建计数器会覆盖并发 seed）
    s1.seedWalSeqFromPg(PID, 3n);
    const later = await s1.appendBatch(PID, [docWithNode('e', 5), docWithNode('f', 6)]);   // seq 4,5 未落 PG 未 confirm
    expect(later.map((f) => f.walSeq)).toEqual([4n, 5n]);
    const s2 = newSpool();
    await s2.scan();   // 幸存段重建=6
    expect(s2.peekNextWalSeq(PID)).toBe(6n);
    s2.seedWalSeqFromPg(PID, 3n);   // pgSeq=3（后两帧未落 PG）——播种不得回拨
    expect(s2.peekNextWalSeq(PID), 'max 语义：scan 值（6）> pgSeq+1（4）——幸存段承载未落 PG 帧时更高').toBe(6n);
  });

  // ══ C1'（复核 round-2 Critical——88ef123b 引入）：boot replayAll generation 缺省 1 × compact ②
  //  代辖重放 = 真空纪 doc 同型静默丢数据链 ══
  // 链（评审员真 PG 复现）：gen-2 doc（vacuum 后形态 snapshot(g2,rev0)）+崩溃幸存 g2 段帧→boot 新实例
  // scan 不播种 projectGeneration→replayAll 以 genOf=??1 插行+catch-up 照推 pgSeq→装载尾（无代滤）暂
  // 可见→compact ② 重放页 generation=g 滤掉 gen-1 行→发布快照不含其内容→purgeBelow(g2) 不删 gen-1
  // 行→尾谓词 seq≤新快照基线跳过——终态=帧不可见+僵尸行永留。修复=boot 三元组播种（generation+
  // walSeq floor）前移至 replayAll 之前（gateway 接线单测另钉）。
  /** gen-2 真空纪布景：CanvasDoc(g=2,pgSeq=3)+snapshot(g2,rev0,基线=3)+幸存 g2 段帧（walSeq=4 未落 PG
   *  未 confirm——运行中实例计数器自 pgSeq 连续〔seed 后 append〕，崩溃后段幸存、进程内状态蒸发）。 */
  async function seedEraVacuumed(): Promise<Uint8Array> {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "pgSeq", "walCheckpointSeq", "currentSnapshotRev", "updatedAt")
       VALUES ($1, 2, 3, 3, 3, 0, now()) ON CONFLICT DO NOTHING`,
      PID,
    );
    const base = docWithNode('v2base', 0);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanvasDocSnapshot" ("projectId", generation, "snapshotRev", "stateSeq", state, "stateHash", "vacuumEpoch", "schemaVersion", "createdAt")
       VALUES ($1, 2, 0, 3, $2, $3, 0, 3, now()) ON CONFLICT DO NOTHING`,
      PID, Buffer.from(base), createHash('sha256').update(base).digest('hex'),
    );
    const running = newSpool();
    running.setProjectGeneration(PID, 2);
    running.seedWalSeqFromPg(PID, 3n);   // 运行中形态：计数器=pgSeq+1=4（与 PG 连续）
    const frame = docWithNode('g2frame', 7);
    const appended = await running.appendBatch(PID, [frame]);
    expect(appended[0].walSeq).toBe(4n);   // 幸存段帧 walSeq=4>基线 3（在已发布基线之上——非 C1① 面）
    return frame;
  }

  it("C1' 根因钉锚：boot 不播种 generation→replayAll 行落 g1（genOf=??1）→compact ② 代辖滤除=帧不可见+僵尸行永留（修复=boot 播种先于 replayAll——本用例锁 spool 层契约，gateway 接线单测另钉）", async () => {
    await seedEraVacuumed();
    const s2 = newSpool();
    await s2.scan();   // 段幸存重建 walSeq 面；projectGeneration 面 scan 不重建（进程内状态蒸发）
    expect(s2.currentGeneration(PID), 'scan 面零 generation——播种义务在 PG 侧（同 C1① 根因形态）').toBe(1);
    const replay = await s2.replayAll(repo);
    expect(replay.failed).toBe(0);
    const rows = await prisma.$queryRaw<{ generation: number }[]>`SELECT generation FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text`;
    expect(rows.map((r) => r.generation), '根因：不播种即错——行落 g1（当代=g2）').toEqual([1]);   // 钉「不播种=错位」契约（gateway 修复后本用例仍绿=锁行为面）
    expect((await repo.readWatermark(PID))!.pgSeq, 'catch-up 无代滤照推水位').toBe(4n);
    const c = await repo.compact(PID);
    expect(c.compacted).toBe(true);   // ② 重放页 generation=2 滤掉 g1 行——发布快照基线推进到 4 但不含 g2frame
    const h = await repo.loadForHydration(PID);
    const revived = new Y.Doc();
    if (h.state) Y.applyUpdate(revived, new Uint8Array(h.state));
    for (const u of h.updates) Y.applyUpdate(revived, new Uint8Array(u));
    expect(revived.getMap('nodes').has('g2frame'), '终态：行在库（g1）+尾谓词 seq≤4 跳过=内容不可见').toBe(false);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID, generation: 1 } }), 'purgeBelow(g2) 不删 g1 行=僵尸行永留').toBe(1);
  });

  it("C1' 修复形态：boot 三元组播种（pgSeqFloors 扩 generation+先 setProjectGeneration/seedWalSeqFromPg 后 replayAll）→行落 g2+compact 后内容可见+行清理", async () => {
    await seedEraVacuumed();
    const s2 = newSpool();
    await s2.scan();
    // gateway boot 修复形态：pgSeqFloors（含 generation）先于 replayAll 播种（红=pgSeqFloors 无 generation 列）
    const floors = await repo.pgSeqFloors();
    const mine = floors.find((x) => x.projectId === PID)!;
    expect(mine.generation, 'pgSeqFloors 扩 generation（红=undefined——boot 播种三元组缺一不可）').toBe(2);
    s2.setProjectGeneration(PID, mine.generation);
    s2.seedWalSeqFromPg(PID, mine.pgSeq);
    const replay = await s2.replayAll(repo);
    expect(replay.failed).toBe(0);
    const rows = await prisma.$queryRaw<{ generation: number }[]>`SELECT generation FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text`;
    expect(rows.map((r) => r.generation), '播种后回灌行落当代 g2').toEqual([2]);
    const c = await repo.compact(PID);
    expect(c.compacted).toBe(true);   // ② 重放页含 g2 行——发布快照含 g2frame 内容
    const h = await repo.loadForHydration(PID);
    const revived = new Y.Doc();
    if (h.state) Y.applyUpdate(revived, new Uint8Array(h.state));
    for (const u of h.updates) Y.applyUpdate(revived, new Uint8Array(u));
    expect(revived.getMap('nodes').has('g2frame'), '修复终态：内容可见').toBe(true);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } }), '当代行被 purgeBelow 清理（无僵尸行）').toBe(0);
  });
});
