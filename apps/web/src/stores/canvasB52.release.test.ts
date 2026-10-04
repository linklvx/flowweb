// apps/web/src/stores/canvasB52.release.test.ts
// B5'-2（Spec B）：拖动松手单一路由 handleDragRelease——旧链（CanvasView handleNodeDragStop→
// onNodeDragStopIntoGroup→findDropGroup[groupDrop.ts 整模块删]）整链替换。
//
// 红测试锚（plan B5'-2 / spec 终裁 17/24/38①）：
//   ① onNodeDragStop={handleDragRelease}（interaction-props 面——本文件只测 store action +
//      旧链符号删除 census；props 接线在 CanvasView.interaction-props.test）。
//   ② stopCapturing 终裁序第 2 行（release 单 undo 步左边界）——锚"拖完立即 Ctrl+Z⇒只回退拖动
//      不回退前一条命令"。
//   ③ 跨组 A→B 可达（候选=全部组含当前组，排除 draggedGroupIds∪{dragged.id}——旧路由 findDropGroup
//      的 parentId 守卫使跨组不可达，新路由规则）。
//   ④ 拖组松手全体 parentId 逐位不变（被拖组不是合法落点——候选排除被拖集合）。
//   ⑤ 多选"组+异组叶子"落被拖组⇒叶子顶层化（并列档 max===0⇒顶层化）。
//   ⑥ 守卫仍生效：落分镜组⇒入格/落折叠组⇒函数体先展开/组内执行中⇒拒绝零写（R4 预检新家）。
//   ⑦ 松手精度（整数夹具误差 0）+目标组扩框左/上越界时新子 abs 守恒（F33——保护随归属命令结束）。
//   ⑧ undo 一步全恢复+frame≡bbox。
//   ⑨ exactly-once（无会话二次松手=no-op）。
//   ⑩ tie-break 三档：overlapArea>0 面积最大胜/max===0⇒顶层化/并列 id 最小（新路由规则非迁移）。
//   ⑪ 拖出最后成员松手⇒组帧=COLLAPSED_SIZE（空组档——同命令内无中间尺寸；1 子组不解散）。
//
// 测试纪律：零裸 useCanvasStore.setState（文件级棘轮）；几何经 seedCanvas/hydrate、session 经
// store action（B51 同款）。
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import * as Y from 'yjs';
import { message } from 'antd';
import { useCanvasStore } from './canvasStore';
import { applyDocToStore } from './canvasCollabRuntime';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, calcGroupBounds, COLLAPSED_SIZE, type DocNodeRecord } from '@flowweb/shared';
import { _setIntentDocForTest } from './canvasIntents';
import { attachUndoManager, detachUndoManager, Origin } from './canvasUndo';
import { openRwWindow, openRoWindow, resetCanvasStores } from '@/test/fixtures/canvas';

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const WEB_ROOT = path.join(findRepoRoot(process.cwd()), 'apps/web/src');
const STORE_PATH = path.join(WEB_ROOT, 'stores/canvasStore.ts');
const VIEW_PATH = path.join(WEB_ROOT, 'pages/canvas/components/CanvasView.tsx');
const GROUPDROP_PATH = path.join(WEB_ROOT, 'utils/groupDrop.ts');

const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;
const session = () => useCanvasStore.getState().dragSession;

const SB_CONFIG = { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' };

/** 夹具（B51 扩展——整数坐标）：manual 组 g1(100,50,400×300)+双子 c1(abs 120,80)/c1b(abs 200,90)、
 *  auto 组 g2（帧派生 (280,50,240,170)）+子 c2(abs 300,100)、auto 单子组 g3（帧 (680,550,140,130)）+
 *  子 c3(abs 700,600)、分镜组 sb1(0,400, 1×2=容量 2)+子 s1、顶层 t1(700,0)/完成图 img1(0,900)。 */
const FIXTURE: DocNodeRecord[] = [
  { id: 'g1', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal', name: 'manual' } },
  { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
  { id: 'c1b', type: 'imageGen', parentId: 'g1', position: { x: 200, y: 90 }, width: 80, height: 50, data: {} },
  { id: 'g2', type: 'group', data: { groupType: 'normal', name: 'auto' } },
  { id: 'c2', type: 'imageGen', parentId: 'g2', position: { x: 300, y: 100 }, width: 200, height: 100, data: {} },
  { id: 'g3', type: 'group', data: { groupType: 'normal', name: 'auto-single' } },
  { id: 'c3', type: 'imageGen', parentId: 'g3', position: { x: 700, y: 600 }, width: 100, height: 60, data: {} },
  { id: 'sb1', type: 'group', position: { x: 0, y: 400 }, data: { groupType: 'storyboard', cells: ['s1'], storyboard: SB_CONFIG } },
  { id: 's1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180, data: {} },
  { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
  { id: 'img1', type: 'imageGen', position: { x: 0, y: 900 }, width: 320, height: 180, data: { status: 'done' } },
];

function buildDoc(records: DocNodeRecord[] = FIXTURE): Y.Doc {
  const d = new Y.Doc();
  fillDoc(d, records, []);
  stampDocSchema(toDocLike(d));
  return d;
}

const nodeMap = (d: Y.Doc, id: string) => d.getMap('nodes').get(id) as Y.Map<any>;
const docPos = (d: Y.Doc, id: string) => {
  const p = nodeMap(d, id).get('position') as Y.Map<any>;
  return p ? { x: p.get('x'), y: p.get('y') } : undefined;
};

/** doc 写入计数器（'update' 事件——零事务判别面）。 */
function docWriteCounter(d: Y.Doc) {
  let n = 0;
  const h = () => { n += 1; };
  d.on('update', h);
  return { count: () => n, stop: () => d.off('update', h) };
}

const begin = (ids: string[], pointerId: number | null = 1) =>
  useCanvasStore.getState().beginDragGesture(ids.map((id) => ({ id })), pointerId);

/** 手势帧（RF position 批形态——dragging:true 落 cs；顶层 rel=abs、组子 rel）。 */
const frame = (id: string, x: number, y: number, dragging = true) =>
  useCanvasStore.getState().onNodesChange([{ type: 'position', id, position: { x, y }, dragging } as any]);

const release = () => useCanvasStore.getState().handleDragRelease();

/** 拖前 hydrate 同一窗（rw+doc 注入+applyDocToStore——用例公共头）。 */
function hydrate(records?: DocNodeRecord[]) {
  openRwWindow();
  const d = buildDoc(records);
  _setIntentDocForTest(d);
  applyDocToStore(d);
  return d;
}

afterEach(() => {
  _setIntentDocForTest(null);
  detachUndoManager();
  vi.restoreAllMocks();
  resetCanvasStores();
});

// ══════════ ③⑦ 跨组 A→B+精度（整数夹具误差 0+F33 守恒） ══════════

describe("B5'-2 跨组 A→B 与松手精度", () => {
  it('跨组 A→B 可达：c1 拖出 g1 落 g2 帧 ⇒ parentId=g2（候选含当前组排除被拖集——旧 findDropGroup parentId 守卫不可达路径）', () => {
    const d = hydrate();
    begin(['c1']);
    frame('c1', 405, 50);            // abs=(505,100)：g2 帧内（g1 冻结帧 x≤500 外）
    release();
    expect(csNode('c1').parentId).toBe('g2');                     // 跨组可达（新路由规则）
    expect(nodeMap(d, 'c1').get('parentId')).toBe('g2');          // doc membership 信封
    expect(docPos(d, 'c1')).toEqual({ x: 505, y: 100 });          // doc=末帧 abs
    expect(csNode('g1').width).toBe(400);                          // manual 密封不动
    expect(csNode('c1b').parentId).toBe('g1');                     // 源组仍有子——不解组
  });

  it('松手精度（整数夹具误差 0）+目标组左越界扩框⇒新子 abs 守恒（F33——drag 保护随归属命令结束，帧原点左移不吞末帧）', () => {
    // 专夹具：auto 组 gA+子 cA(abs 400,100,200×100 ⇒帧 380,50,240×170)+顶层 n1(1000,1000)——
    // 主夹具 g1 冻结帧(100..500,50..350)完整遮蔽 g2 帧，"只交叠 g2 且左越界"落点不可构造，故独立建。
    const d = hydrate([
      { id: 'gA', type: 'group', data: { groupType: 'normal', name: 'auto' } },
      { id: 'cA', type: 'imageGen', parentId: 'gA', position: { x: 400, y: 100 }, width: 200, height: 100, data: {} },
      { id: 'n1', type: 'textInput', position: { x: 1000, y: 1000 }, data: {} },
    ]);
    begin(['n1']);
    frame('n1', 340, 120);           // abs=(340,120)（DEFAULT 280×120⇒rect 340..620,120..240）：越 gA
                                     // bbox 左界（400）⇒gA 扩框原点左移 380→320——保护驻留时新子会漂移 (280,120)
    release();
    expect(docPos(d, 'n1')!.x).toBe(340);                          // 整数精确（toBe 非 toBeCloseTo——误差 0）
    expect(docPos(d, 'n1')!.y).toBe(120);                          // 末帧 abs 逐位守恒（非 rel+新原点漂移值）
    expect(docPos(d, 'cA')).toEqual({ x: 400, y: 100 });           // 既有成员 abs 守恒（rebase 只动 rel）
    const expectFrame = calcGroupBounds([
      { x: 340, y: 120, width: 280, height: 120 },
      { x: 400, y: 100, width: 200, height: 100 },
    ]);
    expect(csNode('gA').position).toEqual({ x: expectFrame.x, y: expectFrame.y }); // 帧≡bbox+padding（一次落定）
    expect(csNode('gA').width).toBe(expectFrame.width);
  });
});

// ══════════ ④⑤ 拖组/多选落被拖组 ══════════

describe("B5'-2 拖组零归属变更与多选顶层化", () => {
  it('拖组松手全体 parentId 逐位不变（被拖组不是合法落点——组深≤1 恒顶层；位置提交照常）', () => {
    const d = hydrate();
    const before = Object.fromEntries(useCanvasStore.getState().nodes.map((n: any) => [n.id, n.parentId ?? null]));
    begin(['g2']);
    frame('g2', 10, 10);
    release();
    const after = Object.fromEntries(useCanvasStore.getState().nodes.map((n: any) => [n.id, n.parentId ?? null]));
    expect(after).toEqual(before);                                 // 全体 parentId 逐位不变
    expect(docPos(d, 'c2')).toEqual({ x: 30, y: 60 });             // 子 abs 随组位移（B51 拖组 auto 同款）
  });

  it("多选'组+异组叶子'落被拖组⇒叶子顶层化（g2 被拖=非合法落点；c1 最大化归属=max===0⇒脱离 g1 顶层化）", () => {
    const d = hydrate();
    begin(['g2', 'c1']);
    frame('g2', 2000, 2000);        // g2 连同 c2 拖远（c2 rel 不变——RF 拖组语义）
    frame('c1', 1950, 2020);        // c1 abs=(2050,2070)：落被拖 g2 的新帧内——但 g2 非合法落点
    release();
    expect(csNode('c1').parentId).toBeUndefined();                 // 叶子顶层化
    expect(nodeMap(d, 'c1').get('parentId')).toBeUndefined();     // doc 删键
    expect(docPos(d, 'c1')).toEqual({ x: 2050, y: 2070 });        // 位置逐位保留
    expect(csNode('g1').width).toBe(400);                          // g1 仍有 c1b——不解组
    expect(csNode('c2').parentId).toBe('g2');                      // 被拖组成员归属不变
    expect(csNode('g2').parentId).toBeUndefined();                 // 被拖组自身恒顶层
  });
});

// ══════════ ⑪ 拖出最后成员（空组档——同命令内无中间尺寸） ══════════

describe("B5'-2 拖出最后成员（1 子组不解散）", () => {
  it('拖出唯一子松手⇒组不解散+帧=COLLAPSED_SIZE@原位（空组档——漏斗尾单次派生，组不随远拖成员漂移）+undo 一步恢复 frame≡bbox', () => {
    const d = hydrate();
    const um = attachUndoManager(d);
    begin(['c3']);
    frame('c3', 320, 350);          // rel(320,350)+冻结 origin(680,550)⇒abs=(1000,900)：远出 g3 冻结帧（680..820,550..680）
    release();
    expect(csNode('g3')).toBeTruthy();                             // 1 子组不解散（removeNodeFromGroup 善后不随行）
    expect(csNode('g3').position).toEqual({ x: 680, y: 550 });     // 原位（冻结 origin——不随成员漂移）
    expect(csNode('g3').width).toBe(COLLAPSED_SIZE.width);         // 空组档=COLLAPSED_SIZE（220）
    expect(csNode('g3').height).toBe(COLLAPSED_SIZE.height);       // 160
    expect(nodeMap(d, 'g3').get('width')).toBeUndefined();         // auto 恒 0 帧键（doc 无中间尺寸）
    expect(csNode('c3').parentId).toBeUndefined();                 // 脱离=顶层化
    expect(docPos(d, 'c3')).toEqual({ x: 1000, y: 900 });          // 位置逐位保留
    expect(um.undoStack.length).toBe(1);                           // 松手=一步 undo
    um.undo();
    expect(nodeMap(d, 'c3').get('parentId')).toBe('g3');           // undo 一步全恢复
    expect(docPos(d, 'c3')).toEqual({ x: 700, y: 600 });
    applyDocToStore(d);
    const expectFrame = calcGroupBounds([{ x: 700, y: 600, width: 100, height: 60 }]);
    expect(csNode('g3').position).toEqual({ x: expectFrame.x, y: expectFrame.y }); // frame≡bbox+padding
    expect(csNode('g3').width).toBe(expectFrame.width);
  });
});

// ══════════ ⑩ tie-break 三档（新路由规则非迁移） ══════════

describe("B5'-2 tie-break（overlapArea>0 面积最大胜/max===0⇒顶层化/并列 id 最小）", () => {
  /** 两 manual 组夹具（帧密封——无帧派生干扰）：ga/gb 位置尺寸按用例注入；t=顶层 textInput(无 wh⇒DEFAULT 280×120)。 */
  const twoGroups = (ga: { x: number; y: number; w: number; h: number }, gb: { x: number; y: number; w: number; h: number }) => [
    { id: 'ga', type: 'group' as const, position: { x: ga.x, y: ga.y }, width: ga.w, height: ga.h, data: { groupType: 'normal' } },
    { id: 'gb', type: 'group' as const, position: { x: gb.x, y: gb.y }, width: gb.w, height: gb.h, data: { groupType: 'normal' } },
    { id: 't', type: 'textInput' as const, position: { x: 2000, y: 2000 }, data: {} },
  ];

  it('面积最大胜：双组交叠区面积 2000 vs 4000 ⇒ gb 胜（id 序不救小面积）', () => {
    const d = hydrate(twoGroups({ x: 0, y: 0, w: 200, h: 200 }, { x: 150, y: 0, w: 200, h: 200 }));
    begin(['t']);
    frame('t', 150, 10);            // t rect(150..430,10..130)：ga 交叠 50×40=2000；gb 交叠 100×40=4000
    release();
    expect(csNode('t').parentId).toBe('gb');
    expect(d).toBeTruthy();
  });

  it('并列 id 最小：交叠面积恰相等（各 190×120）⇒ ga 胜（字典序最小——面积优先、并列才比 id）', () => {
    hydrate(twoGroups({ x: 0, y: 0, w: 200, h: 200 }, { x: 100, y: 0, w: 200, h: 200 }));
    begin(['t']);
    frame('t', 10, 10);             // t rect(10..290,10..130)（DEFAULT 280×120）：ga_x=200−10=190；gb_x=10+280−100=190 ⇒面积并列
    release();
    expect(csNode('t').parentId).toBe('ga');                       // 并列档 id 最小胜
  });

  it('max===0⇒顶层化：组子拖到无组交叠区松手⇒脱离父组（越界脱离锚）', () => {
    const d = hydrate();
    begin(['c1']);
    frame('c1', 900, 850);          // abs=(1000,900)：无任何组帧交叠（g3 冻结帧 680..820,550..680 外）
    release();
    expect(csNode('c1').parentId).toBeUndefined();
    expect(docPos(d, 'c1')).toEqual({ x: 1000, y: 900 });
  });
});

// ══════════ ⑥ 守卫仍生效（R4 预检新家+分镜入格+折叠先展开） ══════════

describe("B5'-2 守卫仍生效（预检/折叠展开留原函数体单层）", () => {
  it('落分镜组⇒入格：完成图拖落 sb1 ⇒ attachMember 首空槽+doc position 剥键', () => {
    const d = hydrate();
    begin(['img1']);
    frame('img1', 100, 450);        // abs=(100,450)：仅 sb1 帧(0..642,400..580)交叠
    release();
    expect(csNode('img1').parentId).toBe('sb1');
    expect(csNode('img1').position).toEqual({ x: 0, y: 0 });       // 分镜子构造默认
    expect(nodeMap(d, 'img1').get('parentId')).toBe('sb1');
    expect(nodeMap(d, 'img1').get('position')).toBeUndefined();    // 剥键（分镜子无 position）
    expect((nodeMap(d, 'sb1').get('data') as Y.Map<any>).get('cells')).toEqual(['s1', 'img1']); // 首空槽=1（plain array 载荷）
  });

  it('落折叠组⇒函数体先展开：折叠 g3 上落 t1 ⇒ collapsed=false 先行+入组成功', () => {
    const d = hydrate();
    useCanvasStore.getState().toggleCollapse('g3');
    expect(csNode('g3').width).toBe(COLLAPSED_SIZE.width);         // 折叠档（前置自证）
    begin(['t1']);
    frame('t1', 700, 600);          // abs=(700,600)：仅折叠帧(680..900,550..710)交叠
    release();
    expect((csNode('g3').data as any).collapsed).toBe(false);      // 函数体先展开（一次撤销步内）
    expect(csNode('t1').parentId).toBe('g3');
    expect(nodeMap(d, 't1').get('parentId')).toBe('g3');
  });

  it('组内执行中⇒拒绝零写（R4 预检新家——Inner 化批守卫收窄）：目标组执行中⇒message+membership 零写（位置照常提交）', () => {
    const d = hydrate();
    const warn = vi.spyOn(message, 'warning').mockImplementation((() => undefined) as any);
    useCanvasStore.getState().startNodeProcess('c2', 'generating');
    begin(['t1']);
    frame('t1', 350, 100);          // abs=(350,100)：g2 交叠 170×120=20400 > g1 150×120=18000 ⇒目标=g2
    release();
    expect(warn).toHaveBeenCalledWith('组内有节点正在执行，请等待完成后再操作');
    expect(csNode('t1').parentId).toBeUndefined();                 // 归属零写
    expect(nodeMap(d, 't1').get('parentId')).toBeUndefined();
    expect(docPos(d, 't1')).toEqual({ x: 350, y: 100 });           // 拖动位置照常提交（拒绝面=归属非位置）
    useCanvasStore.getState().cancelNodeProcess('c2');             // nodeProcessMap 不随 reset 清——防跨用例污染后续裁决
  });

  it('组内执行中⇒拒绝零写（源组档）：拖出执行中组的成员⇒message+保持成员关系', () => {
    const d = hydrate();
    const warn = vi.spyOn(message, 'warning').mockImplementation((() => undefined) as any);
    useCanvasStore.getState().startNodeProcess('c1', 'generating');
    begin(['c1']);
    frame('c1', 900, 850);          // abs=(1000,900)：max===0 ⇒脱离档——源组 g1 执行中⇒拒绝
    release();
    expect(warn).toHaveBeenCalledWith('组内有节点正在执行，请等待完成后再操作');
    expect(csNode('c1').parentId).toBe('g1');                      // 成员关系保持
    expect(nodeMap(d, 'c1').get('parentId')).toBe('g1');
    expect(docPos(d, 'c1')).toEqual({ x: 1000, y: 900 });          // 位置照常提交
    useCanvasStore.getState().cancelNodeProcess('c1');             // nodeProcessMap 不随 reset 清——防跨用例污染后续裁决
  });
});

// ══════════ ②⑧⑨ undo 语义+exactly-once+幂等分型 ══════════

describe("B5'-2 undo 一步语义与 exactly-once", () => {
  it('拖完立即 Ctrl+Z⇒只回退拖动不回退前一条命令（stopCapturing 终裁序第 2 行=release 单 undo 步左边界）', () => {
    const d = hydrate();
    const um = attachUndoManager(d);
    useCanvasStore.getState().renameGroup('g2', 'renamed');        // 前一条命令（runCommand 单步）
    expect(um.undoStack.length).toBe(1);
    begin(['c1']);
    frame('c1', 405, 50);
    release();
    expect(um.undoStack.length).toBe(2);                           // release=1 步（拖动+归属同窗）
    um.undo();                                                     // 立即 Ctrl+Z——只回退拖动
    expect(nodeMap(d, 'c1').get('parentId')).toBe('g1');           // 归属恢复
    expect(docPos(d, 'c1')).toEqual({ x: 120, y: 80 });            // 位置恢复
    expect((nodeMap(d, 'g2').get('data') as Y.Map<any>).get('name')).toBe('renamed'); // 前一条命令不回退
    expect(um.undoStack.length).toBe(1);
  });

  it('undo 一步全恢复+frame≡bbox（A→B 后 undo ⇒ 成员/位置全恢复+g2 帧重派生≡bbox+padding）', () => {
    const d = hydrate();
    const um = attachUndoManager(d);
    begin(['c1']);
    frame('c1', 405, 50);
    release();
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(nodeMap(d, 'c1').get('parentId')).toBe('g1');
    expect(docPos(d, 'c1')).toEqual({ x: 120, y: 80 });
    applyDocToStore(d);
    expect(csNode('c1').parentId).toBe('g1');
    const expectFrame = calcGroupBounds([{ x: 300, y: 100, width: 200, height: 100 }]);
    expect(csNode('g2').position).toEqual({ x: expectFrame.x, y: expectFrame.y }); // frame≡bbox
    expect(csNode('g2').width).toBe(expectFrame.width);
  });

  it('exactly-once：松手后再次触发=no-op（无会话零写——RF 重放/双触发防重）', () => {
    const d = hydrate();
    begin(['c1']);
    frame('c1', 405, 50);
    release();
    expect(csNode('c1').parentId).toBe('g2');
    const wc = docWriteCounter(d);
    release();                                                     // 二次松手（无会话）
    expect(wc.count()).toBe(0);
    wc.stop();
    expect(session()).toBeNull();
    expect(csNode('c1').parentId).toBe('g2');                      // 归属不重复写
  });

  it('resize 会话不经 handleDragRelease（幂等守卫——resize 提交=commitResizeGesture 专属）', () => {
    const d = hydrate();
    useCanvasStore.getState().beginResize('g1', 9);
    const wc = docWriteCounter(d);
    release();
    expect(wc.count()).toBe(0);
    wc.stop();
    expect(session()).not.toBeNull();                              // resize 会话保留
    useCanvasStore.getState().commitResizeGesture();
    expect(session()).toBeNull();
  });

  it('viewer 窗口：doc 零写+session 清+cs 停末帧（nodesDraggable 门下 UI 不可达——store 面防御同 B51）', () => {
    openRoWindow();
    const d = buildDoc();
    _setIntentDocForTest(d);
    applyDocToStore(d);
    begin(['t1']);
    frame('t1', 800, 10);
    const wc = docWriteCounter(d);
    release();
    expect(wc.count()).toBe(0);
    wc.stop();
    expect(session()).toBeNull();
    expect(csNode('t1').position).toEqual({ x: 800, y: 10 });
  });
});

// ══════════ ①② 旧链整删 census+结构断言（终裁 38①/78⑩ 同族） ══════════

describe("B5'-2 旧路由整链删除 census+handleDragRelease 结构断言", () => {
  /** 函数体提取（B51 actionBody 同款——brace matching）。 */
  function actionBody(src: string, name: string): string {
    const lines = src.split('\n');
    const startIdx = lines.findIndex((l) => new RegExp(`^  ${name}:.*=> \\{`).test(l));
    if (startIdx < 0) throw new Error(`action ${name} 未找到`);
    let depth = 0;
    let seen = false;
    const body: string[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth++; seen = true; }
        else if (ch === '}') depth--;
      }
      if (seen) body.push(lines[i]);
      if (seen && depth === 0) break;
    }
    return body.join('\n');
  }

  const codeLines = (body: string) => body.split('\n').filter((l) => !l.trim().startsWith('//')).map((l) => l.trim());

  it('groupDrop.ts 整模块删除（终裁 17——不留薄包装）+旧链三符号在 CanvasView 零残留', () => {
    expect(existsSync(GROUPDROP_PATH)).toBe(false);                // 整模块删
    const view = readFileSync(VIEW_PATH, 'utf8');
    expect(view).not.toContain('findDropGroup');
    expect(view).not.toContain('handleNodeDragStop');
    expect(view).not.toContain('onNodeDragStopIntoGroup');
    expect(view).toContain('onNodeDragStop={handleDragRelease}');  // 单一路由接线写死（终裁 38①）
    expect(view).not.toContain("from '@/utils/groupDrop'");
  });

  it('handleDragRelease 终裁序：幂等早退（两行）后 stopCapturing 随迁第 2 行+含 commitIntents+不含 endGesture/自有 reconcile', () => {
    const src = readFileSync(STORE_PATH, 'utf8');
    const body = codeLines(actionBody(src, 'handleDragRelease')).slice(1);   // 首行=声明行（锚正则自带）剥除
    expect(body.length).toBeGreaterThan(3);
    expect(body[0]).toContain('dragSession');                       // 幂等早退（读 session+守卫两行）
    const stopIdx = body.findIndex((l) => l.includes('stopCapturing()'));
    expect(stopIdx, 'stopCapturing 随迁终裁序第 2 行（早退两行后——release 单 undo 步左边界）').toBe(2);
    expect(body.join('\n')).toContain('commitIntents');             // 位置提交（B5'-1 三段式复用）
    expect(body.join('\n'), '提交不经 endGesture（abort 族回滚会吃掉提交——终裁 78⑩）').not.toContain('endGesture');
    expect(body.join('\n'), '无自有 reconcile 调用（census 四元组维持）').not.toContain('reconcileGroupGeometry(');
  });

  it('dropIntoGroup 生产唯一直连调用点=handleDragRelease（松手路由单一路由锚——CanvasView 零直连）', () => {
    const src = readFileSync(STORE_PATH, 'utf8');
    const body = codeLines(actionBody(src, 'handleDragRelease'));
    expect(body.join('\n')).toContain('get().dropIntoGroup(');      // 分派面（normal 档）
    expect(body.join('\n')).toContain('get().dropImageIntoStoryboard('); // 分派面（storyboard 档）
    const calls = src.split('\n').filter((l) => l.includes('get().dropIntoGroup(') && !l.trim().startsWith('//'));
    expect(calls.length).toBe(1);                                  // canvasStore 内唯一调用点（handleDragRelease 内）
    const view = readFileSync(VIEW_PATH, 'utf8');
    expect(view).not.toContain('dropIntoGroup(');                  // CanvasView 零直连（旧链已删）
  });
});
