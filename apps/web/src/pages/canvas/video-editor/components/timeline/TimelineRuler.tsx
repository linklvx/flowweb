import { totalDuration } from '../../timeline/timecode';
import { timeToPx, pxToTime } from '../../timeline/view-scale';
import { useEditorStore } from '../../store/editorStore';
import { scrubBegin, scrubMove, scrubEnd } from '../../hooks/playback';
import type { ProjectData } from '../../types';
import type React from 'react';

const INTERVALS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];

interface RulerProps {
  data: ProjectData;
  pxPerSec: number;
  widthPx: number;
}

export function TimelineRuler({ data, pxPerSec, widthPx }: RulerProps) {
  const dur = totalDuration(data);
  const playhead = useEditorStore(s => s.playhead);
  const interval = INTERVALS.find(i => i * pxPerSec >= 60) ?? 60;
  const ticks: number[] = [];
  const startSec = 0;
  const endSec = dur + interval; // 余量一格
  for (let t = startSec; t <= endSec; t += interval) ticks.push(Number(t.toFixed(4)));
  const timeAt = (clientX: number, el: HTMLElement) =>
    Math.max(0, pxToTime(clientX - el.getBoundingClientRect().left, pxPerSec));
  // N6：jsdom 无 PointerCapture API（仓内既有风格 setPointerCapture?.——TimelinePanel L50）；hasPointerCapture 可选链 + ?? false
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubBegin(timeAt(e.clientX, e.currentTarget as HTMLElement));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId) ?? false) scrubMove(timeAt(e.clientX, e.currentTarget as HTMLElement));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId) ?? false) scrubEnd();
  };
  return (
    <div data-testid="timeline-ruler"
      className="relative h-7 border-b border-[var(--ve-border)] [border-bottom-style:solid] bg-[var(--ve-panel)] cursor-pointer select-none"
      style={{ width: Math.max(widthPx, timeToPx(dur, pxPerSec) + 60) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {ticks.map(t => (
        <div key={t} className="absolute top-0 bottom-0 flex items-end" style={{ left: timeToPx(t, pxPerSec) }}>
          <div className="w-px h-2 bg-[var(--ve-border)]" />
          <span className="absolute left-1 top-0.5 text-[10px] text-[var(--ve-text-dim)]">{t}s</span>
        </div>
      ))}
      {/* 播放头（紫色，贯穿到轨道区由面板统一渲染竖线） */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-[var(--ve-accent)]" style={{ left: timeToPx(playhead, pxPerSec) }} data-testid="playhead-ruler" />
    </div>
  );
}
