import { Test, TestingModule } from '@nestjs/testing';
import { TemplateService } from './template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { TeamService } from '../team/team.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('TemplateService', () => {
  let service: TemplateService;
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    template: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    folder: {
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    canvasProject: {
      findFirst: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    teamMember: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    user: {
      upsert: ReturnType<typeof vi.fn>;
    };
  };
  let projectService: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let folderService: {
    touch: ReturnType<typeof vi.fn>;
  };
  let perm: {
    resolve: ReturnType<typeof vi.fn>;
    assertEditor: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn((ops: any[]) => Promise.resolve(ops.map(() => ({})))),
      template: {
        create: vi.fn().mockResolvedValue({ id: 't1', name: 'Test', userId: 'u1', isPublic: false }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      folder: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
      canvasProject: {
        findFirst: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue({}),
      },
      // findFirst：assertTeamMember 用（默认成员放行）；findUnique：getTemplate/update 的 OR 成员直查（默认非成员）
      teamMember: {
        findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      user: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    projectService = {
      findById: vi.fn().mockResolvedValue({
        id: 'p1', userId: 'u1', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
      }),
      create: vi.fn().mockImplementation((name: string) => Promise.resolve({ id: 'p2', name })),
    };
    folderService = {
      touch: vi.fn(),
    };
    perm = {
      resolve: vi.fn().mockResolvedValue(null),
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectService, useValue: projectService },
        { provide: FolderService, useValue: folderService },
        { provide: TeamService, useValue: { ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 'team1' }) } },
        { provide: ProjectPermissionService, useValue: perm },
      ],
    }).compile();

    service = module.get<TemplateService>(TemplateService);
  });

  describe('findMany', () => {
    it('should return paginated results with isOwner flag', async () => {
      prisma.template.findMany.mockResolvedValue([
        { id: 't1', name: 'T1', userId: 'u1', isPublic: true, importCount: 5,
          category: 'OFFICIAL', description: '', coverUrl: '',
          createdAt: new Date(), updatedAt: new Date() },
      ]);
      prisma.template.count.mockResolvedValue(1);
      const result = await service.findMany({ type: 'official', page: 1, limit: 20 }, 'u1');
      expect(result.templates[0].isOwner).toBe(true);
      expect(result.total).toBe(1);
    });

    it('should filter by type=my（团队化 B2：本人 OR 团队项目）', async () => {
      prisma.template.count.mockResolvedValue(0);
      await service.findMany({ type: 'my', page: 1, limit: 20 }, 'u1');
      const callArgs = prisma.template.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toEqual([{ userId: 'u1' }, { project: { teamId: 'team1' } }]);
    });

    describe('findMany folderId 过滤', () => {
      it('type=my + folderId=root 过滤 folderId=null（与团队 OR 并列）', async () => {
        prisma.template.findMany.mockResolvedValue([]);
        await service.findMany({ type: 'my', folderId: 'root' } as any, 'u1');
        expect(prisma.template.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({
            folderId: null,
            OR: [{ userId: 'u1' }, { project: { teamId: 'team1' } }],
          }),
        }));
      });

      it('type=my + 具体 folderId 精确匹配', async () => {
        prisma.template.findMany.mockResolvedValue([]);
        await service.findMany({ type: 'my', folderId: 'f1' } as any, 'u1');
        expect(prisma.template.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ folderId: 'f1' }),
        }));
      });

      it('非 type=my 时 folderId 被忽略', async () => {
        prisma.template.findMany.mockResolvedValue([]);
        await service.findMany({ type: 'community', folderId: 'f1' } as any, 'u1');
        const where = prisma.template.findMany.mock.calls[0][0].where;
        expect(where.folderId).toBeUndefined();
      });
    });

    describe('teamId 分支', () => {
      it('findMany 传 teamId 时按本表 teamId 直查（不走 project 反查、不含 userId 兜底）', async () => {
        prisma.template.findMany.mockResolvedValue([]);
        await service.findMany({ type: 'my', teamId: 't-team' }, 'u1');
        expect(prisma.template.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: { teamId: 't-team' },
        }));
      });

      it('他团队成员猜 teamId 调 findMany → 403', async () => {
        prisma.teamMember.findFirst.mockResolvedValue(null);
        await expect(service.findMany({ type: 'my', teamId: 't-foreign' }, 'u1')).rejects.toThrow('非团队成员');
        expect(prisma.template.findMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('getTemplate', () => {
    it('should return template if public', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', isPublic: true, userId: 'creator' });
      const result = await service.getTemplate('t1', 'other-user');
      expect(result.id).toBe('t1');
    });

    it('should throw ForbiddenException if private and not creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', isPublic: false, userId: 'creator' });
      await expect(service.getTemplate('t1', 'other-user')).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if template does not exist', async () => {
      prisma.template.findUnique.mockResolvedValue(null);
      await expect(service.getTemplate('nonexistent', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('getTemplate 团队模板对团队成员放行（teamMember 直查）', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 'tp1', userId: 'creator', isPublic: false, teamId: 't-team', projectId: 'p1' });
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
      const result = await service.getTemplate('tp1', 'teammate');
      expect(result.isOwner).toBe(false);
      expect(perm.resolve).not.toHaveBeenCalled(); // 成员已放行，无需再走项目权限链
    });

    it('getTemplate 非团队成员但项目协作者可打开（OR 关系）', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 'tp1', userId: 'creator', isPublic: false, teamId: 't-team', projectId: 'p1' });
      prisma.teamMember.findUnique.mockResolvedValue(null);
      perm.resolve.mockResolvedValue('PROJECT_EDITOR');
      const result = await service.getTemplate('tp1', 'outside-collaborator');
      expect(result.isOwner).toBe(false);
    });

    it('getTemplate 既非团队成员又非项目协作者 → 403', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 'tp1', userId: 'creator', isPublic: false, teamId: 't-team', projectId: 'p1' });
      prisma.teamMember.findUnique.mockResolvedValue(null);
      perm.resolve.mockResolvedValue(null);
      await expect(service.getTemplate('tp1', 'stranger')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('should update when user is creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1' });
      await service.update('t1', { name: 'Updated' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't1' }, data: { name: 'Updated' },
      });
    });

    it('should throw ForbiddenException when not creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'creator' });
      await expect(
        service.update('t1', { name: 'Hacked' }, 'other-user'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.template.update).not.toHaveBeenCalled();
    });

    it('团队成员（非创建者）可编辑团队模板（OR 关系）', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'creator', teamId: 't-team' });
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
      await service.update('t1', { name: '新名' }, 'teammate');
      expect(perm.assertEditor).not.toHaveBeenCalled();
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't1' }, data: { name: '新名' },
      });
    });

    it('项目协作者（非团队成员非创建者）可编辑（OR 关系）', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'creator', teamId: 't-team', projectId: 'p1' });
      prisma.teamMember.findUnique.mockResolvedValue(null);
      await service.update('t1', { name: '新名' }, 'collab');
      expect(perm.assertEditor).toHaveBeenCalledWith('p1', 'collab');
      expect(prisma.template.update).toHaveBeenCalled();
    });

    it('既非团队成员又非项目协作者 → 403', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'creator', teamId: 't-team', projectId: 'p1' });
      prisma.teamMember.findUnique.mockResolvedValue(null);
      perm.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      await expect(service.update('t1', { name: 'x' }, 'stranger')).rejects.toThrow(ForbiddenException);
      expect(prisma.template.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete when user is creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1' });
      await service.delete('t1', 'u1');
      expect(prisma.template.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('should throw ForbiddenException when not creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'creator' });
      await expect(service.delete('t1', 'other-user')).rejects.toThrow(ForbiddenException);
    });

    it('非创建者且 perm 非 PROJECT_OWNER（EDITOR）→ 403（delete 收紧 D1）', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'creator', projectId: 'p1' });
      perm.resolve.mockResolvedValue('PROJECT_EDITOR');
      await expect(service.delete('t1', 'editor')).rejects.toThrow('仅创建者或项目 OWNER 可删除');
      expect(prisma.template.delete).not.toHaveBeenCalled();
    });

    it('非创建者但项目 OWNER（perm.resolve 返回 PROJECT_OWNER）放行', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'creator', projectId: 'p1' });
      perm.resolve.mockResolvedValue('PROJECT_OWNER');
      await service.delete('t1', 'team-owner');
      expect(prisma.template.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    describe('级联删除工程', () => {
      it('同事务删除 Template 与关联 CanvasProject，并 touch 文件夹', async () => {
        prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1', projectId: 'p1' });
        prisma.$transaction.mockResolvedValue([{}, {}]);
        await service.delete('t1', 'u1');
        const ops = prisma.$transaction.mock.calls[0][0];
        expect(ops).toHaveLength(2);
        expect(folderService.touch).toHaveBeenCalledWith(['f1']);
      });

      it('无关联工程时不删工程', async () => {
        prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: null, projectId: null });
        prisma.$transaction.mockResolvedValue([{}]);
        await service.delete('t1', 'u1');
        expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(1);
      });
    });
  });

  describe('import', () => {
    const validTemplate = {
      id: 't1', name: 'Test Template', isPublic: true, userId: 'creator',
      templateData: {
        nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { text: 'hi' } }],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    };

    it('should import public template and create project', async () => {
      prisma.template.findUnique.mockResolvedValue(validTemplate);
      const result = await service.import('t1', 'other-user');
      expect(projectService.create).toHaveBeenCalled();
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { importCount: { increment: 1 } },
      });
      expect(result.name).toBe('Test Template (副本)');
    });

    it('should throw ForbiddenException if private and not creator', async () => {
      prisma.template.findUnique.mockResolvedValue({ ...validTemplate, isPublic: false });
      await expect(service.import('t1', 'other-user')).rejects.toThrow(ForbiddenException);
    });

    it('透传解析后的 teamId 至 projectService.create（第 5 参，外部传参优先）', async () => {
      prisma.template.findUnique.mockResolvedValue(validTemplate);
      await service.import('t1', 'u1', 't-team');
      const args = projectService.create.mock.calls[0];
      expect(args[0]).toBe('Test Template (副本)');
      expect(args[1]).toBe('u1');
      expect(args[4]).toBe('t-team');
    });

    it('不传 teamId 时解析默认团队并透传', async () => {
      prisma.template.findUnique.mockResolvedValue(validTemplate);
      await service.import('t1', 'u1');
      const args = projectService.create.mock.calls[0];
      expect(args[4]).toBe('team1');
    });

    it('重名循环切 teamId 维度（队友导入同模板不产生错乱编号）', async () => {
      prisma.template.findUnique.mockResolvedValue(validTemplate);
      prisma.canvasProject.findFirst
        .mockResolvedValueOnce({ id: 'p0' })
        .mockResolvedValueOnce(null);
      const result = await service.import('t1', 'u1');
      expect(prisma.canvasProject.findFirst).toHaveBeenCalledWith({
        where: { name: 'Test Template (副本)', teamId: 'team1' },
      });
      expect(prisma.canvasProject.findFirst).toHaveBeenLastCalledWith({
        where: { name: 'Test Template (副本 2)', teamId: 'team1' },
      });
      expect(result.name).toBe('Test Template (副本 2)');
    });

    it('他团队成员猜 teamId 调 import → 403', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);
      await expect(service.import('t1', 'u1', 't-foreign')).rejects.toThrow(ForbiddenException);
      expect(projectService.create).not.toHaveBeenCalled();
    });
  });

  describe('initOfficialTemplates', () => {
    it('不存在时创建官方模板，已存在时跳过', async () => {
      await service.initOfficialTemplates();
      expect(prisma.template.create).toHaveBeenCalled();
      prisma.template.create.mockClear();
      prisma.template.findFirst.mockResolvedValue({ id: 'existing' } as never);
      await service.initOfficialTemplates();
      expect(prisma.template.create).not.toHaveBeenCalled();
    });
  });

  describe('update folderId 移动', () => {
    it('folderId 变化时校验目标文件夹归属（teamId 维度）并 touch 源与目标', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', teamId: 't1', folderId: 'f1' });
      prisma.folder.findFirst.mockResolvedValue({ id: 'f2', teamId: 't1' });
      prisma.template.update.mockResolvedValue({ id: 't1', folderId: 'f2' });
      await service.update('t1', { folderId: 'f2' } as any, 'u1');
      expect(prisma.folder.findFirst).toHaveBeenCalledWith({ where: { id: 'f2', teamId: 't1' } });
      expect(folderService.touch).toHaveBeenCalledWith(['f1', 'f2']);
    });

    it('目标文件夹不存在/跨团队（teamId 不匹配）抛 BadRequest', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', teamId: 't-team', folderId: null });
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.update('t1', { folderId: 'fx' } as any, 'u1')).rejects.toThrow(BadRequestException);
      expect(prisma.folder.findFirst).toHaveBeenCalledWith({ where: { id: 'fx', teamId: 't-team' } });
    });

    it('folderId 传 null 移到根目录，touch 源文件夹', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1' });
      prisma.template.update.mockResolvedValue({ id: 't1', folderId: null });
      await service.update('t1', { folderId: null } as any, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { folderId: null },
      });
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
    });

    it('改名时 touch 所在文件夹；isPublic 切换不 touch', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1' });
      prisma.template.update.mockResolvedValue({ id: 't1' });
      await service.update('t1', { name: '新名' } as any, 'u1');
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
      (folderService.touch as any).mockClear();
      await service.update('t1', { isPublic: true } as any, 'u1');
      expect(folderService.touch).not.toHaveBeenCalled();
    });
  });
});
