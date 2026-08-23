// apps/web/src/pages/canvas/components/groups/GroupNode.tsx
import { memo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { NormalGroupRenderer } from './NormalGroupRenderer';
import { StoryboardGroupRenderer } from './StoryboardGroupRenderer';
import { useCanvasStore } from '@/stores/canvasStore';
import type { CellNodeInfo } from './StoryboardCell';
import { HANDLE } from './selectionTokens';

function GroupNodeComponent({ id, data, selected }: NodeProps) {
  if ((data as any).groupType === 'storyboard') {
    return <StoryboardGroupRendererCellNodes id={id} data={data as any} selected={!!selected} />;
  }
  return (
    <>
      {selected && (
        <NodeResizer
          isVisible={!!selected}
          minWidth={200}
          minHeight={120}
          handleStyle={HANDLE as any}
          onResizeEnd={() => useCanvasStore.getState().markManuallyResized(id)}
        />
      )}
      <NormalGroupRenderer groupId={id} data={data as any} selected={!!selected} />
    </>
  );
}

function StoryboardGroupRendererCellNodes({ id, data, selected }: { id: string; data: any; selected: boolean }) {
  const cellNodes = useCanvasStore((s) =>
    s.nodes
      .filter((n) => (data.cells ?? []).includes(n.id))
      .map((n) => ({ id: n.id, fileId: (n.data as any).fileId || (n.data as any).referenceImage, status: (n.data as any).status, url: (n.data as any).mediaUrl })));
  return <StoryboardGroupRenderer id={id} data={data} selected={selected} cellNodes={cellNodes as CellNodeInfo[]} />;
}

export const GroupNode = memo(GroupNodeComponent);
