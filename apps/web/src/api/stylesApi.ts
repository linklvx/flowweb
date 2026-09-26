/** 风格库用户侧接口（spec §6.1）。信封 {code,data,message} 拆包——imageNodeApi 裸 fetch 先例。 */

export interface StyleCategoryItem { id: string; name: string; sortOrder: number }

export interface StyleSummary {
  id: string; name: string; coverUrl: string; authorName: string | null;
  isCommercial: boolean; usageCount: number; promptText: string; favorited: boolean;
  coverKey?: string;
}

export interface StyleListResult { items: StyleSummary[]; total: number; page: number; pageSize: number }

async function unwrap<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (json.code === 0) return json.data as T;
  throw new Error(json.message || '请求失败');
}

export async function fetchStyleCategories(): Promise<StyleCategoryItem[]> {
  const res = await fetch('/api/styles/categories');
  return unwrap<StyleCategoryItem[]>(res);
}

export interface FetchStylesParams {
  tab: 'all' | 'favorites' | 'recent';
  categoryId?: string;
  search?: string;
  commercialOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export async function fetchStyles(params: FetchStylesParams): Promise<StyleListResult> {
  const q = new URLSearchParams({
    tab: params.tab,
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20),
  });
  if (params.categoryId) q.set('categoryId', params.categoryId);
  if (params.search) q.set('search', params.search);
  if (params.commercialOnly) q.set('commercialOnly', 'true');
  const res = await fetch(`/api/styles?${q.toString()}`);
  return unwrap<StyleListResult>(res);
}

/** 停用/不存在 → 404 → null（映射为「无风格」，非错误——spec §4.5）。 */
export async function fetchStyleById(id: string): Promise<StyleSummary | null> {
  const res = await fetch(`/api/styles/${id}`);
  if (res.status === 404) return null;
  return unwrap<StyleSummary>(res);
}

export async function favoriteStyle(id: string, favorited: boolean): Promise<{ favorited: boolean }> {
  const res = await fetch(`/api/styles/${id}/favorite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorited }),
  });
  return unwrap<{ favorited: boolean }>(res);
}

export async function useStyle(id: string): Promise<StyleSummary> {
  const res = await fetch(`/api/styles/${id}/use`, { method: 'POST' });
  return unwrap<StyleSummary>(res);
}
