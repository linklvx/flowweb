import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';

describe('ProjectService', () => {
  let service: ProjectService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      canvasProject: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      template: {
        findUnique: vi.fn(),
      },
      teamMember: { findFirst: vi.fn().mockResolvedValue(null) },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
      canvasDoc: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      projectMember: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = vi.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: PrismaService, useValue: prisma },
        { provide: TeamService, useValue: { ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 'team1' }) } },
        { provide: CollabDocumentService, useValue: { readCanvas: vi.fn(), withDoc: vi.fn() } },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
  });

  describe('create', () => {
    it('should create a project with given name', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const result = await service.create('未命名项目', 'u1');
      expect(result.id).toBe('p1');
      expect(result.name).toBe('未命名项目');
      expect(prisma.canvasProject.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: '未命名项目', teamId: 'team1' }),
      });
    });

    it('带 nodes 时经 withDoc 直连写入', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const nodes = [{ id: 'n1', type: 'textInput', position: { x: 1, y: 2 }, data: { text: 'a' } }];
      const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];
      const collabDoc = (service as any).collabDoc;
      await service.create('导入', 'u1', nodes, edges);
      expect(collabDoc.withDoc).toHaveBeenCalledWith('p1', expect.any(Function));
    });

    it('种子写侧收编（O0a-2）：fillDoc 单源写真 doc——meta 戳+data 全量写入+edges 单形状', async () => {
      const mockProject = { id: 'p1', name: '导入', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);
      const doc = new Y.Doc();
      (service as any).collabDoc.withDoc = vi.fn(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc));

      const nodes = [{ id: 'n1', type: 'textInput', position: { x: 1, y: 2 }, data: { text: 'a' } }];
      const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];
      await service.create('导入', 'u1', nodes, edges);

      expect(doc.getMap('meta').get('schemaVersion')).toBe(2); // O0b-0：种子显式 stampDocSchema（fillDoc 已不写 meta——戳源唯一化）
      const n1 = doc.getMap('nodes').get('n1') as Y.Map<any>;
      expect(n1.get('type')).toBe('textInput');
      expect(n1.get('position')).toBeInstanceOf(Y.Map);
      expect((n1.get('position') as Y.Map<any>).get('x')).toBe(1);
      expect((n1.get('data') as Y.Map<any>).get('text')).toBe('a'); // data 全量写入不回退（模板导入丢 data=F29 根因回归锁）
      const e1 = doc.getMap('edges').get('e1') as Y.Map<any>;
      expect(e1.get('source')).toBe('n1');
      expect(e1.get('target')).toBe('n2');
    });

    it('种子剥键（O0a-2 stripAuthorState）：分镜子无 position+storyboard 组无 wh——manual 组帧三键保留（G1）', async () => {
      const mockProject = { id: 'p1', name: '导入', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);
      const doc = new Y.Doc();
      (service as any).collabDoc.withDoc = vi.fn(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc));

      const nodes = [
        { id: 'grp', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 200, data: { groupType: 'normal' } },
        { id: 'sb', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['c1'], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: true, stitchResolution: '2K' } } },
        { id: 'c1', type: 'imageGen', parentId: 'sb', position: { x: 1, y: 1 }, width: 320, height: 180, data: { fileId: 'f' } },
      ];
      await service.create('导入', 'u1', nodes, []);

      const nodesMap = doc.getMap('nodes');
      const grp = nodesMap.get('grp') as Y.Map<any>;
      expect(grp.get('width')).toBe(300);          // manual 组（三键齐）帧保留
      expect(grp.get('position')).toBeInstanceOf(Y.Map);
      const sb = nodesMap.get('sb') as Y.Map<any>;
      expect(sb.get('width')).toBeUndefined();     // storyboard 无 wh（尺寸=config 权威——normalize 补齐后 strip 剥回）
      expect(sb.get('height')).toBeUndefined();
      expect(sb.get('position')).toBeInstanceOf(Y.Map);
      const c1 = nodesMap.get('c1') as Y.Map<any>;
      expect(c1.get('position')).toBeUndefined();  // 分镜子无 position（键集表——旧实现恒写 {x,y}）
      expect(c1.get('width')).toBe(320);           // 分镜子只剥 position
      expect((c1.get('data') as Y.Map<any>).get('fileId')).toBe('f');
    });

    it('O0c-1 clone 形状种子验收：CLONE_WHITELIST 输出入 create（clone→create→withDoc 同一种子回调）→ doc 键集表逐格+stamp 含戳', async () => {
      const mockProject = { id: 'p1', name: '春天的背面 (副本)', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);
      const doc = new Y.Doc();
      (service as any).collabDoc.withDoc = vi.fn(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc));

      // clone 产物形状（CLONE_WHITELIST group 8 键含 storyboard/collapsed/savedSize；auto 组=readCanvas 键集表输出 0 帧键——
      // 此处额外塞脏帧键模拟退化输入，验收 stripAuthorState 守卫）：manual/storyboard/auto 三档组+分镜子
      const nodes = [
        { id: 'mg', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 200, data: { groupType: 'normal', collapsed: true, savedSize: { width: 300, height: 200 }, cells: ['mc1'] } },
        { id: 'mc1', type: 'imageGen', parentId: 'mg', position: { x: 1, y: 1 }, data: { prompt: 'p' } },
        { id: 'ag', type: 'group', position: { x: 9, y: 9 }, width: 100, data: { groupType: 'normal', collapsed: false } }, // 脏帧键（缺 height→非 manual）→ auto
        { id: 'sb', type: 'group', position: { x: 500, y: 0 }, width: 642, height: 362, data: { groupType: 'storyboard', cells: ['sc1', null], storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' }, collapsed: false } },
        { id: 'sc1', type: 'imageGen', parentId: 'sb', position: { x: 1, y: 1 }, width: 320, height: 180, data: { thumbnailUrl: 'http://t' } },
      ];
      await service.create('春天的背面 (副本)', 'u1', nodes, []);

      expect(doc.getMap('meta').get('schemaVersion')).toBe(2); // clone 产物 doc 含戳（create withDoc 统一戳点——O0b-0，本用例=clone 链验收锚）
      const nodesMap = doc.getMap('nodes');
      const mg = nodesMap.get('mg') as Y.Map<any>;
      expect(mg.get('position')).toBeInstanceOf(Y.Map);   // manual（三键齐）折叠不剥——doc 三键=展开态密封源
      expect(mg.get('width')).toBe(300);
      expect(mg.get('height')).toBe(200);
      const mgData = mg.get('data') as Y.Map<any>;
      expect(mgData.get('collapsed')).toBe(true);          // clone 8 键 data 原样落 doc
      expect(mgData.get('savedSize')).toEqual({ width: 300, height: 200 });
      const ag = nodesMap.get('ag') as Y.Map<any>;
      expect(ag.get('position')).toBeUndefined();          // auto 组 0 帧键（脏输入被剥）
      expect(ag.get('width')).toBeUndefined();
      expect(ag.get('height')).toBeUndefined();
      const sb = nodesMap.get('sb') as Y.Map<any>;
      expect(sb.get('position')).toBeInstanceOf(Y.Map);    // storyboard 留 position
      expect(sb.get('width')).toBeUndefined();             // storyboard 无 wh
      expect(sb.get('height')).toBeUndefined();
      expect((sb.get('data') as Y.Map<any>).get('storyboard')).toEqual({ aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' });
      const sc1 = nodesMap.get('sc1') as Y.Map<any>;
      expect(sc1.get('position')).toBeUndefined();         // 分镜子无 position
      expect(sc1.get('width')).toBe(320);                  // 分镜子只剥 position（wh=cell 尺寸自由面）
    });

    it('O0b-0 正锚②：REST 建空项目（controller:17 传 undefined）→ withDoc 仍被调（去 nodes.length 闸门——空画布也落 doc 行+盖章）', async () => {
    const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
    prisma.canvasProject.create.mockResolvedValue(mockProject);
    prisma.canvasProject.findUnique.mockResolvedValue(mockProject);
    const doc = new Y.Doc();
    (service as any).collabDoc.withDoc = vi.fn(async (_pid: string, fn: (d: Y.Doc) => unknown) => fn(doc));

    await service.create('未命名项目', 'u1');

    expect((service as any).collabDoc.withDoc).toHaveBeenCalledWith('p1', expect.any(Function));
    expect(doc.getMap('meta').get('schemaVersion')).toBe(2); // 空画布也稳定盖章
    expect(doc.getMap('nodes').size).toBe(0);                // 无节点写入
  });

  it('登录创建者写入 PROJECT_OWNER 成员记录', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      await service.create('未命名项目', 'u1');
      expect(prisma.projectMember.create).toHaveBeenCalledWith({
        data: { projectId: 'p1', userId: 'u1', role: 'PROJECT_OWNER' },
      });
    });

    it('匿名创建（无 userId）不写成员记录', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      await service.create('未命名项目', undefined);
      expect(prisma.projectMember.create).not.toHaveBeenCalled();
    });

    it('团队化：传 teamId 时校验成员并写入该团队', async () => {
      prisma.teamMember.findFirst.mockResolvedValue({ role: 'MEMBER' });
      const mockProject = { id: 'p1', name: '团项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      await service.create('团项目', 'u1', undefined, undefined, 't-team');

      expect(prisma.teamMember.findFirst).toHaveBeenCalledWith({
        where: { teamId: 't-team', userId: 'u1', team: { status: 'ACTIVE' } },
        select: { role: true },
      });
      expect(prisma.canvasProject.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ teamId: 't-team' }),
      });
    });

    it('团队化：传非成员 teamId 抛 403', async () => {
      await expect(service.create('x', 'u1', undefined, undefined, 't-team')).rejects.toThrow('非团队成员');
      expect(prisma.canvasProject.create).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return project（Task13 起：画布内容走 Hocuspocus，不再随行返回）', async () => {
      const mockProject = { id: 'p1', name: 'Test', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const result = await service.findById('p1');
      expect(result).not.toHaveProperty('nodes');
    });

    it('should throw NotFoundException when project missing', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow();
    });
  });

  describe('updateName', () => {
    it('should update project name', async () => {
      prisma.canvasProject.update.mockResolvedValue({ id: 'p1', name: '新项目名' });
      await service.updateName('p1', '新项目名');
      expect(prisma.canvasProject.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: '新项目名' },
      });
    });
  });

  describe('delete', () => {
    it('should delete project by id', async () => {
      prisma.canvasProject.delete.mockResolvedValue({ id: 'p1' });
      await service.delete('p1');
      expect(prisma.canvasProject.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });
  });

  describe('cleanDrafts', () => {
    it('删除无 Template 关联且 24h 未更新的本人工程', async () => {
      prisma.canvasProject.deleteMany.mockResolvedValue({ count: 4 });
      const result = await service.cleanDrafts('u1');
      expect(prisma.canvasProject.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          updatedAt: { lt: expect.any(Date) },
          templates: { none: {} },
        },
      });
      expect(result).toEqual({ deletedCount: 4 });
    });
  });

  describe('getProjectFolder', () => {
    it('teamId 匹配的项目返回 template 的 folderId', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.template.findUnique.mockResolvedValue({ folderId: 'f1' });

      const result = await service.getProjectFolder('p1', 'u1', 't1');

      expect(prisma.canvasProject.findFirst).toHaveBeenCalledWith({
        where: { id: 'p1', teamId: 't1' },
        select: { id: true },
      });
      expect(result).toEqual({ folderId: 'f1' });
    });

    it('teamId 不匹配返回 null 且不查 template（不暴露存在性）', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue(null);

      const result = await service.getProjectFolder('p1', 'u1', 't-other');

      expect(result).toEqual({ folderId: null });
      expect(prisma.template.findUnique).not.toHaveBeenCalled();
    });

    it('未登录或 teamId 缺失直接返回 null 且不查库', async () => {
      const r1 = await service.getProjectFolder('p1', undefined, 't1');
      const r2 = await service.getProjectFolder('p1', 'u1', undefined);

      expect(r1).toEqual({ folderId: null });
      expect(r2).toEqual({ folderId: null });
      expect(prisma.canvasProject.findFirst).not.toHaveBeenCalled();
    });

    it('无 template 记录返回 null', async () => {
      prisma.canvasProject.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.template.findUnique.mockResolvedValue(null);

      const result = await service.getProjectFolder('p1', 'u1', 't1');

      expect(result).toEqual({ folderId: null });
    });
  });
});
