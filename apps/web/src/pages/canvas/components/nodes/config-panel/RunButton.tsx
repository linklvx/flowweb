import { memo } from 'react';

interface RunButtonProps {
  loading: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function RunButtonComponent({ loading, onClick, disabled }: RunButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title="生成"
      className="size-7 shrink-0 flex items-center justify-center rounded-lg bg-[var(--canvas-run-btn-bg)] transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? '⏳' : (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="text-[var(--canvas-run-btn-icon)]">
          <path d="M4.16699 9.99996L10.0003 4.16663M10.0003 4.16663L15.8337 9.99996M10.0003 4.16663V15.8333" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export const RunButton = memo(RunButtonComponent);
