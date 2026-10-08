import { memo } from 'react';

interface CreditDisplayProps {
  cost: number | string | null;   // Y0b-1：null=定价不可用（无规则/未选模型——禁显示 0 免费假象）
}

function CreditDisplayComponent({ cost }: CreditDisplayProps) {
  return (
    <span className="flex shrink-0 items-center gap-[2px] text-[#919191]">
      <svg width="10" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="pointer-events-none">
        <g transform="translate(2.2857 0) scale(0.933347)">
          <path d="M6.79577 0.652118C7.72979 -0.427779 8.49498 -0.136386 8.49498 1.30348V7.47438H11.0956C12.2734 7.47448 12.6016 8.21128 11.8192 9.1111L5.44909 16.491C4.51536 17.5703 3.74914 17.2787 3.74889 15.8396V9.66872H1.14928C-0.0287394 9.66872 -0.356821 8.9309 0.425648 8.03102L6.79577 0.652118Z" fill="currentColor" />
        </g>
      </svg>
      <span className="min-w-5 text-center text-[12px] font-normal leading-[15px]">{cost === null ? '定价不可用' : (cost || '—')}</span>
    </span>
  );
}

export const CreditDisplay = memo(CreditDisplayComponent);
