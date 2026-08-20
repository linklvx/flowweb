const BASE = '/api/templates';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.message || '请求失败');
  }
  return json.data.data as T;
}

export interface UpdateTemplateDto {
  name?: string;
  description?: string;
  isPublic?: boolean;
  folderId?: string | null;
}

export interface TemplateListQuery {
  type?: 'official' | 'my' | 'community';
  search?: string;
  sort?: 'importCount' | 'newest';
  page?: number;
  limit?: number;
  folderId?: string;
}

export function getTemplates(query: TemplateListQuery) {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.search) params.set('search', query.search);
  if (query.sort) params.set('sort', query.sort);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  if (query.folderId) params.set('folderId', query.folderId);
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
  return request<{ id: string }>(`/${id}/import`, { method: 'POST' });
}
