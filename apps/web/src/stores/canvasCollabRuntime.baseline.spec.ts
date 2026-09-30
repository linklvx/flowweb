// apps/web/src/stores/canvasCollabRuntime.baseline.spec.ts
// 批0b-1 deletion baseline 守卫（判据源=红1b②影子确定性锚+对端新增不误删+本地删除仍生效）：
// 红1b② = 服务端写的 shadow- 影子（AI 产物回流载体）不在本端 store 投影，今天被删除扫描
//         确定性删除（任何本地编辑触发一次 syncStoreToDoc 即命中）；
// 50ms   = 对端刚新增节点不在本端投影，撞上本端同步被误删（onRemote 50ms 重建窗口）；
// 反面锚 = 基线内、本次消失的 key 仍要删（本地删除语义不回退）。
// 装置：直驱 syncStoreToDoc（projection.test 同款）；注意用例顺序——红1b②依赖文件内
// 首次调用时模块基线为 null（首同步 doc 为源不删），勿在其前增补同步调用。
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { syncStoreToDoc } from './canvasCollabRuntime';
import { useCanvasStore } from './canvasStore';

function setStoreNodes(nodes: any[]) {
  useCanvasStore.setState({ nodes, edges: [] });
}

describe('批0b：deletion baseline 守卫', () => {
  beforeEach(() => { useCanvasStore.setState({ nodes: [], edges: [] }); });

  it('红1b②：doc 放 shadow-x + 本地任意编辑 → doc 仍含 shadow-x（今天确定性删除——必红）', () => {
    const d = new Y.Doc();
    // 直接在 doc 摆影子（服务端 insertNode 形状）
    const m = new Y.Map(); m.set('type', 'imageGen'); d.getMap('nodes').set('shadow-img-1-abc', m);
    setStoreNodes([{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }]);
    syncStoreToDoc(d, 'local-user');
    expect(d.getMap('nodes').get('shadow-img-1-abc')).toBeTruthy();
  });

  it('对端新增（上次投影无、本次也无）不删——50ms 窗口误删修复', () => {
    const d = new Y.Doc();
    setStoreNodes([{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }]);
    syncStoreToDoc(d, 'local-user');                       // 基线立起（prev={n1}）
    d.getMap('nodes').set('n2', new Y.Map());              // 对端新增（不在本端投影）
    useCanvasStore.setState({ nodes: [ { id: 'n1', type: 'textInput', position: { x: 1, y: 1 }, data: {} } ], edges: [] });
    syncStoreToDoc(d, 'local-user');
    expect(d.getMap('nodes').get('n2')).toBeTruthy();      // 今天会被删除扫描干掉——必红
  });

  it('本地删除仍生效：基线内、本次消失 → 删', () => {
    const d = new Y.Doc();
    setStoreNodes([{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }, { id: 'n2', type: 'textInput', position: { x: 0, y: 0 }, data: {} }]);
    syncStoreToDoc(d, 'local-user');
    setStoreNodes([{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }]);
    syncStoreToDoc(d, 'local-user');
    expect(d.getMap('nodes').get('n2')).toBeUndefined();
  });
});
