import { memo, useRef, useEffect } from 'react';
import { useMenuStore } from '@/stores/menuStore';
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore';
import { useHistoryStore } from '@/stores/historyStore';

interface NodePaletteProps {
  onToggleShortcuts?: () => void;
}

const SIDEBAR_BTN =
  'flex items-center justify-center rounded-lg transition-colors h-8 w-8 border-0';
const SIDEBAR_BTN_BG: React.CSSProperties = { backgroundColor: 'var(--canvas-controls-bg)' }; // C8 D3-board：深值字节等值；浅侧 #f0f1f2（pair 已登记）
const SIDEBAR_BTN_HOVER_BG = 'var(--fw-overlay-3)'; // hover 0.2 白≈81 保三态序（同 CanvasToolbar :46 裁定，hover 不进快照）

function NodePaletteComponent({ onToggleShortcuts }: NodePaletteProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isOpen = useMenuStore((s) => s.isOpen);
  const toggle = useMenuStore((s) => s.toggle);
  const setTriggerEl = useMenuStore((s) => s.setTriggerEl);

  // Sync button element to store so page-level AddNodeMenu can use it for positioning
  useEffect(() => {
    setTriggerEl(triggerRef.current);
    return () => setTriggerEl(null);
  }, [setTriggerEl]);

  return (
    <>
      <div
        className="absolute top-1/2 -translate-y-1/2 left-4 z-40 w-12 rounded-xl pt-3 pb-1.5 px-1.5 flex flex-col items-center gap-5"
        style={{
          backgroundColor: 'var(--canvas-controls-bg)',
          border: '0.5px solid var(--canvas-controls-border)',
          backdropFilter: 'blur(8px)',
          boxShadow: 'rgba(0, 0, 0, 0.15) 0px 2px 5px 0px',
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          data-sidebar-btn="add-node"
          className={`${SIDEBAR_BTN} bg-[#f7f7f7] hover:bg-[#e0e0e0]`}
          aria-label="添加节点"
          aria-expanded={isOpen}
          aria-controls="add-node-menu"
          onClick={toggle}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            xmlnsXlink="http://www.w3.org/1999/xlink"
            aria-hidden="true"
            role="img"
            className="pointer-events-none transition-transform duration-200"
            width="14"
            height="14"
            viewBox="0 0 17 17"
            style={{ color: '#0f0f0f', transform: isOpen ? 'rotate(45deg)' : 'none' }}
          >
            <path
              d="M8.5 0C8.99705 8.57272e-06 9.40039 0.475703 9.40039 1.0625V7.59961H15.9375C16.5243 7.59961 17 8.00294 17 8.5C17 8.99706 16.5243 9.40039 15.9375 9.40039H9.40039V15.9375C9.40039 16.5243 8.99705 17 8.5 17C8.00294 17 7.59961 16.5243 7.59961 15.9375V9.40039H1.0625C0.475698 9.40039 7.60586e-08 8.99706 0 8.5C0 8.00294 0.475698 7.59961 1.0625 7.59961H7.59961V1.0625C7.59961 0.475697 8.00294 2.1727e-08 8.5 0Z"
              fill="currentColor"
            />
          </svg>
        </button>

        {/* Material library */}
        <button
          type="button"
          className={SIDEBAR_BTN}
          aria-label="素材库"
          style={SIDEBAR_BTN_BG}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = SIDEBAR_BTN_HOVER_BG; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = SIDEBAR_BTN_BG.backgroundColor!; }}
          onClick={() => useMaterialLibraryStore.getState().open()}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ color: 'var(--canvas-controls-icon)' }}
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {/* History */}
        <button
          type="button"
          className={SIDEBAR_BTN}
          aria-label="历史记录"
          style={SIDEBAR_BTN_BG}
          onClick={() => useHistoryStore.getState().open()}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = SIDEBAR_BTN_HOVER_BG; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = SIDEBAR_BTN_BG.backgroundColor!; }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ color: 'var(--canvas-controls-icon)' }}
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>

        {/* Keyboard shortcuts */}
        <button
          type="button"
          className={SIDEBAR_BTN}
          aria-label="快捷键"
          style={SIDEBAR_BTN_BG}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = SIDEBAR_BTN_HOVER_BG; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = SIDEBAR_BTN_BG.backgroundColor!; }}
          onClick={onToggleShortcuts}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20" height="20" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ color: 'var(--canvas-controls-icon)' }} // 原 stroke="white" 字面（SVG 属性禁 var()，经 style color 双值化）
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 10v6M6 16h12" />
            <path d="M8 12h8" />
          </svg>
        </button>
      </div>
    </>
  );
}

export const NodePalette = memo(NodePaletteComponent);
