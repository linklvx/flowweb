import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchStyleCategories, fetchStyles, favoriteStyle, useStyle,
  type StyleCategoryItem, type StyleSummary,
} from '@/api/stylesApi';
import { useNodeStore } from '@/stores/nodeStore';

export type StyleTab = 'all' | 'favorites' | 'recent';

// onUsed 直传回调（非 opts 对象——第八轮 A2：对象字面量每渲染新建会使 applyStyle deps 失稳 → memo(StyleCard) 恒失效）
export function useStyleLibrary(nodeId: string, onUsed?: () => void) {
  const [tab, setTabState] = useState<StyleTab>('all');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [commercialOnly, setCommercialOnly] = useState(false);
  const [items, setItems] = useState<StyleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useError, setUseError] = useState<string | null>(null);
  const [categories, setCategories] = useState<StyleCategoryItem[]>([]);
  const reqSeq = useRef(0);

  // 搜索防抖 300ms（spec §4.2）
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { void fetchStyleCategories().then(setCategories).catch(() => {}); }, []);

  const load = useCallback(async (targetPage: number, append: boolean) => {
    const seq = ++reqSeq.current;
    setLoading(true); setError(null);
    try {
      const res = await fetchStyles({ tab, categoryId, search, commercialOnly, page: targetPage, pageSize: 20 });
      if (seq !== reqSeq.current) return; // 过期响应丢弃（竞态守卫）
      setItems((prev) => {
        const next = append ? [...prev, ...res.items] : res.items;
        return next.filter((it, i, arr) => arr.findIndex((x) => x.id === it.id) === i); // id 去重
      });
      setTotal(res.total);
      setPage(targetPage);
    } catch {
      if (seq === reqSeq.current) setError('加载失败，请重试');
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [tab, categoryId, search, commercialOnly]);

  // 条件变化 → 重置 page=1（spec §4.2）
  useEffect(() => { void load(1, false); }, [load]);

  const setTab = useCallback((t: StyleTab) => {
    setTabState(t);
    setCategoryId(undefined);
    setCommercialOnly(false); // 切 tab 清商用勾选（P1-6 配套：勾选态残留但 UI 已隐藏会静默过滤收藏列表）
  }, []);
  const loadMore = useCallback(() => { if (!loading && items.length < total) void load(page + 1, true); }, [loading, items.length, total, page, load]);

  const toggleFavorite = useCallback((id: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, favorited: !it.favorited } : it)));
    const target = items.find((it) => it.id === id);
    void favoriteStyle(id, !target?.favorited).catch(() => {
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, favorited: Boolean(target?.favorited) } : it)));
    });
  }, [items]);

  const applyStyle = useCallback(async (id: string) => {
    setUseError(null);
    try {
      const style = await useStyle(id);
      useNodeStore.getState().updateConfig(nodeId, { styleId: style.id, styleName: style.name });
      onUsed?.();
    } catch {
      setUseError('风格使用失败，请重试'); // 失败不关窗（spec §4.4）
    }
  }, [nodeId, onUsed]);

  const clearStyle = useCallback(() => {
    useNodeStore.getState().updateConfig(nodeId, { styleId: null, styleName: null }); // D16：写 null（类型已在 T2 就位，无需强转）
  }, [nodeId]);

  const currentStyleId = useNodeStore((s) => (s.nodes[nodeId]?.data as { styleId?: string | null } | undefined)?.styleId ?? null);

  return {
    tab, setTab, categoryId, setCategoryId, searchInput, setSearchInput,
    commercialOnly, setCommercialOnly, categories,
    items, total, page, loading, error, useError,
    loadMore, toggleFavorite, applyStyle, clearStyle, currentStyleId,
  };
}
