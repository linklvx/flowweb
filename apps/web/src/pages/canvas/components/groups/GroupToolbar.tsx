// GroupToolbar.tsx — 普通组与分镜组共用容器；分镜组工具栏内容在 Task 11 扩展本组件（switch 渲染）
// R2c-6：普通组行扩展为 [色点][排列子节点▾] │ [折叠][整组执行][转分镜组][解组] │ [批量下载]；
// 浮层交互/水平夹取与 SelectionBoxOverlay（2a-7）同规格（§4.3）：单一 openMenu 状态机 + clampToolbarX
import { memo, useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useViewport, useInternalNode } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { clampToolbarX, type CanvasNodeRecord } from '@flowweb/shared';
import { collectDownloadables } from '@/utils/collectDownloadables';
import { runBatchDownload } from '@/utils/batchDownload';
import { resolveGroupColor, GROUP_PALETTE } from '@/utils/groupColor';
import { GROUP_TOOLBAR } from './selectionTokens';

interface Props {
  groupId: string;
  groupType: 'normal' | 'storyboard';
  collapsed?: boolean;          // R2d-1：仅 normal 分支消费（分镜组不可折叠——storyboard 调用点不再传死值）
  executing: boolean;
  onCollapse?: (id: string) => void;   // 同上——折叠按钮在 normal 条件块内
  onExecute: (id: string) => void;
  onUngroup: (id: string) => void;
  onConvert: (id: string, target: 'normal' | 'storyboard') => void;
  convertible?: boolean; // 默认 true；false 时禁用「转分镜组」按钮
  children?: React.ReactNode; // 分镜组专属按钮插槽（Task 11）
}

type OpenMenu = 'palette' | 'arrange' | null;

const PALETTE_LABEL: Record<(typeof GROUP_PALETTE)[number], string> = {
  red: '红', orange: '橙', yellow: '黄', green: '绿', cyan: '青', blue: '蓝', purple: '紫',
};

const btn = (disabled?: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', color: disabled ? '#666' : '#fff',
  padding: '6px 10px', borderRadius: 6, fontSize: 13, cursor: disabled ? 'not-allowed' : 'pointer',
});
// §4.3 菜单项（同 SelectionBoxOverlay menuItem）
const menuItem = (): React.CSSProperties => ({
  display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px',
  background: 'none', border: 'none', borderRadius: 8, fontSize: 13,
  color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
});
// §4.3 图标按钮（32×32 icon-only，不置 disabled 属性保焦点可达——批量下载用 aria-disabled）
const iconBtn = (disabled?: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, flexShrink: 0, padding: 0,
  background: 'transparent', border: 'none', borderRadius: 8,
  color: disabled ? '#666' : 'inherit', cursor: disabled ? 'not-allowed' : 'pointer',
});
// §4.3 菜单浮层：同容器视觉 min-width 120（同 SelectionBoxOverlay POPUP）
const POPUP: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, marginTop: 4, minWidth: 120, padding: 4, zIndex: 1,
  background: 'var(--canvas-controls-bg)', border: '0.5px solid var(--canvas-controls-border)', borderRadius: 12,
  boxShadow: '0 4px 10px rgba(0,0,0,0.08)', backdropFilter: 'blur(16px)',
};
const DOWNLOAD_SVG = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" />
  </svg>
);

function GroupToolbarComponent(p: Props) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  const internalNode = useInternalNode(p.groupId);
  const setGroupColorAction = useCanvasStore((s) => s.setGroupColor);
  const arrangeGroupChildrenAction = useCanvasStore((s) => s.arrangeGroupChildren);
  const csNodes = useCanvasStore((s) => s.nodes);
  const nsNodes = useNodeStore((s) => s.nodes);
  // 组色读点：仅订阅 color 原始值（nodes 数组高频重建——返回对象会破坏 memo 等值）
  const groupColor = useCanvasStore((s) => {
    const g = s.nodes.find((n) => n.id === p.groupId);
    return g ? (g.data as { color?: string }).color : undefined;
  });
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  // clampToolbarX 测量源：工具条 offsetWidth + portal 容器 clientWidth——jsdom 恒 0，由测试 stub
  const [metrics, setMetrics] = useState({ toolbarW: 0, viewportW: 0 });

  const geo = useMemo(() => {
    const w = internalNode?.measured?.width ?? internalNode?.width ?? 0;
    const h = (internalNode?.measured?.height ?? internalNode?.height ?? 0) * zoom;
    if (!internalNode || w === 0) return null;
    const abs = internalNode.internals.positionAbsolute;
    const centerX = (abs.x + w / 2) * zoom + vpX;
    const topAbs = abs.y * zoom + vpY;
    // 偏移/高度为屏幕常量，变换后外加不乘 zoom
    const isAbove = topAbs - GROUP_TOOLBAR.offset - GROUP_TOOLBAR.height > 0;
    return {
      centerX,
      top: isAbove ? topAbs - GROUP_TOOLBAR.offset : topAbs + h + GROUP_TOOLBAR.offset,
      // x 分量移除（left 即最终左缘，clamp 直接夹取）——transform 仅保留纵向翻转
      transform: isAbove ? 'translateY(-100%)' : 'translateY(0)',
    };
  }, [internalNode, vpX, vpY, zoom]);

  // 水平夹取（§4.3）：x 为不含 translate 的原始左缘——centerX - toolbarW/2 直接夹取
  const toolbarLeft = geo ? clampToolbarX(geo.centerX - metrics.toolbarW / 2, metrics.toolbarW, metrics.viewportW) : 0;

  useLayoutEffect(() => {
    if (!geo) return;
    const w = toolbarRef.current?.offsetWidth ?? 0;
    const vw = document.getElementById('node-toolbar-portal')?.clientWidth ?? 0;
    setMetrics((m) => (m.toolbarW === w && m.viewportW === vw ? m : { toolbarW: w, viewportW: vw }));
  }, [geo]);

  // 浮层交互统一规格（§4.3）：Esc 关 + mousedown outside 关（色板/排列菜单共用）
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

  // 批量下载集（同 SelectionBoxOverlay 2b-4 双侧最小视图桥）：selectedIds=[groupId]——
  // participation('download') 闭包全展开（含 hidden）即组内成员
  const downloadables = useMemo(() => {
    const nsRecords: Record<string, CanvasNodeRecord> = {};
    for (const [id, n] of Object.entries(nsNodes)) {
      nsRecords[id] = { id: n.id, type: n.type, position: { x: 0, y: 0 }, data: n.data as unknown as Record<string, unknown> };
    }
    return collectDownloadables(
      csNodes.map((n) => ({ id: n.id, type: n.type!, parentId: n.parentId, position: n.position, data: n.data })),
      [p.groupId],
      () => nsRecords,
    );
  }, [csNodes, nsNodes, p.groupId]);

  const handleBatchDownload = useCallback(() => {
    if (downloadables.length === 0) return;
    void runBatchDownload(downloadables);
  }, [downloadables]);

  const toggleMenu = useCallback((m: Exclude<OpenMenu, null>) => {
    setOpenMenu((cur) => (cur === m ? null : m));
  }, []);

  const handleArrange = useCallback((mode: 'grid' | 'horizontal' | 'vertical') => {
    arrangeGroupChildrenAction(p.groupId, mode);
    setOpenMenu(null);
  }, [p.groupId, arrangeGroupChildrenAction]);

  if (!geo) return null;
  const portalRoot = document.getElementById('node-toolbar-portal');
  if (!portalRoot) return null;

  const dotColor = resolveGroupColor(groupColor) ?? 'var(--canvas-group-border)'; // 未设色中性点（同组框回退族）

  return createPortal(
    <div
      ref={toolbarRef}
      className="nodrag nopan"
      style={{
        position: 'absolute', left: toolbarLeft, top: geo.top, transform: geo.transform,
        pointerEvents: 'auto', zIndex: 40,
        background: 'rgba(0,0,0,0.85)', borderRadius: 20, padding: '8px 16px', height: GROUP_TOOLBAR.height, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 2, color: '#fff',
      }}
    >
      {p.groupType === 'normal' && (
        <>
          <button
            aria-label="组颜色" aria-haspopup="listbox" aria-expanded={openMenu === 'palette'}
            style={{ ...btn(), padding: '6px 8px', display: 'inline-flex', alignItems: 'center' }}
            onClick={() => toggleMenu('palette')}
          >
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: dotColor, border: '1px solid var(--canvas-controls-border)', display: 'block' }} />
          </button>
          {openMenu === 'palette' && (
            <div role="listbox" aria-label="组颜色" className="nodrag nopan absolute top-full left-0" style={POPUP}>
              {GROUP_PALETTE.map((key) => (
                <button
                  key={key} role="option" aria-selected={groupColor === key} style={menuItem()}
                  onClick={() => { setGroupColorAction(p.groupId, key); setOpenMenu(null); }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: resolveGroupColor(key), display: 'inline-block' }} />
                    {PALETTE_LABEL[key]}
                  </span>
                </button>
              ))}
              <button
                role="option" aria-selected={groupColor === undefined} style={menuItem()}
                onClick={() => { setGroupColorAction(p.groupId, undefined); setOpenMenu(null); }}
              >
                默认
              </button>
            </div>
          )}
          <div className="relative">
            <button
              style={btn(p.collapsed)} disabled={p.collapsed}
              aria-haspopup="menu" aria-expanded={openMenu === 'arrange'}
              onClick={() => toggleMenu('arrange')}
            >
              排列子节点 ▾
            </button>
            {openMenu === 'arrange' && (
              <div role="menu" className="nodrag nopan absolute top-full left-0" style={POPUP}>
                <button role="menuitem" style={menuItem()} onClick={() => handleArrange('grid')}>网格</button>
                <button role="menuitem" style={menuItem()} onClick={() => handleArrange('horizontal')}>水平</button>
                <button role="menuitem" style={menuItem()} onClick={() => handleArrange('vertical')}>垂直</button>
              </div>
            )}
          </div>
          <Sep />
          <button style={btn()} onClick={() => p.onCollapse?.(p.groupId)}>{p.collapsed ? '展开' : '折叠'}</button>
          <Sep />
          <button style={btn(p.executing)} disabled={p.executing} onClick={() => !p.executing && p.onExecute(p.groupId)}>▶ 整组执行</button>
          <Sep />
          <ConvertButton p={p} />
          <Sep />
          <button style={btn(p.executing)} disabled={p.executing} onClick={() => !p.executing && p.onUngroup(p.groupId)}>⧉ 解组</button>
          <Sep />
          <button
            type="button"
            aria-label="批量下载"
            aria-disabled={downloadables.length === 0}
            style={iconBtn(downloadables.length === 0)}
            onClick={handleBatchDownload}
          >
            {DOWNLOAD_SVG}
          </button>
        </>
      )}
      {p.groupType === 'storyboard' && p.children}
    </div>,
    portalRoot,
  );
}

function ConvertButton({ p }: { p: Props }) {
  const disabled = p.executing || p.convertible === false;
  return <button style={btn(disabled)} disabled={disabled} onClick={() => !disabled && p.onConvert(p.groupId, 'storyboard')} title={p.convertible === false ? '仅包含图片节点的组可转为分镜组' : undefined}>▦ 转分镜组</button>;
}

const Sep = () => <span style={{ color: 'var(--canvas-controls-icon)', padding: '0 4px' }}>│</span>;

export const GroupToolbar = memo(GroupToolbarComponent);
