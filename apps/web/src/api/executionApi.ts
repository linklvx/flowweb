import { apiFetch } from './client';
import type { AiToolId } from '@/stores/nodeStore';
import { getStateVector } from '@/stores/canvasCollabRuntime';

function svHeaders(): Record<string, string> {
  const sv = getStateVector();
  return sv ? { 'x-yjs-sv': sv } : {};
}

/** Y0b-2 T5（Z95/Z88）：组执行错误结构化——nodeId 定位+status 分诊（error=节点失败/skipped=别处在飞）+errorCode。 */
export interface ExecutionErrorEntry {
  nodeId: string;
  status: 'error' | 'skipped';
  error: string;
  errorCode?: string;
}

export async function executeGroupNodes(projectId: string, nodeIds: string[]): Promise<{ success: boolean; errors: ExecutionErrorEntry[]; results?: { nodeId: string; type: string; resultUrl?: string }[]; totalCost?: number }> {
  return apiFetch('/execution/execute', {
    method: 'POST',
    body: JSON.stringify({ projectId, nodeIds }),
    headers: svHeaders(),
  });
}

export async function enqueueWorkflow(params: {
  projectId: string;
  nodeId?: string;
  aiTool?: AiToolId;
  intentId?: string; // 批0.5-8b：客户端意图 id（幂等键）——enqueue 端点读 body.intentId
}): Promise<{ jobId: string; status: string }> {
  return apiFetch('/execution/enqueue', {
    method: 'POST',
    body: JSON.stringify(params),
    headers: svHeaders(),
  });
}

export async function fetchBalance(): Promise<{ credits: number }> {
  return apiFetch('/credits/balance');
}

/** 批0.5-6 GET intents 意图行（批1-6 断连恢复消费）——GenerationIntent select 子集（createdAt desc，take 20） */
export interface GenerationIntentRow {
  intentId: string;
  kind: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'VOIDED';
  resultRef: string | null;
  error: string | null;
}

/** 节点意图列表（断连恢复读面，成员级——VIEWER 可见；与 jobs/:id 同口径） */
export async function fetchNodeIntents(projectId: string, nodeId: string): Promise<GenerationIntentRow[]> {
  return apiFetch(`/execution/intents?projectId=${encodeURIComponent(projectId)}&nodeId=${encodeURIComponent(nodeId)}`);
}
