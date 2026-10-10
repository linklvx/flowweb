import { memo } from 'react';

interface RunButtonProps {
  loading: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Y0b-2 T6（Z79 按钮三态文案）：error→「重试（剩 N 次）」/ done→「重新生成」/ otherwise→「执行」——
   *  图标钮以 title+aria-label 表达（规格三态；面板按投影计算传入）。 */
  label?: string;
}

function RunButtonComponent({ loading, onClick, disabled, label }: RunButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title={label ?? '生成'}
      aria-label={label ?? '生成'}
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
