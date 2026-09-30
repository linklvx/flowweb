import { apiFetch } from './client';
import type { AiToolId } from '@/stores/nodeStore';
import { getStateVector } from '@/stores/canvasCollabRuntime';

function svHeaders(): Record<string, string> {
  const sv = getStateVector();
  return sv ? { 'x-yjs-sv': sv } : {};
}

export async function executeWorkflow(projectId: string, nodeId?: string, intentId?: string): Promise<{ success: boolean; errors: string[]; results?: { nodeId: string; type: string; resultUrl?: string }[] }> {
  return apiFetch('/execution/execute', {
    method: 'POST',
    body: JSON.stringify({ projectId, nodeId }),
    // 批0.5-8b：客户端意图 id（幂等键）——execute 端点读 @Headers('x-intent-id')
    headers: { ...svHeaders(), ...(intentId ? { 'x-intent-id': intentId } : {}) },
  });
}

export async function executeGroupNodes(projectId: string, nodeIds: string[]): Promise<{ success: boolean; errors: string[]; results?: { nodeId: string; type: string; resultUrl?: string }[] }> {
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
