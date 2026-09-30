// apps/web/src/stores/canvasCollabRuntime.baseline.spec.ts
// 批4b-2（组 2 收口）：0b deletion baseline 守卫随 syncStoreToDoc 四件套退役——删除语义显式化
// （deleteNode/deleteEdge intent），本 spec 双面重写：
//   A. 行为锚（intent 语义）：①影子存活——doc 摆 shadow-x + dispatch addNode → 影子仍在
//      （addNode intent 只写自己的 key，结构性不扫 doc——0b 红1b② 的意图形态证明）；
//      ②对端新增不删——对端 doc 直写 n2 + 本地 moveNode → n2 仍在（0b 50ms 窗口误删的意图形态证明：
//      意图只触碰目标成员，"上次投影"基线机制已不存在）；
//      ③本地删除生效——dispatch deleteNode → 删 + 级联引用边（删除语义不回退，由显式 intent 承载）。
//   B. 收口静态锚（源码文本）：syncStoreToDoc/bindBridge/applyingRemote/prevNodeIds/prevEdgeIds/
//      _resetBaselineForTest 生产零命中——删陠除先行断言（lint-gate flowweb/no-delete-scan 兜
//      生产面扫描形态，本锚兜"函数/四件套不再回流"）。
// 装置：裸 doc（_setIntentDocForTest 注入）+ rw 窗口复位（canvasIntents.spec 同款——无 initCollab）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class MockProvider {} }));
import * as Y from 'yjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { dispatchCanvasIntent, _setIntentDocForTest } from './canvasIntents';
import { checkProjectionInvariant } from './canvasCollabRuntime';
import { Origin } from './canvasUndo';

const node = (id: string, x = 0) => ({
  id, type: 'textInput', position: { x, y: 0 }, data: { content: 'hi' },
});

describe('批4b-2 A：删除语义显式化三锚（intent 形态）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    useCanvasStore.setState({
      nodes: [], edges: [], hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1',
    });
    useNodeStore.setState({ nodes: {} });
  });
  afterEach(() => _setIntentDocForTest(null));

  it('①影子存活：doc 摆 shadow-x + dispatch addNode → 影子仍在（结构性证明——intent 不扫 doc）', () => {
    // 直接在 doc 摆影子（服务端 insertNode 形状）
    const m = new Y.Map(); m.set('type', 'imageGen'); doc.getMap('nodes').set('shadow-img-1-abc', m);
    dispatchCanvasIntent({ type: 'addNode', node: node('n1', 10) }, Origin.LocalUser);
    expect(doc.getMap('nodes').get('n1')).toBeTruthy();
    expect(doc.getMap('nodes').get('shadow-img-1-abc')).toBeTruthy(); // 不被误删——无删除扫描
    // 影子在投影不变量双侧过滤外——不变量对非影子成员仍成立
    expect(checkProjectionInvariant(doc)).toBe(true);
  });

  it('②对端新增不删：对端 doc 直写 n2 + 本地 moveNode → n2 仍在（基线机制已不存在）', () => {
    dispatchCanvasIntent({ type: 'addNode', node: node('n1', 0) }, Origin.LocalUser);
    doc.transact(() => {
      const m = new Y.Map(); m.set('type', 'textInput');
      const pos = new Y.Map(); pos.set('x', 50); pos.set('y', 0); m.set('position', pos);
      m.set('data', new Y.Map());
      doc.getMap('nodes').set('n2', m);
    }, 'network'); // 对端写（network origin——真实链路经 applyUpdate 抵达）
    dispatchCanvasIntent({ type: 'moveNode', id: 'n1', position: { x: 99, y: 0 } }, Origin.LocalUser);
    expect(doc.getMap('nodes').get('n2')).toBeTruthy(); // 意图只触碰 n1——n2 无关
    const pos = ((doc.getMap('nodes').get('n1') as Y.Map<any>).get('position') as Y.Map<any>).toJSON();
    expect(pos).toEqual({ x: 99, y: 0 });
  });

  it('③本地删除生效：dispatch deleteNode → 删 + 级联引用边（显式 intent 承载删除语义）', () => {
    dispatchCanvasIntent({ type: 'addNode', node: node('n1', 0) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'addNode', node: node('n2', 100) }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'upsertEdge', edge: { id: 'e1', source: 'n1', target: 'n2' } }, Origin.LocalUser);
    dispatchCanvasIntent({ type: 'deleteNode', id: 'n1' }, Origin.LocalUser);
    expect(doc.getMap('nodes').get('n1')).toBeUndefined();
    expect(doc.getMap('edges').get('e1')).toBeUndefined(); // 级联删引用边
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toEqual(['n2']);
    expect(checkProjectionInvariant(doc)).toBe(true);
  });
});

describe('批4b-2 B：收口静态锚（源码文本——四件套+bindBridge 写半边零回流）', () => {
  const runtimeSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'canvasCollabRuntime.ts'), 'utf8',
  );

  it('syncStoreToDoc 在 runtime 生产源码零命中（导出+调用全消失）', () => {
    expect(runtimeSrc.includes('syncStoreToDoc')).toBe(false);
  });

  it('bindBridge 写半边零命中（store→doc 订阅翻译路径整体退役）', () => {
    expect(runtimeSrc.includes('bindBridge')).toBe(false);
  });

  it('applyingRemote latch 零命中（职责对象"订阅翻译回 doc 写"随订阅消失）', () => {
    expect(runtimeSrc.includes('applyingRemote')).toBe(false);
  });

  it('prevNodeIds/prevEdgeIds/_resetBaselineForTest 零命中（0b deletion baseline 退役）', () => {
    expect(runtimeSrc.includes('prevNodeIds')).toBe(false);
    expect(runtimeSrc.includes('prevEdgeIds')).toBe(false);
    expect(runtimeSrc.includes('_resetBaselineForTest')).toBe(false);
  });
});
