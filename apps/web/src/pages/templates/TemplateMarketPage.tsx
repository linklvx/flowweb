import { useState, useEffect, useCallback } from 'react';
import { TemplateCard } from './TemplateCard';
import { getTemplates, TemplateListQuery } from '@/api/templateApi';

type TabType = 'community' | 'official' | 'my';

export function TemplateMarketPage() {
  const [tab, setTab] = useState<TabType>('community');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'importCount' | 'newest'>('importCount');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const query: TemplateListQuery = { type: tab, sort, page, limit: 20 };
      if (search.trim()) query.search = search.trim();
      const data = await getTemplates(query);
      setData(data);
    } catch (e) {
      console.error('Failed to fetch templates', e);
    } finally {
      setLoading(false);
    }
  }, [tab, search, sort, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const tabs: { key: TabType; label: string }[] = [
    { key: 'community', label: '社区模板' },
    { key: 'official', label: '官方模板' },
    { key: 'my', label: '工作空间' },
  ];

  return (
    <div>
      <div className="py-8">
        <h1 className="text-2xl font-bold text-text mb-6">模板广场</h1>

        <div className="flex gap-1 mb-6 border-b">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setPage(1); }}
              className={`px-4 py-2 text-sm border-b-2 transition-colors bg-transparent ${
                tab === t.key ? 'text-accent-text border-accent' : 'text-text-dim-2 border-transparent hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3 mb-6">
          <input
            type="text"
            placeholder="搜索模板..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="flex-1 px-3 py-2 bg-surface border rounded text-sm text-text placeholder-text-dim-1 outline-none focus:border-accent"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
            className="px-3 py-2 bg-surface border rounded text-sm text-text outline-none cursor-pointer"
          >
            <option value="importCount">最热门</option>
            <option value="newest">最新</option>
          </select>
        </div>

        {loading ? (
          <div className="text-center text-text-dim-1 py-12">加载中...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {data?.templates?.map((tpl: any) => (
                <TemplateCard key={tpl.id} {...tpl} />
              ))}
            </div>
            {data?.templates?.length === 0 && (
              <div className="text-center text-text-dim-1 py-12">暂无模板</div>
            )}

            {data && data.totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-8">
                {Array.from({ length: data.totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`px-3 py-1 text-sm rounded bg-transparent border transition-colors ${
                      p === page ? 'border-accent text-accent-text' : 'text-text-dim-2 hover:border-text-dim-1'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
