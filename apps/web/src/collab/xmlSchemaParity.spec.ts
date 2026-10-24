// apps/web/src/collab/xmlSchemaParity.spec.ts
// Y1c T5c web parity 锚（plan v1.7 Task 5 客户端/恢复段；spec v5.4 §3.2 L1）：用 PromptInput.tsx
// 同款 extensions 在 jsdom 实例化 Tiptap editor，导出 PM schema 节点/mark/属性名，与
// @flowweb/shared collab/xml-schema 单表 **双向 setEqual**——schema 漂移即红（诚实执法：
// shared 表漏登新元素→红；PromptInput 禁用集变化→红；两侧任何单侧漂移都逃不掉）。
// extensions 复刻口径：StarterKit 同款 disable 集+Placeholder+Image.extend({inline,group})+
// Mention.extend({name:'command'/'imageMention'})——suggestion render/addNodeView 为 React 渲染面
// 不影响 schema（attrs/node 名只由 extension 类型与 configure 决定），此处最小化配置。
import { describe, expect, it, afterAll } from 'vitest';
// Editor 经 @tiptap/react 重导出引入（pnpm 严格面 @tiptap/core 非本包直接依赖；PromptInput
// 同款自 @tiptap/react 面 import——Editor 类同一单源）。
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Mention from '@tiptap/extension-mention';
import {
  XML_ELEMENTS, XML_MARKS, XML_ATTRS, XML_ROOT_NODE_NAME, XML_TEXT_NODE_NAME,
} from '@flowweb/shared';   // barrel 出口（tsc 经 package types→dist；vitest 经 vite alias→src——双态同源）

/** 与 PromptInput.tsx:249-334 同款 extensions（schema 相关面逐项一致——见头注复刻口径）。 */
function buildPromptInputSchemaEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        blockquote: false,
        orderedList: false,
        bulletList: false,
        horizontalRule: false,
        hardBreak: false,
      }),
      Placeholder.configure({ placeholder: 'parity' }),
      Image.extend({ inline: true, group: 'inline' }),
      Mention.extend({ name: 'command' }).configure({
        suggestion: { char: '/', items: () => [] },
      }),
      Mention.extend({ name: 'imageMention' }).configure({
        suggestion: { char: '@', items: () => [] },
      }),
    ],
    content: '',
  });
}

/** 双向集合相等（对称差为空——setEqual 语义；先自证 helper 本身对单侧漂移红）。 */
function setEqual(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return [...sa].every((x) => sb.has(x)) && [...sb].every((x) => sa.has(x));
}

describe('Y1c T5c web parity：PromptInput PM schema ⇔ shared xml-schema 单表（双向 setEqual）', () => {
  const editor = buildPromptInputSchemaEditor();
  afterAll(() => editor.destroy());
  // Editor 泛型会把 schema.nodes 键窄化到 extensions 推断集（doc/text 不在其类型面）——按运行时
  // Record 视图访问（运行时 schema 恒含 doc/text 全集；attrs 面同款）。
  const schemaNodes = editor.state.schema.nodes as unknown as Record<
    string, { spec: { attrs?: Record<string, unknown> } } | undefined
  >;

  it('parity 前置自证：setEqual helper 对单侧漂移必须判 false（负控——门自身有效性）', () => {
    expect(setEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(setEqual(['a'], ['a', 'b'])).toBe(false);   // shared 漏登
    expect(setEqual(['a', 'b'], ['a'])).toBe(false);   // PM 面多出未登记元素
    expect(setEqual([], [])).toBe(true);
  });

  it('元素名单向不漏：PM 节点名（除 doc 根与 text 文本承载）⇔ XML_ELEMENTS 双向相等', () => {
    const pmNodeNames: string[] = [];
    editor.state.schema.spec.nodes.forEach((name) => pmNodeNames.push(name));
    const pmElements = pmNodeNames.filter((n) => n !== XML_ROOT_NODE_NAME && n !== XML_TEXT_NODE_NAME);
    expect([...pmElements].sort()).toEqual([...XML_ELEMENTS].sort());
    expect(setEqual(pmElements, XML_ELEMENTS)).toBe(true);
  });

  it('mark 名双向相等：XML_MARKS=空集（PromptInput StarterKit mark 全禁用——漂移即红）', () => {
    const pmMarkNames: string[] = [];
    editor.state.schema.spec.marks.forEach((name) => pmMarkNames.push(name));
    expect(setEqual(pmMarkNames, XML_MARKS)).toBe(true);
  });

  it('逐元素属性名双向相等：XML_ATTRS 每条目 ⇔ PM schema.nodes[name] 属性集（零单侧漂移）', () => {
    for (const element of XML_ELEMENTS) {
      const nodeType = schemaNodes[element];
      expect(nodeType, `PM schema 缺元素 ${element}（shared 表已登记——PromptInput 侧漂移）`).toBeTruthy();
      const pmAttrs = Object.keys(nodeType!.spec.attrs ?? {});
      expect(setEqual(pmAttrs, XML_ATTRS[element]!),
        `元素 ${element} 属性漂移：PM=[${pmAttrs.join(',')}] shared=[${XML_ATTRS[element]!.join(',')}]`).toBe(true);
    }
    // 反向：PM 面有属性集的非根非文本元素全在 XML_ATTRS 表内（shared 漏登即红）
    const pmNodeNames: string[] = [];
    editor.state.schema.spec.nodes.forEach((name) => pmNodeNames.push(name));
    const pmElements = pmNodeNames.filter((n) => n !== XML_ROOT_NODE_NAME && n !== XML_TEXT_NODE_NAME);
    expect(setEqual(pmElements, Object.keys(XML_ATTRS))).toBe(true);
  });

  it('根/文本承载名在位：doc=根（XmlFragment 对应）、text=文本节点（Y.XmlText 对应）', () => {
    expect(schemaNodes[XML_ROOT_NODE_NAME]).toBeTruthy();
    expect(schemaNodes[XML_TEXT_NODE_NAME]).toBeTruthy();
    const elements = new Set<string>(XML_ELEMENTS);   // Set<string> 视图——编译期已证 doc/text ∉ 联合，此处运行时双保险
    expect(elements.has(XML_ROOT_NODE_NAME)).toBe(false);
    expect(elements.has(XML_TEXT_NODE_NAME)).toBe(false);
  });
});
