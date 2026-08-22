// GroupNode.tsx
import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { NormalGroupRenderer } from './NormalGroupRenderer';
import { StoryboardGroupRenderer } from './StoryboardGroupRenderer';

function GroupNodeComponent({ id, data, selected }: NodeProps) {
  if ((data as any).groupType === 'storyboard') {
    return <StoryboardGroupRenderer id={id} data={data as any} selected={!!selected} />;
  }
  return <NormalGroupRenderer data={data as any} selected={!!selected} />;
}
export const GroupNode = memo(GroupNodeComponent);
