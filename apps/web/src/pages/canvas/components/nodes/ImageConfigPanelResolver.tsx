import { memo } from 'react';
import { useNodeStore, isImageExtNode, isImageGenNode } from '@/stores/nodeStore';
import { ImageConfigPanel } from './ImageConfigPanel';
import { ImageExtConfigPanel } from './ImageExtConfigPanel';

interface Props {
  nodeId: string;
}

function ImageConfigPanelResolverComponent({ nodeId }: Props) {
  const nodeType = useNodeStore((s) => s.nodes[nodeId]?.type);

  if (nodeType && isImageExtNode(useNodeStore.getState().nodes[nodeId])) {
    return <ImageExtConfigPanel nodeId={nodeId} />;
  }

  if (nodeType && isImageGenNode(useNodeStore.getState().nodes[nodeId])) {
    return <ImageConfigPanel nodeId={nodeId} />;
  }

  return null;
}

export const ImageConfigPanelResolver = memo(ImageConfigPanelResolverComponent);
