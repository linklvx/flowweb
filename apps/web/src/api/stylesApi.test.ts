import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchStyleCategories, fetchStyles, fetchStyleById, favoriteStyle, useStyle } from './stylesApi';

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ code: 0, data, message: 'ok' }) });
const nf = { ok: false, status: 404, json: async () => ({ code: -1, data: null, message: '风格不存在' }) };

describe('stylesApi', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('fetchStyles：拼 query 并拆信封', async () => {
    const f = vi.fn().mockResolvedValue(ok({ items: [], total: 0, page: 1, pageSize: 20 }));
    vi.stubGlobal('fetch', f);
    const out = await fetchStyles({ tab: 'favorites', search: 'x', commercialOnly: true, page: 2 });
    // 断言按实现的真实插入顺序（URLSearchParams 保序：构造器三键先、set 两键后——H4）
    expect(f).toHaveBeenCalledWith('/api/styles?tab=favorites&page=2&pageSize=20&search=x&commercialOnly=true');
    expect(out).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('fetchStyleById：404 → null（非错误，spec §4.5）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(nf));
    expect(await fetchStyleById('sx')).toBeNull();
  });

  it('favoriteStyle：POST body 显式目标态', async () => {
    const f = vi.fn().mockResolvedValue(ok({ favorited: true }));
    vi.stubGlobal('fetch', f);
    const out = await favoriteStyle('s1', true);
    expect(f).toHaveBeenCalledWith('/api/styles/s1/favorite', expect.objectContaining({ method: 'POST', body: JSON.stringify({ favorited: true }) }));
    expect(out).toEqual({ favorited: true });
  });

  it('useStyle：POST 无 body', async () => {
    const f = vi.fn().mockResolvedValue(ok({ id: 's1' }));
    vi.stubGlobal('fetch', f);
    await useStyle('s1');
    expect(f).toHaveBeenCalledWith('/api/styles/s1/use', expect.objectContaining({ method: 'POST' }));
  });

  it('fetchStyleCategories：GET /api/styles/categories', async () => {
    const f = vi.fn().mockResolvedValue(ok([{ id: 'c1' }]));
    vi.stubGlobal('fetch', f);
    expect(await fetchStyleCategories()).toEqual([{ id: 'c1' }]);
  });
});
