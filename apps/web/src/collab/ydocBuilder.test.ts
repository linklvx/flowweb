import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildDocFromSnapshot, readCanvasFromDoc, fillDoc, applyRecordToYMap } from './ydocBuilder';

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

describe('ydocBuilder 信封收敛（R1a）', () => {
  it('fillDoc→readCanvasFromDoc：读侧出口保持 ?? null 形状（F32/R0b 契约）、缺 position/data 兜底不炸', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [
      { id: 'n1', type: 'textInput', parentId: null, width: null, height: null, position: { x: 1, y: 2 }, data: { content: 'a' } },
      { id: 'n2', type: 'group', position: undefined as any, data: undefined as any },
    ] as any, []);
    const { nodes } = readCanvasFromDoc(doc);
    expect(nodes.find((n) => n.id === 'n1')?.parentId).toBeNull();      // null 不是 undefined——读侧契约
    expect(nodes.find((n) => n.id === 'n1')?.width).toBeNull();
    expect(nodes.find((n) => n.id === 'n2')?.position).toEqual({ x: 0, y: 0 });
    expect(nodes.find((n) => n.id === 'n2')?.data).toEqual({});
  });

  it('fillDoc 入口真删键：null 键不写 Y.Map（get 为 undefined）', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [{ id: 'n1', type: 'textInput', parentId: null, width: null, height: null, position: { x: 1, y: 2 }, data: {} } as any], []);
    const m = doc.getMap('nodes').get('n1') as Y.Map<any>;
    expect(m.has('parentId')).toBe(false);
  });

  it('applyRecordToYMap 增量：缺键即 delete、值变即 set、同值 no-op（判别断言——update 增量近零）', () => {
    const doc = new Y.Doc();
    const nodesMap = doc.getMap('nodes');
    fillDoc(doc, [{ id: 'n1', type: 'group', parentId: 'p1', position: { x: 0, y: 0 }, data: { a: 1 } }] as any, []);
    const m = nodesMap.get('n1') as Y.Map<any>;
    applyRecordToYMap(m, { id: 'n1', type: 'group', position: { x: 5, y: 5 }, data: { a: 1 } });  // parentId 消失 → delete
    expect(m.get('parentId')).toBeUndefined();
    expect(m.get('position').get('x')).toBe(5);
    // 同值再调：不产生新 Y item（doc 膨胀防线——syncStoreToDoc 在 ns 每次变更都跑）
    const sv = Y.encodeStateVector(doc);
    applyRecordToYMap(m, { id: 'n1', type: 'group', position: { x: 5, y: 5 }, data: { a: 1 } });
    expect(Y.encodeStateVector(doc)).toEqual(sv);   // 状态向量不变=no-op 未产生新 item
  });
});

describe('批2-3：doc meta schemaVersion（R1c 前置物）', () => {
  it('fillDoc 写 meta.schemaVersion=1', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [], []);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });

  it('buildDocFromSnapshot 构造入口同携带', () => {
    const doc = buildDocFromSnapshot([], []);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(1);
  });

  it('真 Y.Doc 经 fillDoc → encodeStateAsUpdate → 新 doc 读回仍为 1（服务端持久判据：随 update 传播）', () => {
    const a = new Y.Doc();
    fillDoc(a, [], []);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(b.getMap('meta').get('schemaVersion')).toBe(1);
  });

  it('fillDoc 同值重写 no-op（syncStoreToDoc 逐新节点调 fillDoc——防 doc 膨胀）', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [], []);
    const sv = Y.encodeStateVector(doc);
    fillDoc(doc, [], []);
    expect(Y.encodeStateVector(doc)).toEqual(sv);
  });
});
