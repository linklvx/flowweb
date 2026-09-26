import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useStyleLibrary } from './useStyleLibrary';
import * as api from '@/api/stylesApi';
import { useNodeStore } from '@/stores/nodeStore';

vi.mock('@/api/stylesApi', () => ({
  fetchStyleCategories: vi.fn().mockResolvedValue([{ id: 'c1', name: '摄影写真', sortOrder: 1 }]),
  fetchStyles: vi.fn(),
  favoriteStyle: vi.fn(),
  useStyle: vi.fn(),
}));

const baseItem = (id: string) => ({
  id, name: `风格${id}`, coverUrl: `/c${id}.png`, authorName: '作者',
  isCommercial: true, usageCount: 5, promptText: 'p', favorited: false,
});

describe('useStyleLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNodeStore.setState({ nodes: { img1: { id: 'img1', type: 'imageGen', data: {} } } as any });
  });

  it('初始加载 tab=all 第一页并带分类', async () => {
    (api.fetchStyles as any).mockResolvedValue({ items: [baseItem('s1')], total: 1, page: 1, pageSize: 20 });
    const { result } = renderHook(() => useStyleLibrary('img1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(api.fetchStyles).toHaveBeenCalledWith(expect.objectContaining({ tab: 'all', page: 1, pageSize: 20 }));
    expect(result.current.categories).toHaveLength(1);
  });

  it('loadMore 增页去重合并', async () => {
    (api.fetchStyles as any)
      .mockResolvedValueOnce({ items: [baseItem('s1')], total: 3, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [baseItem('s1'), baseItem('s2')], total: 3, page: 2, pageSize: 20 });
    const { result } = renderHook(() => useStyleLibrary('img1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
  });

  it('切 tab 重置 page=1 并丢弃过期响应（竞态守卫，spec §4.2）', async () => {
    let resolve1: (v: unknown) => void = () => {};
    (api.fetchStyles as any)
      .mockImplementationOnce(() => new Promise((r) => { resolve1 = r; }))
      .mockResolvedValueOnce({ items: [baseItem('s9')], total: 1, page: 1, pageSize: 20 });
    const { result } = renderHook(() => useStyleLibrary('img1'));
    act(() => result.current.setTab('favorites'));
    await waitFor(() => expect(result.current.items[0]?.id).toBe('s9'));
    act(() => resolve1({ items: [baseItem('s1')], total: 9, page: 1, pageSize: 20 })); // 过期响应迟到
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.items[0]?.id).toBe('s9'); // 未被过期响应覆盖
  });

  it('useStyle 成功 → updateConfig 写 styleId/styleName 并回调 onUsed；失败不回调（spec §4.4）', async () => {
    const onUsed = vi.fn();
    (api.fetchStyles as any).mockResolvedValue({ items: [baseItem('s1')], total: 1, page: 1, pageSize: 20 });
    (api.useStyle as any).mockResolvedValue(baseItem('s1'));
    const { result } = renderHook(() => useStyleLibrary('img1', onUsed));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.applyStyle('s1'); });
    const data = useNodeStore.getState().nodes['img1'].data as { styleId?: string | null; styleName?: string | null };
    expect(data.styleId).toBe('s1');
    expect(data.styleName).toBe('风格s1');
    expect(onUsed).toHaveBeenCalledTimes(1);

    (api.useStyle as any).mockRejectedValue(new Error('boom'));
    await act(async () => { await result.current.applyStyle('s1'); });
    expect(result.current.useError).toBe('风格使用失败，请重试');
    expect(onUsed).toHaveBeenCalledTimes(1); // 失败不关窗不回调
  });

  it('clearStyle → updateConfig 写 null（D16 墓碑契约）', async () => {
    useNodeStore.setState({ nodes: { img1: { id: 'img1', type: 'imageGen', data: { styleId: 's1', styleName: 'A' } } } as any });
    const { result } = renderHook(() => useStyleLibrary('img1'));
    act(() => result.current.clearStyle());
    const data = useNodeStore.getState().nodes['img1'].data as { styleId?: string | null };
    expect(data.styleId).toBeNull();
  });

  it('toggleFavorite 乐观更新本地 items', async () => {
    (api.fetchStyles as any).mockResolvedValue({ items: [baseItem('s1')], total: 1, page: 1, pageSize: 20 });
    (api.favoriteStyle as any).mockResolvedValue({ favorited: true });
    const { result } = renderHook(() => useStyleLibrary('img1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.toggleFavorite('s1'));
    expect(result.current.items[0].favorited).toBe(true);
  });
});
