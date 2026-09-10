import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { attachUndoManager, detachUndoManager, Origin } from './canvasUndo';
import { syncAutoEdgesToDoc, isShadowOnlyEvents } from './canvasCollabRuntime';
import { autoEdgeId } from './autoEdgeIds';

describe('syncAutoEdgesToDoc（无业务参数幂等全量对账）', () => {
  let doc: Y.Doc; let um: Y.UndoManager;
  beforeEach(() => {
    doc = new Y.Doc();
    um = attachUndoManager(doc);
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null });
  });
  afterEach(() => detachUndoManager());

  it('store 新增 auto 边 → doc 建边且 origin=AutoEdge', () => {
    const cs = useCanvasStore.getState();
    cs.addEdge('s1', 'edit1', undefined, undefined, autoEdgeId('edit1', 's1'));
    syncAutoEdgesToDoc(doc);
    const e = doc.getMap('edges').get(autoEdgeId('edit1', 's1')) as Y.Map<any>;
    expect(e).toBeInstanceOf(Y.Map);
    expect(e.get('source')).toBe('s1');
    expect(e.get('target')).toBe('edit1');
    expect(um.undoStack.length).toBe(0); // AutoEdge 不入栈
  });

  it('store 删除（删节点级联）→ doc 边消失（孤儿 auto 边封堵，spec 验收 29）', () => {
    const cs = useCanvasStore.getState();
    cs.addEdge('s1', 'edit1', undefined, undefined, autoEdgeId('edit1', 's1'));
    syncAutoEdgesToDoc(doc);
    useCanvasStore.setState({ edges: [] }); // deleteNode 级联等价
    syncAutoEdgesToDoc(doc);
    expect(doc.getMap('edges').get(autoEdgeId('edit1', 's1'))).toBeUndefined();
  });

  it('幂等：连续两次对账 undoStack 不增长（spec 验收 26）', () => {
    const cs = useCanvasStore.getState();
    cs.addEdge('s1', 'edit1', undefined, undefined, autoEdgeId('edit1', 's1'));
    syncAutoEdgesToDoc(doc);
    const n = um.undoStack.length;
    syncAutoEdgesToDoc(doc);
    syncAutoEdgesToDoc(doc);
    expect(um.undoStack.length).toBe(n);
  });

  it('手动边（无前缀）不被对账触碰', () => {
    doc.getMap('edges').set('edge_1', (() => { const m = new Y.Map(); m.set('source', 'a'); m.set('target', 'b'); return m; })());
    syncAutoEdgesToDoc(doc);
    expect(doc.getMap('edges').get('edge_1')).toBeDefined(); // 未被删
  });

  it('doc 侧多余的 auto 边（远端残留）被清', () => {
    doc.transact(() => {
      const m = new Y.Map(); m.set('source', 'old'); m.set('target', 'x');
      doc.getMap('edges').set('auto:x:old', m);
    }, Origin.LocalUser);
    syncAutoEdgesToDoc(doc);
    expect(doc.getMap('edges').get('auto:x:old')).toBeUndefined();
  });
});

describe('isShadowOnlyEvents（A1 影子事务短路判定——id 前缀，origin 不过网）', () => {
  it('事件形状固化：nodes map 顶层 set 产生 path=[] 且 target=nodesMap 的事件（实现判定的基础事实，防 yjs 行为漂移）', () => {
    const client = new Y.Doc();
    const nodesMap = client.getMap('nodes');
    let shape: { pathLen: number; isTargetNodesMap: boolean } | null = null;
    nodesMap.observeDeep((es) => {
      for (const ev of es as any[]) {
        shape = { pathLen: ev.path.length, isTargetNodesMap: ev.target === nodesMap };
      }
    });
    client.transact(() => { nodesMap.set('x', new Y.Map()); }, 'network');
    expect(shape).toEqual({ pathLen: 0, isTargetNodesMap: true });
  });

  it('仅影子节点 insert → true（不触发 applyDocToStore 全量重建）', () => {
    const server = new Y.Doc();
    const client = new Y.Doc();
    server.on('update', (u) => Y.applyUpdate(client, u, 'network'));
    let hit = false; // hit 末值模式——不依赖 observeDeep 单事务派发几条事件
    client.getMap('nodes').observeDeep((es) => { hit = isShadowOnlyEvents(es, client.getMap('nodes')); });
    server.transact(() => {
      server.getMap('nodes').set('shadow-video-1', new Y.Map());
    }, 'server-shadow');
    expect(hit).toBe(true);
  });

  it('普通节点变更 → false', () => {
    const client = new Y.Doc();
    let hit = true; // 初值取反侧——observeDeep 若未触发则失败，保证锁力
    client.getMap('nodes').observeDeep((es) => { hit = isShadowOnlyEvents(es, client.getMap('nodes')); });
    client.transact(() => {
      client.getMap('nodes').set('normal-1', new Y.Map());
    }, 'network');
    expect(hit).toBe(false);
  });

  it('影子+普通混合事务 → false（保守全量重建）', () => {
    const client = new Y.Doc();
    let hit = true;
    client.getMap('nodes').observeDeep((es) => { hit = isShadowOnlyEvents(es, client.getMap('nodes')); });
    client.transact(() => {
      client.getMap('nodes').set('shadow-1', new Y.Map());
      client.getMap('nodes').set('normal-1', new Y.Map());
    }, 'network');
    expect(hit).toBe(false);
  });

  it('影子节点 data 写回（深层事件）→ true', () => {
    const client = new Y.Doc();
    const shadow = new Y.Map<any>();
    client.transact(() => { client.getMap('nodes').set('shadow-1', shadow); }, 'network');
    let hit = false;
    client.getMap('nodes').observeDeep((es) => { hit = isShadowOnlyEvents(es, client.getMap('nodes')); });
    client.transact(() => {
      const m = client.getMap('nodes').get('shadow-1') as Y.Map<any>;
      m.set('data', new Y.Map());
    }, 'network');
    expect(hit).toBe(true);
  });

  it('edges map 事件 → false（只有 nodes 的 shadow 事务才短路）', () => {
    const client = new Y.Doc();
    let hit = true;
    client.getMap('edges').observeDeep((es) => { hit = isShadowOnlyEvents(es as any, client.getMap('nodes')); });
    client.transact(() => {
      client.getMap('edges').set('auto:e:s', new Y.Map());
    }, 'network');
    expect(hit).toBe(false);
  });
});
