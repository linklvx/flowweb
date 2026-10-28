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
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CollabSpoolService as CollabSpoolServiceBase, encodeWalSegmentBytes, walSegmentFileName } from './collab-spool.service';
void CollabSpoolServiceBase;
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

/** 直构 actor（documents Map 注入真 Y.Doc——gen0 canonical 裸名+观察器尾参接线；loadPgSeq=装载缝
 *  模拟——DR loadDocument 的 noteDocLoadedPrefix 前缀报告〔doc 所代表的 PG 前缀真值〕，缺省不报=0 最保守）。 */
function buildActor(doc: Y.Doc, pid: string, loadPgSeq?: bigint): CollabProjectActorService {
  const documents = new Map([[`project:${pid}`, doc]]);
  const actor = new CollabProjectActorService(spool, repo, undefined, new CollabLifecycleObserverService(prisma as never));
  if (loadPgSeq !== undefined) {
    (actor as unknown as { noteDocLoadedPrefix?(d: Y.Doc, s: bigint): void }).noteDocLoadedPrefix?.(doc, loadPgSeq);
  }
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

/** 装载缝模拟真值：当前 CanvasDoc.pgSeq（doc=PG 前缀投影形态——genesis/重对齐用例）。 */
async function currentPgSeq(pid: string): Promise<bigint> {
  const head = await prisma.canvasDoc.findUnique({ where: { projectId: pid }, select: { pgSeq: true } });
  return head?.pgSeq ?? 0n;
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
    // 预载节点（装载路径——不经帧注册；观察器经 actor 首批 seedPresence 按 presence 补在册；
    // 装载缝模拟：doc=当前 PG 前缀投影〔F-1 门槛 loadPgSeq 腿真值〕）
    doc.getMap('nodes').set('nSeed', new Y.Map([['type', 'textInput']]));
    doc.getMap('nodes').set('nSeed2', new Y.Map([['type', 'textInput']]));
    const actor = buildActor(doc, PID_A, await currentPgSeq(PID_A));
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
    //（装载缝模拟：doc2=当前 PG 前缀投影〔nF 在册与 PG 行一致〕——F-1 门槛真值报告）
    const doc2 = new Y.Doc();
    doc2.getMap('nodes').set('nF', new Y.Map([['type', 'textInput']]));
    const actor2 = buildActor(doc2, PID_A, await currentPgSeq(PID_A));
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
    const actor = buildActor(doc, PID_B, await currentPgSeq(PID_B));
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

  it('红（F-1 三轮）：adopt/doc-lag 形态（前进程滞留帧——boot 预算耗尽→30s reconciler 回灌窗）守卫禁 presence 捕获至重载——现码红=水位自洽谓词放行重对齐复活逃逸', async () => {
    const observer = new CollabLifecycleObserverService(prisma as never);
    const doc = new Y.Doc();
    const actor = buildActor(doc, PID_A);   // 装载缝不报=0 最保守（doc 空——装载前缀真值 0）
    const f = makeFrames();
    await submitAndFlush(actor, PID_A, f.create('nLagH'));   // 健康节点（本实例 own-applied）
    await submitAndFlush(actor, PID_A, f.create('nLagD'));   // 待删节点
    // 前进程滞留删除帧形态：帧在 spool 在档+水位自洽（noteApplied 对齐=boot scan 重建形态——
    // spoolHeadSeq==appliedSeq ⇒ 旧谓词恒过=F-1 错配面）+未 confirm+**未 apply 入本 doc**
    const f2 = makeFrames();
    f2.syncFrom(doc);
    const delFrame = f2.del('nLagD');
    const appended = await spool.appendBatch(PID_A, [delFrame]);
    await spool.noteApplied(PID_A, appended[0].walSeq);
    // reconciler 回灌（30s tick 直调）：PG 前进+项目级 stale（doc 滞后——nLagD 仍在册 presence 面）
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
    persistence.setLifecycleObserver(actor.lifecycleObserverFace);
    await (persistence as unknown as { reconcileSpool(): Promise<void> }).reconcileSpool();
    expect(await observer.deliveryFenceCheck(PID_A, 'nLagD')).toMatchObject({ allow: false, reason: 'fence-stale' });
    // 下一帧批（同实例，fresh 工厂无 DS 重携）：修后=守卫禁捕获（PG 越过 doc 已应用前缀）→
    // fence 维持 fence-stale 拒（红=现码水位自洽谓词放行→presence 含 nLagD〔doc 滞后〕→重对齐复活 allow:true 逃逸）
    const f3 = makeFrames();
    await submitAndFlush(actor, PID_A, f3.create('nLagN'));
    expect(await observer.deliveryFenceCheck(PID_A, 'nLagD')).toMatchObject({ allow: false, reason: 'fence-stale' });
    expect(await observer.deliveryFenceCheck(PID_A, 'nLagH')).toMatchObject({ allow: false, reason: 'fence-stale' });   // 同批禁捕获：健康节点同拒（fail-closed 至重载）
    // doc 重载后恢复：doc2=PG 真值投影（健康在册/已删不在）+装载缝报告当前 pgSeq→重对齐复活健康节点
    const doc2 = new Y.Doc();
    doc2.getMap('nodes').set('nLagH', new Y.Map([['type', 'textInput']]));
    const head = await prisma.canvasDoc.findUnique({ where: { projectId: PID_A }, select: { pgSeq: true } });
    const actor2 = buildActor(doc2, PID_A, head!.pgSeq);
    const f4 = makeFrames();
    await submitAndFlush(actor2, PID_A, f4.create('nLagN2'));
    expect(await observer.deliveryFenceCheck(PID_A, 'nLagH')).toMatchObject({ allow: true });   // 重载后重对齐复活
    const lagVerdict = await observer.deliveryFenceCheck(PID_A, 'nLagD');
    expect(lagVerdict.allow).toBe(false);   // 已删节点恒拒（absent 不复活——PG 真值面）
  }, 30_000);

  // ═══ Y1c T27 收口批 I-3(spec)：replay 回灌帧前缀重 derive effects（恢复链终态）═══
  it('红（T27 I-3）：replayAll 回灌帙经帧前缀重 derive——恢复链终态=lifecycle/义务/fence 与首次 apply 等价（红=现行机械回灌：删除帙落 PG 而三表零行+fenceSeq=0 stale 面）', async () => {
    const pid = `t27-replay-${Date.now()}`;
    await ensureProjectFixture(prisma, pid);
    try {
      await seedDocRow(pid);
      await wipeLifecycleRows(pid);
      // —— 基线：PG 已提交前缀（seq=1 建 n1 帧行——直插形态）+lifecycle 基线（n1 ACTIVE 行+fence 对齐：
      // 模拟建帙当时已派生——derive 的 DB 基线态面）——
      const fm = makeFrames();
      const createFrame = fm.create('nR1');
      await prisma.$executeRaw`INSERT INTO "CanvasDocUpdate" ("projectId", generation, seq, "firstWalSeq", "frameCount", "updateHash", update, "createdAt")
        VALUES (${pid}::text, 1::int, 1::bigint, 1::bigint, 1::int, ${'r' + '1'.padEnd(63, '0')}::char(64), ${Buffer.from(createFrame)}, now())`;
      await prisma.canvasDoc.update({ where: { projectId: pid }, data: { pgSeq: 1n, walCheckpointSeq: 1n } });
      await prisma.nodeLifecycle.create({ data: { projectId: pid, nodeId: 'nR1', lifecycleSeq: 1n, isCurrent: true, state: 'ACTIVE', walSeq: 1n } });
      await prisma.deliveryFence.create({ data: { projectId: pid, nodeId: 'nR1', fenceSeq: 1n, state: 'ACTIVE' } as never });
      // —— 残留 WAL：段文件含 walSeq=2 帧=删 n1 diff（崩溃未 confirm 形态——删除帙只落 WAL 不落 PG）——
      const delFrame = fm.del('nR1');
      const hist = await prisma.systemHistory.findUnique({ where: { id: 1 } });
      const segBytes = encodeWalSegmentBytes(
        { projectId: pid, generation: 1, historyId: hist!.historyId, createdAtMs: Date.now(), lastWriteAtMs: Date.now() },
        [{ walSeq: 2n, generation: 1, payload: delFrame }],
      );
      const segDir = await makeSpoolDir('y1c-t27-replay-');
      try {
        await mkdir(join(segDir.dir, 't27-replay-owner'), { recursive: true });
        await writeFile(join(segDir.dir, 't27-replay-owner', walSegmentFileName(pid, 1, 0)), segBytes);
        // 重启形态：新 spool 实例（同目录）+recoverScan+replayAll（derive 回调注入=actor 派生面）
        const spool2 = new CollabSpoolService(segDir.dir);
        spool2.setOwner('t27-replay-owner');
        spool2.setProjectGeneration(pid, 1);
        await spool2.recoverScan({ systemHistory: { historyId: hist!.historyId, epochStartedAtMs: hist!.epochStartedAt.getTime() }, pgSeq: () => 1n });
        const observer2 = new CollabLifecycleObserverService(prisma as never);
        const actor2 = new CollabProjectActorService(spool2, repo, undefined, observer2);
        // derive 回调=actor 公法（红=方法缺席/回调被忽略——as any 传键：现行 opts 无此面）
        const derive = (target: string, frames: Array<{ walSeq: bigint; payload: Uint8Array }>) =>
          (actor2 as unknown as { deriveLifecycleFramesForReplay?: (p: string, f: Array<{ walSeq: bigint; payload: Uint8Array }>) => Promise<unknown> })
            .deriveLifecycleFramesForReplay?.(target, frames) ?? null;
        const r = await spool2.replayAll(repo, {
          projectIds: [pid],
          lifecycleObserver: observer2,
          deriveLifecycleFrames: derive,
          lifecyclePersist: (tx: import('@prisma/client').Prisma.TransactionClient, pid2: string, frames: never) => observer2.persistFramesInTx(tx, pid2, frames),
        } as never);
        expect(r.replayed).toBe(1);
        // 帧行落 PG（回灌本体）+pgSeq 推进
        const head = await prisma.canvasDoc.findUnique({ where: { projectId: pid }, select: { pgSeq: true } });
        expect(head?.pgSeq).toBe(2n);
        // ★ 恢复链终态（等价断言——T26 首 apply 语义）：DELETED 当前行（翻 ACTIVE 历史行）
        const rows = await prisma.nodeLifecycle.findMany({ where: { projectId: pid, nodeId: 'nR1' }, orderBy: { lifecycleSeq: 'asc' } });
        expect(rows.length, 'lifecycle 行在（红=现行回灌零行）').toBeGreaterThanOrEqual(2);
        expect(rows[0].state).toBe('ACTIVE');
        expect(rows[0].isCurrent).toBe(false);
        expect(rows[rows.length - 1].state).toBe('DELETED');
        expect(rows[rows.length - 1].isCurrent).toBe(true);
        // fence 对齐（红=现行 fenceSeq=0 stale 面）
        const fence = await prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId: pid, nodeId: 'nR1' } } });
        expect(fence?.state).toBe('DELETED');
        expect(fence?.fenceSeq).toBe(rows[rows.length - 1].lifecycleSeq);
        // 三义务（NODE_DELETED→[FEED_TOMBSTONE,NODE_DELETED,EXEC_FINALIZE]——帧↔义务原子）
        const obligations = await prisma.lifecycleObligation.findMany({ where: { projectId: pid, nodeId: 'nR1' }, orderBy: { kind: 'asc' } });
        expect(obligations.map((o) => o.kind)).toEqual(['EXEC_FINALIZE', 'FEED_TOMBSTONE', 'NODE_DELETED']);
        expect(obligations.every((o) => o.walSeq === 2n)).toBe(true);
      } finally { await segDir.cleanup(); }
    } finally {
      await wipeLifecycleRows(pid);
      await cleanupProjectFixture(prisma, pid);
    }
  }, 30_000);

  // ═══ Y1c T27 收尾微批（I-3' Controller 裁定 (a) 接线 + M-b 轮界 memo——红先行）═══
  /** derive 回调经 actor 公法（红先行=签名/face 面尚未存在的形态直传——as never 收窄，修后同一形）。 */
  const deriveViaActor = (actor: CollabProjectActorService) =>
    (target: string, frames: ReadonlyArray<{ walSeq: bigint; payload: Uint8Array }>, memo?: unknown) =>
      (actor as unknown as { deriveLifecycleFramesForReplay: (p: string, f: ReadonlyArray<{ walSeq: bigint; payload: Uint8Array }>, m?: unknown) => Promise<unknown> })
        .deriveLifecycleFramesForReplay(target, frames, memo);

  /** 生产 reconciler 装置（persistence 直构+gateway 形态三面 face——stale/derive/persist；R-1 二轮同款）。 */
  async function reconcileViaPersistence(actor: CollabProjectActorService, observer: CollabLifecycleObserverService, spoolInstance: CollabSpoolService): Promise<void> {
    const persistence = new CollabPersistenceService(repo as never, spoolInstance as never);
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
    persistence.setLifecycleObserver({
      staleProjectFencesInTx: (tx: import('@prisma/client').Prisma.TransactionClient, p: string) => observer.staleProjectFencesInTx(tx, p),
      deriveLifecycleFramesForReplay: deriveViaActor(actor),
      persistFramesInTx: (tx: import('@prisma/client').Prisma.TransactionClient, p: string, frames: never) => observer.persistFramesInTx(tx, p, frames),
    } as never);
    await (persistence as unknown as { reconcileSpool(): Promise<void> }).reconcileSpool();
  }

  it("红（I-3' 接线）：生产 reconciler 路径（reconcileSpool ownPending 档）回灌帙重派生 lifecycle/义务/fence——修前=face 缺 derive 面（stale-only）三表零行（boot 预算耗尽残帧/adopt 外来段帙 lifecycle/义务/fence 行永不派生=doc-lag 窗缺档）", async () => {
    const observer = new CollabLifecycleObserverService(prisma as never);
    const pid = `t27i3r-${Date.now()}`;
    await ensureProjectFixture(prisma, pid);
    const segDir = await makeSpoolDir('y1c-t27-i3r-');
    try {
      await seedDocRow(pid);
      await wipeLifecycleRows(pid);
      // PG 已提交前缀（seq=1 建 nI3 帙）+已派生基线（ACTIVE 当前行+fence 对齐——建帙当时已派生形态）
      const fm = makeFrames();
      const createFrame = fm.create('nI3');
      await prisma.$executeRaw`INSERT INTO "CanvasDocUpdate" ("projectId", generation, seq, "firstWalSeq", "frameCount", "updateHash", update, "createdAt")
        VALUES (${pid}::text, 1::int, 1::bigint, 1::bigint, 1::int, ${'i' + '1'.padEnd(63, '0')}::char(64), ${Buffer.from(createFrame)}, now())`;
      await prisma.canvasDoc.update({ where: { projectId: pid }, data: { pgSeq: 1n, walCheckpointSeq: 1n } });
      await prisma.nodeLifecycle.create({ data: { projectId: pid, nodeId: 'nI3', lifecycleSeq: 1n, isCurrent: true, state: 'ACTIVE', walSeq: 1n } });
      await prisma.deliveryFence.create({ data: { projectId: pid, nodeId: 'nI3', fenceSeq: 1n, state: 'ACTIVE' } as never });
      // 滞留删除帙（ownPending 形态：own 段直接 append——walSeq 自 PG 真值续号 2）
      const spoolD = new CollabSpoolService(segDir.dir);
      spoolD.setOwner('t27-i3r-owner');
      spoolD.setProjectGeneration(pid, 1);
      spoolD.seedWalSeqFromPg(pid, 1n);
      const appendedDel = await spoolD.appendBatch(pid, [fm.del('nI3')]);
      await spoolD.noteApplied(pid, appendedDel[0].walSeq);   // actor 管线形态（append→apply→noteApplied——水位三元不变量）
      const actorD = new CollabProjectActorService(spoolD, repo, undefined, observer);
      // ★ 生产 reconciler 入口（30s tick）——gateway 形态三面 face（红=reconcileSpool 只带 stale 面：派生被忽略）
      await reconcileViaPersistence(actorD, observer, spoolD);
      // 回灌本体：帙落 PG+pgSeq 推进（红绿两态均成立——非红锚）
      const head = await prisma.canvasDoc.findUnique({ where: { projectId: pid }, select: { pgSeq: true } });
      expect(head?.pgSeq).toBe(2n);
      // ★ 修前红=lifecycle/义务零行（机械回灌 stale-only）
      const rows = await prisma.nodeLifecycle.findMany({ where: { projectId: pid, nodeId: 'nI3' }, orderBy: { lifecycleSeq: 'asc' } });
      expect(rows.length, "reconciler 回灌帙重派生 lifecycle 行（修前=零行——I-3' 接线缺档）").toBeGreaterThanOrEqual(2);
      expect(rows[rows.length - 1].state).toBe('DELETED');
      expect(rows[rows.length - 1].isCurrent).toBe(true);
      const obligations = await prisma.lifecycleObligation.findMany({ where: { projectId: pid, nodeId: 'nI3' }, orderBy: { kind: 'asc' } });
      expect(obligations.map((o) => o.kind)).toEqual(['EXEC_FINALIZE', 'FEED_TOMBSTONE', 'NODE_DELETED']);
      expect(obligations.every((o) => o.walSeq === 2n)).toBe(true);
      const fence = await prisma.deliveryFence.findUnique({ where: { projectId_nodeId: { projectId: pid, nodeId: 'nI3' } } });
      expect(fence?.state).toBe('DELETED');
      expect(fence?.fenceSeq).toBe(rows[rows.length - 1].lifecycleSeq);
    } finally {
      await wipeLifecycleRows(pid);
      await cleanupProjectFixture(prisma, pid);
      await segDir.cleanup();
    }
  }, 30_000);

  it('红（M-b IO-once）：单次 replayAll 调用内每项目至多一次 loadForHydration（轮界 memo——9 帧>REPLAY_MERGE_MAX_FRAMES=8 两轮；修前=每轮全量装载 O(R²)）', async () => {
    const observer = new CollabLifecycleObserverService(prisma as never);
    const pid = `t27memo1-${Date.now()}`;
    await ensureProjectFixture(prisma, pid);
    const segDir = await makeSpoolDir('y1c-t27-memo1-');
    try {
      await seedDocRow(pid);
      await wipeLifecycleRows(pid);
      const spoolD = new CollabSpoolService(segDir.dir);
      spoolD.setOwner('t27-memo1-owner');
      spoolD.setProjectGeneration(pid, 1);
      const fm = makeFrames();
      for (let i = 0; i < 9; i++) {
        const appended = await spoolD.appendBatch(pid, [fm.create(`nM${i}`)]);   // walSeq 1..9 → 两轮（8+1）
        await spoolD.noteApplied(pid, appended[0].walSeq);   // actor 管线形态（append→apply→noteApplied）
      }
      const actorD = new CollabProjectActorService(spoolD, repo, undefined, observer);
      const loads = vi.spyOn(repo, 'loadForHydration');
      const r = await spoolD.replayAll(repo, {
        projectIds: [pid],
        lifecycleObserver: observer,
        deriveLifecycleFrames: deriveViaActor(actorD),
        lifecyclePersist: (tx: import('@prisma/client').Prisma.TransactionClient, p: string, frames: never) => observer.persistFramesInTx(tx, p, frames),
      } as never);
      const loadCount = loads.mock.calls.filter((c) => c[0] === pid).length;   // 先取数再 restore（restore 清 calls）
      loads.mockRestore();
      expect(r.replayed).toBe(9);
      expect(loadCount, '单次 replayAll 调用内 loadForHydration 恰一次（修前=每轮一次≥2——M-b O(R²)）').toBe(1);
    } finally {
      await wipeLifecycleRows(pid);
      await cleanupProjectFixture(prisma, pid);
      await segDir.cleanup();
    }
  }, 30_000);

  it('红（M-b 保全）：appendBatch 首试（批）失败→重试轮 effects 非空且落库（失败/重试轮基线不前进——修前=重试轮 stale-only：帧落 PG 而派生零行=首试效果永久丢）', async () => {
    const observer = new CollabLifecycleObserverService(prisma as never);
    const pid = `t27memo2-${Date.now()}`;
    await ensureProjectFixture(prisma, pid);
    const segDir = await makeSpoolDir('y1c-t27-memo2-');
    try {
      await seedDocRow(pid);
      await wipeLifecycleRows(pid);
      const spoolD = new CollabSpoolService(segDir.dir);
      spoolD.setOwner('t27-memo2-owner');
      spoolD.setProjectGeneration(pid, 1);
      const fm = makeFrames();
      const appended2 = await spoolD.appendBatch(pid, [fm.create('nP1'), fm.create('nP2')]);   // 单轮批（2 帧）
      for (const a of appended2) await spoolD.noteApplied(pid, a.walSeq);   // actor 管线形态（append→apply→noteApplied）
      const actorD = new CollabProjectActorService(spoolD, repo, undefined, observer);
      // PG 瞬断形态：首轮批 appendBatch reject → per-frame 重试（X8 重试环）——重试轮须携派生 persist
      const realAppend = repo.appendBatch.bind(repo);
      const appendSpy = vi.spyOn(repo, 'appendBatch').mockImplementation((async (p: string, rows: ReadonlyArray<{ lastWalSeq: bigint }>, wm: unknown, inTx: unknown) => {
        if (rows.length > 1) throw Object.assign(new Error('pg blip'), { code: 'P1001' });
        return realAppend(p, rows as never, wm as never, inTx as never);
      }) as never);
      const r = await spoolD.replayAll(repo, {
        projectIds: [pid],
        lifecycleObserver: observer,
        deriveLifecycleFrames: deriveViaActor(actorD),
        lifecyclePersist: (tx: import('@prisma/client').Prisma.TransactionClient, p: string, frames: never) => observer.persistFramesInTx(tx, p, frames),
      } as never);
      appendSpy.mockRestore();
      expect(r.replayed).toBe(2);
      expect(r.failed).toBe(0);
      // ★ 重试轮派生落库（红=修前重试轮 stale-only：NodeLifecycle 零行=首试 effects 永久丢）
      const rows = await prisma.nodeLifecycle.findMany({ where: { projectId: pid, nodeId: { in: ['nP1', 'nP2'] } } });
      expect(rows.length, '重试轮 effects 非空且落库（基线不前进——修前=零行）').toBe(2);
      expect(rows.every((x) => x.state === 'ACTIVE' && x.isCurrent)).toBe(true);
    } finally {
      await wipeLifecycleRows(pid);
      await cleanupProjectFixture(prisma, pid);
      await segDir.cleanup();
    }
  }, 30_000);
});
