// apps/api/src/modules/collab/canvas-doc-append-gap.c30.int.spec.ts
// C3 卡（doc-append-gap-alert）Task C3-0 红先行 int 池（真 PG 5432——vitest.int.config 串行）：
//  ★红⓪-a 诊断夹具（先于一切——预期绿）：真实 actor（真 spool WAL/真 lease/真 drain/真 PG flush 全链，
//    非 mock——T21 withFrozenPrefix 冻结临界区所在实体直驱）驱动两形态：
//    ① maintenance 帧：mkAppliedEntry 落 PG 批（applied 队列→flushPrefixToPg→appendBatch——行+水位同事务）；
//    ② dedup 命中：submit 层 dedupMap（applied 态）同字节重发=noop 确认原 walSeq——**不烧 seq**。
//    结论钉死（plan v3.1 A①）：两形态均不产生 CanvasDocUpdate seq 洞——行落库/pgSeq 推进与审计三断言
//    （行内密度/行间衔接∨侧表覆盖/边界）一致，侧表零行。若红=实现层形态与本结论不符（BLOCKED 修实现）。
//  ★红⓪-b T30b 吞行侧表（先红后绿）：同内容帧新 seq 重发→@@updateHash 唯一吞行→同事务 INSERT
//    CanvasDocCoalesced（sourceSeq=在档同 hash 行 seq——「重定基」目标行）+批 ok（rows==0 幂等现契约
//    不破）+adopt 重定基——断点夹后续新帧后审计三断言一致绿（侧表覆盖实弹面）。
//  侧表兼容核验：装载重放面不受影响（重放只读 CanvasDocUpdate/CanvasDocSnapshot——侧表不进重放面）；
//  compact purgeBelow 顺带删侧表行（同 seq<=purgeBelowSeq 域）。擦除接线归 C4-3（介质 registry 登记）。
// 审计 SQL 本体（worker 消费）归 C3-1；本文件断言面=侧表行落库+批语义+重放面+删面。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import type { Logger } from '@nestjs/common';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createCanvasDoc } from './canvas-doc.factory';
import { canvasDocName } from './doc-name.util';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { makeSpoolDir } from '../../test-utils/spool-dir';
// C3-1（M-2 单源对齐）：审计三断言 JS 夹面自本文件内联形态迁 test-utils/append-audit（c31 SQL 版对拍
// 双消费面共享单源；C3-0 评审 M-1/m-3 两端侧表豁免随迁落位——本文件夹具全为严格边界形态，豁免面
// 加宽不影响绿）。
import { assertAppendAuditThree } from '../../test-utils/append-audit';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const noopLogger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, fatal: () => {} } as unknown as Logger;

// ★红④（maintenance/dedup 夹具 CI 常驻）：assertAppendAuditThree JS 夹面（C3-1 起迁 test-utils/append-audit
// 单源——本 spec 红⓪-a 诊断形态随每轮 int:CI 对拍三断言一致；形态漂移即红）。
/** gen1 头+rev0 快照（stateSeq 0）+pgSeq 0 布景——boot 播种形态（spool 三元 seedWalSeqFromPg(0)）。 */
async function seedDocRow(prisma: PrismaClient, pid: string): Promise<void> {
  const state0 = Buffer.from(Y.encodeStateAsUpdate(createCanvasDoc()));
  await prisma.$executeRaw`INSERT INTO "CanvasDocSnapshot" ("projectId", generation, "snapshotRev", "stateSeq", state, "stateHash", "vacuumEpoch", "schemaVersion")
    VALUES (${pid}::text, 1::int, 0::bigint, 0::bigint, ${state0}, ${createHash('sha256').update(state0).digest('hex')}::char(64), 0::int, 3::int) ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "CanvasDoc" ("projectId", generation, "schemaVersion", "updatedAt", "pgSeq", "walCheckpointSeq")
    VALUES (${pid}::text, 1::int, 3::int, now(), 0::bigint, 0::bigint) ON CONFLICT DO NOTHING`;
}

// ═══════════════ 红⓪-a：诊断夹具（预期绿——两形态零洞结论钉死）═══════════════
maybe('C3-0 红⓪-a 诊断夹具（真 actor：maintenance 帧落 PG 批+dedup 命中不烧 seq——零洞+三断言一致）', () => {
  const PID = 'c3-0-diag-int';
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  let spool: CollabSpoolService;
  let spoolCleanup: () => Promise<void> = async () => {};
  const documents = new Map<string, Y.Doc>();
  let actor: CollabProjectActorService;

  /** 逐用例全新装置（spool 内存水位/actor appliedSeq 跨用例互染——T26 int 卫生先例）：
   *  独立 spool 目录+boot 三元播种（setProjectGeneration+seedWalSeqFromPg）+租约 fixture（owner 与
   *  repo 对齐——PG 腿放行）。 */
  async function buildKit(): Promise<void> {
    await spoolCleanup();
    const dir = await makeSpoolDir('c3-0-spool-');
    spoolCleanup = dir.cleanup;
    spool = new CollabSpoolService(dir.dir);
    spool.setOwner('c3-0-owner');
    await ensureLeaseFixture(prisma, repo, 'c3-0-owner');
    spool.setProjectGeneration(PID, 1);
    spool.seedWalSeqFromPg(PID, 0n);
    documents.clear();
    documents.set(canvasDocName(PID, 1), new Y.Doc());
    actor = new CollabProjectActorService(spool, repo);
    actor.bindHost({
      logger: noopLogger,
      documents: () => documents,
      hardClose: () => {},
      isQuotaFrozen: () => false,
      generationOf: () => 1,
      noteReadOnlyDrop: () => false,
      onFencedByWrite: async () => {},
      maintenanceFreezeOf: () => undefined,
    });
  }

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  beforeEach(async () => {
    await cleanupProjectFixture(prisma, PID);
    await ensureProjectFixture(prisma, PID);
    await seedDocRow(prisma, PID);
    await buildKit();
  });
  afterAll(async () => {
    await cleanupProjectFixture(prisma, PID);
    await restoreLeaseRow(prisma);
    await spoolCleanup();
    await prisma.$disconnect();
  });

  it('双形态零洞：maintenance 帧行落库+pgSeq 推进；dedup 命中返回原 walSeq noop 不烧 seq——行集与审计三断言一致+侧表零行（预期绿）', async () => {
    // 帧工厂：逐帧独立源 doc（各自 client clock 0 起——自含全量态：真 actor 准入链
    // DENY/L1/pending-interval（无缺前驱）/clientID 绑定全过；maintenance 帧 payload=
    // 已生效字节形态（真 Y update——PG 行同为装载重放面）。
    const mk = (id: string): Uint8Array => {
      const d = new Y.Doc();
      d.getMap('nodes').set(id, new Y.Map([['type', 'textInput']]));
      return Y.encodeStateAsUpdate(d);
    };
    const conn = { socketId: 'c3-0-sock-1', readOnly: false, sendStateless: () => {} } as never;

    // ── 形态① maintenance 帧：payload=已生效字节形态（真 Y update）；resolve 延后至 PG 批落定 ──
    const maintPayload = mk('maint-node');
    const m1 = await actor.submitMaintenance(PID, maintPayload);
    expect(m1.walSeq).toBe(1n);                                        // 首帧 walSeq=seed(0)+1
    expect((await repo.readWatermark(PID))?.pgSeq).toBe(1n);           // 维护帧行+水位同事务落定
    const maintRow = await prisma.canvasDocUpdate.findUnique({ where: { projectId_generation_seq: { projectId: PID, generation: 1, seq: 1n } } });
    expect(maintRow, 'maintenance 帧 mkAppliedEntry 落 PG 批（行在档）').toBeTruthy();
    expect(maintRow?.frameCount).toBe(1);
    expect(maintRow?.firstWalSeq).toBe(1n);

    // ── 形态② connection 帧：apply+WAL+PG 全链 ──
    const f1 = mk('n1');
    const r1 = await actor.submit(PID, f1, conn, 'update');
    expect(r1.walSeq).toBe(2n);
    expect((await actor.flushThrough(PID, r1.walSeq, { maxWaitMs: 5_000 })).targetReached).toBe(true);

    // ── 形态③ dedup 命中：同字节重发=submit 层 dedupMap（applied 态）noop 确认原 walSeq——不烧 seq ──
    const r1d = await actor.submit(PID, f1, conn, 'update');
    expect(r1d).toMatchObject({ walSeq: 2n, noop: true });
    expect((await repo.readWatermark(PID))?.pgSeq).toBe(2n);            // dedup 命中零 WAL/零 PG 触碰

    // dedup 不烧 seq 佐证：下一新帧 walSeq 恰=3（重发未占用号段）
    const r2 = await actor.submit(PID, mk('n2'), conn, 'update');
    expect(r2.walSeq).toBe(3n);
    expect((await actor.flushThrough(PID, 3n, { maxWaitMs: 5_000 })).targetReached).toBe(true);

    // 尾批双帧（可能合批一行 frameCount=2——断言形态泛化不依赖合批时序）
    const [r3, r4] = await Promise.all([
      actor.submit(PID, mk('n3'), conn, 'update'),
      actor.submit(PID, mk('n4'), conn, 'update'),
    ]);
    const maxSeq = r3.walSeq > r4.walSeq ? r3.walSeq : r4.walSeq;
    expect(maxSeq).toBe(5n);
    expect((await actor.flushThrough(PID, 5n, { maxWaitMs: 5_000 })).targetReached).toBe(true);

    // ── 断言面：行落库（确定性帧 seq 1/2/3 在档）+pgSeq 推进+侧表零行+三断言一致 ──
    const seqs = (await prisma.$queryRaw<{ seq: bigint }[]>`
      SELECT seq FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text AND generation = 1::int ORDER BY seq ASC`).map((r) => r.seq);
    // 行键集（=批 lastWalSeq）：确定性前三维 1/2/3 在档+尾=5（尾批双帧可能合批一行 frameCount=2——
    // 行键跳 4 非洞〔行区间 4..5 连续〕；零洞判据归审计三断言 a/b/c 密度+衔接）。
    expect(seqs.slice(0, 3), '确定性帧行在档（maintenance seq1+connection seq2/3）').toEqual([1n, 2n, 3n]);
    expect(seqs[seqs.length - 1]).toBe(5n);
    expect((await repo.readWatermark(PID))?.pgSeq).toBe(5n);            // pgSeq 推进至批 lastWalSeq
    expect(await prisma.canvasDocCoalesced.count({ where: { projectId: PID } }), '侧表零行（maintenance/dedup 两形态均不产生洞）').toBe(0);
    await assertAppendAuditThree(prisma, PID);                        // a/b/c 三断言一致（零洞形态）

    // 装载重放面：快照+增量尾逐行重放=全部内容在场（maintenance 帧行同为重放面——payload 即 update 字节）
    const h = await repo.loadForHydration(PID);
    expect(h.stateSeq).toBe(0n);
    expect(h.updates.length).toBe(seqs.length);
    const reloaded = createCanvasDoc();
    if (h.state) Y.applyUpdate(reloaded, new Uint8Array(h.state));
    for (const u of h.updates) Y.applyUpdate(reloaded, new Uint8Array(u));
    const nodes = reloaded.getMap('nodes');
    for (const id of ['maint-node', 'n1', 'n2', 'n3', 'n4']) {
      expect(nodes.get(id), `重放后节点 ${id} 在场`).toBeTruthy();
    }
  });
});

// ═══════════════ 红⓪-b：T30b 吞行侧表（先红后绿）+ 侧表兼容核验 ═══════════════
maybe('C3-0 红⓪-b T30b 吞行侧表+兼容核验（真 PG——侧表行落库/批语义/purge 删面/重放面）', () => {
  const PID = 'c3-0-t30b-int';
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);

  /** T30b 形态帧族：uA=同字节重发对（重定基目标），各帧独立源 doc（行 updateHash=批内帧哈希列表 SHA-256）。 */
  function mkFrames() {
    const mk = (id: string): Uint8Array => {
      const d = new Y.Doc();
      d.getMap('nodes').set(id, new Y.Map([['type', 'textInput']]));
      return Y.encodeStateAsUpdate(d);
    };
    const uA = mk('t30b-a');
    return { uA, uB: mk('t30b-b'), uC: mk('t30b-c'), hashA: CanvasDocUpdateRepository.batchUpdateHash([createHash('sha256').update(uA).digest()]) };
  }

  /** T30b 生产链复刻布景：前任进程正常 CAS 批落定 seq 1..2（pgSeq=2）→ 重启窗首刷（spool 水位三元未
   *  重建 ⇒ expected=0 恒 cas-miss）同字节重发新 seq 3 被 @@updateHash 唯一吞行 → adopt 重定基
   *  （pgSeq=3）→ 断点夹后续新内容帧 seq 4 正常批（pgSeq=4）。返回帧族（重发对字节由调用方复用）。 */
  async function seedT30bState(): Promise<{ uA: Uint8Array; uB: Uint8Array; uC: Uint8Array; hashA: string }> {
    const f = mkFrames();
    await prisma.canvasDoc.create({ data: { projectId: PID, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n } });
    const r1 = await repo.appendBatch(PID, [seedRow(f.uA, 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
    expect(r1).toEqual({ ok: true, rows: 1 });
    const r2 = await repo.appendBatch(PID, [seedRow(f.uB, 2n)], { expectedPgSeq: 1n, newPgSeq: 2n, walCheckpointSeq: 2n });
    expect(r2).toEqual({ ok: true, rows: 1 });
    // 重启窗首刷吞行（rows==0 幂等视为已提交——现契约不破；侧表接线归本卡）
    const r3 = await repo.appendBatch(PID, [seedRow(f.uA, 3n)], { expectedPgSeq: 0n, newPgSeq: 3n, walCheckpointSeq: 3n });
    expect(r3).toEqual({ ok: true, rows: 0 });
    expect((await repo.readWatermark(PID))?.pgSeq).toBe(3n);            // adopt 重定基（T30b-B 现契约承继）
    // 断点夹后续新内容帧（三断言 b 侧表覆盖实弹面）
    const r4 = await repo.appendBatch(PID, [seedRow(f.uC, 4n)], { expectedPgSeq: 3n, newPgSeq: 4n, walCheckpointSeq: 4n });
    expect(r4).toEqual({ ok: true, rows: 1 });
    return f;
  }

  beforeAll(async () => { await ensureProjectFixture(prisma, PID); });
  beforeEach(async () => {
    await prisma.canvasDocCoalesced.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDocUpdate.deleteMany({ where: { projectId: PID } });
    await prisma.canvasDoc.deleteMany({ where: { projectId: PID } });
    await ensureLeaseFixture(prisma, repo);
  });
  afterAll(async () => {
    await cleanupProjectFixture(prisma, PID);
    await restoreLeaseRow(prisma);
    await prisma.$disconnect();
  });

  it('红⓪-b：同内容帧新 seq 重发→吞行→侧表行落库（seq=被吞帧行/sourceSeq=在档同 hash 行 seq）+批 ok+adopt 重定基+审计三断言一致+重放面不破', async () => {
    const f = await seedT30bState();

    // 行集：seq 1/2/4 在档（seq 3 被吞——主表零行）
    const seqs = (await prisma.$queryRaw<{ seq: bigint }[]>`
      SELECT seq FROM "CanvasDocUpdate" WHERE "projectId" = ${PID}::text AND generation = 1::int ORDER BY seq ASC`).map((r) => r.seq);
    expect(seqs).toEqual([1n, 2n, 4n]);
    expect((await repo.readWatermark(PID))?.pgSeq).toBe(4n);

    // ★红（侧表未接线）：被吞 seq 3 → CanvasDocCoalesced（sourceSeq=1=在档同 hash 行 seq——重定基目标行）
    const side = await prisma.canvasDocCoalesced.findMany({ where: { projectId: PID }, orderBy: { seq: 'asc' } });
    expect(side.length, '吞行侧表行落库').toBe(1);
    expect(side[0]).toMatchObject({
      generation: 1,
      seq: 3n,                      // 被吞帧行（r.lastWalSeq）
      sourceSeq: 1n,                // 在档同 updateHash 行 seq（@@unique 域内单行——重定基目标）
      reason: 't30b-coalesced',
    });
    expect(side[0]?.updateHash).toBe(f.hashA);

    // 侧表幂等（ON CONFLICT DO NOTHING）：同吞行批以回灌 catch-up 形态（expectedPgSeq=null——
    // replayAll 回灌口径；T30b 事后重发走本形态，actor CAS 形态被 C1② tripwire 拒）重发→侧表不双计
    const r3b = await repo.appendBatch(PID, [seedRow(f.uA, 3n)], { expectedPgSeq: null, newPgSeq: 3n, walCheckpointSeq: 3n });
    expect(r3b).toEqual({ ok: true, rows: 0 });
    expect(await prisma.canvasDocCoalesced.count({ where: { projectId: PID } })).toBe(1);

    // 审计三断言一致绿（b：行 2→4 断点 [3,3] 全在侧表；a：行内密度；c：边界 min=stateSeq+1 ∧ max=pgSeq）
    await assertAppendAuditThree(prisma, PID);

    // 重放面不破：装载重放只读 CanvasDocUpdate/CanvasDocSnapshot 既有面（侧表不进重放面）
    const h = await repo.loadForHydration(PID);
    expect(h.stateSeq).toBe(0n);                                        // 无快照行折空（布景不建快照）
    expect(h.updates.length, '重放面=主表行集（侧表行不混入）').toBe(3);
    const reloaded = createCanvasDoc();
    if (h.state) Y.applyUpdate(reloaded, new Uint8Array(h.state));
    for (const u of h.updates) Y.applyUpdate(reloaded, new Uint8Array(u));
    for (const id of ['t30b-a', 't30b-b', 't30b-c']) {
      expect(reloaded.getMap('nodes').get(id), `重放后节点 ${id} 在场`).toBeTruthy();
    }
  });

  it('兼容核验：compact purgeBelow 顺带删侧表行（同 seq<=purgeBelowSeq 域）——区间上界下幸存、界内同删', async () => {
    await seedT30bState();
    expect(await prisma.canvasDocCoalesced.count({ where: { projectId: PID } })).toBe(1);   // 布景：侧表 seq 3

    // 区间上界下：purgeBelow(2) 删行 1/2——侧表 seq 3 > 2 幸存（同 seq 区间谓词）
    const n1 = await repo.purgeBelow(PID, 1, 2n);
    expect(n1).toBe(2);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(1);      // 行 4
    expect(await prisma.canvasDocCoalesced.count({ where: { projectId: PID } })).toBe(1);   // 侧表 3 幸存

    // 界内：purgeBelow(4) 删行 4+侧表 3 同域删（被吞行随其 seq 区间清理——审计断点面随之退役）
    const n2 = await repo.purgeBelow(PID, 1, 4n);
    expect(n2).toBe(1);
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
    // ★红（purgeBelow 未接线侧表删）：侧表行残留
    expect(await prisma.canvasDocCoalesced.count({ where: { projectId: PID } }), 'purgeBelow 同 seq 区间顺带删侧表行').toBe(0);
  });

  // ── C3-0 评审 I-2：PK 冲突幂等重放落自指侧表行（恢复链 kill 窗）──
  // 恢复链形态：appendBatch 提交后、spool.confirm 前崩溃 → replayAll 重放已落定帧（同 seq 同 hash）→
  // INSERT 被 **PK** 冲突吞（非 hash 吞）→ sourceSeq SELECT 按 hash 查到**行自身**（src[0].seq==lastWalSeq）
  // → 旧实现落 (seq=X, sourceSeq=X) 自指行——记录的不是真衔接断点（审计断点区间 [2,..] 假覆盖污染）。
  // 判别式：sourceSeq==lastWalSeq 恰为 PK 幂等重放（真吞行必异 seq）。
  it('评审 I-2 红：PK 幂等重放（同 seq 同 hash 已落定帧重发）不落侧表自指行——恢复链 replayAll 口径零侧表行', async () => {
    const f = mkFrames();
    await prisma.canvasDoc.create({ data: { projectId: PID, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n } });
    const r1 = await repo.appendBatch(PID, [seedRow(f.uA, 1n)], { expectedPgSeq: 0n, newPgSeq: 1n, walCheckpointSeq: 1n });
    expect(r1).toEqual({ ok: true, rows: 1 });
    expect(await prisma.canvasDocCoalesced.count({ where: { projectId: PID } })).toBe(0);   // 正常批零侧表

    // kill 窗重放：同帧（同 seq 1 同 hash）回灌 catch-up 形态重发 → PK 冲突吞行（RETURNING 空）
    const r2 = await repo.appendBatch(PID, [seedRow(f.uA, 1n)], { expectedPgSeq: null, newPgSeq: 1n, walCheckpointSeq: 1n });
    expect(r2).toEqual({ ok: true, rows: 0 });   // 幂等重放 ok（0-行桶契约）
    // ★红（无 PK 重放判别式）：sourceSeq SELECT 按 hash 查到行自身 → 侧表落 (seq=1, sourceSeq=1) 自指行
    expect(await prisma.canvasDocCoalesced.count({ where: { projectId: PID } }), 'PK 幂等重放不落侧表自指行（sourceSeq==lastWalSeq 判别）').toBe(0);

    // 真 T30b 吞行（异 seq 同 hash）仍落侧表（I-2 守卫不误伤——红⓪-b 同判据回归面）
    const r3 = await repo.appendBatch(PID, [seedRow(f.uA, 2n)], { expectedPgSeq: null, newPgSeq: 2n, walCheckpointSeq: 2n });
    expect(r3).toEqual({ ok: true, rows: 0 });
    const side = await prisma.canvasDocCoalesced.findMany({ where: { projectId: PID } });
    expect(side.length, '真吞行（异 seq）侧表照落').toBe(1);
    expect(side[0]).toMatchObject({ seq: 2n, sourceSeq: 1n, reason: 't30b-coalesced' });
  });

  // ── C3-0 评审 I-1：vacuumReplace 换代不删旧代侧表行（生命周期契约缺口）──
  // 主表按 projectId 整删**全部代**行（行集=被删集等价——换代语义），侧表生命周期须同域随删：
  // 否则旧代侧表行无清理路径（purgeBelow 是 generation 域、C4-3 是 scope 域——换代两域均不覆盖）。
  it('评审 I-1 红：vacuumReplace 换代整删主表全部代行——侧表同域随删（含他代 generation 行）零残留', async () => {
    await seedT30bState();   // 布景：gen1 行 seq 1/2/4 + 侧表 (3→source1)
    expect(await prisma.canvasDocCoalesced.count({ where: { projectId: PID } })).toBe(1);
    // 他代残留形态（「旧代幸存」布景——vacuum 前代侧表行）
    await prisma.canvasDocCoalesced.create({
      data: { projectId: PID, generation: 0, seq: 99n, updateHash: 'g0' + '0'.repeat(61), sourceSeq: 98n, reason: 't30b-coalesced' },
    });
    expect(await prisma.canvasDocCoalesced.count({ where: { projectId: PID } })).toBe(2);

    // ⑥ vacuumReplace（t12-vacuum int ① 直调惯例：expectedRowCount=锁内实读行数 3、expectedGeneration=头行 1）
    const replaced = await repo.vacuumReplace(PID, Buffer.from([0x1]), 3, 1);
    expect('aborted' in replaced).toBe(false);
    expect(!('aborted' in replaced) && replaced.generation).toBe(2);
    // 主表全部代整删（既有契约回归面）
    expect(await prisma.canvasDocUpdate.count({ where: { projectId: PID } })).toBe(0);
    // ★红（侧表无换代清理路径）：gen0+gen1 侧表行残留
    expect(await prisma.canvasDocCoalesced.count({ where: { projectId: PID } }), 'vacuumReplace 换代侧表同域随删（全代零残留）').toBe(0);
  });
});