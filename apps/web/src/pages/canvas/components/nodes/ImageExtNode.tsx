import { memo } from 'react';
import { ImageGenNode } from './ImageGenNode';
import type { NodeProps } from '@xyflow/react';

function ImageExtNodeComponent(props: NodeProps) {
  return <ImageGenNode {...props} />;
}
ImageExtNodeComponent.displayName = 'ImageExtNode';
export const ImageExtNode = memo(ImageExtNodeComponent);
