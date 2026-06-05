import { memo, useCallback, type DragEvent } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

const NODE_TYPES = [
  { type: 'text', label: '文本输入', icon: '\u{1F4DD}', color: '#4ade80' },
  { type: 'image', label: '图片生成', icon: '\u{1F5BC}', color: '#60a5fa' },
  { type: 'video', label: '视频生成', icon: '\u{1F3AC}', color: '#c084fc' },
  { type: 'audio', label: '音频生成', icon: '\u{1F3B5}', color: '#4ade80' },
  { type: 'multiImage', label: '多图堆叠', icon: '\u{1F5BC}', color: '#f59e0b' },
];

interface NodePaletteProps {
  onToggleShortcuts?: () => void;
}

function NodePaletteComponent({ onToggleShortcuts }: NodePaletteProps) {
  const addNode = useCanvasStore((s) => s.addNode);
  const viewport = useCanvasStore((s) => s.viewport);

  const onDragStart = useCallback((event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const onClickAdd = useCallback(
    (nodeType: string) => {
      // Calculate flow position at screen center based on current viewport
      const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
      const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;
      addNode(nodeType, { x: centerX - 125, y: centerY - 30 });
    },
    [addNode, viewport],
  );

  return (
    <div className="absolute top-1/2 -translate-y-1/2 left-4 z-40 w-28 bg-[#1a1a1a] border border-[#333] rounded-xl p-2.5 flex flex-col gap-1.5 shadow-2xl">
      <div className="flex justify-center">
        <button
          type="button"
          data-sidebar-btn="add-node"
          className="flex items-center justify-center rounded-lg transition-colors h-10 w-10 bg-[#f7f7f7] hover:bg-[#e0e0e0] border-0 cursor-pointer"
          aria-label="添加节点"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            xmlnsXlink="http://www.w3.org/1999/xlink"
            aria-hidden="true"
            role="img"
            className="pointer-events-none"
            width="16"
            height="16"
            viewBox="0 0 17 17"
            style={{ color: '#0f0f0f' }}
          >
            <path
              d="M8.5 0C8.99705 8.57272e-06 9.40039 0.475703 9.40039 1.0625V7.59961H15.9375C16.5243 7.59961 17 8.00294 17 8.5C17 8.99706 16.5243 9.40039 15.9375 9.40039H9.40039V15.9375C9.40039 16.5243 8.99705 17 8.5 17C8.00294 17 7.59961 16.5243 7.59961 15.9375V9.40039H1.0625C0.475698 9.40039 7.60586e-08 8.99706 0 8.5C0 8.00294 0.475698 7.59961 1.0625 7.59961H7.59961V1.0625C7.59961 0.475697 8.00294 2.1727e-08 8.5 0Z"
              fill="currentColor"
            />
          </svg>
        </button>
      </div>
      <div className="text-[10px] font-bold text-[#e2e8f0] mb-0.5 text-center">节点面板</div>
      {NODE_TYPES.map(({ type, label, icon, color }) => (
        <div
          key={type}
          draggable
          onDragStart={(e) => onDragStart(e, type)}
          onClick={() => onClickAdd(type)}
          className="bg-[#252525] border rounded-lg p-2 text-center cursor-grab active:cursor-grabbing hover:border-[#888] transition-colors"
          style={{ borderColor: color }}
        >
          <div className="text-base mb-0.5">{icon}</div>
          <div className="text-[10px] text-[#ccc]">{label}</div>
        </div>
      ))}
      <div className="border-t border-[#333] mx-0.5" />
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleShortcuts?.();
        }}
        className="bg-[#252525] border rounded-lg p-2 text-center cursor-pointer hover:border-[#888] transition-colors"
        style={{ borderColor: '#09CAF5' }}
      >
        <div className="text-base mb-0.5">{'⌨️'}</div>
        <div className="text-[10px] text-[#09CAF5] font-bold">快捷键</div>
      </div>
      <div className="mt-auto text-[9px] text-[#666] text-center pt-1">
        点击或拖拽到画布
      </div>
    </div>
  );
}

export const NodePalette = memo(NodePaletteComponent);
