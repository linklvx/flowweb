import { apiFetch } from './client';
import { getStateVector } from '@/stores/canvasCollabRuntime';

export interface CreateCanvasResult {
  templateId: string;
  projectId: string;
  name: string;
}

export function createCanvas(name: string, folderId: string | null, teamId?: string) {
  return apiFetch<CreateCanvasResult>('/canvases', {
    method: 'POST',
    body: JSON.stringify({ name, folderId, teamId }),
  });
}

export function saveCanvas(projectId: string, payload: { name: string; description?: string; isPublic?: boolean }) {
  const sv = getStateVector();
  return apiFetch(`/projects/${projectId}/save`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: sv ? { 'x-yjs-sv': sv } : {},
  });
}

export function getNextUntitledName() {
  return apiFetch<{ name: string }>('/canvases/next-untitled-name');
}

export function getProjectFolder(projectId: string) {
  return apiFetch<{ folderId: string | null }>(`/projects/${projectId}/folder`);
}
