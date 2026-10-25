// packages/shared/src/canvas/docShape.schema.test.ts
// T18（plan v11.2 S5 片·Y1b T2/Y1c 版本硬切）：doc schema 版本 v2→v3——meta.schemaVersion
// 整链退役（stamp/assert/ensure 三函数删除），版本判据唯一承载=CanvasDoc.schemaVersion PG 列
// （api 装载门消费——本文件只锚 shared 侧契约：常量=3+doc 内容零版本键）。
// 旧 v2.1 四档门行为测试随函数退役整删（门档语义改由 api 侧列门 spec 承载——
// collab-version-gate.spec 的 schemaRefusal 用例：行 schemaVersion≠3 → 拒载）。
import { describe, it, expect } from 'vitest';
import { CANVAS_DOC_SCHEMA_VERSION, fillDoc, type DocLike } from './docShape';
import type { DocMapLike } from './collab-doc-ops';

// ── FakeDoc：DocLike 内存假实现（零 yjs——docShape.fillRead.test 同款装置）──
class FakeMap implements DocMapLike {
  private inner = new Map<string, unknown>();
  get = (key: string): unknown => this.inner.get(key);
  set = (key: string, value: unknown): void => { this.inner.set(key, value); };
  has = (key: string): boolean => this.inner.has(key);
  delete = (key: string): void => { this.inner.delete(key); };
  entries = (): Iterable<[string, unknown]> => this.inner.entries();
}
/** FakeText：TextLike 内存假实现（Y1c T15 DocLike.createText——fillDoc 域容器物化消费）。 */
class FakeText {
  private s = '';
  get length(): number { return this.s.length; }
  toString(): string { return this.s; }
  insert(index: number, text: string): void { this.s = this.s.slice(0, index) + text + this.s.slice(index); }
  delete(index: number, len: number): void { this.s = this.s.slice(0, index) + this.s.slice(index + len); }
}
class FakeDoc implements DocLike {
  private maps = new Map<string, FakeMap>();
  getMap = (name: string): FakeMap => {
    let m = this.maps.get(name);
    if (!m) { m = new FakeMap(); this.maps.set(name, m); }
    return m;
  };
  createMap = (): FakeMap => new FakeMap();
  createText = (): FakeText => new FakeText();
  // Y1c T16：XML 三工厂 fake（零行为容器——schema 用例无 XML 域键物化路径）
  createXmlFragment = (): { insert(): void } => ({ insert: () => {} });
  createXmlElement = (_name: string): { insert(): void; setAttribute(): void } => ({ insert: () => {}, setAttribute: () => {} });
  createXmlText = (): { insert(): void; setAttribute(): void } => ({ insert: () => {}, setAttribute: () => {} });
}

describe('CANVAS_DOC_SCHEMA_VERSION=3（T18 版本硬切——meta 门退役，版本承载=CanvasDoc.schemaVersion PG 列）', () => {
  it('常量钉 3（与 CLIENT_PROTOCOL_VERSION 同 bump——双常量=3；行值≠3 由 api 装载列门拒）', () => {
    expect(CANVAS_DOC_SCHEMA_VERSION).toBe(3);
  });
});

describe('doc 内容不再带版本（meta map 零版本键——客户端无从篡改，Y1b T2 裁定 2）', () => {
  it('fillDoc 产 doc 的 meta 恒空（无任何写者——旧档 doc 内残留 meta.schemaVersion 仅作历史载荷不再被读）', () => {
    const doc = new FakeDoc();
    fillDoc(doc, [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }], []);
    expect([...doc.getMap('meta').entries()].length).toBe(0);
    expect(doc.getMap('meta').get('schemaVersion')).toBeUndefined();
  });
});
