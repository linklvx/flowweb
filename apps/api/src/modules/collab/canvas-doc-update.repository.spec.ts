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

  it('compact：advisory lock + 重放构建快照 + 条件删除 + 返回 snapshotSV', async () => {
    // mock $transaction 直接执行回调（tx 即 prisma 自身）
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ max: 5n }]);
    const doc = new Y.Doc();
    doc.getMap('nodes').set('n1', 'x');
    prisma.canvasDoc.findUnique.mockResolvedValue(null);
    prisma.canvasDocUpdate.findMany.mockResolvedValue([
      { seq: 1n, update: Buffer.from(Y.encodeStateAsUpdate(doc)) },
    ]);
    const sv = await repo.compact('p1');
    expect(sv).toBeInstanceOf(Uint8Array);
    expect(prisma.canvasDoc.upsert).toHaveBeenCalled();
    expect(prisma.canvasDocUpdate.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', seq: { lte: 5n } },
    });
  });

  it('compact：无增量行返回 null（空文档不产生快照写）', async () => {
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([{ max: null }]);
    await expect(repo.compact('p1')).resolves.toBeNull();
  });
});
