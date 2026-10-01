// apps/web/src/pages/canvas/components/groups/SelectionBoxOverlay.tsx
import { memo, useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore, useViewport, getNodesBounds, type InternalNode } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { clampToolbarX } from '@flowweb/shared';
import { isImageCompletedNode } from '@/utils/imageNodeGuards';
import { SELECTION_BOX, BADGE, SELECTION_TOOLBAR } from './selectionTokens';

interface Props { onGroup?: (ids: string[]) => void; onMergeStoryboard?: (ids: string[]) => void }

type OpenMenu = 'group' | 'arrange' | null;

const shallowArrEq = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// §4.3 按钮：h-8 / px-2 / 圆角 8 / 13px / controls-text（继承容器）
const triggerBtn = (disabled?: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 8px',
  background: 'transparent', border: 'none', borderRadius: 8, fontSize: 13,
  color: disabled ? '#666' : 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
});
const menuItem = (disabled?: boolean): React.CSSProperties => ({
  display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px',
  background: 'none', border: 'none', borderRadius: 8, fontSize: 13,
  color: disabled ? '#666' : 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
});
// §4.3 菜单浮层：同容器视觉（圆角 12 / 0.5px 边框 / 阴影 / blur）min-width 120
const POPUP: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, marginTop: 4, minWidth: 120, padding: 4, zIndex: 1,
  background: 'var(--canvas-controls-bg)', border: '0.5px solid var(--canvas-controls-border)', borderRadius: 12,
  boxShadow: '0 4px 10px rgba(0,0,0,0.08)', backdropFilter: 'blur(16px)',
};

function SelectionBoxOverlayComponent({ onGroup, onMergeStoryboard }: Props) {
  const selectedInternal = useStore((s) => {
    const arr: InternalNode[] = [];
    // B 端兜底（R2a-0）：hidden 子节点（stale selected——selected 不进协作投影）不入选框集合
    s.nodeLookup.forEach((n) => { if (n.hidden) return; if (n.selected) arr.push(n); });
    return arr;
  }, shallowArrEq);
  const { x: vpX, y: vpY, zoom } = useViewport();
  const groupNodesAction = useCanvasStore((s) => s.groupNodes);
  const arrangeSelectionAction = useCanvasStore((s) => s.arrangeSelection);
  const duplicateNodesAction = useCanvasStore((s) => s.duplicateNodes);
  const mergeStoryboard = useCanvasStore((s) => (s as any).mergeStoryboard);
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  // clampToolbarX 测量源：工具条 offsetWidth（内容宽）+ portal 容器 clientWidth（视口宽）——jsdom 恒 0，由测试 stub
  const [metrics, setMetrics] = useState({ toolbarW: 0, viewportW: 0 });

  const geo = useMemo(() => {
    if (selectedInternal.length < 2 || marqueeSelecting) return null;
    const b = getNodesBounds(selectedInternal);
    // padding/offset 为屏幕像素常量：流→屏幕变换后外加，不乘 zoom；
    // titleExtra 为流坐标量（节点标题浮层溢出节点盒上方），随 zoom 缩放
    const left = b.x * zoom + vpX - SELECTION_BOX.padding;
    const top = b.y * zoom + vpY - SELECTION_BOX.padding - SELECTION_BOX.titleExtra * zoom;
    const width = b.width * zoom + SELECTION_BOX.padding * 2;
    const height = b.height * zoom + SELECTION_BOX.padding * 2 + SELECTION_BOX.titleExtra * zoom;
    const centerX = left + width / 2;
    const isAbove = top - SELECTION_TOOLBAR.offset - SELECTION_TOOLBAR.height > 0;
    return {
      left, top, width, height, centerX,
      toolbarTop: isAbove ? top - SELECTION_TOOLBAR.offset : top + height + SELECTION_TOOLBAR.offset,
      toolbarTransform: isAbove ? 'translateY(-100%)' : 'translateY(0)',
    };
  }, [selectedInternal, vpX, vpY, zoom, marqueeSelecting]);

  // 水平夹取（§4.3）：x 为不含 translate 的原始左缘——centerX - toolbarW/2 直接夹取，transform 仅保留纵向翻转
  const toolbarLeft = geo ? clampToolbarX(geo.centerX - metrics.toolbarW / 2, metrics.toolbarW, metrics.viewportW) : 0;

  useLayoutEffect(() => {
    if (!geo) return;
    const w = toolbarRef.current?.offsetWidth ?? 0;
    const vw = document.getElementById('node-toolbar-portal')?.clientWidth ?? 0;
    setMetrics((m) => (m.toolbarW === w && m.viewportW === vw ? m : { toolbarW: w, viewportW: vw }));
  }, [geo]);

  // 浮层交互统一规格（§4.3）：Esc 关 + mousedown outside 关（排列菜单/打组下拉共用）
  useEffect(() => {
    if (!openMenu) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    const onMouseDown = (e: MouseEvent) => {
      if (toolbarRef.current && e.target instanceof Element && !toolbarRef.current.contains(e.target)) setOpenMenu(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [openMenu]);

  const selectedIds = useMemo(() => selectedInternal.map((n) => n.id), [selectedInternal]);

  const toggleMenu = useCallback((m: Exclude<OpenMenu, null>) => {
    setOpenMenu((cur) => (cur === m ? null : m));
  }, []);

  const handleGroup = useCallback(() => {
    (onGroup ?? groupNodesAction)(selectedIds);
    setOpenMenu(null);
  }, [selectedIds, onGroup, groupNodesAction]);

  const handleMerge = useCallback(() => {
    (onMergeStoryboard ?? mergeStoryboard)(selectedIds);
    setOpenMenu(null);
  }, [selectedIds, onMergeStoryboard, mergeStoryboard]);

  const handleArrange = useCallback((mode: 'grid' | 'horizontal' | 'vertical') => {
    arrangeSelectionAction(selectedIds, mode);
    setOpenMenu(null);
  }, [selectedIds, arrangeSelectionAction]);

  const handleDuplicate = useCallback(() => {
    duplicateNodesAction(selectedIds);
  }, [selectedIds, duplicateNodesAction]);

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
        ref={toolbarRef}
        role="toolbar"
        className="nodrag nopan"
        style={{
          position: 'absolute', left: toolbarLeft, top: geo.toolbarTop, transform: geo.toolbarTransform,
          pointerEvents: 'auto', zIndex: 31,
          background: 'var(--canvas-controls-bg)', border: '0.5px solid var(--canvas-controls-border)',
          borderRadius: 12, padding: 8, height: SELECTION_TOOLBAR.height, boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: 8,
          color: 'var(--canvas-controls-text)', fontSize: 13,
          boxShadow: '0 4px 10px rgba(0,0,0,0.08)', backdropFilter: 'blur(16px)',
        }}
      >
        <span>已选 {selectedInternal.length} 个节点</span>
        <div className="relative">
          <button aria-haspopup="menu" aria-expanded={openMenu === 'arrange'} onClick={() => toggleMenu('arrange')} style={triggerBtn()}>
            排列 ▾
          </button>
          {openMenu === 'arrange' && (
            <div role="menu" className="nodrag nopan absolute top-full left-0" style={POPUP}>
              <button role="menuitem" style={menuItem()} onClick={() => handleArrange('grid')}>网格</button>
              <button role="menuitem" style={menuItem()} onClick={() => handleArrange('horizontal')}>水平</button>
              <button role="menuitem" style={menuItem()} onClick={() => handleArrange('vertical')}>垂直</button>
            </div>
          )}
        </div>
        <div className="relative">
          <button disabled={hasGroup} aria-haspopup="menu" aria-expanded={openMenu === 'group'} onClick={() => toggleMenu('group')} style={triggerBtn(hasGroup)}>
            ⊞ 打组 ▾
          </button>
          {openMenu === 'group' && (
            <div role="menu" className="nodrag nopan absolute top-full left-0" style={POPUP}>
              <button role="menuitem" disabled={hasGroup} style={menuItem(hasGroup)} onClick={handleGroup}>
                打组（Ctrl+G）
              </button>
              <button role="menuitem" disabled={!allImage} onClick={handleMerge}
                title={!allImage ? '分镜组仅支持含完成图片的节点' : undefined} style={menuItem(!allImage)}>
                合并分镜组（Ctrl+Alt+G）
              </button>
            </div>
          )}
        </div>
        <button style={triggerBtn()} onClick={handleDuplicate}>创建副本</button>
      </div>
    </>,
    portalRoot,
  );
}
export const SelectionBoxOverlay = memo(SelectionBoxOverlayComponent);
