import { memo, useCallback } from 'react';
import { useViewport } from '@xyflow/react';
import type { Editor } from '@tiptap/react';

interface Props {
  nodeId: string;
  editor: Editor | null;
}

function TextNodeToolbarComponent({ nodeId, editor }: Props) {
  const { zoom } = useViewport();

  // Safe execution: guard against null editor (useEditor returns null on first render)
  const exec = useCallback(
    (command: (editor: Editor) => void) => {
      if (editor) command(editor);
    },
    [editor],
  );

  // Active state helper
  const isActive = useCallback(
    (type: string, opts?: Record<string, unknown>) =>
      editor?.isActive(type, opts) ?? false,
    [editor],
  );

  // Heading buttons
  const handleH1 = useCallback(() => exec((e) => e.chain().focus().toggleHeading({ level: 1 }).run()), [exec]);
  const handleH2 = useCallback(() => exec((e) => e.chain().focus().toggleHeading({ level: 2 }).run()), [exec]);
  const handleH3 = useCallback(() => exec((e) => e.chain().focus().toggleHeading({ level: 3 }).run()), [exec]);
  const handleParagraph = useCallback(() => exec((e) => e.chain().focus().setParagraph().run()), [exec]);

  // Inline formatting
  const handleBold = useCallback(() => exec((e) => e.chain().focus().toggleBold().run()), [exec]);
  const handleItalic = useCallback(() => exec((e) => e.chain().focus().toggleItalic().run()), [exec]);

  // Lists and divider
  const handleUl = useCallback(() => exec((e) => e.chain().focus().toggleBulletList().run()), [exec]);
  const handleOl = useCallback(() => exec((e) => e.chain().focus().toggleOrderedList().run()), [exec]);
  const handleHr = useCallback(() => exec((e) => e.chain().focus().setHorizontalRule().run()), [exec]);

  // Copy: rich text clipboard (HTML + plain text)
  const handleCopy = useCallback(async () => {
    if (!editor) return;
    const text = editor.getText();
    const html = editor.getHTML();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
    } catch {
      // Fallback: plain text only
      await navigator.clipboard.writeText(text);
    }
  }, [editor]);

  // Fullscreen
  const handleFullscreen = useCallback(() => {
    window.dispatchEvent(new CustomEvent('node:fullscreen', { detail: { nodeId } }));
  }, [nodeId]);

  // Button base class + active state
  const btnClass = (active = false) =>
    `flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 transition-colors cursor-pointer border-none bg-transparent text-white/70 ${
      active ? 'bg-white/20' : ''
    }`;

  return (
    <div
      className="nodrag pointer-events-auto flex items-center gap-[2px] px-1 py-1 rounded-full bg-[#222]/80 backdrop-blur-lg border border-white/10 text-white/90"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'bottom center',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Group 1: Headings */}
      <div className="flex items-center gap-[2px]">
        <button onClick={handleH1} aria-label="H1" className={btnClass(isActive('heading', { level: 1 }))} title="标题1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 18v-8l-2 2" /><path d="M4 6v12" /><path d="M12 6v12" /><path d="M11 18h2" /><path d="M3 18h2" /><path d="M4 12h8" /><path d="M3 6h2" /><path d="M11 6h2" />
          </svg>
        </button>
        <button onClick={handleH2} aria-label="H2" className={btnClass(isActive('heading', { level: 2 }))} title="标题2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 12a2 2 0 1 1 4 0c0 .591 -.417 1.318 -.816 1.858l-3.184 4.143l4 0" /><path d="M4 6v12" /><path d="M12 6v12" /><path d="M11 18h2" /><path d="M3 18h2" /><path d="M4 12h8" /><path d="M3 6h2" /><path d="M11 6h2" />
          </svg>
        </button>
        <button onClick={handleH3} aria-label="H3" className={btnClass(isActive('heading', { level: 3 }))} title="标题3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 14a2 2 0 1 0 -2 -2" /><path d="M17 16a2 2 0 1 0 2 -2" /><path d="M4 6v12" /><path d="M12 6v12" /><path d="M11 18h2" /><path d="M3 18h2" /><path d="M4 12h8" /><path d="M3 6h2" /><path d="M11 6h2" />
          </svg>
        </button>
        <button onClick={handleParagraph} aria-label="正文" className={btnClass(isActive('paragraph'))} title="正文">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 4v16" /><path d="M17 4v16" /><path d="M19 4h-9.5a4.5 4.5 0 0 0 0 9h3.5" />
          </svg>
        </button>
      </div>

      <div className="w-px h-[18px] bg-white/10" />

      {/* Group 2: Bold & Italic */}
      <div className="flex items-center gap-[2px]">
        <button onClick={handleBold} aria-label="加粗" className={btnClass(isActive('bold'))} title="加粗">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 5h6a3.5 3.5 0 0 1 0 7h-6z" /><path d="M13 12h1a3.5 3.5 0 0 1 0 7h-7v-7" />
          </svg>
        </button>
        <button onClick={handleItalic} aria-label="斜体" className={btnClass(isActive('italic'))} title="斜体">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5l6 0" /><path d="M7 19l6 0" /><path d="M14 5l-4 14" />
          </svg>
        </button>
      </div>

      <div className="w-px h-[18px] bg-white/10" />

      {/* Group 3: Lists & Divider */}
      <div className="flex items-center gap-[2px]">
        <button onClick={handleUl} aria-label="无序列表" className={btnClass(isActive('bulletList'))} title="无序列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l11 0" /><path d="M9 12l11 0" /><path d="M9 18l11 0" /><path d="M5 6l0 .01" /><path d="M5 12l0 .01" /><path d="M5 18l0 .01" />
          </svg>
        </button>
        <button onClick={handleOl} aria-label="有序列表" className={btnClass(isActive('orderedList'))} title="有序列表">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 6h9" /><path d="M11 12h9" /><path d="M12 18h8" /><path d="M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4" /><path d="M6 10v-6l-2 2" />
          </svg>
        </button>
        <button onClick={handleHr} aria-label="分割线" className={btnClass()} title="分割线">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l14 0" />
          </svg>
        </button>
      </div>

      <div className="w-px h-[18px] bg-white/10" />

      {/* Group 4: Copy & Fullscreen */}
      <div className="flex items-center gap-[2px]">
        <button onClick={handleCopy} aria-label="复制全部" className={btnClass()} title="复制全部">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z" />
            <path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" />
          </svg>
        </button>
        <button onClick={handleFullscreen} aria-label="全屏" className={btnClass()} title="全屏">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export const TextNodeToolbar = memo(TextNodeToolbarComponent);
