// apps/web/src/stores/canvasO0b3.protection.test.ts
// O0b-3（Spec B）：applyDocToStore 保护序 v2（三层一函数）+draggingIds 第三参解析。
//
// 结构锚（本分片全量——行为锚随 B4'-1 补，plan v3.15 降级）：
//   ① 三层一函数：保护捕获[setState 前 live 活值 rel+freeze 冻结帧三字段]→hydrate setState[abs 过渡态]
//      →保护回写——导出+单测；session 状态骨架手动注入（frozenFrames/dragProtectedIds/resizeTargetId
//      ——C0-1 DragSession 类型，B4' 才开始写真 session），注入后远端 apply ⇒ 冻结帧与保护节点逐位不变。
//   ② 同步块：applyDocToStore 全程无 await/渲染分隔（现状已同步——锚定"无 async 关键字+无 await"）。
//   ③ 字段级分型写死（终裁 71）：drag⇒{position}/resize⇒{position,width,height}[帧三字段]/freeze⇒三字段；
//      硬规则"让位只保护几何，不保护数据"——回写仅覆盖几何字段，data/type/parentId/hidden/selected
//      一律取 doc 最新值（防整节点对象回写吃掉远端 data 并发写）。
//   ④ 让位与 reconcile 交互（卡一让位硬规则终裁 66③）：session 活跃期任意命令尾 reconcile⇒
//      让位集合节点 cs 几何零变化（含 doc 有键）。
//   ⑤ draggingIds=onNodeDragStart 第三参 nodes 的 id 集（OnNodeDrag=(event,node,nodes)——
//      types/nodes.d.ts:36；v3.15 勘误"第二参"）——三选一拖三节点⇒保护集合含 3 个 id；
//      单节点拖动={node.id}。UI 接线归 B4'-1，本批只落 store 层解析入口。
//
// 测试纪律：保护节点选顶层（无 parentId）驱动 applyDocToStore 锚——尾挂 assertDocAbsMatchesCsRel
// 只查带 parentId 记录（O0b-2 断言位置保持，本批不加让位豁免——invariant 豁免改写归 O0b-4）；
// 子节点保护面走 reconcile 直驱锚（无尾挂断言参与）。零裸 useCanvasStore.setState（文件级棘轮——
// session 注入走 fixtures seedDragSession、几何注入走 seedCanvas）。
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import { useCanvasStore } from './canvasStore';
import {
  applyDocToStore, reconcileGroupGeometry,
  captureGestureProtection, reapplyGestureProtection, resolveGestureYield,
  resolveDraggingIdsFromGesture,
} from './canvasCollabRuntime';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema, type DocNodeRecord, type DragSession } from '@flowweb/shared';
import { seedCanvas, openRwWindow, resetCanvasStores, seedDragSession } from '@/test/fixtures/canvas';

const csNode = (id: string) => useCanvasStore.getState().nodes.find((n: any) => n.id === id) as any;

/** 最小夹具：manual 组 g1(100,50,400×300)+子 c1(doc.abs 120,80→cs.rel 20,30)+顶层 t1(700,0)。
 *  g1/t1 顶层（无 parentId）——保护锚不触尾挂 assertDocAbsMatchesCsRel（见文件头纪律）。 */
const FIXTURE_RECORDS: DocNodeRecord[] = [
  { id: 'g1', type: 'group', position: { x: 100, y: 50 }, width: 400, height: 300, data: { groupType: 'normal', name: 'manual' } },
  { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 120, y: 80 }, width: 100, height: 60, data: {} },
  { id: 't1', type: 'textInput', position: { x: 700, y: 0 }, data: {} },
];

function buildDoc(): Y.Doc {
  const d = new Y.Doc();
  fillDoc(d, FIXTURE_RECORDS, []);
  stampDocSchema(toDocLike(d));
  return d;
}

/** 对端远端写（network 事务——applyDocToStore 消费的真实入口形态）。 */
function remoteMutate(d: Y.Doc, fn: (mirror: Y.Doc) => void): void {
  const B = new Y.Doc();
  Y.applyUpdate(B, Y.encodeStateAsUpdate(d));
  fn(B);
  Y.applyUpdate(d, Y.encodeStateAsUpdate(B), 'network');
}

const nodeMap = (d: Y.Doc, id: string) => d.getMap('nodes').get(id) as Y.Map<any>;

/** DragSession 骨架（13 键全量缺省——测试只覆写保护面相关字段；生命周期字段 B4'-1 起才有真值）。 */
function sessionSkeleton(over: Partial<DragSession>): DragSession {
  return {
    baseline: new Map(), groupBaseline: new Map(), delta: { x: 0, y: 0 },
    draggingIds: new Set<string>(), dragProtectedIds: new Set<string>(),
    draggedGroupIds: new Set<string>(), frozenFrames: new Map(),
    gestureKind: 'drag', resizePending: false, lastActivityAt: 0,
    activePointers: new Set<number>(), gestureAbandoned: false, resizeTargetId: null,
    ...over,
  };
}

afterEach(() => {
  seedDragSession(null);
  resetCanvasStores();
});

// ══════════ 结构锚①：三层一函数导出+session 骨架注入 ══════════

describe('O0b-3 三层一函数导出（保护捕获→hydrate→保护回写——B4\' 复用面）', () => {
  it('导出面齐全：captureGestureProtection/reapplyGestureProtection/resolveGestureYield/resolveDraggingIdsFromGesture', () => {
    expect(typeof captureGestureProtection).toBe('function');
    expect(typeof reapplyGestureProtection).toBe('function');
    expect(typeof resolveGestureYield).toBe('function');
    expect(typeof resolveDraggingIdsFromGesture).toBe('function');
  });

  it('无 session ⇒ captureGestureProtection 返回 null（零保护=现状行为）', () => {
    openRwWindow();
    const d = buildDoc();
    applyDocToStore(d);
    expect(captureGestureProtection()).toBeNull();
  });

  it('注入 drag session 骨架后远端 apply ⇒ 冻结帧与保护节点逐位不变（结构锚①）', () => {
    openRwWindow();
    const d = buildDoc();
    applyDocToStore(d);
    // 拖动末帧（cs 活值——capture 层输入）：顶层 t1 position 外移
    seedCanvas(useCanvasStore.getState().nodes.map((n: any) => (
      n.id === 't1' ? { ...n, position: { x: 33, y: 44 } } : n
    )));
    seedDragSession(sessionSkeleton({
      gestureKind: 'drag',
      draggingIds: new Set(['t1']),
      dragProtectedIds: new Set(['t1']),
      frozenFrames: new Map([['g1', { x: 100, y: 50, width: 400, height: 300 }]]),
    }));
    // 远端写：被拖节点 data + 冻结组帧三键全改（doc 权威值≠保护值）
    remoteMutate(d, (B) => {
      nodeMap(B, 't1').get('data').set('status', 'remote-edit');
      nodeMap(B, 'g1').get('position').set('x', 500);
      nodeMap(B, 'g1').get('position').set('y', 500);
      nodeMap(B, 'g1').set('width', 888);
      nodeMap(B, 'g1').set('height', 777);
    });
    applyDocToStore(d);
    // 保护节点逐位不变（末帧）；冻结帧三字段逐位不变（不吃 doc 新值）
    expect(csNode('t1').position).toEqual({ x: 33, y: 44 });
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });
    expect(csNode('g1').width).toBe(400);
    expect(csNode('g1').height).toBe(300);
    // 无保护面取 doc 最新值（硬规则"让位只保护几何，不保护数据"——数据面）
    expect((csNode('t1').data as Record<string, unknown>).status).toBe('remote-edit');
    // 冻结组内未保护子：rel 对冻结帧 origin 自洽（rebase 链不断）
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });
  });
});

// ══════════ 结构锚②：同步块 ══════════

describe('O0b-3 同步块：applyDocToStore 全程无 await/渲染分隔（锚定现状同步形态）', () => {
  it('applyDocToStore 声明非 async 且函数体零 await', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/stores/canvasCollabRuntime.ts'), 'utf8');
    const lines = src.split('\n');
    const startIdx = lines.findIndex((l) => l.includes('export function applyDocToStore('));
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(lines[startIdx]).not.toMatch(/\basync\b/);
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
    expect(body.join('\n')).not.toMatch(/\bawait\b/);
  });
});

// ══════════ 结构锚③：字段级分型 drag⇒{position}+硬规则 ══════════

describe('O0b-3 字段级分型（终裁 71）：drag⇒{position}——wh 与 data 面不保护', () => {
  it('drag 保护集成员：position 逐位保护∧width/height 取 doc 最新值∧data 取 doc 最新值（防整节点回写）', () => {
    openRwWindow();
    const d = buildDoc();
    applyDocToStore(d);
    seedCanvas(useCanvasStore.getState().nodes.map((n: any) => (
      n.id === 't1' ? { ...n, position: { x: 33, y: 44 } } : n
    )));
    seedDragSession(sessionSkeleton({
      gestureKind: 'drag',
      draggingIds: new Set(['t1']),
      dragProtectedIds: new Set(['t1']),
    }));
    // 远端同节点三面齐写：position（保护域）+wh+data（非保护域）
    remoteMutate(d, (B) => {
      nodeMap(B, 't1').get('position').set('x', 900);
      nodeMap(B, 't1').get('position').set('y', 900);
      nodeMap(B, 't1').set('width', 777);
      nodeMap(B, 't1').set('height', 555);
      nodeMap(B, 't1').get('data').set('status', 'remote-edit');
    });
    applyDocToStore(d);
    expect(csNode('t1').position).toEqual({ x: 33, y: 44 });   // position=保护值（末帧）
    expect(csNode('t1').width).toBe(777);                       // wh 取 doc（drag 不保护）
    expect(csNode('t1').height).toBe(555);
    expect((csNode('t1').data as Record<string, unknown>).status).toBe('remote-edit'); // data 取 doc
  });
});

// ══════════ 结构锚④：resize 会话骨架（帧三字段保护） ══════════

describe('O0b-3 resize 会话骨架：resizeTargetId+远端写同节点 ⇒ cs 帧≡保护值', () => {
  it('resize 预览帧不被 doc 旧值覆盖；data 面取 doc 最新值（硬规则）', () => {
    openRwWindow();
    const d = buildDoc();
    applyDocToStore(d);
    // resize 预览帧（手势内核写者面——cs 活值）
    seedCanvas(useCanvasStore.getState().nodes.map((n: any) => (
      n.id === 'g1' ? { ...n, width: 555, height: 333 } : n
    )));
    seedDragSession(sessionSkeleton({
      gestureKind: 'resize',
      resizePending: true,
      resizeTargetId: 'g1',
    }));
    // 远端写同节点：wh+data
    remoteMutate(d, (B) => {
      nodeMap(B, 'g1').set('width', 999);
      nodeMap(B, 'g1').set('height', 999);
      nodeMap(B, 'g1').get('data').set('name', 'remote-x');
    });
    applyDocToStore(d);
    expect(csNode('g1').width).toBe(555);    // 预览帧 width≡保护值
    expect(csNode('g1').height).toBe(333);   // 预览帧 height≡保护值
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 }); // 帧 position 同保护（帧三字段）
    expect((csNode('g1').data as Record<string, unknown>).name).toBe('remote-x'); // data 取 doc
  });
});

// ══════════ 结构锚⑤：让位与 reconcile 交互（卡一让位硬规则——终裁 66③） ══════════

describe('O0b-3 让位与 reconcile 交互：session 活跃期命令尾 reconcile ⇒ 让位集合 cs 几何零变化（含 doc 有键）', () => {
  it('drag 档：dragProtectedIds position 保护∧wh 照常直拷；frozenFrames 帧三字段零变化；非让位控制组照常', () => {
    openRwWindow();
    const d = buildDoc();
    applyDocToStore(d);
    seedDragSession(sessionSkeleton({
      gestureKind: 'drag',
      draggingIds: new Set(['c1']),
      dragProtectedIds: new Set(['c1']),
      frozenFrames: new Map([['g1', { x: 100, y: 50, width: 400, height: 300 }]]),
    }));
    // 远端全键写：被拖子 abs+wh、冻结组帧、无关节点
    remoteMutate(d, (B) => {
      nodeMap(B, 'c1').get('position').set('x', 300);
      nodeMap(B, 'c1').get('position').set('y', 300);
      nodeMap(B, 'c1').set('width', 250);
      nodeMap(B, 'g1').get('position').set('x', 500);
      nodeMap(B, 'g1').get('position').set('y', 500);
      nodeMap(B, 'g1').set('width', 888);
      nodeMap(B, 'g1').set('height', 777);
      nodeMap(B, 't1').get('position').set('x', 999);
      nodeMap(B, 't1').get('position').set('y', 999);
    });
    reconcileGroupGeometry(d, 'doc');
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });  // position 保护（doc 有键仍跳过）
    expect(csNode('c1').width).toBe(250);                      // wh 不在 drag 保护域——照常直拷
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });  // freeze 帧 position 零变化
    expect(csNode('g1').width).toBe(400);                      // freeze 帧 width 零变化
    expect(csNode('g1').height).toBe(300);                     // freeze 帧 height 零变化
    expect(csNode('t1').position).toEqual({ x: 999, y: 999 }); // 非让位控制：doc 有键直拷照常
  });

  it('resize 档：resizeTargetId 帧+children(resizeTargetId) 帧三字段全保护（让位两层——live 集合）', () => {
    openRwWindow();
    const d = buildDoc();
    applyDocToStore(d);
    seedDragSession(sessionSkeleton({
      gestureKind: 'resize',
      resizePending: true,
      resizeTargetId: 'g1',
    }));
    remoteMutate(d, (B) => {
      nodeMap(B, 'g1').get('position').set('x', 500);
      nodeMap(B, 'g1').set('width', 888);
      nodeMap(B, 'g1').set('height', 777);
      nodeMap(B, 'c1').get('position').set('x', 300);
      nodeMap(B, 'c1').get('position').set('y', 300);
      nodeMap(B, 'c1').set('width', 250);
      nodeMap(B, 'c1').set('height', 260);
      nodeMap(B, 't1').get('position').set('x', 999);
      nodeMap(B, 't1').get('position').set('y', 999);
    });
    reconcileGroupGeometry(d, 'doc');
    // resizeTargetId 帧：三字段零变化
    expect(csNode('g1').position).toEqual({ x: 100, y: 50 });
    expect(csNode('g1').width).toBe(400);
    expect(csNode('g1').height).toBe(300);
    // children(resizeTargetId)：position+wh 三字段零变化（帧三字段分型）
    expect(csNode('c1').position).toEqual({ x: 20, y: 30 });
    expect(csNode('c1').width).toBe(100);
    expect(csNode('c1').height).toBe(60);
    expect(csNode('t1').position).toEqual({ x: 999, y: 999 }); // 非让位控制
  });
});

// ══════════ 结构锚⑥：draggingIds=onNodeDragStart 第三参解析 ══════════

describe('O0b-3 draggingIds 第三参解析（OnNodeDrag=(event,node,nodes)——第三参全 id 集）', () => {
  it('三选一拖三节点 ⇒ 返回集含 3 个 id（保护集合输入=第三参全量非第二参单节点）', () => {
    const ids = resolveDraggingIdsFromGesture([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(ids.size).toBe(3);
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(true);
    expect(ids.has('c')).toBe(true);
  });

  it('单节点拖动 ⇒ draggingIds={node.id}', () => {
    const ids = resolveDraggingIdsFromGesture([{ id: 'solo' }]);
    expect(ids.size).toBe(1);
    expect(ids.has('solo')).toBe(true);
  });
});

// 基线自证（防 walk 路径漂移静默通过）
void existsSync;
