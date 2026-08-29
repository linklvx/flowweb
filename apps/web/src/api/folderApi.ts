import { apiFetch } from './client';

export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  canvasCount: number;
  thumbnails: Array<{ id: string; coverUrl: string | null }>;
}

export function getFolders(teamId?: string) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<{ folders: FolderDto[] }>(`/folders${qs}`);
}

export function createFolder(name: string, teamId?: string) {
  return apiFetch<{ id: string }>('/folders', {
    method: 'POST',
    body: JSON.stringify(teamId ? { name, teamId } : { name }),
  });
}

export function renameFolder(id: string, name: string) {
  return apiFetch<{ id: string }>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function deleteFolder(id: string) {
  return apiFetch<{ movedCanvasCount: number }>(`/folders/${id}`, { method: 'DELETE' });
}
