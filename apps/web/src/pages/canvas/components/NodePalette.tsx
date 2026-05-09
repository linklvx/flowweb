import { memo, useCallback, type DragEvent } from 'react';

const NODE_TYPES = [
  { type: 'text', label: '文本输入', icon: '\u{1F4DD}', color: '#4ade80' },
  { type: 'image', label: '图片生成', icon: '\u{1F5BC}', color: '#60a5fa' },
  { type: 'video', label: '视频生成', icon: '\u{1F3AC}', color: '#c084fc' },
];

function NodePaletteComponent() {
  const onDragStart = useCallback((event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  return (
    <div className="w-40 bg-[#1a1a1a] border-r border-[#333] p-3 flex flex-col gap-2 flex-shrink-0">
      <div className="text-xs font-bold text-[#e2e8f0] mb-1">节点面板</div>
      {NODE_TYPES.map(({ type, label, icon, color }) => (
        <div
          key={type}
          draggable
          onDragStart={(e) => onDragStart(e, type)}
          className="bg-[#252525] border rounded-lg p-3 text-center cursor-grab active:cursor-grabbing hover:border-[#888] transition-colors"
          style={{ borderColor: color }}
        >
          <div className="text-lg mb-1">{icon}</div>
          <div className="text-[10px] text-[#ccc]">{label}</div>
        </div>
      ))}
      <div className="mt-auto text-[9px] text-[#666] text-center pt-2">
        拖拽节点到画布
      </div>
    </div>
  );
}

export const NodePalette = memo(NodePaletteComponent);
