// apps/web/src/components/storyboard/StoryboardGroupRenderer.tsx
// O0c-2（Spec B）：零 store 纯组件抽迁（原 pages/canvas/components/groups/ 同名件——spec v3.12 终裁：
// 落点=components/storyboard/，ProcessSnapshot/分享视图复用同一分镜渲染组件[终裁 14：否则第 4 面与
// 主画布两套布局]；防 videos→canvas 深层依赖架空"零 store 依赖"红线）。
// removeStoryboardCell 回调与 window Delete 键 effect 参数化/剥离（v3.12：否则只读分享页挂删除热键）：
// onRemoveCell 缺席（公开页）不注册键监听；主画布 GroupNode 注入 (index)=>removeStoryboardCell(id,index)。
// resolveStoryboardConfig 改 import shared 直连（utils/storyboardConfig.ts 具名 re-export 不再经手）。
import { memo, useState, useEffect } from 'react';
import type { GroupNodeData } from '@/types/group';
import { resolveStoryboardConfig } from '@flowweb/shared';
import { StoryboardCell, type CellNodeInfo } from './StoryboardCell';
import { resolveGroupColor } from '@/utils/groupColor';

interface Props {
  id: string;
  data: GroupNodeData;
  /** 双通道同形：主画布 fileId/status（GroupNode 现算）/公开页 thumbnailUrl（deriveRenderCanvas 载荷） */
  cellNodes: CellNodeInfo[];
  /** 主画布通道注入（公开页缺省——无删除热键） */
  onRemoveCell?: (index: number) => void;
}

function StoryboardGroupRendererComponent({ id, data, cellNodes, onRemoveCell }: Props) {
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const cfg = resolveStoryboardConfig(data);
  // 2d-7（F28/v10 裁决 4）：shell 背景/边框换分镜专属 token；组色描边吃组色，
  // 未设色/bogus 回退 --canvas-group-border（NormalGroupRenderer 2c-5 同款单回退点）
  const borderColor = resolveGroupColor(data.color) ?? 'var(--canvas-group-border)';
  const total = cfg.gridRows * cfg.gridCols;
  const byId = new Map(cellNodes.map((c) => [c.id, c]));

  // Delete key handler for cell deletion（O0c-2 参数化：onRemoveCell 缺席=公开页——零注册零热键）
  useEffect(() => {
    if (!onRemoveCell) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // 编辑态守卫：焦点在输入元素时不拦截（对齐 T16 编辑态定义）
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]')) return;

      if (selectedCell !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        e.stopPropagation();
        onRemoveCell(selectedCell);
        setSelectedCell(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true); // capture 阶段拦截
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [selectedCell, id, onRemoveCell]);

  return (
    <div style={{
      // absolute inset:0 覆盖整个节点盒——RF .react-flow__node-group 自带 padding:10px，
      // 静态 100% 尺寸会相对 padding 后的内容盒布局导致格子溢出节点边界
      position: 'absolute', inset: 0,
      border: `1px solid ${borderColor}`, borderRadius: 8,
      background: 'var(--canvas-storyboard-shell-bg)',
      display: 'grid',
      gridTemplateColumns: `repeat(${cfg.gridCols}, 1fr)`,
      gridTemplateRows: `repeat(${cfg.gridRows}, 1fr)`,
      gap: 3,
      padding: 5,
    }}>
      {Array.from({ length: total }, (_, i) => {
        const nodeId = data.cells?.[i];
        const info = nodeId ? byId.get(nodeId) : undefined;
        return (
          <StoryboardCell key={i} index={i}
            info={info} showIndex={cfg.showIndex}
            selectedCell={selectedCell} onSelectCell={setSelectedCell}
            onFillEmpty={(idx) => window.dispatchEvent(new CustomEvent('storyboard:fill-cell', { detail: { groupId: id, index: idx } }))} />
        );
      })}
    </div>
  );
}
export const StoryboardGroupRenderer = memo(StoryboardGroupRendererComponent);
