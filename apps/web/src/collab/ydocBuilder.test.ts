import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildDocFromSnapshot, readCanvasFromDoc, fillDoc } from './ydocBuilder';

describe('ydocBuilder', () => {
  const nodes = [
    {
      id: 'n1', type: 'textInput', parentId: 'g1', width: 320, height: 120,
      position: { x: 10, y: 20 }, data: { text: 'a', status: 'done' },
    },
    { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: {} },
  ];
  const edges = [{ id: 'e1', source: 'n1', target: 'g1' }];

  it('build → read 往返一致（含 null 兜底字段）', () => {
    const doc = buildDocFromSnapshot(nodes, edges);
    const result = readCanvasFromDoc(doc);
    const n1 = result.nodes.find((n) => n.id === 'n1')!;
    expect(n1).toMatchObject({ type: 'textInput', parentId: 'g1', width: 320, height: 120 });
    expect(n1.position).toEqual({ x: 10, y: 20 });
    expect(n1.data).toEqual({ text: 'a', status: 'done' });
    const g1 = result.nodes.find((n) => n.id === 'g1')!;
    expect(g1.parentId).toBeNull();
    expect(g1.width).toBeNull();
    expect(result.edges).toEqual([{ id: 'e1', source: 'n1', target: 'g1' }]);
  });

  it('fillDoc 可向已有 doc 追加（快照恢复用）', () => {
    const doc = new Y.Doc();
    fillDoc(doc, nodes, edges);
    // 崩溃快照 apply 语义：update 应用到另一个 doc 后可读
    const update = Y.encodeStateAsUpdate(doc);
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, update);
    expect(readCanvasFromDoc(doc2).nodes).toHaveLength(2);
  });
});

describe('videoEdit 新类型往返（刷新还原保障）', () => {
  it('fillDoc → readCanvasFromDoc 逐键还原（type/width/position/data）', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [{
      id: 'n1', type: 'videoEdit', parentId: null,
      position: { x: 100, y: 200 }, width: 320, height: null,
      data: { title: '工程' },
    } as any], []);
    const r = readCanvasFromDoc(doc);
    const n = r.nodes.find((x: any) => x.id === 'n1') as any;
    expect(n.type).toBe('videoEdit');
    expect(n.width).toBe(320);
    expect(n.parentId).toBeNull();
    expect(n.position).toEqual({ x: 100, y: 200 });
    expect(n.data).toEqual({ title: '工程' });
  });
  it('videoEdit 节点 + auto 边跨 doc 传播（协作可见性）', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    // source: 'src1' 故意悬空——fillDoc 无引用完整性校验，本用例只锁 type 透传与边的协作传播
    fillDoc(a, [{ id: 'n1', type: 'videoEdit', parentId: null, position: { x: 0, y: 0 }, data: {} } as any],
      [{ id: 'auto:n1:src1', source: 'src1', target: 'n1' }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const rb = readCanvasFromDoc(b);
    expect(rb.nodes.find((x: any) => x.id === 'n1')?.type).toBe('videoEdit');
    expect(rb.edges.find((e: any) => e.id === 'auto:n1:src1')).toMatchObject({ source: 'src1', target: 'n1' });
  });
});
