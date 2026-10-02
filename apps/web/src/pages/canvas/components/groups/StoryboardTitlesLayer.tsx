// StoryboardTitlesLayer.tsx — R2d-5 分镜智能标题屏幕层（单例共享层）
// ONE 组件一次 useViewport 订阅渲染画布全部分镜组标题（常驻，非选中门控）；
// flow→screen 换算同 SelectionBoxOverlay（flowX·zoom + vp.x）；标题带锚 = frame.top−gap（§4.4 双带上带）。
// 容器与标题均 pointer-events:none（标题不可点）——工具条 portal 'auto' 约定不受影响。
import { memo } from 'react';
import { useViewport } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import type { GroupNodeData } from '@/types/group';
import { STORYBOARD_TITLE } from './selectionTokens';

// 数组选择器浅相等（同 SelectionBoxOverlay shallowArrEq 先例）——filter 每次返回新数组，无此则任意 store 更新都触发重渲
const shallowArrEq = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function StoryboardTitlesLayerComponent() {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const groups = useCanvasStore((s) => s.nodes.filter(
    (n) => n.type === 'group' && (n.data as GroupNodeData).groupType === 'storyboard',
  ), shallowArrEq);

  return (
    <div
      data-testid="storyboard-titles-layer"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {groups.map((g) => {
        const data = g.data as GroupNodeData;
        // nameCustom 语义（§4.4）：改名走用户名（2d-6 renameGroup 置位），否则智能标题（空槽不计）
        const title = data.nameCustom
          ? (data.name ?? '')
          : `分镜组 ${(data.cells ?? []).filter(Boolean).length} 个节点`;
        return (
          <div
            key={g.id}
            data-testid="storyboard-title"
            style={{
              position: 'absolute',
              left: g.position.x * zoom + vpX,
              top: g.position.y * zoom + vpY - STORYBOARD_TITLE.gap,
              transform: 'translateY(-100%)', // 行高 rowH 上浮——标题占 [锚−20, 锚]，带底距组框 gap 12
              lineHeight: `${STORYBOARD_TITLE.rowH}px`,
              fontSize: 13, // 屏幕常量不随 zoom 缩放
              color: 'var(--fw-text-dim-3)',
              maxWidth: STORYBOARD_TITLE.maxWidth,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {title}
          </div>
        );
      })}
    </div>
  );
}
export const StoryboardTitlesLayer = memo(StoryboardTitlesLayerComponent);
