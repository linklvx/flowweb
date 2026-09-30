import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { Origin } from './canvasUndo';
import { fillDoc, readCanvasFromDoc } from '@/collab/ydocBuilder';

// 批4b-2：syncAutoEdgesToDoc（全量对账器）随 bindBridge 退役——auto 边增删已由 addEdge/removeEdge
// 的 AutoEdge origin intent 承接（canvasIntents.spec 批4b-2 auto 边锚：doc 建边+origin+不入撤销栈）。
// 批5 删信箱：isShadowOnlyEvents（影子事务短路判定）与投影层影子过滤随信箱整体消失——
// 本文件保留 onRemote 跳过锚 + 读侧不再特判 shadow- 前缀锚（dev 巡检锚见 invariant.spec 判据⑥）。

describe('onRemote AutoEdge 事务跳过（M1——本地自动边 intent 不触发全量重建）', () => {
  it('本地 AutoEdge 事务被 onRemote 跳过（M1——不触发全量重建）', () => {
    const client = new Y.Doc();
    let rebuilt = true; // 初值取反侧——observeDeep 若未触发则失败，保证锁力
    // auto 边 intent 只动 edges map，onRemote 对 edges map 也挂同一 handler——observe edges 复刻真实判定链
    client.getMap('edges').observeDeep((es) => {
      const isAutoEdge = es.some((e) => e.transaction.origin === Origin.AutoEdge);
      rebuilt = !isAutoEdge; // AutoEdge 则跳过（onRemote 的 LocalUser/AutoEdge 判定链）
    });
    client.transact(() => { client.getMap('edges').set('auto:e:s', new Y.Map()); }, Origin.AutoEdge);
    expect(rebuilt).toBe(false);
  });
});

describe('投影层读侧（批5 删信箱——影子过滤随行消失）', () => {
  it('readCanvasFromDoc 不再过滤 shadow- 前缀（前缀机器零特判——同形状普通节点直读）', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [
      { id: 'normal-1', type: 'videoGen', parentId: null, position: { x: 0, y: 0 }, data: {} } as any,
      { id: 'shadow-video-1', type: 'videoGen', parentId: null, position: { x: -99999, y: -99999 }, data: {} } as any,
    ], []);
    const r = readCanvasFromDoc(doc);
    expect(r.nodes.find((n: any) => n.id === 'normal-1')).toBeDefined();
    expect(r.nodes.find((n: any) => n.id === 'shadow-video-1')).toBeDefined(); // 不再过滤
  });
});
