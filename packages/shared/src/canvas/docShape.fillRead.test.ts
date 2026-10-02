// packages/shared/src/canvas/docShape.fillRead.test.ts
// O0a-1（Spec B）：docShape 收编行为测试——fillDoc/readRecordsFromMaps/applyRecordToYMap/stripDerivedKeys。
// shared 零 yjs 依赖（plan 明文）：round-trip 用 FakeDoc（内存 Map 树）覆盖语义；web 侧 ydocBuilder.test
// 保留真 Y.Doc 双端比用例（同一 docShape 实现、宿主不同——"双端"恒等的 shared 半边）。
// 分片不变量（O0a 共用）：①空间语义不变——位置原样拷贝不解释（identity 档，翻转支点=O0b-0）；
// ②键集剥键在本族生效（上游构造纪律=唯一剥键写者——fillDoc/readRecords 只按键集表跳过，不写不改）。
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  fillDoc, readRecordsFromMaps, applyRecordToYMap, stripDerivedKeys,
  CANVAS_DOC_SCHEMA_VERSION,
  type DocMapLike, type DocLike, type DocNodeRecord, type DocEdgeRecord,
} from './docShape';

// ── FakeDoc：DocLike 内存假实现（零 yjs——shared 测试装置）──
class FakeMap implements DocMapLike {
  private inner = new Map<string, unknown>();
  get = (key: string): unknown => this.inner.get(key);
  set = (key: string, value: unknown): void => { this.inner.set(key, value); };
  has = (key: string): boolean => this.inner.has(key);
  delete = (key: string): void => { this.inner.delete(key); };
  entries = (): Iterable<[string, unknown]> => this.inner.entries();
}
class FakeDoc implements DocLike {
  private maps = new Map<string, FakeMap>();
  getMap = (name: string): FakeMap => {
    let m = this.maps.get(name);
    if (!m) { m = new FakeMap(); this.maps.set(name, m); }
    return m;
  };
  createMap = (): FakeMap => new FakeMap();
}

// identity 档（O0a-1）：DocNodeRecord.position 裸 {x,y}——abs helper 只是夹具简洁性命名（无品牌 cast）
const abs = (x: number, y: number) => ({ x, y });

/** 分镜组+一子（子无 position 键——上游构造纪律的 records 形态） */
const storyboardFixture = (): { records: DocNodeRecord[]; edges: DocEdgeRecord[] } => ({
  records: [
    {
      id: 'sb1', type: 'group',
      data: { groupType: 'storyboard', cells: ['c1'] },
    },
    {
      id: 'c1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180,
      data: { status: 'done' },
    },
  ],
  edges: [],
});

describe('fillDoc → readRecordsFromMaps round-trip 恒等（docShape 单源——web/api 双端同函数）', () => {
  it('普通节点全键恒等（position 原样拷贝——identity 档不解释不翻转）', () => {
    const doc = new FakeDoc();
    const records: DocNodeRecord[] = [
      {
        id: 'n1', type: 'textInput', parentId: 'g1', width: 320, height: 120,
        position: abs(10, 20), data: { content: 'a', status: 'done' },
      },
    ];
    fillDoc(doc, records, []);
    const out = readRecordsFromMaps(doc);
    expect(out.nodes).toEqual(records);
    expect(out.edges).toEqual([]);
  });

  it('null 值键≡缺键（批4a 契约保持——运行时 as any 注入 null 与缺键同形）', () => {
    const doc = new FakeDoc();
    fillDoc(doc, [
      { id: 'n1', type: 'textInput', parentId: null, width: null, height: null, position: abs(1, 2), data: {} } as unknown as DocNodeRecord,
    ], []);
    const m = doc.getMap('nodes').get('n1') as DocMapLike;
    expect(m.has('parentId')).toBe(false);
    expect(m.has('width')).toBe(false);
    expect(m.has('height')).toBe(false);
    // 读侧 null 消除（批4a：值 null≡缺键——出口 undefined）
    const out = readRecordsFromMaps(doc);
    expect(out.nodes[0].parentId).toBeUndefined();
    expect(out.nodes[0].width).toBeUndefined();
    expect(out.nodes[0].height).toBeUndefined();
  });

  it('meta.schemaVersion stamp（现状行为保持——O0b-0 才删 stamp 换唯一戳源）', () => {
    const doc = new FakeDoc();
    fillDoc(doc, [], []);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(CANVAS_DOC_SCHEMA_VERSION);
    expect(CANVAS_DOC_SCHEMA_VERSION).toBe(1);
  });
});

describe('键集表：分镜子两侧无键恒等（三层表：doc 无键⇄records 同形无键⇄cs {0,0} 构造默认）', () => {
  it('分镜子 records 无 position ⇒ doc 无 position 子 Map ⇒ 读回同形无键（round-trip 恒等）', () => {
    const doc = new FakeDoc();
    const { records, edges } = storyboardFixture();
    fillDoc(doc, records, edges);
    // doc 层：子节点 Y.Map 无 position 键（键集表跳过——非"写 {0,0}"）
    const childMap = doc.getMap('nodes').get('c1') as DocMapLike;
    expect(childMap.has('position')).toBe(false);
    // records 层：读回同形无键
    const out = readRecordsFromMaps(doc);
    const child = out.nodes.find((n) => n.id === 'c1')!;
    expect(child.position).toBeUndefined();
    expect('position' in child).toBe(false);
    // round-trip 恒等（剥键语义两侧一致——fillDoc→readRecords 恒等）
    expect(out.nodes).toEqual(records);
  });

  it('普通节点 position 单键原子化：doc 里 position 存为嵌套子 Map{x,y}（红测试钉目标形态）', () => {
    const doc = new FakeDoc();
    fillDoc(doc, [{ id: 'n1', type: 'textInput', position: abs(3, 4), data: {} }], []);
    const m = doc.getMap('nodes').get('n1') as DocMapLike;
    const pos = m.get('position');
    // 结构性判定（零 instanceof——防跨实例静默失败）：有 get 方法的子 Map
    expect(typeof (pos as DocMapLike)?.get).toBe('function');
    expect((pos as DocMapLike).get('x')).toBe(3);
    expect((pos as DocMapLike).get('y')).toBe(4);
  });

  it('分镜组自身保留 group data（storyboard 配置/cells——剥键只针对子的 position）', () => {
    const doc = new FakeDoc();
    const { records, edges } = storyboardFixture();
    fillDoc(doc, records, edges);
    const out = readRecordsFromMaps(doc);
    const group = out.nodes.find((n) => n.id === 'sb1')!;
    expect((group.data as Record<string, unknown>).groupType).toBe('storyboard');
    expect((group.data as Record<string, unknown>).cells).toEqual(['c1']);
  });
});

describe('applyRecordToYMap（增量——缺键 delete/值变 set/同值 no-op+键集表跳过）', () => {
  const makeMap = (): { doc: FakeDoc; m: DocMapLike } => {
    const doc = new FakeDoc();
    fillDoc(doc, [{ id: 'n1', type: 'group', parentId: 'p1', position: abs(0, 0), data: { a: 1 } }], []);
    return { doc, m: doc.getMap('nodes').get('n1') as DocMapLike };
  };

  it('增量：parentId 消失→delete；position 变→子 Map 逐键 set', () => {
    const { m } = makeMap();
    applyRecordToYMap(m, { id: 'n1', type: 'group', position: abs(5, 5), data: {} }, () => new FakeMap());
    expect(m.get('parentId')).toBeUndefined();
    const pos = m.get('position') as DocMapLike;
    expect(pos.get('x')).toBe(5);
    expect(pos.get('y')).toBe(5);
  });

  it('键集表跳过：分镜子记录（无 position）⇒ 既有 position 不动不删（剥键写者在上游——本函数只读键集）', () => {
    const { m } = makeMap();
    applyRecordToYMap(m, { id: 'n1', type: 'group', data: {} }, () => new FakeMap());
    const pos = m.get('position') as DocMapLike;
    expect(pos.get('x')).toBe(0);
    expect(pos.get('y')).toBe(0);
  });

  it('position 子 Map 缺失（人为构造）→ 经工厂创建后写入', () => {
    const doc = new FakeDoc();
    doc.getMap('nodes').set('n1', doc.createMap());
    (doc.getMap('nodes').get('n1') as DocMapLike).set('type', 'textInput');
    const m = doc.getMap('nodes').get('n1') as DocMapLike;
    applyRecordToYMap(m, { id: 'n1', type: 'textInput', position: abs(7, 8), data: {} }, () => new FakeMap());
    const pos = m.get('position') as DocMapLike;
    expect(pos.get('x')).toBe(7);
    expect(pos.get('y')).toBe(8);
  });
});

describe('stripDerivedKeys（三层防线②：DEV/prod 只读校验谓词——读 records 断言键集，不写不改）', () => {
  it('合法 doc（分镜子无 position）⇒ 空违例', () => {
    const { records } = storyboardFixture();
    expect(stripDerivedKeys(records)).toEqual([]);
  });

  it('分镜子带 position 键 ⇒ 违例；人为构造序 child 先于父组入 doc 同样报错（全量预扫对序免疫——不被静默修好）', () => {
    // 构造序：child 先、父组后（plan 锚：DEV 断言报错而非被静默修好——判定经预扫不依赖序）
    const violations = stripDerivedKeys([
      { id: 'c1', type: 'imageGen', parentId: 'sb1', position: abs(0, 0), data: {} },
      { id: 'sb1', type: 'group', data: { groupType: 'storyboard', cells: ['c1'] } },
    ]);
    expect(violations.some((v) => v.includes('c1') && v.includes('position'))).toBe(true);
  });

  it('现状锚：doc 混合插入序（既有子先于新组——groupNodes 打组形态）⇒ 空违例（序检查不设——防误报合法混合序，函数头注注明）', () => {
    const violations = stripDerivedKeys([
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: abs(5, 5), data: {} },
      { id: 'g1', type: 'group', position: abs(0, 0), data: { groupType: 'normal' } },
    ]);
    expect(violations).toEqual([]);
  });

  it('非分镜组子带 position ⇒ 合法（键集表只约束分镜子——普通组子 rel 恒带）', () => {
    const violations = stripDerivedKeys([
      { id: 'g1', type: 'group', position: abs(0, 0), data: { groupType: 'normal' } },
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: abs(5, 5), data: {} },
    ]);
    expect(violations).toEqual([]);
  });
});

describe('O0a-1 类型分裂签名（DocNodeRecord 可选键面——CanvasNodeRecord 维持必填不混入）', () => {
  it('fillDoc 入参 readonly DocNodeRecord[]/DocLike；readRecordsFromMaps 出口 DocNodeRecord[]', () => {
    expectTypeOf<Parameters<typeof fillDoc>>().toEqualTypeOf<
      [DocLike, readonly DocNodeRecord[], readonly DocEdgeRecord[]]
    >();
    expectTypeOf<ReturnType<typeof readRecordsFromMaps>>().toEqualTypeOf<{
      nodes: DocNodeRecord[];
      edges: DocEdgeRecord[];
    }>();
  });

  it('applyRecordToYMap(m: DocMapLike, r: DocNodeRecord, createMap)；stripDerivedKeys 只读返回违例清单', () => {
    expectTypeOf<Parameters<typeof applyRecordToYMap>>().toEqualTypeOf<
      [DocMapLike, DocNodeRecord, () => DocMapLike]
    >();
    expectTypeOf<Parameters<typeof stripDerivedKeys>>().toEqualTypeOf<[readonly DocNodeRecord[]]>();
    expectTypeOf<ReturnType<typeof stripDerivedKeys>>().toEqualTypeOf<string[]>();
  });

  it('DocMapLike 键集扩（get/set/has/delete/entries——Y.Map 结构兼容零包装）；DocLike{getMap,createMap}', () => {
    expectTypeOf<Parameters<DocMapLike['delete']>>().toEqualTypeOf<[string]>();
    expectTypeOf<ReturnType<DocMapLike['entries']>>().toEqualTypeOf<Iterable<[string, unknown]>>();
    expectTypeOf<ReturnType<DocLike['createMap']>>().toEqualTypeOf<DocMapLike>();
  });
});
