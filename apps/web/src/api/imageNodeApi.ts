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

// Y0b-1（四轮 Z36②a）：模型载荷含声明维度行（resolutions/durations）——UI 存行 id 的数据源
export interface ModelWithDimensions {
  id: string;
  name: string;
  resolutions: { id: string; label: string }[];
  durations: { id: string; label: string; seconds: number }[];
}

export async function fetchModels(): Promise<ModelWithDimensions[]> {
  const res = await fetch('/api/node-types/image/models');
  const json = await res.json();
  return json.code === 0 ? json.data : [];
}

/** Y0b-1（三轮 P3）：报价=实扣同源——维度参数透传（行 id 形态）；无规则/解析失败 throw（禁 .catch(0)
 *  ——那是服务端 `?? 0` 的客户端镜像），调用点 catch 后显示"定价不可用"。 */
export async function getCreditCost(modelId: string, resolutionId?: string, durationId?: string | number): Promise<number> {
  const qs = new URLSearchParams({ modelId });
  if (resolutionId) qs.set('resolutionId', resolutionId);
  if (durationId != null && durationId !== '') qs.set('durationId', String(durationId));
  const res = await fetch(`/api/pricing/calculate?${qs.toString()}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.message ?? 'pricing unavailable');
  return json.data;
}

export async function submitGeneration(nodeId: string, opts?: { projectId?: string; intentId?: string }): Promise<{ jobId: string }> {
  const params = buildImageGenParams(nodeId, opts);
  return enqueueWorkflow({ ...params, intentId: opts?.intentId }); // 批0.5-8b：意图 id（幂等键）随 body 上送
}
