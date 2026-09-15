// VideosPage.tsx（列表 + 类型 tab + 分页 + :id? 驱动 Modal——Modal 在批次 8 挂载）
import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Pagination, Tabs } from 'antd';
// EmptyState/CardGridSkeleton 是 workspace 私有组件不复用（C1-4/C2 Task 7.2）——骨架/空态内联
import { fetchVideoWorks, fetchVideoCategories } from '@/api/videoWorkApi';
import type { VideoWorkListItem, VideoCategoryItem } from '@flowweb/shared';
import { VideoCard } from './VideoCard';

export function VideosPage() {
  const { id: activeWorkId } = useParams();           // 单路由 /videos/:id? 驱动 Modal（Task 8.1 挂载 <VideoPlayerModal /> 后此解构删除——组件内部自取）
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = searchParams.get('categoryId') ?? undefined;
  const page = Number(searchParams.get('page') ?? 1);

  const [items, setItems] = useState<VideoWorkListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<VideoCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchVideoCategories().then(setCategories).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    fetchVideoWorks({ categoryId, page, pageSize: 20 })
      .then(r => { setItems(r.items); setTotal(r.total); })
      .finally(() => setLoading(false));
  }, [categoryId, page]);

  const onTabChange = useCallback((key: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (key === 'all') next.delete('categoryId'); else next.set('categoryId', key);
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto box-border">
      <Tabs
        activeKey={categoryId ?? 'all'}
        onChange={onTabChange}
        items={[{ key: 'all', label: '全部' }, ...categories.map(c => ({ key: c.id, label: c.name }))]}
      />
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-video rounded-lg bg-white/5 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="py-24 text-center text-white/40 text-sm">暂无作品</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {items.map(w => <VideoCard key={w.id} work={w} />)}
        </div>
      )}
      {!loading && total > 20 && (
        <div className="flex justify-center mt-6">
          <Pagination current={page} total={total} pageSize={20}
            onChange={p => setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('page', String(p)); return n; })} />
        </div>
      )}
      {/* 批次 8：<VideoPlayerModal workId={activeWorkId} /> 在此挂载 */}
    </div>
  );
}
