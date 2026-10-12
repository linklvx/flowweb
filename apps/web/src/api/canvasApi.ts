import { apiFetch } from './client';

export interface CreateCanvasResult {
  templateId: string;
  projectId: string;
  name: string;
  teamId: string;
  /** Y0b-5 T5：世代可见通道随行（canvas.service create——doc 懒建确定性 0 代；旧后端缺席⇒下游 fail-closed） */
  collabGeneration?: number;
  collabSchemaVersion?: number;
  collabViewerUid?: string | null;
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
