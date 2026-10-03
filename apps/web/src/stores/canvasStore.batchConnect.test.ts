// apps/web/src/stores/canvasStore.batchConnect.test.ts
// B6-3（Spec B 需求 7）store 面：batchConnect（多源→单目标=N 条边/canConnect 禁自环+双侧对称/
// 幂等收敛=handleEdgeId 单源/单 transact/单 undo）+ addNodeAndBatchConnect（点击建点·落空建点+连线
// ——HandleAddNodeMenu:82-92 同手势先例；addChildNode 命令体等价路径+单 transact 单 undo）。
// 装置（groups.test:66 undo 语义先例）：裸 doc+_setIntentDocForTest+fillDoc 初态（origin=null
// 不入撤销栈）+seedCanvas 夹具+rw 窗+attachUndoManager+afterTransaction 计数器（fillDoc 后挂）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { Origin, attachUndoManager, detachUndoManager } from './canvasUndo';
import { _setIntentDocForTest } from './canvasIntents';
import { fillDoc } from '@/collab/ydocBuilder';
import { toDocRecords } from '@flowweb/shared';
import { seedCanvas, openRwWindow, resetCanvasStores, makeGroup, makeChild } from '@/test/fixtures/canvas';
import { addOutputSourceIds } from '@/pages/canvas/components/groups/addOutput';

const seedRig = () => [
  { id: 'a', type: 'imageGen', position: { x: 0, y: 0 }, width: 200, height: 100, data: {} },
  { id: 'b', type: 'imageGen', position: { x: 400, y: 0 }, width: 200, height: 100, data: {} },
  { id: 'c', type: 'imageGen', position: { x: 800, y: 0 }, width: 200, height: 100, data: {} },
  { id: 't', type: 'imageGen', position: { x: 1200, y: 0 }, width: 200, height: 100, data: {} },
  makeGroup({ id: 'g', position: { x: 0, y: 500 }, width: 400, height: 300 }),
  makeChild({ id: 'c1', parentId: 'g', position: { x: 20, y: 20 }, width: 100, height: 80 }),
];

let doc: Y.Doc;
let um: Y.UndoManager;
let localTransacts: number;

beforeEach(() => {
  doc = new Y.Doc();
  _setIntentDocForTest(doc);
  um = attachUndoManager(doc);
  const rig = seedRig();
  fillDoc(doc, toDocRecords(rig as any, {}) as any, []); // 初态 origin=null 不入撤销栈
  resetCanvasStores();
  seedCanvas(rig as any);
  openRwWindow();
  localTransacts = 0;
  doc.on('afterTransaction', (tr: any) => { if (tr.origin === Origin.LocalUser) localTransacts++; });
});

afterEach(() => {
  detachUndoManager();
  _setIntentDocForTest(null);
});

const docEdgeIds = () => [...doc.getMap('edges').keys()].sort();

describe('batchConnect（多源→单目标=N 条边——handleEdgeId 单源+单 transact）', () => {
  it('N 源 → N 条 handle: 边（doc+cs 双端；auto-edge origin 路由不受影响——handle: 前缀走 LocalUser 常规通道）', () => {
    useCanvasStore.getState().batchConnect(['a', 'b', 'c'], 't');
    expect(docEdgeIds()).toEqual(['handle:a:t', 'handle:b:t', 'handle:c:t']);
    expect((doc.getMap('edges').get('handle:a:t') as Y.Map<any>).get('source')).toBe('a');
    expect((doc.getMap('edges').get('handle:a:t') as Y.Map<any>).get('target')).toBe('t');
    expect(useCanvasStore.getState().edges.map((e) => e.id).sort())
      .toEqual(['handle:a:t', 'handle:b:t', 'handle:c:t']);
  });

  it('单 transact：N 边恰一次 LocalUser 事务（对端一帧收齐）', () => {
    useCanvasStore.getState().batchConnect(['a', 'b', 'c'], 't');
    expect(localTransacts).toBe(1);
  });

  it('幂等收敛：重复调用零新事务零新边（addEdge deterministicId no-op 守卫同源）', () => {
    useCanvasStore.getState().batchConnect(['a', 'b'], 't');
    const afterFirst = localTransacts;
    useCanvasStore.getState().batchConnect(['a', 'b'], 't');
    expect(localTransacts).toBe(afterFirst);
    expect(docEdgeIds()).toEqual(['handle:a:t', 'handle:b:t']);
  });

  it('canConnect 禁自环：源=目标剔除；全自环=零事务零写', () => {
    useCanvasStore.getState().batchConnect(['a', 't'], 't');
    expect(docEdgeIds()).toEqual(['handle:a:t']);
    localTransacts = 0;
    useCanvasStore.getState().batchConnect(['t'], 't');
    expect(localTransacts).toBe(0);
    expect(docEdgeIds()).toEqual(['handle:a:t']);
  });

  it('双侧对称：a→t 与 t→a 并存（同规则不分方向——方向不特权）', () => {
    useCanvasStore.getState().batchConnect(['a'], 't');
    useCanvasStore.getState().batchConnect(['t'], 'a');
    expect(docEdgeIds()).toEqual(['handle:a:t', 'handle:t:a']);
  });

  it('单 undo 步：undoStack=1，undo 一次全部 N 边消失', () => {
    useCanvasStore.getState().batchConnect(['a', 'b', 'c'], 't');
    expect(um.undoStack.length).toBe(1);
    um.undo();
    expect(docEdgeIds()).toEqual([]);
  });

  it('参与集原样锚（participation 不进 arrangeSelection——:57 组原子块陷阱）：+号源集（组展开为子）直通，组 id 永不为边源', () => {
    // 组+散根混合选区：addOutputSourceIds 产物=组子展开 ∪ 非组选中（UI 层参与集原样——
    // 若误走 participation('arrange') 会落组原子块：组 g 自身成为边源=陷阱形态）
    const ids = addOutputSourceIds(useCanvasStore.getState().nodes as any, { kind: 'selection', ids: ['g', 'a'] });
    expect(ids).toEqual(['a', 'c1']); // nodes 序：a 先、g 展开为 c1（B6-2 口径）
    useCanvasStore.getState().batchConnect(ids, 't');
    const sources = useCanvasStore.getState().edges.map((e) => e.source).sort();
    expect(sources).toEqual(['a', 'c1']);
    expect(sources).not.toContain('g');
  });
});

describe('addNodeAndBatchConnect（点击建点/+号拖线落空=建点+连线——拍板②）', () => {
  it('建点+N 边单 transact 单 undo：addNode intent+upsertEdge×N 同批（addChildNode 命令体等价路径）', () => {
    const newId = useCanvasStore.getState().addNodeAndBatchConnect('textInput', { x: 1000, y: 500 }, ['a', 'b'])!;
    expect(newId).toBeTruthy();
    expect(localTransacts).toBe(1);
    expect(um.undoStack.length).toBe(1);
    // 节点三面：doc 信封+cs（selected+落位）+ns
    expect(doc.getMap('nodes').get(newId)).toBeTruthy();
    const csN = useCanvasStore.getState().nodes.find((n) => n.id === newId)!;
    expect(csN.type).toBe('textInput');
    expect(csN.selected).toBe(true);
    expect(useNodeStore.getState().nodes[newId]).toBeTruthy();
    // N 条 handle: 边（源→新节点）
    expect(docEdgeIds()).toEqual([`handle:a:${newId}`, `handle:b:${newId}`]);
    expect(useCanvasStore.getState().edges.map((e) => e.target)).toEqual([newId, newId]);
  });

  it('undo 一步全恢复：节点+N 边同消（同 runCommand 单 undo 语义）', () => {
    const newId = useCanvasStore.getState().addNodeAndBatchConnect('imageGen', { x: 1000, y: 500 }, ['a', 'b', 'c'])!;
    um.undo();
    expect(doc.getMap('nodes').get(newId)).toBeUndefined();
    expect(docEdgeIds()).toEqual([]);
  });

  it('addNode 命令体同款类型默认（textInput baseData content 空串+默认 300×300 信封）', () => {
    const newId = useCanvasStore.getState().addNodeAndBatchConnect('textInput', { x: 0, y: 0 }, ['a'])!;
    const m = doc.getMap('nodes').get(newId) as Y.Map<any>;
    expect(m.get('width')).toBe(300);
    expect(m.get('height')).toBe(300);
    expect((m.get('data') as Y.Map<any>).get('content')).toBe('');
  });

  it('落空建点场景（源集含将建节点不可能——新 id 全新边）+多源 N 边', () => {
    const newId = useCanvasStore.getState().addNodeAndBatchConnect('videoGen', { x: 2000, y: 2000 }, ['a', 'b', 'c'])!;
    expect(docEdgeIds().length).toBe(3);
    expect(useCanvasStore.getState().edges.every((e) => e.target === newId)).toBe(true);
  });
});
