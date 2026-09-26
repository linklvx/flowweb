import { memo } from 'react';
import type { StyleSummary } from '@/api/stylesApi';

interface StyleCardProps {
  item: StyleSummary;
  isCurrent: boolean;
  onUse: (id: string) => void;
  onCancel: () => void;
  onFavorite: (id: string) => void;
  onDetail: (item: StyleSummary) => void;
}

/** 风格卡片（spec §4.3/D13）——点卡=使用（当前使用卡除外）；三个 hover 按钮全部 stopPropagation。 */
export const StyleCard = memo(function StyleCard({ item, isCurrent, onUse, onCancel, onFavorite, onDetail }: StyleCardProps) {
  return (
    <div
      data-testid={`style-card-${item.id}`}
      className="hover:bg-overlay-2 group relative flex w-full cursor-pointer flex-col gap-2 rounded-xl p-1 transition-colors"
      onClick={(e) => { e.stopPropagation(); if (isCurrent) return; onUse(item.id); }}
    >
      <div
        className={`relative flex flex-col items-start justify-between overflow-hidden rounded-lg border ${isCurrent ? 'border-white' : 'border-transparent'}`}
        style={{ aspectRatio: '3 / 4' }}
      >
        <img src={item.coverUrl} alt={item.name} loading="lazy" decoding="async"
          className="absolute inset-0 size-full object-cover" />
        {isCurrent && <div className="absolute inset-0 bg-black/50" aria-hidden="true" />}
        <div aria-hidden="true" className="from-black/20 pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="relative flex w-full items-center justify-between p-2">
          {isCurrent ? (
            <button
              type="button"
              aria-label="取消使用"
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="flex size-6 items-center justify-center rounded-lg bg-white text-black"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg>
            </button>
          ) : (
            <button
              type="button"
              aria-label="使用"
              onClick={(e) => { e.stopPropagation(); onUse(item.id); }}
              className="flex h-6 items-center overflow-hidden rounded-lg bg-black/65 text-white"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8l4 4L14 4" /></svg>
              </span>
              <span className="max-w-0 truncate whitespace-nowrap pr-0 text-[12px] leading-none opacity-0 transition-[max-width,opacity,padding] duration-150 group-hover:max-w-[3rem] group-hover:pr-2 group-hover:opacity-100">使用</span>
            </button>
          )}
          <button
            type="button"
            aria-label={item.favorited ? '取消收藏' : '收藏'}
            onClick={(e) => { e.stopPropagation(); onFavorite(item.id); }}
            className={`flex size-6 items-center justify-center rounded-lg transition-colors ${item.favorited ? 'bg-black/65 text-white' : 'bg-black/65 text-white opacity-0 group-hover:opacity-100'}`}
          >
            <svg width="13" height="13" viewBox="0 0 22 21" fill={item.favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5"><path d="M11 1.5l2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L2.9 8.1l6.3-.9z" /></svg>
          </button>
        </div>
        <div aria-hidden="true" className="from-black/70 pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="relative flex w-full items-end justify-between p-2">
          {isCurrent && (
            <span className="flex h-6 items-center gap-1 rounded-lg bg-white px-2 py-1 text-[12px] leading-none text-black ring-1 ring-white">
              当前使用
            </span>
          )}
          <button
            type="button"
            aria-label="详情"
            onClick={(e) => { e.stopPropagation(); onDetail(item); }}
            className={`ml-auto flex size-6 items-center justify-center rounded-lg bg-black/65 text-white transition-opacity hover:bg-black/80 ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            <svg width="13" height="13" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 9h14M2 13h9M2 5h6" /></svg>
          </button>
        </div>
      </div>
      <div className="flex w-full flex-col gap-1 px-1">
        <div className="flex w-full items-center gap-2">
          <p className="text-text min-w-0 flex-1 truncate text-[14px] font-medium leading-none">{item.name}</p>
          {item.isCommercial && (
            <div className="text-text-dim-2 flex shrink-0 items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="10" /><path d="M6 11.5l3.2 3.2L16 8" /></svg>
              <span className="text-[12px]">商用</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="size-4 shrink-0 rounded-full bg-overlay-3" aria-hidden="true" />
            <span className="text-text-dim-2 min-w-0 flex-1 truncate text-[12px]">{item.authorName ?? '匿名'}</span>
          </div>
          <span className="text-text-dim-2 shrink-0 text-[12px]">{item.usageCount} 人使用</span>
        </div>
      </div>
    </div>
  );
});
