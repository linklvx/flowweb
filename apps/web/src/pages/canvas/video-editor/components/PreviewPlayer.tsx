import { useRef } from 'react';
import { Slider, Tooltip } from 'antd';
import { useEditorStore } from '../store/editorStore';
import { usePreviewPlayback } from '../hooks/usePreviewPlayback';
import { togglePlayback, seekPlayback } from '../hooks/playback'; // R3 五-5：stopPlayback 未使用（停止走 togglePlayback 的 playing 分支），删导入
import { audioEngine } from '../audio-engine/engine';
import { formatShortTime, totalDuration } from '../timeline/timecode';

export function PreviewPlayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  usePreviewPlayback(canvasRef);
  const playing = useEditorStore(s => s.playing);
  const preparing = useEditorStore(s => s.preparing);
  const playhead = useEditorStore(s => s.playhead);
  const data = useEditorStore(s => s.data);
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  const setPxPerSec = useEditorStore(s => s.setPxPerSec);
  const total = data ? totalDuration(data) : 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#F7F8FA]">
      {/* 16:9 预览区 */}
      <div ref={containerRef} className="flex-1 min-h-0 flex items-center justify-center p-3">
        {/* 偏离登记：计划 JSX 笔误——canvas 缺 ref={canvasRef}，hook 拿不到画布致播放循环/单帧渲染全失效（G1 用例红揭示），按计划目标语义补上 */}
        <canvas ref={canvasRef} data-testid="preview-canvas" width={1920} height={1080}
          className="bg-black max-w-full max-h-full" style={{ aspectRatio: '16 / 9', width: '100%' }}
          onClick={(e) => { // 点击画布 seek（点击位置→时间）
            const rect = e.currentTarget.getBoundingClientRect();
            seekPlayback(((e.clientX - rect.left) / rect.width) * total);
          }} />
      </div>
      {/* 控制条（spec 第四节：播放/时间码/撤销/重做/分割/删除 + 音量/全屏/缩放滑杆） */}
      <div data-testid="preview-control-bar"
        className="h-11 shrink-0 flex items-center gap-2 px-3 bg-white border-t border-[#E5E7EB] [border-top-style:solid] box-border">
        <button type="button" data-testid="preview-play-btn" disabled={preparing}
          onClick={() => { void togglePlayback(); }}
          className="text-[16px] text-[#1F2329] bg-transparent border-0 cursor-pointer px-2 disabled:opacity-50">
          {preparing ? '…' : playing ? '⏸' : '▶'}
        </button>
        <span className="text-[12px] text-[#1F2329] tabular-nums">
          {formatShortTime(playhead)}
          <span className="text-[#86909C]"> / {formatShortTime(total)}</span>
        </span>
        <span className="text-[#C9CDD4] mx-1">|</span>
        <button type="button" onClick={() => useEditorStore.getState().undo()}
          className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1.5">撤销</button>
        <button type="button" onClick={() => useEditorStore.getState().redo()}
          className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1.5">重做</button>
        <button type="button" title="在播放头处分割选中片段"
          onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.splitClip(es.selectedClipId, es.playhead); }}
          className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1.5">分割</button>
        <button type="button" title="删除选中片段"
          onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.removeClip(es.selectedClipId); }}
          className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1.5">删除</button>
        <div className="ml-auto flex items-center gap-3">
          <Tooltip title="音量">
            {/* 偏离登记：antd 5.22.5 Slider 吞 data-testid（不透传根 div）——计划预授权最小适配：包裹 span 承载 testid */}
            <span data-testid="volume-slider" className="inline-flex">
              <Slider className="w-20" min={0} max={100} defaultValue={100}
                onChange={(v) => audioEngine.setMasterVolume((v as number) / 100)} />
            </span>
          </Tooltip>
          <button type="button" title="全屏"
            onClick={() => { const el = containerRef.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); }}
            className="text-[14px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1.5">⛶</button>
          <Tooltip title="时间轴缩放">
            <span data-testid="zoom-slider" className="inline-flex">
              <Slider className="w-24" min={10} max={500} value={pxPerSec}
                onChange={(v) => setPxPerSec(v as number)} />
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
