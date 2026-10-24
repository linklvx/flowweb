// packages/shared/src/canvas/doc-codec.roundtrip.spec.ts
// Y1c T4（plan v1.7）：DocCodec 双出口 round-trip 属性测试——真 Yjs 类型直用（zero-yjs 纪律废止，
// shared 直用 Y.Doc/Y.Map/Y.Text/Y.XmlFragment/Y.Array）。红=本文件 import './doc-codec' 即败
//（模块尚不存在）；绿=serializeCanvas/toReadModel/toPublicReadModel/rebuildCanvasDoc/semanticEqual。
// 覆盖矩阵：①v3 纯 JSON doc：toReadModel ≡ readRecordsFromMaps（收编零行为变更锚——含
// JSON.stringify 键序恒等〔api vacuum 等价判据口径〕）②v4 嵌套类型 doc（XmlFragment 含
// paragraph+mention+image PM 节点/Y.Map{text:Y.Text}/Y.Array 媒体/position Y.Map 逐键）：
// serialize→rebuild→re-serialize 语义恒等（非字节相等）③反别名断言（F-S2-1 方向锁——重建后
// 变异源 doc 不波及重建 doc）④toReadModel 平面 JSON（文本 string/富文本 {text,html,json}
// ——零共享 Y 实例逃逸）⑤toPublicReadModel（dropTypes/键白名单/RichTextValue 只余 text/
// URL host allowlist）⑥属性式 fuzz（种子 PRNG——随机 doc 反复 round-trip）。
// 附：E68 对抗语料族（Y1c T4 收编迁移自 apps/api adversarial-readers.spec——readRecordsFromMaps
// 转 codec 内部单源 import，FakeMap DocLike 直读用例随迁 shared；api 侧该 spec 删除）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  serializeCanvas, toReadModel, toPublicReadModel, rebuildCanvasDoc, semanticEqual,
  type CanvasReadModel, type RichTextValue,
} from './doc-codec';
import { fillDoc, readRecordsFromMaps, type DocLike, type DocEdgeRecord } from './docShape';
import { setDocPosition, type DocMapLike, type StoredNodeRecord } from './collab-doc-ops';
import { generateAdversarialDocs } from '../testing/adversarial-doc';

// ── Y.Doc→DocLike 结构适配（本 spec 测试装置——ydocBuilder/doc-like.util 同款五行）──
const toDocLike = (doc: Y.Doc): DocLike => ({
  getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
  createMap: () => new Y.Map() as unknown as DocMapLike,
});
const asDocMap = (m: Y.Map<unknown>) => m as unknown as DocMapLike;

// ── fixture：v3 纯 JSON doc（fillDoc 种子——键可选三层表：全键/裸节点/组无帧键）──
function buildV3FixtureDoc(): Y.Doc {
  const doc = new Y.Doc();
  fillDoc(toDocLike(doc), [
    { id: 'ti1', type: 'textInput', parentId: 'g1', width: 320, height: 120, position: { x: 10, y: 20 }, data: { content: '<p>正文</p>', prompt: '提示词', model: 'm1', order: 1 } },
    { id: 'ig1', type: 'imageGen', width: 512, position: { x: 0, y: 0 }, data: { referenceImage: 'ref-1', style: 'anime', allImages: ['m-1', 'm-2'], status: 'done' } },
    { id: 'au1', type: 'audioGen', data: { content: '旁白', model: 'm2' } },
    { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'normal', name: '组' } },
  ] as StoredNodeRecord[], [
    { id: 'e1', source: 'ti1', target: 'ig1' },
    { id: 'e2', source: 'ig1', target: 'au1' },
  ] as DocEdgeRecord[]);
  return doc;
}

// ── fixture：v4 嵌套类型 doc（8 类型节点——DOC_SCHEMA_V4 键域；content/prompt=XmlFragment、
//    prompt 容器=Y.Map{text:Y.Text}、content=Y.Text、allImages/images=Y.Array、storyboard=Y.Map、
//    position 经 setDocPosition 逐键写）──
const CONTENT_PM_JSON = [
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: '看这张 ' },
      { type: 'mention', attrs: { 'data-id': 'u1', label: '@bob' } },
      { type: 'text', text: ' 的图' },
    ],
  },
  { type: 'image', attrs: { src: 'https://cdn.example.com/a.png', alt: '封面图' } },
];

function xmlFragmentOfParaAndImage(): Y.XmlFragment {
  const frag = new Y.XmlFragment();
  const para = new Y.XmlElement('paragraph');
  const t1 = new Y.XmlText(); t1.insert(0, '看这张 ');
  const mention = new Y.XmlElement('mention');
  mention.setAttribute('data-id', 'u1'); mention.setAttribute('label', '@bob');
  const t2 = new Y.XmlText(); t2.insert(0, ' 的图');
  para.insert(0, [t1, mention, t2]);
  const img = new Y.XmlElement('image');
  img.setAttribute('src', 'https://cdn.example.com/a.png'); img.setAttribute('alt', '封面图');
  frag.insert(0, [para, img]);
  return frag;
}

function ytext(s: string): Y.Text {
  const t = new Y.Text();
  t.insert(0, s);
  return t;
}

function ymap(entries: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(entries)) m.set(k, v);
  return m;
}

function yarray(items: unknown[]): Y.Array<unknown> {
  const a = new Y.Array<unknown>();
  a.push(items);
  return a;
}

function buildV4FixtureDoc(): Y.Doc {
  const doc = new Y.Doc();
  const nodes = doc.getMap('nodes');

  const mkNode = (id: string, type: string, data: Y.Map<unknown>, pos?: { x: number; y: number }, width?: number, height?: number, parentId?: string) => {
    const m = new Y.Map<unknown>();
    m.set('type', type);
    if (parentId != null) m.set('parentId', parentId);
    if (width != null) m.set('width', width);
    if (height != null) m.set('height', height);
    if (pos != null) setDocPosition(asDocMap(m), pos, () => new Y.Map() as unknown as DocMapLike);   // position Y.Map 逐键
    m.set('data', data);
    nodes.set(id, m);
  };

  // textInput：content=XmlFragment、prompt=Y.Map{text:Y.Text}
  const tiData = new Y.Map<unknown>();
  tiData.set('content', xmlFragmentOfParaAndImage());
  tiData.set('prompt', ymap({ text: ytext('生成一张封面') }));
  tiData.set('model', 'gpt-cover');
  tiData.set('order', 1);
  mkNode('ti1', 'textInput', tiData, { x: 10, y: 20 }, 320, 120);

  // imageGen：prompt=XmlFragment、allImages=Y.Array、referenceImage=URL（host=cdn.example.com）
  const igData = new Y.Map<unknown>();
  igData.set('prompt', (() => { const f = new Y.XmlFragment(); const p = new Y.XmlElement('paragraph'); const t = new Y.XmlText(); t.insert(0, '画一只猫'); p.insert(0, [t]); f.insert(0, [p]); return f; })());
  igData.set('allImages', yarray(['m-1', 'm-2']));
  igData.set('referenceImage', 'https://cdn.example.com/ok.png');
  igData.set('style', 'anime');
  igData.set('slot', 3);
  igData.set('order', 2);
  mkNode('ig1', 'imageGen', igData, { x: 0, y: 0 });

  // imageExtGen：extConfig=Y.Map 嵌套容器
  const extData = new Y.Map<unknown>();
  extData.set('extConfig', ymap({ ratio: '16:9', generateCount: 4 }));
  extData.set('aiTool', 'tool-x');
  mkNode('ie1', 'imageExtGen', extData, { x: 5, y: 5 }, 300, 300, 'g1');

  // videoGen：label=外域 URL（public allowlist 域外——剥除用例）
  const vgData = new Y.Map<unknown>();
  vgData.set('prompt', ytext('生成视频'));   // 混载体容错：Y.Text 裸值（读出口=string）
  vgData.set('label', 'https://evil.example.com/bad.png');
  mkNode('vg1', 'videoGen', vgData, { x: 40, y: 40 });

  // audioGen：content=Y.Text（v4 目标载体）
  const auData = new Y.Map<unknown>();
  auData.set('content', ytext('旁白文本'));
  auData.set('model', 'm-audio');
  mkNode('au1', 'audioGen', auData);

  // multiImageGen：images=Y.Array、prompt=Y.Text
  const miData = new Y.Map<unknown>();
  miData.set('images', yarray([{ mediaId: 'mi-1' }, { mediaId: 'mi-2' }]));
  miData.set('prompt', ytext('多图提示'));
  miData.set('label', '多图');
  mkNode('mi1', 'multiImageGen', miData);

  // videoEdit：仅 order（census ② 结构面）
  mkNode('ve1', 'videoEdit', ymap({ order: 7 }));

  // group：storyboard=Y.Map 容器
  const gData = new Y.Map<unknown>();
  gData.set('groupType', 'storyboard');
  gData.set('storyboard', ymap({ aspectRatio: '16:9', gridRows: 2, gridCols: 3 }));
  mkNode('g1', 'group', gData, { x: 0, y: 0 });

  const edges = doc.getMap('edges');
  const e1 = new Y.Map<unknown>(); e1.set('source', 'ti1'); e1.set('target', 'ig1'); edges.set('e1', e1);
  const e2 = new Y.Map<unknown>(); e2.set('source', 'vg1'); e2.set('target', 've1'); edges.set('e2', e2);
  return doc;
}

// ── 断言装置：read model 全树零 Y 实例（禁止共享类型逃逸）──
const assertPlainJson = (v: unknown, path = '$'): void => {
  if (v == null || typeof v !== 'object') return;
  if (v instanceof Y.Map || v instanceof Y.Text || v instanceof Y.Array
    || v instanceof Y.XmlFragment || v instanceof Y.XmlElement || v instanceof Y.Doc) {
    throw new Error(`${path}: 共享 Y 实例逃逸 read model（${v.constructor.name}）`);
  }
  if (Array.isArray(v)) { v.forEach((x, i) => assertPlainJson(x, `${path}[${i}]`)); return; }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new Error(`${path}: 非 plain object（${proto?.constructor?.name}）`);
  for (const [k, x] of Object.entries(v)) assertPlainJson(x, `${path}.${k}`);
};

describe('Y1c T4 DocCodec：v3 纯 JSON doc——toReadModel ≡ readRecordsFromMaps（收编零行为变更锚）', () => {
  it('逐位相等（toEqual）+ JSON.stringify 键序恒等（api vacuumEquivalent 同口径）', () => {
    const doc = buildV3FixtureDoc();
    const codec = toReadModel(doc);
    const legacy = readRecordsFromMaps(toDocLike(doc));
    expect(codec).toEqual(legacy);
    expect(JSON.stringify(codec)).toBe(JSON.stringify(legacy));   // 键序恒等（:660 判据换轨不漂移）
  });

  it('serializeCanvas → rebuildCanvasDoc → serializeCanvas 语义恒等（v3 doc 同样可备份/重建）', () => {
    const cd = serializeCanvas(buildV3FixtureDoc());
    const rebuilt = rebuildCanvasDoc(cd);
    expect(semanticEqual(cd, serializeCanvas(rebuilt))).toBe(true);
    expect(toReadModel(rebuilt)).toEqual(readRecordsFromMaps(toDocLike(buildV3FixtureDoc())));   // 重建后读出口=v3 等价锚同形
  });

  it('meta 残留（T18 历史载荷）round-trip 保真——空 meta 序列化为 {} 且重建不丢非空残留', () => {
    const doc = buildV3FixtureDoc();
    expect(serializeCanvas(doc).meta).toEqual({});
    doc.getMap('meta').set('legacyKey', 'legacyValue');
    const cd = serializeCanvas(doc);
    expect(cd.meta).toEqual({ legacyKey: 'legacyValue' });
    expect(semanticEqual(cd, serializeCanvas(rebuildCanvasDoc(cd)))).toBe(true);
  });

  it('$yjs 保留字执法：v3 纯 JSON 值带已知标签形状 ⇒ serializeCanvas fail-fast throw（防重建静默重解释为 Y 类型）；toReadModel 读侧无重解释面原样透传', () => {
    const doc = new Y.Doc();
    const data = new Y.Map<unknown>();
    data.set('sneaky', { $yjs: 'text', delta: [{ insert: 'fake' }] });   // 人为构造：与 canonical 标签同形的 plain JSON 值
    const m = new Y.Map<unknown>();
    m.set('type', 'textInput');
    m.set('data', data);
    doc.getMap('nodes').set('n1', m);
    expect(() => serializeCanvas(doc)).toThrow(/RESERVED_YJS_TAG/);
    expect(toReadModel(doc).nodes[0].data.sneaky).toEqual({ $yjs: 'text', delta: [{ insert: 'fake' }] });   // 读出口不受影响（终端纯 JSON）
  });
});

describe('Y1c T4 DocCodec：v4 嵌套类型 doc round-trip（语义相等非字节相等）', () => {
  it('serializeCanvas → rebuildCanvasDoc → re-serialize ⇒ semanticEqual（canonical 快照恒等）', () => {
    const doc = buildV4FixtureDoc();
    const cd1 = serializeCanvas(doc);
    const cd2 = serializeCanvas(rebuildCanvasDoc(cd1));
    expect(semanticEqual(cd1, cd2)).toBe(true);
    expect(cd1).toEqual(cd2);   // 确定性重建（插入序保持——canonical 逐位也恒等）
  });

  it('反别名（F-S2-1 方向锁）：重建 doc 嵌套 Y 类型=全新实例；变异源 doc 不波及重建 doc', () => {
    const doc = buildV4FixtureDoc();
    const cd1 = serializeCanvas(doc);
    const rebuilt = rebuildCanvasDoc(cd1);

    const srcData = (doc.getMap('nodes').get('ti1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const dstData = (rebuilt.getMap('nodes').get('ti1') as Y.Map<unknown>).get('data') as Y.Map<unknown>;
    const dstContent = dstData.get('content');
    expect(dstContent).toBeInstanceOf(Y.XmlFragment);
    expect(dstContent).not.toBe(srcData.get('content'));   // 非同一实例（fillDoc 别名路径禁入 codec 重建）
    expect(dstData.get('prompt')).not.toBe(srcData.get('prompt'));

    // 源 doc 变异：position 逐键改值 + Y.Text 追加 + data 键增删——重建 doc 快照不变
    const srcNode = doc.getMap('nodes').get('ti1') as Y.Map<unknown>;
    (srcNode.get('position') as Y.Map<unknown>).set('x', 999);
    ((srcData.get('prompt') as Y.Map<unknown>).get('text') as Y.Text).insert(0, 'X');
    srcData.set('model', 'mutated');
    srcData.delete('order');
    const cd3 = serializeCanvas(rebuilt);
    expect(semanticEqual(cd1, cd3)).toBe(true);   // 源变异零波及
  });

  it('属性式 fuzz（种子 PRNG）：随机 doc×30 反复 round-trip 恒等+反别名+read model 平面化', () => {
    let s = 20261024 >>> 0;
    const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const TYPES = ['textInput', 'imageGen', 'imageExtGen', 'videoGen', 'audioGen', 'multiImageGen', 'videoEdit', 'group'] as const;
    for (let iter = 0; iter < 30; iter++) {
      const doc = new Y.Doc();
      const nodes = doc.getMap('nodes');
      const n = 1 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const m = new Y.Map<unknown>();
        m.set('type', TYPES[Math.floor(rnd() * TYPES.length)]);
        if (rnd() > 0.4) setDocPosition(asDocMap(m), { x: rnd() * 100, y: rnd() * 100 }, () => new Y.Map() as unknown as DocMapLike);
        if (rnd() > 0.6) m.set('width', Math.floor(rnd() * 400));
        if (rnd() > 0.6) m.set('parentId', 'p0');
        const data = new Y.Map<unknown>();
        data.set('plainStr', `v${i}`);
        if (rnd() > 0.5) data.set('plainObj', { a: i, b: [i, 'x'] });
        if (rnd() > 0.6) data.set('nestedText', ytext(`t${i}`));
        if (rnd() > 0.7) data.set('nestedMap', ymap({ text: ytext(`p${i}`), k: i }));
        if (rnd() > 0.7) data.set('nestedArr', yarray([{ mediaId: `m${i}` }, i]));
        if (rnd() > 0.8) {
          const f = new Y.XmlFragment(); const p = new Y.XmlElement('paragraph');
          const t = new Y.XmlText(); t.insert(0, `xml${i}`); p.insert(0, [t]); f.insert(0, [p]);
          data.set('nestedXml', f);
        }
        m.set('data', data);
        nodes.set(`n${i}`, m);
      }
      const edge = new Y.Map<unknown>();
      edge.set('source', 'n0'); edge.set('target', `n${n - 1}`);
      doc.getMap('edges').set('e0', edge);

      const cd1 = serializeCanvas(doc);
      const rebuilt = rebuildCanvasDoc(cd1);
      expect(semanticEqual(cd1, serializeCanvas(rebuilt)), `iter=${iter}`).toBe(true);
      // 反别名：源 doc 破坏性变异后重建 doc 快照不动
      (nodes.get('n0') as Y.Map<unknown>).set('type', 'mutated');
      expect(semanticEqual(cd1, serializeCanvas(rebuilt)), `iter=${iter} 反别名`).toBe(true);
      // read model 平面化（零 Y 实例逃逸）
      assertPlainJson(toReadModel(rebuilt), `iter=${iter}`);
    }
  });
});

describe('Y1c T4 DocCodec：toReadModel——文本显式 string/富文本 PM JSON+HTML/媒体 Y.Array 平面化', () => {
  it('v4 各形态出口：Y.Text→string、Y.Map{text}→平面对象、Y.Array→数组、XmlFragment→{text,html,json}', () => {
    const rm = toReadModel(buildV4FixtureDoc());
    assertPlainJson(rm);

    const ti = rm.nodes.find((x) => x.id === 'ti1')!;
    expect(ti.position).toEqual({ x: 10, y: 20 });   // position Y.Map 逐键→平面 {x,y}
    expect(ti.data.prompt).toEqual({ text: '生成一张封面' });   // Y.Map{text:Y.Text}→PromptValue.text 口径平面化
    const content = ti.data.content as RichTextValue;
    expect(content.text).toBe('看这张 @bob 的图');
    expect(content.html).toContain('<p>');
    expect(content.html).toContain('data-id="u1"');
    expect(content.html).toContain('<img');
    expect(content.json).toEqual(CONTENT_PM_JSON);

    const ig = rm.nodes.find((x) => x.id === 'ig1')!;
    expect(ig.data.allImages).toEqual(['m-1', 'm-2']);
    expect(ig.data.referenceImage).toBe('https://cdn.example.com/ok.png');

    const ie = rm.nodes.find((x) => x.id === 'ie1')!;
    expect(ie.parentId).toBe('g1');
    expect(ie.data.extConfig).toEqual({ ratio: '16:9', generateCount: 4 });

    const vg = rm.nodes.find((x) => x.id === 'vg1')!;
    expect(vg.data.prompt).toBe('生成视频');   // 裸 Y.Text 值→string（显式 string）

    const au = rm.nodes.find((x) => x.id === 'au1')!;
    expect(au.data.content).toBe('旁白文本');

    const mi = rm.nodes.find((x) => x.id === 'mi1')!;
    expect(mi.data.images).toEqual([{ mediaId: 'mi-1' }, { mediaId: 'mi-2' }]);

    const g = rm.nodes.find((x) => x.id === 'g1')!;
    expect(g.data.storyboard).toEqual({ aspectRatio: '16:9', gridRows: 2, gridCols: 3 });

    expect(rm.edges).toEqual([
      { id: 'e1', source: 'ti1', target: 'ig1' },
      { id: 'e2', source: 'vg1', target: 've1' },
    ]);
  });

  it('v4 doc 混载的纯 JSON 键：toReadModel 与 readRecordsFromMaps 出口逐位一致（v3 键域收编零变更）', () => {
    const doc = buildV4FixtureDoc();
    const codec = toReadModel(doc);
    const legacy = readRecordsFromMaps(toDocLike(doc));
    const igCodec = codec.nodes.find((x) => x.id === 'ig1')!;
    const igLegacy = legacy.nodes.find((x) => x.id === 'ig1')!;
    expect(igCodec.data.style).toBe(igLegacy.data.style);
    expect(igCodec.data.slot).toBe(igLegacy.data.slot);
    const veCodec = codec.nodes.find((x) => x.id === 've1')!;
    expect(veCodec.data.order).toBe(7);
  });

  it('readCanvas 契约：返回值可 JSON 序列化（REST/执行/导出面——禁共享类型逃逸）', () => {
    expect(() => JSON.parse(JSON.stringify(toReadModel(buildV4FixtureDoc())))).not.toThrow();
  });
});

describe('Y1c T4 DocCodec：toPublicReadModel——sanitize+键白名单+URL allowlist', () => {
  const policy = {
    dropTypes: ['videoEdit'],
    dataKeys: {
      textInput: ['prompt', 'model'],
      imageGen: ['prompt', 'referenceImage'],
      videoGen: ['label'],
    },
    allowedUrlHosts: ['cdn.example.com'],
  };

  it('dropTypes 节点剔除+连带边；未列类型 data 全剥；白名单键保留', () => {
    const pub = toPublicReadModel(toReadModel(buildV4FixtureDoc()), policy) as CanvasReadModel;
    expect(pub.nodes.map((n) => n.id).sort()).toEqual(['au1', 'g1', 'ie1', 'ig1', 'mi1', 'ti1', 'vg1']);
    expect(pub.edges).toEqual([{ id: 'e1', source: 'ti1', target: 'ig1' }]);   // e2 触达已删 videoEdit
    const au = pub.nodes.find((n) => n.id === 'au1')!;
    expect(au.data).toEqual({});   // audioGen 未列=dataKeys → 全剥
    const ti = pub.nodes.find((n) => n.id === 'ti1')!;
    expect(ti.data.prompt).toEqual({ text: '生成一张封面' });   // Y.Map{text} 解码值原样（非富文本）
    expect(ti.data.model).toBe('gpt-cover');
    expect('content' in ti.data).toBe(false);   // content 不在 textInput 白名单（RichTextValue 公开域剔除）
  });

  it('RichTextValue 公开只余 text（红线 1 口径——html/json 永不出公开面）', () => {
    const pub = toPublicReadModel(toReadModel(buildV4FixtureDoc()), policy) as CanvasReadModel;
    const ig = pub.nodes.find((n) => n.id === 'ig1')!;
    expect(ig.data.prompt).toEqual({ text: '画一只猫' });
    expect('html' in (ig.data.prompt as Record<string, unknown>)).toBe(false);
    expect('json' in (ig.data.prompt as Record<string, unknown>)).toBe(false);
  });

  it('URL allowlist：data 字符串值 http(s) URL 的 host 域外 ⇒ 键剥除；域内保留', () => {
    const pub = toPublicReadModel(toReadModel(buildV4FixtureDoc()), policy) as CanvasReadModel;
    const ig = pub.nodes.find((n) => n.id === 'ig1')!;
    expect(ig.data.referenceImage).toBe('https://cdn.example.com/ok.png');   // host 域内保留
    const vg = pub.nodes.find((n) => n.id === 'vg1')!;
    expect('label' in vg.data).toBe(false);   // evil.example.com 域外剥除
  });

  it('公开出口仍是纯 JSON read model 同形（sanitize 不引入共享类型）', () => {
    assertPlainJson(toPublicReadModel(toReadModel(buildV4FixtureDoc()), policy));
  });
});

// ── E68 对抗语料族（Y1c T4 收编迁移自 apps/api/src/modules/collab/adversarial-readers.spec.ts：
//    readRecordsFromMaps 转 doc-codec 内部单源后 api 包不可再 import——FakeMap DocLike 直读用例
//    随函数落 shared；断言语义逐条保留）──
describe('E68 读者全函数（对抗语料：要么产出结果要么 typed 拒绝，绝不崩）', () => {
  const cases = generateAdversarialDocs(42);
  const byName = (n: string) => cases.find((c) => c.name === n)!;

  it.each(cases.map((c) => [c.name]))('%s：FakeMap 路径 readRecordsFromMaps 不抛且返回数组', (name) => {
    const r = readRecordsFromMaps(byName(name).build());
    expect(Array.isArray(r.nodes)).toBe(true);
    expect(Array.isArray(r.edges)).toBe(true);
  });

  it('非空转锚：long-content 语料真的到达读者出口（防"守卫跳过一切"的 vacuous 绿）', () => {
    const r = readRecordsFromMaps(byName('long-content').build());
    expect(r.nodes).toHaveLength(1);
    expect((r.nodes[0].data as Record<string, unknown>).content).toHaveLength(1024 * 1024);
  });

  it('值守卫行为锚：scalar-node 跳过（nodes 空）不抛', () => {
    const r = readRecordsFromMaps(byName('scalar-node').build());
    expect(r.nodes).toHaveLength(0);
  });

  // E68 断言适配注记（实证）：yjs 写侧只收 JSON 值——类实例值（语料 data 内嵌 FakeMap）
  // ⇒ Y.Map.set 抛 typed Error "Unexpected content type"。typed Error=E68 允许的拒绝档
  // （产出∨typed 拒绝，绝不崩）——按铁律原义断言而非 not.toThrow。
  it.each(cases.map((c) => [c.name]))('%s：真 Y.Doc 路径（fillDoc→toDocLike 读写双侧适配）——产出或 typed 拒绝', (name) => {
    const doc = new Y.Doc();
    const r = readRecordsFromMaps(byName(name).build());
    let wrote = false;
    try {
      fillDoc(toDocLike(doc), r.nodes, r.edges);
      wrote = true;
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
    const out = readRecordsFromMaps(toDocLike(doc));
    expect(Array.isArray(out.nodes)).toBe(true);
    expect(Array.isArray(out.edges)).toBe(true);
    if (wrote && r.nodes.length > 0) expect(out.nodes.length).toBeGreaterThan(0);
  });

  it('T18 版本门退役锚：语料全量经 fillDoc→readRecordsFromMaps 往返不因 meta 畸形崩（版本判据=PG 列——读侧全函数不解释）', () => {
    let wrote = 0;
    for (const c of cases) {
      const doc = new Y.Doc();
      try { fillDoc(toDocLike(doc), readRecordsFromMaps(c.build()).nodes, []); wrote += 1; } catch { /* typed 拒绝合法档 */ }
      expect(Array.isArray(readRecordsFromMaps(toDocLike(doc)).nodes)).toBe(true);
    }
    expect(wrote).toBeGreaterThan(0);
  });
});
