import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useNodeStore } from '@/stores/nodeStore';
import { TextConfigPanel } from './TextConfigPanel';
import { TextNodeToolbar } from './TextNodeToolbar';
import { TextNodeFullscreen } from './TextNodeFullscreen';

function TextInputNodeComponent({ id, selected }: NodeProps) {
  const updateText = useNodeStore((s) => s.updateText);
  const nodeData = useNodeStore((s) => s.nodes[id]) as { type: 'text'; content: string } | undefined;
  const content = nodeData?.content ?? '';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
    ],
    content: content,
    editorProps: {
      attributes: {
        class: 'nodrag tiptap-content focus:outline-none w-full max-w-full box-border',
      },
    },
    onUpdate: ({ editor }) => {
      updateText(id, editor.getHTML());
    },
  });

  // Destroy editor on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  // Background color for editor area
  const [bgColor, setBgColor] = useState<string | null>(null);

  // Fullscreen state
  const [fullscreen, setFullscreen] = useState(false);

  // Title editing (unchanged from markdown version)
  const [label, setLabel] = useState('文本输入');
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(label);

  const save = useCallback(() => {
    const trimmed = draftRef.current.trim();
    if (trimmed) setLabel(trimmed);
    else {
      setDraft(label);
      draftRef.current = label;
    }
  }, [label]);

  const startEdit = useCallback(() => {
    setDraft(label);
    draftRef.current = label;
  }, [label]);

  const titleText = label || '文本输入';

  return (
    <div className="relative">
      {/* Toolbar — above title bar, shown when selected */}
      {selected && (
        <div className="absolute left-1/2 -translate-x-1/2 z-10" style={{ top: -80 }}>
          <TextNodeToolbar
            nodeId={id}
            editor={editor}
            onBgColorChange={setBgColor}
            currentBgColor={bgColor}
            onFullscreen={() => setFullscreen(true)}
          />
        </div>
      )}

      {/* Title bar — below toolbar, above card body */}
      <div
        className="absolute z-[1] pointer-events-auto -translate-y-full left-1 -top-0 pb-2 w-[360px] overflow-hidden whitespace-nowrap flex items-center gap-1 text-[#999]"
        style={{ lineHeight: '18px' }}
      >
        <span className="shrink-0 flex items-center" style={{ width: 12, height: 12 }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9.719 10.256a.583.583 0 0 1 0 1.166H2.041a.583.583 0 0 1 0-1.166h7.678ZM7.8 6.417a.583.583 0 0 1 0 1.166H2.041a.583.583 0 0 1 0-1.166H7.8ZM11.958 2.578a.583.583 0 0 1 0 1.167H2.041a.583.583 0 0 1 0-1.167h9.917Z" fill="currentColor" />
          </svg>
        </span>
        <div className="relative min-w-0 max-w-full w-max shrink">
          <span
            className="invisible whitespace-pre inline-block pointer-events-none select-none align-top"
            aria-hidden="true"
            style={{ fontSize: 12, lineHeight: '18px' }}
          >
            {titleText}
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              draftRef.current = e.target.value;
            }}
            onFocus={startEdit}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') inputRef.current?.blur();
              if (e.key === 'Escape') {
                setDraft(label);
                draftRef.current = label;
                inputRef.current?.blur();
              }
            }}
            placeholder="请输入标题"
            className="nodrag absolute inset-0 box-border w-full p-0 h-auto bg-transparent text-inherit border-none outline-none"
            style={{ fontSize: 12, lineHeight: '18px', minWidth: 0 }}
            aria-label="节点标题"
            maxLength={20}
          />
        </div>
      </div>

      {/* Card body */}
      <div
        className={`bg-[#222222] border rounded-lg w-[360px] transition-colors ${
          selected ? 'border-white/40' : 'border-[#3a3a3a]'
        }`}
      >
        <Handle type="target" position={Position.Left} className="!bg-[#555] !border-0 !w-2 !h-2" />
        <div className="p-3">
          {/* Tiptap EditorContent — hidden when fullscreen is open */}
          {!fullscreen && (
            <div className="w-full h-[186px] overflow-y-auto rounded-md transition-colors editor-scroll nowheel" style={{ backgroundColor: bgColor || 'transparent' }}>
              <EditorContent editor={editor} />
            </div>
          )}
        </div>
        <Handle type="source" position={Position.Right} className="!bg-[#555] !border-0 !w-2 !h-2" />
      </div>

      {selected && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <TextConfigPanel nodeId={id} />
        </div>
      )}

      {/* Fullscreen dialog */}
      <TextNodeFullscreen
        editor={editor}
        open={fullscreen}
        onClose={() => setFullscreen(false)}
      />
    </div>
  );
}

export const TextInputNode = memo(TextInputNodeComponent);
