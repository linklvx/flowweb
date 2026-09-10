import { memo } from 'react';
import type { Clip } from '../../types';
import { formatTimecode } from '../../timeline/timecode';
import { timeToPx } from '../../timeline/view-scale';

const BLOCK_BG: Record<Clip['type'], string> = { video: '#EDE9FE', image: '#E0E7FF', audio: '#DCF7E8', subtitle: '#FFF6DC' };
const BLOCK_BAR: Record<Clip['type'], string> = { video: '#6C5CE7', image: '#5B7CFA', audio: '#43CC80', subtitle: '#FFC53D' };

export const CLIP_BLOCK_MIN_PX = 8;

interface ClipBlockProps {
  clip: Clip;
  pxPerSec: number;
  selected: boolean;
  mediaName?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export const ClipBlock = memo(function ClipBlock({ clip, pxPerSec, selected, mediaName, onPointerDown }: ClipBlockProps) {
  const left = timeToPx(clip.start, pxPerSec);
  const width = Math.max(CLIP_BLOCK_MIN_PX, timeToPx(clip.duration, pxPerSec));
  const label = clip.type === 'subtitle'
    ? clip.text
    : `${mediaName ?? clip.mediaId} · ${formatTimecode(clip.type === 'video' || clip.type === 'audio' ? clip.sourceStart : 0)}`;
  return (
    <div
      data-testid={`clip-block-${clip.id}`}
      onPointerDown={onPointerDown}
      className="absolute top-1 bottom-1 rounded-md overflow-hidden box-border cursor-grab select-none"
      style={{
        left, width, background: BLOCK_BG[clip.type],
        border: `1px solid ${selected ? BLOCK_BAR[clip.type] : 'transparent'}`,
        boxShadow: selected ? `0 0 0 2px ${BLOCK_BAR[clip.type]}40` : undefined,
      }}
    >
      <div className="h-full flex items-center px-1.5" style={{ borderLeft: `3px solid ${BLOCK_BAR[clip.type]}` }}>
        <span className="text-[11px] text-[#4E5969] truncate whitespace-nowrap" style={{ minWidth: 0 }}>
          {label}
        </span>
      </div>
    </div>
  );
});
