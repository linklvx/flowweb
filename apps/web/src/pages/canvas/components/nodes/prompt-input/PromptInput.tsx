import React, {
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  createElement,
} from 'react';
import './PromptInput.css';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { createRoot } from 'react-dom/client';
import { CommandMentionList } from './CommandMentionList';
import { ImageMentionList } from './ImageMentionList';
import { COMMANDS, CATEGORY_DEFAULTS } from './types';
import type { PromptValue, CommandItem, ImageItem } from './types';

export interface PromptInputRef {
  forceSync: () => void;
  focus: () => void;
  clear: () => void;
  insertImage: (src: string) => void;
}

interface PromptInputProps {
  nodeId: string;
  value: PromptValue;
  onChange: (value: PromptValue) => void;
  onCommandSelect: (command: CommandItem) => void;
  onGenerate?: () => void;

  // Phase 3
  allImages?: ImageItem[];
  onPasteImage?: (file: File) => void;

  placeholder?: string;
  disabled?: boolean;
  maxHeight?: number;
  debounceMs?: number;
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
  onCommandSelect: (command: CommandItem) => void,
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
            onSelect: (item: CommandItem) => props.command(item),
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
              onSelect: (item: CommandItem) => props.command(item),
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
        onCommandSelect(props);
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
  onCommandSelect: (command: CommandItem) => void,
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
          onCommandSelect({ category, value: defaultValue } as CommandItem);
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
      nodeId: _nodeId,
      value,
      onChange,
      onCommandSelect,
      onGenerate,
      allImages = [],
      onPasteImage,
      placeholder = '描述你想要的画面，输入 / 添加设置...',
      disabled = false,
      maxHeight = 120,
      debounceMs = 300,
    },
    ref,
  ) => {
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();

    // Track latest value for imperative methods (avoids stale-closure on onChange)
    const valueRef = useRef(value);
    valueRef.current = value;

    // ---- 1. Tiptap Editor Setup ----
    const editor = useEditor({
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
        Placeholder.configure({ placeholder }),
        // Custom inline image chip (NodeView replaces block <img>)
        Image.extend({
          inline: true,
          group: 'inline',
          addNodeView() {
            return ({ node }: { node: { attrs: { src: string } } }) => {
              const dom = document.createElement('span');
              dom.className = 'image-chip';
              dom.setAttribute('contenteditable', 'false');
              dom.style.cssText =
                'display:inline-flex;align-items:center;gap:4px;height:20px;min-width:24px;max-width:120px;padding:1px 4px;border-radius:4px;background:#333;vertical-align:middle;white-space:normal;cursor:default;user-select:none;';

              const thumb = document.createElement('span');
              thumb.style.cssText =
                'width:14px;height:14px;border-radius:3px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 8px rgba(0,0,0,0.16),0 0.5px 0 0 inset rgba(255,255,255,0.16);';

              const img = document.createElement('img');
              img.src = node.attrs.src;
              img.alt = '';
              img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
              thumb.appendChild(img);

              const label = document.createElement('span');
              label.textContent = 'Image';
              label.style.cssText =
                'flex:1;min-width:0;font-size:12px;font-weight:500;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,0.6);';

              dom.appendChild(thumb);
              dom.appendChild(label);

              return { dom };
            };
          },
        }),
        Mention.extend({ name: 'command' }).configure({
          HTMLAttributes: {
            class: 'command-chip',
          },
          suggestion: {
            char: '/',
            allowSpaces: true,
            items: ({ query }: { query: string }) => {
              return COMMANDS.filter(
                (cmd) =>
                  cmd.name.toLowerCase().includes(query.toLowerCase()) ||
                  cmd.description.toLowerCase().includes(query.toLowerCase()),
              ).slice(0, 10);
            },
            render: createNativeSuggestionRenderer(onCommandSelect),
          },
        }),
        // @mention — inline image insertion from allImages pool
        Mention.extend({ name: 'imageMention' }).configure({
          HTMLAttributes: { class: 'hidden' },
          suggestion: {
            char: '@',
            items: ({ query }: { query: string }) => {
              return allImages
                .filter((img) => img.status === 'success' && img.name.toLowerCase().includes(query.toLowerCase()))
                .slice(0, 8);
            },
            render: createImageSuggestionRenderer(),
            command: ({ editor, range, props }) => {
              editor.chain().focus().deleteRange(range).insertContent({
                type: 'image',
                attrs: { src: (props as ImageItem).url },
              }).run();
            },
          },
        }),
      ],
      content: value.text,
      editable: !disabled,
      editorProps: {
        attributes: {
          class: 'prompt-editor outline-none',
          style: `max-height: ${maxHeight}px; overflow-y: auto;`,
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          onChange({ ...valueRef.current, text: ed.getText() });
        }, debounceMs);
      },
    });

    // ---- 2. Command chip deletion sync ----
    useCommandChipSync(editor, onCommandSelect);

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

    // ---- 4. Expose imperative methods ----
    const forceSync = useCallback(() => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (editor) {
        onChange({ ...valueRef.current, text: editor.getText() });
      }
    }, [editor, onChange]);

    const focus = useCallback(() => editor?.commands.focus(), [editor]);

    const clear = useCallback(() => editor?.commands.clearContent(), [editor]);

    const insertImage = useCallback(
      (src: string) => {
        editor?.chain().focus().insertContent({
          type: 'image',
          attrs: { src },
        }).run();
      },
      [editor],
    );

    useImperativeHandle(
      ref,
      () => ({ forceSync, focus, clear, insertImage }),
      [forceSync, focus, clear, insertImage],
    );

    // ---- 5. Cleanup editor on unmount ----
    useEffect(() => {
      return () => {
        editor?.destroy();
      };
    }, [editor]);

    return <EditorContent editor={editor} />;
  },
);

PromptInput.displayName = 'PromptInput';
export default PromptInput;
