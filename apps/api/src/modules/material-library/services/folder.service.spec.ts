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
});
