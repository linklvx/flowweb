// packages/shared/src/canvas/doc-codec.public-sanitize.t24.spec.ts
// Y1c T24（T19 登记「浅 sanitize 理论缺口」收口——公开快照导出面 sanitize 深度强化）：toPublicReadModel
// 的 URL allowlist 原只扫**顶层字符串值**——数组/对象内嵌 URL 字符串（allImages item.url、extConfig
// 嵌套值等载体）理论穿透=公开面外链泄漏。红相=嵌套 URL 值原样透出；绿=深度剥除（bounded depth）。
import { describe, it, expect } from 'vitest';
import { toPublicReadModel } from './doc-codec';
import type { CanvasReadModel } from './doc-codec';

const base: CanvasReadModel = {
  nodes: [
    {
      id: 'n1', type: 'imageGen', position: { x: 0, y: 0 },
      data: {
        mediaName: 'm',
        urls: ['http://cdn.ok.example/a.png', 'http://evil.example/x.png'],          // lww-array 载体
        cfg: { home: 'http://evil.example/home', note: 'plain-text' },               // map 载体
        nested: [{ u: 'http://evil.example/deep' }],
      },
    },
  ],
  edges: [],
};

describe('Y1c T24：toPublicReadModel 深度 sanitize（T19 浅扫缺口收口）', () => {
  it('数组/对象内嵌域外 URL 深度剥除（allowlist 命中值保留——allowlist 缺省=不过滤语义维持）', () => {
    const out = toPublicReadModel(base, {
      dataKeys: { imageGen: ['mediaName', 'urls', 'cfg', 'nested'] },
      allowedUrlHosts: ['cdn.ok.example'],
    });
    const d = out.nodes[0]!.data;
    expect(d.urls).toEqual(['http://cdn.ok.example/a.png']);   // 域外数组项剥除（原样透出=红相）
    expect(d.cfg).toEqual({ note: 'plain-text' });             // 域外 map 值剥键
    expect(d.nested).toEqual([{}]);                            // 深层值剥除（键 u 域外剥键——容器壳不塌缩：值级剥除语义）
  });

  it('RichTextValue 出口维持只余 text（红线 1）+ allowlist 缺省不过滤（宽松缺省语义不变）', () => {
    const out = toPublicReadModel({
      nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: { text: '正文', html: '<p>x</p>', json: [] } } }],
      edges: [],
    }, { dataKeys: { textInput: ['content'] } });
    expect(out.nodes[0]!.data.content).toEqual({ text: '正文' });
    const unfiltered = toPublicReadModel(base, { dataKeys: { imageGen: ['urls'] } });
    expect(unfiltered.nodes[0]!.data.urls).toHaveLength(2);   // 无 allowlist=不过滤（公开面宽松缺省——与 L1 拒帧面语义有意相反）
  });
});
