// MultiSelectToolbar.tsx
import { memo, useState, useCallback } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';

interface Props { onGroup?: (ids: string[]) => void; onMergeStoryboard?: (ids: string[]) => void }

function MultiSelectToolbarComponent({ onGroup, onMergeStoryboard }: Props) {
  const [open, setOpen] = useState(false);
  const selected = useCanvasStore((s) => s.nodes.filter((n) => n.selected));
  const groupNodes = useCanvasStore((s) => s.groupNodes);
  const mergeStoryboard = useCanvasStore((s) => (s as any).mergeStoryboard);

  const handleGroup = useCallback(() => {
    const ids = selected.map((n) => n.id);
    (onGroup ?? groupNodes)(ids);
    setOpen(false);
  }, [selected, onGroup, groupNodes]);

  const handleMerge = useCallback(() => {
    const ids = selected.map((n) => n.id);
    (onMergeStoryboard ?? mergeStoryboard)(ids);
    setOpen(false);
  }, [selected, onMergeStoryboard, mergeStoryboard]);

  if (selected.length < 2) return null;
  const hasGroup = selected.some((n) => n.type === 'group');
  const allImage = selected.every((n) => isImageCompletedNode(n));

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20"
      style={{ background: 'rgba(0,0,0,0.85)', borderRadius: 20, padding: '8px 16px', height: 40,
               display: 'flex', alignItems: 'center', gap: 12, color: '#fff', fontSize: 13 }}>
      <span>已选 {selected.length} 个节点</span>
      <div className="relative">
        <button disabled={hasGroup} onClick={() => setOpen((v) => !v)}
          style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: hasGroup ? '#666' : '#fff',
                   padding: '6px 12px', borderRadius: 6, cursor: hasGroup ? 'not-allowed' : 'pointer' }}>
          ⊞ 打组 ▾
        </button>
        {open && (
          <div className="absolute top-full mt-1 left-0" style={{ background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, minWidth: 140 }}>
            <button disabled={hasGroup} onClick={handleGroup}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                       background: 'none', border: 'none', color: hasGroup ? '#666' : '#fff', cursor: hasGroup ? 'not-allowed' : 'pointer' }}>
              打组（Ctrl+G）
            </button>
            <button disabled={!allImage} onClick={handleMerge}
              title={!allImage ? '分镜组仅支持含完成图片的节点' : undefined}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                       background: 'none', border: 'none', color: allImage ? '#fff' : '#666', cursor: allImage ? 'pointer' : 'not-allowed' }}>
              合并分镜组（Ctrl+Alt+G）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
export const MultiSelectToolbar = memo(MultiSelectToolbarComponent);
