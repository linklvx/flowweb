import { Test, TestingModule } from '@nestjs/testing';
import { CanvasService } from './canvas.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';
import { TeamService } from '../team/team.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

describe('CanvasService', () => {
  let service: CanvasService;
  let prisma: any;
  let folderService: any;
  let templateService: any;

  beforeEach(async () => {
    prisma = {
      folder: { findFirst: vi.fn().mockResolvedValue(null) },
      canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
      teamMember: { findFirst: vi.fn().mockResolvedValue(null) },
      template: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 't1' }),
      },
      $transaction: vi.fn(),
    };
    folderService = { touch: vi.fn() };
    templateService = { clearCache: vi.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanvasService,
        { provide: PrismaService, useValue: prisma },
        { provide: FolderService, useValue: folderService },
        { provide: TemplateService, useValue: templateService },
        { provide: TeamService, useValue: { ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 'team1' }) } },
      ],
    }).compile();
    service = module.get<CanvasService>(CanvasService);
  });

  describe('create', () => {
    it('事务创建 CanvasProject + Template，返回 templateId/projectId/name', async () => {
      prisma.folder.findFirst.mockResolvedValue({ id: 'f1' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn({
        team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
        canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
        template: { create: vi.fn().mockResolvedValue({ id: 't1' }) },
      }));
      const result = await service.create('新画布', 'f1', 'u1');
      expect(result).toEqual({ templateId: 't1', projectId: 'p1', name: '新画布', teamId: 'team1' });
      expect(templateService.clearCache).toHaveBeenCalled();
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
    });

    it('事务内 Template 数据含 folderId', async () => {
      const templateCreate = vi.fn().mockResolvedValue({ id: 't1' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn({
        team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
        canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
        template: { create: templateCreate },
      }));
      await service.create('新画布', null, 'u1');
      expect(templateCreate).toHaveBeenCalledWith({
        data: {
          name: '新画布', userId: 'u1', teamId: 'team1', projectId: 'p1',
          folderId: null,
        },
      });
      expect(folderService.touch).not.toHaveBeenCalled();
    });

    it('folderId 非本人文件夹抛 BadRequest', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.create('新画布', 'fx', 'u1')).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('空名默认编号（Fix 7）', () => {
      function mockTx(names: string[]) {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue(0),
          team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
          canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
          template: {
            findMany: vi.fn().mockResolvedValue(names.map((name) => ({ name }))),
            create: vi.fn().mockResolvedValue({ id: 't1' }),
          },
        };
        prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
        return tx;
      }

      it('空名走编号：事务内取 advisory lock，无已有未命名 → 画布1', async () => {
        const tx = mockTx(['我的画布']);
        const result = await service.create('', null, 'u1');
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        expect(tx.template.findMany).toHaveBeenCalledWith({ where: { teamId: 'team1' }, select: { name: true } });
        expect(tx.canvasProject.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: '画布1' }) });
        expect(tx.template.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: '画布1' }) });
        expect(result).toEqual({ templateId: 't1', projectId: 'p1', name: '画布1', teamId: 'team1' });
      });

      it('已有 画布1、3 → 下一个为 4，非编号名不影响编号，旧规则未命名项目N 不再参与编号', async () => {
        const tx = mockTx(['画布1', '我的画布', '画布3', '未命名项目1']);
        const result = await service.create('', null, 'u1');
        expect(result.name).toBe('画布4');
      });

      it('空白名同样走编号分支', async () => {
        const tx = mockTx([]);
        const result = await service.create('   ', null, 'u1');
        expect(tx.template.findMany).toHaveBeenCalled();
        expect(result.name).toBe('画布1');
      });

      it('非空名不取锁、不查编号，原名创建', async () => {
        const tx = mockTx(['未命名项目1']);
        const result = await service.create('我的新画布', null, 'u1');
        expect(tx.$executeRaw).not.toHaveBeenCalled();
        expect(tx.template.findMany).not.toHaveBeenCalled();
        expect(tx.canvasProject.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: '我的新画布' }) });
        expect(result.name).toBe('我的新画布');
      });
    });
  });

  describe('getNextUntitledName（Fix 8）', () => {
    it('无未命名画布 → 画布1', async () => {
      prisma.template.findMany.mockResolvedValue([{ name: '我的画布' }]);
      await expect(service.getNextUntitledName('u1')).resolves.toBe('画布1');
      expect(prisma.template.findMany).toHaveBeenCalledWith({ where: { teamId: 'team1' }, select: { name: true } });
    });

    it('已有 画布1、3 → 画布4', async () => {
      prisma.template.findMany.mockResolvedValue([{ name: '画布1' }, { name: '画布3' }]);
      await expect(service.getNextUntitledName('u1')).resolves.toBe('画布4');
    });
  });

  describe('getNextUntitledName teamId 维度', () => {
    it('传 teamId 时按该团队编号（校验成员）', async () => {
      prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
      prisma.template.findMany.mockResolvedValue([{ name: '画布2' }]);
      await expect(service.getNextUntitledName('u1', 't-team')).resolves.toBe('画布3');
      expect(prisma.template.findMany).toHaveBeenCalledWith({ where: { teamId: 't-team' }, select: { name: true } });
    });
    it('非成员传 teamId → 403', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.getNextUntitledName('u1', 't-team')).rejects.toThrow('非团队成员');
    });
  });

  describe('团队化', () => {
    it('create 传 teamId 时挂指定团队并校验成员', async () => {
      prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.canvasProject.create.mockResolvedValue({ id: 'p1', teamId: 't-team' });
      prisma.template.create.mockResolvedValue({ id: 'tp1' });
      const result = await service.create('名字', null, 'u1', 't-team');
      expect(prisma.teamMember.findFirst).toHaveBeenCalledWith({
        where: { teamId: 't-team', userId: 'u1', team: { status: 'ACTIVE' } },
        select: { role: true },
      });
      expect(prisma.canvasProject.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ teamId: 't-team' }) }),
      );
      expect(result).toEqual({ templateId: 'tp1', projectId: 'p1', name: '名字', teamId: 't-team' });
    });

    it('create 返回值含 teamId（前端画布 store 需要）', async () => {
      // 范式要点（上轮审核 P1）：
      // - teamMember 必须用 findFirst（顶层 mock 只有它，assertTeamMember 也只调它）
      // - 不得出现 prisma.team.findFirst —— 顶层 prisma mock 没有 team 键，
      //   且 create 事务体不调 team.findFirst（既有用例里的 team.findFirst 在 $transaction 内联 tx 对象中）
      // - 非空名不走编号分支，不调 template.findMany，无需 mock
      prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
      prisma.canvasProject.create.mockResolvedValue({ id: 'p1', teamId: 't-team' });
      prisma.template.create.mockResolvedValue({ id: 'tp1' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      const result = await service.create('画布', null, 'u1', 't-team');
      expect(result.teamId).toBe('t-team');
    });

    it('create 传非成员 teamId 时抛 403', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.create('x', null, 'u1', 't-team')).rejects.toThrow('非团队成员');
    });

    it('create folderId 跨团队时抛 400', async () => {
      prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.create('x', 'f-other', 'u1', 't-team')).rejects.toThrow('目标文件夹不存在');
    });
  });
});
