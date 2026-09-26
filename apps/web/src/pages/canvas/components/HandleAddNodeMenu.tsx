import { useEffect, useRef, useCallback } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useMenuStore } from '@/stores/menuStore';
import { handleEdgeId } from './handleMenu';

/** spec 2026-09-26-image-node-panel-redesign §3.3：handle 拖拽松手弹出的精简添加节点菜单。
 * 关闭机制照抄 AddNodeMenu：背板遮罩 + Escape（不用 document mousedown——避免触发器/关闭序缺陷）；
 * 面板 chrome 变量（--fw-surface-dim/--fw-border/--canvas-shadow-menu/blur）与 AddNodeMenu 一致。 */

interface MenuItemDef {
  type: string;
  label: string;
  icon: React.ReactNode;
}

const ICON_TEXT = (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="8" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="2.2" />
    <path d="M11 13H21M11 18H18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
const ICON_IMAGE = (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="7" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2.2" />
    <path d="M10.5 21L14.2 16.7L17 19.5L19.2 16.8L22 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12.5" cy="12.5" r="1.5" fill="currentColor" />
  </svg>
);
const ICON_VIDEO = (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect x="7" y="8" width="18" height="16" rx="4" stroke="currentColor" strokeWidth="2.2" />
    <path d="M14 13.2V18.8L19 16L14 13.2Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
  </svg>
);
const ICON_AUDIO = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M3.5 8v4M7.5 5v10M11.5 7v6M15.5 9v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const SOURCE_ITEMS: MenuItemDef[] = [
  { type: 'textInput', label: '文本', icon: ICON_TEXT },
  { type: 'imageGen', label: '图片', icon: ICON_IMAGE },
  { type: 'videoGen', label: '视频', icon: ICON_VIDEO },
  { type: 'audioGen', label: '音频', icon: ICON_AUDIO },
];
const TARGET_ITEMS: MenuItemDef[] = [
  { type: 'textInput', label: '文本', icon: ICON_TEXT },
  { type: 'imageGen', label: '图片', icon: ICON_IMAGE },
];

export function HandleAddNodeMenu() {
  const handleMenu = useMenuStore((s) => s.handleMenu);
  const closeHandleMenu = useMenuStore((s) => s.closeHandleMenu);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!handleMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeHandleMenu();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handleMenu, closeHandleMenu]);

  // 定位：松手坐标 +8/+8，边界钳制（对齐 AddNodeMenu L167-178）
  useEffect(() => {
    if (!handleMenu || !menuRef.current) return;
    const menuEl = menuRef.current;
    let left = handleMenu.x + 8;
    let top = handleMenu.y + 8;
    const menuHeight = menuEl.offsetHeight;
    const menuWidth = menuEl.offsetWidth;
    if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 8;
    if (top < 8) top = 8;
    if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 8;
    if (left < 8) left = 8;
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }, [handleMenu]);

  const handleItemClick = useCallback((item: MenuItemDef) => {
    const m = useMenuStore.getState().handleMenu;
    if (!m) return;
    const { addNode, addEdge } = useCanvasStore.getState();
    const newId = addNode(item.type, { x: m.flowPoint.x - 125, y: m.flowPoint.y - 30 });
    if (m.side === 'source') {
      addEdge(m.nodeId, newId, undefined, undefined, handleEdgeId(m.nodeId, newId));
    } else {
      addEdge(newId, m.nodeId, undefined, undefined, handleEdgeId(newId, m.nodeId));
    }
    useMenuStore.getState().closeHandleMenu();
  }, []);

  if (!handleMenu) return null;
  const items = handleMenu.side === 'source' ? SOURCE_ITEMS : TARGET_ITEMS;

  return (
    <div
      data-testid="handle-add-node-menu-backdrop"
      className="fixed inset-0 z-[calc(var(--z-panel)-1)]"
      onClick={closeHandleMenu}
      onContextMenu={(e) => { e.preventDefault(); closeHandleMenu(); }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label="添加节点"
        data-testid="handle-add-node-menu"
        className="fixed z-[var(--z-panel)] w-[148px] rounded-2xl py-1 border"
        style={{
          backgroundColor: 'var(--fw-surface-dim)',
          borderColor: 'var(--fw-border)',
          boxShadow: 'var(--canvas-shadow-menu)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 pt-1.5 pb-1 text-xs text-text-dim-2">添加节点</div>
        {items.map((item) => (
          <button
            key={item.type}
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-sm transition-colors hover:bg-overlay-1"
            style={{ color: 'var(--fw-text-strong)' }}
            onClick={() => handleItemClick(item)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
