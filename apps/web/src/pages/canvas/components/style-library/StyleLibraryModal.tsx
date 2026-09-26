import { useState, useCallback } from 'react';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { useMenuStore } from '@/stores/menuStore';
import { useStyleLibrary, type StyleTab } from './useStyleLibrary';
import { StyleCard } from './StyleCard';
import { StyleDetailPreview } from './StyleDetailPreview';
import type { StyleSummary } from '@/api/stylesApi';

const TABS: Array<{ key: StyleTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'favorites', label: '我的收藏' },
  { key: 'recent', label: '最近使用' },
];

/** 风格库弹窗（spec §4）——外层早退防未开弹窗也拉数据（H1：useStyleLibrary 的挂载 effect
 *  会无条件发请求，组件常驻 page.tsx——早退必须在使用 hook 之前，故拆内外两层）。 */
export function StyleLibraryModal() {
  const styleLibrary = useMenuStore((s) => s.styleLibrary);
  if (!styleLibrary) return null;
  return <StyleLibraryModalInner nodeId={styleLibrary.nodeId} />;
}

function StyleLibraryModalInner({ nodeId }: { nodeId: string }) {
  const closeStyleLibrary = useMenuStore((s) => s.closeStyleLibrary);
  const [detail, setDetail] = useState<StyleSummary | null>(null);

  // handleUsed useCallback + hook 直传回调（第八轮 A2 收口 P3-6）：对象字面量 { onUsed } 每渲染新建
  // 会使 applyStyle deps [nodeId, onUsed] 失稳 → memo(StyleCard) 恒失效；直传后 handleUsed 稳定 → applyStyle 稳定
  const handleUsed = useCallback(() => {
    setDetail(null); // 先清 detail——防下次开库旧详情浮层复现（P2-1）
    useMenuStore.getState().closeStyleLibrary();
  }, []);
  const lib = useStyleLibrary(nodeId, handleUsed);

  return (
    <BaseFullscreenModal
      open
      onClose={() => (detail ? setDetail(null) : closeStyleLibrary())}
      label="风格库"
    >
      <div
        data-testid="style-library-modal"
        className="relative flex w-[min(1600px,calc(100vw-64px))] flex-col overflow-hidden rounded-xl"
        style={{
          height: 'min(calc(100vh - 160px), 1200px)',
          backgroundColor: 'var(--canvas-controls-bg)',
          border: '0.5px solid var(--canvas-controls-border)',
          boxShadow: 'var(--canvas-shadow-dropdown)',
        }}
      >
        {/* 行1：tabs + 搜索 + 关闭 */}
        <div className="flex h-14 shrink-0 items-center gap-4 px-4">
          <div className="flex h-10 items-center gap-1 rounded-xl border border-[var(--canvas-controls-border)] bg-overlay-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => lib.setTab(t.key)}
                className={`flex h-8 min-w-12 items-center justify-center whitespace-nowrap rounded-lg px-4 text-[15px] transition-colors ${
                  lib.tab === t.key ? 'bg-overlay-3 text-text' : 'text-text-dim-2 hover:bg-overlay-3 hover:text-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex h-10 w-[336px] items-center gap-1 overflow-hidden rounded-lg border border-transparent bg-overlay-2 py-2 pl-4 pr-2 transition-colors focus-within:border-[var(--fw-accent,var(--canvas-controls-border))]">
            <input
              value={lib.searchInput}
              onChange={(e) => lib.setSearchInput(e.target.value)}
              placeholder="搜索风格名称、作者"
              className="text-text placeholder:text-text-dim-2 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => (detail ? setDetail(null) : closeStyleLibrary())}
            className="text-text hover:bg-overlay-2 ml-auto flex size-10 items-center justify-center rounded-lg"
          >
            <svg width="14" height="14" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l13 13M15 2L2 15" /></svg>
          </button>
        </div>
        <div className="h-px shrink-0" style={{ backgroundColor: 'var(--canvas-controls-border)' }} />
        {/* 行2：分类 chips（收藏/最近隐藏）+ 仅看可商用 */}
        {lib.tab === 'all' && (
          <div className="flex shrink-0 items-center gap-2 px-4 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              <button
                type="button"
                onClick={() => lib.setCategoryId(undefined)}
                className={`flex h-7 min-w-12 shrink-0 items-center justify-center rounded-lg px-3 text-[13px] transition-colors ${
                  !lib.categoryId ? 'bg-overlay-3 text-text' : 'text-text-dim-2 hover:bg-overlay-2 hover:text-text'
                }`}
              >
                全部分类
              </button>
              {lib.categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => lib.setCategoryId(c.id)}
                  className={`flex h-7 min-w-12 shrink-0 items-center justify-center rounded-lg px-3 text-[13px] transition-colors ${
                    lib.categoryId === c.id ? 'bg-overlay-3 text-text' : 'text-text-dim-2 hover:bg-overlay-2 hover:text-text'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
            <label className="text-text-dim-2 flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={lib.commercialOnly} onChange={(e) => lib.setCommercialOnly(e.target.checked)} style={{ accentColor: 'currentColor' }} />
              仅看可商用
            </label>
          </div>
        )}
        {lib.useError && <div className="text-text px-4 pt-2 text-[13px]" role="alert">{lib.useError}</div>}
        {/* 主体：5 列网格 + 加载更多 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {lib.error && <div className="text-text-dim-2 py-16 text-center text-[14px]">{lib.error}</div>}
          {!lib.error && lib.items.length === 0 && !lib.loading && (
            <div className="text-text-dim-2 py-16 text-center text-[14px]">
              {lib.searchInput.trim()
                ? '未找到匹配风格'
                : lib.tab === 'favorites' ? '暂无收藏的风格' : lib.tab === 'recent' ? '暂无使用记录' : '未找到匹配风格'}
            </div>
          )}
          <div className="grid grid-cols-5 gap-x-3 gap-y-2">
            {lib.items.map((it) => (
              <StyleCard
                key={it.id}
                item={it}
                isCurrent={it.id === lib.currentStyleId}
                onUse={lib.applyStyle}
                onCancel={lib.clearStyle}
                onFavorite={lib.toggleFavorite}
                onDetail={setDetail}
              />
            ))}
          </div>
          {lib.items.length < lib.total && (
            <button
              type="button"
              onClick={lib.loadMore}
              disabled={lib.loading}
              className="text-text-dim-2 hover:text-text mx-auto mt-2 block rounded-lg px-6 py-2 text-[13px] disabled:opacity-50"
            >
              {lib.loading ? '加载中…' : '加载更多'}
            </button>
          )}
        </div>
        {detail && (
          <StyleDetailPreview item={detail} onUse={lib.applyStyle} onClose={() => setDetail(null)} />
        )}
      </div>
    </BaseFullscreenModal>
  );
}
