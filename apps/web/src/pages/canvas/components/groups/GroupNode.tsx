// apps/web/src/pages/canvas/components/groups/GroupNode.tsx
import { memo, useMemo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { NormalGroupRenderer } from './NormalGroupRenderer';
import { StoryboardGroupRenderer } from './StoryboardGroupRenderer';
import { useCanvasStore } from '@/stores/canvasStore';
import { execOverrideOf } from '@/stores/nodeStore';
import { stopCapturing } from '@/stores/canvasUndo';
import { calcGroupMinSize } from '@/utils/groupLayout';
import type { CellNodeInfo } from './StoryboardCell';
import { HANDLE } from './selectionTokens';

function GroupNodeResizer({ id }: { id: string }) {
  // 取稳定引用的 nodes 数组，filter/useMemo 在组件内算，避免新对象选择器的快照问题
  const nodes = useCanvasStore((s) => s.nodes);
  const minSize = useMemo(
    () => calcGroupMinSize(nodes.filter((n) => n.parentId === id).map((n) => ({
      x: n.position.x,
      y: n.position.y,
      width: n.width ?? n.measured?.width ?? 280,
      height: n.height ?? n.measured?.height ?? 120,
    }))),
    [nodes, id],
  );
  return (
    <NodeResizer
      isVisible
      minWidth={minSize.minWidth}
      minHeight={minSize.minHeight}
      handleStyle={HANDLE}
      onResizeEnd={() => { useCanvasStore.getState().markManuallyResized(id); stopCapturing(); }}
    />
  );
}

function GroupNodeComponent({ id, data, selected }: NodeProps) {
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
  if ((data as any).groupType === 'storyboard') {
    return <StoryboardGroupRendererCellNodes id={id} data={data as any} />;
  }
  return (
    <>
      {selected && !(data as any).collapsed && !marqueeSelecting && <GroupNodeResizer id={id} />}
      <NormalGroupRenderer groupId={id} data={data as any} selected={!!selected} />
    </>
  );
}

function StoryboardGroupRendererCellNodes({ id, data }: { id: string; data: any }) {
  const cellNodes = useCanvasStore((s) =>
    s.nodes
      .filter((n) => (data.cells ?? []).includes(n.id))
      // 批1-6（B2）：status 读点换源——exec 覆盖值优先，回落本组件数据源（canvasStore 节点）的 data.status。
      // canvasStore 选择器内快照读（exec 投影落地伴随 doc nodes 变更 → applyDocToStore 重渲本组件）
      .map((n) => ({ id: n.id, fileId: (n.data as any).fileId || (n.data as any).referenceImage, status: execOverrideOf(n.id) ?? (n.data as any).status, url: (n.data as any).mediaUrl })));
  return <StoryboardGroupRenderer id={id} data={data} cellNodes={cellNodes as CellNodeInfo[]} />;
}

export const GroupNode = memo(GroupNodeComponent);
