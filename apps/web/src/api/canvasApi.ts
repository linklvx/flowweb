import { apiFetch } from './client';

export interface CreateCanvasResult {
  templateId: string;
  projectId: string;
  name: string;
  teamId: string;
}

export function createCanvas(name: string, folderId: string | null, teamId?: string) {
  return apiFetch<CreateCanvasResult>('/canvases', {
    method: 'POST',
    body: JSON.stringify({ name, folderId, teamId }),
  });
}

export function getNextUntitledName(teamId?: string) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<{ name: string }>(`/canvases/next-untitled-name${qs}`);
}

export function getProjectFolder(projectId: string) {
  return apiFetch<{ folderId: string | null }>(`/projects/${projectId}/folder`);
}
