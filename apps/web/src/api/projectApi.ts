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

export async function syncNodes(projectId: string, nodes: any[]) {
  return apiFetch(`/projects/${projectId}/nodes`, {
    method: 'PUT',
    body: JSON.stringify({ nodes }),
  });
}

export async function syncEdges(projectId: string, edges: any[]) {
  return apiFetch(`/projects/${projectId}/edges`, {
    method: 'PUT',
    body: JSON.stringify({ edges }),
  });
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

export async function updateViewport(projectId: string, viewport: { x: number; y: number; zoom: number }) {
  return apiFetch(`/projects/${projectId}/viewport`, {
    method: 'PUT',
    body: JSON.stringify({ viewport }),
  });
}
