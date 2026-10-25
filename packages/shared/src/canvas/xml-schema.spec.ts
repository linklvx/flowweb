// packages/shared/src/canvas/xml-schema.spec.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段；spec v5.4 §3.2 L1——偏离 38⑬）：XML_ELEMENTS/MARKS/ATTRS
// 单表契约测试——表值从两域 Tiptap extensions builder 实测派生（web parity spec=jsdom 实例化
// editor 并集双向 setEqual 执法锚；本文件冻数字与表形）。先红→绿。
// **Y1c T16（本卡）**：表扩 textInput content 域元素/mark（两域并表）+XML_DOMAINS 派生+
// validateXmlL1 扫描器契约面（对抗语料主战场=apps/api collab-t16-xml-l1.spec——本文件冻表形与
// 派生不变量）。
import { describe, expect, it } from 'vitest';
import {
  XML_ELEMENTS, XML_MARKS, XML_ATTRS,
  XML_ROOT_NODE_NAME, XML_TEXT_NODE_NAME,
  XML_MAX_DEPTH, XML_TEXT_MAX_BYTES,
  XML_URL_ALLOWLIST_CONTRACT, XML_MEDIA_ANCHOR, XML_L1_CONSUMERS,
  XML_DOMAINS, deriveXmlDomains, isXmlDomainKey, ensureXmlDomainDefaults,
  EMPTY_XML_VALUE, referencedMediaIdsOf,
} from './xml-schema';
import { DOC_SCHEMA_V4 } from './doc-schema-v4';

describe('Y1c T5c/T16 契约冻结：XML_ELEMENTS 单表（两域 extensions 实测派生并集）', () => {
  it('元素十二值精确冻结：prompt 域六值+text 域六值', () => {
    expect([...XML_ELEMENTS]).toEqual([
      // prompt 域（PromptInput——StarterKit 禁用后存活+扩展）
      'paragraph', 'codeBlock', 'listItem', 'image', 'command', 'imageMention',
      // text 域（TextInputNode 正文——StarterKit heading{1,2,3} 全启用追加）
      'heading', 'blockquote', 'bulletList', 'orderedList', 'horizontalRule', 'hardBreak',
    ]);
    expect(new Set(XML_ELEMENTS).size).toBe(12);
  });
  it('根/文本节点名冻结：doc=XmlFragment 根（非元素——不进元素表）；text=Y.XmlText 承载名', () => {
    expect(XML_ROOT_NODE_NAME).toBe('doc');
    expect(XML_TEXT_NODE_NAME).toBe('text');
    expect(XML_ELEMENTS).not.toContain('doc');
    expect(XML_ELEMENTS).not.toContain('text');
  });
  it('XML_MARKS 四值冻结（text 域 StarterKit 默认 mark——prompt 域零贡献）', () => {
    expect([...XML_MARKS]).toEqual(['bold', 'italic', 'strike', 'code']);
  });
});

describe('Y1c T5c/T16 契约冻结：XML_ATTRS 逐元素属性表', () => {
  it('各元素属性集精确冻结（PM schema addAttributes 实测——mention 三键+heading.level）', () => {
    expect(Object.keys(XML_ATTRS).sort()).toEqual([
      'blockquote', 'bulletList', 'codeBlock', 'command', 'hardBreak', 'heading',
      'horizontalRule', 'image', 'imageMention', 'listItem', 'orderedList', 'paragraph',
    ]);
    expect([...XML_ATTRS.paragraph!]).toEqual([]);
    expect([...XML_ATTRS.listItem!]).toEqual([]);
    expect([...XML_ATTRS.codeBlock!]).toEqual(['language']);
    expect([...XML_ATTRS.image!]).toEqual(['src', 'alt', 'title']);
    expect([...XML_ATTRS.command!]).toEqual(['id', 'label', 'mentionSuggestionChar']);
    expect([...XML_ATTRS.imageMention!]).toEqual(['id', 'label', 'mentionSuggestionChar']);
    expect([...XML_ATTRS.heading!]).toEqual(['level']);
    expect([...XML_ATTRS.blockquote!]).toEqual([]);
    expect([...XML_ATTRS.bulletList!]).toEqual([]);
    expect([...XML_ATTRS.orderedList!]).toEqual(['start', 'type']);
    expect([...XML_ATTRS.horizontalRule!]).toEqual([]);
    expect([...XML_ATTRS.hardBreak!]).toEqual([]);
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
  it('消费注记：T16 L1 消费（frame-local struct 扫描）/T24 扩全类型矩阵+L2', () => {
    expect(XML_L1_CONSUMERS.t16).toContain('L1');
    expect(XML_L1_CONSUMERS.t24).toContain('全类型矩阵');
    expect(XML_L1_CONSUMERS.t24).toContain('L2');
  });
});

describe('Y1c T16：XML 域词表（DOC_SCHEMA_V4 单源派生——text-domains 同族）', () => {
  it('四域精确冻结：textInput{content}+imageGen/videoGen/imageExtGen{prompt}', () => {
    expect(XML_DOMAINS.textInput).toEqual(new Set(['content']));
    expect(XML_DOMAINS.imageGen).toEqual(new Set(['prompt']));
    expect(XML_DOMAINS.videoGen).toEqual(new Set(['prompt']));
    expect(XML_DOMAINS.imageExtGen).toEqual(new Set(['prompt']));
    expect(Object.keys(XML_DOMAINS).sort()).toEqual(['imageExtGen', 'imageGen', 'textInput', 'videoGen']);
  });
  it('派生不变量：yType==="xml" 全集即词表（矩阵改形状词表随动——禁第二真源）', () => {
    const manual = deriveXmlDomains(JSON.parse(JSON.stringify(
      Object.fromEntries(Object.entries(DOC_SCHEMA_V4).map(([t, d]) => [t, { data: d.data }])),
    )));
    expect(manual).toEqual(XML_DOMAINS);
  });
  it('isXmlDomainKey：域键命中/非域键（prompt〔Y.Text 域〕与 model 等不命中）', () => {
    expect(isXmlDomainKey('textInput', 'content')).toBe(true);
    expect(isXmlDomainKey('imageGen', 'prompt')).toBe(true);
    expect(isXmlDomainKey('audioGen', 'prompt')).toBe(false);
    expect(isXmlDomainKey('textInput', 'prompt')).toBe(false);
    expect(isXmlDomainKey('textInput', 'model')).toBe(false);
    expect(isXmlDomainKey('unknown-type', 'content')).toBe(false);
  });
  it('ensureXmlDomainDefaults：缺省补空 RichTextValue+string 收编 canonical/RichText 原样/入参不突变', () => {
    // 已在 canonical 值原引用直通（RichTextValue/实例/异形——零覆写）
    const src = { content: { text: 'x', html: '<p>x</p>', json: [] } };
    expect(ensureXmlDomainDefaults('textInput', src)).toBe(src);
    expect(ensureXmlDomainDefaults('textInput', {}).content).toBe(EMPTY_XML_VALUE);
    expect(ensureXmlDomainDefaults('imageGen', { model: 'm' }).prompt).toBe(EMPTY_XML_VALUE);
    const none = ensureXmlDomainDefaults('audioGen', { model: 'm' });
    expect(none).toEqual({ model: 'm' });
    const untouched = { model: 'm' };
    expect(ensureXmlDomainDefaults('imageGen', untouched)).not.toBe(untouched);   // 补键产副本
    expect(untouched).toEqual({ model: 'm' });   // 入参不突变（纯函数）
  });

  it('ensureXmlDomainDefaults string 收编：空串与非空 string → RichTextValue（doc 容器/ns 投影同形）', () => {
    const emptyStr = ensureXmlDomainDefaults('textInput', { content: '' });
    expect(emptyStr.content).toBe(EMPTY_XML_VALUE);
    const plain = ensureXmlDomainDefaults('textInput', { content: 'child 文本' }) as Record<string, { text: string; html: string; json: unknown[] }>;
    expect(plain.content.text).toBe('child 文本');
    expect(plain.content.html).toBe('<p>child 文本</p>');
    expect(plain.content.json).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'child 文本' }] }]);
    // HTML 字面量按字面文本收编（不解释——`<b>` 转义入 html 面）
    const htmlish = ensureXmlDomainDefaults('textInput', { content: '<b>x</b>' }) as Record<string, { html: string }>;
    expect(htmlish.content.html).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
  });

  it('referencedMediaIdsOf：image.src=mediaId+mention.id 两锚并集保序去重（PromptValue 三出口）', () => {
    expect(referencedMediaIdsOf([
      { type: 'paragraph', content: [
        { type: 'text', text: 'a' },
        { type: 'image', attrs: { src: 'media-1', alt: 'x' } },
        { type: 'imageMention', attrs: { id: 'media-2', label: '@素材' } },
        { type: 'command', attrs: { id: 'cmd-style', label: '/风格' } },
        { type: 'image', attrs: { src: 'media-1' } },   // 重复 mediaId 去重
      ] },
      { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'media-3' } }] },
    ])).toEqual(['media-1', 'media-2', 'cmd-style', 'media-3']);
    expect(referencedMediaIdsOf([])).toEqual([]);
    expect(referencedMediaIdsOf([{ type: 'paragraph', content: [{ type: 'text', text: '纯文本' }] }])).toEqual([]);
  });
});
