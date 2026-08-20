import { apiFetch } from './client';

export interface CreateCanvasResult {
  templateId: string;
  projectId: string;
  name: string;
}

export function createCanvas(name: string, folderId: string | null) {
  return apiFetch<CreateCanvasResult>('/canvases', {
    method: 'POST',
    body: JSON.stringify({ name, folderId }),
  });
}

export function saveCanvas(projectId: string, payload: { name: string; description?: string; isPublic?: boolean }) {
  return apiFetch(`/projects/${projectId}/save`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
