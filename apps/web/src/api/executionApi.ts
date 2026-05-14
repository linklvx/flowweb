import { apiFetch } from './client';

export async function executeWorkflow(projectId: string, nodeId?: string): Promise<{ success: boolean; errors: string[]; results?: { nodeId: string; type: string; resultUrl?: string }[] }> {
  return apiFetch('/execution/execute', {
    method: 'POST',
    body: JSON.stringify({ projectId, nodeId }),
  });
}

export async function enqueueWorkflow(projectId: string, nodeId?: string): Promise<{ jobId: string; status: string }> {
  return apiFetch('/execution/enqueue', {
    method: 'POST',
    body: JSON.stringify({ projectId, nodeId }),
  });
}

export async function fetchBalance(): Promise<{ credits: number }> {
  return apiFetch('/credits/balance');
}
