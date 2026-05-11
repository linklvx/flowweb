import { apiFetch } from './client';

export async function executeWorkflow(projectId: string, nodeId?: string): Promise<{ success: boolean; errors: string[]; results?: { nodeId: string; type: string; resultUrl?: string }[] }> {
  return apiFetch('/execution/execute', {
    method: 'POST',
    body: JSON.stringify({ projectId, nodeId }),
  });
}

export async function fetchBalance(): Promise<{ credits: number }> {
  return apiFetch('/credits/balance');
}
