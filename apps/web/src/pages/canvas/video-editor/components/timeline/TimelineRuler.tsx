import { memo } from 'react';
import { totalDuration } from '../../timeline/timecode';
import { timeToPx, pxToTime, TRACK_HEADER_W } from '../../timeline/view-scale';
import { useEditorStore } from '../../store/editorStore';
import { scrubBegin, scrubMove, scrubEnd } from '../../hooks/playback';
import type { ProjectData } from '../../types';
import type React from 'react';

const INTERVALS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];

interface RulerProps {
  data: ProjectData;
  pxPerSec: number;
  widthPx: number;
  /** 滚动容器 scrollLeft（TimelinePanel onScroll rAF single-flight 节流透传）——窗口化只渲染视口内刻度 */
  scrollLeft: number;
}

// memo：scrollLeft 变化只重渲标尺自身——TrackRow/ClipBlock 不随滚动每帧重渲（R3⑥）
export const TimelineRuler = memo(function TimelineRuler({ data, pxPerSec, widthPx, scrollLeft }: RulerProps) {
  const dur = totalDuration(data);
  const playhead = useEditorStore(s => s.playhead);
  const interval = INTERVALS.find(i => i * pxPerSec >= 60) ?? 60;
  // 窗口化（900s@500pxps 全量 3602 tick div → 视口内 <300）。
  // 统一口径：标尺局部坐标原点在内容 x=TRACK_HEADER_W 之后——可见区在标尺局部 = [scrollLeft-140, scrollLeft+viewportW-140]
  const viewportW = widthPx + TRACK_HEADER_W; // widthPx 是轨道体宽（viewportW-140），还原滚动容器视口宽
  const ticks: number[] = [];
  const visibleStart = Math.max(0, pxToTime(scrollLeft - TRACK_HEADER_W, pxPerSec) - interval); // 扣轨头列宽——不扣则左缘 140px 无刻度带
  const visibleEnd = pxToTime(scrollLeft + viewportW, pxPerSec) + interval; // 终点多渲 140px 冗余 tick——无害
  const endSec = Math.min(dur + interval, visibleEnd);
  for (let t = Math.ceil(Math.max(0, visibleStart) / interval) * interval; t <= endSec; t += interval) ticks.push(Number(t.toFixed(4)));
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
      className="relative h-7 border-b border-[var(--ve-border)] bg-[var(--ve-panel)] cursor-pointer select-none"
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
});
