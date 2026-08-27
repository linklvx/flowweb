import { apiFetch } from './client';

export interface ProjectData {
  id: string;
  name: string;
  viewport: { x: number; y: number; zoom: number };
  nodes: any[];
  edges: any[];
}

export async function getProject(id: string): Promise<ProjectData> {
  return apiFetch<ProjectData>(`/projects/${id}`);
}

export interface SyncCanvasPayload {
  nodes: any[];
  edges: any[];
  version: number;
}

export async function syncCanvas(projectId: string, payload: SyncCanvasPayload) {
  return apiFetch<{ version: number }>(`/projects/${projectId}/canvas`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

