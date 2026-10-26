// apps/api/src/modules/video-work/snapshot-filter.t19-public-read-model.spec.ts
// Y1c T19（plan v1.7 卡）：公开快照 toPublicReadModel sanitize 落地——红线 1 执法面。
// 红①（卡文「先红」）：post-T16 textInput.content=XmlFragment ⇒ readCanvas 读模型出口=
//   RichTextValue{text,html,json}——现状 applyWhitelist 的 content 分支只吃 typeof string
//   （旧 HTML 载体），对象形态落 else 整值透传 ⇒ **html/json 出公开面**（红线 1 违例）。
// 绿：toPublicSnapshot（snapshot-filter 新出口，芯=shared doc-codec.toPublicReadModel——
//   RichTextValue 只余 text）+ 公开 wire 形状收口（content/prompt 恒 string——web
//   ProcessSnapshot.tsx:36-43 消费契约）。
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { toReadModel, fillDoc, type CanvasReadModel } from '@flowweb/shared';
import { buildFilteredSnapshot, toPublicSnapshot, WHITELIST } from './snapshot-filter.util';

/** 富文本读模型形态（XmlFragment→RichTextValue——doc-codec 解码口径）。 */
const rich = (text: string, html: string) => ({ text, html, json: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** 域容器真种子 doc（fillDoc 创建 seam）→ 读模型。 */
function readModelOf(records: ReadonlyArray<Record<string, unknown>>): CanvasReadModel {
  const doc = new Y.Doc();
  const nodes = records.map((data, i) => ({
    id: `n${i + 1}`,
    type: (data.__type as string) ?? 'textInput',
    position: { x: 0, y: 0 },
    data: (({ __type, ...rest }) => rest)(data as { __type?: string }),
  }));
  fillDoc(
    {
      getMap: (name: string) => doc.getMap(name) as never,
      createMap: () => new Y.Map() as never,
      createText: () => new Y.Text() as never,
      createXmlFragment: () => new Y.XmlFragment() as never,
      createXmlElement: (n: string) => new Y.XmlElement(n) as never,
      createXmlText: () => new Y.XmlText() as never,
      createArray: () => new Y.Array() as never,
    },
    nodes as never,
    [],
  );
  return toReadModel(doc);
}

/** 深度红线 1 断言：输出 JSON 全树禁 'html'/'json' 键（公开面永不携带富文本结构）。 */
function expectNoRichStructure(value: unknown, path = '$'): void {
  if (Array.isArray(value)) { value.forEach((v, i) => expectNoRichStructure(v, `${path}[${i}]`)); return; }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      expect(k, `${path} 公开面出现富文本结构键 '${k}'（红线 1）`).not.toBe('html');
      expect(k, `${path} 公开面出现 PM 结构键 '${k}'（红线 1）`).not.toBe('json');
      expectNoRichStructure(v, `${path}.${k}`);
    }
  }
}

describe('Y1c T19 红①：公开快照 sanitize（toPublicReadModel 落地）——RichTextValue 只余 text', () => {
  it('红轴：textInput.content=RichTextValue（T16 域容器读模型形态）——公开输出=纯文本 string，html/json 全树零命中', () => {
    const model = readModelOf([{ content: rich('一只猫在窗台上', '<p>一只猫在窗台上</p>'), prompt: rich('副提示词', '<p>副提示词</p>') }]);
    // 读模型确证：域容器已解码为 RichTextValue（形态前提——非假设）
    expect((model.nodes[0]!.data.content as { html: string }).html).toBe('<p>一只猫在窗台上</p>');

    const out = toPublicSnapshot(model, { dropTypes: [], resetStatusIdle: false, thumbnailUrls: {} });
    expect(out.nodes[0]!.data.content).toBe('一只猫在窗台上');   // 公开 wire 形状=string（ProcessSnapshot 消费契约）
    expect(out.nodes[0]!.data.prompt).toBe('副提示词');
    expectNoRichStructure(out);                                  // 红线 1：全树禁 html/json 键
  });

  it('imageGen/videoGen prompt=RichTextValue → .text string；fileId/status 等白名单外键照剥（服务端字段组不进公开面）', () => {
    const model = readModelOf([
      { __type: 'imageGen', prompt: rich('一只猫', '<p>一只猫</p>'), style: 's', fileId: 'f1', status: 'done' },
      { __type: 'videoGen', prompt: rich('一段视频', '<p>一段视频</p>'), model: 'm9', status: 'loading' },
    ]);
    const out = toPublicSnapshot(model, { dropTypes: [], resetStatusIdle: false, thumbnailUrls: {} });
    expect(out.nodes[0]!.data.prompt).toBe('一只猫');
    expect(out.nodes[0]!.data.style).toBe('s');
    expect(Object.keys(out.nodes[0]!.data)).not.toContain('fileId');
    expect(out.nodes[1]!.data.prompt).toBe('一段视频');
    expectNoRichStructure(out);
  });

  it('audioGen/multiImageGen prompt=Y.Text 域 → string 原样（T15 域）；dropTypes 连带边剔除（toPublicReadModel 同则）', () => {
    const model = readModelOf([
      { __type: 'audioGen', prompt: '一段音频提示词', model: 'a1' },
      { __type: 'videoEdit', anything: 1 },
    ]);
    const edges = [{ id: 'e1', source: 'n1', target: 'n2' }, { id: 'e2', source: 'n1', target: 'n1' }];
    const out = toPublicSnapshot({ nodes: model.nodes, edges: edges as never }, { dropTypes: ['videoEdit'], resetStatusIdle: false, thumbnailUrls: {} });
    expect(out.nodes.map((n) => n.type)).toEqual(['audioGen']);
    expect(out.nodes[0]!.data.prompt).toBe('一段音频提示词');
    expect(out.edges.map((e) => e.id)).toEqual(['e2']);   // 触达被剥节点的边连带剔除（e1 source=n1 target=n2——n2 被剥）
  });

  it('thumbnailUrl=服务端注入键（sanitize 后注入——不进白名单不剥）；克隆路径对照：buildFilteredSnapshot 保持 RichTextValue 全保真（用户画布副本=doc 域容器回灌 materialize.json 面）', () => {
    const model = readModelOf([{ __type: 'imageGen', prompt: rich('p', '<p>p</p>') }]);
    const out = toPublicSnapshot(model, { dropTypes: [], resetStatusIdle: false, thumbnailUrls: { n1: 'https://cdn.example/t.webp' } });
    expect(out.nodes[0]!.data.thumbnailUrl).toBe('https://cdn.example/t.webp');

    // 克隆读径④（D9 中间态——T22 切 render model）：content/prompt 域容器形态全保真透传
    // （imageGen.prompt=XmlFragment 域——RichTextValue 全保真；textInput.prompt=Y.Map 域不适用本夹具）
    const clone = buildFilteredSnapshot(model as never, { dropTypes: ['videoEdit'], dropIdPrefixes: [], resetStatusIdle: true, injectThumbnails: false, whitelist: WHITELIST });
    expect(clone.nodes[0]!.data.prompt).toEqual(rich('p', '<p>p</p>'));   // 全保真（json 面 fillDoc materialize 回灌）
  });
});
