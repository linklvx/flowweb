import { useEffect, useRef, useCallback } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useMenuStore } from '@/stores/menuStore';
import { handleEdgeId } from '@/utils/handleMenu';
import { SOURCE_ITEMS, TARGET_ITEMS, type MenuItemDef } from '@/utils/handleMenuItems';

/** spec 2026-09-26-image-node-panel-redesign §3.3：handle 拖拽松手弹出的精简添加节点菜单。
 * 关闭机制照抄 AddNodeMenu：背板遮罩 + Escape（不用 document mousedown——避免触发器/关闭序缺陷）；
 * 面板 chrome 变量（--fw-surface-dim/--fw-border/--canvas-shadow-menu/blur）与 AddNodeMenu 一致。
 * B6-1（Spec B）：SOURCE_ITEMS/TARGET_ITEMS 迁 utils/handleMenuItems.tsx（组件文件清出常量层）。 */

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
