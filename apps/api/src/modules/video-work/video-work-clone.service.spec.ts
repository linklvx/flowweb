import { Test } from '@nestjs/testing';
// 第十轮（C1-5）：校验/限流/超时用例 toThrow 用的四个异常类——原块头零 @nestjs 导入
import { NotFoundException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { VideoWorkCloneService } from './video-work-clone.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ProjectService } from '../project/project.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { normalizeLoadedCanvas, calcStoryboardSize } from '@flowweb/shared';

describe('VideoWorkCloneService.clone', () => {
  let svc: VideoWorkCloneService;
  let prisma: any; let collabDoc: any; let projectService: any; let rateLimiter: any;

  const work = { id: 'w1', title: '春天的背面', canvasProjectId: 'p1', allowClone: true, status: 'PUBLISHED' };

  /** fixture：分镜组（cells 含 存活子/被剥槽位/null/悬空 id）+ 组外节点 + videoEdit + shadow- + parentId 指向被剥 shadow- 的存活节点 */
  const rawCanvas = () => ({
    nodes: [
      { id: 'child1', type: 'videoGen', parentId: 'grp', position: { x: 1, y: 1 }, width: 320, height: 240, data: { model: 'm', fileId: 'f1', status: 'done', label: 'L' } }, // width/height——spec §7 后端7 透传断言（第十一轮补）
      { id: 'grp', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['child1', 'edit1', null, 'ghost'], storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' }, collapsed: false, savedSize: { width: 100, height: 60 }, manuallyResized: true } }, // 后四键——克隆走 CLONE_WHITELIST 保留断言（F2 根因半边+G1；F27 storyboard）
      { id: 'child2', type: 'imageGen', position: { x: 2, y: 2 }, data: { prompt: { text: 'p', html: 'h' }, fileId: 'f-img', allImages: [{ url: 'u' }], __fromMulti: 'x' } }, // 组外节点；__fromMulti 清单外字段，克隆不得带走（spec:385）；fileId——F20 政策断言源值（Task 3：无源值则 toBeUndefined 真空绿）。第十一轮删 parentId:'grp'——原值与 cells 不含 child2 自相矛盾，测试不变量会把 child2 计入 aliveChildren 而"不在 cells"假红
      { id: 'edit1', type: 'videoEdit', parentId: 'grp', position: { x: 3, y: 3 }, data: { timeline: [] } },
      { id: 'child3', type: 'imageGen', parentId: 'shadow-x', position: { x: 5, y: 5 }, data: { prompt: { text: 'orphan-p', html: 'x' } } }, // 存活但 parentId 指向被剥 shadow 节点——克隆体降级 null（批次6 Minor）；标记用 prompt 因 imageGen 白名单无 label
      { id: 'shadow-x', type: 'imageGen', position: { x: 4, y: 4 }, data: {} },
      { id: 'multi1', type: 'multiImageGen', position: { x: 6, y: 6 }, data: { prompt: 'mp', label: 'ML', images: [{ url: 'mu' }] } }, // 组外 multiImageGen——images 媒体引用克隆必剥（F20 政策断言取参，Task 3 补）
    ],
    edges: [
      { id: 'e1', source: 'child1', target: 'child2' },
      { id: 'e2', source: 'child1', target: 'edit1' },   // 连向被剥节点 → 边剥除
      { id: 'e3', source: 'shadow-x', target: 'child2' }, // 同上
    ],
  });

  beforeEach(async () => {
    prisma = { videoWork: { findUnique: vi.fn() }, canvasProject: { findUnique: vi.fn() }, template: { count: vi.fn() } }; // template 供"Template 不参与"断言（第八轮）
    collabDoc = { readCanvas: vi.fn() };
    projectService = { create: vi.fn() };
    rateLimiter = { checkUserRateLimit: vi.fn().mockResolvedValue(true) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoWorkCloneService,
        { provide: PrismaService, useValue: prisma },
        { provide: CollabDocumentService, useValue: collabDoc },
        { provide: ProjectService, useValue: projectService },
        { provide: RateLimiterService, useValue: rateLimiter },
      ],
    }).compile();
    svc = moduleRef.get(VideoWorkCloneService);
  });

  function setup(over: any = {}) {
    prisma.videoWork.findUnique.mockResolvedValue({ ...work, ...over });
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' });
    collabDoc.readCanvas.mockResolvedValue(rawCanvas());
    projectService.create.mockImplementation((_n: string, _u: string, nodes: any[], edges: any[]) =>
      Promise.resolve({ id: 'new-p', nodes, edges }));
  }

  it('校验：未发布/不允许克隆/无画布/画布不存在 → 404/403', async () => {
    setup({ status: 'DRAFT' });
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(NotFoundException);
    setup({ allowClone: false });
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(ForbiddenException);
    setup({ canvasProjectId: null });  // spec §7.7"canvasProjectId 空 → 404"——第十一轮补（原 plan 缺此分支用例）
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(NotFoundException);
    setup();                           // 第十一轮：mockResolvedValue 是替换语义——不复位则 allowClone:false 残留，下一断言在 !w.allowClone 抛 Forbidden 而非 NotFound
    prisma.canvasProject.findUnique.mockResolvedValue(null);  // 必须后置：setup() 内部会重置 canvasProject.findUnique
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('克隆限流：每用户 10 次/h 超限 → 429', async () => {
    setup();
    rateLimiter.checkUserRateLimit.mockResolvedValue(false);
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(ThrottlerException);
    expect(rateLimiter.checkUserRateLimit).toHaveBeenCalledWith('u1', 'video-work:clone', 3600, 10);
  });

  it('四元重映射：videoEdit/shadow- 剥除；parentId/cells 换新 id；悬空与被剥槽位 → null 且长度不变', async () => {
    setup();
    await svc.clone('w1', 'u1');                                  // 返回 { projectId }——断言走 create 收参（第六轮：clone 不返回 nodes，旧解构是 TS2339 + undefined.find）
    const passedNodes = projectService.create.mock.calls[0][2];   // create(title, userId, nodes, edges) 的第 3 参
    const grp = passedNodes.find((n: any) => n.type === 'group');
    const child1 = passedNodes.find((n: any) => n.data?.label === 'L');
    expect(passedNodes.map((n: any) => n.type)).not.toContain('videoEdit');
    expect(passedNodes.map((n: any) => n.id)).not.toContain('shadow-x');
    expect(grp.data.cells).toHaveLength(4);                       // 长度不变
    expect(grp.data.cells[0]).toBe(child1.id);                    // 存活子 → 新 id
    expect(grp.data.cells[1]).toBeNull();                          // edit1 被剥 → null
    expect(grp.data.cells[2]).toBeNull();                          // 原 null 保持
    expect(grp.data.cells[3]).toBeNull();                          // 悬空 ghost → null
    expect(child1.parentId).toBe(grp.id);                          // parentId → 新组 id
    expect(child1.width).toBe(320);                                // width/height 透传（spec §7 后端7——第十一轮补，原夹具无此二字段、断言缺口）
    expect(child1.height).toBe(240);
    // 测试不变量：所有存活子节点新 id 均出现在新 cells 中
    const aliveChildren = passedNodes.filter((n: any) => n.parentId === grp.id);
    for (const c of aliveChildren) expect(grp.data.cells).toContain(c.id);
  });

  it('parentId 降级：存活节点 parentId 指向被剥 shadow- 节点 → 克隆体 null（与 cells 同语义）', async () => {
    setup();
    await svc.clone('w1', 'u1');
    const passedNodes = projectService.create.mock.calls[0][2];
    const child3 = passedNodes.find((n: any) => n.data?.prompt === 'orphan-p'); // imageGen 白名单剥 label——定位用 prompt.text 透传值
    expect(child3).toBeDefined();
    expect(child3.parentId).toBeNull();
  });

  it('白名单共用：克隆体 data 不含 fileId/allImages/html/status(done)——status 重置 idle；不注入 thumbnailUrl', async () => {
    setup();
    await svc.clone('w1', 'u1');
    const passedNodes = projectService.create.mock.calls[0][2];
    const child1 = passedNodes.find((n: any) => n.data?.label === 'L');
    expect(child1.data.fileId).toBeUndefined();
    expect(child1.data.status).toBe('idle');
    const child2 = passedNodes.find((n: any) => n.type === 'imageGen' && n.id !== 'shadow-x');
    expect(JSON.stringify(passedNodes)).not.toContain('allImages');
    expect(JSON.stringify(passedNodes)).not.toContain('thumbnailUrl');
    expect(JSON.stringify(passedNodes)).not.toContain('__fromMulti'); // spec:385 清单外字段不带走（fixture 已造）
    expect(JSON.stringify(passedNodes)).not.toContain('__ephemeral');
    expect(prisma.template.count).not.toHaveBeenCalled();              // spec §7.7：Template 行数/importCount 不变——clone 不触 template
  });

  it('边：相连被剥节点的边一并剥除；存活边 source/target 已重映射', async () => {
    setup();
    await svc.clone('w1', 'u1');
    const passedNodes = projectService.create.mock.calls[0][2];
    const passedEdges = projectService.create.mock.calls[0][3];   // 第 4 参
    expect(passedEdges).toHaveLength(1);
    const ids = new Set((passedNodes as any[]).map((n: any) => n.id));
    expect(ids.has(passedEdges[0].source)).toBe(true);
    expect(ids.has(passedEdges[0].target)).toBe(true);
  });

  it('无旧 id 残留：新 nodes/edges 不含任何源 id', async () => {
    setup();
    await svc.clone('w1', 'u1');
    const { nodes, edges } = { nodes: projectService.create.mock.calls[0][2], edges: projectService.create.mock.calls[0][3] };
    const oldIds = ['child1', 'grp', 'child2', 'edit1', 'shadow-x'];
    const serialized = JSON.stringify({ nodes, edges });
    for (const oid of oldIds) expect(serialized).not.toContain(`"${oid}"`);
  });

  it('空画布克隆退化：readCanvas 空 nodes/edges → 正常返回 projectId，create 收到空数组', async () => {
    setup();
    collabDoc.readCanvas.mockResolvedValue({ nodes: [], edges: [] }); // 后置覆盖 setup() 的 rawCanvas——mockResolvedValue 是替换语义
    const result = await svc.clone('w1', 'u1');
    expect(result.projectId).toBe('new-p');
    expect(projectService.create.mock.calls[0][2]).toEqual([]);   // create(title, userId, nodes, edges) 第 3 参
    expect(projectService.create.mock.calls[0][3]).toEqual([]);   // 第 4 参
  });

  it('create 阶段挂起 → 整体有界超时 503（read+create 同一等待）', async () => {
    setup();
    projectService.create.mockImplementation(() => new Promise(() => {}));
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(ServiceUnavailableException);
  }, 15000); // 第九轮：测试超时必须 > CLONE_TIMEOUT_MS(10s)——同值时谁先到点取决于调度，flaky（Task 5.3 的 5000/10000 组合无此问题）

  it('标题加 (副本) 后缀；归属 ProjectService.create（不传 teamId）', async () => {
    setup();
    await svc.clone('w1', 'u1');
    expect(projectService.create.mock.calls[0][0]).toBe('春天的背面 (副本)');
    expect(projectService.create.mock.calls[0][1]).toBe('u1');
  });

  it('克隆保留组 storyboard/collapsed/savedSize + 用户手动尺寸不重排（G1 行为断言）', async () => {
    setup();
    await svc.clone('w1', 'u1');
    expect(projectService.create).toHaveBeenCalled(); // 防悬空取参
    const createdNodes = projectService.create.mock.calls[0][2] as any[];
    const group = createdNodes.find((n: any) => n.type === 'group');
    expect(group.data.storyboard).toEqual({ aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: true, stitchResolution: '2K' });
    expect(group.data.collapsed).toBe(false);
    expect(group.data.savedSize).toEqual({ width: 100, height: 60 });
    expect(group.data.manuallyResized).toBe(true);
    expect(group.data.cells).toBeDefined();
  });

  it('政策断言：媒体引用仍剥离（F20 维持）+ 状态归一 idle（resetStatusIdle 写入语义）', async () => {
    setup();
    await svc.clone('w1', 'u1');
    expect(projectService.create).toHaveBeenCalled();
    const createdNodes = projectService.create.mock.calls[0][2] as any[];
    const multi = createdNodes.find((n: any) => n.type === 'multiImageGen');
    expect(multi.data.images).toBeUndefined();
    const imageGen = createdNodes.find((n: any) => n.type === 'imageGen');
    expect(imageGen.data.fileId).toBeUndefined();
    expect(imageGen.data.status).toBe('idle'); // v2 修正：resetStatusIdle 写 'idle' 非剥除
  });

  it('normalizeLoadedCanvas 幂等保险（Task 20）：组带几何时 remap 后过挂载点零补缺——create 收到的 nodes 再过同一函数输出深等', async () => {
    setup();
    const raw = rawCanvas();
    const grp = raw.nodes.find((n: any) => n.id === 'grp') as any;
    grp.width = 642;   // 源组带几何 → normalizeLoadedCanvas 早退（幂等保险非补齐依赖：几何齐全时不改写）
    grp.height = 362;
    collabDoc.readCanvas.mockResolvedValue(raw);
    await svc.clone('w1', 'u1');
    const passedNodes = projectService.create.mock.calls[0][2] as any[];
    expect(normalizeLoadedCanvas(structuredClone(passedNodes))).toEqual(passedNodes);
  });

  it('缺几何组克隆 → normalizeLoadedCanvas 补齐 width/height（挂载存在性钉子：删 service 内该调用即红）', async () => {
    setup(); // rawCanvas 的 grp 本就不带 width/height
    await svc.clone('w1', 'u1');
    const passedNodes = projectService.create.mock.calls[0][2] as any[];
    const grp = passedNodes.find((n: any) => n.type === 'group');
    expect(grp.width).toBe(calcStoryboardSize(2, 2, '16:9').width); // 补齐走 storyboard cfg 公式（16:9 2×2）
  });
});
