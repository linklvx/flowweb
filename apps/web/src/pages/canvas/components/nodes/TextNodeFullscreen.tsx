import { memo, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import '@tiptap/starter-kit';

interface Props {
  editor: Editor | null;
  open: boolean;
  onClose: () => void;
}

function TextNodeFullscreenComponent({ editor, open, onClose }: Props) {
  // Force re-render for active states
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor || !open) return;
    const update = () => setTick((t) => t + 1);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor, open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const exec = useCallback(
    (command: (editor: Editor) => void) => {
      if (editor) command(editor);
    },
    [editor],
  );

  const isActive = useCallback(
    (type: string, opts?: Record<string, unknown>) =>
      editor?.isActive(type, opts) ?? false,
    [editor],
  );

  const handleH1 = useCallback(() => exec((e) => e.chain().focus().toggleHeading({ level: 1 }).run()), [exec]);
  const handleH2 = useCallback(() => exec((e) => e.chain().focus().toggleHeading({ level: 2 }).run()), [exec]);
  const handleH3 = useCallback(() => exec((e) => e.chain().focus().toggleHeading({ level: 3 }).run()), [exec]);
  const handleParagraph = useCallback(() => exec((e) => e.chain().focus().setParagraph().run()), [exec]);
  const handleBold = useCallback(() => exec((e) => e.chain().focus().toggleBold().run()), [exec]);
  const handleItalic = useCallback(() => exec((e) => e.chain().focus().toggleItalic().run()), [exec]);
  const handleUl = useCallback(() => exec((e) => e.chain().focus().toggleBulletList().run()), [exec]);
  const handleOl = useCallback(() => exec((e) => e.chain().focus().toggleOrderedList().run()), [exec]);
  const handleHr = useCallback(() => exec((e) => e.chain().focus().setHorizontalRule().run()), [exec]);

  const handleCopy = useCallback(async () => {
    if (!editor) return;
    const html = editor.getHTML();
    const text = editor.getText();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
  }, [editor]);

  if (!open) return null;

  const btnBase =
    'flex items-center justify-center cursor-pointer focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed text-[#d4d4d4] hover:bg-white/10 rounded-md aspect-square h-7 w-7 p-0 border-none bg-transparent transition-colors';

  const btnActive = (active: boolean) =>
    `${btnBase} ${active ? 'bg-white/20' : ''}`;

  return createPortal(
    <div
      role="dialog"
      aria-label="全屏编辑"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl xl:max-w-4xl 2xl:max-w-5xl h-[calc(100vh-100px)] flex flex-col gap-0 rounded-xl overflow-hidden border-2 border-[#3F3F46] bg-[#272729] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Top toolbar */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-white/[0.08] shrink-0">
          {/* Left: Copy */}
          <button aria-label="复制" className={btnBase} onClick={handleCopy} title="复制">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z" />
              <path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" />
            </svg>
          </button>

          {/* Center: formatting */}
          <div className="flex-1 flex items-center justify-center gap-0.5">
            <div className="flex items-center bg-white/5 rounded-md p-0.5 gap-0.5">
              <button aria-label="标题 1" className={btnActive(isActive('heading', { level: 1 }))} onClick={handleH1} title="标题 1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 18v-8l-2 2" /><path d="M4 6v12" /><path d="M12 6v12" /><path d="M11 18h2" /><path d="M3 18h2" /><path d="M4 12h8" /><path d="M3 6h2" /><path d="M11 6h2" />
                </svg>
              </button>
              <button aria-label="标题 2" className={btnActive(isActive('heading', { level: 2 }))} onClick={handleH2} title="标题 2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 12a2 2 0 1 1 4 0c0 .591 -.417 1.318 -.816 1.858l-3.184 4.143l4 0" /><path d="M4 6v12" /><path d="M12 6v12" /><path d="M11 18h2" /><path d="M3 18h2" /><path d="M4 12h8" /><path d="M3 6h2" /><path d="M11 6h2" />
                </svg>
              </button>
              <button aria-label="标题 3" className={btnActive(isActive('heading', { level: 3 }))} onClick={handleH3} title="标题 3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 14a2 2 0 1 0 -2 -2" /><path d="M17 16a2 2 0 1 0 2 -2" /><path d="M4 6v12" /><path d="M12 6v12" /><path d="M11 18h2" /><path d="M3 18h2" /><path d="M4 12h8" /><path d="M3 6h2" /><path d="M11 6h2" />
                </svg>
              </button>
              <button aria-label="正文" className={btnActive(isActive('paragraph'))} onClick={handleParagraph} title="正文">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 4v16" /><path d="M17 4v16" /><path d="M19 4h-9.5a4.5 4.5 0 0 0 0 9h3.5" />
                </svg>
              </button>
            </div>

            <div className="w-px h-5 bg-white/10 mx-1" />

            <div className="flex items-center gap-0.5">
              <button aria-label="加粗" className={btnActive(isActive('bold'))} onClick={handleBold} title="加粗">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 5h6a3.5 3.5 0 0 1 0 7h-6z" /><path d="M13 12h1a3.5 3.5 0 0 1 0 7h-7v-7" />
                </svg>
              </button>
              <button aria-label="斜体" className={btnActive(isActive('italic'))} onClick={handleItalic} title="斜体">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5l6 0" /><path d="M7 19l6 0" /><path d="M14 5l-4 14" />
                </svg>
              </button>
            </div>

            <div className="w-px h-5 bg-white/10 mx-1" />

            <div className="flex items-center bg-white/5 rounded-md p-0.5 gap-0.5">
              <button aria-label="无序列表" className={btnActive(isActive('bulletList'))} onClick={handleUl} title="无序列表">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l11 0" /><path d="M9 12l11 0" /><path d="M9 18l11 0" /><path d="M5 6l0 .01" /><path d="M5 12l0 .01" /><path d="M5 18l0 .01" />
                </svg>
              </button>
              <button aria-label="有序列表" className={btnActive(isActive('orderedList'))} onClick={handleOl} title="有序列表">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 6h9" /><path d="M11 12h9" /><path d="M12 18h8" /><path d="M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4" /><path d="M6 10v-6l-2 2" />
                </svg>
              </button>
            </div>

            <div className="w-px h-5 bg-white/10 mx-1" />

            <button aria-label="分割线" className={btnBase} onClick={handleHr} title="分割线">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l14 0" />
              </svg>
            </button>
          </div>

          {/* Right: Close */}
          <button aria-label="关闭" className={btnBase} onClick={onClose} title="关闭">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6l-12 12" /><path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Editor content */}
        <div className="flex-1 overflow-y-auto editor-scroll">
          <div className="w-full h-full px-4 py-2">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const TextNodeFullscreen = memo(TextNodeFullscreenComponent);
