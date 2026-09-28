import { Test, TestingModule } from '@nestjs/testing';
import { CanvasService } from './canvas.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';
import { TeamService } from '../team/team.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('CanvasService', () => {
  let service: CanvasService;
  let prisma: any;
  let projectService: any;
  let folderService: any;
  let templateService: any;
  let permSvc: { resolve: ReturnType<typeof vi.fn>; assertEditor: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      folder: { findFirst: vi.fn().mockResolvedValue(null) },
      canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
      teamMember: { findFirst: vi.fn().mockResolvedValue(null) },
      template: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 't1', status: 'SAVED' }),
        update: vi.fn().mockResolvedValue({ id: 't2', status: 'SAVED' }),
      },
      $transaction: vi.fn(),
    };
    projectService = {};
    folderService = { touch: vi.fn() };
    templateService = { clearCache: vi.fn() };
    permSvc = {
      resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
      assertEditor: vi.fn().mockResolvedValue('PROJECT_EDITOR'),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanvasService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectService, useValue: projectService },
        { provide: FolderService, useValue: folderService },
        { provide: TemplateService, useValue: templateService },
        { provide: TeamService, useValue: { ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 'team1' }) } },
        { provide: ProjectPermissionService, useValue: permSvc },
        { provide: CollabDocumentService, useValue: { readCanvas: vi.fn(), withDoc: vi.fn() } },
      ],
    }).compile();
    service = module.get<CanvasService>(CanvasService);
  });

  describe('create', () => {
    it('事务创建 CanvasProject + DRAFT Template，返回 templateId/projectId/name', async () => {
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

    it('事务内 Template 数据含 folderId/status DRAFT/isPublic false', async () => {
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
          folderId: null, status: 'DRAFT', isPublic: false,
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
        expect(tx.template.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: '画布1', status: 'DRAFT' }) });
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

  describe('save', () => {
    const project = {
      id: 'p1', userId: 'u1',
      nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
      edges: [{ id: 'e1', sourceId: 'n1', targetId: 'n1' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    beforeEach(() => {
      projectService.findById = vi.fn().mockResolvedValue({ id: 'p1', userId: 'u1', teamId: 'team1' });
      (service as any).collabDoc.readCanvas.mockResolvedValue({
        nodes: project.nodes,
        edges: project.edges.map((e: any) => ({ ...e })),
      });
      prisma.template.findUnique.mockResolvedValue(null);
    });

    it('无关联 Template 时创建，status=SAVED，规范化 edges 的 sourceId/targetId', async () => {
      const result = await service.save('p1', { name: '名', description: 'd', isPublic: false }, 'u1');
      expect(prisma.template.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: '名', description: 'd', isPublic: false, status: 'SAVED',
          projectId: 'p1', userId: 'u1', teamId: 'team1',
          templateData: {
            version: 1,
            nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
            edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        }),
      });
      expect(result.id).toBe('t1');
      expect(templateService.clearCache).toHaveBeenCalled();
    });

    it('有关联 Template 时更新且不 touch 文件夹', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't2', folderId: 'f1', isPublic: true });
      await service.save('p1', { name: '名' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't2' },
        data: expect.objectContaining({ name: '名', status: 'SAVED' }),
      });
      expect(prisma.template.create).not.toHaveBeenCalled();
      expect(folderService.touch).not.toHaveBeenCalled();
    });

    it('update 保留未传的 isPublic', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't2', isPublic: true });
      await service.save('p1', { name: '名' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't2' },
        data: expect.objectContaining({ isPublic: true }),
      });
    });

    it('save：VIEWER 403', async () => {
      permSvc.assertEditor.mockRejectedValue(new ForbiddenException('无项目编辑权限'));
      await expect(service.save('p1', { name: '名' }, 'u1')).rejects.toThrow('无项目编辑权限');
      expect(permSvc.assertEditor).toHaveBeenCalledWith('p1', 'u1');
    });

    it('并发首存 P2002 回退为 update', async () => {
      const p2002: any = new Error('Unique constraint failed');
      p2002.code = 'P2002';
      prisma.template.create.mockRejectedValueOnce(p2002);
      prisma.template.findUnique.mockResolvedValue({ id: 't2', isPublic: false });
      const result = await service.save('p1', { name: '名' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalled();
      expect(result.id).toBe('t2');
    });

    describe('save 导出展开式+归一+公开过滤（R0b/F29/F32，实现前必红）', () => {
      // v5 收口双助手：readCanvas 取既有接线 mock；savedTemplateData 兼容 create/update 两分支（calls 按序拼接）
      const readCanvas = () => (service as any).collabDoc.readCanvas;
      const savedTemplateData = (callIdx = 0) => {
        const calls = [...prisma.template.create.mock.calls, ...prisma.template.update.mock.calls];
        expect(calls.length).toBeGreaterThan(callIdx);   // 防悬空假绿（save 未触达写库时此断言先红）
        // plan 原文漏了参数数组一层取值（calls[callIdx] 是 args 数组），照抄会 TypeError 而非红在断言
        return (calls[callIdx] as any)[0].data.templateData;
      };
      beforeEach(() => vi.clearAllMocks());   // 清调用记录防跨用例 calls 污染（mockClear 语义不动外层已设实现）

      it('有值三键存续：含 parentId/width/height 的节点 save 后落库保留（现状剥键——必红主用例）', async () => {
        readCanvas().mockResolvedValue({
          nodes: [
            { id: 'g1', type: 'group', position: { x: 10, y: 10 }, data: { groupType: 'normal' }, parentId: null, width: 300, height: 200 },
            { id: 'c1', type: 'imageGen', position: { x: 15, y: 15 }, data: { prompt: 'cat' }, parentId: 'g1', width: 140, height: 90 },
          ],
          edges: [],
        });
        await service.save('p1', { name: 'T' }, 'u1');
        const saved = savedTemplateData();   // beforeEach 恒 findUnique→null → 走 create 分支（v5：原断言盯 update 必红在取参）
        const c1 = saved.nodes.find((n: any) => n.id === 'c1');
        expect(c1.parentId).toBe('g1');       // 现状 undefined——必红
        expect(c1.width).toBe(140);           // 现状 undefined——必红
        const g1 = saved.nodes.find((n: any) => n.id === 'g1');
        expect(saved.nodes.indexOf(g1)).toBeLessThan(saved.nodes.indexOf(c1)); // 父先子后（ensureParentFirst）
      });

      it('null/undefined 边界节点不抛错：width/height=null 键消失、data=undefined 落 {}（各一条）', async () => {
        readCanvas().mockResolvedValue({
          nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'a' }, parentId: null, width: null, height: null }],
          edges: [],
        });
        await expect(service.save('p1', { name: 'T' }, 'u1')).resolves.toBeDefined();
        readCanvas().mockResolvedValue({
          nodes: [{ id: 'n2', type: 'textInput', position: { x: 0, y: 0 }, data: undefined }],
          edges: [],
        });
        await expect(service.save('p1', { name: 'T' }, 'u1')).resolves.toBeDefined();
      });

      it('isPublic=true 保存=媒体内容变换（产品语义，非纯 id 剔除）：fileId 剥、status 归一 idle、组 9 键保留；缺省/私有全量', async () => {
        readCanvas().mockResolvedValue({
          nodes: [
            { id: 'g1', type: 'group', position: { x: 0, y: 0 }, parentId: null, width: null, height: null,
              data: { groupType: 'storyboard', cells: ['n1'], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: false, stitchResolution: '2K' }, nameCustom: true } },
            { id: 'n1', type: 'imageGen', position: { x: 5, y: 5 }, parentId: null, width: null, height: null,
              data: { prompt: 'a cat', fileId: 'f1', status: 'done' } },
          ],
          edges: [],
        });
        await service.save('p1', { name: 'T', isPublic: true }, 'u1');
        const saved = savedTemplateData();
        expect(saved.nodes.find((n: any) => n.id === 'g1').data.storyboard).toBeDefined();
        const img = saved.nodes.find((n: any) => n.id === 'n1').data;
        expect(img.fileId).toBeUndefined();
        expect(img.status).toBe('idle'); // resetStatusIdle 写入语义（v2 修正）
        // 私有对照：fileId 保留（本用例内第二次 save——savedTemplateData(1) 取 calls[1]）
        await service.save('p1', { name: 'T' }, 'u1');
        const savedPrivate = savedTemplateData(1);
        expect(savedPrivate.nodes.find((n: any) => n.id === 'n1').data.fileId).toBe('f1');
      });

      it('isPublic 粘性（产品语义登记）：existing.isPublic=true 时后续无 isPublic 入参的 save 仍走投影', async () => {
        // v3 夹具要求：existing.templateData 必须带 version:1（否则 validate 先 400，红相归因会被误导）
        prisma.template.findUnique.mockResolvedValue({
          id: 'tpl1', projectId: 'p1', isPublic: true, userId: 'u1',
          templateData: { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        });
        readCanvas().mockResolvedValue({
          nodes: [{ id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, parentId: null, width: null, height: null, data: { prompt: 'x', fileId: 'f1' } }],
          edges: [],
        });
        await service.save('p1', { name: 'T2' }, 'u1');   // 无 isPublic 入参
        const saved = savedTemplateData();                // findUnique 已 mock 既有行 → update 分支（助手兼容）
        expect(saved.nodes[0].data.fileId).toBeUndefined(); // 仍走投影（willBePublic 粘性——Task 12 Step 1 实现）
      });
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

    it('save 不再拒绝团队成员（无 creator-only）', async () => {
      projectService.findById = vi.fn().mockResolvedValue({ id: 'p1', userId: 'other-user', teamId: 't-team' });
      (service as any).collabDoc.readCanvas.mockResolvedValue({
        nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
        edges: [{ id: 'e1', sourceId: 'n1', targetId: 'n1' }],
      });
      prisma.template.findUnique.mockResolvedValue(null);
      await expect(service.save('p1', { name: 'x' }, 'u2')).resolves.toBeDefined();
    });

    it('save 首存 template 带 teamId', async () => {
      projectService.findById = vi.fn().mockResolvedValue({ id: 'p1', userId: 'u1', teamId: 't-team' });
      (service as any).collabDoc.readCanvas.mockResolvedValue({
        nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
        edges: [{ id: 'e1', sourceId: 'n1', targetId: 'n1' }],
      });
      prisma.template.findUnique.mockResolvedValue(null);
      await service.save('p1', { name: 'x' }, 'u1');
      expect(prisma.template.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ projectId: 'p1', userId: 'u1', teamId: 't-team' }),
      });
    });
  });
});
