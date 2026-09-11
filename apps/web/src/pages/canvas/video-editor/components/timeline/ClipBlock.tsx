import { memo } from 'react';
import type { Clip, VideoClip } from '../../types';
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
  onKeyframePointerDown?: (kfId: string, e: React.PointerEvent<HTMLDivElement>) => void;
}

export const ClipBlock = memo(function ClipBlock({ clip, pxPerSec, selected, mediaName, onPointerDown, onKeyframePointerDown }: ClipBlockProps) {
  const left = timeToPx(clip.start, pxPerSec);
  const width = Math.max(CLIP_BLOCK_MIN_PX, timeToPx(clip.duration, pxPerSec));
  const label = clip.type === 'subtitle'
    ? clip.text
    : `${mediaName ?? clip.mediaId} · ${formatTimecode(clip.type === 'video' || clip.type === 'audio' ? clip.sourceStart : 0)}`;
  return (
    <div
      data-testid={`clip-block-${clip.id}`}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()} // pointerdown 的 stopPropagation 挡不住后续 click 冒泡到轨道体的 selectClip(null)（Task 14 I2）
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
      {/* 关键帧菱形（video/image 变换 + audio 音量同款分支；as VideoClip 单型视图同 store R5 先例，
          audio 的 title 走音量文案挡 VolumeKeyframe 无 property 的运行时 undefined） */}
      {(clip.type === 'video' || clip.type === 'image' || clip.type === 'audio') && (clip as VideoClip).keyframes.map(k => (
        <div key={k.id} data-testid={`kf-${k.id}`}
          title={clip.type === 'audio' ? `音量 @ ${k.t.toFixed(2)}s` : `${k.property} @ ${k.t.toFixed(2)}s`}
          onPointerDown={(e) => onKeyframePointerDown?.(k.id, e)}
          className="absolute w-2 h-2 bg-white border border-[#6C5CE7] rotate-45 cursor-pointer z-[1]"
          style={{ left: timeToPx(k.t, pxPerSec) - 4, top: '50%', marginTop: -4 }} />
      ))}
    </div>
  );
});
