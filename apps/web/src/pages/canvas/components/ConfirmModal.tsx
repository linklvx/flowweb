import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useConfirmModalStore } from '@/stores/confirmModalStore';

function ConfirmModalComponent() {
  const open = useConfirmModalStore((s) => s.isOpen);
  const title = useConfirmModalStore((s) => s.title);
  const content = useConfirmModalStore((s) => s.content);
  const cancelText = useConfirmModalStore((s) => s.cancelText);
  const secondaryText = useConfirmModalStore((s) => s.secondaryText);
  const primaryText = useConfirmModalStore((s) => s.primaryText);
  const primaryType = useConfirmModalStore((s) => s.primaryType);
  const onClose = useConfirmModalStore((s) => s.onClose);
  const onSecondary = useConfirmModalStore((s) => s.onSecondary);
  const onPrimary = useConfirmModalStore((s) => s.onPrimary);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useConfirmModalStore.getState().onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  const primaryStyle = (() => {
    switch (primaryType) {
      case 'primary': return { bg: '#fff', hover: '#e5e5e5', text: '#1A1A1A', border: 'none' };
      case 'danger': return { bg: '#ef4444', hover: '#dc2626', text: '#fff', border: 'none' };
      default: return { bg: 'transparent', hover: '#333', text: '#888', border: '1px solid #333' };
    }
  })();

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex justify-center items-center z-[200]"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-surface-dim rounded-xl p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-base font-medium text-text mb-2">{title}</p>
        <p className="text-sm text-text-dim-2 mb-5">{content}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border text-text-dim-2 rounded-lg text-sm hover:border-text-dim-1 transition-colors"
          >
            {cancelText}
          </button>
          {onSecondary && secondaryText && (
            <button
              onClick={onSecondary}
              className="px-4 py-2 bg-white text-[#1A1A1A] rounded-lg text-sm font-medium hover:bg-[#e5e5e5] transition-colors"
            >
              {secondaryText}
            </button>
          )}
          <button
            onClick={onPrimary}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ backgroundColor: primaryStyle.bg, color: primaryStyle.text, border: primaryStyle.border }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = primaryStyle.hover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = primaryStyle.bg; }}
          >
            {primaryText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const ConfirmModal = memo(ConfirmModalComponent);
