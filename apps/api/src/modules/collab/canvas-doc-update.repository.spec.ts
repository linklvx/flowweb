import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { seedRow } from '../../test-utils/canvas-doc-row';
import { yjsCompactAbandonedTotal } from './store.metrics';

describe('CanvasDocUpdateRepository', () => {
  let repo: CanvasDocUpdateRepository;
  let prisma: { $transaction: Mock; $queryRaw: Mock; $executeRaw: Mock; canvasDocUpdate: any; canvasDoc: any };

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ seq: 1n }]),
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      canvasDocUpdate: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        deleteMany: vi.fn(),
      },
      canvasDoc: { findUnique: vi.fn(), upsert: vi.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        CanvasDocUpdateRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repo = mod.get(CanvasDocUpdateRepository);
    repo.setLeaseOwner('spec-owner');   // Y0a-3 契约 16：append/compact fail-closed——既有用例默认持有人
  });

  it('appendBatch（Y1c T9 新表形态）：锁内多行 INSERT ON CONFLICT DO NOTHING，返回实插行数；不经 canvasDocUpdate.create；V8 事务上界 5s/1s', async () => {
    // mock $transaction 直接执行回调（tx 即 prisma 自身——同 compact 三例先例）
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ seq: 7n }]);
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1, 2]), 7n), seedRow(new Uint8Array([3]), 8n)]);
    expect(r).toEqual({ ok: true, rows: 2 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);   // 每行一条 INSERT（同事务）
    expect(prisma.canvasDocUpdate.create).not.toHaveBeenCalled();
    // V8（Y0a-2 复审 I-1）：append 批交互式事务——5s 上界/maxWait 1s（挂起的 PG append 不得无上界持 actor drain）
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 5_000, maxWait: 1_000 });
  });

  it('compact：advisory lock + 按实读行 id 精确删除 + stateSeq 精确 =maxSeq', async () => {
    // mock $transaction 直接执行回调（tx 即 prisma 自身）
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', 'x');
    prisma.canvasDoc.findUnique.mockResolvedValue(null);
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { projectId: 'p1', generation: 1, seq: 1n, update: Buffer.from(Y.encodeStateAsUpdate(doc)) },
    ]);
    await expect(repo.compact('p1')).resolves.toEqual({ compacted: true, snapshotBytes: expect.any(Number), deletedRows: 1, tombstoneBytes: expect.any(Number) });   // 返回契约（spec v2.4 §1.3+Y0b-4 T3 snapshotBytes+Y0b-5 T10 deletedRows/tombstoneBytes）
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.canvasDoc.upsert).toHaveBeenCalled();
    // 被删集 ≡ 被重放集（按实读行 id 精确删除——事务期间新 append 的行不被误删）
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p1' },   // Y1c T9 新表形态：锁内实读=全行集——projectId 整删
    });
    expect(prisma.canvasDoc.upsert.mock.calls[0][0].update.stateSeq).toBe(1n);   // stateSeq 精确 =maxSeq
    // C1：RR 隔离级别，保证删除的行 ⊆ 重放的行（READ COMMITTED 快照不一致丢更新窗口）；
    // timeout/maxWait 为 opts 演进字段——objectContaining 防 opts 演进炸锚
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: 'RepeatableRead',
    }));
  });

  it('compact：旧快照 + 增量重放合并（docRow 非空），upsert state 两 key 可见', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    const docA = new Y.Doc();
    docA.getMap('nodes').set('old', 1);
    prisma.canvasDoc.findUnique.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(docA)) });
    const docB = new Y.Doc();
    docB.getMap('nodes').set('new', 2);
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { id: 'u1', seq: 1n, update: Buffer.from(Y.encodeStateAsUpdate(docB)) },
    ]);
    await repo.compact('p1');
    const { create, update } = prisma.canvasDoc.upsert.mock.calls[0][0];
    const freshCreate = new Y.Doc();
    Y.applyUpdate(freshCreate, new Uint8Array(create.state));
    expect(freshCreate.getMap('nodes').get('old')).toBe(1);
    expect(freshCreate.getMap('nodes').get('new')).toBe(2);
    const freshUpdate = new Y.Doc();
    Y.applyUpdate(freshUpdate, new Uint8Array(update.state));
    expect(freshUpdate.getMap('nodes').get('old')).toBe(1);
    expect(freshUpdate.getMap('nodes').get('new')).toBe(2);
  });

  it('compact：无增量行返回 empty 契约、不产生快照写', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    await expect(repo.compact('p1')).resolves.toEqual({ compacted: false, reason: 'empty' });   // 返回契约：无行=empty
    expect(prisma.canvasDoc.upsert).not.toHaveBeenCalled();
    expect(prisma.canvasDocUpdate.deleteMany).not.toHaveBeenCalled();
  });

  it('compact：插入行 + 删除行 → 快照重放不含被删节点（恢复路径取证）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.canvasDoc.findUnique.mockResolvedValue(null);
    const src = new Y.Doc();
    const ups: Buffer[] = [];
    src.on('update', (u) => ups.push(Buffer.from(u)));
    src.getMap('nodes').set('n1', new Y.Map());   // 插入行
    src.getMap('nodes').delete('n1');             // 删除行
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { id: 'u1', seq: 1n, update: ups[0] },
      { id: 'u2', seq: 2n, update: ups[1] },
    ]);
    await repo.compact('p1');
    const { create } = prisma.canvasDoc.upsert.mock.calls[0][0];
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, new Uint8Array(create.state));
    expect(fresh.getMap('nodes').has('n1')).toBe(false);   // tombstone 进快照，重建不复活
  });

  it('compact：跨两轮幂等——第一轮快照作第二轮 docRow 重放再 compact，状态等价 + 每轮 stateSeq 精确', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    const src = new Y.Doc();
    src.getMap('nodes').set('a', 1);
    src.getMap('nodes').set('b', 2);
    const inc = Buffer.from(Y.encodeStateAsUpdate(src));
    prisma.canvasDoc.findUnique.mockResolvedValueOnce(null);
    prisma.canvasDocUpdate.findMany.mockResolvedValueOnce([{ id: 'u1', seq: 1n, update: inc }]);
    await repo.compact('p1');
    const firstState = prisma.canvasDoc.upsert.mock.calls[0][0].update.state;
    // 第二轮：旧快照 + 一条新删除增量
    const del = new Y.Doc();
    Y.applyUpdate(del, new Uint8Array(firstState));
    const ups: Buffer[] = [];
    del.on('update', (u) => ups.push(Buffer.from(u)));
    del.getMap('nodes').delete('b');
    prisma.canvasDoc.findUnique.mockResolvedValueOnce({ state: firstState });
    prisma.canvasDocUpdate.findMany.mockResolvedValueOnce([{ id: 'u2', seq: 2n, update: ups[0] }]);
    await repo.compact('p1');
    const secondState = prisma.canvasDoc.upsert.mock.calls[1][0].update.state;
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, new Uint8Array(secondState));
    expect(fresh.getMap('nodes').has('a')).toBe(true);
    expect(fresh.getMap('nodes').has('b')).toBe(false);   // 跨轮快照/增量边界不丢删除
    // 每轮 stateSeq 精确 =该轮被删行最大 seq（精确赋值依赖 advisory lock 串行——禁 GREATEST/单调化包装）
    expect(prisma.canvasDoc.upsert.mock.calls[0][0].update.stateSeq).toBe(1n);
    expect(prisma.canvasDoc.upsert.mock.calls[1][0].update.stateSeq).toBe(2n);
    // 被删集 ≡ 被重放集（按实读行 id 精确删除——两轮各删各的实读集）
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenNthCalledWith(1, { where: { projectId: 'p1' } });
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenNthCalledWith(2, { where: { projectId: 'p1' } });   // Y1c T9：projectId 整删（行集=锁内实读全部）
  });

  it('compact：pendingStructs 非空放弃本次——返回 abandoned、不写快照不删行、P0 计数+1（禁 throw——gateway catch 会污染 failure 线）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    // A7b 同款构造：a 建 k 节点 → 取 svA → a 再写 m 节点 → diffUpdate 得只含后写 struct 的行（前置 clock 缺失）
    const a = new Y.Doc();
    a.getMap('nodes').set('k', new Y.Map([['x', 1]]));
    const svA = Y.encodeStateVector(a);
    a.getMap('nodes').set('m', new Y.Map([['x', 2]]));
    const lateOnly = Y.diffUpdate(Y.encodeStateAsUpdate(a), svA);
    prisma.canvasDoc.findUnique.mockResolvedValue(null);
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { id: 'u1', seq: 1n, update: Buffer.from(lateOnly) },
    ]);
    const incSpy = vi.spyOn(yjsCompactAbandonedTotal, 'inc');
    try {
      await expect(repo.compact('p1')).resolves.toEqual({ compacted: false, reason: 'abandoned' });
      expect(prisma.canvasDoc.upsert).not.toHaveBeenCalled();        // 空事务提交：不写
      expect(prisma.canvasDocUpdate.deleteMany).not.toHaveBeenCalled();   // 不删——行全保留，下次 store 立即重试
      expect(incSpy).toHaveBeenCalledTimes(1);                       // P0 告警线单点计数
    } finally {
      incSpy.mockRestore();
    }
  });
});

describe('Y0a-3 fence 下沉（契约 2/15/16——owner-only SV1+advisory lock SV3）', () => {
  // B14：Prisma tagged template 传 mock 的第一参是字符串数组、插值在后续参——断言一律
  // `call[0].join('?')` 看形状 + `call.slice(1)` 看值（仓内惯例 video-work.service.spec:351）；
  // 文本断言永不红=诱导 $queryRawUnsafe 内插（注入面）。
  const shape = (c: any[]) => (c[0] as string[]).join('?');

  function buildRepo(opts: {
    query?: ReturnType<typeof vi.fn>;        // 事务外 $queryRaw（二次查）
    txQuery?: ReturnType<typeof vi.fn>;      // 事务内 $queryRaw（INSERT/fence/页查询）
    txExec?: ReturnType<typeof vi.fn>;       // 事务内 $executeRaw（advisory lock）
    docRow?: { stateSeq: bigint } | null;    // canvasDoc.findUnique 返回（cursor 判别性）
  } = {}) {
    const query = opts.query ?? vi.fn().mockResolvedValue([]);
    const txq = opts.txQuery ?? vi.fn().mockResolvedValue([]);
    const exec = opts.txExec ?? vi.fn().mockResolvedValue([]);
    const prisma = {
      $queryRaw: query,
      $transaction: vi.fn((fn: any) => fn({
        $queryRaw: txq,
        $executeRaw: exec,
        canvasDocUpdate: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn() },
        canvasDoc: { findUnique: vi.fn().mockResolvedValue(opts.docRow ?? null), upsert: vi.fn() },
      })),
    };
    return { repo: new CanvasDocUpdateRepository(prisma as any), prisma, txq, exec, query };
  }

  it('appendBatch：advisory lock（值=p1）+owner-only EXISTS（形状无 TTL 项）+ON CONFLICT DO NOTHING（updateHash 幂等）——与 compact 同 key', async () => {
    const txq = vi.fn().mockResolvedValue([{ seq: 1n }]);
    const exec = vi.fn().mockResolvedValue([]);
    const { repo, exec: e } = buildRepo({ txQuery: txq, txExec: exec });
    repo.setLeaseOwner('me');
    const r = await repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)]);
    expect(r).toEqual({ ok: true, rows: 1 });
    expect(e.mock.calls.length).toBeGreaterThanOrEqual(1);            // 锁语句被执行
    expect(shape(e.mock.calls[0])).toContain('pg_advisory_xact_lock(hashtext(?)');   // 占位符形态（禁内插）
    expect(e.mock.calls[0].slice(1)).toEqual(['p1']);                 // 锁键=projectId（与 compact 同源）
    const insert = txq.mock.calls[0];
    expect(shape(insert)).toContain('EXISTS (SELECT 1 FROM "CollabLease"');
    expect(shape(insert)).not.toContain('"expiresAt" >= now()');      // SV1：fence 去 TTL
    expect(shape(insert)).toContain('ON CONFLICT DO NOTHING');        // Y1c T9：重试/重组批幂等
    expect(insert.slice(1)).toEqual(expect.arrayContaining(['p1', 'me']));   // owner=绑定值
  });

  it('owner=null 显式 throw lease-owner-not-set（P7：配置错误不伪装 fenced）', async () => {
    const { repo } = buildRepo();
    await expect(repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)])).rejects.toThrow('lease owner not set');
  });

  it('fenced=0 行且行不存在（全新行被 EXISTS 拦）→{ok:false,reason:"fenced"}；行已存在（updateHash 幂等命中）→{ok:true,rows:0}（Y1c T9 幂等轴两分——契约 15 承继）', async () => {
    const txq = vi.fn().mockResolvedValue([]);                       // INSERT 0 行（两形态共面）
    const query = vi.fn()
      .mockResolvedValueOnce([])                                     // 幂等探查：行不存在（fenced 档）
      .mockResolvedValue([{ owner: 'other' }]);                      // 二次查（fenced 分型确认）
    const { repo } = buildRepo({ query, txQuery: txq });
    repo.setLeaseOwner('me');
    await expect(repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)])).resolves.toEqual({ ok: false, reason: 'fenced' });
    // 幂等命中档：行已在（探查命中）→ ok rows:0（DO NOTHING 吞行=正确 no-op——重试/重组批幂等）
    const query2 = vi.fn().mockResolvedValue([{ seq: 1n }]);         // 幂等探查命中
    const { repo: repo2 } = buildRepo({ query: query2, txQuery: vi.fn().mockResolvedValue([]) });
    repo2.setLeaseOwner('me');
    await expect(repo2.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)])).resolves.toEqual({ ok: true, rows: 0 });
  });

  it('leaseRowMissing：二次查空行→throw（不伪装 fenced/不进重试语义）', async () => {
    const txq = vi.fn().mockResolvedValue([]);
    const query = vi.fn().mockResolvedValue([]);                     // 二次查空
    const { repo } = buildRepo({ query, txQuery: txq });
    repo.setLeaseOwner('me');
    await expect(repo.appendBatch('p1', [seedRow(new Uint8Array([1]), 1n)])).rejects.toMatchObject({ leaseRowMissing: true });
  });

  it('compact 事务首行租约断言：不符→{compacted:false,reason:"not-owner"}+零删除+断言先于锁（调用序判据）', async () => {
    const txq = vi.fn()
      .mockResolvedValueOnce([])                        // 首行 fence 断言=0 行
      .mockResolvedValue([{ owner: 'other' }]);         // 二次查
    const exec = vi.fn().mockResolvedValue([]);
    const { repo, exec: e } = buildRepo({ txQuery: txq, txExec: exec });
    repo.setLeaseOwner('me');
    const r = await repo.compact('p1');
    expect(r).toEqual({ compacted: false, reason: 'not-owner' });
    expect(e.mock.calls.length).toBe(0);                // 锁未被调用——fence 断言先于锁（调用序而非文本）
  });

  it('readSnapshotOnly=第二出口（契约 1"一个实现、两出口"）——同 readConsistent 事务形态', async () => {
    const { repo } = buildRepo({ docRow: null });
    const r = await repo.readSnapshotOnly('p1');
    expect(r).toEqual({ state: null, updates: [], stateSeq: 0n, preVacuumSv: null, generation: 0, schemaVersion: null });   // T9a 代际两列+T18 schemaVersion 行值随行（装载/快照两出口同一列门判据——行缺失=null 懒建档）
  });

  it('readConsistent 游标初值 0n（SV3 判别性——docRow.stateSeq=42n 时旧实现从 42 起、新实现从 0 起）', async () => {
    const txq = vi.fn().mockResolvedValue([]);   // 增量页空（首页即止）
    const { repo, txq: q } = buildRepo({ txQuery: txq, docRow: { stateSeq: 42n } });
    await repo.loadForHydration('p1');
    const page = q.mock.calls.find((c) => shape(c).includes('seq >'))!;
    expect(shape(page)).toContain('seq > ?::bigint');            // 谓词保留（去谓词=满页死循环——W15）
    expect(page.slice(1)).toEqual(['p1', 0n, 500]);              // 游标=0n 非 42n+页大小绑定值
  });
});
