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
      className="size-7 shrink-0 flex items-center justify-center rounded-lg cursor-pointer border-none bg-[#3a3a3a] transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? '⏳' : (
        <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="size-3 text-[#999]" width="12" height="12" viewBox="0 0 18 18">
          <path d="M8.29289 0.292893C8.68342 -0.0976311 9.31658 -0.0976311 9.70711 0.292893L17.7071 8.29289C18.0976 8.68342 18.0976 9.31658 17.7071 9.70711C17.3166 10.0976 16.6834 10.0976 16.2929 9.70711L10 3.41421V17C10 17.5523 9.55229 18 9 18C8.44772 18 8 17.5523 8 17V3.41421L1.70711 9.70711C1.31658 10.0976 0.683418 10.0976 0.292893 9.70711C-0.0976311 9.31658 -0.0976311 8.68342 0.292893 8.29289L8.29289 0.292893Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}

export const RunButton = memo(RunButtonComponent);
