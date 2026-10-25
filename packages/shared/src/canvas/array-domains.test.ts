// packages/shared/src/canvas/array-domains.test.ts
// Y1c T17：媒体列表 Y.Array 域单源契约测试——词表派生（DOC_SCHEMA_V4 单源）/结构操作 diff
// （add/remove/reorder=delete+insert/replace/no-op）/物化/写 seam 拒绝三档/ensure 缺省纯函数。
// 零 yjs import 面（fake YArrayLike 装置——isYArrayLike 结构性判定）；web 真链红绿=
// canvasIntents.t17-array-domains.spec.ts（并发 add/remove/reorder/undo 真双 doc）。
import { describe, it, expect } from 'vitest';
import {
  ARRAY_DOMAINS, deriveArrayDomains, isMediaListDomainKey, isYArrayLike,
  isMediaListValue, computeArraySplice, writeArrayDomainValue,
  materializeArrayDomainValue, ensureArrayDomainDefaults,
  type YArrayLike,
} from './array-domains';
import { DOC_SCHEMA_V4 } from './doc-schema-v4';
import { isDocMap, type DocMapLike } from './collab-doc-ops';

// ── 装置：fake 容器（真 Y.Array 结构兼容面——零 yjs import 纪律）──
class FakeArray implements YArrayLike {
  items: unknown[] = [];
  get length() { return this.items.length; }
  get(i: number) { return this.items[i]; }
  insert(i: number, items: unknown[]) { this.items.splice(i, 0, ...items); }
  delete(i: number, len: number) { this.items.splice(i, len); }
}

class FakeMap implements DocMapLike {
  backing = new Map<string, unknown>();
  get(k: string) { return this.backing.get(k); }
  set(k: string, v: unknown) { this.backing.set(k, v); return this; }
  has(k: string) { return this.backing.has(k); }
  delete(k: string) { return this.backing.delete(k); }
  entries(): Iterable<[string, unknown]> { return this.backing.entries(); }
}

const item = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, url: `/u/${id}`, name: `${id}.png`, status: 'success', ...extra });

describe('Y1c T17 词表单源：ARRAY_DOMAINS 自 DOC_SCHEMA_V4 派生（禁第二真源）', () => {
  it('派生=矩阵 yType=array 行精确冻结：imageGen/imageExtGen/videoGen{allImages}+multiImageGen{images}', () => {
    expect(ARRAY_DOMAINS).toEqual(deriveArrayDomains(DOC_SCHEMA_V4));
    expect(ARRAY_DOMAINS.imageGen).toEqual(new Set(['allImages']));
    expect(ARRAY_DOMAINS.imageExtGen).toEqual(new Set(['allImages']));
    expect(ARRAY_DOMAINS.videoGen).toEqual(new Set(['allImages']));
    expect(ARRAY_DOMAINS.multiImageGen).toEqual(new Set(['images']));
    expect(Object.keys(ARRAY_DOMAINS).sort()).toEqual(['imageExtGen', 'imageGen', 'multiImageGen', 'videoGen']);
  });

  it('域键判定：命中四域/未命中（text 域/xml 域/未知类型/非域键）', () => {
    expect(isMediaListDomainKey('imageGen', 'allImages')).toBe(true);
    expect(isMediaListDomainKey('multiImageGen', 'images')).toBe(true);
    expect(isMediaListDomainKey('multiImageGen', 'allImages')).toBe(false);   // 域键×类型错位不命中
    expect(isMediaListDomainKey('imageGen', 'prompt')).toBe(false);
    expect(isMediaListDomainKey('audioGen', 'prompt')).toBe(false);
    expect(isMediaListDomainKey(undefined, 'allImages')).toBe(false);
  });

  it('矩阵 items 规格：数组域条目 canDelete=false（容器随节点建禁整删——G17）', () => {
    for (const [type, key] of [['imageGen', 'allImages'], ['imageExtGen', 'allImages'], ['videoGen', 'allImages'], ['multiImageGen', 'images']] as const) {
      expect(DOC_SCHEMA_V4[type].data[key]?.yType).toBe('array');
      expect(DOC_SCHEMA_V4[type].data[key]?.canDelete).toBe(false);
    }
  });
});

describe('Y1c T17 computeArraySplice：稳定 id LCS diff（add/remove/reorder/replace/no-op）', () => {
  it('no-op：同值零操作（防膨胀）', () => {
    const plan = computeArraySplice([item('X'), item('R')], [item('X'), item('R')]);
    expect(plan.deletes).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  it('add（头/中/尾）：单插入', () => {
    expect(computeArraySplice([item('X'), item('R')], [item('H'), item('X'), item('R')]).inserts)
      .toEqual([{ index: 0, items: [item('H')] }]);
    expect(computeArraySplice([item('X'), item('R')], [item('X'), item('M'), item('R')]).inserts)
      .toEqual([{ index: 1, items: [item('M')] }]);
    expect(computeArraySplice([item('X'), item('R')], [item('X'), item('R'), item('Y')]).inserts)
      .toEqual([{ index: 2, items: [item('Y')] }]);
  });

  it('remove：单删除（降位序）', () => {
    expect(computeArraySplice([item('X'), item('R'), item('Y')], [item('X'), item('Y')]).deletes)
      .toEqual([{ index: 1, len: 1 }]);
  });

  it('reorder：delete+insert 双半边（move=R 前——一删一插，LCS 等长双解取 DP tie-break 形态）', () => {
    const cur = [item('X'), item('R'), item('Y')];
    const next = [item('R'), item('X'), item('Y')];
    const plan = computeArraySplice(cur, next);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.inserts).toHaveLength(1);
    // 应用合成性质（删降序+插升序 ⇒ 恒等 next——精确位序由应用断言锚，非 op 序形态）
    const c = new FakeArray();
    c.items = [...cur];
    for (const d of plan.deletes) c.delete(d.index, d.len);
    for (const ins of plan.inserts) c.insert(ins.index, ins.items);
    expect(c.items).toEqual(next);
  });

  it('replace（同 id 内容变更）：原位 delete+insert', () => {
    const plan = computeArraySplice([item('X'), item('R', { progress: 30 })], [item('X'), item('R', { progress: 100 })]);
    expect(plan.deletes).toEqual([{ index: 1, len: 1 }]);
    expect(plan.inserts).toEqual([{ index: 1, items: [item('R', { progress: 100 })] }]);
  });

  it('容器项无有效 id（对抗面）：不参与匹配——按 next 全量收敛（确定性删后插）', () => {
    const plan = computeArraySplice(['junk', item('X'), 42], [item('X'), item('N')]);
    const kept = plan.deletes.map((d) => d.index);
    expect(kept).toEqual([2, 0]);   // junk/42 删（无 id 不匹配，降位序），X 保留
    expect(plan.inserts).toEqual([{ index: 1, items: [item('N')] }]);
  });

  it('应用序合成性质：deletes 降序+inserts 升序应用 ⇒ 容器恒等于 next（随机性质采样）', () => {
    let s = 7;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    for (let t = 0; t < 50; t += 1) {
      const cur = Array.from({ length: Math.floor(rnd() * 6) }, (_, i) => item(`c${i}`, { v: Math.floor(rnd() * 3) }));
      const nextIds = cur.map((x) => x.id as string).filter(() => rnd() > 0.3);
      if (rnd() > 0.5) nextIds.reverse();
      for (let i = 0; i < Math.floor(rnd() * 3); i += 1) nextIds.push(`n${t}-${i}`);
      const next = nextIds.map((id) => item(id, { v: Math.floor(rnd() * 3) }));
      const c = new FakeArray();
      c.items = [...cur];
      const plan = computeArraySplice(cur, next);
      for (const d of plan.deletes) c.delete(d.index, d.len);
      for (const ins of plan.inserts) c.insert(ins.index, ins.items);
      expect(c.items, `采样#${t}`).toEqual(next);
    }
  });
});

describe('Y1c T17 值域/结构判定', () => {
  it('isMediaListValue：合法=对象携唯一非空 id；非数组/无 id/重复 id 全拒', () => {
    expect(isMediaListValue([item('X'), item('R')])).toBe(true);
    expect(isMediaListValue([])).toBe(true);
    expect(isMediaListValue('junk')).toBe(false);
    expect(isMediaListValue([{ url: '/u' }])).toBe(false);
    expect(isMediaListValue([item('D'), item('D')])).toBe(false);
    expect(isMediaListValue([null, 42])).toBe(false);
  });

  it('isYArrayLike：方法属性 typeof 检（伪形态 {insert:1} 不误判；Y.Text 形无 get 不命中）', () => {
    expect(isYArrayLike(new FakeArray())).toBe(true);
    expect(isYArrayLike({ insert: 1, delete: 1, get: 1 })).toBe(false);
    expect(isYArrayLike([1, 2])).toBe(false);
    expect(isYArrayLike({ insert: () => {}, delete: () => {} })).toBe(false);   // 无 get（Y.Text 形）
  });
});

describe('Y1c T17 writeArrayDomainValue：写 seam 三档拒绝+结构操作落值', () => {
  it('container-missing：键缺席拒不懒建（§3.5）', () => {
    const data = new FakeMap();
    expect(writeArrayDomainValue(data, 'allImages', [item('X')])).toEqual({ ok: false, reason: 'container-missing' });
    expect(data.has('allImages')).toBe(false);
  });

  it('container-type-mismatch：legacy plain array/string 覆在位=结构错误暴露', () => {
    const d1 = new FakeMap(); d1.set('allImages', [item('X')]);
    expect(writeArrayDomainValue(d1, 'allImages', [item('X'), item('R')])).toEqual({ ok: false, reason: 'container-type-mismatch' });
    expect(d1.get('allImages')).toEqual([item('X')]);
    const d2 = new FakeMap(); d2.set('allImages', 'legacy');
    expect(writeArrayDomainValue(d2, 'allImages', [item('X')])).toEqual({ ok: false, reason: 'container-type-mismatch' });
  });

  it('value-form-mismatch：非数组/无 id/重复 id', () => {
    const data = new FakeMap();
    data.set('allImages', new FakeArray());
    for (const bad of ['junk', [{ noId: 1 }], [item('D'), item('D')]]) {
      expect(writeArrayDomainValue(data, 'allImages', bad)).toEqual({ ok: false, reason: 'value-form-mismatch' });
    }
  });

  it('合法写：容器内最小 op 落值+changed 语义（no-op=false）', () => {
    const data = new FakeMap();
    const c = new FakeArray();
    c.insert(0, [item('X'), item('R')]);
    data.set('allImages', c);
    expect(writeArrayDomainValue(data, 'allImages', [item('R'), item('X')])).toEqual({ ok: true, changed: true });
    expect(c.items).toEqual([item('R'), item('X')]);
    expect(writeArrayDomainValue(data, 'allImages', [item('R'), item('X')])).toEqual({ ok: true, changed: false });
    expect(writeArrayDomainValue(data, 'allImages', [item('R')])).toEqual({ ok: true, changed: true });
    expect(c.items).toEqual([item('R')]);
  });

  it('容器 item 双形态（DocMap 形——读归一参与匹配）：保留项原实例不动，新项 plain 插入', () => {
    const data = new FakeMap();
    const c = new FakeArray();
    const m = new FakeMap();
    m.set('id', 'X'); m.set('url', '/u/X'); m.set('name', 'X.png'); m.set('status', 'success');
    c.insert(0, [m]);
    data.set('allImages', c);
    expect(writeArrayDomainValue(data, 'allImages', [item('X'), item('R')])).toEqual({ ok: true, changed: true });
    expect(c.items[0]).toBe(m);                 // 同 id 同内容 ⇒ 原实例原位（零 op）
    expect(c.items[1]).toEqual(item('R'));      // 新项 plain 落位
  });
});

describe('Y1c T17 materialize/ensure（创建 seam 两件套——纯函数纪律）', () => {
  it('materialize：plain array→全新容器（item 浅拷入）；实例透传；异形透传（结构错误暴露）', () => {
    const f = { createArray: () => new FakeArray() };
    const src = [item('X')];
    const m = materializeArrayDomainValue(src, f) as FakeArray;
    expect(m).toBeInstanceOf(FakeArray);
    expect(m.items).toEqual([item('X')]);
    expect(m.items[0]).not.toBe(src[0]);   // 浅拷（调用方数组与容器引用隔离）
    const inst = new FakeArray();
    expect(materializeArrayDomainValue(inst, f)).toBe(inst);   // 回灌透传
    expect(materializeArrayDomainValue('junk', f)).toBe('junk');   // 异形透传
    expect(materializeArrayDomainValue(undefined, f)).toBeUndefined();   // 不发明缺席键
  });

  it('ensure：缺域键补 []（副本——入参不突变）；已在键不覆写；非域类型原引用直通', () => {
    const a = ensureArrayDomainDefaults('imageGen', {});
    expect(a).toEqual({ allImages: [] });
    const b = ensureArrayDomainDefaults('imageGen', { allImages: [item('X')] });
    expect(b.allImages).toEqual([item('X')]);
    const untouched = { model: 'm' };
    expect(ensureArrayDomainDefaults('audioGen', untouched)).toBe(untouched);   // 无缺省键=原引用
    const multi = ensureArrayDomainDefaults('multiImageGen', {});
    expect(multi).toEqual({ images: [] });
  });
});

describe('Y1c T17 media-refs 收敛维持：item id 双形态提取（array-domains 与 media-refs 同口径）', () => {
  it('isDocMap 面零漂移：fake DocMap item 与 plain item 同判（refListOf/refItemId 并存实证注记）', () => {
    expect(isDocMap(new FakeMap())).toBe(true);
    // itemIdOf 私有——经 computeArraySplice 行为面间接锚（DocMap 形用例见上）
    expect(computeArraySplice([new FakeMap()], [])).toEqual({ deletes: [{ index: 0, len: 1 }], inserts: [] });
  });
});
