import { apiFetch } from './client';
import type { AiToolId } from '@/stores/nodeStore';
import { getStateVector } from '@/stores/canvasCollabRuntime';

function svHeaders(): Record<string, string> {
  const sv = getStateVector();
  return sv ? { 'x-yjs-sv': sv } : {};
}

export async function executeWorkflow(projectId: string, nodeId?: string): Promise<{ success: boolean; errors: string[]; results?: { nodeId: string; type: string; resultUrl?: string }[] }> {
  return apiFetch('/execution/execute', {
    method: 'POST',
    body: JSON.stringify({ projectId, nodeId }),
    headers: svHeaders(),
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
