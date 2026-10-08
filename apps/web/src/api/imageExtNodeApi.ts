import { useNodeStore, NODE_TYPES, isImageNode, IMAGE_EXT_DEFAULTS } from '@/stores/nodeStore';
import type { ImageItem, AiToolId, ImageExtConfig } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { enqueueWorkflow } from './executionApi';
import type { ModelWithDimensions } from './imageNodeApi';

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

export function buildImageExtGenParams(nodeId: string, opts?: { projectId?: string }): ImageExtGenParams {
  const node = useNodeStore.getState().nodes[nodeId];
  const data = isImageNode(node) ? node.data : undefined;
  const extConfig = getExtConfig(nodeId);

  return {
    projectId: opts?.projectId ?? useCanvasStore.getState().projectId ?? 'default',
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

// Y0b-1（四轮 Z36②a）：imageExt 模型载荷同带声明维度行（resolutions/durations）——服务端
// /api/node-types/image-ext/models 与 image 同走 getModelsByNodeKey（同 include），此前窄化丢弃
export type { ModelWithDimensions } from './imageNodeApi';

export async function fetchModels(): Promise<ModelWithDimensions[]> {
  const res = await fetch('/api/node-types/image-ext/models');
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
  const params = buildImageExtGenParams(nodeId, opts);
  return enqueueWorkflow({ ...params, intentId: opts?.intentId }); // 批0.5-8b：意图 id（幂等键）随 body 上送
}
