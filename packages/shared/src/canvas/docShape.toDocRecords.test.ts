// packages/shared/src/canvas/docShape.toDocRecords.test.ts
// O0a-3（Spec B）：toDocRecords 行为测试——web 投影差分出口（双源合并 F42+键集表内剥键，shared 单源）。
// 分片不变量（O0a 共用，plan v3.18 终裁 69）：①identity 档——输出 position≡输入 position 逐位
// [除剥键]，不做 rel→abs 翻转（翻转支点=O0b-0 格式批单一 commit——本函数体=唯一翻转点）；
// ②键集剥键在本函数内生效（与 stripAuthorState 同表同谓词——禁复制两份键集表）。
// setDocPosition 同分片落位：doc position 写原语唯一单源（fillDoc/applyRecordToYMap/moveNode 共口）。
import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  toDocRecords, setDocPosition, fillDoc, readRecordsFromMaps, stripDerivedKeys,
  type DocMapLike, type DocLike, type DocNodeRecord, type MinimalCSNode,
} from './docShape';

// ── FakeDoc：DocLike 内存假实现（零 yjs——docShape.fillRead.test 同款装置）──
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

/** cs 节点夹具（position 必填——cs 层恒有；width/height 缺=auto 组 record 键集判定形态） */
const csNode = (over: Partial<MinimalCSNode> & { id: string }): MinimalCSNode => ({
  type: 'textInput', position: { x: 0, y: 0 }, data: {},
  ...over,
});

describe('toDocRecords：identity 档（终裁 69——输出 position≡输入 position 逐位[除剥键]，翻转不在此分片）', () => {
  it('普通节点 position 逐位恒等；manual 组（三键齐且有效）帧三键全留', () => {
    const csNodes = [
      csNode({ id: 'n1', position: { x: 10, y: 20 }, width: 320, height: 120, data: { content: 'a' } }),
      csNode({ id: 'g1', type: 'group', position: { x: 5, y: 6 }, width: 660, height: 371, data: { groupType: 'normal' } }),
    ];
    const out = toDocRecords(csNodes, {});
    expect(out.find((n) => n.id === 'n1')!.position).toEqual({ x: 10, y: 20 });
    const g = out.find((n) => n.id === 'g1')!;
    expect(g.position).toEqual({ x: 5, y: 6 });
    expect(g.width).toBe(660);
    expect(g.height).toBe(371);
  });

  it('storyboard 组被剥的半边（wh）之外，留存的 position 同样逐位恒等（identity 不因剥键打折）', () => {
    const csNodes = [
      csNode({ id: 'sb1', type: 'group', position: { x: 3, y: 4 }, width: 660, height: 371, data: { groupType: 'storyboard', cells: [] } }),
    ];
    const out = toDocRecords(csNodes, {});
    expect(out[0].position).toEqual({ x: 3, y: 4 });
    expect(out[0].width).toBeUndefined();
    expect(out[0].height).toBeUndefined();
  });
});

describe('键集表逐格（auto 组无三键/storyboard 组无 wh/分镜子无 position——stripAuthorState 同表同谓词）', () => {
  it('auto 组（cs 帧键缺失→record 键集判定非 manual）：0 帧键（position/width/height 全剥）', () => {
    const out = toDocRecords([
      csNode({ id: 'g1', type: 'group', position: { x: 1, y: 1 }, data: { groupType: 'normal' } }),
    ], {});
    expect(out[0].position).toBeUndefined();
    expect('width' in out[0]).toBe(false);
    expect('height' in out[0]).toBe(false);
  });

  it('storyboard 组：剥 width/height（尺寸=config 权威）、留 position', () => {
    const out = toDocRecords([
      csNode({ id: 'sb1', type: 'group', position: { x: 0, y: 0 }, width: 660, height: 371, data: { groupType: 'storyboard', cells: ['c1'] } }),
    ], {});
    expect(out[0].position).toEqual({ x: 0, y: 0 });
    expect(out[0].width).toBeUndefined();
    expect(out[0].height).toBeUndefined();
  });

  it('分镜子（parentId 指向 storyboard 组）：剥 position、留 width/height（全量预扫不依赖遍历序——子先父后）', () => {
    const out = toDocRecords([
      csNode({ id: 'c1', type: 'imageGen', parentId: 'sb1', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done' } }),
      csNode({ id: 'sb1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['c1'] } }),
    ], {});
    const child = out.find((n) => n.id === 'c1')!;
    expect('position' in child).toBe(false);
    expect(child.width).toBe(320);   // 分镜子只剥 position——wh 是 cell 尺寸自由面
    expect(child.height).toBe(180);
    expect(child.parentId).toBe('sb1');
  });

  it('manual 组+collapsed：三键留（折叠恢复唯一密封源）；输出满足 stripDerivedKeys 只读校验（零违例）', () => {
    const out = toDocRecords([
      csNode({ id: 'g3', type: 'group', position: { x: 5, y: 6 }, width: 300, height: 200, data: { groupType: 'normal', collapsed: true } }),
    ], {});
    expect(out[0].position).toEqual({ x: 5, y: 6 });
    expect(out[0].width).toBe(300);
    expect(out[0].height).toBe(200);
    expect(stripDerivedKeys(out)).toEqual([]);
  });
});

describe('双源合并（F42：组 data 取 cs/普通节点取 ns/ns 缺席回落 cs——projectCanvasNodes 旧契约上移单源）', () => {
  it('组取 cs data（ns 陈旧不污染）；普通节点取 ns；ns 缺席回落 cs', () => {
    const csNodes = [
      csNode({ id: 'g1', type: 'group', data: { groupType: 'storyboard', storyboard: { aspectRatio: '1:1' } } }),
      csNode({ id: 'n1', type: 'imageGen', data: { fileId: 'old' } }),
      csNode({ id: 'n2', type: 'textInput', data: { content: 'fallback' } }),
    ];
    const ns = {
      g1: { data: { groupType: 'storyboard' } },        // 组 ns 陈旧——不污染
      n1: { data: { fileId: 'new' } },                  // 普通节点 ns 优先
    };
    const out = toDocRecords(csNodes, ns);
    expect(out.find((n) => n.id === 'g1')!.data.storyboard).toEqual({ aspectRatio: '1:1' });
    expect(out.find((n) => n.id === 'n1')!.data.fileId).toBe('new');
    expect(out.find((n) => n.id === 'n2')!.data).toEqual({ content: 'fallback' });
  });

  it('type 缺省回落 videoGen（旧投影同口径）；width 缺真删键（normalize 同构——无 null 键）', () => {
    const out = toDocRecords([
      csNode({ id: 'n1', type: undefined, width: undefined }),
    ], {});
    expect(out[0].type).toBe('videoGen');
    expect('width' in out[0]).toBe(false);
  });
});

describe('round-trip：toDocRecords → fillDoc → readRecordsFromMaps 恒等（剥键形态经 doc 逐位）', () => {
  it('分镜子 doc 无 position 子 Map；读回与 toDocRecords 出口同形恒等', () => {
    const csNodes = [
      csNode({ id: 'sb1', type: 'group', position: { x: 0, y: 0 }, width: 660, height: 371, data: { groupType: 'storyboard', cells: ['c1'] } }),
      csNode({ id: 'c1', type: 'imageGen', parentId: 'sb1', position: { x: 0, y: 0 }, width: 320, height: 180, data: { status: 'done' } }),
    ];
    const out = toDocRecords(csNodes, {});
    const doc = new FakeDoc();
    fillDoc(doc, out, []);
    // doc 层：分镜子键集表跳过（无 position 子 Map——非写 {0,0}）
    const childMap = doc.getMap('nodes').get('c1') as DocMapLike;
    expect(childMap.has('position')).toBe(false);
    // 读回恒等（键集表两侧同形——三层表 doc⇄records 两层）
    expect(readRecordsFromMaps(doc).nodes).toEqual(out);
  });
});

describe('纯函数幂等（连续两次同输入⇒输出逐位相等——reconcile(cs) 幂等的可测等价锚）', () => {
  it('混合夹具（组/分镜子/普通节点）两次输出逐位相等', () => {
    const csNodes = [
      csNode({ id: 'g1', type: 'group', position: { x: 1, y: 1 }, data: { groupType: 'normal' } }),
      csNode({ id: 'sb1', type: 'group', position: { x: 0, y: 0 }, width: 660, height: 371, data: { groupType: 'storyboard', cells: ['c1'] } }),
      csNode({ id: 'c1', type: 'imageGen', parentId: 'sb1', width: 320, height: 180, data: { status: 'done' } }),
      csNode({ id: 'n1', position: { x: 9, y: 9 }, data: { content: 'a' } }),
    ];
    const ns = { n1: { data: { content: 'b' } } };
    const a = toDocRecords(csNodes, ns);
    const b = toDocRecords(csNodes, ns);
    expect(b).toEqual(a);
  });
});

describe('setDocPosition（doc position 写原语唯一单源——fillDoc/applyRecordToYMap/applyIntentToDoc moveNode 三写点共口）', () => {
  it('子 Map 缺失→经工厂创建+写入（Y.Map 嵌套形态）；在→复用既有子 Map 引用', () => {
    const doc = new FakeDoc();
    doc.getMap('nodes').set('n1', doc.createMap());
    const m = doc.getMap('nodes').get('n1') as DocMapLike;
    setDocPosition(m, { x: 1, y: 2 }, () => doc.createMap());
    const pos1 = m.get('position') as DocMapLike;
    expect(pos1.get('x')).toBe(1);
    expect(pos1.get('y')).toBe(2);
    setDocPosition(m, { x: 1, y: 2 }, () => doc.createMap());
    expect(m.get('position')).toBe(pos1);   // 同值 no-op：子 Map 引用不变（非重建）
  });

  it('值变：仅变更键逐键 diff 写（x 变 y 不动——防 doc 膨胀）', () => {
    const doc = new FakeDoc();
    fillDoc(doc, [{ id: 'n1', type: 'textInput', position: { x: 1, y: 2 }, data: {} }], []);
    const m = doc.getMap('nodes').get('n1') as DocMapLike;
    const pos0 = m.get('position') as DocMapLike;
    setDocPosition(m, { x: 5, y: 2 }, () => doc.createMap());
    const pos1 = m.get('position') as DocMapLike;
    expect(pos1).toBe(pos0);       // 复用既有子 Map
    expect(pos1.get('x')).toBe(5); // x 已写
    expect(pos1.get('y')).toBe(2); // y 同值未动
  });
});

describe('O0a-3 签名（结构性最小入参——零 xyflow/yjs import）', () => {
  it('toDocRecords(csNodes: readonly MinimalCSNode[], nsNodes)→DocNodeRecord[]；setDocPosition(m, pos, createMap)', () => {
    expectTypeOf<Parameters<typeof toDocRecords>>().toEqualTypeOf<
      [readonly MinimalCSNode[], Record<string, { data?: Record<string, unknown> }>]
    >();
    expectTypeOf<ReturnType<typeof toDocRecords>>().toEqualTypeOf<DocNodeRecord[]>();
    expectTypeOf<Parameters<typeof setDocPosition>>().toEqualTypeOf<
      [DocMapLike, { x: number; y: number }, () => DocMapLike]
    >();
  });
});

// —— O0b 挂点（it.todo 先建后清：O0b-1 unskip 接线——it.todo 计数锚，B7-1 归零）——
describe('O0a-3 计划锚：连续两次 reconcile(cs) 幂等（reconcile 是 O0b-1 符号——现不存在，it.todo 挂起）', () => {
  it.todo('O0b-1 接线：连续两次 reconcile(cs) 幂等——第二次零 setState（订阅计数=0）∧几何变更恰一次（本文件幂等等价锚=toDocRecords 纯函数两次逐位相等）');
});
