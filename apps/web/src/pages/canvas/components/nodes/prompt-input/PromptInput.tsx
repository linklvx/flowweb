import React, {
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
  createElement,
} from 'react';
import './PromptInput.css';
import { useEditor, EditorContent, type NodeViewRendererProps } from '@tiptap/react';
import { createRoot } from 'react-dom/client';
import { CommandMentionList } from './CommandMentionList';
import { ImageMentionList } from './ImageMentionList';
import { COMMANDS, CATEGORY_DEFAULTS } from './types';
import type { CommandItem, ImageItem } from './types';
// extensions 单源 builder（Y1c T5c 评审 Important#1：schema 面提取共享——本组件与
// collab/xmlSchemaParity.spec import 同一 builder；渲染/交互回调经 opts 注入保持行为零变化）
import { buildPromptInputSchemaExtensions } from './extensions';
// Y1c T16：prompt=XmlFragment 域（imageGen/videoGen/imageExtGen）——ySyncPlugin 双端直绑
//（doc 容器权威；onChange→updateConfig PromptValue JSON 整串写链路删除；getHTML 只读导出）
import { resolveDoc } from '@/stores/canvasIntents';
import { resolveNodeXmlFragment, ySyncHostExtension, richTextOfFragment } from '@/collab/yXmlFragmentBinding';
import { recordCollabDiag } from '@/utils/collabDiagnostics';

export interface PromptInputRef {
  focus: () => void;
  clear: () => void;
  /** 插入图片 chip（src=mediaId——修正批#1：渲染层受控 URL 解析；非 URL 直存） */
  insertImage: (mediaId: string) => void;
  removeImage: (mediaId: string) => void;
  setText: (text: string) => void;
  /** getHTML 只读导出（PromptValue 三出口——RichTextValue 单源派生，禁编辑器态写回） */
  getRichText: () => { text: string; html: string; json: unknown[] };
}

interface PromptInputProps {
  nodeId: string;
  /** XmlFragment 域键（'prompt'——三域同键；默认 prompt） */
  domainKey?: string;
  onCommandSelect?: (command: CommandItem) => void;
  onGenerate?: () => void;

  allImages?: ImageItem[];
  onPasteImage?: (file: File) => void;

  placeholder?: string;
  disabled?: boolean;
  maxHeight?: number;
  /** Y1c T16：只读回退 html（容器缺失=结构错误——静态展示不掩盖；正常路径编辑器直绑） */
  fallbackHtml?: string;
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Native-DOM suggestion renderer for ImageMentionList (no tippy.js).
 */
function createImageSuggestionRenderer() {
  return (): {
    onStart: (props: any) => void;
    onUpdate: (props: any) => void;
    onExit: () => void;
  } => {
    let popupElement: HTMLDivElement | null = null;
    let popupRoot: ReturnType<typeof createRoot> | null = null;

    return {
      onStart(props: any) {
        popupElement = document.createElement('div');
        document.body.appendChild(popupElement);
        popupRoot = createRoot(popupElement);
        popupRoot.render(
          createElement(ImageMentionList, {
            items: props.items,
            selectedIndex: 0,
            onSelect: (item: ImageItem) => props.command(item),
            onClose: () => props.editor.commands.blur(),
            clientRect: props.clientRect(),
          }),
        );
      },
      onUpdate(props: any) {
        if (popupRoot) {
          popupRoot.render(
            createElement(ImageMentionList, {
              items: props.items,
              selectedIndex: 0,
              onSelect: (item: ImageItem) => props.command(item),
              onClose: () => props.editor.commands.blur(),
              clientRect: props.clientRect(),
            }),
          );
        }
      },
      onExit() {
        popupRoot?.unmount();
        popupElement?.remove();
        popupRoot = null;
        popupElement = null;
      },
    };
  };
}
/**
 * Creates a native-DOM suggestion renderer (no tippy.js).
 * Renders CommandMentionList into a document.body portal via createRoot.
 */
function createNativeSuggestionRenderer(
  onCommandSelect?: (command: CommandItem) => void,
) {
  return (): {
    onStart: (props: any) => void;
    onUpdate: (props: any) => void;
    onExit: () => void;
    command: (props: any) => void;
  } => {
    let popupElement: HTMLDivElement | null = null;
    let popupRoot: ReturnType<typeof createRoot> | null = null;

    return {
      onStart(props: any) {
        popupElement = document.createElement('div');
        document.body.appendChild(popupElement);
        popupRoot = createRoot(popupElement);
        popupRoot.render(
          createElement(CommandMentionList, {
            items: props.items,
            onSelect: (item) => props.command(item),
            onClose: () => props.editor.commands.blur(),
            clientRect: props.clientRect(),
          }),
        );
      },

      onUpdate(props: any) {
        if (popupRoot) {
          popupRoot.render(
            createElement(CommandMentionList, {
              items: props.items,
              onSelect: (item) => props.command(item),
              onClose: () => props.editor.commands.blur(),
              clientRect: props.clientRect(),
            }),
          );
        }
      },

      onExit() {
        if (popupRoot) {
          popupRoot.unmount();
          popupRoot = null;
        }
        if (popupElement) {
          popupElement.remove();
          popupElement = null;
        }
      },

      command({ editor: ed, range, props }: any) {
        ed.chain().focus().deleteRange(range).run();
        ed.chain()
          .focus()
          .insertContent({
            type: 'command',
            attrs: { id: props.id, label: props.name },
          })
          .run();
        onCommandSelect?.(props);
      },
    };
  };
}

// =========================================================================
// Hooks
// =========================================================================

/**
 * Listens for command-chip deletion in the editor and calls
 * onCommandSelect with the category default when one is removed.
 */
function useCommandChipSync(
  editor: ReturnType<typeof useEditor>,
  onCommandSelect?: (command: CommandItem) => void,
) {
  useEffect(() => {
    if (!editor) return;

    const handler = ({ transaction }: any) => {
      if (!transaction.docChanged) return;

      const removed: { category: string }[] = [];
      transaction.steps.forEach((step: any) => {
        if (step.jsonID === 'replace' && step.slice?.content?.size === 0) {
          const pos = step.from;
          const node = transaction.before.nodeAt(pos);
          if (node?.type.name === 'command') {
            removed.push({ category: node.attrs.category });
          }
        }
      });

      removed.forEach(({ category }) => {
        const defaultValue =
          CATEGORY_DEFAULTS[category as keyof typeof CATEGORY_DEFAULTS];
        if (defaultValue) {
          onCommandSelect?.({ category, value: defaultValue } as CommandItem);
        }
      });
    };

    editor.on('transaction', handler);
    return () => {
      editor.off('transaction', handler);
    };
  }, [editor, onCommandSelect]);
}

// =========================================================================
// Component
// =========================================================================

const PromptInput = forwardRef<PromptInputRef, PromptInputProps>(
  (
    {
      nodeId,
      domainKey = 'prompt',
      onCommandSelect,
      onGenerate,
      allImages = [],
      onPasteImage,
      placeholder = '描述你想要生成的画面内容，@引用素材',
      disabled = false,
      maxHeight = 120,
      fallbackHtml = '',
    },
    ref,
  ) => {
    // Same pattern for allImages — @mention callback must see latest images after upload
    // + Y1c T16 修正批#1：NodeView 的 mediaId→受控 URL 解析消费同一最新池
    const allImagesRef = useRef(allImages);
    allImagesRef.current = allImages;

    // ── Y1c T16：prompt=嵌套 XmlFragment 双端绑定 ──
    // 容器解析零懒建（T15 容器规则——缺=结构错误：只读回退 fallbackHtml 展示+诊断留痕）；
    // 单 editor 实例（工具栏/maximize 复用——面板 maxHeight 变化不改绑定）；content 恒 ''
    //（fragment 权威——ySyncPlugin view() 初始装载）；不挂 yUndoPlugin（单 manager——T18）；
    // 本地编辑 origin=ySyncPluginKey（canvasUndo attach 时 addTrackedOrigin——S3 结论③）。
    const fragment = useMemo(
      () => resolveNodeXmlFragment(resolveDoc(), nodeId, domainKey),
      [nodeId, domainKey],
    );
    useEffect(() => {
      if (!fragment) {
        recordCollabDiag('write_reject', { reason: 'xml-container-missing', via: 'prompt-input' });
      }
    }, [fragment]);

    const editor = useEditor(
      {
        // extensions 恒合法 schema（容器缺失档 StarterKit 兜底——空 extensions 会 RangeError）；
        // ySync 宿主仅容器在时挂（结构错误档=无绑定编辑器，渲染走只读回退）
        extensions: [
          ...buildPromptInputSchemaExtensions({
            placeholder,
            imageNodeView: ({ node }: NodeViewRendererProps) => {
              const dom = document.createElement('span');
              dom.className = 'image-chip';
              dom.setAttribute('contenteditable', 'false');
              dom.style.cssText =
                'display:inline-flex;align-items:center;gap:4px;height:20px;min-width:24px;max-width:120px;padding:1px 4px;border-radius:4px;background:#333;vertical-align:middle;white-space:normal;cursor:default;user-select:none;';

              const thumb = document.createElement('span');
              thumb.style.cssText =
                'width:14px;height:14px;border-radius:3px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 8px rgba(0,0,0,0.16),0 0.5px 0 0 inset rgba(255,255,255,0.16);';

              // 修正批#1：node.attrs.src=mediaId——渲染层受控 URL 解析（allImages 池按 id
              // 查 url；miss=占位灰块，不外联不加载未知 URL）。
              // Q-M-1（双评审收口）：池查找双档=创建时一次+update 钩子重解析（chip 先于
              // allImages 到达/媒体后加载——编辑器事务触达节点视图时刷新；allImages 单独变更
              // 不触发编辑器事务=失效方向安全但 UI 陈旧，评审接受面。F-1 复核勘误：PM 更新
              // 钩子规范名=update——updateNodeView 非规范名永不被调，原修复实为 no-op）
              const img = document.createElement('img');
              const resolveInto = (mediaId: unknown): void => {
                const resolved = allImagesRef.current.find((it) => it.id === mediaId)?.url;
                thumb.textContent = '';
                if (resolved) {
                  img.src = resolved;
                  img.alt = '';
                  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
                  thumb.appendChild(img);
                  thumb.style.background = '';
                } else {
                  thumb.style.background = '#555';
                }
              };
              resolveInto(node.attrs.src);

              const label = document.createElement('span');
              label.textContent = 'Image';
              label.style.cssText =
                'flex:1;min-width:0;font-size:12px;font-weight:500;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,0.6);';

              dom.appendChild(thumb);
              dom.appendChild(label);

              return {
                dom,
                // Q-M-1/F-1：attrs/编辑器事务触达节点视图时池重解析（返回 true 复用 dom 不重建；
                // 节点类型漂移=返 false 走 PM 重建档）
                update: (node: NodeViewRendererProps['node']) => {
                  if (node.type.name !== 'image') return false;
                  resolveInto(node.attrs.src);
                  return true;
                },
              };
            },
            commandItems: (query: string) =>
              COMMANDS.filter(
                (cmd) =>
                  cmd.name.toLowerCase().includes(query.toLowerCase()) ||
                  cmd.description.toLowerCase().includes(query.toLowerCase()),
              ).slice(0, 10),
            commandRender: createNativeSuggestionRenderer(onCommandSelect),
            imageMentionItems: (query: string) =>
              allImagesRef.current
                .filter((img) => img.status === 'success' && img.name.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 8),
            imageMentionRender: createImageSuggestionRenderer(),
            imageMentionCommand: ({ editor, range, props }) => {
              // 修正批#1：插入 mediaId（ImageItem.id=服务端 file 身份）非 URL——受控解析在 NodeView
              editor.chain().focus().deleteRange(range).insertContent({
                type: 'image',
                attrs: { src: (props as ImageItem).id },
              }).run();
            },
          }),
          ...(fragment ? [ySyncHostExtension(fragment)] : []),
        ],
        content: '',
        editable: !disabled,
        editorProps: {
          attributes: {
            class: 'prompt-editor outline-none',
            style: `min-height: 80px; max-height: var(--prompt-maxh, 80px); overflow-y: auto; font-size: 14px; line-height: 24px; color: rgb(245, 245, 245);`,
          },
        },
      },
      [fragment],   // fragment 解析态变化（结构错误↔容器在）重建 editor——绑定唯一性
    );

    // ---- 1. Command chip deletion sync ----
    useCommandChipSync(editor, onCommandSelect);

    // ---- 2a. Sync maxHeight/minHeight to CSS + DOM (bypasses Tiptap useEditor staleness) ----
    useEffect(() => {
      if (editor) {
        editor.view.dom.style.setProperty('--prompt-maxh', `${maxHeight}px`);
        editor.view.dom.style.minHeight = `${maxHeight}px`;
      }
    }, [editor, maxHeight]);

    // ---- 2b. Prevent wheel events from bubbling to React Flow canvas ----
    useEffect(() => {
      if (!editor) return;
      const el = editor.view.dom;
      const onWheel = (e: WheelEvent) => { e.stopPropagation(); };
      el.addEventListener('wheel', onWheel);
      return () => el.removeEventListener('wheel', onWheel);
    }, [editor]);

    // ---- 2b. Clipboard paste handler ----
    useEffect(() => {
      if (!editor || !onPasteImage) return;
      const el = editor.view.dom;
      const onPaste = (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (items) {
          for (const item of items) {
            if (item.type.startsWith('image/')) {
              e.preventDefault();
              const file = item.getAsFile();
              if (file && file.type.startsWith('image/')) {
                onPasteImage(file);
              }
              return;
            }
          }
        }
        const html = e.clipboardData?.getData('text/html');
        if (html) {
          const m = html.match(/<img[^>]+src="(data:image\/[^"]+)"/);
          if (m) {
            e.preventDefault();
            fetch(m[1])
              .then((r) => r.blob())
              .then((b) => {
                if (b.type.startsWith('image/')) {
                  onPasteImage(new File([b], `paste-${Date.now()}.png`, { type: b.type }));
                }
              })
              .catch((err) => console.warn('粘贴图片失败', err));
          }
        }
      };
      el.addEventListener('paste', onPaste);
      return () => el.removeEventListener('paste', onPaste);
    }, [editor, onPasteImage]);

    // ---- 3. Ctrl+Enter shortcut ----
    const handleGenerateKeyDown = useCallback(
      (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          onGenerate?.();
        }
      },
      [onGenerate],
    );

    useEffect(() => {
      if (!editor || !onGenerate) return;
      const el = editor.view.dom;
      el.addEventListener('keydown', handleGenerateKeyDown);
      return () => el.removeEventListener('keydown', handleGenerateKeyDown);
    }, [editor, onGenerate, handleGenerateKeyDown]);

    // ---- 4. Expose imperative methods（getHTML 只读导出=fragment 单源派生）----
    const focus = useCallback(() => editor?.commands.focus(), [editor]);

    const clear = useCallback(() => editor?.commands.clearContent(), [editor]);

    const insertImage = useCallback(
      (mediaId: string) => {
        // 修正批#1：src=mediaId（受控 URL 解析在 NodeView——allImages 池）
        editor?.chain().focus().insertContent({
          type: 'image',
          attrs: { src: mediaId },
        }).run();
      },
      [editor],
    );

    const removeImage = useCallback(
      (mediaId: string) => {
        if (!editor) return;
        const positions: { from: number; to: number }[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'image' && node.attrs.src === mediaId) {
            positions.push({ from: pos, to: pos + node.nodeSize });
          }
          return true;
        });
        if (positions.length === 0) return;
        // Delete all in single transaction, back-to-front to preserve positions
        editor.chain().command(({ tr }) => {
          const sorted = positions.sort((a, b) => b.from - a.from);
          sorted.forEach(({ from, to }) => tr.delete(from, to));
          return true;
        }).run();
      },
      [editor],
    );

    const setText = useCallback(
      (text: string) => {
        editor?.commands.setContent(text);
      },
      [editor],
    );

    const getRichText = useCallback(
      () => (fragment ? richTextOfFragment(fragment) : { text: '', html: '', json: [] as unknown[] }),
      [fragment],
    );

    useImperativeHandle(
      ref,
      () => ({ focus, clear, insertImage, removeImage, setText, getRichText }),
      [focus, clear, insertImage, removeImage, setText, getRichText],
    );

    // ---- 5. Destroy on unmount（ySyncPlugin binding.destroy 随 editor 销毁链）----
    useEffect(() => {
      return () => {
        editor?.destroy();
      };
    }, [editor]);

    if (!fragment || !editor) {
      // 只读回退：容器缺失=结构错误（不懒建不掩盖）——读模型 html 静态展示
      return (
        <div
          className="prompt-editor outline-none"
          style={{ minHeight: 80, maxHeight, overflowY: 'auto', fontSize: 14, lineHeight: '24px' }}
          dangerouslySetInnerHTML={{ __html: fallbackHtml }}
        />
      );
    }
    return <EditorContent editor={editor} />;
  },
);

PromptInput.displayName = 'PromptInput';
export default PromptInput;
