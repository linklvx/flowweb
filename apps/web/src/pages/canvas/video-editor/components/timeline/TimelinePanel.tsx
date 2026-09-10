import { useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { TimelineRuler } from './TimelineRuler';
import { TrackRow } from './TrackRow';

export function TimelinePanel() {
  const status = useEditorStore(s => s.status);
  const loadError = useEditorStore(s => s.loadError);
  const data = useEditorStore(s => s.data);
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  const playhead = useEditorStore(s => s.playhead);
  const setPxPerSec = useEditorStore(s => s.setPxPerSec);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (status === 'error') {
    return <div data-testid="timeline-error" className="h-[280px] border-t border-[#E5E7EB] [border-top-style:solid] bg-white flex flex-col items-center justify-center gap-2">
      <span className="text-[13px] text-[#F53F3F]">{loadError ?? '加载失败'}</span>
    </div>;
  }
  if (status === 'loading' || !data) {
    return <div data-testid="timeline-loading" className="h-[280px] border-t border-[#E5E7EB] [border-top-style:solid] bg-white flex items-center justify-center">
      <span className="text-[13px] text-[#86909C]">工程加载中…（禁止编辑）</span>
    </div>;
  }

  // Ctrl+滚轮缩放（以播放头为中心的 scrollLeft 锚定换算 Plan 3 接入——anchorZoomScroll 已在 Task 4 就绪；一期直接调 pxPerSec）
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setPxPerSec(pxPerSec * (e.deltaY < 0 ? 1.1 : 0.9));
  };

  return (
    <div data-testid="timeline-panel"
      className="h-[280px] border-t border-[#E5E7EB] [border-top-style:solid] bg-white flex flex-col min-h-0 box-border"
      onWheel={onWheel}>
      {/* 工具行（Plan 3 迁入预览控制条） */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#F2F3F5] [border-bottom-style:solid]">
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" onClick={() => useEditorStore.getState().undo()}>撤销</button>
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" onClick={() => useEditorStore.getState().redo()}>重做</button>
        <span className="text-[12px] text-[#C9CDD4]">|</span>
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" title="在播放头处分割选中片段">分割</button>
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" title="删除选中片段">删除</button>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => useEditorStore.getState().addTrack('video')}
            className="text-[12px] text-[#6C5CE7] bg-transparent border-0 cursor-pointer px-1">+ 视频轨</button>
          <button type="button" onClick={() => useEditorStore.getState().addTrack('audio')}
            className="text-[12px] text-[#6C5CE7] bg-transparent border-0 cursor-pointer px-1">+ 音频轨</button>
          <span className="text-[11px] text-[#86909C]">{pxPerSec.toFixed(0)} px/s</span>
        </div>
      </div>
      {/* 滚动区：标尺 + 轨道 */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto min-h-0">
        <TimelineRuler data={data} pxPerSec={pxPerSec} playhead={playhead} widthPx={scrollRef.current?.clientWidth ?? 800}
          onSeek={t => useEditorStore.getState().setPlayhead(t)} />
        {data.tracks.map(t => <TrackRow key={t.id} track={t} data={data} />)}
      </div>
    </div>
  );
}
