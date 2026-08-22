// StoryboardGroupRenderer.tsx — 完整重写（替换 Task 5 占位）
import { memo, useState } from 'react';
import { calcStoryboardSize } from '@/utils/groupLayout';
import type { GroupNodeData } from '@/types/group';
import { StoryboardCell, type CellNodeInfo } from './StoryboardCell';

interface Props { id: string; data: GroupNodeData; selected: boolean; cellNodes: CellNodeInfo[] }

function StoryboardGroupRendererComponent({ id, data, selected, cellNodes }: Props) {
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const cfg = data.storyboard!;
  const { cellWidth, cellHeight } = calcStoryboardSize(cfg.gridRows, cfg.gridCols, cfg.aspectRatio);
  const total = cfg.gridRows * cfg.gridCols;
  const byId = new Map(cellNodes.map((c) => [c.id, c]));
  return (
    <div style={{
      width: '100%', height: '100%',
      border: `1px solid ${selected ? '#4ade80' : '#333333'}`, borderRadius: 8,
      background: '#1a1a1a', position: 'relative',
      display: 'grid',
      gridTemplateColumns: `repeat(${cfg.gridCols}, 1fr)`,
      gridTemplateRows: `repeat(${cfg.gridRows}, 1fr)`,
      gap: 2,
    }}>
      {Array.from({ length: total }, (_, i) => {
        const nodeId = data.cells?.[i];
        const info = nodeId ? byId.get(nodeId) : undefined;
        return (
          <StoryboardCell key={i} index={i} cellWidth={cellWidth} cellHeight={cellHeight}
            info={info} showIndex={cfg.showIndex}
            selectedCell={selectedCell} onSelectCell={setSelectedCell}
            onFillEmpty={(idx) => window.dispatchEvent(new CustomEvent('storyboard:fill-cell', { detail: { groupId: id, index: idx } }))} />
        );
      })}
      <div style={{ position: 'absolute', top: -10, left: 8, background: '#0a0a0a', color: '#999', fontSize: 12, padding: '0 6px', whiteSpace: 'nowrap' }}>
        {data.name ?? '分镜组'}
      </div>
    </div>
  );
}
export const StoryboardGroupRenderer = memo(StoryboardGroupRendererComponent);
