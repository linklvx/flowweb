import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { syncStoreToDoc, applyDocToStore } from './canvasCollabRuntime';
import { Origin, attachUndoManager, detachUndoManager } from './canvasUndo';
import { fillDoc } from '@/collab/ydocBuilder';
import { calcGroupBounds } from '@flowweb/shared';

// storyboardGroupFixture：按 cs 的 Node 形状构造 storyboard 组节点（data 含 groupType/storyboard 配置）

describe('G3 读 doc 断言（F42 投影分型）', () => {
  it('G3 读 doc 断言：updateStoryboardConfig 改比例 → doc 里的 storyboard.aspectRatio 更新（F42 投影分型——现状红相=组 data 取 ns 陈旧值）', () => {
    const d = new Y.Doc();
    fillDoc(d, [], []);
    // cs：storyboard 组 aspectRatio 16:9
    useCanvasStore.setState({ nodes: [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 250, data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
    ] as any, edges: [] });
    // ns：陈旧组 data（groupNodes/mergeStoryboard 的 ns.addNode 写入的旧形态——aspectRatio 16:9）。
    // 夹具必须摆"陈旧 ns"而非缺席：旧投影 ns 缺席时 `?? nd.data` 回落 cs 新值 → 现状也绿，红相论证倒塌。
    // （Task 11 删镜像后 ns 无组 data——本夹具是历史污染机制的实证装置，勿以"冗余"删）
    useNodeStore.setState({ nodes: {
      g1: { id: 'g1', type: 'group', data: { groupType: 'storyboard', storyboard: { aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false, stitchResolution: '2K' } } },
    } as any });
    useCanvasStore.getState().updateStoryboardConfig('g1', { aspectRatio: '1:1' });
    syncStoreToDoc(d, Origin.LocalUser);
    const m = d.getMap('nodes').get('g1') as any;
    // yjs 13.x typeMapSet：普通对象存为 ContentAny（JSON 编码），不自动转 Y.Map——
    // data 本身是 Y.Map（fillDoc 显式建），data.storyboard 读回是普通对象
    expect(m.get('data').get('storyboard').aspectRatio).toBe('1:1');
    // 现状红相：投影 data 取 ns 陈旧 16:9 → doc 里 aspectRatio 仍 16:9
  });
});

describe('W7 红转绿门槛（几何进 doc 靠投影——删 W7 不丢链路的锚）', () => {
  it('W7 红转绿门槛：resize 后几何经投影进 doc——读 doc 断言 width（v5 装置：形参化直驱）', () => {
    const d = new Y.Doc();
    fillDoc(d, [], []);
    // cs 侧节点带 width 500/height 400（模拟 RF NodeResizer setAttributes→applyNodeChanges 写 cs.width——
    // canvasStore.groups.test.ts:319 既有绿用例已证 applyNodeChanges 写 width/height）
    useCanvasStore.setState({ nodes: [{ id: 't1', type: 'textInput', position: { x: 0, y: 0 }, width: 500, height: 400, data: {} } as any], edges: [] });
    syncStoreToDoc(d, Origin.LocalUser);
    expect((d.getMap('nodes').get('t1') as any).get('width')).toBe(500);
    expect((d.getMap('nodes').get('t1') as any).get('height')).toBe(400);
  });
});

// S1 装置：doc 里 g1 存量几何违反不变量（10×10 框 100×60 子）——normalizeLoadedCanvas 有几何早退，
// refitExpandedGroups 重算 frame → S1 diff 非空（回写触发器）。
// 注：夹具刻意不用"缺几何组"——守恒归位后 refit 与 normalizeLoadedCanvas 同一部法律，幂等同值 →
// diff 恒空、S1 永不触发；可触发的 repair 向量正是"违反不变量的存量 frame"（plan Task 17 Step 3 ②）。
const S1_DOC = () => {
  useCanvasStore.setState({ nodes: [], edges: [] });
  useNodeStore.setState({ nodes: {} as any });
  const d = new Y.Doc();
  fillDoc(d, [
    { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 10, height: 10, data: { groupType: 'normal' } },
    { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 0, y: 0 }, width: 100, height: 60, data: {} },
    { id: 'n1', type: 'textInput', position: { x: 50, y: 50 }, width: 100, height: 40, data: { fileId: 'new' } },
  ] as any, []);
  return d;
};

describe('S1 hydrate 收尾回写（Task 17 审查——applyDocToStore 直驱）', () => {
  afterEach(() => detachUndoManager());

  it('C1 回归：S1 回写须发生在 ns 刷新之后——陈旧 ns data 不得经投影回写覆盖协作者已提交的编辑', () => {
    const d = S1_DOC();
    // ns 预置陈旧 data：doc 里 fileId 已是协作者刚提交的 'new'，本端 ns 镜像还停在 'old'
    useNodeStore.setState({ nodes: { n1: { id: 'n1', type: 'textInput', data: { fileId: 'old' } } } as any });
    applyDocToStore(d);
    const m = d.getMap('nodes').get('n1') as any;
    expect(m.get('data').get('fileId')).toBe('new');
    // 修复前红相：S1 在 ns 刷新前回写，projectCanvasNodes 普通节点 ns 优先 → doc fileId 被 'old' 覆盖（分裂脑）
  });

  it('Geometry 事务不入撤销栈（S1 回写 origin 不在 trackedOrigins——撤销的是修复不是用户编辑）', () => {
    const d = S1_DOC();
    const um = attachUndoManager(d);
    applyDocToStore(d);   // 带 S1 diff（g1 refit 改框）→ syncStoreToDoc(d, Origin.Geometry)
    expect(um.undoStack.length).toBe(0);
  });

  it('S1 有 diff 时回写发生：doc 违反不变量的组框经 refit 修复写回（回写可见）', () => {
    const d = S1_DOC();
    // 期望 = calcGroupBounds(子绝对 rect)——纯函数期望，非手算（Task 17 四法律同款）
    const expectFrame = calcGroupBounds([{ x: 0, y: 0, width: 100, height: 60 }]);
    applyDocToStore(d);
    const m = d.getMap('nodes').get('g1') as any;
    expect(m.get('width')).toBe(expectFrame.width);    // 非 10、非 undefined
    expect(m.get('height')).toBe(expectFrame.height);
  });
});

// 乒乓夹具（Task 18 Step 3）：doc 的组 frame 满足不变量至 1ULP 浮点噪声（整数恒绿是盲区）——
// g1(0.1,0.1) 140×130；c1 rel(20,50) 100×60 → abs(20.1,50.1)。重算 frame.x = 20.1-20
// = 0.10000000000000142（node 实证必然漂移 ≈1.4e-15）：旧重算路径（无 epsilon）必写漂移值
// → store ≠ doc 原文 → S1 回写 → 对端再 apply → 再漂 → 乒乓；epsilon 守卫（EPS=1e-6）使 refit
// no-op → diff 零 → 无回写。
describe('协作乒乓（Task 18——守恒+epsilon 使 refit 不产生新 diff）', () => {
  it('远程 apply → refitExpandedGroups → store 与 doc 原文逐节点深等 + doc 无回写（小数坐标）', () => {
    useCanvasStore.setState({ nodes: [], edges: [] });
    useNodeStore.setState({ nodes: {} as any });
    const d = new Y.Doc();
    fillDoc(d, [
      { id: 'g1', type: 'group', position: { x: 0.1, y: 0.1 }, width: 140, height: 130, data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 20, y: 50 }, width: 100, height: 60, data: {} },
    ] as any, []);
    applyDocToStore(d);
    // 期望 = doc 原文（纯数据夹具——frame 满足不变量至 1ULP 噪声，epsilon 域内 refit 必 no-op）
    const st = useCanvasStore.getState().nodes as any[];
    const g1 = st.find((n) => n.id === 'g1')!;
    const c1 = st.find((n) => n.id === 'c1')!;
    expect({ id: g1.id, position: g1.position, width: g1.width, height: g1.height })
      .toEqual({ id: 'g1', position: { x: 0.1, y: 0.1 }, width: 140, height: 130 });
    expect({ id: c1.id, parentId: c1.parentId, position: c1.position, width: c1.width, height: c1.height })
      .toEqual({ id: 'c1', parentId: 'g1', position: { x: 20, y: 50 }, width: 100, height: 60 });
    // 守恒锚：子绝对坐标 = doc 语义位置（20.1, 50.1）——refit 不搬子
    expect(c1.position.x + g1.position.x).toBeCloseTo(20.1, 12);
    expect(c1.position.y + g1.position.y).toBeCloseTo(50.1, 12);
    // doc 无回写（S1 diff 零——现状路径写漂移 position 必产生回写=乒乓；漂移量 1.4e-15 非 toBeCloseTo 可吞）
    const m = d.getMap('nodes').get('g1') as any;
    expect(m.get('position').get('x')).toBe(0.1);
    expect(m.get('position').get('y')).toBe(0.1);
    expect(m.get('width')).toBe(140);
    expect(m.get('height')).toBe(130);
  });
});
