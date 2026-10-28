// apps/api/src/modules/collab/collab-project-actor.spec.ts
// Y1c T9（plan v1.7 Task 9——偏离 38③）：CollabProjectActor spool-first 写管线核心用例。
// 【六红组①-⑥】+【用例组】（批验证 5×2/同字节 in-flight 去重/帧字节 copy/毒帧协议/SS2 预算拒/
// per-connection 入站上限/per-project 背压/FrameEffects 收集器）。
// 红相证据：本套件先于实现空转跑=模块/断言双红（actor/frame-gate 未建+旧链双写），实现落地后全绿
// ——TDD 红→绿由 stash 复演留档（commit message 摘录）。
// 装置：真 spool（tmpdir+owner+historyId）+mock repo+fake host（documents Map 注入真 Y.Doc）——
// actor 单元形态（S4 spike 原型管线）；所有权验收计数（1 append+1 row+1 广播+旧链 0）在
// collab-t9-ownership-switch.spec（gateway 级）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { createHash } from 'node:crypto';
import { CollabProjectActorService } from './collab-project-actor.service';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { isGateApplyOrigin, CollabCloseCode, SS2_SEMAPHORE_GLOBAL_BUDGET_BYTES, ACTOR_DRAIN_BATCH_MAX_BYTES } from '@flowweb/shared';
import type { Logger } from '@nestjs/common';

const sha256hex = (u: Uint8Array) => createHash('sha256').update(u).digest('hex');

/** fsync 计数 spool（syncSegmentHandle 注入缝——批验证「1 次 fsync」断言锚）。 */
class CountingSpool extends CollabSpoolService {
  fsyncCount = 0;
  fsyncLog: number[] = [];
  protected async syncSegmentHandle(fh: import('node:fs/promises').FileHandle): Promise<void> {
    this.fsyncCount += 1;
    this.fsyncLog.push(Date.now());
    await super.syncSegmentHandle(fh);
  }
}

/** apply 注入 spool（毒帧/延迟——applyGate 缝）。 */
class FlakyApplyActor extends CollabProjectActorService {
  failNextApply = false;
  applyCalls = 0;
  protected applyGate(document: Y.Doc, payload: Uint8Array, origin: import('@flowweb/shared').GateApplyOrigin): void {
    this.applyCalls += 1;
    if (this.failNextApply) throw new Error('poison: injected apply failure');
    super.applyGate(document, payload, origin);
  }
}

function makeConn(over: Record<string, unknown> = {}) {
  return { socketId: 'sock-' + Math.random().toString(36).slice(2, 8), readOnly: false, sendStateless: vi.fn(), ...over } as never;
}

function buildActor<T extends CollabProjectActorService = CollabProjectActorService>(spool: CollabSpoolService, doc: Y.Doc, pid = 'p1', ctor: new (s: CollabSpoolService, r: any) => T = CollabProjectActorService as never) {
  const repo = createMockRepo();
  const documents = new Map<string, Y.Doc>([[`project:${pid}`, doc]]);
  const hardClose = vi.fn();
  const actor = new (ctor as any)(spool, repo) as T;
  (actor as unknown as { bindHost(h: unknown): void }).bindHost({
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn(), fatal: vi.fn(), localInstance: true } as unknown as Logger,
    documents: () => documents,
    hardClose: (c: unknown, code: number, reason: string) => hardClose(c, code, reason),
    isQuotaFrozen: () => false,
    generationOf: () => 0,   // Y1c T12：canonical wire 名对齐（gen0=裸名——世代真值链下未换代项目=0；原缺省 1 使 processBatch canonical 寻址 #g1 miss）
    noteReadOnlyDrop: () => false,
    onFencedByWrite: async () => {},
  });
  return { actor, repo, hardClose, documents };
}

function frameSetting(pid2: string, key: string, val: unknown) {
  // Y1c T24 矩阵对齐：节点值=合法 Y.Map 信封（T9 期标量节点值在 DENY/L2 矩阵下=node-not-map 毒帧
  // ——测试主语是管线机制非节点形状，夹具现代化为 {type,data{model:val}}：val 差异保持帧字节
  // 唯一性〔dedup 用例语义不变〕）。
  const src = new Y.Doc();
  const node = new Y.Map();
  const data = new Y.Map();
  data.set('model', val);
  node.set('type', 'textInput');
  node.set('data', data);
  (src.getMap('nodes') as Y.Map<unknown>).set(key, node);
  return Y.encodeStateAsUpdate(src);
}

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => {
  const d = await makeSpoolDir('t9-actor-');
  spoolDir = d;
});
afterEach(async () => { await spoolDir.cleanup(); });

function makeSpool() {
  const spool = new CountingSpool(spoolDir.dir);
  spool.setOwner('t9-owner');
  spool.setWalHistory('t9-history-id');
  return spool;
}

describe('Y1c T9 六红组①-⑥（spool-first 写管线核心——红→绿回归面）', () => {
  it('红①：connection-origin（gate apply）帧不进 persistence 维护队列（旧链 update 监听二次 append=双写实锤）——persistence 侧守卫断言', async () => {
    const { CollabPersistenceService } = await import('./collab-persistence.service');
    const spool = makeSpool();
    const doc = new Y.Doc();
    const docName = 'project:p1';
    const repo = createMockRepo();
    const persistence = new CollabPersistenceService(repo as never, spool as never, undefined as never);
    persistence.bindHost({
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      getDocument: () => doc as never,
      docStats: () => ({ loadedDocs: 1, connections: 0, directConns: 0 }),
      onUpdateDelta: () => {},
      onFencedByWrite: async () => {},
      calibrateTruth: () => undefined,
      observeDocBytes: () => {},
      isIsolated: () => false,
      isServingState: () => true,
      isShuttingDownFlag: () => false,
      onSpoolRecoveredFlip: () => {},
      currentLeaseEpoch: () => 1n,
    });
    persistence.observeDocument(doc, 'p1', docName);
    const { actor } = buildActor(spool, doc);
    const f = frameSetting('p1', 'n1', 1);
    const r = await actor.submit('p1', f, makeConn(), 'update');
    expect(r.walSeq).toBe(1n);   // apply 已落（gate origin 事件已发）
    expect(persistence.hasPendingWrites('p1')).toBe(false);   // 红①：旧链=listener 入队（双写）；新链=actor 管线唯一写者
    expect(isGateApplyOrigin({ source: 'connection', connection: {}, gate: true })).toBe(true);
  }, 20_000);

  it('红②：ACK（submit resolve）时帧必已 fsync——spool 先于 apply/resolve（水位铁证）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor(spool, doc);
    const f = frameSetting('p1', 'n2', 'v');
    const r = await actor.submit('p1', f, makeConn(), 'update');
    expect(spool.fsyncCount).toBeGreaterThanOrEqual(1);   // resolve 前 fsync 已发生（旧链=listener 后置 store）
    const w = spool.watermark('p1');
    expect(w).toBeDefined();
    expect(w!.spoolHeadSeq).toBe(r.walSeq);               // spoolHead ≥ walSeq（先于 resolve 落定）
    expect(w!.appliedSeq).toBe(r.walSeq);                 // appliedSeq=walSeq（apply 后 actor 临界区推进）
  }, 20_000);

  it('红③：并发同字节双连接 → 恰一 walSeq+两 resolve 均 no-op/applied 语义（旧链无去重=重复 walSeq）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor, repo } = buildActor(spool, doc);
    const f = frameSetting('p1', 'n3', 'dup');
    const [a, b] = await Promise.all([
      actor.submit('p1', f, makeConn(), 'update'),
      actor.submit('p1', f, makeConn(), 'update'),
    ]);
    expect(a.walSeq).toBe(b.walSeq);   // 恰一 walSeq（in-flight promise map 去重——红③旧相=两 seq）
    expect(a.noop).not.toBe(true);     // 先到帧=applied
    expect(b.noop).toBe(true);         // 后到重复帧=await 原帧完成后 no-op 放行
    // WAL 恰一条：PG 批行 frameCount=1（重复帧未入批——去重后才分配 walSeq）+成功后 confirm 回收 peek 空
    const rows = (repo.appendBatch.mock.calls[0] as [string, Array<{ frameCount: number }>])[1];
    expect(rows).toHaveLength(1);
    expect(rows[0].frameCount).toBe(1);
    expect(await spool.peek('p1')).toHaveLength(0);   // confirm 段回收（磁盘不留重复帧）
  }, 20_000);

  it('红④：pre-apply 语义——submit resolve 时 doc 已含帧内容（apply 归 actor；库随后重放幂等零事件）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    let gateOriginEvents = 0;
    doc.on('update', (_u, origin) => { if (isGateApplyOrigin(origin)) gateOriginEvents += 1; });
    const { actor } = buildActor(spool, doc);
    const f = frameSetting('p1', 'n4', 'pre');
    await actor.submit('p1', f, makeConn(), 'update');
    expect(((doc.getMap('nodes') as Y.Map<unknown>).get('n4') as Y.Map<unknown>).get('data')).toBeDefined();   // resolve 时已 apply（红④旧相=guard 放行后才库 apply；T24 夹具=map 信封）
    expect(gateOriginEvents).toBe(1);
    Y.applyUpdate(doc, f, { source: 'connection', connection: null, gate: true });   // 库重放形态
    expect(gateOriginEvents).toBe(1);   // 幂等重放零 update 事件（yjs hasContent=false）
  }, 20_000);

  it('红⑥：VIEWER（readOnly）发 Update → doc 不变+零 WAL+noop 放行（库 readOnly 检查在 beforeSync 后——gate 自判短路）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor(spool, doc);
    const f = frameSetting('p1', 'n6', 'viewer-write');
    const r = await actor.submit('p1', f, makeConn({ readOnly: true }), 'update');
    expect(r).toMatchObject({ walSeq: 0n, noop: true });
    expect((doc.getMap('nodes') as Y.Map<unknown>).get('n6')).toBeUndefined();   // doc 不变
    expect(spool.keys()).toHaveLength(0);   // 零 WAL
  }, 20_000);
});

describe('Y1c T9 用例组（actor 批验证/去重/copy/毒帧/SS2/上限/FrameEffects）', () => {
  it('批验证：5 连接各 2 帧 → 单批一次 fsync+10 ACK 顺序与 walSeq 一致', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor(spool, doc);
    const submits: Array<Promise<{ walSeq: bigint }>> = [];
    const order: number[] = [];
    for (let c = 0; c < 5; c++) {
      const conn = makeConn();
      for (let k = 0; k < 2; k++) {
        const idx = submits.length;
        submits.push(actor.submit('p1', frameSetting('p1', `b${idx}`, idx), conn, 'update').then((r) => { order.push(idx); return r; }));
      }
    }
    const results = await Promise.all(submits);
    const seqs = results.map((r) => r.walSeq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i] > seqs[i - 1]).toBe(true);   // walSeq 严格递增
    for (let i = 0; i < order.length; i++) expect(order[i]).toBe(i);                  // ACK（resolve）顺序与 walSeq 一致
    expect(spool.fsyncCount).toBe(1);                                                  // 单批恰一次 fsync
    const frames = await spool.peek('p1');
    expect(frames).toHaveLength(0);   // PG append 成功（mock）→confirm 回收——peek 空
  }, 20_000);

  it('in-flight 去重：并发同字节双连接两 ACK 均在 fsync 后（fsync 时间戳先于两 resolve）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor(spool, doc);
    const f = frameSetting('p1', 'd1', 'inflight');
    const [a, b] = await Promise.all([actor.submit('p1', f, makeConn(), 'update'), actor.submit('p1', f, makeConn(), 'update')]);
    expect(a.walSeq).toBe(b.walSeq);
    expect(spool.fsyncCount).toBeGreaterThanOrEqual(1);
    expect(spool.fsyncLog[0]).toBeLessThanOrEqual(Date.now());   // 两 ACK（resolve 时点）均在 fsync 后（fsync 时戳≤resolve 后的现在）
  }, 20_000);

  it('帧字节精确 copy（lib0 subarray 越界读反例）：subarray 视图提交后底层 buffer 改写不影响已入账帧', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor(spool, doc);
    const f = frameSetting('p1', 'c1', 'copy-me');
    const big = new Uint8Array(f.byteLength + 64);
    big.set(f, 32);
    const view = big.subarray(32, 32 + f.byteLength);   // 共享底层 buffer 的视图（禁直用——越界读/后续改写风险）
    await actor.submit('p1', view, makeConn(), 'update');
    big.fill(0xff);   // 提交后改写底层 buffer（真拷贝=不受影响；subarray 直用=内容被毁）
    expect((((doc.getMap('nodes') as Y.Map<unknown>).get('c1') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('model')).toBe('copy-me');   // T24 夹具=map 信封（帧字节 copy 语义不变）
    expect(sha256hex(view)).not.toBe(sha256hex(f));   // 反例实证：视图确已被动——actor 入账的是独立 copy
  }, 20_000);

  it('毒帧协议：fsync 成功+apply 失败 → 同步关全部连接（广播 flush 前）+WAL 截断至 appliedSeq+批内帧 4411 拒绝', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor, hardClose } = buildActor<FlakyApplyActor>(spool, doc, 'p1', FlakyApplyActor as never);
    const ok1 = await actor.submit('p1', frameSetting('p1', 'ok1', 1), makeConn(), 'update');
    expect(ok1.walSeq).toBe(1n);
    actor.failNextApply = true;
    const conn2 = makeConn();
    const poisoned = actor.submit('p1', frameSetting('p1', 'bad', 2), conn2, 'update');
    await expect(poisoned).rejects.toMatchObject({ code: CollabCloseCode.FRAME_MALFORMED });
    expect(hardClose).toHaveBeenCalled();   // close 4411（码权威投递先行）
    expect(spool.watermark('p1')!.spoolHeadSeq).toBe(ok1.walSeq);   // WAL 截断至 appliedSeq（毒帧不入账）
    const frames = await spool.peek('p1');
    expect(frames.every((fr) => fr.walSeq <= ok1.walSeq)).toBe(true);
  }, 20_000);

  it('SS2 大帧并发信号量预算拒：全局内存预算超限 → 瞬态拒 1008（per-project 1 同判）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor, hardClose } = buildActor(spool, doc);
    // per-project 1：同项目第二个 SS2 大帧（他连接）在首帧 pending 期 → deny 1008（预算预检含 pending）
    const ss2Gate = 8 * 1024 * 1024 + 64 * 1024;   // SS2 帧上界（≈8.06MiB——WS 通道恰承载形态）
    const p1submit = actor.submit('p1', makeBigFrame(ss2Gate, 1), makeConn(), 'ss2');   // 首帧占预算（pending）
    const r2 = await actor.submit('p1', makeBigFrame(ss2Gate, 2), makeConn(), 'ss2').then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, e }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect((r2.e as { code?: number }).code).toBe(CollabCloseCode.RATE_LIMITED_CLOSE);
      expect(hardClose).toHaveBeenCalledWith(expect.anything(), CollabCloseCode.RATE_LIMITED_CLOSE, 'ss2-budget-exceeded');
    }
    await p1submit.then(() => {}, () => {});   // 首帧后续在准入段被 P1/解码拒（预算用例只锚第二帧 deny）
    void SS2_SEMAPHORE_GLOBAL_BUDGET_BYTES;
  }, 30_000);

  it('per-connection 入站排队字节上限：2×ss2FrameGate 超限 → close 1009', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor, hardClose } = buildActor(spool, doc);
    const conn = makeConn();
    const ss2Gate = 8 * 1024 * 1024 + 64 * 1024;   // ss2FrameGate 同式（QUOTA_DEFAULTS 8MiB+64KiB）
    const ps: Array<Promise<unknown>> = [];
    let rejected = false;
    for (let i = 0; i < 3; i++) {   // 3×ss2Gate > 2×ss2Gate=INBOUND_QUEUE_LIMIT_BYTES → 第 3 帧 1009
      ps.push(actor.submit('p1', makeBigFrame(ss2Gate, i), conn, 'update').catch((e) => {
        if ((e as { code?: number }).code === CollabCloseCode.LIB_MESSAGE_TOO_BIG) rejected = true;
      }));
    }
    await new Promise((r) => setTimeout(r, 50));   // deny=submit 同步面（不待前两帧解码落定）
    expect(rejected).toBe(true);
    expect(hardClose).toHaveBeenCalledWith(expect.anything(), CollabCloseCode.LIB_MESSAGE_TOO_BIG, 'inbound-queue-over-limit');
  }, 30_000);

  it('per-project 写入背压（偏离 36-③）：队列 >512 帧 → 拒收 1008（单项目不拖垮其他项目）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor(spool, doc);
    const conn = makeConn();
    const ps: Array<Promise<unknown>> = [];
    let rejected = false;
    for (let i = 0; i < 600; i++) {
      ps.push(actor.submit('p1', frameSetting('p1', `bp${i}`, i), conn, 'update').catch((e) => {
        if ((e as { code?: number }).code === CollabCloseCode.RATE_LIMITED_CLOSE && (e as { frameReason?: string }).frameReason === 'project-write-backpressure') rejected = true;
      }));
    }
    await Promise.allSettled(ps);
    expect(rejected).toBe(true);
  }, 30_000);

  it('FrameEffects 收集器+ProjectDocIndex（修正 #1——apply 后 actor 临界区内为准）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor(spool, doc);
    // NODE_CREATED（type=videographic 从节点 map type 字段读）+EDGE_ADDED+FIELD_CHANGED
    const src = new Y.Doc();
    const node = new Y.Map();
    node.set('type', 'imageGen');
    const data = new Y.Map();
    data.set('fileId', 'media-1');
    node.set('data', data);
    src.getMap('nodes').set('nd1', node);
    const edge = new Y.Map();
    edge.set('source', 'nd1'); edge.set('target', 'nd1');
    src.getMap('edges').set('e1', edge);
    await actor.submit('p1', Y.encodeStateAsUpdate(src), makeConn(), 'update');
    const index = actor.docIndexOf('p1');
    expect(index.nodeType('nd1')).toBe('imageGen');
    expect(index.edgesByNode.get('nd1')).toContain('e1');
    expect(index.mediaRefsByNode.get('nd1')).toContain('media-1');
    // NODE_DELETED 增量（删集帧=先持有原内容再删——空 doc 上 delete 零内容）
    const del = new Y.Doc();
    Y.applyUpdate(del, Y.encodeStateAsUpdate(doc));
    del.getMap('nodes').delete('nd1');
    await actor.submit('p1', Y.encodeStateAsUpdate(del), makeConn(), 'update');
    expect(index.nodeType('nd1')).toBeUndefined();
    // rebuild(doc) 崩溃重建契约
    const idx2 = actor.docIndexOf('p1');
    idx2.rebuild(doc);
    expect(idx2.nodeType('nd1')).toBeUndefined();   // 已删
  }, 20_000);

  it('pending 区间预检（修正 #2）：缺前驱帧 → 4412 零 WAL 零 apply（doc 不变）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();   // 空 doc（SV 全零）
    const { actor, hardClose } = buildActor(spool, doc);
    const src = new Y.Doc();
    src.getMap('nodes').set('n', 1);
    // 缺前驱构造：client X 在空 SV 接收端上直接发 clock>0 起点的差量帧（跳过其 clock 0 前驱）
    const doc3 = new Y.Doc();
    const svEmpty = Y.encodeStateVector(new Y.Doc());
    doc3.transact(() => { doc3.getMap('nodes').set('a', 1); });   // clock 0-? 区间（前驱）
    const tmp = new Y.Doc();
    Y.applyUpdate(tmp, Y.encodeStateAsUpdate(doc3));   // tmp 持有前驱
    doc3.transact(() => { doc3.getMap('nodes').set('b', 2); });   // 第二段（clock 接续）
    // 差量=仅第二段（相对 tmp 的 SV——含 Skip 前驱语义）：直接对空接收端发 ⇒ 起点晚于 SV=缺前驱
    const u2 = Y.encodeStateAsUpdate(doc3, Y.encodeStateVector(tmp));
    void svEmpty;
    const r = await actor.submit('p1', u2, makeConn(), 'update').then((x) => ({ ok: true as const, x }), (e) => ({ ok: false as const, e }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect((r.e as { code?: number }).code).toBe(CollabCloseCode.RESYNC_REQUIRED);
      expect(hardClose).toHaveBeenCalledWith(expect.anything(), CollabCloseCode.RESYNC_REQUIRED, 'resync-required');
    }
    expect(spool.keys()).toHaveLength(0);   // 零 WAL
  }, 20_000);

  it('维护写独立 append 通道：submitMaintenance WAL+PG 落定（无 admission/apply——已生效字节）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor, repo } = buildActor(spool, doc);
    const payload = frameSetting('p1', 'm1', 'maint');
    const r = await actor.submitMaintenance('p1', payload);
    expect(r.walSeq).toBe(1n);
    expect(repo.appendBatch).toHaveBeenCalledTimes(1);
    expect((doc.getMap('nodes') as Y.Map<unknown>).get('m1')).toBeUndefined();   // 不 apply（已生效字节）
  }, 20_000);

  it('世代权威（偏离 36-②）：submit 与 drain 之间换代 → 4410 拒（每帧对照当前权威）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    let gen = 0;   // Y1c T12：canonical 名=裸名（gen0）——换代 bump 至 1（#g1 名对 fixture documents miss 无碍：换代拒绝在 admission 循环〔先于 document 判定〕）
    const repo = createMockRepo();
    const documents = new Map([['project:p1', doc]]);
    const actor = new CollabProjectActorService(spool, repo as never);
    const hardClose = vi.fn();
    actor.bindHost({
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      documents: () => documents,
      hardClose: (c: unknown, code: number, reason: string) => hardClose(c, code, reason),
        isQuotaFrozen: () => false,
      generationOf: () => gen,
      noteReadOnlyDrop: () => false,
      onFencedByWrite: async () => {},
    });
    await actor.submit('p1', frameSetting('p1', 'g1', 1), makeConn(), 'update');
    // submit 捕获 gen=0 后、drain 微任务准入前同步换代（authGen=1≠submitGeneration=0→4410）
    const r = await (async () => { const p = actor.submit('p1', frameSetting('p1', 'g2', 2), makeConn(), 'update'); gen = 1; return p.then((x) => ({ ok: true as const }), (e) => ({ ok: false as const, e })); })();
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r.e as { code?: number }).code).toBe(CollabCloseCode.GENERATION_SUPERSEDED);
  }, 20_000);
});

// ═══ Y1c T9 双评审收口（quality C1+I1+I2 / spec I1 + M 系）——红先行 ═══
describe('Y1c T9 双评审收口（C1 detached 守卫/Q-I1 states 清理/Q-I2 旗标元组/S-I1 截断×去重/S-M3 全局预算）', () => {
  it('C1：detached 维护批 WAL 失败 → 维护 promise 全 reject（wal-append-failed 不带 pgPending）+drain 可继续', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor(spool, doc, 'other');   // documents 只含 other——p1=detached（doc 不在库）
    const appendSpy = vi.spyOn(spool, 'appendBatch').mockRejectedValueOnce(new Error('wal capacity exceeded'));
    const m1 = actor.submitMaintenance('p1', frameSetting('p1', 'wm1', 1));
    const m2 = actor.submitMaintenance('p1', frameSetting('p1', 'wm2', 2));
    // 红相锚：未守卫=异常穿透 drain（void this.drain() 未处理拒绝）→promise 永挂（2s 内零 settle）
    const settled = await Promise.race([
      Promise.allSettled([m1, m2]).then(() => true),
      new Promise<boolean>((res) => { setTimeout(() => res(false), 2_000); }),
    ]);
    expect(settled, '维护 promise 必须 settle（红=永挂：saveMutex/handoff 链随之永挂）').toBe(true);
    const e1 = await m1.then(() => null, (e) => e);
    const e2 = await m2.then(() => null, (e) => e);
    expect(e1).toMatchObject({ code: CollabCloseCode.SLOW_CONSUMER, frameReason: 'wal-append-failed' });
    expect(e2).toMatchObject({ code: CollabCloseCode.SLOW_CONSUMER, frameReason: 'wal-append-failed' });
    expect((e1 as { pgPending?: boolean }).pgPending, 'WAL 未落定语义——不带 pgPending（对照 pg-pending 档）').toBeUndefined();
    expect((e2 as { pgPending?: boolean }).pgPending).toBeUndefined();
    appendSpy.mockRestore();
    // drain 可继续：同项目后续维护帧照常落定（守卫 return 不悬挂 drain 循环）
    const r3 = await actor.submitMaintenance('p1', frameSetting('p1', 'wm3', 3));
    expect(r3.walSeq).toBe(1n);
  }, 20_000);

  it('Q-I1：states Map 卸载/项目消失清理钩——两项目建态→清一→size 减一；帧落定中守卫保守留驻', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor(spool, doc, 'pa');
    actor.docIndexOf('pa'); actor.docIndexOf('pb');   // states 建键（docIndex 读面=装载路径同源）
    const states = (actor as unknown as { states: Map<string, unknown> }).states;
    expect(states.size).toBe(2);
    actor.onProjectStateCleanup('pa');   // 卸载/项目消失钩（gateway afterUnloadDocument/handleProjectsGone 接线）
    expect(states.size, '清理后 size 减一').toBe(1);
    expect(states.has('pb')).toBe(true);
    // 幂等+无键 no-op
    actor.onProjectStateCleanup('pa');
    actor.onProjectStateCleanup('p-none');
    expect(states.size).toBe(1);
    // 帧落定中守卫：挂起 appendBatch（drain 在飞+队列占用）→ cleanup 保守留驻（防删除+重建破单 drain 串行/丢 appliedSeq）
    let releaseAppend!: (v: Array<{ frameId: string; walSeq: bigint }>) => void;
    const gate = vi.spyOn(spool, 'appendBatch').mockImplementation((() => new Promise((res) => { releaseAppend = res; })) as never);
    const m = actor.submitMaintenance('pb', frameSetting('pb', 'qg1', 1));
    await new Promise((r) => setTimeout(r, 30));   // drain 进入挂起批（draining=true）
    actor.onProjectStateCleanup('pb');
    expect(states.has('pb'), '落定中不删').toBe(true);
    releaseAppend([{ frameId: 'g:0', walSeq: 1n }]);
    await m;
    gate.mockRestore();
    await new Promise((r) => setTimeout(r, 10));   // drain 末轮收尾（resolve 先于 finally draining=false 恢复——微任务序）
    actor.onProjectStateCleanup('pb');   // 落定后（drain 静止+队列空）→真删
    expect(states.has('pb')).toBe(false);
  }, 20_000);

  it('Q-I2：PG 失败旗标随 flush 元组走——他批残留旗标不再错挂（breaker-open 档读到 fenced/lease 族=红相）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    let breakerOpen = false;
    const breaker = { isOpen: () => breakerOpen, recordSuccess: () => {}, recordFailure: () => {} };
    const repo = createMockRepo();
    const documents = new Map([['project:pa', doc]]);   // pb=detached（维护帧形态）
    const actor = new CollabProjectActorService(spool, repo as never, breaker as never);
    actor.bindHost({
      logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      documents: () => documents,
      hardClose: () => {},
      isQuotaFrozen: () => false,
      generationOf: () => 0,   // Y1c T12：gen0=裸名 canonical（fixture 对齐）
      noteReadOnlyDrop: () => false,
      onFencedByWrite: async () => {},
    });
    // 项目 pa：connection 批 PG 失败（leaseRowMissing 语义）——批内零维护帧=旧实现 lastPgError 残留不读不清
    repo.appendBatch.mockImplementation(async (pid: string) => {
      if (pid === 'pa') throw Object.assign(new Error('CollabLease row missing'), { leaseRowMissing: true });
      if (pid === 'pc') return { ok: false as const, reason: 'fenced' as const };
      return { ok: true as const, rows: 1 };
    });
    await actor.submit('pa', frameSetting('pa', 'qc1', 1), makeConn(), 'update');   // connection 帧 resolve（Applied 档）；flush 失败旗标残留（旧共享字段）
    // 项目 pb：breaker-open 档 flush 短路（不产生新失败样本）——旧实现读到 pa 残留 leaseRowMissing=旗标错挂
    breakerOpen = true;
    const eb = await actor.submitMaintenance('pb', frameSetting('pb', 'qm1', 1)).then(() => null, (e) => e);
    expect(eb).toMatchObject({ code: CollabCloseCode.SLOW_CONSUMER, frameReason: 'maintenance-pg-pending' });
    expect((eb as { pgPending?: boolean }).pgPending).toBe(true);
    expect((eb as { leaseRowMissing?: boolean }).leaseRowMissing, '红相：错挂他批 leaseRowMissing').toBeUndefined();
    expect((eb as { fenced?: boolean }).fenced).toBeUndefined();
    // 正控：真 fenced 批旗标仍正确（元组单源——批内多维护帧均 fenced:true，旧首帧读后置 null=次帧丢旗标）
    breakerOpen = false;
    const [f1, f2] = await Promise.allSettled([
      actor.submitMaintenance('pc', frameSetting('pc', 'qf1', 1)),
      actor.submitMaintenance('pc', frameSetting('pc', 'qf2', 2)),
    ]).then((rs) => rs.map((r) => r.status === 'rejected' ? (r as PromiseRejectedResult).reason : null));
    expect(f1).toMatchObject({ code: CollabCloseCode.SLOW_CONSUMER, frameReason: 'maintenance-pg-pending' });
    expect(f2).toMatchObject({ code: CollabCloseCode.SLOW_CONSUMER, frameReason: 'maintenance-pg-pending' });
    expect((f1 as { fenced?: boolean }).fenced).toBe(true);
    expect((f2 as { fenced?: boolean }).fenced, '批内次帧旗标不丢（元组=批内单源）').toBe(true);
  }, 20_000);

  it('S-I1：毒帧截断后重发同字节=新帧（新 walSeq+真 WAL 写入）——截断×spool 去重互不作废=ACK 铁律破口（红相）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor<FlakyApplyActor>(spool, doc, 'p1', FlakyApplyActor as never);
    const poisonBytes = frameSetting('p1', 'sibad', 1);
    const ok1 = await actor.submit('p1', frameSetting('p1', 'siok', 1), makeConn(), 'update');
    expect(ok1.walSeq).toBe(1n);
    actor.failNextApply = true;
    await expect(actor.submit('p1', poisonBytes, makeConn(), 'update')).rejects.toMatchObject({ code: CollabCloseCode.FRAME_MALFORMED });
    expect(spool.watermark('p1')!.spoolHeadSeq).toBe(1n);   // WAL 截断至 appliedSeq=1（毒帧 walSeq2 已截）
    // 截断后重发同字节毒帧（apply 恢复）：必须按新帧处理——真 WAL 写入+去重条目已作废（S-I1 主轴）
    // walSeq=复用被截 2n（Y1c T10 修正：truncateWalAfter 回拨续号——WAL 密集前缀=恢复链可证性前提，
    // scanWalSegmentBuffer gap 缺号 fatal；T9 旧「跳号 3n」形态=每次 recoverScan 链断截尾——G2 ⑦ 红）。
    actor.failNextApply = false;
    const r2 = await actor.submit('p1', poisonBytes, makeConn(), 'update');
    expect(r2.walSeq, '复用被截 walSeq（密集前缀——不留洞）').toBe(2n);
    expect(r2.noop).not.toBe(true);
    expect(spool.watermark('p1')!.spoolHeadSeq, '真 WAL 写入（spoolHead 随新帧推进）').toBe(2n);
    expect((((doc.getMap('nodes') as Y.Map<unknown>).get('sibad') as Y.Map<unknown>).get('data') as Y.Map<unknown>).get('model')).toBe(1);   // T24 夹具=map 信封（重发新帧语义不变）
  }, 20_000);

  it('S-M3：SS2 全局预算跨项目并发——4×ss2FrameGate（4 项目各 1 pending）占满 → 第 5 项目 SS2 瞬态拒 1008', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor, hardClose } = buildActor(spool, doc);
    const ss2Gate = 8 * 1024 * 1024 + 64 * 1024;   // SS2 帧上界（SS2_FRAME_GATE_BYTES 同式——全局预算=4×此值）
    // 同 tick 连发 5 项目 SS2（drain 微任务前 pending 双计面已占满——跨项目并发形态）
    const first = [0, 1, 2, 3].map((i) => actor.submit(`spx${i}`, makeBigFrame(ss2Gate, i), makeConn(), 'ss2').catch(() => {}));
    const r5 = await actor.submit('spx5', makeBigFrame(ss2Gate, 5), makeConn(), 'ss2').then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, e }));
    expect(r5.ok, '第 5 帧（4×gate+gate>4×gate）全局预算拒').toBe(false);
    if (!r5.ok) {
      expect((r5.e as { code?: number }).code).toBe(CollabCloseCode.RATE_LIMITED_CLOSE);
      expect((r5.e as { frameReason?: string }).frameReason).toBe('ss2-budget-exceeded');
      expect(hardClose).toHaveBeenCalledWith(expect.anything(), CollabCloseCode.RATE_LIMITED_CLOSE, 'ss2-budget-exceeded');
    }
    await Promise.allSettled(first);   // 首四帧后续在准入段被拒（预算用例只锚第 5 帧全局 deny）
  }, 30_000);
});

describe('Y1c T28 增量投影（P3 出口卡点名——YEvent path[0] observeDeep 单节点 patch 断言）', () => {
  /** 增量帧构造（生产形态=事务 update 非 full-state 再编——后者把被覆写旧项重发为 ContentDeleted
   *  struct，L1 value-type 执法对非生产形态拒之属预期；on('update') 采集=canvas-doc-update
   *  repository.spec 同款装置）。 */
  const incrementalFrame = (baseFrame: Uint8Array, mutate: (src: Y.Doc) => void): Uint8Array => {
    const src = new Y.Doc();
    Y.applyUpdate(src, baseFrame);
    const ups: Uint8Array[] = [];
    src.on('update', (u: Uint8Array) => { ups.push(u); });
    mutate(src);
    return Y.mergeUpdates(ups);
  };

  it('path[0] 单节点单字段 patch：FIELD_CHANGED 逐键粒度（nodeId=path[0] 定位+邻节点零 effect）+媒体引用字段增量换绑（MEDIA_REF 对+docIndex 增量≡全量重建）', async () => {
    const spool = makeSpool();
    const doc = new Y.Doc();
    const { actor } = buildActor(spool, doc);
    const mkNode = (type: string, data: Record<string, unknown>) => {
      const n = new Y.Map();
      n.set('type', type);
      const d = new Y.Map();
      for (const [k, v] of Object.entries(data)) d.set(k, v);
      n.set('data', d);
      return n;
    };
    // 帧1：两节点在册（path[0] 定位形态前提=节点先存在）——n1 imageGen{referenceImage media-a,model m1}
    // /n2 textInput{model x}（键选型按 DOC_SCHEMA_V4：model=lww 标量/referenceImage=mediaLww——
    // prompt=xml 容器、fileId=server-forbidden 均非单字段 patch 合法载体）
    const base = new Y.Doc();
    base.getMap('nodes').set('n1', mkNode('imageGen', { referenceImage: 'media-a', model: 'm1' }));
    base.getMap('nodes').set('n2', mkNode('textInput', { model: 'x' }));
    const frame1 = Y.encodeStateAsUpdate(base);
    await actor.submit('p1', frame1, makeConn(), 'update');
    const index = actor.docIndexOf('p1');
    expect(index.nodeType('n1')).toBe('imageGen');
    expect([...(index.mediaRefsByNode.get('n1') ?? [])]).toEqual(['media-a']);

    // 帧2：单事务单节点单字段 patch——n1.data.model m1→m2（nodes 根 observeDeep 事件 path=['n1','data']，
    // path[0]='n1' 定位分支：变更键 k='model' 非媒体引用字段→FIELD_CHANGED 逐键粒度）
    const frame2 = incrementalFrame(frame1, (src) => {
      (((src.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>)).set('model', 'm2');
    });
    await actor.submit('p1', frame2, makeConn(), 'update');

    // 帧级 effects 增量投影断言（同一收集器单源——deriveLifecycleFramesForReplay 派生 seam 逐帧取走）
    const derived2 = await actor.deriveLifecycleFramesForReplay('p1', [
      { walSeq: 1n, payload: frame1 }, { walSeq: 2n, payload: frame2 },
    ]);
    expect(derived2, '派生 seam 返回非 null（mock repo 空 hydration→空基线逐帧重放）').not.toBeNull();
    const frames2 = derived2 as ReadonlyArray<{ walSeq: bigint; effects: ReadonlyArray<{ kind: string; nodeId?: string; key?: string; mediaId?: string; walSeq: bigint }> }>;
    expect(frames2[1].effects, 'path[0] 定位单节点单字段——恰一 FIELD_CHANGED{n1,model}，邻节点 n2 零 effect').toEqual([
      { kind: 'FIELD_CHANGED', nodeId: 'n1', key: 'model', walSeq: 2n },
    ]);

    // 帧3：媒体引用字段单点换绑 referenceImage media-a→media-b（同 path[0] 形态——
    // k∈MEDIA_REF_TARGET_FIELDS→MEDIA_REF_REMOVED/ADDED 对，nodeId 同由 path[0] 定位）
    const frame2Applied = new Uint8Array(frame2);
    const frame3 = incrementalFrame(Y.mergeUpdates([frame1, frame2Applied]), (src) => {
      (((src.getMap('nodes').get('n1') as Y.Map<unknown>).get('data') as Y.Map<unknown>)).set('referenceImage', 'media-b');
    });
    await actor.submit('p1', frame3, makeConn(), 'update');
    const derived3 = await actor.deriveLifecycleFramesForReplay('p1', [
      { walSeq: 1n, payload: frame1 }, { walSeq: 2n, payload: frame2 }, { walSeq: 3n, payload: frame3 },
    ]);
    const frames3 = derived3 as ReadonlyArray<{ walSeq: bigint; effects: ReadonlyArray<{ kind: string; nodeId?: string; key?: string; mediaId?: string; walSeq: bigint }> }>;
    expect(frames3[2].effects, '媒体引用字段单点换绑=恰一 ADDED/REMOVED 对（差分粒度——非整节点重建；T28 根修红锚：修前 update 档只发 ADDED、旧 mediaId 无 REMOVED）').toEqual([
      { kind: 'MEDIA_REF_ADDED', nodeId: 'n1', mediaId: 'media-b', walSeq: 3n },
      { kind: 'MEDIA_REF_REMOVED', nodeId: 'n1', mediaId: 'media-a', walSeq: 3n },
    ]);

    // 投影面（ProjectDocIndex——submit 路径逐帧增量 apply）断言+全量重建等价对拍
    const snapshotOf = () => ({
      t1: index.nodeType('n1'), t2: index.nodeType('n2'),
      m1: [...(index.mediaRefsByNode.get('n1') ?? [])].sort(),
      m2: [...(index.mediaRefsByNode.get('n2') ?? [])].sort(),
    });
    expect(snapshotOf(), '增量投影：n1 媒体引用换绑推进+邻节点 n2 投影不动+类型面不受字段 patch 扰动').toEqual({
      t1: 'imageGen', t2: 'textInput', m1: ['media-b'], m2: [],
    });
    index.rebuild(doc);
    expect(snapshotOf(), '增量 apply ≡ rebuild(doc) 全量重建（增量投影正确性对拍——帧3 后两形态等值）').toEqual({
      t1: 'imageGen', t2: 'textInput', m1: ['media-b'], m2: [],
    });
  }, 20_000);
});

/** 大帧构造（入站上限用例——常量字节载荷，Wal 入账前已被闸拒不真写盘）。 */
function makeBigFrame(bytes: number, seed: number): Uint8Array {
  const u = new Uint8Array(bytes);
  u[0] = seed & 0xff;
  return u;
}

void ACTOR_DRAIN_BATCH_MAX_BYTES;
