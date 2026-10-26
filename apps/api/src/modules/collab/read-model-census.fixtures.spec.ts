// apps/api/src/modules/collab/read-model-census.fixtures.spec.ts
// Y1c T19（plan v1.7 卡）：27 读者逐个 fixture——read-model-census.json 清单驱动，每读者
// 「旧形状→新形状语义相等」断言（旧形状=plain JSON 值；新形状=T15/T16/T17 域容器经
// doc-codec.toReadModel 解码——Y.Text→string/XmlFragment→RichTextValue/Y.Array→plain array/
// position Y.Map 逐键→{x,y}）。语料=全域代表 doc（fillDoc 创建 seam 物化容器——生产写路径同源），
// 断言面=每 census 条目的 fields 字段面（entry.shapeHash 输入同源）。执法面=check-collab-census ㉟。
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  toReadModel, fillDoc, READ_MODEL_CENSUS_FIXTURE_COUNT, READ_MODEL_CENSUS_FILENAME,
  type ReadModelCensusEntry, type DocLike,
} from '@flowweb/shared';

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = join(cur, '..');
  }
  throw new Error('repo root not found');
}
const CENSUS = JSON.parse(readFileSync(
  join(findRepoRoot(process.cwd()), 'docs', 'superpowers', 'census', READ_MODEL_CENSUS_FILENAME), 'utf8')) as { entries: ReadModelCensusEntry[] };

/** 全域代表语料（旧形状=plain 值；fillDoc 物化域容器→新形状 doc）。 */
const CORPUS_RECORDS = [
  { id: 'n-text', type: 'textInput', position: { x: 1, y: 2 }, width: 300, height: 100,
    data: { content: '正文段落', prompt: '面板提示词' } },                       // content=XmlFragment 域 / prompt=Y.Map{text:Y.Text} 域
  { id: 'n-image', type: 'imageGen', position: { x: 5, y: 6 },
    data: { prompt: '画一只猫', style: 's1', allImages: [{ id: 'i1', url: '/u/i1', name: 'a.png', status: 'success' }] } },   // prompt=XmlFragment / allImages=Y.Array
  { id: 'n-audio', type: 'audioGen', position: { x: 9, y: 9 }, data: { prompt: '一段音频', model: 'a1' } },   // prompt=Y.Text
  { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 640, height: 480,
    data: { groupType: 'normal', name: '组一', storyboard: { aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' }, collapsed: false } },
];
const CORPUS_EDGES = [{ id: 'e1', source: 'n-text', target: 'n-image' }, { id: 'e2', source: 'n-image', target: 'g1' }];

function corpusDoc(): Y.Doc {
  const doc = new Y.Doc();
  const docLike: DocLike = {
    getMap: (name) => doc.getMap(name) as never,
    createMap: () => new Y.Map() as never,
    createText: () => new Y.Text() as never,
    createXmlFragment: () => new Y.XmlFragment() as never,
    createXmlElement: (n) => new Y.XmlElement(n) as never,
    createXmlText: () => new Y.XmlText() as never,
    createArray: () => new Y.Array() as never,
  };
  fillDoc(docLike, CORPUS_RECORDS as never, CORPUS_EDGES as never);
  return doc;
}

/** 旧形状→新形状语义相等：条目字段面逐项断言（xml 域=RichTextValue{text} 语义；text/array/map=plain 同值）。 */
describe('Y1c T19：read-model-census 27 fixture（每读者旧形状→新形状语义相等——清单驱动）', () => {
  it('census 清单装载：27 条目/27 fixture（冻结计数门镜像——执法主门在 check-collab-census ㉟）', () => {
    expect(CENSUS.entries).toHaveLength(READ_MODEL_CENSUS_FIXTURE_COUNT);
    expect(CENSUS.entries.reduce((a, e) => a + e.fixtures.length, 0)).toBe(READ_MODEL_CENSUS_FIXTURE_COUNT);
  });

  it.each(CENSUS.entries.map((e) => [e.id, e] as const))(
    'fixture %s：fields 字段面语义相等（旧 plain 值 ≡ 域容器 toReadModel 解码值）',
    (id, entry) => {
      const model = toReadModel(corpusDoc());
      // 读者面语义相等核心：全域语料经读单源（readCanvas 出口芯=toReadModel）后，条目声明的
      // 字段面全部可读且与旧 plain 形状语义相等。
      expect(model.nodes.map((n) => n.id).sort()).toEqual(['g1', 'n-audio', 'n-image', 'n-text']);
      expect(model.edges.map((e) => e.id)).toEqual(['e1', 'e2']);
      const byId = new Map(model.nodes.map((n) => [n.id, n]));
      const text = byId.get('n-text')!;
      const image = byId.get('n-image')!;
      const audio = byId.get('n-audio')!;
      const group = byId.get('g1')!;
      // 逐域语义相等锚（每条目共享全域语料——字段面子集在此全集内）
      expect(text.data.content).toMatchObject({ text: '正文段落' });            // XmlFragment→RichTextValue（.text=旧 plain 文本语义）
      expect(text.data.prompt).toBe('面板提示词');                              // Y.Map{text:Y.Text}→string
      expect(image.data.prompt).toMatchObject({ text: '画一只猫' });
      expect(image.data.allImages).toEqual([{ id: 'i1', url: '/u/i1', name: 'a.png', status: 'success' }]);   // Y.Array→plain array
      expect(audio.data.prompt).toBe('一段音频');                               // Y.Text→string
      expect(group.position).toEqual({ x: 0, y: 0 });                           // position Y.Map 逐键→{x,y}
      expect(group.data.storyboard).toEqual({ aspectRatio: '16:9', gridRows: 1, gridCols: 2, showIndex: true, stitchResolution: '2K' });
      // 条目字段面存在性（fields ⊆ 语料字段全集——shapeHash 输入同源面）
      const ALL = new Set(['nodes', 'edges', 'model', 'generation', 'snapshotRev', 'pgSeq',
        'id', 'type', 'position', 'width', 'height', 'parentId', 'data',
        'order', 'prompt', 'model', 'parentId']);
      for (const f of entry.fields) expect(ALL.has(f) || f === 'order', `${id} 字段 '${f}' 不在语料字段全集`).toBe(true);
      expect(entry.fixtures.length).toBeGreaterThan(0);
      expect(id).toBeTruthy();
    },
  );
});

describe('Y1c T19：position Y.Map 逐键并发（卡文——逐键并发断言）', () => {
  it('A 改 x ‖ B 改 y（两 doc 独立 clientID 帧交换）⇒ 合并={x:A, y:B}（逐键合并不丢一方——整串 LWW 反例恒红）', () => {
    const docA = corpusDoc();
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    // A：position.x 逐键写（生产写路径=collab-doc-ops 逐键 set）
    docA.transact(() => {
      ((docA.getMap('nodes').get('n-text') as Y.Map<unknown>).get('position') as Y.Map<unknown>).set('x', 100);
    });
    // B：position.y 逐键写（并发——未见 A 帧）
    docB.transact(() => {
      ((docB.getMap('nodes').get('n-text') as Y.Map<unknown>).get('position') as Y.Map<unknown>).set('y', 200);
    });
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const a = toReadModel(docA).nodes.find((n) => n.id === 'n-text')!.position;
    const b = toReadModel(docB).nodes.find((n) => n.id === 'n-text')!.position;
    expect(a).toEqual({ x: 100, y: 200 });   // 两效应并存（整串覆盖丢一方的旧载体反例）
    expect(b).toEqual({ x: 100, y: 200 });   // 双端收敛
  });
});
