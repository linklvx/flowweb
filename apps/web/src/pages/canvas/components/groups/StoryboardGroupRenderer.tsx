// StoryboardGroupRenderer.tsx — 完整重写（替换 Task 5 占位）
import { memo, useState, useEffect } from 'react';
import type { GroupNodeData } from '@/types/group';
import { StoryboardCell, type CellNodeInfo } from './StoryboardCell';
import { useCanvasStore } from '@/stores/canvasStore';
import { resolveStoryboardConfig } from '@/utils/storyboardConfig';

interface Props { id: string; data: GroupNodeData; cellNodes: CellNodeInfo[] }

function StoryboardGroupRendererComponent({ id, data, cellNodes }: Props) {
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const removeStoryboardCell = useCanvasStore((s) => s.removeStoryboardCell);
  const cfg = resolveStoryboardConfig(data);
  const total = cfg.gridRows * cfg.gridCols;
  const byId = new Map(cellNodes.map((c) => [c.id, c]));

  // Delete key handler for cell deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 编辑态守卫：焦点在输入元素时不拦截（对齐 T16 编辑态定义）
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]')) return;

      if (selectedCell !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        e.stopPropagation();
        removeStoryboardCell(id, selectedCell);
        setSelectedCell(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true); // capture 阶段拦截
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [selectedCell, id, removeStoryboardCell]);

  return (
    <div style={{
      // absolute inset:0 覆盖整个节点盒——RF .react-flow__node-group 自带 padding:10px，
      // 静态 100% 尺寸会相对 padding 后的内容盒布局导致格子溢出节点边界
      position: 'absolute', inset: 0,
      border: '1px solid var(--canvas-controls-border)', borderRadius: 8,
      background: 'var(--canvas-controls-bg)',
      display: 'grid',
      gridTemplateColumns: `repeat(${cfg.gridCols}, 1fr)`,
      gridTemplateRows: `repeat(${cfg.gridRows}, 1fr)`,
      gap: 3,
      padding: 5,
    }}>
      {Array.from({ length: total }, (_, i) => {
        const nodeId = data.cells?.[i];
        const info = nodeId ? byId.get(nodeId) : undefined;
        return (
          <StoryboardCell key={i} index={i}
            info={info} showIndex={cfg.showIndex}
            selectedCell={selectedCell} onSelectCell={setSelectedCell}
            onFillEmpty={(idx) => window.dispatchEvent(new CustomEvent('storyboard:fill-cell', { detail: { groupId: id, index: idx } }))} />
        );
      })}
      <div style={{ position: 'absolute', top: 0, right: 0, transform: 'translateY(-100%)', color: '#999', fontSize: 12, padding: '0 2px', whiteSpace: 'nowrap' }}>
        {data.name ?? '分镜组'}
      </div>
    </div>
  );
}
export const StoryboardGroupRenderer = memo(StoryboardGroupRendererComponent);
