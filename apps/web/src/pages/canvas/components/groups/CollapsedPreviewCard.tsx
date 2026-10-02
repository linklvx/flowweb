// CollapsedPreviewCard.tsx（§4.5 折叠宫格预览卡——2d-3）
// 结构：预览宫格（padding 6/gap 4/圆角 6）+ summaryRow「N 个节点」；≤6 tile；组色双兜底边框、选中高亮优先。
// tile 的批量预取单飞在 2d-4 接线（本组件 tiles 现走 useMediaUrl 常规渲染，fileIds≤6 由 cells 汇总即得）。
import { memo } from 'react';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { COLLAPSED_SIZE } from '@/utils/groupLayout';
import { resolveGroupColor } from '@/utils/groupColor';
import { GROUP_BOX } from './selectionTokens';

export interface CollapsedPreviewCell { nodeId: string; fileId?: string }

interface Props {
  name: string;
  color?: string;
  selected?: boolean;
  cells: CollapsedPreviewCell[];
}

const TILE_MAX = 6;

/** 列数单源：1-2→按数量（1→1/2→2）；3-4→2 列；5+→3 列；0 兜底 1 列（防 repeat(0,1fr) 无效轨道） */
export function calcCollapsedGrid(count: number): number {
  if (count <= 0) return 1;
  if (count <= 2) return count;
  if (count <= 4) return 2;
  return 3;
}

function TileIconPlaceholder() {
  return (
    <div
      data-testid="collapsed-tile-placeholder"
      style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}
      aria-hidden
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    </div>
  );
}

function CollapsedTile({ fileId }: { fileId?: string }) {
  // 取图同 StoryboardCell（P0-2）：URL 一律经 useMediaUrl(fileId) 现取+缓存自愈，JSON 响应不能直接作 src
  const { url, onError } = useMediaUrl(fileId ?? null);
  if (!fileId || !url) return <TileIconPlaceholder />;
  return (
    <img
      data-testid="collapsed-tile-img"
      src={url} alt="" loading="lazy" decoding="async"
      onError={onError}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}

function CollapsedPreviewCardComponent({ name, color, selected = false, cells }: Props) {
  // ≤6 tile（spec：超 6 取前 6）；列数按 cells 总数（与显示数无关——纯函数单源）
  const shown = cells.slice(0, TILE_MAX);
  const cols = calcCollapsedGrid(cells.length);
  // 组色双兜底；选中高亮 > 组色（GROUP_BOX.selectedBorder——折叠卡选中样式现状族）
  const borderColor = selected
    ? GROUP_BOX.selectedBorder
    : resolveGroupColor(color) ?? 'var(--canvas-group-border)';

  return (
    <div
      data-testid="collapsed-preview-card"
      title={name}
      aria-label={`${name}，${cells.length} 个节点`}
      style={{
        // 2d-1 不变量载体：折叠分支根 div 显式尺寸引 COLLAPSED_SIZE（信封恒等可见盒）
        width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height, boxSizing: 'border-box',
        borderRadius: GROUP_BOX.borderRadius,
        border: `${GROUP_BOX.borderWidth}px dashed ${borderColor}`,
        background: 'rgba(26,26,26,0.9)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      <div
        data-testid="collapsed-preview-grid"
        style={{
          flex: 1, minHeight: 0,
          display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoRows: 'minmax(0, 1fr)',
          gap: 4, padding: 6, borderRadius: 6,
        }}
      >
        {shown.map((c) => (
          <div
            key={c.nodeId}
            data-testid="collapsed-tile"
            style={{ overflow: 'hidden', background: 'var(--canvas-controls-bg)' }}
          >
            <CollapsedTile fileId={c.fileId} />
          </div>
        ))}
      </div>
      <div
        data-testid="collapsed-preview-summary"
        style={{ textAlign: 'center', fontSize: 11, lineHeight: '16px', color: '#999', paddingBottom: 4 }}
      >
        {cells.length} 个节点
      </div>
    </div>
  );
}

export const CollapsedPreviewCard = memo(CollapsedPreviewCardComponent);
