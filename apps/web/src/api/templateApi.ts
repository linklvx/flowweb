import { apiFetch } from './client';

export interface CreateTemplateDto {
  projectId: string;
  name: string;
  description?: string;
  isPublic?: boolean;
}

export interface UpdateTemplateDto {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export interface TemplateListQuery {
  type?: 'official' | 'my' | 'community';
  search?: string;
  sort?: 'importCount' | 'newest';
  page?: number;
  limit?: number;
}

export async function createTemplate(dto: CreateTemplateDto) {
  const res = await apiFetch('/templates', {
    method: 'POST',
    body: JSON.stringify(dto),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('创建模板失败');
  return res.json();
}

export async function getTemplates(query: TemplateListQuery) {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.search) params.set('search', query.search);
  if (query.sort) params.set('sort', query.sort);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  const res = await apiFetch(`/templates?${params.toString()}`);
  if (!res.ok) throw new Error('获取模板列表失败');
  return res.json();
}

export async function getTemplate(id: string) {
  const res = await apiFetch(`/templates/${id}`);
  if (!res.ok) throw new Error('获取模板详情失败');
  return res.json();
}

export async function updateTemplate(id: string, dto: UpdateTemplateDto) {
  const res = await apiFetch(`/templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('更新模板失败');
  return res.json();
}

export async function deleteTemplate(id: string) {
  const res = await apiFetch(`/templates/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('删除模板失败');
  return res.json();
}

export async function importTemplate(id: string) {
  const res = await apiFetch(`/templates/${id}/import`, { method: 'POST' });
  if (!res.ok) throw new Error('导入模板失败');
  return res.json();
}
