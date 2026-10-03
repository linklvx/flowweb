// packages/shared/src/canvas/docShape.schema.test.ts
// O0b-0（Spec B）格式批：doc schema 版本门 v2.1——stampDocSchema/assertDocSchema/ensureSchemaVersion
// 三函数行为测试（shared 单源，FakeDoc 零 yjs——fillRead.test 同款装置）。
// 门判据四档（plan O0b-0 Step 2⑤）：戳=2 放行 / 戳=1 拒（throw 带明确信息）/
// 无戳∧有节点 ⇒ 拒 / 无戳∧零节点 ⇒ 放行（REST 侧不盖戳——空画布合法档）。
// "无戳∧有节点"档锚构造纪律（终裁 92）：裸 doc+applyRecordToYMap 不经 fillDoc——防未来
// stamp 回归 fillDoc 时测试假绿（本批起 fillDoc 不写 meta，构造纪律仍保持）。
import { describe, it, expect } from 'vitest';
import {
  CANVAS_DOC_SCHEMA_VERSION, stampDocSchema, assertDocSchema, ensureSchemaVersion,
  applyRecordToYMap,
  type DocMapLike, type DocLike,
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

/** "无戳∧有节点"构造纪律（终裁 92）：裸 doc+applyRecordToYMap 写节点——不经 fillDoc（若未来
 *  fillDoc 回归盖章，本装置产出的仍是无戳档——锚不假绿）。 */
function bareDocWithNode(doc: DocLike): void {
  const m = doc.createMap();
  m.set('type', 'textInput');
  doc.getMap('nodes').set('n1', m);
}

describe('CANVAS_DOC_SCHEMA_VERSION=2（O0b-0 rel→abs 翻转批——旧 v1 doc 无迁移直接拒）', () => {
  it('常量钉 2（翻转后 doc=abs 空间——v1 rel 档拒载）', () => {
    expect(CANVAS_DOC_SCHEMA_VERSION).toBe(2);
  });
});

describe('stampDocSchema（写 meta.schemaVersion=CURRENT，同值 no-op——WS loadDocument 唯一自愈点/api 种子点共用）', () => {
  it('无戳 → 写 2', () => {
    const doc = new FakeDoc();
    stampDocSchema(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(2);
  });

  it('已=CURRENT → no-op（同值不重写）', () => {
    const doc = new FakeDoc();
    stampDocSchema(doc);
    const first = doc.getMap('meta').get('schemaVersion');
    stampDocSchema(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(first);
  });

  it('戳=1 → 覆写 2（函数级无条件写 CURRENT——档判定归门函数，stamp 自身不设档）', () => {
    const doc = new FakeDoc();
    doc.getMap('meta').set('schemaVersion', 1);
    stampDocSchema(doc);
    expect(doc.getMap('meta').get('schemaVersion')).toBe(2);
  });
});

describe('assertDocSchema（读断言——收到的版本==current 否则 throw）', () => {
  it('=2 放行（不抛）', () => {
    const doc = new FakeDoc();
    stampDocSchema(doc);
    expect(() => assertDocSchema(doc)).not.toThrow();
  });

  it('=1 throw（旧档明确信息）', () => {
    const doc = new FakeDoc();
    doc.getMap('meta').set('schemaVersion', 1);
    expect(() => assertDocSchema(doc)).toThrow(/schemaVersion/);
  });

  it('无戳 throw（严格读断言——比门判据严：无戳零节点也不放行）', () => {
    const doc = new FakeDoc();
    expect(() => assertDocSchema(doc)).toThrow(/schemaVersion/);
  });
});

describe('ensureSchemaVersion（四档门判据——REST 读入口 fail-closed）', () => {
  it('戳=2 放行', () => {
    const doc = new FakeDoc();
    stampDocSchema(doc);
    expect(() => ensureSchemaVersion(doc)).not.toThrow();
  });

  it('戳=1 拒（throw 带明确信息——开发期无 v1→v2 迁移）', () => {
    const doc = new FakeDoc();
    doc.getMap('meta').set('schemaVersion', 1);
    expect(() => ensureSchemaVersion(doc)).toThrow(/schemaVersion/);
  });

  it('无戳∧有节点 ⇒ 拒（裸 doc+applyRecordToYMap 构造纪律——终裁 92 防假绿）', () => {
    const doc = new FakeDoc();
    bareDocWithNode(doc);
    expect(() => ensureSchemaVersion(doc)).toThrow(/schemaVersion/);
  });

  it('无戳∧零节点 ⇒ 放行（REST 不盖戳——空画布合法档）', () => {
    const doc = new FakeDoc();
    expect(() => ensureSchemaVersion(doc)).not.toThrow();
  });

  it('sv 路径同门：ensureSchemaVersion 从全量 doc 读 meta（不依赖 sv 差量——调用方自行传 sv）', () => {
    // 本函数签名只收 docLike——sv 差量是调用方（readCanvas）的事，门判据恒读全量 meta
    const doc = new FakeDoc();
    doc.getMap('meta').set('schemaVersion', 1);
    expect(() => ensureSchemaVersion(doc)).toThrow(/schemaVersion/);
  });
});
