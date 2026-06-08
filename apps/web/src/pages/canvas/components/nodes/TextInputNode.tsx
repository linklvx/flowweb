import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { NodeResizeControl, useReactFlow, type NodeProps } from '@xyflow/react';
import { NodeHandle } from './NodeHandle';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useNodeStore, isTextNode } from '@/stores/nodeStore';
import { TextConfigPanel } from './TextConfigPanel';
import { TextNodeToolbar } from './TextNodeToolbar';
import { TextNodeFullscreen } from './TextNodeFullscreen';

function TextInputNodeComponent({ id, selected }: NodeProps) {
  // ========== Resize config & state ==========

  type CornerType = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | null;

  const RESIZE_CONFIG = {
    minWidth: 300,
    minHeight: 300,
    maxWidth: 2000,
    maxHeight: 1500,
    hitAreaSize: 24,
    visualHandleSize: 14,
    handleOffset: -7,
    handleColor: '#9CA3AF',
  } as const;

  const [activeCorner, setActiveCorner] = useState<CornerType>(null);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const updateText = useNodeStore((s) => s.updateText);
  const appNode = useNodeStore((s) => s.nodes[id]);
  const content = (appNode && isTextNode(appNode)) ? (appNode.data.content ?? '') : '';

  const { getNodes, zoom } = useReactFlow();
  const nodeWidth = appNode?.width ?? 300;
  const nodeHeight = appNode?.height ?? 300;
  const isSingleSelected = selected && getNodes().filter((n) => n.selected).length === 1;

  // Calculate which corner the mouse is near
  const calculateActiveCorner = useCallback((e: React.MouseEvent): CornerType => {
    if (!containerRef.current || !isSingleSelected) return null;

    // 必须使用 React Flow 的节点包装器（.react-flow__node）来计算坐标，
    // 因为它应用了 transform: translate(x, y) 定位节点。
    // 内部 canvas-node div 的 getBoundingClientRect 可能因 DOM 结构偏移而不准确。
    const rect = containerRef.current.getBoundingClientRect();
    // zoom from useReactFlow() may be 0/undefined before store init; default to 1
    const hitSize = RESIZE_CONFIG.hitAreaSize / (zoom || 1);
    const { clientX, clientY } = e;

    // top-left
    if (clientX >= rect.left && clientX <= rect.left + hitSize &&
        clientY >= rect.top && clientY <= rect.top + hitSize) {
      return 'top-left';
    }
    // top-right
    if (clientX >= rect.right - hitSize && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.top + hitSize) {
      return 'top-right';
    }
    // bottom-left
    if (clientX >= rect.left && clientX <= rect.left + hitSize &&
        clientY >= rect.bottom - hitSize && clientY <= rect.bottom) {
      return 'bottom-left';
    }
    // bottom-right
    if (clientX >= rect.right - hitSize && clientX <= rect.right &&
        clientY >= rect.bottom - hitSize && clientY <= rect.bottom) {
      return 'bottom-right';
    }

    return null;
  }, [isSingleSelected, zoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isResizing) return;
    const corner = calculateActiveCorner(e);
    setActiveCorner((prev) => (prev !== corner ? corner : prev));
  }, [calculateActiveCorner, isResizing]);

  const handleMouseLeave = useCallback(() => {
    if (!isResizing) setActiveCorner(null);
  }, [isResizing]);

  // 兜底：处理 handleMouseLeave 覆盖不到的极端情况。
  // 例如 blur handler dispatch mouseup → isResizing 变 false，但鼠标仍在角上。
  // 正常路径由 handleMouseLeave 清理，此 effect 保证 resize 结束后必然清除。
  useEffect(() => {
    if (!isResizing) setActiveCorner(null);
  }, [isResizing]);

  // Window blur → cancel resize
  useEffect(() => {
    const handleBlur = () => {
      if (isResizing) {
        document.dispatchEvent(new MouseEvent('mouseup'));
        setTimeout(() => setActiveCorner(null), 0);
      }
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [isResizing]);

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

  // Editable title (same pattern as ImageGenNode)
  const [label, setLabel] = useState('Text');
  const [draft, setDraft] = useState(label);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(label);

  const saveTitle = useCallback(() => {
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

  const titleText = label || 'Text';

  // Generate offset style for the NodeResizeControl wrapper (transparent hit area)
  const getControlStyle = (): React.CSSProperties => {
    const size = RESIZE_CONFIG.hitAreaSize;
    return {
      width: size,
      height: size,
      background: 'transparent',
      border: 'none',
      zIndex: 9999,
      opacity: 1,
    };
  };

  // Generate inline style for the visual handle inside NodeResizeControl
  const getHandleStyle = (): React.CSSProperties => {
    const size = RESIZE_CONFIG.visualHandleSize;
    // Center the visual handle within the 24px hit area
    const centerOffset = (RESIZE_CONFIG.hitAreaSize - size) / 2;

    return {
      position: 'absolute',
      width: size,
      height: size,
      top: centerOffset,
      left: centerOffset,
      borderRadius: '50%',
      backgroundColor: 'white',
      border: `2px solid ${RESIZE_CONFIG.handleColor}`,
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      transition: 'opacity 0.15s ease-out',
      pointerEvents: 'none',
    };
  };

  return (
    <div
      ref={containerRef}
      className="relative canvas-node"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
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

      {/* Title bar */}
      <div
        className="absolute z-[1] pointer-events-auto -translate-y-full left-1 -top-0 pb-2 overflow-hidden whitespace-nowrap flex items-center gap-1 text-[#999]"
        style={{ width: nodeWidth, lineHeight: '18px' }}
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
            {(draft || titleText) + ' '}
          </span>
          <input
            ref={titleInputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              draftRef.current = e.target.value;
            }}
            onFocus={startEdit}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') titleInputRef.current?.blur();
              if (e.key === 'Escape') {
                setDraft(label);
                draftRef.current = label;
                titleInputRef.current?.blur();
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

      {/* Target handle — outside overflow-hidden */}
      <NodeHandle type="target" testId="target-handle" />

      {/* Custom resize handle — rendered outside overflow-hidden, only when a corner is active */}
      {isSingleSelected && activeCorner && (
        <NodeResizeControl
          nodeId={id}
          position={activeCorner}
          minWidth={RESIZE_CONFIG.minWidth}
          minHeight={RESIZE_CONFIG.minHeight}
          maxWidth={RESIZE_CONFIG.maxWidth}
          maxHeight={RESIZE_CONFIG.maxHeight}
          keepAspectRatio={false}
          onResizeStart={() => setIsResizing(true)}
          onResizeEnd={() => setIsResizing(false)}
          style={getControlStyle()}
        >
          <div data-testid="resize-handle" style={getHandleStyle()} />
        </NodeResizeControl>
      )}

      {/* Card body */}
      <div
        className="relative z-0 bg-[#222222] rounded-lg transition-colors overflow-hidden"
        style={{ width: nodeWidth, height: nodeHeight, isolation: 'isolate' }}
      >
        <div className="absolute inset-0 py-3 pl-3 pr-[3px] rounded-lg transition-colors flex flex-col overflow-hidden" style={{ backgroundColor: bgColor || undefined }}>
          {/* Tiptap EditorContent — hidden when fullscreen is open */}
          {!fullscreen && (
            <div
              className="w-full overflow-y-auto rounded-md transition-colors editor-scroll nowheel flex-1 min-h-0"
              style={{ backgroundColor: bgColor || 'transparent' }}
            >
              <EditorContent editor={editor} />
            </div>
          )}
        </div>
        {/* Border overlay — above all content including resize handles */}
        <div
          data-testid="border-overlay"
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{
            zIndex: 5,
            border: selected ? '3px solid #9CA3AF' : '1px solid #3F3F46',
          }}
        />
      </div>

      {/* Source handle — outside card body to avoid overflow clipping */}
      <NodeHandle type="source" testId="source-handle" />

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
