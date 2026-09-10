import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface BaseFullscreenModalProps {
  open: boolean;
  onClose: () => void;
  label: string;
  /** 点遮罩是否关闭；默认 true。视频编辑器等误触敏感场景传 false */
  closeOnBackdrop?: boolean;
  triggerRef?: React.RefObject<HTMLElement>;
  initialFocusRef?: React.RefObject<HTMLElement>;
  children: ReactNode;
}

export function BaseFullscreenModal({
  open,
  onClose,
  label,
  closeOnBackdrop = true,
  triggerRef,
  initialFocusRef,
  children,
}: BaseFullscreenModalProps) {
  // Scroll lock — only activates when open transitions to true
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Focus management — cleanup handles both close AND unmount uniformly
  useEffect(() => {
    if (!open) return;

    const rafId = requestAnimationFrame(() => {
      initialFocusRef?.current?.focus();
    });

    return () => {
      cancelAnimationFrame(rafId);
      triggerRef?.current?.focus();
    };
  }, [open, initialFocusRef, triggerRef]);

  // Escape key — mounted only when open
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
