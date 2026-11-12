// apps/api/src/modules/collab/media-binding-oracle-contract.int.spec.ts
// C3a-9（plan v3 Task C3a-9——spec 2026-11-11-foundation-batch-design.md §3.2-8「对拍契约」）：
// **binding@mediaBindingSeq == oracle(doc@pgSeq)** 独立对拍契约（真 PG+真生产帧管线）。核心纪律：
//   · oracle=本文件内**独立递归实现**（Y.Map/Y.Array/Y.Text/XmlElement/XmlText 全容器遍历+自持字面键表）
//     ——禁止 import 生产扫描单源（collectMediaRefs/collectMediaRefsForNode/MEDIA_REF_TARGET_FIELDS），
//     与生产实现零共享（对拍才具证明力；契约断言因人为改一行 binding 而红=变异自证，见契约⑦）。
//   · 场景=真 actor.submit 帧管线（复用 media-binding-projector.int.spec 夹具）→flushThrough 落 PG→
//     读 CanvasDoc(G,S=mediaBindingSeq)→repository.loadForHydrationAt(pid,{generation:G,pgSeq:S}) 定代
//     重放 doc@S→oracle 槽位集→与 DB MediaBinding 行集（五元组+mediaId）排序后严格相等。
//   · 场景后 dirty/lag 先经 BindingRebuildService 收敛（§0 水位不变量：仅 rebuild 清 dirty+推水位），
//     并同时断言收敛后 dirty=false ∧ mediaBindingSeq==pgSeq。
// 覆盖（§3.2-8 映射表缺口直测）：数组-only 帧 append/remove/replace/reorder、root update
// `nodes.set(existingId,newMap)`、`set('data',newMap)` 整替换、node delete+re-add、undo 真链
// （Y.UndoManager）、DELETING 媒体 doc 帧引用照写、帧1加M已 flush/帧2删M未落（kill -9 等价态：
// 物理 WAL 恢复语义由 collab-t13-kill9.process.spec 锁定，本处锁 PG 前缀 binding/doc 一致性）、
// rebuild×append 交错 100 次（CAS 失败 dirty 保持）、固定种子 50 节点 property-ish。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';
import { CollabProjectActorService, type BindingDelta } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { BindingRebuildService } from './binding-rebuild.service';
import { projectBindings } from './media-binding-projector';
import { ensureProjectFixture, cleanupProjectFixture, ensureLeaseFixture, restoreLeaseRow, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { seedRow } from '../../test-utils/canvas-doc-row';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'c3a9-oracle-contract';
const PID_LOOP = 'c3a9-oracle-loop';
const PID_DIRECT = 'c3a9-oracle-direct';

/** 媒体桶（ACTIVE 池+DELETING 单件——契约域只含「照写」媒体：missing/跨队/软删=skip 语义归投影器测试）。 */
const MEDIA = {
  m1: 'c3a9-media-1',
  m2: 'c3a9-media-2',
  m3: 'c3a9-media-3',
  m4: 'c3a9-media-4',
  mdel: 'c3a9-media-deleting',
  pool: Array.from({ length: 16 }, (_, i) => `c3a9-media-pool-${i}`),
} as const;
const ALL_MEDIA = [MEDIA.m1, MEDIA.m2, MEDIA.m3, MEDIA.m4, MEDIA.mdel, ...MEDIA.pool];

// ═══════════ 独立 oracle（测试专用——零生产扫描单源 import）═══════════
// 字面键表独立复制（不与 shared MEDIA_REF_TARGET_FIELDS 共享）；递归遍历全部 Yjs 容器+plain JSON
// 容器；输出槽位集（nodeId/role='primary'/targetField/targetItemId/mediaId）。

const ORACLE_SCALAR_KEYS = ['fileId', 'referenceImage', 'referenceVideo', 'referenceAudio', 'trimmedFileId', 'videoFileId', 'audioFileId'] as const;
const ORACLE_LIST_KEYS = ['images', 'allImages'] as const;

interface OracleSlot {
  nodeId: string;
  role: 'primary';
  targetField: string;
  targetItemId: string;
  mediaId: string;
}

/** 槽位行比较线（nodeId/role/targetField/targetItemId/mediaId——DB 行与 oracle 槽共用）。 */
const slotLine = (s: { nodeId: string; role: string; targetField: string; targetItemId: string; mediaId: string }): string =>
  `${s.nodeId}\u0000${s.role}\u0000${s.targetField}\u0000${s.targetItemId}\u0000${s.mediaId}`;

/** 列表槽值收敛（Y.Array/plain array 两形态——其它形态=无列表项）。 */
function oracleListItems(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v instanceof Y.Array) return v.toArray();
  return [];
}

/** 列表项 id（Y.Map 或 plain object 的 string id——空串/sentinel 不产槽）。 */
function oracleItemId(v: unknown): string | null {
  if (v instanceof Y.Map) {
    const id = v.get('id');
    return typeof id === 'string' && id !== '' ? id : null;
  }
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const id = (v as { id?: unknown }).id;
    return typeof id === 'string' && id !== '' ? id : null;
  }
  return null;
}

/** 递归扫描 doc 全 nodes 树→槽位集（Map 按槽位键去重——集合语义）。 */
function oracleSlotsOfDoc(doc: Y.Doc): OracleSlot[] {
  const out = new Map<string, OracleSlot>();
  const seen = new WeakSet<object>();
  const add = (s: OracleSlot): void => { out.set(slotLine(s), s); };
  const visitKey = (nodeId: string, key: string, value: unknown, depth: number): void => {
    if ((ORACLE_SCALAR_KEYS as readonly string[]).includes(key)) {
      if (typeof value === 'string' && value !== '') {
        add({ nodeId, role: 'primary', targetField: key, targetItemId: '', mediaId: value });
      }
      return;   // 标量槽：非 string 值（null/容器）=非引用（生产同语义）
    }
    if ((ORACLE_LIST_KEYS as readonly string[]).includes(key)) {
      for (const item of oracleListItems(value)) {
        const id = oracleItemId(item);
        if (id !== null) add({ nodeId, role: 'primary', targetField: key, targetItemId: id, mediaId: id });
      }
      return;   // 列表槽：item 内部不再递归（列表项={id,...} 载体，非引用映射域）
    }
    walk(nodeId, value, depth + 1);
  };
  const walk = (nodeId: string, value: unknown, depth: number): void => {
    if (value === null || typeof value !== 'object' || depth > 32) return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (value instanceof Y.Map) {
      for (const [k, v] of value.entries()) visitKey(nodeId, k, v, depth);
      return;
    }
    if (value instanceof Y.Array) {
      for (const item of value.toArray()) walk(nodeId, item, depth + 1);
      return;
    }
    if (value instanceof Y.Text) return;   // 文本叶（Y.XmlText 同为 Text 子类）
    if (value instanceof Y.XmlElement || value instanceof Y.XmlFragment) {
      for (const child of value.toArray()) walk(nodeId, child, depth + 1);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(nodeId, item, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(value)) visitKey(nodeId, k, v, depth);   // plain JSON 容器
  };
  for (const [nodeId, entry] of doc.getMap('nodes').entries()) walk(nodeId, entry, 0);
  return [...out.values()];
}

// ═══════════ 装置（真 PG+真 actor 帧管线）═══════════

const UNDO_ORIGIN = Symbol('c3a9-undo-origin');

/** 确定性 PRNG（fixed seed property-ish——零新依赖）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 节点构造（信封 type+position+data——actor 准入矩阵合法键）。 */
function putNode(src: Y.Doc, id: string, type: string, dataEntries: Record<string, unknown>): void {
  const node = new Y.Map<unknown>();
  node.set('type', type);
  const pos = new Y.Map<unknown>();
  pos.set('x', 0);
  pos.set('y', 0);
  node.set('position', pos);
  const data = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(dataEntries)) data.set(k, v);
  node.set('data', data);
  (src.getMap('nodes') as Y.Map<unknown>).set(id, node);
}

function yArray(items: unknown[]): Y.Array<unknown> {
  const arr = new Y.Array<unknown>();
  arr.push(items);
  return arr;
}

const nodeOf = (doc: Y.Doc, id: string): Y.Map<unknown> => doc.getMap('nodes').get(id) as Y.Map<unknown>;
const dataOf = (doc: Y.Doc, id: string): Y.Map<unknown> => nodeOf(doc, id).get('data') as Y.Map<unknown>;

/** 媒体引用帧（repo.appendBatch 直供——交错/崩溃场景的 PG 前缀载体，绕过 actor 准入）。 */
function mediaFrame(nodeId: string, mediaId: string): Uint8Array {
  const d = new Y.Doc();
  try {
    const node = new Y.Map<unknown>();
    const data = new Y.Map<unknown>();
    data.set('fileId', mediaId);
    node.set('type', 'imageGen');
    node.set('data', data);
    (d.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
    return Y.encodeStateAsUpdate(d);
  } finally { d.destroy(); }
}

maybe('C3a-9：binding@mediaBindingSeq == oracle(doc@pgSeq) 独立对拍契约（真 PG）', () => {
  const prisma = new PrismaClient();
  const repo = new CanvasDocUpdateRepository(prisma as never);
  const rebuild = new BindingRebuildService(prisma as never, repo as never);
  let dir: { dir: string; cleanup: () => Promise<void> };
  let actor: CollabProjectActorService;
  let serverDoc: Y.Doc;
  let submitSeq = 0;

  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID);
    await ensureProjectFixture(prisma, PID_LOOP);
    await ensureProjectFixture(prisma, PID_DIRECT);
    for (const pid of [PID, PID_LOOP, PID_DIRECT]) {
      await prisma.mediaBinding.deleteMany({ where: { projectId: pid } });
      await prisma.projectionBackfillState.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
    }
    await prisma.media.deleteMany({ where: { id: { in: ALL_MEDIA } } });
    for (const id of ALL_MEDIA) {
      await prisma.media.create({
        data: { id, userId: FIXTURE_USER, teamId: FIXTURE_TEAM, key: `c3a9/${id}`, originalName: `${id}.png`, mimeType: 'image/png', size: 1n, type: 'uploaded' },
      });
    }
    // DELETING 形态（deletedAt≠null ∧ DELETING——投影预检序照写面）
    await prisma.media.update({ where: { id: MEDIA.mdel }, data: { deletionState: 'DELETING', deletedAt: new Date() } });
    for (const pid of [PID, PID_LOOP, PID_DIRECT]) {
      await prisma.canvasDoc.create({
        data: { projectId: pid, generation: 1, schemaVersion: 3, pgSeq: 0n, walCheckpointSeq: 0n, mediaBindingSeq: 0n, bindingsDirty: false },
      });
    }
    await ensureLeaseFixture(prisma, repo);
    dir = await makeSpoolDir('c3a9-oracle-');
    const spool = new CollabSpoolService(dir.dir);
    spool.setOwner('c3a9-oracle-owner');
    spool.setWalHistory('c3a9-oracle-history');
    serverDoc = new Y.Doc();
    const documents = new Map<string, Y.Doc>([[`project:${PID}`, serverDoc]]);
    actor = new CollabProjectActorService(spool as never, repo as never);
    (actor as unknown as { bindHost(h: unknown): void }).bindHost({
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn(), fatal: vi.fn(), localInstance: true },
      documents: () => documents,
      hardClose: () => {},
      isQuotaFrozen: () => false,
      generationOf: () => 0,
      noteReadOnlyDrop: () => false,
      onFencedByWrite: async () => {},
    } as never);
  }, 60_000);

  afterAll(async () => {
    serverDoc?.destroy();
    for (const pid of [PID, PID_LOOP, PID_DIRECT]) {
      await prisma.mediaBinding.deleteMany({ where: { projectId: pid } });
      await prisma.projectionBackfillState.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocUpdate.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDocSnapshot.deleteMany({ where: { projectId: pid } });
      await prisma.canvasDoc.deleteMany({ where: { projectId: pid } });
    }
    await prisma.media.deleteMany({ where: { id: { in: ALL_MEDIA } } });
    await restoreLeaseRow(prisma);
    await cleanupProjectFixture(prisma, PID);
    await cleanupProjectFixture(prisma, PID_LOOP);
    await cleanupProjectFixture(prisma, PID_DIRECT);
    if (dir) await dir.cleanup();
    await prisma.$disconnect();
  }, 60_000);

  /** 客户端帧构造：应用服务器当前全量态→事务内变异→只取增量 update（binding-delta.spec 同款）。 */
  function frameOf(mutate: (src: Y.Doc) => void): Uint8Array {
    const src = new Y.Doc();
    try {
      Y.applyUpdate(src, Y.encodeStateAsUpdate(serverDoc));
      const ups: Uint8Array[] = [];
      src.on('update', (u: Uint8Array) => { ups.push(u); });
      src.transact(() => { mutate(src); });
      return Y.mergeUpdates(ups);
    } finally { src.destroy(); }
  }

  /** 真 actor.submit+flushThrough（PG 前缀落定判据——walSeq 已提交）。 */
  async function submitFrame(frame: Uint8Array, label: string): Promise<bigint> {
    const conn = { socketId: `c3a9-${label}-${++submitSeq}`, readOnly: false, sendStateless: vi.fn() } as never;
    const r = await actor.submit(PID, frame, conn, 'update');
    const flushed = await actor.flushThrough(PID, r.walSeq, { maxWaitMs: 15_000 });
    expect(flushed.targetReached, `${label}：PG flush 未落定（walSeq=${r.walSeq}）`).toBe(true);
    return r.walSeq;
  }

  /** 直供帧+生产 flush 闭包同形态（SAVEPOINT→projectBindings→RELEASE）——覆盖 actor 准入门结构性
   *  拒绝的事件形态（`set('data',newMap)`=L2 container-replacement 4411：容器替换 DENY 面是生产规则；
   *  该帧形态的 delta 采集语义已由 binding-delta.spec ③ 锁定，本处补投影+水位+契约端到端）。 */
  async function appendWithProjection(pid: string, frame: Uint8Array, seq: bigint, expectedPgSeq: bigint, delta: BindingDelta): Promise<void> {
    const teamId = (await prisma.canvasProject.findUniqueOrThrow({ where: { id: pid }, select: { teamId: true } })).teamId;
    const r = await repo.appendBatch(pid, [seedRow(frame, seq)], { expectedPgSeq, newPgSeq: seq, walCheckpointSeq: seq }, async (tx) => {
      await tx.$executeRaw`SAVEPOINT media_binding_projection`;
      try {
        await projectBindings(tx, pid, teamId, delta);
        await tx.$executeRaw`RELEASE SAVEPOINT media_binding_projection`;
        return { bindingCovered: true };
      } catch {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT media_binding_projection`;
        await tx.canvasDoc.updateMany({ where: { projectId: pid }, data: { bindingsDirty: true } });
        return { bindingCovered: false };
      }
    });
    expect(r).toEqual({ ok: true, rows: 1 });
  }

  /** 契约对拍（返回 expected/actual——变异自证与常规断言共用；dirty/lag 先 rebuild 收敛）。 */
  async function contractDiffOf(pid: string): Promise<{ expected: string[]; actual: string[]; watermark: { generation: number; pgSeq: bigint; mediaBindingSeq: bigint; bindingsDirty: boolean } }> {
    let wm = await prisma.canvasDoc.findUniqueOrThrow({
      where: { projectId: pid },
      select: { generation: true, pgSeq: true, mediaBindingSeq: true, bindingsDirty: true },
    });
    if (wm.bindingsDirty || wm.mediaBindingSeq < wm.pgSeq) {
      const r = await rebuild.rebuildProjectBindings(pid);
      expect(r.outcome, `${pid}：dirty/lag 收敛 rebuild 应 cleared（实际 ${r.outcome}）`).toBe('cleared');
      wm = await prisma.canvasDoc.findUniqueOrThrow({
        where: { projectId: pid },
        select: { generation: true, pgSeq: true, mediaBindingSeq: true, bindingsDirty: true },
      });
    }
    expect(wm.bindingsDirty, `${pid}：收敛后 dirty=false`).toBe(false);
    expect(wm.mediaBindingSeq, `${pid}：收敛后 mediaBindingSeq==pgSeq`).toBe(wm.pgSeq);
    const at = await repo.loadForHydrationAt(pid, { generation: wm.generation, pgSeq: wm.mediaBindingSeq });
    const doc = new Y.Doc();
    try {
      if (at.state) Y.applyUpdate(doc, new Uint8Array(at.state));
      for (const u of at.updates) Y.applyUpdate(doc, new Uint8Array(u));
      const expected = oracleSlotsOfDoc(doc).map(slotLine).sort();
      const rows = await prisma.mediaBinding.findMany({ where: { projectId: pid } });
      const actual = rows.map(slotLine).sort();
      return { expected, actual, watermark: wm };
    } finally { doc.destroy(); }
  }

  async function assertContract(pid: string, label: string): Promise<void> {
    const d = await contractDiffOf(pid);
    expect(d.actual, `${label}：binding@${d.watermark.mediaBindingSeq} == oracle(doc@${d.watermark.pgSeq})`).toEqual(d.expected);
  }

  // ── 契约①：数组-only 帧四形（append/remove/replace/reorder）──
  it('契约①：数组-only 帧 append/remove/replace/reorder→逐帧 binding==oracle', async () => {
    await submitFrame(frameOf((src) => {
      putNode(src, 'arr-n', 'multiImageGen', { label: 'arr', images: yArray([{ id: MEDIA.m1 }, { id: MEDIA.m2 }]) });
    }), 'arr-seed');
    await assertContract(PID, '数组 seed');

    await submitFrame(frameOf((src) => {
      (dataOf(src, 'arr-n').get('images') as Y.Array<unknown>).push([{ id: MEDIA.m3 }]);
    }), 'arr-append');
    await assertContract(PID, '数组 append');

    await submitFrame(frameOf((src) => {
      (dataOf(src, 'arr-n').get('images') as Y.Array<unknown>).delete(0, 1);
    }), 'arr-remove');
    await assertContract(PID, '数组 remove');

    await submitFrame(frameOf((src) => {
      const arr = dataOf(src, 'arr-n').get('images') as Y.Array<unknown>;
      arr.delete(0, 1);
      arr.insert(0, [{ id: MEDIA.m4 }]);
    }), 'arr-replace');
    await assertContract(PID, '数组 replace');

    await submitFrame(frameOf((src) => {
      const arr = dataOf(src, 'arr-n').get('images') as Y.Array<unknown>;
      const first = arr.get(0);
      arr.delete(0, 1);
      arr.push([first]);
    }), 'arr-reorder');
    await assertContract(PID, '数组 reorder');
    const liveOrder = (dataOf(serverDoc, 'arr-n').get('images') as Y.Array<unknown>).toArray().map((x) => (x as { id: string }).id);
    expect(liveOrder, 'reorder 后序变集合不变（[M4,M3]→[M3,M4]）').toEqual([MEDIA.m3, MEDIA.m4]);
  }, 60_000);

  // ── 契约②：root update / node delete+re-add ──
  it('契约②：nodes.set(existingId,newMap)/node delete+re-add→逐帧 binding==oracle', async () => {
    await submitFrame(frameOf((src) => putNode(src, 'root-n', 'imageGen', { referenceImage: MEDIA.m1 })), 'root-seed');
    await assertContract(PID, 'root seed');

    await submitFrame(frameOf((src) => putNode(src, 'root-n', 'imageGen', { referenceImage: MEDIA.m2 })), 'root-update');
    await assertContract(PID, 'root update');

    await submitFrame(frameOf((src) => { src.getMap('nodes').delete('root-n'); }), 'node-delete');
    await assertContract(PID, 'node delete');

    await submitFrame(frameOf((src) => putNode(src, 'root-n', 'imageGen', { referenceImage: MEDIA.m4 })), 'node-readd');
    await assertContract(PID, 'node re-add');
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'root-n', mediaId: MEDIA.m4 } })).toBe(1);
  }, 60_000);

  // ── 契约②b：set('data',newMap) 整替换（actor 准入门 4411 拒容器替换——生产 flush 闭包同形态直供）──
  it('契约②b：set(\'data\',newMap) 整替换→binding==oracle（终态快照=替换后引用集）', async () => {
    const baseDoc = new Y.Doc();
    let baseFrame: Uint8Array;
    try {
      putNode(baseDoc, 'data-n', 'imageGen', { referenceImage: MEDIA.m1 });
      baseFrame = Y.encodeStateAsUpdate(baseDoc);
    } finally { baseDoc.destroy(); }
    const baseDelta: BindingDelta = new Map([['data-n', [
      { nodeId: 'data-n', mediaId: MEDIA.m1, role: 'primary' as const, targetField: 'referenceImage' as const, targetItemId: '' },
    ]]]);
    await appendWithProjection(PID_DIRECT, baseFrame, 1n, 0n, baseDelta);   // 基帧投影→水位 1（连续前缀）

    const replDoc = new Y.Doc();
    let replFrame: Uint8Array;
    try {
      Y.applyUpdate(replDoc, baseFrame);
      const ups: Uint8Array[] = [];
      replDoc.on('update', (u: Uint8Array) => { ups.push(u); });
      replDoc.transact(() => {
        const node = nodeOf(replDoc, 'data-n');
        const data = new Y.Map<unknown>();
        data.set('referenceImage', MEDIA.m2);
        data.set('allImages', yArray([{ id: MEDIA.m1 }, { id: MEDIA.m3 }]));
        node.set('data', data);
      });
      replFrame = Y.mergeUpdates(ups);
    } finally { replDoc.destroy(); }
    // delta=替换后终态引用集（production 帧边界快照语义——collector 面由 binding-delta.spec ③ 锁定）
    const delta: BindingDelta = new Map([['data-n', [
      { nodeId: 'data-n', mediaId: MEDIA.m2, role: 'primary' as const, targetField: 'referenceImage' as const, targetItemId: '' },
      { nodeId: 'data-n', mediaId: MEDIA.m1, role: 'primary' as const, targetField: 'allImages' as const, targetItemId: MEDIA.m1 },
      { nodeId: 'data-n', mediaId: MEDIA.m3, role: 'primary' as const, targetField: 'allImages' as const, targetItemId: MEDIA.m3 },
    ]]]);
    await appendWithProjection(PID_DIRECT, replFrame, 2n, 1n, delta);
    await assertContract(PID_DIRECT, 'set(data,newMap)');
  }, 60_000);

  // ── 契约③：undo 真链（Y.UndoManager 产生真 undo 帧→binding 回退到 oracle 终态）──
  it('契约③：undo 真链（Y.UndoManager）→binding==oracle（M2 写入后 undo 回 M1）', async () => {
    await submitFrame(frameOf((src) => putNode(src, 'undo-n', 'imageGen', { referenceImage: MEDIA.m1 })), 'undo-seed');
    await assertContract(PID, 'undo seed');

    const client = new Y.Doc();
    const um = new Y.UndoManager(client.getMap('nodes'), { trackedOrigins: new Set<unknown>([UNDO_ORIGIN]), captureTimeout: 0 });
    try {
      Y.applyUpdate(client, Y.encodeStateAsUpdate(serverDoc));
      const capture = (fn: () => void): Uint8Array => {
        const ups: Uint8Array[] = [];
        const h = (u: Uint8Array): void => { ups.push(u); };
        client.on('update', h);
        try { fn(); } finally { client.off('update', h); }
        return Y.mergeUpdates(ups);
      };
      um.stopCapturing();
      const setFrame = capture(() => {
        client.transact(() => {
          const data = (client.getMap('nodes').get('undo-n') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
          data.set('referenceImage', MEDIA.m2);
        }, UNDO_ORIGIN);
      });
      await submitFrame(setFrame, 'undo-set-m2');
      await assertContract(PID, 'undo set M2');

      const undoFrame = capture(() => { um.undo(); });
      expect(undoFrame.byteLength, 'undo 必产增量帧').toBeGreaterThan(0);
      await submitFrame(undoFrame, 'undo-revert');
      await assertContract(PID, 'undo revert M1');
      expect(dataOf(serverDoc, 'undo-n').get('referenceImage'), 'undo 后 live doc 引用回 M1').toBe(MEDIA.m1);
    } finally {
      um.destroy();
      client.destroy();
    }
  }, 60_000);

  // ── 契约④：DELETING 媒体 doc 帧引用→binding 照写（C3b recheck 可见）──
  it('契约④：DELETING 媒体 doc 帧引用→binding 照写+契约成立（预检序 DELETING 优先于软删）', async () => {
    await submitFrame(frameOf((src) => putNode(src, 'del-n', 'audioGen', { referenceAudio: MEDIA.mdel })), 'deleting-media');
    await assertContract(PID, 'DELETING media');
    const row = await prisma.mediaBinding.findFirst({
      where: { projectId: PID, nodeId: 'del-n', targetField: 'referenceAudio', mediaId: MEDIA.mdel },
    });
    expect(row, 'DELETING 媒体 doc 帧引用照写 binding（deletedAt≠null 亦写）').not.toBeNull();
    expect((await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID }, select: { bindingsDirty: true } })).bindingsDirty).toBe(false);
  }, 60_000);

  // ── 契约⑤：帧1加M已 flush/帧2删M未落（kill -9 等价态）→PG doc 有 M∧binding 有 M ──
  it('契约⑤：帧1加M已 flush/帧2删M未落（kill -9 等价态）→PG doc 有 M∧binding 有 M+契约', async () => {
    await submitFrame(frameOf((src) => putNode(src, 'crash-n', 'imageGen', { referenceImage: MEDIA.m1 })), 'crash-add');
    await assertContract(PID, 'crash frame1 flushed');
    // 帧2（删 M）**不提交**=崩溃窗丢失面：物理 kill 的 WAL 恢复语义由 collab-t13-kill9.process.spec
    // 锁定；本处锁 PG 前缀语义——重启后 doc@pgSeq 只含帧1，binding 只反映帧1（帧2 若到达会删节点）。
    const lostFrame = frameOf((src) => { src.getMap('nodes').delete('crash-n'); });
    const replay = new Y.Doc();
    try {
      Y.applyUpdate(replay, Y.encodeStateAsUpdate(serverDoc));
      Y.applyUpdate(replay, lostFrame);
      expect(replay.getMap('nodes').has('crash-n'), '丢失帧若被应用将删节点（帧形态有效）').toBe(false);
    } finally { replay.destroy(); }
    const wm = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID }, select: { generation: true, pgSeq: true } });
    const doc = new Y.Doc();
    try {
      const at = await repo.loadForHydrationAt(PID, { generation: wm.generation, pgSeq: wm.pgSeq });
      if (at.state) Y.applyUpdate(doc, new Uint8Array(at.state));
      for (const u of at.updates) Y.applyUpdate(doc, new Uint8Array(u));
      expect(doc.getMap('nodes').has('crash-n'), 'PG doc@pgSeq 有 crash-n（帧2 未落）').toBe(true);
      expect((dataOf(doc, 'crash-n').get('referenceImage'))).toBe(MEDIA.m1);
      expect(oracleSlotsOfDoc(doc).some((s) => s.nodeId === 'crash-n' && s.mediaId === MEDIA.m1), 'oracle(doc@pgSeq) 含 M').toBe(true);
    } finally { doc.destroy(); }
    expect(await prisma.mediaBinding.count({ where: { projectId: PID, nodeId: 'crash-n', mediaId: MEDIA.m1 } }), 'binding 有 M').toBe(1);
    await assertContract(PID, 'crash prefix');
  }, 60_000);

  // ── 契约⑥：rebuild×append 交错 100 次（CAS 失败 dirty 保持——不跳 gap）──
  it('契约⑥：rebuild×append 交错 100 次——CAS 失败 dirty 保持；收敛后契约成立', async () => {
    let seq = 0n;
    for (let i = 0; i < 100; i++) {
      const prev = seq;
      await repo.appendBatch(PID_LOOP, [seedRow(mediaFrame(`loop-a-${i}`, MEDIA.m1), ++seq)], { expectedPgSeq: prev, newPgSeq: seq, walCheckpointSeq: seq });
      const anchor = await rebuild.snapshotAnchor(PID_LOOP);
      expect(anchor, `第 ${i} 轮 anchor 存在`).not.toBeNull();
      // rebuild 读 (G,S) 后并发 append（pgSeq 前进）→CAS 四条件 pgSeq 门失败
      await repo.appendBatch(PID_LOOP, [seedRow(mediaFrame(`loop-b-${i}`, MEDIA.m2), ++seq)], { expectedPgSeq: seq - 1n, newPgSeq: seq, walCheckpointSeq: seq });
      await rebuild.writeBindingsAt(PID_LOOP, anchor!);
      const miss = await rebuild.commitByCas(PID_LOOP, anchor!);
      expect(miss.outcome, `第 ${i} 轮 CAS 应 miss（写点后 append 移动 pgSeq）`).toBe('cas-miss');
      const s = await prisma.canvasDoc.findUniqueOrThrow({
        where: { projectId: PID_LOOP },
        select: { pgSeq: true, mediaBindingSeq: true, bindingsDirty: true },
      });
      expect(s.bindingsDirty, `第 ${i} 轮 CAS 失败 dirty 保持`).toBe(true);
      expect(s.mediaBindingSeq, `第 ${i} 轮 binding 水位不跳 gap`).toBe(0n);
    }
    const done = await rebuild.rebuildProjectBindings(PID_LOOP);
    expect(done).toMatchObject({ outcome: 'cleared', pgSeq: seq });
    await assertContract(PID_LOOP, '交错 100 次收敛');
  }, 120_000);

  // ── 契约⑦：变异自证（插入/删除一行 binding→契约断言必红；复原→绿）──
  it('契约⑦：变异自证——人为插入/删除一行 binding→契约断言必红；复原→绿', async () => {
    const baseline = await contractDiffOf(PID);
    expect(baseline.actual, '基线契约绿').toEqual(baseline.expected);
    const ghost = await prisma.mediaBinding.create({
      data: { mediaId: MEDIA.m1, projectId: PID, nodeId: 'mutation-ghost', teamId: FIXTURE_TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' },
    });
    try {
      const inserted = await contractDiffOf(PID);
      expect(inserted.actual, '人为插入一行（extra）→契约必红').not.toEqual(inserted.expected);
      expect(inserted.actual.length).toBe(inserted.expected.length + 1);
    } finally {
      await prisma.mediaBinding.delete({ where: { id: ghost.id } });
    }
    const afterGhost = await contractDiffOf(PID);
    expect(afterGhost.actual, '删回 ghost→契约复原绿').toEqual(afterGhost.expected);

    const victim = await prisma.mediaBinding.findFirstOrThrow({ where: { projectId: PID } });
    const saved = { ...victim };
    await prisma.mediaBinding.delete({ where: { id: victim.id } });
    try {
      const deleted = await contractDiffOf(PID);
      expect(deleted.actual, '人为删除一行（missing）→契约必红').not.toEqual(deleted.expected);
      expect(deleted.actual.length).toBe(deleted.expected.length - 1);
    } finally {
      await prisma.mediaBinding.create({
        data: {
          id: saved.id, mediaId: saved.mediaId, projectId: saved.projectId, nodeId: saved.nodeId, teamId: saved.teamId,
          role: saved.role, targetField: saved.targetField, targetItemId: saved.targetItemId, createdAt: saved.createdAt,
        },
      });
    }
    const restored = await contractDiffOf(PID);
    expect(restored.actual, '复原行→契约回绿').toEqual(restored.expected);
  }, 60_000);

  // ── 契约⑧：固定种子 property-ish（50 节点引用形态批量提交）──
  it('契约⑧：property-ish——固定种子 50 节点引用形态批量提交→契约成立', async () => {
    const rand = mulberry32(0xc3a9);
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
    const listOf = (n: number): Y.Array<unknown> => yArray(Array.from({ length: n }, () => ({ id: pick(MEDIA.pool) })));
    const nodes: Array<{ id: string; type: string; data: Record<string, unknown> }> = [];
    for (let i = 0; i < 50; i++) {
      const shape = pick(['imageGen', 'multiImageGen', 'videoGen', 'audioGen'] as const);
      const data: Record<string, unknown> = {};
      if (shape === 'imageGen') {
        data.referenceImage = pick(MEDIA.pool);
        if (rand() < 0.7) data.allImages = listOf(1 + Math.floor(rand() * 3));
      } else if (shape === 'multiImageGen') {
        data.images = listOf(1 + Math.floor(rand() * 3));
        data.label = `prop-${i}`;
      } else if (shape === 'videoGen') {
        data.referenceVideo = pick(MEDIA.pool);
        if (rand() < 0.5) data.trimmedFileId = pick(MEDIA.pool);
      } else {
        data.referenceAudio = pick(MEDIA.pool);
      }
      nodes.push({ id: `prop-${i}`, type: shape, data });
    }
    for (let b = 0; b < nodes.length; b += 10) {
      const chunk = nodes.slice(b, b + 10);
      await submitFrame(frameOf((src) => { for (const n of chunk) putNode(src, n.id, n.type, n.data); }), `prop-${b}`);
      await assertContract(PID, `property 批 ${b / 10}`);
    }
    const final = await contractDiffOf(PID);
    expect(final.actual.filter((line) => line.startsWith('prop-')).length, '50 节点引用槽位全部落 binding').toBeGreaterThanOrEqual(50);
  }, 120_000);
});
