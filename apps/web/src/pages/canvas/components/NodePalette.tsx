import { memo, useCallback, type DragEvent } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

const NODE_TYPES = [
  { type: 'text', label: '文本输入', icon: '\u{1F4DD}', color: '#4ade80' },
  { type: 'image', label: '图片生成', icon: '\u{1F5BC}', color: '#60a5fa' },
  { type: 'video', label: '视频生成', icon: '\u{1F3AC}', color: '#c084fc' },
  { type: 'audio', label: '音频生成', icon: '\u{1F3B5}', color: '#4ade80' },
  { type: 'multiImage', label: '多图堆叠', icon: '\u{1F5BC}', color: '#f59e0b' },
];

function NodePaletteComponent() {
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
      <div className="mt-auto text-[9px] text-[#666] text-center pt-1">
        点击或拖拽到画布
      </div>
    </div>
  );
}

export const NodePalette = memo(NodePaletteComponent);
