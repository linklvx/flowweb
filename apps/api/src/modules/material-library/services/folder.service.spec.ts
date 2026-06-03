import { Test, TestingModule } from '@nestjs/testing';
import { FolderService } from './folder.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('FolderService', () => {
  let service: FolderService;
  let prisma: { materialFolder: any; media: any; $transaction: any };

  beforeEach(async () => {
    prisma = {
      materialFolder: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        aggregate: vi.fn(),
      },
      media: {
        updateMany: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FolderService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FolderService>(FolderService);
  });

  describe('create', () => {
    it('should create a folder with auto-calculated sortOrder', async () => {
      const dto = { name: 'My Folder' };
      const userId = 'user-1';
      prisma.materialFolder.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
      prisma.materialFolder.create.mockResolvedValue({ id: 'f-1', ...dto, userId, sortOrder: 3 });

      const result = await service.create(dto, userId);

      expect(prisma.materialFolder.aggregate).toHaveBeenCalledWith({
        where: { userId, parentId: null, deletedAt: null },
        _max: { sortOrder: true },
      });
      expect(prisma.materialFolder.create).toHaveBeenCalledWith({
        data: { name: 'My Folder', parentId: null, userId, sortOrder: 3 },
      });
      expect(result.sortOrder).toBe(3);
    });

    it('should start sortOrder at 0 when no existing folders', async () => {
      prisma.materialFolder.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      prisma.materialFolder.create.mockResolvedValue({ id: 'f-1', name: 'Root', userId: 'u1', sortOrder: 0 });

      const result = await service.create({ name: 'Root' }, 'u1');

      expect(prisma.materialFolder.create).toHaveBeenCalledWith({
        data: { name: 'Root', parentId: null, userId: 'u1', sortOrder: 0 },
      });
      expect(result.sortOrder).toBe(0);
    });
  });

  describe('findAllByUserId', () => {
    it('should return folders sorted by sortOrder', async () => {
      const userId = 'user-1';
      const folders = [
        { id: 'f-1', name: 'A', sortOrder: 0 },
        { id: 'f-2', name: 'B', sortOrder: 1 },
      ];
      prisma.materialFolder.findMany.mockResolvedValue(folders);

      const result = await service.findAllByUserId(userId);

      expect(prisma.materialFolder.findMany).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toEqual(folders);
    });
  });

  describe('update', () => {
    it('should update a non-default folder', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: 'Old', isDefault: false, userId: 'user-1',
      });
      prisma.materialFolder.update.mockResolvedValue({
        id: 'f-1', name: 'New', isDefault: false,
      });

      const result = await service.update('f-1', { name: 'New' }, 'user-1');

      expect(result.name).toBe('New');
    });

    it('should throw if folder is default', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: '角色', isDefault: true, userId: 'user-1',
      });

      await expect(
        service.update('f-1', { name: 'New' }, 'user-1')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if folder not found', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue(null);
      await expect(service.update('f-99', { name: 'X' }, 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('should soft-delete and move children/medias to root', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: 'Test', isDefault: false, userId: 'user-1',
      });
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.materialFolder.updateMany.mockResolvedValue({});
      prisma.media.updateMany.mockResolvedValue({});

      await service.remove('f-1', 'user-1');

      expect(prisma.materialFolder.update).toHaveBeenCalledWith({
        where: { id: 'f-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.materialFolder.updateMany).toHaveBeenCalledWith({
        where: { parentId: 'f-1', userId: 'user-1', deletedAt: null },
        data: { parentId: null },
      });
      expect(prisma.media.updateMany).toHaveBeenCalledWith({
        where: { folderId: 'f-1', userId: 'user-1' },
        data: { folderId: null },
      });
    });

    it('should throw if folder is default', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: '角色', isDefault: true, userId: 'u1',
      });
      await expect(service.remove('f-1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('should throw if folder not found', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue(null);
      await expect(service.remove('f-99', 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('moveUp', () => {
    it('should swap sortOrder with previous folder', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-2', sortOrder: 2, parentId: null, isDefault: false })
        .mockResolvedValueOnce({ id: 'f-1', sortOrder: 1, parentId: null });
      prisma.materialFolder.update.mockResolvedValue({});

      await service.moveUp('f-2', 'u1');

      expect(prisma.materialFolder.update).toHaveBeenCalledTimes(2);
    });

    it('should do nothing when already first', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-1', sortOrder: 0, parentId: null, isDefault: false })
        .mockResolvedValueOnce(null); // no previous folder

      await service.moveUp('f-1', 'u1');

      expect(prisma.materialFolder.update).not.toHaveBeenCalled();
    });

    it('should throw if folder not found', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue(null);
      await expect(service.moveUp('f-99', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('should throw if folder is default', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: '角色', isDefault: true, userId: 'u1',
      });
      await expect(service.moveUp('f-1', 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('moveFolder', () => {
    it('should place at beginning when afterId is null', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽文件夹', parentId: 'p1', sortOrder: 5, isDefault: false, userId: 'u1' })
        .mockResolvedValueOnce({ id: 'p1', name: '目标父', parentId: null, sortOrder: 0, isDefault: false, userId: 'u1' });
      prisma.materialFolder.findMany.mockResolvedValue([
        { id: 's1', sortOrder: 0 },
        { id: 's2', sortOrder: 1 },
      ]);
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

      await service.moveFolder('f-move', { parentId: 'p1', afterId: null }, 'u1');

      expect(prisma.materialFolder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1' }, data: { sortOrder: 1 } }),
      );
      expect(prisma.materialFolder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's2' }, data: { sortOrder: 2 } }),
      );
      expect(prisma.materialFolder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'f-move' }, data: { parentId: 'p1', sortOrder: 0 } }),
      );
    });

    it('should place after a specific sibling', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽', parentId: null, sortOrder: 0, isDefault: false, userId: 'u1' })
        .mockResolvedValueOnce(null); // parentId is null, no parent check needed
      prisma.materialFolder.findMany.mockResolvedValue([
        { id: 's1', sortOrder: 0 },
        { id: 's2', sortOrder: 1 },
      ]);
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

      await service.moveFolder('f-move', { parentId: null, afterId: 's1' }, 'u1');

      // afterId='s1', insertIndex=1: f-move gets sortOrder=1, s2 bumped to 2
      expect(prisma.materialFolder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's2' }, data: { sortOrder: 2 } }),
      );
      expect(prisma.materialFolder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'f-move' }, data: { parentId: null, sortOrder: 1 } }),
      );
    });

    it('should move to a different parent', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽', parentId: 'p-old', sortOrder: 0, isDefault: false, userId: 'u1' })
        .mockResolvedValueOnce({ id: 'p-new', name: '新父', parentId: null, sortOrder: 0, isDefault: false, userId: 'u1' });
      prisma.materialFolder.findMany.mockResolvedValue([
        { id: 's1', sortOrder: 0 },
      ]);
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

      await service.moveFolder('f-move', { parentId: 'p-new', afterId: 's1' }, 'u1');

      expect(prisma.materialFolder.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'f-move' }, data: { parentId: 'p-new', sortOrder: 1 } }),
      );
    });

    it('should throw if folder not found', async () => {
      prisma.materialFolder.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.moveFolder('not-found', { parentId: null, afterId: null }, 'u1'),
      ).rejects.toThrow('文件夹不存在');
    });

    it('should throw if folder is default', async () => {
      prisma.materialFolder.findFirst.mockResolvedValueOnce({ id: 'f-1', isDefault: true, userId: 'u1' });
      await expect(
        service.moveFolder('f-1', { parentId: null, afterId: null }, 'u1'),
      ).rejects.toThrow('系统默认文件夹不可移动');
    });

    it('should throw if target parent not found', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', isDefault: false, userId: 'u1' })
        .mockResolvedValueOnce(null);
      await expect(
        service.moveFolder('f-move', { parentId: 'bad-parent', afterId: null }, 'u1'),
      ).rejects.toThrow('目标父文件夹不存在');
    });

    it('should throw on circular reference', async () => {
      // p-new's parent is f-move → getFolderDepth returns 1, then isDescendant detects the cycle
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽', parentId: 'p-old', sortOrder: 0, isDefault: false, userId: 'u1' }) // folder check
        .mockResolvedValueOnce({ id: 'p-new', name: '新父', parentId: 'f-move', isDefault: false, userId: 'u1' }) // target parent check
        .mockResolvedValueOnce({ parentId: 'f-move' }) // getFolderDepth: lookup 'p-new'
        .mockResolvedValueOnce({ parentId: null })      // getFolderDepth: lookup 'f-move' (depth=1)
        .mockResolvedValueOnce({ parentId: 'f-move' }); // isDescendant: lookup 'p-new' → cycle found
      prisma.materialFolder.findMany.mockResolvedValue([]);
      prisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

      await expect(
        service.moveFolder('f-move', { parentId: 'p-new', afterId: null }, 'u1'),
      ).rejects.toThrow('不能将文件夹移入其自身或其子文件夹');
    });

    it('should throw if target depth exceeds 3 levels', async () => {
      // p-child is at depth 2 (root→parent→child), moving into it makes depth 3 (exceeding limit)
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽', parentId: null, sortOrder: 0, isDefault: false, userId: 'u1' })
        .mockResolvedValueOnce({ id: 'p-child', name: '子', parentId: 'p-parent', isDefault: false, userId: 'u1' })
        .mockResolvedValueOnce({ parentId: 'p-parent' }) // getFolderDepth: lookup 'p-child'
        .mockResolvedValueOnce({ parentId: 'root' })     // getFolderDepth: lookup 'p-parent'
        .mockResolvedValueOnce({ parentId: null });       // getFolderDepth: lookup 'root' (depth now 2)
      prisma.materialFolder.findMany.mockResolvedValue([]);
      prisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

      await expect(
        service.moveFolder('f-move', { parentId: 'p-child', afterId: null }, 'u1'),
      ).rejects.toThrow('文件夹嵌套深度不能超过3层（父→子→孙）');
    });
  });
});
