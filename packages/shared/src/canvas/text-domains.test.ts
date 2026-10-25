// packages/shared/src/canvas/text-domains.test.ts
// Y1c T15：Y.Text 域单源单测——词表派生（DOC_SCHEMA_V4 单源）+computeTextSplice 最小 diff
// +materialize/ensure 创建 seam +writeTextDomainValue 拒写三档（容器规则 §3.5）。
import { describe, it, expect } from 'vitest';
import {
  TEXT_DOMAINS, textDomainOf, computeTextSplice, spliceTextLike, isTextLike,
  materializeTextDomainValue, ensureTextDomainDefaults, writeTextDomainValue,
  type TextLike, type TextDomainShape,
} from './text-domains';
import type { DocMapLike } from './collab-doc-ops';

// ── 内存装置（零 yjs——shared 测试纪律同 docShape.fillRead.test）──
class FakeText {
  private s = '';
  get length(): number { return this.s.length; }
  toString(): string { return this.s; }
  insert(index: number, text: string): void { this.s = this.s.slice(0, index) + text + this.s.slice(index); }
  delete(index: number, len: number): void { this.s = this.s.slice(0, index) + this.s.slice(index + len); }
}
class FakeMap implements DocMapLike {
  constructor(private readonly backing = new Map<string, unknown>()) {}
  get(k: string) { return this.backing.get(k); }
  set(k: string, v: unknown) { this.backing.set(k, v); return this; }
  has(k: string) { return this.backing.has(k); }
  delete(k: string) { this.backing.delete(k); return true; }
  entries(): Iterable<[string, unknown]> { return this.backing.entries(); }
}
const F = { createText: (): TextLike => new FakeText() as unknown as TextLike, createMap: (): DocMapLike => new FakeMap() };

describe('Y1c T15 TEXT_DOMAINS 词表（DOC_SCHEMA_V4 单源派生——spec §3.1 三域）', () => {
  it('三域恰在本表：audioGen/multiImageGen.prompt=text；textInput.prompt=map-text', () => {
    expect(TEXT_DOMAINS.audioGen).toEqual({ prompt: 'text' });
    expect(TEXT_DOMAINS.multiImageGen).toEqual({ prompt: 'text' });
    expect(TEXT_DOMAINS.textInput).toEqual({ prompt: 'map-text' });
  });
  it('imageGen/videoGen/imageExtGen.prompt（xml——T16）与 group.storyboard（map 无 text 子）不入表', () => {
    expect(TEXT_DOMAINS.imageGen?.prompt).toBeUndefined();
    expect(TEXT_DOMAINS.videoGen?.prompt).toBeUndefined();
    expect(TEXT_DOMAINS.imageExtGen?.prompt).toBeUndefined();
    expect(TEXT_DOMAINS.group?.storyboard).toBeUndefined();
  });
  it('textDomainOf：未知类型/非域键=undefined', () => {
    expect(textDomainOf('audioGen', 'prompt')).toBe('text');
    expect(textDomainOf('textInput', 'prompt')).toBe('map-text');
    expect(textDomainOf('videoGen', 'prompt')).toBeUndefined();
    expect(textDomainOf('audioGen', 'model')).toBeUndefined();
    expect(textDomainOf(123, 'prompt')).toBeUndefined();
  });
});

describe('Y1c T15 computeTextSplice（整串 → 最小 splice——公共前缀/后缀裁剪）', () => {
  it.each([
    ['同值 no-op', 'abc', 'abc', { index: 0, remove: 0, insert: '' }],
    ['尾部追加（IME 续打）', 'abc', 'abcd', { index: 3, remove: 0, insert: 'd' }],
    ['IME 组段替换（1 字符换 3 字符）', 'にほん', '日本語です', { index: 0, remove: 3, insert: '日本語です' }],
    ['粘贴中段插入', 'hello world', 'hello 【块】 world', { index: 6, remove: 0, insert: '【块】 ' }],
    ['选区整段替换', 'hello 【粘贴的长文本块】 world', 'hello 短词 world', { index: 6, remove: 9, insert: '短词' }],
    ['整删（面板清空）', 'abc', '', { index: 0, remove: 3, insert: '' }],
    ['公共前后缀夹逼（中段最小化）', 'aaXaa', 'aaYaa', { index: 2, remove: 1, insert: 'Y' }],
  ])('%s', (_n, cur, next, want) => {
    expect(computeTextSplice(cur as string, next as string)).toEqual(want);
  });
  it('spliceTextLike 应用收敛（cur→next 精确到达）+同值 false（no-op 防 doc 膨胀）', () => {
    const t = F.createText();
    t.insert(0, 'hello world');
    expect(spliceTextLike(t, 'hello 【块】 world')).toBe(true);
    expect(t.toString()).toBe('hello 【块】 world');
    expect(spliceTextLike(t, 'hello 【块】 world')).toBe(false);
  });
});

describe('Y1c T15 创建 seam（materialize+ensure——fillDoc 消费面）', () => {
  it("materialize 'text'：string→TextLike（值随容器）；TextLike 实例原样（rebuild 别名禁入）；异形原样不发明", () => {
    const t = materializeTextDomainValue('text', '词', F) as TextLike;
    expect(isTextLike(t)).toBe(true);
    expect(t.toString()).toBe('词');
    const existing = F.createText();
    expect(materializeTextDomainValue('text', existing, F)).toBe(existing);
    expect(materializeTextDomainValue('text', 42, F)).toBe(42);
  });
  it("materialize 'map-text'：{text}→Map{text:TextLike}；DocMapLike 原样；异形原样", () => {
    const m = materializeTextDomainValue('map-text', { text: '面板词' }, F) as FakeMap;
    expect(m.get('text')).toBeTruthy();
    expect((m.get('text') as TextLike).toString()).toBe('面板词');
    const existingMap = F.createMap();
    expect(materializeTextDomainValue('map-text', existingMap, F)).toBe(existingMap);
    expect(materializeTextDomainValue('map-text', '裸串', F)).toBe('裸串');
  });
  it("ensureTextDomainDefaults：域键缺省补齐（空串/{text:空串}）——已在键不覆写", () => {
    const d1: Record<string, unknown> = { model: 'm' };
    ensureTextDomainDefaults('audioGen', d1);
    expect(d1).toEqual({ model: 'm', prompt: '' });
    const d2: Record<string, unknown> = { content: '' };
    ensureTextDomainDefaults('textInput', d2);
    expect(d2).toEqual({ content: '', prompt: { text: '' } });
    const d3: Record<string, unknown> = { prompt: '显式初值' };
    ensureTextDomainDefaults('audioGen', d3);
    expect(d3.prompt).toBe('显式初值');
    const d4: Record<string, unknown> = {};
    ensureTextDomainDefaults('videoGen', d4); // 非域类型零动作
    expect(d4).toEqual({});
  });
});

describe('Y1c T15 写 seam 拒写三档（writeTextDomainValue——容器规则 §3.5）', () => {
  const mkData = (shape: TextDomainShape, withContainer: boolean): DocMapLike => {
    const data = F.createMap();
    if (!withContainer) return data;
    if (shape === 'text') data.set('prompt', F.createText());
    else {
      const inner = F.createMap();
      inner.set('text', F.createText());
      data.set('prompt', inner);
    }
    return data;
  };
  it('缺容器=container-missing（拒绝不懒建——结构错误暴露）', () => {
    const data = mkData('text', false);
    expect(writeTextDomainValue(data, 'text', 'prompt', 'x')).toEqual({ ok: false, reason: 'container-missing' });
    expect(data.has('prompt')).toBe(false);
  });
  it('容器形状错=container-type-mismatch（string 覆在容器位——不掩盖）', () => {
    const data = F.createMap();
    data.set('prompt', 'legacy-string');
    expect(writeTextDomainValue(data, 'text', 'prompt', 'x')).toEqual({ ok: false, reason: 'container-type-mismatch' });
    expect(data.get('prompt')).toBe('legacy-string');
  });
  it("map-text 内层缺 text 子=container-type-mismatch（不懒建内层）", () => {
    const data = F.createMap();
    data.set('prompt', F.createMap());
    expect(writeTextDomainValue(data, 'map-text', 'prompt', 'x')).toEqual({ ok: false, reason: 'container-type-mismatch' });
  });
  it('值形态错=value-form-mismatch（number/异形对象——undefined 删键语义同拒：容器 canDelete=false）', () => {
    const data = mkData('text', true);
    expect(writeTextDomainValue(data, 'text', 'prompt', 42)).toEqual({ ok: false, reason: 'value-form-mismatch' });
    expect(writeTextDomainValue(data, 'text', 'prompt', undefined)).toEqual({ ok: false, reason: 'value-form-mismatch' });
    const dm = mkData('map-text', true);
    expect(writeTextDomainValue(dm, 'map-text', 'prompt', { foo: 1 })).toEqual({ ok: false, reason: 'value-form-mismatch' });
  });
  it('合法写：text=string / map-text={text}|string 两形——最小 splice 落容器', () => {
    const data = mkData('text', true);
    expect(writeTextDomainValue(data, 'text', 'prompt', 'abc')).toEqual({ ok: true, changed: true });
    expect((data.get('prompt') as TextLike).toString()).toBe('abc');
    expect(writeTextDomainValue(data, 'text', 'prompt', 'abc')).toEqual({ ok: true, changed: false });
    const dm = mkData('map-text', true);
    expect(writeTextDomainValue(dm, 'map-text', 'prompt', { text: '面板词' })).toEqual({ ok: true, changed: true });
    expect(writeTextDomainValue(dm, 'map-text', 'prompt', '面板词扩展')).toEqual({ ok: true, changed: true });
    expect(((dm.get('prompt') as FakeMap).get('text') as TextLike).toString()).toBe('面板词扩展');
  });
});
