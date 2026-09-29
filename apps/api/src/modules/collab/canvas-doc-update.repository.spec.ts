import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';

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

  it('append 用 nextval 取号并写入', async () => {
    await repo.append('p1', new Uint8Array([1, 2]));
    expect(prisma.canvasDocUpdate.create).toHaveBeenCalledWith({
      data: { projectId: 'p1', seq: 1n, update: Buffer.from([1, 2]) },
    });
  });

  it('compact：advisory lock + 重放构建快照 + 条件删除', async () => {
    // mock $transaction 直接执行回调（tx 即 prisma 自身）
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ max: 5n }]);
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', 'x');
    prisma.canvasDoc.findUnique.mockResolvedValue(null);
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { seq: 1n, update: Buffer.from(Y.encodeStateAsUpdate(doc)) },
    ]);
    await repo.compact('p1');
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.canvasDoc.upsert).toHaveBeenCalled();
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', seq: { lte: 5n } },
    });
    // C1：RR 隔离级别，保证删除的行 ⊆ 重放的行（READ COMMITTED 快照不一致丢更新窗口）
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('compact：旧快照 + 增量重放合并（docRow 非空），upsert state 两 key 可见', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ max: 5n }]);
    const docA = new Y.Doc();
    docA.getMap('nodes').set('old', 1);
    prisma.canvasDoc.findUnique.mockResolvedValue({ state: Buffer.from(Y.encodeStateAsUpdate(docA)) });
    const docB = new Y.Doc();
    docB.getMap('nodes').set('new', 2);
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { seq: 1n, update: Buffer.from(Y.encodeStateAsUpdate(docB)) },
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

  it('compact：无增量行不产生快照写', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ max: null }]);
    await repo.compact('p1');
    expect(prisma.canvasDoc.upsert).not.toHaveBeenCalled();
    expect(prisma.canvasDocUpdate.deleteMany).not.toHaveBeenCalled();
  });

  it('compact：插入行 + 删除行 → 快照重放不含被删节点（恢复路径取证）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ max: 2n }]);
    prisma.canvasDoc.findUnique.mockResolvedValue(null);
    const src = new Y.Doc();
    const ups: Buffer[] = [];
    src.on('update', (u) => ups.push(Buffer.from(u)));
    src.getMap('nodes').set('n1', new Y.Map());   // 插入行
    src.getMap('nodes').delete('n1');             // 删除行
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { seq: 1n, update: ups[0] },
      { seq: 2n, update: ups[1] },
    ]);
    await repo.compact('p1');
    const { create } = prisma.canvasDoc.upsert.mock.calls[0][0];
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, new Uint8Array(create.state));
    expect(fresh.getMap('nodes').has('n1')).toBe(false);   // tombstone 进快照，重建不复活
  });

  it('compact：跨两轮幂等——第一轮快照作第二轮 docRow 重放再 compact，状态等价 + maxSeq 边界', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    // 两次 mockResolvedValueOnce 对应两轮的 max 查询（mockResolvedValue 每次返回同一数组、两轮 maxSeq 会同值）
    prisma.$queryRaw.mockResolvedValueOnce([{ max: 2n }]).mockResolvedValueOnce([{ max: 3n }]);
    const src = new Y.Doc();
    src.getMap('nodes').set('a', 1);
    src.getMap('nodes').set('b', 2);
    const inc = Buffer.from(Y.encodeStateAsUpdate(src));
    prisma.canvasDoc.findUnique.mockResolvedValueOnce(null);
    prisma.canvasDocUpdate.findMany.mockResolvedValueOnce([{ seq: 1n, update: inc }]);
    await repo.compact('p1');
    const firstState = prisma.canvasDoc.upsert.mock.calls[0][0].update.state;
    // 第二轮：旧快照 + 一条新删除增量
    const del = new Y.Doc();
    Y.applyUpdate(del, new Uint8Array(firstState));
    const ups: Buffer[] = [];
    del.on('update', (u) => ups.push(Buffer.from(u)));
    del.getMap('nodes').delete('b');
    prisma.canvasDoc.findUnique.mockResolvedValueOnce({ state: firstState });
    prisma.canvasDocUpdate.findMany.mockResolvedValueOnce([{ seq: 2n, update: ups[0] }]);
    await repo.compact('p1');
    const secondState = prisma.canvasDoc.upsert.mock.calls[1][0].update.state;
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, new Uint8Array(secondState));
    expect(fresh.getMap('nodes').has('a')).toBe(true);
    expect(fresh.getMap('nodes').has('b')).toBe(false);   // 跨轮快照/增量边界不丢删除
    // maxSeq 边界守卫（本方法唯一的"危险正确性点"：DELETE seq<=maxSeq 防误删并发实例新 append 的行）
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenNthCalledWith(1, { where: { projectId: 'p1', seq: { lte: 2n } } });
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenNthCalledWith(2, { where: { projectId: 'p1', seq: { lte: 3n } } });
  });
});
