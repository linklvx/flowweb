import type { StyleSummary } from '@/api/stylesApi';

/** 详情浮层（spec §4.4/D20/B23）——库内 absolute 层挂卡片根（非滚动区），自带 scrim；不用 Modal role。 */
export function StyleDetailPreview({ item, onUse, onClose }: {
  item: StyleSummary; onUse: (id: string) => void; onClose: () => void;
}) {
  return (
    <div
      data-testid="style-detail-scrim"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        data-testid="style-detail-preview"
        role="group"
        aria-label={`风格详情：${item.name}`}
        className="flex w-[860px] max-w-[calc(100%-64px)] gap-4 rounded-2xl p-4"
        style={{ backgroundColor: 'var(--canvas-controls-bg)', border: '1px solid var(--canvas-controls-border)', boxShadow: 'var(--canvas-shadow-dropdown)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={item.coverUrl} alt={item.name} className="h-[420px] w-[315px] shrink-0 rounded-xl object-cover" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-text truncate text-[18px] font-semibold">{item.name}</h3>
            {item.isCommercial && <span className="text-text-dim-2 shrink-0 rounded-md bg-overlay-2 px-1.5 py-0.5 text-[12px]">可商用</span>}
          </div>
          <p className="text-text-dim-2 text-[13px]">作者：{item.authorName ?? '匿名'} · {item.usageCount} 人使用</p>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-overlay-2 p-3">
            <p className="text-text-dim-2 mb-1 text-[12px]">风格提示词</p>
            <p className="text-text whitespace-pre-wrap text-[13px] leading-6">{item.promptText}</p>
          </div>
          <button
            type="button"
            onClick={() => onUse(item.id)}
            className="self-end rounded-lg bg-white px-5 py-2 text-[14px] font-medium text-black transition-opacity hover:opacity-90"
          >
            使用
          </button>
        </div>
      </div>
    </div>
  );
}
