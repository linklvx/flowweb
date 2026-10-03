import { useEffect, useRef, useCallback } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useMenuStore } from '@/stores/menuStore';
import { SOURCE_ITEMS, type MenuItemDef } from '@/utils/handleMenuItems';

/** B6-3（Spec B 需求 7 / 拍板②）：+号点击/拖线落空（含 hidden——resolveBatchDropTarget 排除=落空
 * 同语义）弹出的批量建点菜单。HandleAddNodeMenu 同构：关闭机制（背板遮罩+Escape）/定位钳制/
 * chrome 变量全照抄；选中项 → addNodeAndBatchConnect（建点+源集→新节点 N 边单 transact 单 undo
 * ——:82-92 addNode+addEdge 同手势先例）。菜单项=SOURCE_ITEMS（新节点=目标——side 'source' 语义）。
 */
export function BatchAddNodeMenu() {
  const batchMenu = useMenuStore((s) => s.batchMenu);
  const closeBatchMenu = useMenuStore((s) => s.closeBatchMenu);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!batchMenu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBatchMenu();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [batchMenu, closeBatchMenu]);

  // 定位：触发点 +8/+8，边界钳制（HandleAddNodeMenu 同款——对齐 AddNodeMenu L167-178）
  useEffect(() => {
    if (!batchMenu || !menuRef.current) return;
    const menuEl = menuRef.current;
    let left = batchMenu.x + 8;
    let top = batchMenu.y + 8;
    const menuHeight = menuEl.offsetHeight;
    const menuWidth = menuEl.offsetWidth;
    if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight - 8;
    if (top < 8) top = 8;
    if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 8;
    if (left < 8) left = 8;
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }, [batchMenu]);

  const handleItemClick = useCallback((item: MenuItemDef) => {
    const m = useMenuStore.getState().batchMenu;
    if (!m) return;
    // HandleAddNodeMenu:46 同款落位：flowPoint-125/-30（先例字面）
    useCanvasStore.getState().addNodeAndBatchConnect(item.type, { x: m.flowPoint.x - 125, y: m.flowPoint.y - 30 }, m.sourceIds);
    useMenuStore.getState().closeBatchMenu();
  }, []);

  if (!batchMenu) return null;

  return (
    <div
      data-testid="batch-add-node-menu-backdrop"
      className="fixed inset-0 z-[calc(var(--z-panel)-1)]"
      onClick={closeBatchMenu}
      onContextMenu={(e) => { e.preventDefault(); closeBatchMenu(); }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label="添加节点"
        data-testid="batch-add-node-menu"
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
        {SOURCE_ITEMS.map((item) => (
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
