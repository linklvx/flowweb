import { useNodeStore, NODE_TYPES, isImageNode } from '@/stores/nodeStore';
import type { ImageItem } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { enqueueWorkflow } from './executionApi';

export interface ImageGenParams {
  projectId: string;
  nodeId: string;
  nodeType: typeof NODE_TYPES.IMAGE_GEN;
  allImages: ImageItem[];
  model?: string;
  ratio?: string;
  resolution?: string;
  quality?: string;
  prompt?: { text?: string; html?: string };
}

export function buildImageGenParams(nodeId: string, opts?: { projectId?: string }): ImageGenParams {
  const node = useNodeStore.getState().nodes[nodeId];
  const data = isImageNode(node) ? node.data : undefined;

  return {
    projectId: opts?.projectId ?? useCanvasStore.getState().projectId ?? 'default',
    nodeId,
    nodeType: NODE_TYPES.IMAGE_GEN,
    allImages: data?.allImages ?? [],
    model: data?.model,
    ratio: data?.ratio,
    resolution: data?.resolution,
    quality: data?.quality,
    prompt: data?.prompt,
  };
}

export async function fetchModels(): Promise<{ id: string; name: string }[]> {
  const res = await fetch('/api/node-types/image/models');
  const json = await res.json();
  return json.code === 0 ? json.data : [];
}

export async function getCreditCost(modelId: string): Promise<number> {
  try {
    const res = await fetch(`/api/pricing/calculate?modelId=${modelId}`);
    const json = await res.json();
    return json.code === 0 ? json.data : 0;
  } catch {
    return 0;
  }
}

export async function submitGeneration(nodeId: string, opts?: { projectId?: string; intentId?: string }): Promise<{ jobId: string }> {
  const params = buildImageGenParams(nodeId, opts);
  return enqueueWorkflow({ ...params, intentId: opts?.intentId }); // 批0.5-8b：意图 id（幂等键）随 body 上送
}
