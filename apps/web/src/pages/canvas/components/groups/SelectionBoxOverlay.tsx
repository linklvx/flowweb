// apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx
import { memo, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useStore, useViewport, getNodesBounds, type InternalNode } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';
import { SELECTION_BOX, BADGE, TOOLBAR } from './selectionTokens';

interface Props { onGroup?: (ids: string[]) => void; onMergeStoryboard?: (ids: string[]) => void }

const shallowArrEq = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function SelectionBoxOverlayComponent({ onGroup, onMergeStoryboard }: Props) {
  const selectedInternal = useStore((s) => {
    const arr: InternalNode[] = [];
    s.nodeLookup.forEach((n) => { if (n.selected) arr.push(n); });
    return arr;
  }, shallowArrEq);
  const { x: vpX, y: vpY, zoom } = useViewport();
  const groupNodesAction = useCanvasStore((s) => s.groupNodes);
  const mergeStoryboard = useCanvasStore((s) => (s as any).mergeStoryboard);
  const [open, setOpen] = useState(false);

  const geo = useMemo(() => {
    if (selectedInternal.length < 2) return null;
    const b = getNodesBounds(selectedInternal);
    // padding/offset 为屏幕像素常量：流→屏幕变换后外加，不乘 zoom；
    // titleExtra 为流坐标量（节点标题浮层溢出节点盒上方），随 zoom 缩放
    const left = b.x * zoom + vpX - SELECTION_BOX.padding;
    const top = b.y * zoom + vpY - SELECTION_BOX.padding - SELECTION_BOX.titleExtra * zoom;
    const width = b.width * zoom + SELECTION_BOX.padding * 2;
    const height = b.height * zoom + SELECTION_BOX.padding * 2 + SELECTION_BOX.titleExtra * zoom;
    const centerX = left + width / 2;
    const isAbove = top - TOOLBAR.offset - TOOLBAR.height > 0;
    return {
      left, top, width, height, centerX,
      toolbarTop: isAbove ? top - TOOLBAR.offset : top + height + TOOLBAR.offset,
      toolbarTransform: isAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    };
  }, [selectedInternal, vpX, vpY, zoom]);

  const handleGroup = useCallback(() => {
    const ids = selectedInternal.map((n) => n.id);
    (onGroup ?? groupNodesAction)(ids);
    setOpen(false);
  }, [selectedInternal, onGroup, groupNodesAction]);

  const handleMerge = useCallback(() => {
    const ids = selectedInternal.map((n) => n.id);
    (onMergeStoryboard ?? mergeStoryboard)(ids);
    setOpen(false);
  }, [selectedInternal, onMergeStoryboard, mergeStoryboard]);

  if (!geo) return null;
  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  const selected = selectedInternal as any[];
  const hasGroup = selected.some((n) => n.type === 'group');
  const allImage = selected.every((n) => isImageCompletedNode(n));

  return createPortal(
    <>
      <div
        data-testid="selection-box"
        style={{
          position: 'absolute', left: geo.left, top: geo.top, width: geo.width, height: geo.height,
          border: `${SELECTION_BOX.borderWidth}px ${SELECTION_BOX.borderStyle} ${SELECTION_BOX.borderColor}`,
          borderRadius: SELECTION_BOX.borderRadius, background: SELECTION_BOX.background,
          pointerEvents: 'none', zIndex: 30,
        }}
      >
        <span style={{ ...BADGE, position: 'absolute', top: -11, left: -1 }}>{selectedInternal.length} 项</span>
      </div>
      <div
        role="toolbar"
        style={{
          position: 'absolute', left: geo.centerX, top: geo.toolbarTop, transform: geo.toolbarTransform,
          pointerEvents: 'auto', zIndex: 31,
          background: 'rgba(0,0,0,0.85)', borderRadius: 20, padding: '8px 16px', height: TOOLBAR.height,
          display: 'flex', alignItems: 'center', gap: 12, color: '#fff', fontSize: 13,
        }}
      >
        <span>已选 {selectedInternal.length} 个节点</span>
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
    </>,
    portalRoot,
  );
}
export const SelectionBoxOverlay = memo(SelectionBoxOverlayComponent);
