const BASE = '/api/templates';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error?.message || '请求失败');
  }
  return json.data as T;
}

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

export function createTemplate(dto: CreateTemplateDto) {
  return request('', { method: 'POST', body: JSON.stringify(dto) });
}

export function getTemplates(query: TemplateListQuery) {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.search) params.set('search', query.search);
  if (query.sort) params.set('sort', query.sort);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return request<any>(`?${qs}`);
}

export function getTemplate(id: string) {
  return request<any>(`/${id}`);
}

export function updateTemplate(id: string, dto: UpdateTemplateDto) {
  return request(`/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
}

export function deleteTemplate(id: string) {
  return request(`/${id}`, { method: 'DELETE' });
}

export function importTemplate(id: string) {
  return request(`/${id}/import`, { method: 'POST' });
}
