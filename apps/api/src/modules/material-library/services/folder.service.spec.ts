import { Test, TestingModule } from '@nestjs/testing';
import { FolderService } from './folder.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('FolderService', () => {
  let service: FolderService;
  let prisma: { materialFolder: any; media: any; team: any; teamMember: any; $transaction: any };

  beforeEach(async () => {
    prisma = {
      materialFolder: {
        create: vi.fn(),
        createMany: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        aggregate: vi.fn(),
      },
      media: {
        updateMany: vi.fn(),
        count: vi.fn(),
      },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 't1' }) },
      teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
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

  describe('团队维度鉴权（resolveTeamId）', () => {
    it('外部 teamId 且为成员 → 放行并按 teamId 查', async () => {
      prisma.materialFolder.findMany.mockResolvedValue([{ id: 'f-1', teamId: 't-team' }]);
      const result = await service.findAll('u1', 't-team');
      expect(prisma.teamMember.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ teamId: 't-team', userId: 'u1' }) }),
      );
      expect(prisma.materialFolder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { teamId: 't-team', deletedAt: null } }),
      );
      expect(result).toEqual([{ id: 'f-1', teamId: 't-team' }]);
    });

    it('他团队成员（非成员）→ 403', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.findAll('u1', 't-other')).rejects.toThrow(ForbiddenException);
      await expect(service.create({ name: 'X', teamId: 't-other' }, 'u1')).rejects.toThrow(ForbiddenException);
      await expect(service.moveUp('f-1', 'u1', 't-other')).rejects.toThrow(ForbiddenException);
      await expect(service.update('f-1', { name: 'X', teamId: 't-other' }, 'u1')).rejects.toThrow(ForbiddenException);
      await expect(service.remove('f-1', 'u1', 't-other')).rejects.toThrow(ForbiddenException);
      await expect(service.moveFolder('f-1', { parentId: null, afterId: null }, 'u1', 't-other')).rejects.toThrow(ForbiddenException);
      expect(prisma.materialFolder.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a folder with auto-calculated sortOrder', async () => {
      const dto = { name: 'My Folder' };
      const userId = 'user-1';
      prisma.materialFolder.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
      prisma.materialFolder.create.mockResolvedValue({ id: 'f-1', ...dto, userId, sortOrder: 3 });

      const result = await service.create(dto, userId);

      expect(prisma.materialFolder.aggregate).toHaveBeenCalledWith({
        where: { teamId: 't1', parentId: null, deletedAt: null },
        _max: { sortOrder: true },
      });
      expect(prisma.materialFolder.create).toHaveBeenCalledWith({
        data: { name: 'My Folder', parentId: null, userId, teamId: 't1', sortOrder: 3 },
      });
      expect(result.sortOrder).toBe(3);
    });

    it('外部 teamId：sortOrder 与创建均按该团队维度', async () => {
      prisma.materialFolder.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      prisma.materialFolder.create.mockResolvedValue({ id: 'f-1', name: 'Root', sortOrder: 0 });

      await service.create({ name: 'Root', teamId: 't-team' } as any, 'u1');

      expect(prisma.materialFolder.aggregate).toHaveBeenCalledWith({
        where: { teamId: 't-team', parentId: null, deletedAt: null },
        _max: { sortOrder: true },
      });
      expect(prisma.materialFolder.create).toHaveBeenCalledWith({
        data: { name: 'Root', parentId: null, userId: 'u1', teamId: 't-team', sortOrder: 0 },
      });
    });

    it('should start sortOrder at 0 when no existing folders', async () => {
      prisma.materialFolder.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      prisma.materialFolder.create.mockResolvedValue({ id: 'f-1', name: 'Root', userId: 'u1', sortOrder: 0 });

      const result = await service.create({ name: 'Root' }, 'u1');

      expect(prisma.materialFolder.create).toHaveBeenCalledWith({
        data: { name: 'Root', parentId: null, userId: 'u1', teamId: 't1', sortOrder: 0 },
      });
      expect(result.sortOrder).toBe(0);
    });

    it('归属校验：parentId 属其他团队（teamId 过滤后查不到）→ 统一报文件夹不存在', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue(null); // 他团队 parent，teamId 过滤后查不到
      await expect(service.create({ name: 'X', parentId: 'p-other-team' }, 'u1')).rejects.toThrow('文件夹不存在');
      expect(prisma.materialFolder.create).not.toHaveBeenCalled();
    });

    it('归属校验：parentId 属本团队 → 正常创建', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({ id: 'p-1', teamId: 't1' });
      prisma.materialFolder.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      prisma.materialFolder.create.mockResolvedValue({ id: 'f-1', name: 'Child', parentId: 'p-1' });

      await service.create({ name: 'Child', parentId: 'p-1' }, 'u1');

      expect(prisma.materialFolder.findFirst).toHaveBeenCalledWith({
        where: { id: 'p-1', teamId: 't1', deletedAt: null },
      });
      expect(prisma.materialFolder.create).toHaveBeenCalledWith({
        data: { name: 'Child', parentId: 'p-1', userId: 'u1', teamId: 't1', sortOrder: 0 },
      });
    });
  });

  describe('findAll', () => {
    it('should return folders sorted by sortOrder', async () => {
      const folders = [
        { id: 'f-1', name: 'A', sortOrder: 0, teamId: 't1' },
        { id: 'f-2', name: 'B', sortOrder: 1, teamId: 't1' },
      ];
      prisma.materialFolder.findMany.mockResolvedValue(folders);

      const result = await service.findAll('user-1');

      expect(prisma.materialFolder.findMany).toHaveBeenCalledWith({
        where: { teamId: 't1', deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toEqual(folders);
    });

    it('懒创建：空时按 teamId 建默认文件夹', async () => {
      const defaults = [
        { id: 'f-1', name: '角色', teamId: 't1', isDefault: true, sortOrder: 0 },
      ];
      prisma.materialFolder.findMany
        .mockResolvedValueOnce([]) // 首查为空
        .mockResolvedValueOnce(defaults); // 懒创建后回查
      prisma.materialFolder.createMany.mockResolvedValue({ count: 5 });

      const result = await service.findAll('user-1');

      expect(prisma.materialFolder.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ name: '角色', userId: 'user-1', teamId: 't1', isDefault: true, sortOrder: 0 }),
        ]),
      });
      const created = prisma.materialFolder.createMany.mock.calls[0][0].data;
      expect(created).toHaveLength(5);
      expect(created.every((f: any) => f.teamId === 't1')).toBe(true);
      expect(result).toEqual(defaults);
    });
  });

  describe('update', () => {
    it('should update a non-default folder', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: 'Old', isDefault: false, teamId: 't1',
      });
      prisma.materialFolder.update.mockResolvedValue({
        id: 'f-1', name: 'New', isDefault: false,
      });

      const result = await service.update('f-1', { name: 'New' }, 'user-1');

      expect(prisma.materialFolder.findFirst).toHaveBeenCalledWith({
        where: { id: 'f-1', teamId: 't1', deletedAt: null },
      });
      expect(result.name).toBe('New');
    });

    it('should update a default folder', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: '角色', isDefault: true, teamId: 't1',
      });
      prisma.materialFolder.update.mockResolvedValue({
        id: 'f-1', name: 'New', isDefault: true,
      });

      const result = await service.update('f-1', { name: 'New' }, 'user-1');

      expect(result.name).toBe('New');
    });

    it('should throw if folder not found', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue(null);
      await expect(service.update('f-99', { name: 'X' }, 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('should soft-delete and move children/medias to root', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: 'Test', isDefault: false, teamId: 't1',
      });
      prisma.media.count.mockResolvedValue(0);
      prisma.materialFolder.findMany.mockResolvedValue([]);
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.materialFolder.updateMany.mockResolvedValue({});
      prisma.media.updateMany.mockResolvedValue({});

      await service.remove('f-1', 'user-1');

      expect(prisma.materialFolder.updateMany).toHaveBeenCalledWith({
        where: { parentId: 'f-1', teamId: 't1', deletedAt: null },
        data: { parentId: null },
      });
      expect(prisma.media.updateMany).toHaveBeenCalledWith({
        where: { folderId: 'f-1', teamId: 't1' },
        data: { folderId: null },
      });
    });

    it('删父提 root：子文件夹与 root 同名 → 剥后缀基名递增消解', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: 'P', isDefault: false, teamId: 't1',
      });
      prisma.media.count.mockResolvedValue(0);
      // hasFilesRecursive：f-1 的孩子 [c1]，c1 无孩子
      // 消解：重查 f-1 的孩子 + root 现有名字
      prisma.materialFolder.findMany
        .mockResolvedValueOnce([{ id: 'c1', name: 'A', teamId: 't1' }]) // hasFilesRecursive: children of f-1
        .mockResolvedValueOnce([])                                       // hasFilesRecursive: children of c1
        .mockResolvedValueOnce([{ id: 'c1', name: 'A', teamId: 't1' }]) // 消解: children of f-1
        .mockResolvedValueOnce([{ name: 'A' }]);                        // 消解: root names
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.materialFolder.updateMany.mockResolvedValue({});
      prisma.media.updateMany.mockResolvedValue({});

      await service.remove('f-1', 'user-1');

      expect(prisma.materialFolder.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: 'A (1)' },
      });
    });

    it('删父提 root：兄弟同名家族共享序数空间，防互撞', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: 'P', isDefault: false, teamId: 't1',
      });
      prisma.media.count.mockResolvedValue(0);
      prisma.materialFolder.findMany
        .mockResolvedValueOnce([{ id: 'c1', name: 'A', teamId: 't1' }, { id: 'c2', name: 'A (1)', teamId: 't1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'c1', name: 'A', teamId: 't1' }, { id: 'c2', name: 'A (1)', teamId: 't1' }])
        .mockResolvedValueOnce([{ name: 'A' }]);
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.materialFolder.updateMany.mockResolvedValue({});
      prisma.media.updateMany.mockResolvedValue({});

      await service.remove('f-1', 'user-1');

      expect(prisma.materialFolder.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: 'A (1)' },
      });
      expect(prisma.materialFolder.update).toHaveBeenCalledWith({
        where: { id: 'c2' },
        data: { name: 'A (2)' },
      });
    });

    it('should allow deleting a default folder', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: '角色', isDefault: true, teamId: 't1',
      });
      prisma.media.count.mockResolvedValue(0);
      prisma.materialFolder.findMany.mockResolvedValue([]);
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.materialFolder.updateMany.mockResolvedValue({});
      prisma.media.updateMany.mockResolvedValue({});

      await service.remove('f-1', 'u1');

      expect(prisma.materialFolder.update).toHaveBeenCalled();
    });

    it('should throw if folder not found', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue(null);
      await expect(service.remove('f-99', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('should throw if folder has direct media files', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: 'Test', isDefault: false, teamId: 't1',
      });
      prisma.media.count.mockResolvedValue(3);
      await expect(service.remove('f-1', 'user-1')).rejects.toThrow('文件夹或其子文件夹中存在文件，请先清空后再删除');
    });

    it('should throw if descendant folder has media files', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: 'Parent', isDefault: false, teamId: 't1',
      });
      prisma.media.count.mockResolvedValueOnce(0); // direct: no files
      prisma.materialFolder.findMany.mockResolvedValue([
        { id: 'child-1', teamId: 't1' },
        { id: 'child-2', teamId: 't1' },
      ]);
      prisma.media.count.mockResolvedValueOnce(0); // child-1: no files
      prisma.media.count.mockResolvedValueOnce(5); // child-2: 5 files → should block

      await expect(service.remove('f-1', 'user-1')).rejects.toThrow('文件夹或其子文件夹中存在文件，请先清空后再删除');
    });

    it('should delete when no files in folder or descendants', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({
        id: 'f-1', name: 'Empty', isDefault: false, teamId: 't1',
      });
      prisma.media.count.mockResolvedValue(0); // no direct files
      prisma.materialFolder.findMany.mockResolvedValue([]); // no children
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.materialFolder.updateMany.mockResolvedValue({});
      prisma.media.updateMany.mockResolvedValue({});

      await service.remove('f-1', 'user-1');

      expect(prisma.materialFolder.update).toHaveBeenCalledWith({
        where: { id: 'f-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });

  describe('moveUp', () => {
    it('should swap sortOrder with previous folder', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-2', sortOrder: 2, parentId: null, isDefault: false, teamId: 't1' })
        .mockResolvedValueOnce({ id: 'f-1', sortOrder: 1, parentId: null, teamId: 't1' });
      prisma.materialFolder.update.mockResolvedValue({});

      await service.moveUp('f-2', 'u1');

      expect(prisma.materialFolder.findFirst).toHaveBeenCalledWith({
        where: { id: 'f-2', teamId: 't1', deletedAt: null },
      });
      expect(prisma.materialFolder.update).toHaveBeenCalledTimes(2);
    });

    it('should do nothing when already first', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-1', sortOrder: 0, parentId: null, isDefault: false, teamId: 't1' })
        .mockResolvedValueOnce(null); // no previous folder

      await service.moveUp('f-1', 'u1');

      expect(prisma.materialFolder.update).not.toHaveBeenCalled();
    });

    it('should throw if folder not found', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue(null);
      await expect(service.moveUp('f-99', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('should allow moving up a default folder', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-2', name: '角色', sortOrder: 2, parentId: null, isDefault: true, teamId: 't1' })
        .mockResolvedValueOnce({ id: 'f-1', name: '场景', sortOrder: 1, parentId: null, teamId: 't1' });
      prisma.materialFolder.update.mockResolvedValue({});

      await service.moveUp('f-2', 'u1');

      expect(prisma.materialFolder.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('moveFolder', () => {
    it('should place at beginning when afterId is null', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽文件夹', parentId: 'p1', sortOrder: 5, isDefault: false, teamId: 't1' })
        .mockResolvedValueOnce({ id: 'p1', name: '目标父', parentId: null, sortOrder: 0, isDefault: false, teamId: 't1' });
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
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽', parentId: null, sortOrder: 0, isDefault: false, teamId: 't1' })
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
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽', parentId: 'p-old', sortOrder: 0, isDefault: false, teamId: 't1' })
        .mockResolvedValueOnce({ id: 'p-new', name: '新父', parentId: null, sortOrder: 0, isDefault: false, teamId: 't1' });
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

    it('移动越权：目标父文件夹属其他团队 → 统一报目标父文件夹不存在', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽', parentId: null, sortOrder: 0, isDefault: false, teamId: 't1' })
        .mockResolvedValueOnce(null); // 其他团队的父，teamId 过滤后查不到

      await expect(
        service.moveFolder('f-move', { parentId: 'p-other-team', afterId: null }, 'u1'),
      ).rejects.toThrow('目标父文件夹不存在');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('移动同名：目标父下已有同名文件夹 → 拒绝（防撞 partial unique index）', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', name: 'A', parentId: 'p-old', sortOrder: 0, isDefault: false, teamId: 't1' })
        .mockResolvedValueOnce({ id: 'p-new', name: '新父', parentId: null, isDefault: false, teamId: 't1' })
        .mockResolvedValueOnce({ parentId: null }) // getFolderDepth: p-new
        .mockResolvedValueOnce({ parentId: null }) // isDescendant: p-new
        .mockResolvedValueOnce({ id: 'dup', name: 'A', teamId: 't1' }); // 同名预检查命中
      prisma.materialFolder.findMany.mockResolvedValue([]);

      await expect(
        service.moveFolder('f-move', { parentId: 'p-new', afterId: null }, 'u1'),
      ).rejects.toThrow('目标目录下已存在同名文件夹');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw if folder not found', async () => {
      prisma.materialFolder.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.moveFolder('not-found', { parentId: null, afterId: null }, 'u1'),
      ).rejects.toThrow('文件夹不存在');
    });

    it('should allow moving a default folder', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-1', name: '角色', parentId: null, sortOrder: 2, isDefault: true, teamId: 't1' });
      prisma.materialFolder.findMany.mockResolvedValue([
        { id: 's1', sortOrder: 0 },
        { id: 's2', sortOrder: 1 },
      ]);
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: any[]) => Promise.all(ops));

      await service.moveFolder('f-1', { parentId: null, afterId: 's1' }, 'u1');

      // Default folder moved successfully, siblings renumbered
      expect(prisma.materialFolder.update).toHaveBeenCalled();
    });

    it('should throw if target parent not found', async () => {
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', isDefault: false, teamId: 't1' })
        .mockResolvedValueOnce(null);
      await expect(
        service.moveFolder('f-move', { parentId: 'bad-parent', afterId: null }, 'u1'),
      ).rejects.toThrow('目标父文件夹不存在');
    });

    it('should throw on circular reference', async () => {
      // p-new's parent is f-move → getFolderDepth returns 1, then isDescendant detects the cycle
      prisma.materialFolder.findFirst
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽', parentId: 'p-old', sortOrder: 0, isDefault: false, teamId: 't1' }) // folder check
        .mockResolvedValueOnce({ id: 'p-new', name: '新父', parentId: 'f-move', isDefault: false, teamId: 't1' }) // target parent check
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
        .mockResolvedValueOnce({ id: 'f-move', name: '拖拽', parentId: null, sortOrder: 0, isDefault: false, teamId: 't1' })
        .mockResolvedValueOnce({ id: 'p-child', name: '子', parentId: 'p-parent', isDefault: false, teamId: 't1' })
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

  describe('update 写入收窄（spec §四）', () => {
    it('只写 name，不透传 dto 整体（SET teamId 隐式不变量消除）', async () => {
      prisma.materialFolder.findFirst.mockResolvedValue({ id: 'f1', teamId: 't1' });
      prisma.materialFolder.update.mockResolvedValue({ id: 'f1' });
      await service.update('f1', { name: '新名', teamId: 't1' } as any, 'u1');
      expect(prisma.materialFolder.update).toHaveBeenCalledWith({
        where: { id: 'f1' },
        data: { name: '新名' },
      });
    });
  });
});
