import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
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
  });

  it('append 单语句：$queryRaw 取号+INSERT 同语句，返回 AppendResult；不经 canvasDocUpdate.create', async () => {
    prisma.$queryRaw.mockResolvedValue([{ seq: 7n }]);
    const r = await repo.append('p1', new Uint8Array([1, 2]));
    expect(r).toEqual({ ok: true, seq: 7n });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.canvasDocUpdate.create).not.toHaveBeenCalled();
  });

  it('compact：advisory lock + 按实读行 id 精确删除 + stateSeq 精确 =maxSeq', async () => {
    // mock $transaction 直接执行回调（tx 即 prisma 自身）
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', 'x');
    prisma.canvasDoc.findUnique.mockResolvedValue(null);
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { id: 'u1', seq: 1n, update: Buffer.from(Y.encodeStateAsUpdate(doc)) },
    ]);
    await expect(repo.compact('p1')).resolves.toEqual({ compacted: true });   // 返回契约（spec v2.4 §1.3）
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.canvasDoc.upsert).toHaveBeenCalled();
    // 被删集 ≡ 被重放集（按实读行 id 精确删除——事务期间新 append 的行不被误删）
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1'] } },
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
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: { in: ['u1'] } } });
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenNthCalledWith(2, { where: { id: { in: ['u2'] } } });
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
