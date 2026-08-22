// GroupNode.tsx
import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { NormalGroupRenderer } from './NormalGroupRenderer';
import { StoryboardGroupRenderer } from './StoryboardGroupRenderer';
import { useCanvasStore } from '@/stores/canvasStore';
import type { CellNodeInfo } from './StoryboardCell';

function GroupNodeComponent({ id, data, selected }: NodeProps) {
  if ((data as any).groupType === 'storyboard') {
    return <StoryboardGroupRendererCellNodes id={id} data={data as any} selected={!!selected} />;
  }
  return <NormalGroupRenderer data={data as any} selected={!!selected} />;
}

function StoryboardGroupRendererCellNodes({ id, data, selected }: { id: string; data: any; selected: boolean }) {
  const cellNodes = useCanvasStore((s) =>
    s.nodes
      .filter((n) => (data.cells ?? []).includes(n.id))
      .map((n) => ({ id: n.id, fileId: (n.data as any).fileId, status: (n.data as any).status, url: (n.data as any).mediaUrl })));
  return <StoryboardGroupRenderer id={id} data={data} selected={selected} cellNodes={cellNodes as CellNodeInfo[]} />;
}

export const GroupNode = memo(GroupNodeComponent);
