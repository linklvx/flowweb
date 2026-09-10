import { totalDuration } from '../../timeline/timecode';
import { timeToPx, pxToTime } from '../../timeline/view-scale';
import { quantizeTime } from '../../timeline/clip-math';
import type { ProjectData } from '../../types';
import type React from 'react';

const INTERVALS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];

interface RulerProps {
  data: ProjectData;
  pxPerSec: number;
  playhead: number;
  widthPx: number;
  onSeek?: (t: number) => void;
}

export function TimelineRuler({ data, pxPerSec, playhead, widthPx, onSeek }: RulerProps) {
  const dur = totalDuration(data);
  const interval = INTERVALS.find(i => i * pxPerSec >= 60) ?? 60;
  const ticks: number[] = [];
  const startSec = 0;
  const endSec = dur + interval; // 余量一格
  for (let t = startSec; t <= endSec; t += interval) ticks.push(Number(t.toFixed(4)));
  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(quantizeTime(Math.max(0, pxToTime(e.clientX - rect.left, pxPerSec))));
  };
  return (
    <div data-testid="timeline-ruler"
      className="relative h-7 border-b border-[#E5E7EB] [border-bottom-style:solid] bg-white cursor-pointer select-none"
      style={{ width: Math.max(widthPx, timeToPx(dur, pxPerSec) + 60) }}
      onPointerDown={handlePointer}
    >
      {ticks.map(t => (
        <div key={t} className="absolute top-0 bottom-0 flex items-end" style={{ left: timeToPx(t, pxPerSec) }}>
          <div className="w-px h-2 bg-[#C9CDD4]" />
          <span className="absolute left-1 top-0.5 text-[10px] text-[#86909C]">{t}s</span>
        </div>
      ))}
      {/* 播放头（紫色，贯穿到轨道区由面板统一渲染竖线） */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-[#6C5CE7]" style={{ left: timeToPx(playhead, pxPerSec) }} data-testid="playhead-ruler" />
    </div>
  );
}
