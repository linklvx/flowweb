import { useNodeStore, NODE_TYPES, isImageNode, IMAGE_EXT_DEFAULTS } from '@/stores/nodeStore';
import type { ImageItem, AiToolId, ImageExtConfig } from '@/stores/nodeStore';
import { enqueueWorkflow } from './executionApi';

export interface ImageExtGenParams {
  projectId: string;
  nodeId: string;
  nodeType: typeof NODE_TYPES.IMAGE_EXT_GEN;
  allImages: ImageItem[];
  aiTool?: AiToolId;
  model?: string;
  ratio?: string;
  resolution?: string;
  quality?: string;
  generateCount?: number;
  prompt?: { text?: string; html?: string };
}

function getExtConfig(nodeId: string): ImageExtConfig {
  const node = useNodeStore.getState().nodes[nodeId];
  if (!isImageNode(node) || !node.data.extConfig) return IMAGE_EXT_DEFAULTS;
  return node.data.extConfig;
}

export function buildImageExtGenParams(nodeId: string): ImageExtGenParams {
  const node = useNodeStore.getState().nodes[nodeId];
  const data = isImageNode(node) ? node.data : undefined;
  const extConfig = getExtConfig(nodeId);

  return {
    projectId: 'default',
    nodeId,
    nodeType: NODE_TYPES.IMAGE_EXT_GEN,
    allImages: data?.allImages ?? [],
    aiTool: data?.aiTool,
    model: extConfig.model,
    ratio: extConfig.ratio,
    resolution: extConfig.resolution,
    quality: extConfig.quality,
    generateCount: extConfig.generateCount,
    prompt: extConfig.prompt,
  };
}

export async function fetchModels(): Promise<{ id: string; name: string }[]> {
  const res = await fetch('/api/node-types/image-ext/models');
  const json = await res.json();
  return json.code === 0 ? json.data : [];
}

export async function getCreditCost(modelId: string): Promise<number> {
  try {
    const res = await fetch(`/api/pricing/calculate?modelId=${modelId}&nodeType=imageExtGen`);
    const json = await res.json();
    return json.code === 0 ? json.data : 0;
  } catch {
    return 0;
  }
}

export async function submitGeneration(nodeId: string): Promise<{ jobId: string }> {
  const params = buildImageExtGenParams(nodeId);
  return enqueueWorkflow(params);
}
