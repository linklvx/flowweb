import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildDocFromSnapshot, readCanvasFromDoc, fillDoc, applyRecordToYMap } from './ydocBuilder';
import { projectCanvasNodes } from '@/utils/projectCanvasNodes';

describe('ydocBuilder', () => {
  const nodes = [
    {
      id: 'n1', type: 'textInput', parentId: 'g1', width: 320, height: 120,
      position: { x: 10, y: 20 }, data: { text: 'a', status: 'done' },
    },
    { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: {} },
  ];
  const edges = [{ id: 'e1', source: 'n1', target: 'g1' }];

  it('build → read 往返一致（缺键形态——批4a 读归一）', () => {
    const doc = buildDocFromSnapshot(nodes, edges);
    const result = readCanvasFromDoc(doc);
    const n1 = result.nodes.find((n) => n.id === 'n1')!;
    expect(n1).toMatchObject({ type: 'textInput', parentId: 'g1', width: 320, height: 120 });
    expect(n1.position).toEqual({ x: 10, y: 20 });
    expect(n1.data).toEqual({ text: 'a', status: 'done' });
    const g1 = result.nodes.find((n) => n.id === 'g1')!;
    expect(g1.parentId).toBeUndefined(); // 批4a：null 键消除（出口过 normalizeCanvasRecord）
    expect(g1.width).toBeUndefined();
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
    expect(n.parentId).toBeUndefined(); // 批4a：读归一后 null 键消除（height 为 null 同被删——键集锁定见批4a describe）
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
  it('fillDoc→readCanvasFromDoc：读侧出口缺键形态（批4a 读归一修订 R1a ??null 契约）、缺 position 键集表跳过（O0a-1 兜底删除）', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [
      { id: 'n1', type: 'textInput', parentId: null, width: null, height: null, position: { x: 1, y: 2 }, data: { content: 'a' } },
      { id: 'n2', type: 'group', position: undefined as any, data: undefined as any },
    ] as any, []);
    const { nodes } = readCanvasFromDoc(doc);
    expect(nodes.find((n) => n.id === 'n1')?.parentId).toBeUndefined(); // 批4a：null/undefined 键统一消除
    expect(nodes.find((n) => n.id === 'n1')?.width).toBeUndefined();
    // O0a-1 形状变更（预期）：缺 position 节点 doc 无 position 键、读回同形无键——{0,0} 兜底写入已删
    //（四兜底表第一项；键集表跳过而非造 {0,0}）
    const n2 = nodes.find((n) => n.id === 'n2')!;
    expect(n2.position).toBeUndefined();
    expect('position' in n2).toBe(false);
    expect(n2.data).toEqual({});
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

describe('批2-3 沿革（O0b-0 改写）：fillDoc 不写 meta——戳源唯一化（stamp 唯一自愈点=WS loadDocument/api 种子）', () => {
  it('fillDoc 不写 meta.schemaVersion（meta 零键）', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [], []);
    expect(doc.getMap('meta').get('schemaVersion')).toBeUndefined();
    expect(doc.getMap('meta').size).toBe(0);
  });

  it('buildDocFromSnapshot 构造入口同样不写 meta（同函数语义）', () => {
    const doc = buildDocFromSnapshot([], []);
    expect(doc.getMap('meta').get('schemaVersion')).toBeUndefined();
  });

  it('真 Y.Doc 经 fillDoc → encodeStateAsUpdate → 新 doc 读回仍无戳（update 流不含 meta 写）', () => {
    const a = new Y.Doc();
    fillDoc(a, [], []);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(b.getMap('meta').get('schemaVersion')).toBeUndefined();
  });

  it('fillDoc 空记录重写 no-op（零 meta 写后天然幂等——防 doc 膨胀契约保持）', () => {
    const doc = new Y.Doc();
    fillDoc(doc, [], []);
    const sv = Y.encodeStateVector(doc);
    fillDoc(doc, [], []);
    expect(Y.encodeStateVector(doc)).toEqual(sv);
  });
});

describe('批4a：读路径归一（O0a-1 起 readCanvasFromDoc=readRecordsFromMaps 直出——null 消除读侧自做）', () => {
  it('doc 含 null 值键 / 缺键 / shadow- 前缀键 → 出口 null 键消除（缺键形态，键集锁定）、shadow- 不再特判（批5 删信箱）', () => {
    const doc = new Y.Doc();
    const nodesMap = doc.getMap('nodes');
    // 形态1：显式 null 值键（旧后端 writeNodeData 形态——doc Y.Map 里真存 null）
    const m1 = new Y.Map();
    m1.set('type', 'textInput'); m1.set('parentId', null); m1.set('width', null); m1.set('height', null);
    const pos1 = new Y.Map(); pos1.set('x', 1); pos1.set('y', 2); m1.set('position', pos1);
    const data1 = new Y.Map(); data1.set('k', 'v'); m1.set('data', data1);
    nodesMap.set('n1', m1);
    // 形态2：缺键（fillDoc 真删键形态——写侧 normalize 的产物）
    const m2 = new Y.Map(); m2.set('type', 'group');
    const pos2 = new Y.Map(); pos2.set('x', 0); pos2.set('y', 0); m2.set('position', pos2);
    m2.set('data', new Y.Map());
    nodesMap.set('n2', m2);
    // 形态3：shadow- 前缀键（批5 删信箱——投影侧过滤随行消失，同形状普通节点直读）
    nodesMap.set('shadow-x', new Y.Map());

    const r = readCanvasFromDoc(doc);
    const n1 = r.nodes.find((n) => n.id === 'n1')!;
    // toEqual 对 undefined 键宽容——键集断言是形状锁（null/缺键两形态出口同一形状）
    expect(Object.keys(n1).sort()).toEqual(['data', 'id', 'position', 'type']);
    expect(n1.position).toEqual({ x: 1, y: 2 });
    expect(n1.data).toEqual({ k: 'v' });
    expect(Object.keys(r.nodes.find((n) => n.id === 'n2')!).sort()).toEqual(['data', 'id', 'position', 'type']);
    expect(r.nodes.find((n: any) => n.id === 'shadow-x')).toBeDefined(); // 不再过滤（dev 巡检锚见 runtime invariant.spec 判据⑥）
  });

  it('与 store 投影同形：readCanvasFromDoc 直出 ≡ projectCanvasNodes 出口（O0a-1 起同形不同 normalize 源——读直出/写过 normalizeCanvasRecord，批4a 红1 前置）', () => {
    const doc = buildDocFromSnapshot(
      [{ id: 'n1', type: 'textInput', parentId: null, width: 320, height: null, position: { x: 5, y: 6 }, data: { a: 1 } }],
      [],
    );
    const fromDoc = readCanvasFromDoc(doc).nodes;
    // store 投影同输入（含 null 形态输入——两路径吃不同形态、出同一形状）
    const fromStore = projectCanvasNodes(
      [{ id: 'n1', type: 'textInput', parentId: null, width: 320, height: null, position: { x: 5, y: 6 }, data: {} }],
      { n1: { data: { a: 1 } } },
    );
    expect(fromDoc).toEqual(fromStore);
    expect(Object.keys(fromDoc[0]).sort()).toEqual(Object.keys(fromStore[0]).sort());
  });
});

describe('O0a-1：分镜子键集表（真 Y.Doc 双端比——shared docShape 收编后的 web 侧宿主环）', () => {
  // 分镜组+一子：子 records 无 position（上游构造纪律的 intent.node 形态——diff 剥键产物）
  const sbFixture = () => [
    {
      id: 'sb1', type: 'group',
      data: { groupType: 'storyboard', cells: ['c1'] },
    },
    {
      id: 'c1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180,
      data: { status: 'done' },
    },
  ] as any[];

  it('分镜子两侧无键恒等：doc 无 position 键⇄records 同形无键（三层表——doc⇄records 两层）', () => {
    const doc = new Y.Doc();
    const { records, edges } = { records: sbFixture(), edges: [] };
    fillDoc(doc, records, []);
    const childMap = doc.getMap('nodes').get('c1') as Y.Map<any>;
    expect(childMap.has('position')).toBe(false);   // doc 层：键集表跳过（非写 {0,0}）
    const r = readCanvasFromDoc(doc);
    const child = r.nodes.find((n: any) => n.id === 'c1')!;
    expect(child.position).toBeUndefined();          // records 层：同形无键
    expect('position' in child).toBe(false);
    // round-trip 恒等（除剥键——本夹具子本就无 position，恒等应逐位成立）
    expect(r.nodes).toEqual(records);
  });

  it('协作传播恒等：真 Y.Doc 经 encodeStateAsUpdate → 新 doc 读回分镜子仍无 position 键（双端读逐位相等）', () => {
    const a = new Y.Doc();
    fillDoc(a, sbFixture(), []);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const rb = readCanvasFromDoc(b);
    const child = rb.nodes.find((n: any) => n.id === 'c1')!;
    expect(child.position).toBeUndefined();
    expect(child.width).toBe(320);
    expect((child.data as any).status).toBe('done');
  });
});
