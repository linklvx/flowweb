// packages/shared/src/collab/xml-schema.spec.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段；spec v5.4 §3.2 L1——偏离 38⑬）：XML_ELEMENTS/MARKS/ATTRS
// 单表契约测试——表值从 PromptInput.tsx Tiptap extensions 实测派生（web parity spec=jsdom 实例化
// editor 双向 setEqual 执法锚；本文件冻数字与表形）。先红→绿。
import { describe, expect, it } from 'vitest';
import {
  XML_ELEMENTS, XML_MARKS, XML_ATTRS,
  XML_ROOT_NODE_NAME, XML_TEXT_NODE_NAME,
  XML_MAX_DEPTH, XML_TEXT_MAX_BYTES,
  XML_URL_ALLOWLIST_CONTRACT, XML_MEDIA_ANCHOR, XML_L1_CONSUMERS,
} from './xml-schema';

describe('Y1c T5c 契约冻结：XML_ELEMENTS 单表（PromptInput extensions 实测派生）', () => {
  it('元素六值精确冻结：paragraph/codeBlock/listItem/image/command/imageMention', () => {
    expect([...XML_ELEMENTS]).toEqual([
      'paragraph', 'codeBlock', 'listItem', 'image', 'command', 'imageMention',
    ]);
    expect(new Set(XML_ELEMENTS).size).toBe(6);
  });
  it('根/文本节点名冻结：doc=XmlFragment 根（非元素——不进元素表）；text=Y.XmlText 承载名', () => {
    expect(XML_ROOT_NODE_NAME).toBe('doc');
    expect(XML_TEXT_NODE_NAME).toBe('text');
    expect(XML_ELEMENTS).not.toContain('doc');
    expect(XML_ELEMENTS).not.toContain('text');
  });
  it('XML_MARKS=空集冻结（PromptInput StarterKit mark 全禁用事实——bold/italic/strike/code 均 false）', () => {
    expect([...XML_MARKS]).toEqual([]);
  });
});

describe('Y1c T5c 契约冻结：XML_ATTRS 逐元素属性表', () => {
  it('各元素属性集精确冻结（PM schema addAttributes 实测——含 mention 的 mentionSuggestionChar 渲染提示键）', () => {
    expect(Object.keys(XML_ATTRS).sort()).toEqual([
      'codeBlock', 'command', 'image', 'imageMention', 'listItem', 'paragraph',
    ]);
    expect([...XML_ATTRS.paragraph!]).toEqual([]);
    expect([...XML_ATTRS.listItem!]).toEqual([]);
    expect([...XML_ATTRS.codeBlock!]).toEqual(['language']);
    expect([...XML_ATTRS.image!]).toEqual(['src', 'alt', 'title']);
    expect([...XML_ATTRS.command!]).toEqual(['id', 'label', 'mentionSuggestionChar']);
    expect([...XML_ATTRS.imageMention!]).toEqual(['id', 'label', 'mentionSuggestionChar']);
  });
});

describe('Y1c T5c 契约冻结：L1 数字（深度/文本上限——frame-local struct 扫描参数）', () => {
  it('深度≤32；文本≤128KiB=131_072 派生', () => {
    expect(XML_MAX_DEPTH).toBe(32);
    expect(XML_TEXT_MAX_BYTES).toBe(128 * 1024);
    expect(XML_TEXT_MAX_BYTES).toBe(131_072);
  });
});

describe('Y1c T5c 契约冻结：URL allowlist 机制+mediaId 锚+消费注记', () => {
  it('URL allowlist 机制注记：真源住调用方（T4 toPublicReadModel policy 先例——shared 不造第二份表）', () => {
    expect(XML_URL_ALLOWLIST_CONTRACT.mechanism).toContain('allowlist');
    expect(XML_URL_ALLOWLIST_CONTRACT.truthSource).toContain('toPublicReadModel');
    expect(XML_URL_ALLOWLIST_CONTRACT.truthSource).toContain('调用方');
    expect(XML_URL_ALLOWLIST_CONTRACT.noSecondTable).toContain('第二份表');
  });
  it('mention·image=mediaId 锚：存在性归执行受理/ProjectDocIndex 不入 gate（L1 只管结构白名单）', () => {
    expect(XML_MEDIA_ANCHOR.mentionElements).toContain('command');
    expect(XML_MEDIA_ANCHOR.mentionElements).toContain('imageMention');
    expect(XML_MEDIA_ANCHOR.imageAttr).toBe('src');
    expect(XML_MEDIA_ANCHOR.existenceCheckOwner).toContain('执行受理');
    expect(XML_MEDIA_ANCHOR.existenceCheckOwner).toContain('ProjectDocIndex');
    expect(XML_MEDIA_ANCHOR.existenceCheckOwner).toContain('不入 gate');
  });
  it('消费注记：T16 L1 消费（frame-local struct 扫描）/T24 扩全类型矩阵', () => {
    expect(XML_L1_CONSUMERS.t16).toContain('L1');
    expect(XML_L1_CONSUMERS.t24).toContain('全类型矩阵');
  });
});
