// apps/web/src/pages/canvas/components/nodes/prompt-input/extensions.ts
// Y1c T5c 质量评审收口（Important#1 方案 a）：PromptInput Tiptap extensions 单源 builder。
// 提取自 PromptInput.tsx 原 extensions 内联配置（**纯配置提取——行为零变化**）；渲染/交互回调
// （image NodeView、'/' 与 '@' suggestion 的 items/render/command）经 opts 注入——PromptInput 传
// 真实实现，apps/web/src/collab/xmlSchemaParity.spec.ts import **同一 builder** 传 noop：schema 面
// 同源（StarterKit disable 集+Placeholder+Image.extend({inline,group})+双 Mention.extend 单源），
// 任何 schema 变更双侧同步即红——单侧漂移在构造上不可能（非复刻比对）。
// 注：@tiptap/core 非本包直接依赖（pnpm 严格面）——类型一律经 @tiptap/react 重导出面引入。
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import type { NodeViewRendererProps } from '@tiptap/react';
import type { CommandItem, ImageItem } from './types';

/** suggestion 渲染器形状（@tiptap/suggestion SuggestionRenderer 面——command 槽为 '/' 面板
 *  渲染器私有扩展〔插入 command 节点〕；'@' 面板选中经 suggestion.command 独立注入）。 */
export interface PromptInputSuggestionRenderer {
  onStart: (props: any) => void;
  onUpdate: (props: any) => void;
  onExit: () => void;
  command?: (props: any) => void;
}

/** builder 注入面：schema 无关的渲染/交互回调（PromptInput 注入真实实现；parity spec 注入
 *  noop——两态 extensions 结构恒同，schema 面完全一致）。 */
export interface PromptInputSchemaExtensionsOptions {
  /** Placeholder 文案（Placeholder.configure 同参直通） */
  placeholder: string;
  /** inline image chip 的 NodeView（DOM 构造——渲染面不影响 schema：attrs/node 名只由
   *  extension 类型与 configure 决定） */
  imageNodeView: (props: NodeViewRendererProps) => { dom: HTMLElement };
  /** '/' 命令面板 items 查询（消费 COMMANDS 表——PromptInput 注入过滤实现） */
  commandItems: (query: string) => CommandItem[];
  /** '/' 命令面板 suggestion 渲染器工厂（React portal 渲染面） */
  commandRender: () => PromptInputSuggestionRenderer;
  /** '@' 素材引用 items 查询（allImages 最新值由注入方闭包管理） */
  imageMentionItems: (query: string) => ImageItem[];
  /** '@' 素材引用 suggestion 渲染器工厂（React portal 渲染面） */
  imageMentionRender: () => PromptInputSuggestionRenderer;
  /** '@' 选中后插入 image 节点（editor chain 交互回调） */
  imageMentionCommand: (props: { editor: any; range: any; props: unknown }) => void;
}

/** PromptInput Tiptap extensions 单源 builder（schema 面唯一真源——PromptInput 与
 *  xmlSchemaParity.spec 共用；提取自 PromptInput 原 extensions 数组，配置逐项一致）。
 *  Y1c T16 增 history:false——单 UndoManager 纪律（spec §3.3：Tiptap 自带 history 与
 *  ySyncPlugin 冲突；撤销走画布级单 manager，非 schema 面〔history=plugin〕故 parity 零影响）。 */
export function buildPromptInputSchemaExtensions(opts: PromptInputSchemaExtensionsOptions) {
  return [
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
      history: false,
    }),
    Placeholder.configure({ placeholder: opts.placeholder }),
    // Custom inline image chip (NodeView replaces block <img>——nodeView 经 opts 注入)
    Image.extend({
      inline: true,
      group: 'inline',
      addNodeView() {
        return opts.imageNodeView;
      },
    }),
    Mention.extend({ name: 'command' }).configure({
      HTMLAttributes: {
        class: 'command-chip',
      },
      suggestion: {
        char: '/',
        allowSpaces: true,
        items: ({ query }: { query: string }) => opts.commandItems(query),
        render: opts.commandRender,
      },
    }),
    // @mention — inline image insertion from allImages pool
    Mention.extend({ name: 'imageMention' }).configure({
      HTMLAttributes: { class: 'hidden' },
      suggestion: {
        char: '@',
        items: ({ query }: { query: string }) => opts.imageMentionItems(query),
        render: opts.imageMentionRender,
        command: (p: any) => opts.imageMentionCommand(p),
      },
    }),
  ];
}
