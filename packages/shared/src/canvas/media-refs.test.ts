// packages/shared/src/canvas/media-refs.test.ts —— Y1a+Y1b T16：collectMediaRefs/collectMediaIds/
// collectMediaRefsForNode 九键扫描单源纯测。
// Y1c T17：读侧双形态收敛维持锚（Y.Array 载体=fillDoc 物化默认路径——真 Yjs 容器与 plain
// 数组两形态同收敛；spec §3.1 media-refs 条款）。
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';   // Y1c T17：真 Yjs 容器收敛锚（doc-codec 同款——测试面 yjs 可用）
import { fillDoc, type DocLike } from './docShape';
import type { StoredNodeRecord } from './collab-doc-ops';
import { collectMediaRefs, collectMediaIds, collectMediaRefsForNode, MEDIA_REF_TARGET_FIELDS,
  collectTimelineRefs, collectNodeRefsUnion, removeNodeRefsUnion } from './media-refs';
import type { YArrayLike } from './array-domains';

/** 最小可用 YArrayLike fake（fillDoc 物化真持有 items——collectMediaRefs 迭代消费）。 */
class FakeArray implements YArrayLike {
  items: unknown[] = [];
  get length() { return this.items.length; }
  get(i: number) { return this.items[i]; }
  insert(i: number, xs: unknown[]) { this.items.splice(i, 0, ...xs); }
  delete(i: number, len: number) { this.items.splice(i, len); }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
}

/** 结构性最小 DocLike（fillDoc 需 createMap 工厂——FakeMap 同款）。 */
function makeDoc(): DocLike {
  const maps = new Map<string, any>();
  return {
    getMap: (name: string) => {
      if (!maps.has(name)) maps.set(name, new Map());
      return maps.get(name);
    },
    createMap: () => new Map() as never,
    createText: () => ({ length: 0, toString: () => '', insert: () => {}, delete: () => {} }),
    // Y1c T16：XML 三工厂 fake（零行为容器）
    createXmlFragment: () => ({ insert: () => {} }) as never,
    createXmlElement: (_name: string) => ({ insert: () => {}, setAttribute: () => {} }) as never,
    createXmlText: () => ({ insert: () => {}, setAttribute: () => {} }) as never,
    // Y1c T17：媒体列表域工厂（fillDoc 物化——items 真持有）
    createArray: () => new FakeArray(),
  };
}

describe('T16 collectMediaRefs（七键扫描）', () => {
  it('全键形（string 槽+列表槽 item.id——targetItemId=item.id；referenceVideo/referenceAudio=config 域入口同落 data）', () => {
    const doc = makeDoc();
    fillDoc(doc, [{
      id: 'n1',
      type: 'imageGen',
      data: {
        mediaId: 'm-file',   // Y2 B4：主槽作者键（九键收六键——fileId 随 B3 doc 禁入退役）
        referenceImage: 'm-ref',
        referenceVideo: 'm-refv',   // spec 评审 P1#1：AddNodeMenu.tsx:249 上传视频引用（updateConfig→data）
        referenceAudio: 'm-refa',   // AudioGenNode.tsx:105 上传音频引用（同路径）
        images: [{ id: 'm-i1' }, { id: 'm-i2' }],
        allImages: [{ id: 'm-i1' }],
      },
    } as unknown as StoredNodeRecord], []);
    const refs = collectMediaRefs(doc).map((r) => [r.targetField, r.targetItemId, r.mediaId]).sort();
    expect(refs).toEqual([
      ['allImages', 'm-i1', 'm-i1'],
      ['images', 'm-i1', 'm-i1'],
      ['images', 'm-i2', 'm-i2'],
      ['mediaId', '', 'm-file'],
      ['referenceAudio', '', 'm-refa'],
      ['referenceImage', '', 'm-ref'],
      ['referenceVideo', '', 'm-refv'],
    ].sort());
    expect([...collectMediaIds(doc)].sort()).toEqual(['m-file', 'm-i1', 'm-i2', 'm-ref', 'm-refa', 'm-refv']);
  });

  it('非引用形态免疫：null（clearMedia 钉 null 写）/空串/非 string 标量槽、坏 item、无 data 节点、非 map 条目', () => {
    const doc = makeDoc();
    fillDoc(doc, [
      { id: 'n1', type: 'imageGen', data: { mediaId: null, referenceImage: '', images: [{ noId: 1 }, 'junk', null], allImages: 'not-a-list' } } as unknown as StoredNodeRecord,
      { id: 'n2', type: 'textGen', data: {} } as unknown as StoredNodeRecord,
    ], []);
    doc.getMap('nodes').set('n3', 'plain string entry');   // 非 map 节点
    expect(collectMediaRefs(doc)).toEqual([]);
    expect(collectMediaIds(doc).size).toBe(0);
  });

  it('词表六键恰（Y2 B4 九键收六键——MediaBinding.targetField 应用层单源；增删键本测即红）', () => {
    expect([...MEDIA_REF_TARGET_FIELDS]).toEqual([
      'mediaId', 'referenceImage', 'referenceVideo', 'referenceAudio', 'images', 'allImages',
    ]);
  });

  it('跨节点同 media 多行（索引语义——GC 引用图按集消费）', () => {
    const doc = makeDoc();
    fillDoc(doc, [
      { id: 'n1', type: 'imageGen', data: { mediaId: 'm-x' } } as unknown as StoredNodeRecord,
      { id: 'n2', type: 'videoGen', data: { mediaId: 'm-x' } } as unknown as StoredNodeRecord,   // Y2 B4：同键六键域（videoFileId 退役）
    ], []);
    expect(collectMediaRefs(doc)).toHaveLength(2);
    expect(collectMediaIds(doc)).toEqual(new Set(['m-x']));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Y1c T17：读侧双形态收敛维持——Y.Array 载体（T17 后唯一 doc 载体）与 plain 数组
// 收敛同口径（refListOf 双形态=既有契约；本组=真 Yjs 容器回归锚，语义不变性常驻锁）。
// ══════════════════════════════════════════════════════════════════════════
describe('T17 media-refs 读侧双形态收敛维持（Y.Array 载体语义不变）', () => {
  it('真 Y.Array 容器（fillDoc 物化——T17 后默认载体）：refs 与 plain 形逐位同收敛', () => {
    const doc = new Y.Doc();
    const docLike: DocLike = {
      getMap: (name) => doc.getMap(name) as never,
      createMap: () => new Y.Map() as never,
      createText: () => new Y.Text() as never,
      createXmlFragment: () => new Y.XmlFragment() as never,
      createXmlElement: (name: string) => new Y.XmlElement(name) as never,
      createXmlText: () => new Y.XmlText() as never,
      createArray: () => new Y.Array() as never,
    };
    fillDoc(docLike, [
      { id: 'n1', type: 'imageGen', data: { allImages: [{ id: 'm-i1' }, { id: 'm-i2' }] } } as unknown as StoredNodeRecord,
      { id: 'n2', type: 'multiImageGen', data: { images: [{ id: 'm-i1' }, { id: 'm-i3' }] } } as unknown as StoredNodeRecord,
    ], []);
    // fillDoc 物化=Y.Array 容器（T17 创建 seam——真载体断言）
    const n1 = doc.getMap('nodes').get('n1') as unknown as { get(k: string): unknown };
    const data1 = n1.get('data') as unknown as { get(k: string): unknown };
    expect(data1.get('allImages') instanceof Y.Array).toBe(true);
    const refs = collectMediaRefs(docLike).map((r) => [r.nodeId, r.targetField, r.targetItemId]).sort();
    expect(refs).toEqual([
      ['n1', 'allImages', 'm-i1'],
      ['n1', 'allImages', 'm-i2'],
      ['n2', 'images', 'm-i1'],
      ['n2', 'images', 'm-i3'],
    ]);
    expect([...collectMediaIds(docLike)].sort()).toEqual(['m-i1', 'm-i2', 'm-i3']);
    // 双形态收敛：同内容 plain 数组载体（绕 fillDoc 直建 data——读侧旧形态兼容面）refs 逐位一致
    const plain = makeDoc();
    const nodes = plain.getMap('nodes') as unknown as Map<string, unknown>;
    for (const [nid, type, key, items] of [
      ['n1', 'imageGen', 'allImages', [{ id: 'm-i1' }, { id: 'm-i2' }]],
      ['n2', 'multiImageGen', 'images', [{ id: 'm-i1' }, { id: 'm-i3' }]],
    ] as const) {
      const data = new Map<string, unknown>([[key, items]]);
      nodes.set(nid, new Map<string, unknown>([['type', type], ['data', data]]));
    }
    expect(collectMediaRefs(plain).map((r) => [r.nodeId, r.targetField, r.targetItemId]).sort()).toEqual(refs);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C3a-1（spec 2026-11-11 §3.2-1）：collectMediaRefsForNode 单源收口——C3a-3 帧级快照与
// C3a-5 投影器的 doc→引用唯一读取源。四族：①候选无关（不按 type/schema 收窄——第五轮
// P0 保守收集，扫描器不读 type 键、未知 type 照扫）/②数组槽 item.id=targetItemId
// 双形态/③role 槽位键字段（MediaBinding 五元组对齐）/④聚合等价（collectMediaRefs=
// 逐节点并集——C3a-9 对拍契约与 C3b oracle 端到端面）。
// ══════════════════════════════════════════════════════════════════════════
describe('C3a-1 collectMediaRefsForNode 单源收口', () => {
  /** 直建 plain Map 节点条目（扫描器输入面=nodes map 条目本身——type 是否在 schema 词表非其关心；
   *  type=null 表示节点无 type 键）。 */
  const plainNode = (type: string | null, data: Map<string, unknown>): Map<string, unknown> =>
    new Map<string, unknown>([...(type === null ? [] : [['type', type] as [string, unknown]]), ['data', data]]);

  /** 排序键（聚合等价双侧归一——禁依赖对象字面量键序）。 */
  const refKey = (r: { nodeId: string; role: string; targetField: string; targetItemId: string; mediaId: string }): string =>
    [r.nodeId, r.role, r.targetField, r.targetItemId, r.mediaId].join('|');

  it('① 候选无关：未知/乱写/缺失 type 照常产出（不按 type/schema 收窄——第五轮 P0 保守收集钉死）', () => {
    const doc = makeDoc();
    const nodes = doc.getMap('nodes') as unknown as Map<string, unknown>;
    nodes.set('n1', plainNode('warp-drive-3000', new Map([['mediaId', 'm-unk']])));        // 词表外 type
    nodes.set('n2', plainNode('', new Map([['mediaId', 'm-notype-empty']])));        // 空串 type
    nodes.set('n3', plainNode(null, new Map([['images', [{ id: 'm-missing-type' }]]])));   // 无 type 键
    // 聚合面：三节点引用全产出（type 不参与判定）
    expect(collectMediaRefs(doc).map(refKey).sort()).toEqual([
      'n1|primary|mediaId||m-unk',
      'n2|primary|mediaId||m-notype-empty',
      'n3|primary|images|m-missing-type|m-missing-type',
    ]);
    // 逐节点面同口径：词表外 type 节点单扫=同引用（全对象形状钉死——含 role 槽）
    expect(collectMediaRefsForNode('n1', nodes.get('n1'))).toEqual([
      { nodeId: 'n1', mediaId: 'm-unk', role: 'primary', targetField: 'mediaId', targetItemId: '' },
    ]);
    expect(collectMediaRefsForNode('n3', nodes.get('n3'))).toEqual([
      { nodeId: 'n3', mediaId: 'm-missing-type', role: 'primary', targetField: 'images', targetItemId: 'm-missing-type' },
    ]);
  });

  it('② 数组槽 item.id=targetItemId：Y.Array 载体（Y.Map item+plain item 混载）与 plain array 双形态', () => {
    // Y.Array 载体（fillDoc 物化默认形态）：Y.Map item（get('id')）与 plain object item（.id）混载
    //（先入 doc 再写内容——先 integrate 后写=规范健壮模式，避免 standalone 容器语义差异）
    const ydoc = new Y.Doc();
    const ynode = new Y.Map();
    ydoc.getMap('nodes').set('n1', ynode);
    ynode.set('type', 'multiImageGen');
    const ydata = new Y.Map();
    ynode.set('data', ydata);
    const yarr = new Y.Array();
    ydata.set('images', yarr);
    yarr.push([new Y.Map([['id', 'm-y']]), { id: 'm-p' }]);
    expect(collectMediaRefsForNode('n1', ynode)).toEqual([
      { nodeId: 'n1', mediaId: 'm-y', role: 'primary', targetField: 'images', targetItemId: 'm-y' },
      { nodeId: 'n1', mediaId: 'm-p', role: 'primary', targetField: 'images', targetItemId: 'm-p' },
    ]);
    // plain array 载体（对抗/异形 doc——T17 读侧双形态收敛在逐节点面维持）
    expect(collectMediaRefsForNode('n2', plainNode('imageGen', new Map([['allImages', [{ id: 'm-a' }, { id: 'm-b' }]]])))).toEqual([
      { nodeId: 'n2', mediaId: 'm-a', role: 'primary', targetField: 'allImages', targetItemId: 'm-a' },
      { nodeId: 'n2', mediaId: 'm-b', role: 'primary', targetField: 'allImages', targetItemId: 'm-b' },
    ]);
  });

  it('③ role 槽位键字段：标量槽/列表槽（逐节点+聚合两出口）恒 primary——MediaBinding 五元组对齐，C3a-5 投影器直接消费', () => {
    const doc = makeDoc();
    fillDoc(doc, [{
      id: 'n1', type: 'imageGen',
      data: { mediaId: 'm-file', referenceImage: 'm-ref', images: [{ id: 'm-i1' }] },
    } as unknown as StoredNodeRecord], []);
    const node = doc.getMap('nodes').get('n1');
    // 逐节点面：每条引用 role='primary'（类型面=常量字面量槽——非自由 string）
    for (const r of collectMediaRefsForNode('n1', node)) {
      expect(r.role).toBe('primary');
    }
    // 聚合面：全形态（标量槽+列表槽）role 集恰 {'primary'}
    const roles = new Set(collectMediaRefs(doc).map((r) => r.role));
    expect(roles).toEqual(new Set(['primary']));
  });

  it('④ 聚合等价：collectMediaRefs(doc) = 逐节点 collectMediaRefsForNode 并集（单源委托——含未知 type/非 map 条目/无 data 节点）', () => {
    // 真 Y.Doc 载体（生产形态）：fillDoc 物化正参节点 + 未知 type 节点 + 非 map 条目 + 无 data 节点
    const ydoc = new Y.Doc();
    const docLike: DocLike = {
      getMap: (name) => ydoc.getMap(name) as never,
      createMap: () => new Y.Map() as never,
      createText: () => new Y.Text() as never,
      createXmlFragment: () => new Y.XmlFragment() as never,
      createXmlElement: (name: string) => new Y.XmlElement(name) as never,
      createXmlText: () => new Y.XmlText() as never,
      createArray: () => new Y.Array() as never,
    };
    fillDoc(docLike, [
      { id: 'n1', type: 'imageGen', data: { mediaId: 'm-file', allImages: [{ id: 'm-i1' }, { id: 'm-i2' }] } } as unknown as StoredNodeRecord,
      { id: 'n2', type: 'videoGen', data: { mediaId: 'm-vid' } } as unknown as StoredNodeRecord,
    ], []);
    const odd = new Y.Map();
    odd.set('type', 'quantum-fold');
    odd.set('data', new Y.Map([['referenceAudio', 'm-odd']]));
    ydoc.getMap('nodes').set('n3', odd);                          // 未知 type（① 族在等价面复现）
    ydoc.getMap('nodes').set('n4', 'plain string entry');         // 非 map 条目（逐节点=空，不断言抛错）
    ydoc.getMap('nodes').set('n5', new Y.Map([['type', 'textGen']])); // 无 data 域节点
    // 逐节点耐受口径钉死：非 map 条目/无 data=空集（聚合跳过同源语义）
    expect(collectMediaRefsForNode('n4', 'plain string entry')).toEqual([]);
    expect(collectMediaRefsForNode('n5', ydoc.getMap('nodes').get('n5'))).toEqual([]);
    // 并集=聚合（逐位一致——聚合除委托外零自有逻辑）
    const perNode = [...ydoc.getMap('nodes').entries()].flatMap(([nid, entry]) => collectMediaRefsForNode(nid, entry));
    expect(collectMediaRefs(docLike).map(refKey).sort()).toEqual(perNode.map(refKey).sort());
    expect(perNode).toHaveLength(5);   // m-file+m-i1+m-i2（n1）/m-vid（n2）/m-odd（n3）
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Y4a T6（spec 2026-11-20-y4a-timeline-domain-design.md §0 条 11——媒体三件）：
// 绑定投影并集单源——collectNodeRefsUnion（节点 refs∪timeline clips mediaId，
// targetItemId=clipId、空 clipId 不产行）+collectTimelineRefs（枚举 timelines 键不从
// nodes.has 推导——悬空键照投）+removeNodeRefsUnion（剥除两腿）+collectMediaRefs 聚合
// 扩 timelines 键∪nodes 键双枚举。clip 矩阵扫描=T3 extractTimelineClipMediaIds 单源
//（不另写第二套——空 clipId/mediaId/subtitle 无槽由其内部保证）。
// ══════════════════════════════════════════════════════════════════════════
describe('Y4a T6：绑定投影并集单源（spec §0 条 11）', () => {
  /** 真实 Y.Doc 装置：剪辑节点带 timeline clips（video m1/image m2/subtitle 无槽）+data 主槽。 */
  const mkClipNodeDoc = (): { doc: Y.Doc; docLike: DocLike } => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const node = new Y.Map();
      const data = new Y.Map();
      data.set('mediaId', 'm-node-slot');
      node.set('type', 'videoEdit');
      node.set('data', data);
      doc.getMap('nodes').set('n-clip', node);
      const entry = new Y.Map();
      const clips = new Y.Map();
      const mk = (type: string, mediaId: unknown) => {
        const m = new Y.Map();
        m.set('type', type);
        m.set('span', { trackId: 'n-clip:video', start: 0, duration: 5 });
        if (mediaId !== undefined) m.set('mediaId', mediaId);
        return m;
      };
      clips.set('c-vid', mk('video', 'm1'));
      clips.set('c-img', mk('image', 'm2'));
      clips.set('c-sub', mk('subtitle', undefined));
      entry.set('clips', clips);
      doc.getMap('timelines').set('n-clip', entry);
    });
    const docLike: DocLike = {
      getMap: (name) => doc.getMap(name) as never,
      createMap: () => new Y.Map() as never,
      createText: () => new Y.Text() as never,
      createXmlFragment: () => new Y.XmlFragment() as never,
      createXmlElement: (name) => new Y.XmlElement(name) as never,
      createXmlText: () => new Y.XmlText() as never,
      createArray: () => new Y.Array() as never,
    };
    return { doc, docLike };
  };

  const refKey = (r: { nodeId: string; role: string; targetField: string; targetItemId: string; mediaId: string }): string =>
    [r.nodeId, r.role, r.targetField, r.targetItemId, r.mediaId].join('|');

  it('①剪辑节点并集：节点 data 槽行+clip 行（targetItemId=clipId 非空；subtitle 无槽不产行）', () => {
    const { doc } = mkClipNodeDoc();
    const union = collectNodeRefsUnion('n-clip', doc.getMap('nodes').get('n-clip'), doc.getMap('timelines').get('n-clip'));
    expect(union.map(refKey).sort()).toEqual([
      'n-clip|primary|mediaId||m-node-slot',      // 节点 data 主槽行（targetItemId 空 sentinel）
      'n-clip|primary|mediaId|c-vid|m1',          // clip 行（targetItemId=clipId——与节点槽空 targetItemId 不撞键）
      'n-clip|primary|mediaId|c-img|m2',
    ].sort());
  });

  it('②空 clipId 不产行（extract 单源内部保证——union 无空 targetItemId clip 行）；空 mediaId 同跳', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const entry = new Y.Map();
      const clips = new Y.Map();
      const mk = (mediaId: unknown) => {
        const m = new Y.Map();
        m.set('type', 'video');
        m.set('span', { trackId: 't', start: 0, duration: 5 });
        if (mediaId !== undefined) m.set('mediaId', mediaId);
        return m;
      };
      clips.set('', mk('m-empty-id'));     // 空 clipId——节点标量槽 targetItemId='' 撞键形态禁
      clips.set('c-empty-mid', mk(''));     // 空 mediaId
      entry.set('clips', clips);
      doc.getMap('timelines').set('n-clip', entry);
      const node = new Y.Map();
      node.set('type', 'videoEdit');
      node.set('data', new Y.Map());
      doc.getMap('nodes').set('n-clip', node);
    });
    expect(collectNodeRefsUnion('n-clip', doc.getMap('nodes').get('n-clip'), doc.getMap('timelines').get('n-clip'))).toEqual([]);
  });

  it('③非剪辑节点（无 timelines 键）→与现状同集（union=纯节点槽——零 clip 行）', () => {
    const { doc, docLike } = mkClipNodeDoc();
    // 独立普通节点（无 timelines 键）：union=collectMediaRefsForNode 同集
    const plain = new Y.Map();
    const data = new Y.Map();
    data.set('mediaId', 'm-plain');
    data.set('referenceImage', 'm-plain-ref');
    plain.set('type', 'imageGen');
    plain.set('data', data);
    doc.getMap('nodes').set('n-plain', plain);
    const union = collectNodeRefsUnion('n-plain', plain, doc.getMap('timelines').get('n-plain'));
    expect(union.map(refKey).sort()).toEqual(collectMediaRefsForNode('n-plain', plain).map(refKey).sort());
    expect(union).toHaveLength(2);
    // 聚合面：collectMediaRefs=timelines 键∪nodes 键双枚举（n-clip 走并集、n-plain 走纯节点腿）
    const agg = collectMediaRefs(docLike).map(refKey).sort();
    expect(agg).toContain('n-clip|primary|mediaId|c-vid|m1');
    expect(agg).toContain('n-clip|primary|mediaId||m-node-slot');
    expect(agg).toContain('n-plain|primary|mediaId||m-plain');
    expect(agg.filter((k) => k.startsWith('n-clip|'))).toHaveLength(3);
  });

  it('④悬空键照投（spec §0 条 11）：节点已删 timelines.<id> 仍在→collectTimelineRefs 照投该键片段行；双亡才空', () => {
    const { doc, docLike } = mkClipNodeDoc();
    const timelines = doc.getMap('timelines');
    // 并发残留形态：节点删除侧 vs 编辑侧——clientID 较大一侧留下 timelines 键
    doc.getMap('nodes').delete('n-clip');
    const dangling = collectTimelineRefs(timelines, doc.getMap('nodes'));
    expect(dangling.has('n-clip'), '悬空键照投——枚举 timelines 键不从 nodes.has 推导（负控：nodes.has(id)?union:null 形态会清绑定）').toBe(true);
    expect([...dangling.get('n-clip')!].map(refKey).sort()).toEqual([
      'n-clip|primary|mediaId|c-vid|m1',
      'n-clip|primary|mediaId|c-img|m2',
    ].sort());
    // 聚合同口径：collectMediaRefs 照投悬空键片段行（GC 看见这段引用）
    const agg = collectMediaRefs(docLike).map(refKey);
    expect(agg).toContain('n-clip|primary|mediaId|c-vid|m1');
    // 双亡才空：timelines 键也删→零行
    doc.getMap('timelines').delete('n-clip');
    expect([...collectTimelineRefs(timelines, doc.getMap('nodes')).keys()]).toHaveLength(0);
    expect(collectMediaRefs(docLike).filter((r) => r.nodeId === 'n-clip')).toEqual([]);
  });

  it('⑤removeNodeRefsUnion 两腿：同 mediaId 集——节点槽走 removeMediaRefsForNode+timeline clip mediaId 命中删片段键返 clipId 列表', () => {
    const { doc } = mkClipNodeDoc();
    const entry = doc.getMap('nodes').get('n-clip') as Y.Map<unknown>;
    const timelineEntry = doc.getMap('timelines').get('n-clip') as Y.Map<unknown>;
    // 剥 m1（clip 行命中）+m-node-slot（节点槽命中）——m2/subtitle 不动
    const r1 = removeNodeRefsUnion(entry, timelineEntry, new Set(['m1', 'm-node-slot']));
    expect(r1.removedNodeSlots).toBe(1);
    expect(r1.removedClips).toEqual(['c-vid']);
    expect((timelineEntry.get('clips') as Y.Map<unknown>).has('c-vid')).toBe(false);
    expect((timelineEntry.get('clips') as Y.Map<unknown>).has('c-img')).toBe(true);   // 未命中槽保留
    expect((timelineEntry.get('clips') as Y.Map<unknown>).has('c-sub')).toBe(true);
    expect((entry.get('data') as Y.Map<unknown>).get('mediaId')).toBeUndefined();
    // 幂等 no-op：再剥同集=零删
    const r2 = removeNodeRefsUnion(entry, timelineEntry, new Set(['m1', 'm-node-slot']));
    expect(r2.removedNodeSlots).toBe(0);
    expect(r2.removedClips).toEqual([]);
    // 非 map 入参耐受（与 collectMediaRefsForNode/removeMediaRefsForNode 同口径）
    expect(removeNodeRefsUnion(undefined, undefined, new Set(['m1']))).toEqual({ removedNodeSlots: 0, removedClips: [] });
  });
});
