// apps/api/src/modules/collab/collab-lifecycle-observer.t26.int.spec.ts
// Y1c T26（plan v1.7——P3 排序 T21→T26→T22，偏离 38⑳）：生命周期义务观察器真 PG 用例。
// 红形态（本套件先于观察器实现空转跑——T21 c1 同款纪律）：
//  红①（无持久提交点）：删 A 帧落 PG 批后 NodeLifecycle/DeliveryFence/LifecycleObligation 全零行
//    ——义务落地前 finalize 先到=交付逃逸 node-deleted 检查（spec §6.5 反例）；
//  红②（T22 前置——deliverArtifact node-deleted 权威面缺失）：doc data.written:false 弃用后无权威
//    ——DeliveryFence 行不存在（契约测试/接口面先行红：T26 先落权威面供 T22 消费）。
// 装置：真 PG+真 repo（appendBatch 契约 16 租约 fixture）+真 spool（tmpdir）+直构 actor（驱动
// connection 帧走全管线：WAL fsync→apply→FrameEffects 收集→PG 批 flush——观察器与批同事务挂点）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabLifecycleObserverService } from './collab-lifecycle-observer.service';
import { CollabSpoolService } from './collab-spool.service';
import { CollabPersistenceService } from './collab-persistence.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow } from '../../test-utils/db-fixtures';
import type { Logger } from '@nestjs/common';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID_A = `t26-obs-a-${Date.now()}`;
const PID_B = `t26-obs-b-${Date.now()}`;   // 两项目同 nodeId 不互串（语义四则之四）

let prisma: PrismaClient;
let repo: CanvasDocUpdateRepository;
let spoolDir: { dir: string; cleanup: () => Promise<void> };
let spool: CollabSpoolService;

/** 直构 actor（documents Map 注入真 Y.Doc——gen0 canonical 裸名+观察器尾参接线）。 */
function buildActor(doc: Y.Doc, pid: string): CollabProjectActorService {
  const documents = new Map([[`project:${pid}`, doc]]);
  const actor = new CollabProjectActorService(spool, repo, undefined, new CollabLifecycleObserverService(prisma as never));
  actor.bindHost({
    logger: { log: vi.fn(), warn: (m: string) => console.warn("[warn]", m), error: (m: string) => console.error("[error]", m), debug: vi.fn(), verbose: vi.fn(), fatal: vi.fn() } as unknown as Logger,
    documents: () => documents,
    hardClose: () => {},
    isQuotaFrozen: () => false,
    generationOf: () => 0,
    noteReadOnlyDrop: () => false,
    onFencedByWrite: async () => {},
  });
  return actor;
}

function makeConn() {
  return { socketId: 'sock-' + Math.random().toString(36).slice(2, 8), readOnly: false, sendStateless: vi.fn() } as never;
}

/** 帧工厂（单一源 doc 逐步差分——create/delete 真实作用主 doc：fresh src 删不存在键=空 diff 反例已排；
 *  type ∈ FRAME_EFFECT_NODE_TYPE_VOCABULARY 才产 NODE_* effect；syncFrom=装载形态源同步）。 */
function makeFrames() {
  const src = new Y.Doc();
  let sv = Y.encodeStateVector(src);
  const diff = (): Uint8Array => {
    const u = Y.encodeStateAsUpdate(src, sv);
    sv = Y.encodeStateVector(src);
    return u;
  };
  return {
    create(nodeId: string): Uint8Array {
      src.getMap('nodes').set(nodeId, new Y.Map([['type', 'textInput']]));
      return diff();
    },
    del(nodeId: string): Uint8Array {
      src.getMap('nodes').delete(nodeId);
      return diff();
    },
    /** 源同步主 doc 在册态（重启形态——预载节点的 struct 归属转入源 doc，del 可产真 DS diff）。 */
    syncFrom(doc: Y.Doc): void {
      Y.applyUpdate(src, Y.encodeStateAsUpdate(doc));
      sv = Y.encodeStateVector(src);
    },
  };
}

/** 提交帧并等 PG 批落定（帧↔义务原子锚——义务与 CanvasDocUpdate 行同事务，pgSeq 达 walSeq 即落）。 */
async function submitAndFlush(actor: CollabProjectActorService, pid: string, frame: Uint8Array): Promise<bigint> {
  const r = await actor.submit(pid, frame, makeConn(), 'update');
  const w = await actor.flushThrough(pid, r.walSeq, { maxWaitMs: 5_000 });
  expect(w.targetReached).toBe(true);
  return r.walSeq;
}

async function seedDocRow(pid: string): Promise<void> {
  await prisma.canvasDoc.upsert({
    where: { projectId: pid },
    // generation=1：对齐 spool.currentGeneration 未播种缺省（g2 int 同款——CAS 谓词 generation 匹配）
    create: { projectId: pid, generation: 1, pgSeq: 0n, walCheckpointSeq: 0n },
    update: {},
  });
}

async function wipeLifecycleRows(pid: string): Promise<void> {
  await prisma.lifecycleObligation.deleteMany({ where: { projectId: pid } });
  await prisma.deliveryFence.deleteMany({ where: { projectId: pid } });
  await prisma.nodeLifecycle.deleteMany({ where: { projectId: pid } });
}

maybe('Y1c T26 生命周期义务观察器（真 PG）', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    repo = new CanvasDocUpdateRepository(prisma as never);
    await ensureLeaseFixture(prisma, repo);
    for (const pid of [PID_A, PID_B]) {
      await ensureProjectFixture(prisma, pid);
      await seedDocRow(pid);
      await wipeLifecycleRows(pid);
    }
    spoolDir = await makeSpoolDir('y1c-t26-obs-');
    spool = new CollabSpoolService(spoolDir.dir);
    spool.setOwner('t26-obs-owner');
    const hist = await prisma.systemHistory.findUnique({ where: { id: 1 } });
    if (!hist) throw new Error('SystemHistory 引导行缺失（T7 迁移 INSERT）——int 池前置不满足');
    spool.setWalHistory(hist.historyId);
  });
  afterAll(async () => {
    for (const pid of [PID_A, PID_B]) {
      await wipeLifecycleRows(pid);
      await cleanupProjectFixture(prisma, pid);
    }
    await spoolDir.cleanup();
    await restoreLeaseRow(prisma);
    await prisma.$disconnect();
  });

  it('红①：删 A 帧 PG 批落定后义务三表有持久提交点——帧↔义务原子（红=三表全零行：义务落地前 finalize 先到=交付逃逸 node-deleted 检查）', async () => {
    const doc = new Y.Doc();
    const actor = buildActor(doc, PID_A);
    const f = makeFrames();
    await submitAndFlush(actor, PID_A, f.create('nA'));
    // 创建即注册（per-node genesis 行——当前行 isCurrent ACTIVE）
    const created = await prisma.nodeLifecycle.findMany({ where: { projectId: PID_A, nodeId: 'nA' } });
    expect(created).toHaveLength(1);
    expect(created[0].state).toBe('ACTIVE');
    expect(created[0].isCurrent).toBe(true);
    // 删除帧 → DELETED 当前行+历史行保留+fence DELETED+三义务 PENDING（NODE_DELETED→[FEED_TOMBSTONE,NODE_DELETED,EXEC_FINALIZE]）
    await submitAndFlush(actor, PID_A, f.del('nA'));
    const rows = await prisma.nodeLifecycle.findMany({ where: { projectId: PID_A, nodeId: 'nA' }, orderBy: { lifecycleSeq: 'asc' } });
    expect(rows).toHaveLength(2);                                    // 红=0 行（无持久提交点）
    expect(rows[0].state).toBe('ACTIVE');
    expect(rows[0].isCurrent).toBe(false);                           // 历史行保留（partial unique 语义）
    expect(rows[1].state).toBe('DELETED');
    expect(rows[1].isCurrent).toBe(true);
    expect(rows[1].lifecycleSeq).toBeGreaterThan(rows[0].lifecycleSeq);   // lifecycleSeq 数值序
    const fence = await prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId: PID_A, nodeId: 'nA' } } });
    expect(fence?.state).toBe('DELETED');                            // 红=行不存在（T22 node-deleted 权威面缺失）
    expect(fence?.fenceSeq).toBe(rows[1].lifecycleSeq);              // fenceSeq==当前 lifecycleSeq
    const obligations = await prisma.lifecycleObligation.findMany({ where: { projectId: PID_A, nodeId: 'nA' }, orderBy: { kind: 'asc' } });
    expect(obligations.map((o) => o.kind)).toEqual(['EXEC_FINALIZE', 'FEED_TOMBSTONE', 'NODE_DELETED']);   // closed enum 三义务（#11 单源映射）
    expect(obligations.every((o) => o.state === 'PENDING' && o.attempts === 0)).toBe(true);
    // 帧行同事务锚：义务触发帧 walSeq=删除帧（帧↔义务原子——义务非空 ⇒ 对应 CanvasDocUpdate 行在）
    const delRow = await prisma.canvasDocUpdate.findFirst({ where: { projectId: PID_A }, orderBy: { seq: 'desc' } });
    expect(obligations.every((o) => o.walSeq === delRow!.seq)).toBe(true);
  }, 30_000);

  it('红②：T22 前置——DeliveryFence=node-deleted 权威（doc data.written:false 弃用后的接棒面）：删后权威在 PG、undo 重建=新 lifecycleSeq+复活', async () => {
    const doc = new Y.Doc();
    const actor = buildActor(doc, PID_A);
    const f = makeFrames();
    await submitAndFlush(actor, PID_A, f.create('nB'));
    await submitAndFlush(actor, PID_A, f.del('nB'));
    // 权威读面（T22 deliverArtifact 消费——本卡先落权威数据面）：DELETED 当前行在 PG
    let fence = await prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId: PID_A, nodeId: 'nB' } } });
    expect(fence?.state).toBe('DELETED');                            // 红=行不存在（权威面缺失）
    // undo 重建（跨帧 re-add=NODE_CREATED）= 新 lifecycleSeq+恢复态（语义四则之二）
    const before = await prisma.nodeLifecycle.findFirst({ where: { projectId: PID_A, nodeId: 'nB', isCurrent: true } });
    await submitAndFlush(actor, PID_A, f.create('nB'));
    const after = await prisma.nodeLifecycle.findFirst({ where: { projectId: PID_A, nodeId: 'nB', isCurrent: true } });
    expect(after?.state).toBe('ACTIVE');
    expect(after && before ? after.lifecycleSeq > before.lifecycleSeq : false).toBe(true);
    // 历史行保留复核（重读——Prisma 对象为读时快照）
    const beforeRow = await prisma.nodeLifecycle.findUnique({ where: { projectId_nodeId_lifecycleSeq: { projectId: PID_A, nodeId: 'nB', lifecycleSeq: before!.lifecycleSeq } } });
    expect(beforeRow?.isCurrent).toBe(false);
    fence = await prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId: PID_A, nodeId: 'nB' } } });
    expect(fence?.state).toBe('ACTIVE');
    expect(fence?.fenceSeq).toBe(after?.lifecycleSeq);
    // 重建后零删除义务（undo 重建无删除义务——负控）
    const obligations = await prisma.lifecycleObligation.findMany({ where: { projectId: PID_A, nodeId: 'nB' } });
    expect(obligations).toHaveLength(3);                             // 仅此前删除帧的三义务；RESTORE 不追加
  }, 30_000);

  it('语义四则之一：delete 已删=no-op 不二次退款（已删再删零新行零新义务）', async () => {
    const doc = new Y.Doc();
    const actor = buildActor(doc, PID_A);
    const f = makeFrames();
    await submitAndFlush(actor, PID_A, f.create('nC'));
    await submitAndFlush(actor, PID_A, f.del('nC'));
    const rows1 = await prisma.nodeLifecycle.count({ where: { projectId: PID_A, nodeId: 'nC' } });
    const ob1 = await prisma.lifecycleObligation.count({ where: { projectId: PID_A, nodeId: 'nC' } });
    await submitAndFlush(actor, PID_A, f.del('nC'));                 // 已删再删（CRDT 层 no-op 帧——零 effect）
    const rows2 = await prisma.nodeLifecycle.count({ where: { projectId: PID_A, nodeId: 'nC' } });
    const ob2 = await prisma.lifecycleObligation.count({ where: { projectId: PID_A, nodeId: 'nC' } });
    expect(rows2).toBe(rows1);
    expect(ob2).toBe(ob1);                                           // 不二次退款=义务不重复发射
  }, 30_000);

  it('语义四则之四：两项目同 nodeId 不互串（键含 projectId）', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const actorA = buildActor(docA, PID_A);
    const actorB = buildActor(docB, PID_B);
    const fA = makeFrames();
    const fB = makeFrames();
    await submitAndFlush(actorA, PID_A, fA.create('nShared'));
    await submitAndFlush(actorB, PID_B, fB.create('nShared'));
    await submitAndFlush(actorA, PID_A, fA.del('nShared'));          // 仅 A 删
    const rowA = await prisma.nodeLifecycle.findFirst({ where: { projectId: PID_A, nodeId: 'nShared', isCurrent: true } });
    const rowB = await prisma.nodeLifecycle.findFirst({ where: { projectId: PID_B, nodeId: 'nShared', isCurrent: true } });
    expect(rowA?.state).toBe('DELETED');
    expect(rowB?.state).toBe('ACTIVE');                              // B 不受 A 删除影响
    const obB = await prisma.lifecycleObligation.count({ where: { projectId: PID_B, nodeId: 'nShared' } });
    expect(obB).toBe(0);                                             // A 的删除义务不串入 B
  }, 30_000);

  it('重建路径锚：义务可从帧前缀确定性重建（wipe 三表后同帧前缀重derive=行集等值）+deliveryFenceCheck 权威判定（T22 消费面）', async () => {
    const doc = new Y.Doc();
    const actor = buildActor(doc, PID_A);
    const observer = new CollabLifecycleObserverService(prisma as never);
    const f = makeFrames();
    const w1 = await submitAndFlush(actor, PID_A, f.create('nR'));
    const w2 = await submitAndFlush(actor, PID_A, f.del('nR'));
    const w3 = await submitAndFlush(actor, PID_A, f.create('nR'));   // undo 重建（终态 ACTIVE）
    const snapshot = async () => ({
      lifecycle: await prisma.nodeLifecycle.findMany({ where: { projectId: PID_A, nodeId: 'nR' }, orderBy: { lifecycleSeq: 'asc' } }),
      fence: await prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId: PID_A, nodeId: 'nR' } } }),
      obligations: await prisma.lifecycleObligation.findMany({ where: { projectId: PID_A, nodeId: 'nR' }, orderBy: { kind: 'asc' } }),
    });
    const before = await snapshot();
    // 崩溃模拟：三表丢失（义务未落/进程内态丢失）→ 从帧前缀重derive（重建=同帧 effects 重放 persistFramesInTx）
    await wipeLifecycleRows(PID_A);
    const replayFrames = [
      { walSeq: w1, effects: [{ kind: 'NODE_CREATED' as const, nodeId: 'nR', type: 'textInput' as const, walSeq: w1 }] },
      { walSeq: w2, effects: [{ kind: 'NODE_DELETED' as const, nodeId: 'nR', walSeq: w2 }] },
      { walSeq: w3, effects: [{ kind: 'NODE_CREATED' as const, nodeId: 'nR', type: 'textInput' as const, walSeq: w3 }] },
    ];
    await prisma.$transaction(async (tx) => { await observer.persistFramesInTx(tx as never, PID_A, replayFrames); });
    const after = await snapshot();
    // 行集等值（lifecycleSeq 分配确定性：同基线 MAX+1 起点；obligation/fence 逐字段等值）
    expect(after.obligations.map((o) => ({ kind: o.kind, walSeq: o.walSeq, state: o.state })))
      .toEqual(before.obligations.map((o) => ({ kind: o.kind, walSeq: o.walSeq, state: o.state })));
    expect(after.lifecycle.map((r) => ({ state: r.state, isCurrent: r.isCurrent, walSeq: r.walSeq })))
      .toEqual(before.lifecycle.map((r) => ({ state: r.state, isCurrent: r.isCurrent, walSeq: r.walSeq })));
    // fence 内部一致性（fenceSeq==该节点当前行 lifecycleSeq；绝对值随 wipe 后 per-project 计数基线平移——
    // 重建确定性域=同帧前缀+同基线态，本用例 wipe 了其他节点行故 lifecycleSeq 整体平移属预期）
    expect(after.fence?.state).toBe(before.fence?.state);
    expect(after.fence?.fenceSeq).toBe(after.lifecycle[after.lifecycle.length - 1].lifecycleSeq);
    // T22 消费面：undo 重建终态=放行；DELETED 态节点=丢弃不退款（node-deleted）
    const verdict = await observer.deliveryFenceCheck(PID_A, 'nR');
    expect(verdict).toMatchObject({ allow: true, fenceSeq: after.fence?.fenceSeq });
    const other = new CollabLifecycleObserverService(prisma as never);
    const unregistered = await other.deliveryFenceCheck(PID_A, 'never-existed');
    expect(unregistered).toMatchObject({ allow: false, reason: 'unregistered' });
  }, 30_000);

  it('genesis 播种（T7/T21 未 seed——本卡补）：重启形态（doc 预载节点+观察器首批前播种）→ 在册节点删除发义务', async () => {
    const doc = new Y.Doc();
    // 预载节点（装载路径——不经帧注册；观察器经 actor 首批 seedPresence 按 presence 补在册）
    doc.getMap('nodes').set('nSeed', new Y.Map([['type', 'textInput']]));
    doc.getMap('nodes').set('nSeed2', new Y.Map([['type', 'textInput']]));
    const actor = buildActor(doc, PID_A);
    const f = makeFrames();
    // 首帧（任意——触发首批播种；帧工厂源 doc 无 nSeed 故 create nX 为全新节点）
    await submitAndFlush(actor, PID_A, f.create('nX'));
    const seeded = await prisma.nodeLifecycle.findMany({ where: { projectId: PID_A }, orderBy: { nodeId: 'asc' } });
    const seedRows = seeded.filter((r) => r.nodeId.startsWith('nSeed'));
    expect(seedRows).toHaveLength(2);                                // 预载两节点在册（ACTIVE 当前行）
    expect(seedRows.every((r) => r.state === 'ACTIVE' && r.isCurrent)).toBe(true);
    // 预载节点经帧删除 → 正常发义务（重启后真值恢复——「从未在册 no-op」仅适用于真未观察面）。
    // 删除帧须携带 nSeed 的真 DS op：源 doc 先 syncFrom 主 doc（struct 归属转入）再删。
    const f2 = makeFrames();
    f2.syncFrom(doc);
    await submitAndFlush(actor, PID_A, f2.del('nSeed'));
    const rowSeed = await prisma.nodeLifecycle.findFirst({ where: { projectId: PID_A, nodeId: 'nSeed', isCurrent: true } });
    expect(rowSeed?.state).toBe('DELETED');
    const obSeed = await prisma.lifecycleObligation.findMany({ where: { projectId: PID_A, nodeId: 'nSeed' } });
    expect(obSeed.map((o) => o.kind).sort()).toEqual(['EXEC_FINALIZE', 'FEED_TOMBSTONE', 'NODE_DELETED']);
  }, 30_000);

// ═══ Y1c T26 双评审收口批（I-1 stale-ACTIVE 逃逸+M-4 播种词表+I-2 大帧绿证）═══════════════
describe('Y1c T26 收口批（真 PG）', () => {
  it('红（I-1）：replayAll 回灌窗 stale-ACTIVE 交付逃逸——双陈旧匹配态修前放行/修后 fence-stale 拒（inTx 同事务锚）', async () => {
    // 布景：nE 经帧注册（NodeLifecycle ACTIVE+fence 对齐）——构造「生命周期表滞后于 doc」的崩溃前形态
    const doc = new Y.Doc();
    const actor = buildActor(doc, PID_A);
    const f = makeFrames();
    await submitAndFlush(actor, PID_A, f.create('nE'));
    const fence0 = await prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId: PID_A, nodeId: 'nE' } } });
    expect(fence0?.state).toBe('ACTIVE');
    // 删除帧只落 spool（WAL fsync 成功+PG flush 未发生=崩溃窗——actor 侧 flush 缺席）
    const delFrame = f.del('nE');
    await spool.appendBatch(PID_A, [delFrame]);
    // boot 恢复路径：replayAll 机械回灌帧行（观察器在场——红=现行 opts 被忽略→三表不动）
    const observer = new CollabLifecycleObserverService(prisma as never);
    const r = await spool.replayAll(repo, { projectIds: [PID_A], lifecycleObserver: observer });
    expect(r.replayed).toBe(1);
    // 逃逸断言（红=修前 evaluateDeliveryFence 走「ACTIVE 匹配放行」档——对已删节点放行交付）
    const verdict = await observer.deliveryFenceCheck(PID_A, 'nE');
    expect(verdict).toMatchObject({ allow: false, reason: 'fence-stale' });
    // 修后语义：NodeLifecycle 仍 ACTIVE（replay 不派生 effects——重 derive 终态归 T27 恢复链）；fenceSeq=0≠当前行
    const row = await prisma.nodeLifecycle.findFirst({ where: { projectId: PID_A, nodeId: 'nE', isCurrent: true } });
    expect(row?.state).toBe('ACTIVE');
    const fence1 = await prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId: PID_A, nodeId: 'nE' } } });
    expect(fence1?.fenceSeq).toBe(0n);
    // 同事务锚：stale 与回灌帧行同事务（fence 已 stale ⇒ replay 行已在——walSeq 推进证据）
    const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID_A }, select: { pgSeq: true } });
    expect(head && head.pgSeq > fence0!.fenceSeq).toBe(true);   // pgSeq 已越过注册帧（replay 帧落定）
  }, 30_000);

  it('（I-1 恢复回路）stale 后 presence 播种重对齐：在册 present 节点 fenceSeq==当前 lifecycleSeq 不变量重建→放行', async () => {
    const observer = new CollabLifecycleObserverService(prisma as never);
    const doc = new Y.Doc();
    const actor = buildActor(doc, PID_A);
    const f = makeFrames();
    await submitAndFlush(actor, PID_A, f.create('nF'));           // 注册+对齐
    let fence = await prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId: PID_A, nodeId: 'nF' } } });
    expect(fence?.state).toBe('ACTIVE');
    // replay 窗形态：项目级 stale（replayAll inTx 同款直调）
    await prisma.$transaction(async (tx) => { await observer.staleProjectFencesInTx(tx as never, PID_A); });
    const mid = await observer.deliveryFenceCheck(PID_A, 'nF');
    expect(mid).toMatchObject({ allow: false, reason: 'fence-stale' });   // fail-closed 窗
    // 重启形态：新 doc 实例含 nF（presence）+首批帧 → seed（inTx）重对齐 fence
    const doc2 = new Y.Doc();
    doc2.getMap('nodes').set('nF', new Y.Map([['type', 'textInput']]));
    const actor2 = buildActor(doc2, PID_A);
    const f2 = makeFrames();
    await submitAndFlush(actor2, PID_A, f2.create('nOther'));
    fence = await prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId: PID_A, nodeId: 'nF' } } });
    const cur = await prisma.nodeLifecycle.findFirst({ where: { projectId: PID_A, nodeId: 'nF', isCurrent: true } });
    expect(fence?.state).toBe('ACTIVE');
    expect(fence?.fenceSeq).toBe(cur?.lifecycleSeq);               // 不变量重建
    const verdict = await observer.deliveryFenceCheck(PID_A, 'nF');
    expect(verdict).toMatchObject({ allow: true });
  }, 30_000);

  it('红（M-4）：播种词表门——无效 type 节点不播种（isFrameNodeTypeName 与 collector NODE_* 门对齐）', async () => {
    const doc = new Y.Doc();
    doc.getMap('nodes').set('nBogus', new Y.Map([['type', 'not-a-real-type']]));   // 词表外
    doc.getMap('nodes').set('nOk', new Y.Map([['type', 'textInput']]));
    const actor = buildActor(doc, PID_B);
    const f = makeFrames();
    await submitAndFlush(actor, PID_B, f.create('nTrigger'));
    const bogus = await prisma.nodeLifecycle.findMany({ where: { projectId: PID_B, nodeId: 'nBogus' } });
    expect(bogus).toHaveLength(0);                                 // 红=现行 seedPresence 无词表门（注册 bogus）
    const ok = await prisma.nodeLifecycle.findMany({ where: { projectId: PID_B, nodeId: 'nOk' } });
    expect(ok).toHaveLength(1);                                    // 词表内正常播种
  }, 30_000);

  it('（I-2 绿证）大帧批落：单帧 300 节点创建+单帧 300 节点删除——600 行+900 义务全落+耗时记录', async () => {
    const { lifecycleObligationsCreatedTotal } = await import('./store.metrics');
    const oblBefore = (await lifecycleObligationsCreatedTotal.get()).values.reduce((s, v) => s + v.value, 0);
    const doc = new Y.Doc();
    const actor = buildActor(doc, PID_A);
    // 单帧 300 创建（源 doc 单事务 300 set → 一 diff 帧 → 300 NODE_CREATED effects 一批派生）
    const src = new Y.Doc();
    let sv = Y.encodeStateVector(src);
    src.transact(() => {
      for (let i = 0; i < 300; i++) src.getMap('nodes').set(`nBulk${i}`, new Y.Map([['type', 'textInput']]));
    });
    const createFrame = Y.encodeStateAsUpdate(src, sv);
    sv = Y.encodeStateVector(src);
    src.transact(() => {
      for (let i = 0; i < 300; i++) src.getMap('nodes').delete(`nBulk${i}`);
    });
    const deleteFrame = Y.encodeStateAsUpdate(src, sv);
    const t0 = Date.now();
    await submitAndFlush(actor, PID_A, createFrame);
    await submitAndFlush(actor, PID_A, deleteFrame);
    const dtMs = Date.now() - t0;
    const rows = await prisma.nodeLifecycle.count({ where: { projectId: PID_A, nodeId: { startsWith: 'nBulk' } } });
    expect(rows).toBe(600);                                        // 300 ACTIVE+300 DELETED（翻转+新行批量化）
    const obligations = await prisma.lifecycleObligation.count({ where: { projectId: PID_A, nodeId: { startsWith: 'nBulk' } } });
    expect(obligations).toBe(900);                                 // 300×三义务
    const oblAfter =  (await lifecycleObligationsCreatedTotal.get()).values.reduce((s, v) => s + v.value, 0);
    expect(oblAfter - oblBefore).toBeGreaterThanOrEqual(900);      // M-3 遥测：生成面计数
    console.log(`[t26-i2-bulk] 300+300 事件单批管线（创建帧+删除帧 flush）耗时 ${dtMs}ms`);
    expect(dtMs).toBeLessThan(60_000);                             // 松上界（正确性为主——耗时记录供观测）
  }, 120_000);
});

  it('红（R-1 二轮）：生产 reconciler 路径（persistence :879——ownPending 裸形/adopt 两档）带 stale+运行期 stale 后同实例下一帧批重对齐（现码红=①无 stale 放行逃逸②需重载才复活）', async () => {
    const observer = new CollabLifecycleObserverService(prisma as never);
    const doc = new Y.Doc();
    const actor = buildActor(doc, PID_A);
    const f = makeFrames();
    await submitAndFlush(actor, PID_A, f.create('nHealthy'));    // 健康节点（恒 present——重对齐复活对象）
    await submitAndFlush(actor, PID_A, f.create('nVictim'));     // 待删节点
    expect((await observer.deliveryFenceCheck(PID_A, 'nHealthy')).allow).toBe(true);
    // PG 瞬断：删除帧走 actor 全管线（apply+WAL fsync+ACK）但 flush 一次失败——帧滞留
    // appliedQueue+spool 未 confirm（生产逃逸窗形态；帧工厂后续 create 用 fresh 客户端防 DS 重携）
    const appendSpy = vi.spyOn(repo, 'appendBatch').mockRejectedValueOnce(new Error('pg blip'));
    await actor.submit(PID_A, f.del('nVictim'), makeConn(), 'update');
    await vi.waitFor(() => expect(actor.appliedQueueDepth(PID_A)).toBeGreaterThan(0), { timeout: 3_000 });
    appendSpy.mockRestore();
    // 生产 reconciler 入口（30s tick 直调——ownPending 裸形；observer face 经 setter 注入）
    const persistence = new CollabPersistenceService(repo as never, spool as never);
    persistence.bindHost({
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn(), fatal: vi.fn() } as unknown as Logger,
      getDocument: () => undefined,
      docStats: () => ({ loadedDocs: 0, connections: 0, directConns: 0 }),
      onUpdateDelta: () => {},
      onFencedByWrite: async () => {},
      calibrateTruth: () => undefined,
      observeDocBytes: () => {},
      isIsolated: () => false,
      isServingState: () => true,
      isShuttingDownFlag: () => false,
      onSpoolRecoveredFlip: () => {},
      currentLeaseEpoch: () => null,
    } as never);
    persistence.setLifecycleObserver(actor.lifecycleObserverFace);   // ①接线（红=不传 observer）
    await (persistence as unknown as { reconcileSpool(): Promise<void> }).reconcileSpool();
    // ①stale 落定：健康节点与待删节点双双 fence-stale（项目级 stale=fail-closed 窗——红①=修前 ACTIVE 匹配放行逃逸）
    expect(await observer.deliveryFenceCheck(PID_A, 'nHealthy')).toMatchObject({ allow: false, reason: 'fence-stale' });
    expect(await observer.deliveryFenceCheck(PID_A, 'nVictim')).toMatchObject({ allow: false, reason: 'fence-stale' });
    // ②同实例重对齐：已装载已播种 doc 无需重载——任意下一帧批（fresh 工厂无 DS 重携）：健康节点复活；
    //   待删节点的滞留删除帧随 appliedQueue 重试同批落定（NODE_DELETED 衍生+三义务——PG 瞬断自愈）
    const f3 = makeFrames();
    await submitAndFlush(actor, PID_A, f3.create('nHeal'));
    expect(await observer.deliveryFenceCheck(PID_A, 'nHealthy')).toMatchObject({ allow: true });   // 红②=现码需重载才复活
    const victim = await observer.deliveryFenceCheck(PID_A, 'nVictim');
    expect(victim.allow).toBe(false);                                // 删除真值恢复（fence-stale 或 node-deleted 均拒）
    const obVictim = await prisma.lifecycleObligation.findMany({ where: { projectId: PID_A, nodeId: 'nVictim' } });
    expect(obVictim.map((o) => o.kind).sort()).toEqual(['EXEC_FINALIZE', 'FEED_TOMBSTONE', 'NODE_DELETED']);   // appliedQueue 重试衍生（红=现码义务永不发射）
  }, 30_000);

});
