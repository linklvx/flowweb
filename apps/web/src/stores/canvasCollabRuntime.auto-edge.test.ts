import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { attachUndoManager, detachUndoManager, Origin } from './canvasUndo';
import { isShadowOnlyEvents } from './canvasCollabRuntime';
import { fillDoc, readCanvasFromDoc } from '@/collab/ydocBuilder';

// 批4b-2：syncAutoEdgesToDoc（全量对账器）随 bindBridge 退役——auto 边增删已由 addEdge/removeEdge
// 的 AutoEdge origin intent 承接（canvasIntents.spec 批4b-2 auto 边锚：doc 建边+origin+不入撤销栈）。
// 本文件保留 isShadowOnlyEvents/onRemote 跳过/投影层影子过滤三组装置锚。

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

  it('影子节点顶层 delete 事件 → true（removeShadow 路径——M4）', () => {
    const client = new Y.Doc();
    client.transact(() => { client.getMap('nodes').set('shadow-1', new Y.Map()); }, 'network');
    let hit = true;
    client.getMap('nodes').observeDeep((es) => { hit = isShadowOnlyEvents(es, client.getMap('nodes')); });
    client.transact(() => { client.getMap('nodes').delete('shadow-1'); }, 'network');
    expect(hit).toBe(true);
  });
});

describe('onRemote AutoEdge 事务跳过（M1——本地自动边 intent 不触发全量重建）', () => {
  it('本地 AutoEdge 事务被 onRemote 跳过（M1——不触发全量重建）', () => {
    const client = new Y.Doc();
    let rebuilt = true; // 初值取反侧——observeDeep 若未触发则失败，保证锁力
    // auto 边 intent 只动 edges map，onRemote 对 edges map 也挂同一 handler——observe edges 复刻真实判定链
    client.getMap('edges').observeDeep((es) => {
      const isAutoEdge = es.some((e) => e.transaction.origin === Origin.AutoEdge);
      rebuilt = !isAutoEdge; // AutoEdge 则跳过（onRemote 的 LocalUser 之后、影子短路之前）
    });
    client.transact(() => { client.getMap('edges').set('auto:e:s', new Y.Map()); }, Origin.AutoEdge);
    expect(rebuilt).toBe(false);
  });
});

describe('投影层影子过滤（spec __ephemeral 双重过滤——store 侧）', () => {
  it('readCanvasFromDoc 过滤 shadow- 前缀节点', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [
      { id: 'normal-1', type: 'videoGen', parentId: null, position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'shadow-video-1', type: 'videoGen', parentId: null, position: { x: -99999, y: -99999 }, data: { __ephemeral: true } as any },
    ], []);
    const r = readCanvasFromDoc(doc);
    expect(r.nodes.find((n: any) => n.id === 'normal-1')).toBeDefined();
    expect(r.nodes.find((n: any) => n.id === 'shadow-video-1')).toBeUndefined(); // 不进 store
  });
});
