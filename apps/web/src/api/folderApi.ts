import { apiFetch } from './client';

export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  canvasCount: number;
  thumbnails: Array<{ id: string }>;
}

export function getFolders(teamId?: string) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<{ folders: FolderDto[] }>(`/folders${qs}`);
}

export function createFolder(name: string, teamId?: string) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<{ id: string }>(`/folders${qs}`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function renameFolder(id: string, name: string, teamId?: string) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<{ id: string }>(`/folders/${id}${qs}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function deleteFolder(id: string, teamId?: string) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  return apiFetch<{ movedCanvasCount: number }>(`/folders/${id}${qs}`, { method: 'DELETE' });
}
