import { useCallback } from 'react';
import { useNodeStore, IMAGE_EXT_DEFAULTS, isImageExtNode } from '@/stores/nodeStore';
import type { ImageExtConfig } from '@/stores/nodeStore';

export function useImageExtConfig(nodeId: string) {
  const extConfig = useNodeStore((s) => {
    const node = s.nodes[nodeId];
    if (!isImageExtNode(node)) return IMAGE_EXT_DEFAULTS;
    return node.data.extConfig ?? IMAGE_EXT_DEFAULTS;
  });

  const updateExtConfig = useNodeStore((s) => s.updateExtConfig);

  const updateConfig = useCallback(
    (partial: Partial<ImageExtConfig>) => updateExtConfig(nodeId, partial),
    [nodeId, updateExtConfig],
  );

  return { extConfig, updateExtConfig: updateConfig };
}
