import { Test, TestingModule } from '@nestjs/testing';
import { TemplateService } from './template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FolderService } from '../folder/folder.service';
import { TeamService } from '../team/team.service';
import { TeamFundsGateService } from '../team/team-funds-gate.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('TemplateService', () => {
  let service: TemplateService;
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
    $queryRaw: ReturnType<typeof vi.fn>;
    template: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    folder: {
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    canvasProject: {
      delete: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    projectErasureRun: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    auditLog: { create: ReturnType<typeof vi.fn> };   // C4-c1：擦除动作 AuditLog 补位
    teamMember: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  let folderService: {
    touch: ReturnType<typeof vi.fn>;
  };
  let emitter: { emitAsync: ReturnType<typeof vi.fn> };
  let perm: {
    resolve: ReturnType<typeof vi.fn>;
    assertEditor: ReturnType<typeof vi.fn>;
  };
  let gate: { assertSettled: ReturnType<typeof vi.fn> };   // Y0b-1 Z4：级联删工程前置清算门 mock 面

  beforeEach(async () => {
    prisma = {
      // C4-a：交互式形态透传（delete=lockProject+fence+tombstone 单事务——tx=prisma 本体）
      $transaction: vi.fn((arg: any, opts?: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.resolve(arg.map(() => ({})))),
      $executeRaw: vi.fn().mockResolvedValue(0),   // lockProject（advisory）
      $queryRaw: vi.fn().mockResolvedValue([{ lifecycleState: 'ACTIVE' }]),   // openProjectErasure FOR SHARE 读
      template: {
        create: vi.fn().mockResolvedValue({ id: 't1', name: 'Test', userId: 'u1' }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
      folder: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
      canvasProject: {
        delete: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({ id: 'p1' }),
      },
      projectErasureRun: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ erasureId: 'run-1', scopeType: 'project', scopeId: 'p1', state: 'PENDING', dryRun: false }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },   // C4-c1：擦除动作 AuditLog 补位（openProjectErasure 同事务）
      // findFirst：assertTeamMember 用（默认成员放行）；findUnique：update/delete 的 OR 成员直查（默认非成员）
      teamMember: {
        findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    folderService = {
      touch: vi.fn(),
    };
    emitter = { emitAsync: vi.fn().mockResolvedValue([]) };   // Y0a-2 V11：project.gone emit 面
    perm = {
      resolve: vi.fn().mockResolvedValue(null),
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateService,
        { provide: PrismaService, useValue: prisma },
        { provide: FolderService, useValue: folderService },
        { provide: TeamService, useValue: { ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 'team1' }) } },
        { provide: TeamFundsGateService, useValue: { assertSettled: vi.fn().mockResolvedValue(undefined) } },
        { provide: ProjectPermissionService, useValue: perm },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get<TemplateService>(TemplateService);
    gate = module.get(TeamFundsGateService) as any;
  });

  describe('findMany', () => {
    it('should return paginated results with isOwner flag（M0 后唯一源 type=my）', async () => {
      prisma.template.findMany.mockResolvedValue([
        { id: 't1', name: 'T1', userId: 'u1',
          createdAt: new Date(), updatedAt: new Date() },
      ]);
      prisma.template.count.mockResolvedValue(1);
      const result = await service.findMany({ type: 'my', page: 1, limit: 20 }, 'u1');
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

      it('folderId 判式塌缩：type 唯一取值 my（DTO 收窄）后 folderId 无条件生效', async () => {
        prisma.template.findMany.mockResolvedValue([]);
        await service.findMany({ folderId: 'f1' } as any, 'u1');
        const where = prisma.template.findMany.mock.calls[0][0].where;
        expect(where.folderId).toBe('f1');
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

  // C4-a 红③：delete=交互事务（lockProject+模板行删除+openProjectErasure〔fence+资金门+tombstone+run〕
  // 同事务原子——数组事务时代 gate 在事务外的竞窗根除）。
  describe('delete（C4-a tombstone-only）', () => {
    it('should delete when user is creator（无关联工程=仅删模板，返回 null）', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1' });
      const res = await service.delete('t1', 'u1');
      expect(res).toBeNull();
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

    it('非创建者但项目 OWNER（perm.resolve 返回 PROJECT_OWNER）放行（tombstone 链）', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'creator', projectId: 'p1' });
      perm.resolve.mockResolvedValue('PROJECT_OWNER');
      const run = await service.delete('t1', 'team-owner');
      expect(run).toMatchObject({ erasureId: 'run-1', scopeId: 'p1' });
      expect(prisma.template.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    });

    it('红③：模板行删除+fence+资金门（in-tx）+tombstone+run 同事务原子；提交后 emit project.gone', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1', projectId: 'p1' });
      const run = await service.delete('t1', 'u1');
      expect(run).toMatchObject({ erasureId: 'run-1', scopeType: 'project', scopeId: 'p1', state: 'PENDING' });
      // 交互事务（数组形态废止）：tx=prisma 本体——模板行删除与 tombstone 同事务
      expect(prisma.template.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
      expect(prisma.$executeRaw).toHaveBeenCalled();   // lockProject（advisory·锁序①）
      expect(gate.assertSettled).toHaveBeenCalledWith(prisma, { projectId: 'p1' });   // in-tx 资金门
      expect(prisma.canvasProject.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { lifecycleState: 'DELETING' } });   // tombstone（物理删废止）
      expect(prisma.canvasProject.delete).not.toHaveBeenCalled();
      expect(prisma.projectErasureRun.create).toHaveBeenCalledWith({
        data: { scopeType: 'project', scopeId: 'p1', requestedBy: 'u1', dryRun: false, parentRunId: null, teamId: null, state: 'PENDING' },
      });
      expect(emitter.emitAsync).toHaveBeenCalledWith('project.gone', { projectIds: ['p1'] });   // 提交后 emit（V11）
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
    });

    it('红③：资金门拦截 ⇒ 整事务回滚原子（模板行语义还原=不删不置位无 run 行不 emit）', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', projectId: 'p1' });
      gate.assertSettled.mockRejectedValueOnce(Object.assign(new Error('资金未清算'), { status: 409 }));
      await expect(service.delete('t1', 'u1')).rejects.toThrow('资金未清算');
      expect(prisma.canvasProject.update).not.toHaveBeenCalled();
      expect(prisma.projectErasureRun.create).not.toHaveBeenCalled();
      expect(emitter.emitAsync).not.toHaveBeenCalled();
      expect(folderService.touch).not.toHaveBeenCalled();
    });

    it('无关联工程：不查门不 emit（仅删模板，非项目删除入口）', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', projectId: null });
      await service.delete('t1', 'u1');
      expect(gate.assertSettled).not.toHaveBeenCalled();
      expect(emitter.emitAsync).not.toHaveBeenCalled();
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

    it('改名时 touch 所在文件夹', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1' });
      prisma.template.update.mockResolvedValue({ id: 't1' });
      await service.update('t1', { name: '新名' } as any, 'u1');
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
    });
  });
});
