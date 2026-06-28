import { memo } from 'react';
import { ImageGenNode } from './ImageGenNode';
import type { NodeProps } from '@xyflow/react';
import type { ImageNodeData } from '@/stores/nodeStore';

function ImageExtNodeComponent(props: NodeProps<ImageNodeData>) {
  return <ImageGenNode {...props} />;
}
ImageExtNodeComponent.displayName = 'ImageExtNode';
export const ImageExtNode = memo(ImageExtNodeComponent);
