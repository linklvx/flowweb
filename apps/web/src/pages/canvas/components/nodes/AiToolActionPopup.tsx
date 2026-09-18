import { memo, useEffect, useRef, useCallback } from 'react';
import type { AiToolId } from '@/stores/nodeStore';
import { AI_TOOL_GROUPS } from './ai/aiToolConfig';

export interface AiToolActionPopupProps {
  open: boolean;
  onClose: () => void;
  onSelect: (toolId: AiToolId) => void;
  anchorEl?: HTMLElement | null;
}

const POPUP_BASE_CLASS =
  'absolute top-full left-1/2 -translate-x-1/2 mt-2 z-[10001] rounded-2xl p-3 border border-[#363636] shadow-[0_4px_10px_rgba(0,0,0,0.25),0_2px_4px_rgba(0,0,0,0.3)]';
const POPUP_BASE_STYLE: React.CSSProperties = {
  backgroundColor: 'oklab(0.26861 0.0000122264 0.00000536442 / 0.95)',
  backdropFilter: 'blur(32px)',
  width: 680,
  maxWidth: 'calc(100vw - 16px)',
};

function AiToolActionPopupComponent({ open, onClose, onSelect }: AiToolActionPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const checkPopupBounds = useCallback(() => {
    if (!popupRef.current) return;
    const popup = popupRef.current;
    popup.style.left = '50%';
    popup.style.transform = 'translateX(-50%)';
    requestAnimationFrame(() => {
      const rect = popup.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        popup.style.left = 'auto';
        popup.style.right = '0';
        popup.style.transform = 'none';
      }
      if (rect.left < 8) {
        popup.style.left = '0';
        popup.style.right = 'auto';
        popup.style.transform = 'none';
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    checkPopupBounds();
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(checkPopupBounds, 100);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
  }, [open, checkPopupBounds]);

  if (!open) return null;

  // Distribute groups into 3 columns — same algorithm as ImageExtConfigPanel
  const flatItems = AI_TOOL_GROUPS.map((g) => ({ group: g }));
  const totalWeight = flatItems.reduce((sum, item) => sum + item.group.items.length + 1, 0);
  const perCol = Math.ceil(totalWeight / 3);
  const cols: typeof flatItems[] = [[], [], []];
  let colIdx = 0;
  let colWeight = 0;
  flatItems.forEach((item) => {
    const w = item.group.items.length + 1;
    if (colWeight > 0 && colWeight + w > perCol && colIdx < 2) {
      colIdx++;
      colWeight = 0;
    }
    cols[colIdx].push(item);
    colWeight += w;
  });

  return (
    <div ref={popupRef} className={POPUP_BASE_CLASS} style={POPUP_BASE_STYLE}>
      <div className="flex gap-3">
        {cols.map((col, ci) => (
          <div key={ci} className="flex-1 flex flex-col gap-1">
            {col.map((item) => (
              <div key={item.group.groupName} className="flex flex-col gap-0.5">
                <div className="px-2 py-1">
                  <span className="text-[#999] text-xs font-medium">{item.group.groupName}</span>
                </div>
                {item.group.items.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => onSelect(tool.id)}
                    className="group flex h-[52px] w-full items-center gap-2 rounded-xl p-2 text-left transition-colors duration-200 text-[#999] hover:bg-white/5"
                  >
                    <div className="relative flex size-[34px] flex-none items-center justify-center rounded-lg bg-white/5">
                      {tool.icon}
                      {tool.isNew && (
                        <span className="pointer-events-none absolute right-[3px] top-[3px] size-1.5 rounded-full bg-[#5DDCFF] border border-[#1a1a1a]" />
                      )}
                    </div>
                    <div className="flex flex-col justify-center overflow-hidden">
                      <span className="text-sm font-medium truncate">{tool.name}</span>
                      <span className="mt-0.5 text-xs leading-4 text-[#999] opacity-0 group-hover:opacity-60 transition-opacity duration-200">
                        {tool.desc}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export const AiToolActionPopup = memo(AiToolActionPopupComponent);
