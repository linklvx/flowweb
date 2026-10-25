// apps/web/src/collab/xmlSchemaParity.spec.ts
// Y1c T5c web parity 锚（plan v1.7 Task 5 客户端/恢复段；spec v5.4 §3.2 L1）——**同源引用执法**：
// extensions 经 PromptInput 生产单源 builder 构造（prompt-input/extensions.ts
// buildPromptInputSchemaExtensions——PromptInput.tsx 与本 spec import **同一 builder**），schema 面
// （StarterKit disable 集+Placeholder+Image.extend({inline,group})+双 Mention.extend）单源，任何
// schema 变更双侧同步即红——单侧漂移在构造上不可能（非手工复刻比对）。渲染/交互回调
//（NodeView/suggestion items/render/command）经 opts 注入 noop——attrs/node 名只由 extension 类型
// 与 configure 决定，回调不影响 schema。在 jsdom 实例化 Tiptap editor 导出 PM schema 节点/mark/
// 属性名，与 @flowweb/shared canvas/xml-schema 单表 **双向 setEqual**——schema 漂移即红（诚实执法：
// shared 表漏登新元素→红；builder 禁用集变化→双侧同红）。
// **Y1c T16 扩**：两域 builder 并集执法（prompt 域=buildPromptInputSchemaExtensions；text 域
// =nodes/textExtensions.ts buildTextContentSchemaExtensions——TextInputNode 生产单源同款）——
// 并集 ⇔ XML_ELEMENTS/XML_MARKS 双向 setEqual（L1 gate 帧内不辨域取并集——单表=两域并集底表）。
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
// Editor 经 @tiptap/react 重导出面引入（pnpm 严格面 @tiptap/core 非本包直接依赖；extensions.ts
// 同款自 @tiptap/react 面 import——Editor 类同一单源）。
import { Editor } from '@tiptap/react';
import { buildPromptInputSchemaExtensions } from '../pages/canvas/components/nodes/prompt-input/extensions';
import { buildTextContentSchemaExtensions } from '../pages/canvas/components/nodes/textExtensions';
import {
  XML_ELEMENTS, XML_MARKS, XML_ATTRS, XML_ROOT_NODE_NAME, XML_TEXT_NODE_NAME,
} from '@flowweb/shared';   // barrel 出口（tsc 经 package types→dist；vitest 经 vite alias→src——双态同源）

/** PromptInput 同一 builder+noop 回调（schema 面与生产完全同构——见头注同源引用口径）。 */
function buildPromptInputSchemaEditor(): Editor {
  return new Editor({
    extensions: buildPromptInputSchemaExtensions({
      placeholder: 'parity',
      imageNodeView: () => ({ dom: document.createElement('span') }),
      commandItems: () => [],
      commandRender: () => ({ onStart: () => {}, onUpdate: () => {}, onExit: () => {} }),
      imageMentionItems: () => [],
      imageMentionRender: () => ({ onStart: () => {}, onUpdate: () => {}, onExit: () => {} }),
      imageMentionCommand: () => {},
    }),
    content: '',
  });
}

/** TextInputNode 同一 builder（text 域——T16 正文域生产单源；无回调注入面）。 */
function buildTextContentSchemaEditor(): Editor {
  return new Editor({
    extensions: buildTextContentSchemaExtensions(),
    content: '',
  });
}

/** 双向集合相等（对称差为空——setEqual 语义；先自证 helper 本身对单侧漂移红）。 */
function setEqual(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return [...sa].every((x) => sb.has(x)) && [...sb].every((x) => sa.has(x));
}

describe('Y1c T5c/T16 web parity：两域 PM schema 并集 ⇔ shared xml-schema 单表（双向 setEqual）', () => {
  // Editor 实例化收 beforeAll（收集期零副作用——评审 Minor#7）；afterAll 统一销毁。
  let editor!: Editor;
  let textEditor!: Editor;
  // Editor 泛型会把 schema.nodes 键窄化到 extensions 推断集（doc/text 不在其类型面）——按运行时
  // Record 视图访问（运行时 schema 恒含 doc/text 全集；attrs 面同款）。
  let schemaNodes!: Record<string, { spec: { attrs?: Record<string, unknown> } } | undefined>;
  let textSchemaNodes!: Record<string, { spec: { attrs?: Record<string, unknown> } } | undefined>;
  beforeAll(() => {
    editor = buildPromptInputSchemaEditor();
    schemaNodes = editor.state.schema.nodes as unknown as typeof schemaNodes;
    textEditor = buildTextContentSchemaEditor();
    textSchemaNodes = textEditor.state.schema.nodes as unknown as typeof textSchemaNodes;
  });
  afterAll(() => {
    editor.destroy();
    textEditor.destroy();
  });

  it('parity 前置自证：setEqual helper 对单侧漂移必须判 false（负控——门自身有效性）', () => {
    expect(setEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(setEqual(['a'], ['a', 'b'])).toBe(false);   // shared 漏登
    expect(setEqual(['a', 'b'], ['a'])).toBe(false);   // PM 面多出未登记元素
    expect(setEqual([], [])).toBe(true);
  });

  it('元素名单向不漏：两域 PM 节点名并集（除 doc 根与 text 文本承载）⇔ XML_ELEMENTS 双向相等', () => {
    const pmNodeNames: string[] = [];
    editor.state.schema.spec.nodes.forEach((name) => pmNodeNames.push(name));
    textEditor.state.schema.spec.nodes.forEach((name) => pmNodeNames.push(name));
    const pmElements = [...new Set(pmNodeNames)].filter((n) => n !== XML_ROOT_NODE_NAME && n !== XML_TEXT_NODE_NAME);
    expect([...pmElements].sort()).toEqual([...XML_ELEMENTS].sort());
    expect(setEqual(pmElements, XML_ELEMENTS)).toBe(true);
  });

  it('mark 名双向相等：两域 mark 并集 ⇔ XML_MARKS（prompt 域零贡献+text 域四 mark）', () => {
    const pmMarkNames: string[] = [];
    editor.state.schema.spec.marks.forEach((name) => pmMarkNames.push(name));
    textEditor.state.schema.spec.marks.forEach((name) => pmMarkNames.push(name));
    expect(setEqual([...new Set(pmMarkNames)], XML_MARKS)).toBe(true);
  });

  it('逐元素属性名双向相等：XML_ATTRS 每条目 ⇔ 各域 PM schema.nodes[name] 属性集（共有元素双侧各验——Q-M-2）', () => {
    for (const element of XML_ELEMENTS) {
      // Q-M-2（双评审收口）：共有元素（paragraph/codeBlock/listItem）在两域 schema 均存在——
      // `?? ` 短路只验先命侧会漏后侧漂移；逐侧在场即验（两域独立 builder 可各自漂移）
      for (const [side, table] of [['prompt', schemaNodes], ['text', textSchemaNodes]] as const) {
        const nodeType = table[element];
        if (nodeType === undefined) continue;   // 该域无此元素（域专属面）——另一侧覆盖
        const pmAttrs = Object.keys(nodeType.spec.attrs ?? {});
        expect(setEqual(pmAttrs, XML_ATTRS[element]!),
          `元素 ${element}（${side} 域）属性漂移：PM=[${pmAttrs.join(',')}] shared=[${XML_ATTRS[element]!.join(',')}]`).toBe(true);
      }
      const nodeType = schemaNodes[element] ?? textSchemaNodes[element];
      expect(nodeType, `两域 PM schema 均缺元素 ${element}（shared 表已登记——builder 侧漂移）`).toBeTruthy();
    }
    // 反向：两域 PM 面非根非文本元素并集全在 XML_ATTRS 表内（shared 漏登即红）
    const pmNodeNames: string[] = [];
    editor.state.schema.spec.nodes.forEach((name) => pmNodeNames.push(name));
    textEditor.state.schema.spec.nodes.forEach((name) => pmNodeNames.push(name));
    const pmElements = [...new Set(pmNodeNames)].filter((n) => n !== XML_ROOT_NODE_NAME && n !== XML_TEXT_NODE_NAME);
    expect(setEqual(pmElements, Object.keys(XML_ATTRS))).toBe(true);
  });

  it('根/文本承载名在位：doc=根（XmlFragment 对应）、text=文本节点（Y.XmlText 对应）', () => {
    expect(schemaNodes[XML_ROOT_NODE_NAME]).toBeTruthy();
    expect(schemaNodes[XML_TEXT_NODE_NAME]).toBeTruthy();
    const elements = new Set<string>(XML_ELEMENTS);   // Set<string> 视图——编译期已证 doc/text ∉ 联合，此处运行时双保险
    expect(elements.has(XML_ROOT_NODE_NAME)).toBe(false);
    expect(elements.has(XML_TEXT_NODE_NAME)).toBe(false);
  });

  it('Y1c T16 客户端 PM 解析双验：对抗语料元素名不在两域 PM schema（未知元素客户端不可渲染）', () => {
    // 服务端 L1 拒帧（api collab-t16-xml-l1.spec X1）+客户端 schema 面双验：未知元素名
    // ∉ PM schema.spec.nodes ⇒ y-prosemirror createNodeIfNotExists schema.node() throw→删除该
    // 元素（sync-plugin :803-810 兜底）——双验第二道。
    for (const evil of ['script', 'iframe', 'customWidget', 'video']) {
      expect(schemaNodes[evil], `prompt 域 schema 不应含 ${evil}`).toBeUndefined();
      expect(textSchemaNodes[evil], `text 域 schema 不应含 ${evil}`).toBeUndefined();
      expect(XML_ELEMENTS).not.toContain(evil as never);
    }
  });
});
