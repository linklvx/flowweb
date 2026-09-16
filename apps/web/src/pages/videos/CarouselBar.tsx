// CarouselBar.tsx
import { useEffect, useState } from 'react';
import { fetchVideoWorks } from '@/api/videoWorkApi';
import { getPublicSettings } from '@/api/videoWorkApi'; // 新增：GET /api/video-works/settings
import type { VideoWorkListItem, VideoWorkSettings } from '@flowweb/shared';

export function CarouselBar({ currentId, categoryId, onSwitch }: {
  currentId: string; categoryId: string | null; onSwitch: (workId: string) => void;
}) {
  const [settings, setSettings] = useState<VideoWorkSettings | null>(null);
  const [all, setAll] = useState<VideoWorkListItem[]>([]); // 存全量——渲染期派生过滤（C2 Task 8.3 第五轮：勿把 currentId 放请求依赖也勿用 ref，取数/筛选分离）

  useEffect(() => { getPublicSettings().then(setSettings).catch(() => setSettings({ carouselEnabled: true, carouselScope: 'all' })); }, []);
  useEffect(() => {
    if (!settings?.carouselEnabled) return;
    fetchVideoWorks({
      categoryId: settings.carouselScope === 'category' ? (categoryId ?? undefined) : undefined, // null → 降级 all
      page: 1, pageSize: 11,
    }).then(r => setAll(r.items)); // 11 条取回，不在此时过滤
  }, [settings, categoryId]);

  const items = all.filter(w => w.id !== currentId).slice(0, 10); // 渲染期派生：恒排除当前作品（轮播切换 currentId 变化即重算，无残留）

  if (!settings?.carouselEnabled || items.length === 0) return null;
  return (
    <div data-testid="carousel" className="absolute bottom-0 inset-x-0 flex gap-2 px-4 py-3 overflow-x-auto z-10">
      {items.map(w => (
        <button key={w.id} data-testid={`carousel-item-${w.id}`} onClick={() => onSwitch(w.id)}
          className="relative shrink-0 w-[110px] aspect-video rounded-md overflow-hidden ring-1 ring-white/20 hover:ring-white/60 transition-all">
          {w.coverUrl ? <img src={w.coverUrl} alt={w.title} className="w-full h-full object-cover" loading="lazy" />
                       : <div className="w-full h-full bg-white/10" />}
        </button>
      ))}
    </div>
  );
}
