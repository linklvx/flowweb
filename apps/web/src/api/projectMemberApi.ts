import { apiFetch } from './client';

export interface ProjectMemberRow {
  userId: string;
  name: string;
  email: string;
  teamRole: string;
  effectiveRole: string;
  source: 'explicit' | 'inherited';
}

export function listProjectMembers(projectId: string) {
  return apiFetch<{ items: ProjectMemberRow[] }>(`/project/${projectId}/members`);
}

export function addProjectMember(projectId: string, userId: string, role: string) {
  return apiFetch(`/project/${projectId}/members`, { method: 'POST', body: JSON.stringify({ userId, role }) });
}

export function changeProjectMemberRole(projectId: string, userId: string, role: string) {
  return apiFetch(`/project/${projectId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
}

export function removeProjectMember(projectId: string, userId: string) {
  return apiFetch(`/project/${projectId}/members/${userId}`, { method: 'DELETE' });
}
