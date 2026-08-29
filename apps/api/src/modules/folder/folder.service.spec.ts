import { Test, TestingModule } from '@nestjs/testing';
import { FolderService } from './folder.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('FolderService', () => {
  let service: FolderService;
  let prisma: any;
  let teamService: { ensureDefaultTeam: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      folder: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'f1', name: '新建', userId: 'u1' }),
        update: vi.fn().mockResolvedValue({ id: 'f1', name: '改名' }),
        delete: vi.fn().mockResolvedValue({ id: 'f1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      template: { count: vi.fn().mockResolvedValue(0) },
      teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }) },
      $transaction: vi.fn().mockResolvedValue([0, { id: 'f1' }]),
    };
    teamService = { ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 't1' }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FolderService,
        { provide: PrismaService, useValue: prisma },
        { provide: TeamService, useValue: teamService },
      ],
    }).compile();
    service = module.get<FolderService>(FolderService);
  });

  describe('list', () => {
    it('list 返回聚合 canvasCount 与最近3张缩略图（默认团队 root 维度）', async () => {
      prisma.folder.findMany.mockResolvedValue([
        {
          id: 'f1', name: '工作', parentId: null,
          createdAt: new Date('2026-08-01'), updatedAt: new Date('2026-08-18'),
          templates: [
            { id: 't1', coverUrl: 'http://a.png' },
            { id: 't2', coverUrl: null },
          ],
          _count: { templates: 5 },
        },
      ]);
      const result = await service.list('u1');
      expect(teamService.ensureDefaultTeam).toHaveBeenCalledWith('u1');
      expect(prisma.folder.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { teamId: 't1', parentId: null },
        include: {
          templates: { take: 3, orderBy: { updatedAt: 'desc' }, select: { id: true, coverUrl: true } },
          _count: { select: { templates: true } },
        },
      }));
      expect(result.folders[0].canvasCount).toBe(5);
      expect(result.folders[0].thumbnails).toEqual([
        { id: 't1', coverUrl: 'http://a.png' },
        { id: 't2', coverUrl: null },
      ]);
    });

    it('list 按 teamId 查询（队友可见）', async () => {
      prisma.folder.findMany.mockResolvedValue([]);
      await service.list('u1', 't-team');
      expect(prisma.folder.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ teamId: 't-team', parentId: null }),
      }));
    });

    it('他团队成员猜 teamId 调 list → 403', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.list('u1', 't-foreign')).rejects.toThrow('非团队成员');
      expect(prisma.folder.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('create 同级重名抛 BadRequest', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'f1', name: '工作' });
      await expect(service.create({ name: '工作' }, 'u1')).rejects.toThrow(BadRequestException);
    });

    it('create 正常创建（写入解析到的 teamId，userId 保留为创建人）', async () => {
      const folder = await service.create({ name: '新文件夹' }, 'u1');
      expect(prisma.folder.create).toHaveBeenCalledWith({
        data: { name: '新文件夹', userId: 'u1', teamId: 't1', parentId: null },
      });
      expect(folder.id).toBe('f1');
    });

    it('create 同名预检查 where 切 teamId 维度', async () => {
      await service.create({ name: 'x' }, 'u1', 't-team');
      expect(prisma.folder.findFirst).toHaveBeenCalledWith({
        where: { teamId: 't-team', parentId: null, name: 'x' },
      });
    });

    it('create 校验 parent.teamId 一致，防跨团队挂载', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'f1', teamId: 't-other' });
      await expect(service.create({ name: 'x', parentId: 'f1' }, 'u1', 't-team')).rejects.toThrow('跨团队');
      expect(prisma.folder.create).not.toHaveBeenCalled();
    });

    it('他团队成员猜 teamId 调 create → 403', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.create({ name: 'x' }, 'u1', 't-foreign')).rejects.toThrow(ForbiddenException);
      expect(prisma.folder.create).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('rename 排除自身的重名校验：同名其他文件夹存在才报错（teamId 维度）', async () => {
      prisma.folder.findFirst.mockImplementation(({ where }: any) => {
        if (where.id?.not) return Promise.resolve(null);
        if (where.id) return Promise.resolve({ id: 'f1', name: '旧名', parentId: null, teamId: 't1' });
        return Promise.resolve(null);
      });
      await service.rename('f1', '任何名', 'u1');
      expect(prisma.folder.findFirst).toHaveBeenLastCalledWith({
        where: { teamId: 't1', parentId: null, name: '任何名', id: { not: 'f1' } },
      });
    });

    it('rename 同名其他文件夹存在抛 BadRequest', async () => {
      prisma.folder.findFirst.mockImplementation(({ where }: any) =>
        where.id?.not
          ? Promise.resolve({ id: 'f2' })
          : where.id
            ? Promise.resolve({ id: 'f1', name: '旧名', parentId: null, teamId: 't1' })
            : Promise.resolve(null),
      );
      await expect(service.rename('f1', '重名', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('rename 非本人/跨团队文件夹抛 NotFound', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.rename('fx', '名', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('他团队成员猜 teamId 调 rename → 403', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.rename('f1', '名', 'u1', 't-foreign')).rejects.toThrow(ForbiddenException);
      expect(prisma.folder.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('remove 在同事务内 count + delete，返回 movedCanvasCount', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'f1', teamId: 't1' });
      prisma.folder.findMany.mockResolvedValue([]);
      prisma.$transaction.mockResolvedValue([3, { id: 'f1' }]);
      const result = await service.remove('f1', 'u1');
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({ movedCanvasCount: 3 });
    });

    it('remove 删父文件夹前消解子文件夹与 root 现有同名 → rename 为 name (1)', async () => {
      prisma.folder.findFirst.mockImplementation(({ where }: any) => {
        if (typeof where.id === 'string') return Promise.resolve({ id: 'f1', teamId: 't1' });
        if (where.name === 'X') return Promise.resolve({ id: 'fx' }); // root 已有 X
        return Promise.resolve(null);
      });
      prisma.folder.findMany.mockResolvedValue([{ id: 'c1', name: 'X' }]);
      await service.remove('f1', 'u1', 't1');
      expect(prisma.folder.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { name: 'X (1)' } });
    });

    it('remove 消解递增：root 已有 X 和 X (1) → 子文件夹 rename 为 X (2)', async () => {
      prisma.folder.findFirst.mockImplementation(({ where }: any) => {
        if (typeof where.id === 'string') return Promise.resolve({ id: 'f1', teamId: 't1' });
        if (where.name === 'X' || where.name === 'X (1)') return Promise.resolve({ id: 'fx' });
        return Promise.resolve(null);
      });
      prisma.folder.findMany.mockResolvedValue([{ id: 'c1', name: 'X' }]);
      await service.remove('f1', 'u1', 't1');
      expect(prisma.folder.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { name: 'X (2)' } });
    });

    it('remove 子文件夹与 root 无同名时不 rename', async () => {
      prisma.folder.findFirst.mockImplementation(({ where }: any) =>
        typeof where.id === 'string' ? Promise.resolve({ id: 'f1', teamId: 't1' }) : Promise.resolve(null),
      );
      prisma.folder.findMany.mockResolvedValue([{ id: 'c1', name: '独一名' }]);
      await service.remove('f1', 'u1', 't1');
      expect(prisma.folder.update).not.toHaveBeenCalled();
    });

    it('他团队成员猜 teamId 调 remove → 403', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.remove('f1', 'u1', 't-foreign')).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('touch', () => {
    it('touch 显式更新 updatedAt（updateMany 不触发 @updatedAt）', async () => {
      await service.touch(['f1', 'f2', null]);
      expect(prisma.folder.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['f1', 'f2'] } },
        data: { updatedAt: expect.any(Date) },
      });
    });

    it('touch 空数组不发起查询', async () => {
      await service.touch([null]);
      expect(prisma.folder.updateMany).not.toHaveBeenCalled();
    });
  });
});
