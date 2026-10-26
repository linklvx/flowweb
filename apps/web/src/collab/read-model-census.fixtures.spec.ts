// apps/web/src/collab/read-model-census.fixtures.spec.ts
// Y1c T19（plan v1.7 卡）：web 读单源改道契约——readCanvasFromDoc 出口类型=CanvasReadModel
// （doc-codec 唯一共享读类型——编译期 Equals 断言，tsc --noEmit 执法）+ web 侧 census 条目
// （10/27）装载对账 + readCanvasFromDoc ≡ toReadModel（同 doc 双出口恒等——web 读单源不变式）。
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  toReadModel, fillDoc, composeRenderModel, READ_MODEL_CENSUS_FILENAME,
  type CanvasReadModel, type CanvasRenderModel, type RuntimeProjection, type DocLike,
} from '@flowweb/shared';
import { readCanvasFromDoc } from './ydocBuilder';

/** 编译期精确类型断言（apps/web build=tsc --noEmit 执法——出口类型漂移即编译红）。 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <T extends true>(_: T = true as T): void => void _;

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = join(cur, '..');
  }
  throw new Error('repo root not found');
}
const CENSUS = JSON.parse(readFileSync(
  join(findRepoRoot(process.cwd()), 'docs', 'superpowers', 'census', READ_MODEL_CENSUS_FILENAME), 'utf8')) as {
  entries: { id: string; file: string; fields: string[]; testAnchor: string; fixtures: string[] }[];
};

const docOf = (): Y.Doc => {
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
  fillDoc(docLike, [
    { id: 'w1', type: 'textInput', position: { x: 1, y: 2 }, data: { content: '正文', prompt: '提示' } },
    { id: 'w2', type: 'imageGen', position: { x: 3, y: 4 }, data: { prompt: '画猫', allImages: [{ id: 'i1', url: '/u', name: 'a', status: 'success' }] } },
  ] as never, [{ id: 'we1', source: 'w1', target: 'w2' }] as never);
  return doc;
};

describe('Y1c T19：web 读单源=CanvasReadModel（编译期差异表）', () => {
  it('readCanvasFromDoc 返回类型精确=CanvasReadModel（非 StoredNodeRecord[]/PlainEdge 旧面）', () => {
    assertType<Equals<ReturnType<typeof readCanvasFromDoc>, CanvasReadModel>>();
    expect(true).toBe(true);
  });

  it('渲染层专用 CanvasRenderModel=merge(CanvasReadModel, RuntimeProjection)（T5c compose 消费面——服务端字段读者 T22 切投影）', () => {
    const readModel = readCanvasFromDoc(docOf());
    const projection: RuntimeProjection = {
      projectId: 'p1', generation: 0, feedSeq: '3', pgSeq: '3',
      nodes: { w2: { exec: { status: 'done', nodeVersion: '3' } } },
      mediaFacts: {},
    };
    const render: CanvasRenderModel = composeRenderModel(readModel, projection);
    const w2 = render.nodes.find((n) => n.id === 'w2')!;
    expect(w2.runtime?.exec?.status).toBe('done');         // overlay 只在渲染合成面——doc/data 写面零接触
    expect((readModel.nodes.find((n) => n.id === 'w2') as unknown as Record<string, unknown>).runtime).toBeUndefined();   // 读模型永不携带 runtime（类型面无该键——渲染层专用键不进共享读类型）
    const w1 = render.nodes.find((n) => n.id === 'w1')!;
    expect(w1.runtime).toBeUndefined();                    // 无投影节点零 runtime 键透传（unknown≠idle）
  });
});

describe('Y1c T19：web census 条目（10/27）+读单源恒等', () => {
  it('web 条目=10 条（runtime×4/intents×3/canvasStore/local-backup/ydocBuilder）；fields/testAnchor 与 json 冻结一致', () => {
    const web = CENSUS.entries.filter((e) => e.file.startsWith('apps/web/'));
    expect(web).toHaveLength(10);
    expect(web.every((e) => e.fixtures.length >= 1)).toBe(true);
    for (const e of web) expect(existsSync(join(findRepoRoot(process.cwd()), e.testAnchor))).toBe(true);
  });

  it('readCanvasFromDoc ≡ toReadModel（同 doc 双出口恒等——web 读单源不变式：全 web 读者经薄委托消费）', () => {
    const doc = docOf();
    const viaWeb = readCanvasFromDoc(doc);
    const viaCodec = toReadModel(doc);
    expect(viaWeb).toEqual(viaCodec);
    expect(viaWeb.nodes[0].data.content).toMatchObject({ text: '正文' });   // XmlFragment 域→RichTextValue
    expect(viaWeb.nodes[0].data.prompt).toBe('提示');                        // Y.Map{text:Y.Text}→string
    expect(viaWeb.nodes[1].data.allImages).toEqual([{ id: 'i1', url: '/u', name: 'a', status: 'success' }]);
  });
});
