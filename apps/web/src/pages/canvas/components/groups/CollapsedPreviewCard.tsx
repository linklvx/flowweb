// CollapsedPreviewCard.tsx（§4.5 折叠宫格预览卡——2d-3；2d-4 批量预取单飞接线）
// 结构：预览宫格（padding 6/gap 4/圆角 6）+ summaryRow「N 个节点」；≤6 tile；组色双兜底边框、选中高亮优先。
// 两段渲染（2d-4）：phase1 图标占位（不挂 useMediaUrl tile——React 子 effect 先于父，单段会让 6 tile 各自发请求）；
// 卡片 effect 一次 batchGetMediaRewritten 单飞注册（registerInFlight 去重位），settle 后 phase2 挂 tile：
// 成功 → tile 命中回填缓存 0 请求；失败 → pending 已清，tile 回落单取（batch 失败不阻塞）。
import { memo, useEffect, useState } from 'react';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { batchGetMediaRewritten } from '@/api/mediaApi';
import { getCachedUrl, hasPendingMediaUrl, registerInFlight } from '@/utils/mediaUrlCache';
import { COLLAPSED_SIZE } from '@/utils/groupLayout';
import { resolveGroupColor } from '@/utils/groupColor';
import { GROUP_BOX } from './selectionTokens';

export interface CollapsedPreviewCell { nodeId: string; fileId?: string }

interface Props {
  name: string;
  color?: string;
  selected?: boolean;
  cells: CollapsedPreviewCell[];
  /** 画布团队（canvasStore teamId——NormalGroupRenderer 读 store 显式下行）；缺省走服务端本人默认团队回落 */
  teamId?: string | null;
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

function CollapsedPreviewCardComponent({ name, color, selected = false, cells, teamId }: Props) {
  // ≤6 tile（spec：超 6 取前 6）；列数按 cells 总数（与显示数无关——纯函数单源）
  const shown = cells.slice(0, TILE_MAX);
  const cols = calcCollapsedGrid(cells.length);
  // 2d-4 两段渲染相位：false=phase1 占位；batch settle（或无可预取 fileId）后 true → phase2 挂 tile
  const [tilesReady, setTilesReady] = useState(false);

  // 批量预取单飞：未覆盖（cache/pending 双查）的 fileId 集一次 batch；registerInFlight 每格开位共享同一 promise；
  // settle 后统一 ready——成功路径 tile 读命中缓存（总请求仍 1 次），失败路径 pending 已清逐格单取。
  useEffect(() => {
    const targets = shown.filter((c): c is CollapsedPreviewCell & { fileId: string } =>
      !!c.fileId && !getCachedUrl(c.fileId) && !hasPendingMediaUrl(c.fileId));
    if (targets.length === 0) { setTilesReady(true); return; }
    const ids = targets.map((c) => c.fileId);
    const batchPromise = batchGetMediaRewritten(ids, teamId ?? undefined);
    for (const id of ids) {
      registerInFlight(id, batchPromise.then((rows) => {
        const hit = rows.find((r) => r.id === id);
        if (!hit) throw new Error(`media batch missing ${id}`);
        return { url: hit.url, ttlSec: hit.ttlSec };
      }));
    }
    batchPromise.catch(() => {}).finally(() => setTilesReady(true));
  }, [shown, teamId]);

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
            {tilesReady ? <CollapsedTile fileId={c.fileId} /> : <TileIconPlaceholder />}
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
