import { useCallback, useEffect, useState } from 'react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { apiFetch } from '@/api/client';
import type { PublicHomeBanner } from '@flowweb/shared';

const AUTOPLAY_INTERVAL = 5000;

export function BannerCarousel() {
  const [banners, setBanners] = useState<PublicHomeBanner[] | null>(null); // null = 加载中
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PublicHomeBanner[]>('/home-banners/active')
      .then((items) => { if (!cancelled) setBanners(items); })
      .catch(() => { if (!cancelled) setBanners([]); });
    return () => { cancelled = true; };
  }, []);

  const list = (banners ?? []).filter((b) => !failed.has(b.id));
  const count = list.length;
  const current = count > 0 ? list[index % count] : null;

  const next = useCallback(() => setIndex((i) => (count ? (i + 1) % count : 0)), [count]);
  const prev = useCallback(() => setIndex((i) => (count ? (i - 1 + count) % count : 0)), [count]);

  useEffect(() => {
    if (banners === null || count <= 1 || paused) return;
    const timer = setInterval(next, AUTOPLAY_INTERVAL);
    return () => clearInterval(timer); // unmount/暂停均清理
  }, [banners, count, paused, next]);

  if (banners === null) {
    return <div data-testid="banner-skeleton" className="w-full aspect-[8/1] rounded-xl bg-[#1e1e1e] mb-3 animate-pulse" />;
  }
  if (!current) return null;

  const single = count === 1;
  const currentIndex = index % count;

  return (
    <div
      data-testid="banner-carousel"
      className="group relative w-full aspect-[8/1] rounded-xl overflow-hidden mb-3 bg-[#1e1e1e]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {list.map((b, i) => (
        <img
          key={b.id}
          src={b.imageUrl}
          alt={b.title ?? ''}
          onError={() => setFailed((prev) => { const s = new Set(prev); s.add(b.id); return s; })}
          onClick={() => { if (b.linkUrl) window.open(b.linkUrl, '_blank', 'noopener noreferrer'); }}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 cursor-pointer"
          style={{ opacity: i === currentIndex ? 1 : 0, pointerEvents: i === currentIndex ? 'auto' : 'none' }}
        />
      ))}

      {(current.title || current.subtitle) && (
        <div className="absolute inset-y-0 left-8 flex flex-col justify-center pointer-events-none z-10">
          {current.title && (
            <span className="text-[28px] font-bold text-white" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
              {current.title}
            </span>
          )}
          {current.subtitle && <span className="text-sm text-white/80 mt-1">{current.subtitle}</span>}
        </div>
      )}

      {!single && (
        <>
          <button
            aria-label="上一张"
            onClick={prev}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur text-white flex items-center justify-center border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <LeftOutlined className="text-base" />
          </button>
          <button
            aria-label="下一张"
            onClick={next}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur text-white flex items-center justify-center border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <RightOutlined className="text-base" />
          </button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
            {list.map((b, i) => (
              <button
                key={b.id}
                aria-label={`跳转到第 ${i + 1} 张`}
                onClick={() => setIndex(i)}
                className={`rounded-full border-none cursor-pointer p-0 transition-all duration-300 ${
                  i === currentIndex ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/40'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
