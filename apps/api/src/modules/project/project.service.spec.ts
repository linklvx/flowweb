import { Test, TestingModule } from '@nestjs/testing';
import { ProjectService } from './project.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { TeamFundsGateService } from '../team/team-funds-gate.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { CANVAS_DOC_SCHEMA_VERSION } from '@flowweb/shared';

/** T8①→Y1c T11（快照权威）：种子字节=canvasDocSnapshot.upsert(g,0,0).create.state（Yjs update
 *  二进制——CanvasDoc 头行零 doc 态列；解码回 Y.Doc 断言内容）。 */
const decodeState = (state: Buffer): Y.Doc => {
  const d = new Y.Doc();
  Y.applyUpdate(d, new Uint8Array(state));
  return d;
};
const upsertStateDoc = (prisma: any): Y.Doc =>
  decodeState(prisma.canvasDocSnapshot.upsert.mock.calls[0][0].create.state as Buffer);

describe('ProjectService', () => {
  let service: ProjectService;
  let prisma: any;
  let emitter: { emitAsync: ReturnType<typeof vi.fn> };
  let gate: { assertSettled: ReturnType<typeof vi.fn> };   // Y0b-1 Z4：删除前置清算门 mock 面

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
        upsert: vi.fn().mockResolvedValue({}), // Y0a-3 T8①：种子 PG 侧同事务落库
      },
      // Y1c T7：genesis 头行集（SystemHistory fail-closed 读+Snapshot(g,0,0)+RuntimeFeedCursor）
      systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 'y1c-sys-history-1' }) },
      canvasDocSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
      runtimeFeedCursor: { upsert: vi.fn().mockResolvedValue({}) },
      projectMember: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = vi.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma));
    prisma.$queryRaw = vi.fn().mockResolvedValue([]);   // Y0a-2 X13：cleanDrafts FOR UPDATE 锁定集
    emitter = { emitAsync: vi.fn().mockResolvedValue([]) };   // Y0a-2 V11：project.gone emit 面

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: PrismaService, useValue: prisma },
        { provide: TeamService, useValue: { ensureDefaultTeam: vi.fn().mockResolvedValue({ id: 'team1' }) } },
        { provide: TeamFundsGateService, useValue: { assertSettled: vi.fn().mockResolvedValue(undefined) } },
        // Y0a-3 T8①：CollabDocumentService 注入随 withDoc 种子块删除（孤儿清理——不再提供替身，注入残留即 compile 红）
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
    gate = module.get(TeamFundsGateService) as any;
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

    it('带 nodes 时种子经事务 canvasDoc.upsert 同事务落库（T8①/P1-3——创建原子化，不依赖领导权）', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const nodes = [{ id: 'n1', type: 'textInput', position: { x: 1, y: 2 }, data: { text: 'a' } }];
      const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];
      await service.create('导入', 'u1', nodes, edges);
      // Y1c T11：头行零 doc 态列（快照权威=Snapshot(g,0,0)——禁双写）；种子字节断言经 upsertStateDoc
      expect(prisma.canvasDoc.upsert).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
        create: { projectId: 'p1' },
        update: {},
      });
      // 行已建无戳半成品消灭：create 与种子同事务（mock 透传 tx——同一次 $transaction 回调内）
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('种子写侧收编（O0a-2/V19 形态）：fillDoc 经 toDocLike+stripAuthorState——state 含 meta 戳+data 全量+edges 单形状', async () => {
      const mockProject = { id: 'p1', name: '导入', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const nodes = [{ id: 'n1', type: 'textInput', position: { x: 1, y: 2 }, data: { text: 'a' } }];
      const edges = [{ id: 'e1', source: 'n1', target: 'n2' }];
      await service.create('导入', 'u1', nodes, edges);

      const doc = upsertStateDoc(prisma);
      expect(doc.getMap('meta').get('schemaVersion')).toBeUndefined(); // T18：种子零 meta 写（版本=PG 列——建行 @default(3)，doc 内容不带版本）
      const n1 = doc.getMap('nodes').get('n1') as Y.Map<any>;
      expect(n1.get('type')).toBe('textInput');
      expect(n1.get('position')).toBeInstanceOf(Y.Map);
      expect((n1.get('position') as Y.Map<any>).get('x')).toBe(1);
      expect((n1.get('data') as Y.Map<any>).get('text')).toBe('a'); // data 全量写入不回退（模板导入丢 data=F29 根因回归锁）
      const e1 = doc.getMap('edges').get('e1') as Y.Map<any>;
      expect(e1.get('source')).toBe('n1');
      expect(e1.get('target')).toBe('n2');
    });

    it('T17 顺修①：种子 placement 判别门（stripDerivedKeys 同款）——order+slot 并存/非法 order 键 ⇒ create 拒绝（fail-closed 种子面禁非法 placement 入 doc）', async () => {
      const mockProject = { id: 'p1', name: '导入', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      // order+slot 并存（禁两可）
      await expect(service.create('非法1', 'u1', [
        { id: 'n1', type: 'imageGen', data: { order: '5000', slot: 0 } },
      ] as any)).rejects.toThrow(/placement 违例|order\+slot 并存/);
      // 非法 order 键形（尾零=非 canonical）
      await expect(service.create('非法2', 'u1', [
        { id: 'n2', type: 'textInput', data: { order: '5.50' } },
      ] as any)).rejects.toThrow(/placement 违例|非法键形/);
      expect(prisma.canvasDoc.upsert).not.toHaveBeenCalled();   // 拒绝先于落库
    });

    it('种子剥键（O0a-2 stripAuthorState）：分镜子无 position+storyboard 组无 wh——manual 组帧三键保留（G1）', async () => {
      const mockProject = { id: 'p1', name: '导入', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const nodes = [
        { id: 'grp', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 200, data: { groupType: 'normal' } },
        { id: 'sb', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['c1'], storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 1, showIndex: true, stitchResolution: '2K' } } },
        { id: 'c1', type: 'imageGen', parentId: 'sb', position: { x: 1, y: 1 }, width: 320, height: 180, data: { fileId: 'f' } },
      ];
      await service.create('导入', 'u1', nodes, []);

      const nodesMap = upsertStateDoc(prisma).getMap('nodes');
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

    it('O0c-1 clone 形状种子验收：CLONE_WHITELIST 输出入 create（clone→create→同事务种子）→ state 键集表逐格+stamp 含戳', async () => {
      const mockProject = { id: 'p1', name: '春天的背面 (副本)', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      // clone 产物形状（CLONE_WHITELIST group 7 键含 storyboard/collapsed——O0c-3 摘 savedSize；auto 组=readCanvas 键集表输出 0 帧键——
      // 此处额外塞脏帧键模拟退化输入，验收 stripAuthorState 守卫）：manual/storyboard/auto 三档组+分镜子
      const nodes = [
        { id: 'mg', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 200, data: { groupType: 'normal', collapsed: true, cells: ['mc1'] } },
        { id: 'mc1', type: 'imageGen', parentId: 'mg', position: { x: 1, y: 1 }, data: { prompt: 'p' } },
        { id: 'ag', type: 'group', position: { x: 9, y: 9 }, width: 100, data: { groupType: 'normal', collapsed: false } }, // 脏帧键（缺 height→非 manual）→ auto
        { id: 'sb', type: 'group', position: { x: 500, y: 0 }, width: 642, height: 362, data: { groupType: 'storyboard', cells: ['sc1', null], storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' }, collapsed: false } },
        { id: 'sc1', type: 'imageGen', parentId: 'sb', position: { x: 1, y: 1 }, width: 320, height: 180, data: { thumbnailUrl: 'http://t' } },
      ];
      await service.create('春天的背面 (副本)', 'u1', nodes, []);

      const doc = upsertStateDoc(prisma);
      expect(doc.getMap('meta').get('schemaVersion')).toBeUndefined(); // T18：种子零 meta 写（版本=PG 列 @default(3)） 产物 state 含戳（T8①同事务种子统一戳点——O0b-0，本用例=clone 链验收锚）
      const nodesMap = doc.getMap('nodes');
      const mg = nodesMap.get('mg') as Y.Map<any>;
      expect(mg.get('position')).toBeInstanceOf(Y.Map);   // manual（三键齐）折叠不剥——doc 三键=展开态密封源
      expect(mg.get('width')).toBe(300);
      expect(mg.get('height')).toBe(200);
      const mgData = mg.get('data') as Y.Map<any>;
      expect(mgData.get('collapsed')).toBe(true);          // clone 7 键 data 原样落 doc（O0c-3 摘 savedSize）
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

    it('O0b-0 正锚②：REST 建空项目（controller:17 传 undefined）→ 同事务 upsert 仍落行（去 nodes.length 闸门——空画布也落 doc 行+盖章）', async () => {
    const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
    prisma.canvasProject.create.mockResolvedValue(mockProject);
    prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

    await service.create('未命名项目', 'u1');

    expect(prisma.canvasDoc.upsert).toHaveBeenCalledTimes(1);
    const doc = upsertStateDoc(prisma);
    expect(doc.getMap('meta').get('schemaVersion')).toBeUndefined(); // T18：种子零 meta 写（版本=PG 列 @default(3)——空画布也稳定落行）
    expect(doc.getMap('nodes').size).toBe(0);                // 无节点写入
  });

    it('T8① 孤儿清理：collabDoc 注入零残留（withDoc 后置种子块删除）', () => {
      expect((service as any).collabDoc).toBeUndefined();
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

    // ═══ Y1c T7：genesis 头行集（双路之一——ProjectService.create） ═══
    it('T7①：同事务建头集——SystemHistory 读+CanvasDocSnapshot(g,0,0)+RuntimeFeedCursor（stateHash=种子字节 SHA-256；schemaVersion=CANVAS_DOC_SCHEMA_VERSION）', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      await service.create('未命名项目', 'u1');

      // SystemHistory fail-closed 读（id=1 单行权威）
      expect(prisma.systemHistory.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
      // Snapshot(g,0,0)：state=种子字节（Yjs update——T11 起唯一种子去处）、stateHash=sha256 hex
      const headState = prisma.canvasDocSnapshot.upsert.mock.calls[0][0].create.state as Buffer;
      expect(headState).toBeInstanceOf(Buffer);
      expect(prisma.canvasDocSnapshot.upsert).toHaveBeenCalledWith({
        where: { projectId_generation_snapshotRev: { projectId: 'p1', generation: 0, snapshotRev: 0n } },
        create: {
          projectId: 'p1', generation: 0, snapshotRev: 0n, stateSeq: 0n,
          state: headState,
          stateHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          vacuumEpoch: 0, schemaVersion: CANVAS_DOC_SCHEMA_VERSION,
        },
        update: {},
      });
      // sha256 单源断言（stateHash 与种子字节强绑定——非任意 hex）
      const { createHash } = await import('node:crypto');
      expect((prisma.canvasDocSnapshot.upsert.mock.calls[0][0] as { create: { stateHash: string } }).create.stateHash)
        .toBe(createHash('sha256').update(headState).digest('hex'));
      // RuntimeFeedCursor 行（默认 0/0——T5b 冻结 upsert 契约的 genesis 插行侧）
      expect(prisma.runtimeFeedCursor.upsert).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
        create: { projectId: 'p1' },
        update: {},
      });
      // 同一 $transaction（头集与项目行原子——无部分写入）
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('T7① fail-closed：SystemHistory 行缺失 ⇒ create 拒绝且不落头集（不自动建不自动修复）', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);
      prisma.systemHistory.findUnique.mockResolvedValue(null);

      await expect(service.create('未命名项目', 'u1')).rejects.toThrow(/SystemHistory/);
      expect(prisma.canvasDocSnapshot.upsert).not.toHaveBeenCalled();
      expect(prisma.runtimeFeedCursor.upsert).not.toHaveBeenCalled();
    });

    it('T7① fail-closed：SystemHistory.historyId 为零值（"0"/空串）⇒ create 拒绝（缺头三态=缺失/为零均拒）', async () => {
      const mockProject = { id: 'p1', name: '未命名项目', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.create.mockResolvedValue(mockProject);
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);
      for (const degenerate of ['0', '']) {
        prisma.systemHistory.findUnique.mockResolvedValue({ historyId: degenerate });
        await expect(service.create('未命名项目', 'u1')).rejects.toThrow(/SystemHistory/);
      }
      expect(prisma.canvasDocSnapshot.upsert).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return project（Task13 起：画布内容走 Hocuspocus，不再随行返回）', async () => {
      const mockProject = { id: 'p1', name: 'Test', createdAt: new Date(), updatedAt: new Date() };
      prisma.canvasProject.findUnique.mockResolvedValue(mockProject);

      const result = await service.findById('p1');
      expect(result).not.toHaveProperty('nodes');
    });

    it('Y0b-5 T5：世代可见通道随行——collabGeneration（CanvasDoc.generation）+collabSchemaVersion（=CANVAS_DOC_SCHEMA_VERSION 单源）+collabViewerUid（请求者 uid——四维缓存键 uid 维）', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', name: 'T' });
      prisma.canvasDoc.findUnique.mockResolvedValue({ generation: 7, schemaVersion: 3 });

      const result = await service.findById('p1', 'u9');
      expect(result.collabGeneration).toBe(7);
      expect(result.collabSchemaVersion).toBe(3);   // T18：行值透传（=CANVAS_DOC_SCHEMA_VERSION）——IDB 缓存键 s 维与装载列门同源
      expect(CANVAS_DOC_SCHEMA_VERSION).toBe(3);
      expect(result.collabViewerUid).toBe('u9');
      expect(prisma.canvasDoc.findUnique).toHaveBeenCalledWith({
        where: { projectId: 'p1' },
        select: { generation: true, schemaVersion: true },
      });
    });

    it('T18 旧档行透传：CanvasDoc.schemaVersion=2（版本硬切前建行）⇒ collabSchemaVersion=2（客户端四维缓存键 s2≠s3 结构性 miss——IDB 不命中；WS 装载列门拒载双锚一致）', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', name: 'T' });
      prisma.canvasDoc.findUnique.mockResolvedValue({ generation: 0, schemaVersion: 2 });
      const result = await service.findById('p1', 'u9');
      expect(result.collabSchemaVersion).toBe(2);
    });

    it('Y0b-5 T5：CanvasDoc 行缺失（新建未装载——doc 懒建于 loadDocument）⇒ collabGeneration=0 兜底；viewerUid 缺席⇒null（fail-closed 下游不启用缓存）', async () => {
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', name: 'T' });
      prisma.canvasDoc.findUnique.mockResolvedValue(null);

      const result = await service.findById('p1');
      expect(result.collabGeneration).toBe(0);
      expect(result.collabSchemaVersion).toBe(CANVAS_DOC_SCHEMA_VERSION);
      expect(result.collabViewerUid).toBeNull();
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
    it('delete 前置清算门：先 gate 后删（Y0b-1 §1.4ter/Z4——非事务点传 this.prisma）', async () => {
      prisma.canvasProject.delete.mockResolvedValue({ id: 'p1' });
      await service.delete('p1');
      expect(gate.assertSettled).toHaveBeenCalledWith(prisma, { projectId: 'p1' });
      expect(gate.assertSettled.mock.invocationCallOrder[0])
        .toBeLessThan(prisma.canvasProject.delete.mock.invocationCallOrder[0]);
    });

    it('delete 清算门拦截：在飞资金未清算 ⇒ 不删不 emit（409 上抛）', async () => {
      gate.assertSettled.mockRejectedValue(Object.assign(new Error('资金未清算'), { status: 409 }));
      await expect(service.delete('p1')).rejects.toThrow('资金未清算');
      expect(prisma.canvasProject.delete).not.toHaveBeenCalled();
      expect(emitter.emitAsync).not.toHaveBeenCalled();
    });

    it('should delete project by id', async () => {
      prisma.canvasProject.delete.mockResolvedValue({ id: 'p1' });
      await service.delete('p1');
      expect(prisma.canvasProject.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });

    it('delete：删除提交后 emit project.gone（Y0a-2 V11 后置——先 delete 后 emit）', async () => {
      prisma.canvasProject.delete.mockResolvedValue({ id: 'p1' });
      await service.delete('p1');
      expect(emitter.emitAsync).toHaveBeenCalledWith('project.gone', { projectIds: ['p1'] });
      // 调用序：delete 先于 emit（V11 后置——vitest 无 toHaveBeenCalledBefore，用 invocationCallOrder 比较）
      expect(prisma.canvasProject.delete.mock.invocationCallOrder[0])
        .toBeLessThan(emitter.emitAsync.mock.invocationCallOrder[0]);
    });

    it('delete 回滚（delete reject）→ 不 emit（V11：无假终态——项目仍在，协作写不受影响）', async () => {
      prisma.canvasProject.delete.mockRejectedValue(new Error('rollback'));
      await expect(service.delete('p1')).rejects.toThrow('rollback');
      expect(emitter.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('cleanDrafts', () => {
    it('cleanDrafts：$queryRaw FOR UPDATE 锁定集合 → deleteMany → 提交后按确实被删集 emit（Y0a-2 V11+X13）', async () => {
      // X13 重写（原"删除无 Template 关联…"用例——mock 形态全变：$transaction+$queryRaw，Y20 冲击面）
      prisma.$queryRaw.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
      prisma.canvasProject.deleteMany.mockResolvedValue({ count: 4 });
      const result = await service.cleanDrafts('u1');
      expect(result).toEqual({ deletedCount: 4 });   // Y20：返回键不变（controller/前端消费不变）
      expect(prisma.canvasProject.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b', 'c', 'd'] } } });   // X13：按锁定集精确删
      expect(emitter.emitAsync).toHaveBeenCalledWith('project.gone', { projectIds: ['a', 'b', 'c', 'd'] });   // V11：提交后按确实被删集 emit
      // Y0b-1 Z4：批量清算门在事务内（tx 同连接）且先于 deleteMany
      expect(gate.assertSettled).toHaveBeenCalledWith(prisma, { projectIds: ['a', 'b', 'c', 'd'] });
      expect(gate.assertSettled.mock.invocationCallOrder[0])
        .toBeLessThan(prisma.canvasProject.deleteMany.mock.invocationCallOrder[0]);
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
