import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { TimelineRuler } from './TimelineRuler';
import { TrackRow } from './TrackRow';
import { timeToPx, pxToTime, edgeHitTest, snapTime, collectSnapPoints } from '../../timeline/view-scale';
import { quantizeTime } from '../../timeline/clip-math';
import { CLIP_BLOCK_MIN_PX } from './ClipBlock';
import type { Clip } from '../../types';
import { useEditorKeyboard } from '../../hooks/useEditorKeyboard';

export function TimelinePanel() {
  const status = useEditorStore(s => s.status);
  const loadError = useEditorStore(s => s.loadError);
  const data = useEditorStore(s => s.data);
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  const playhead = useEditorStore(s => s.playhead);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEditorKeyboard();

  interface DragState {
    kind: 'move' | 'trim-left' | 'trim-right';
    clipId: string;
    startClientX: number;
    startClipStart: number;
    /** 拖拽起始比例尺快照——整个拖拽用同一比例尺（拖拽途中 Ctrl+滚轮改缩放会让 dxSec 换算基准突变） */
    startPxPerSec: number;
    pointerMovedOnce: boolean; // 首次 move 才 beginTransient——down-up 无位移不入栈历史
  }
  const dragRef = useRef<DragState | null>(null);

  const onClipPointerDown = (clip: Clip, e: React.PointerEvent) => {
    if (e.button !== 0 || status !== 'ready' || !data) return;
    e.stopPropagation();
    useEditorStore.getState().selectClip(clip.id); // getState 风格——面板无需为此多挂一个 selector
    const widthPx = Math.max(CLIP_BLOCK_MIN_PX, timeToPx(clip.duration, pxPerSec));
    // 不用 e.nativeEvent.offsetX——jsdom 与部分浏览器拖拽中不维护该值，统一 clientX - rect.left
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    // jsdom rect 全 0 时 offsetX=clientX 会超出块宽（真实浏览器 offsetX 恒在块内）——越界不判边缘
    const hit = offsetX >= 0 && offsetX <= widthPx ? edgeHitTest(offsetX, widthPx) : null;
    if (clip.type === 'subtitle' && hit) return; // 字幕无 trim 语义（一期）
    dragRef.current = {
      kind: hit ? (hit === 'left' ? 'trim-left' : 'trim-right') : 'move',
      clipId: clip.id,
      startClientX: e.clientX,
      startClipStart: clip.start,
      startPxPerSec: pxPerSec, // 拖拽全程固定比例尺
      pointerMovedOnce: false,
    };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onWindowPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dxSec = pxToTime(e.clientX - d.startClientX, d.startPxPerSec); // 拖拽全程固定比例尺
    const es = useEditorStore.getState();
    if (d.kind === 'move') {
      if (!es.pendingSnapshot && !d.pointerMovedOnce) { es.beginTransient(); d.pointerMovedOnce = true; }
      const target = d.startClipStart + dxSec;
      const snapped = snapTime(target, collectSnapPoints(d.clipId, Object.values(es.data?.clips ?? {}), es.playhead), d.startPxPerSec);
      // 跨轨拖动（spec 同类型跨轨自由重叠）：pointer 落点命中轨道行，类型兼容才换轨
      // ?. 防御：jsdom 无 elementFromPoint（真实浏览器恒有）
      let targetTrackId: string | undefined;
      const hitEl = document.elementFromPoint?.(e.clientX, e.clientY);
      const trackEl = hitEl?.closest('[data-track-id]') as HTMLElement | null;
      if (trackEl) {
        const elType = trackEl.dataset.trackType!;
        const myType = es.data?.clips[d.clipId]?.type;
        const compatible = myType === 'audio' ? elType === 'audio'
          : myType === 'subtitle' ? elType === 'subtitle'
          : elType === 'video'; // video/image 片只在视频轨间移动（图片归视频轨）
        if (compatible) targetTrackId = trackEl.dataset.trackId;
      }
      es.moveClip(d.clipId, Math.max(0, snapped.time), targetTrackId, { transient: true });
    } else {
      if (!es.pendingSnapshot && !d.pointerMovedOnce) { es.beginTransient(); d.pointerMovedOnce = true; }
      es.trimClip(d.clipId, d.kind === 'trim-left' ? 'left' : 'right', dxSec, { transient: true });
    }
  };

  const onWindowPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null; // 监听常驻（useEffect 管理），pointerup 只结束本次拖拽
    if (!d) return;
    useEditorStore.getState().endTransient(); // pointerup 一次入栈
  };

  // window 监听常驻注册 + 卸载清理（拖拽中被卸载不泄漏；非拖拽态 dragRef null 早退）
  // 本块须在 onWindowPointerMove/onWindowPointerUp 定义之后（effect 回调 render 提交后才执行，无 TDZ 风险，定义序防误读）
  useEffect(() => {
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerUp); // 触控/浏览器接管手势——与 up 同路径收口（review M2）
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
      dragRef.current = null;
    };
  }, []);

  // Ctrl+滚轮缩放：原生监听 passive:false——react-dom 根容器 wheel 是 passive，合成 preventDefault 无效（执行期 I1）
  // scrollLeft 锚定换算 Plan 3 接入（anchorZoomScroll 已就绪）；一期直接调 pxPerSec
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const es = useEditorStore.getState();
      es.setPxPerSec(es.pxPerSec * (e.deltaY < 0 ? 1.1 : 0.9));
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, []);

  // 左面板资产拖入（Task 16）：payload 由 dragStart 汇点解析（时长已定），此处只做轨道匹配 + 落点量化 + 入库
  const handleClipDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-clip');
    if (!raw) return;
    const payload = JSON.parse(raw) as {
      mediaId: string; sourceNodeId?: string; mimeType: string;
      originalName?: string; durationSec?: number;
    };
    const trackEl = e.currentTarget;
    const trackType = trackEl.dataset.trackType!;
    const kind = payload.mimeType.startsWith('video/') ? 'video'
      : payload.mimeType.startsWith('audio/') ? 'audio' : 'image';
    // 轨道类型匹配（图片进视频轨；跨类型 drop 忽略）
    if (trackType === 'audio' ? kind !== 'audio' : kind === 'audio') return;
    const rect = trackEl.getBoundingClientRect();
    const start = quantizeTime(Math.max(0, pxToTime(e.clientX - rect.left, pxPerSec)));
    if (payload.originalName) {
      useEditorStore.getState().setMediaInfo(payload.mediaId, {
        name: payload.originalName,
        durationSec: payload.durationSec,
      });
    }
    useEditorStore.getState().addClip({
      type: kind, mediaId: payload.mediaId,
      sourceNodeId: payload.sourceNodeId || undefined,
      trackId: trackEl.dataset.trackId!,
      start,
    });
  };

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

  return (
    <div data-testid="timeline-panel"
      className="h-[280px] border-t border-[#E5E7EB] [border-top-style:solid] bg-white flex flex-col min-h-0 box-border">
      {/* 工具行（Plan 3 迁入预览控制条） */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#F2F3F5] [border-bottom-style:solid]">
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" onClick={() => useEditorStore.getState().undo()}>撤销</button>
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" onClick={() => useEditorStore.getState().redo()}>重做</button>
        <span className="text-[12px] text-[#C9CDD4]">|</span>
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" title="在播放头处分割选中片段"
          onClick={() => { const s = useEditorStore.getState(); if (s.selectedClipId) s.splitClip(s.selectedClipId, s.playhead); }}>分割</button>
        <button type="button" className="text-[12px] text-[#4E5969] bg-transparent border-0 cursor-pointer px-1" title="删除选中片段"
          onClick={() => { const s = useEditorStore.getState(); if (s.selectedClipId) s.removeClip(s.selectedClipId); }}>删除</button>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => useEditorStore.getState().addTrack('video')}
            className="text-[12px] text-[#6C5CE7] bg-transparent border-0 cursor-pointer px-1">+ 视频轨</button>
          <button type="button" onClick={() => useEditorStore.getState().addTrack('audio')}
            className="text-[12px] text-[#6C5CE7] bg-transparent border-0 cursor-pointer px-1">+ 音频轨</button>
          <span className="text-[11px] text-[#86909C]">{pxPerSec.toFixed(0)} px/s</span>
        </div>
      </div>
      {/* 滚动区：角位 + 标尺（与轨道头 140px 对齐——时间轴空间契约）+ 轨道；内容 wrapper relative 供贯穿播放头定位 */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto min-h-0">
        <div className="relative min-w-max">
          <div className="flex">
            <div className="w-[140px] shrink-0 h-7 border-b border-[#E5E7EB] [border-bottom-style:solid] bg-[#FAFBFC] box-border" />
            <TimelineRuler data={data} pxPerSec={pxPerSec} playhead={playhead} widthPx={(scrollRef.current?.clientWidth ?? 940) - 140}
              onSeek={t => useEditorStore.getState().setPlayhead(t)} />
          </div>
          {data.tracks.map(t => (
            <TrackRow key={t.id} track={t} data={data}
              onDropClip={handleClipDrop}
              onSubtitleAdd={(trackId) => useEditorStore.getState().addSubtitleClip(trackId, playhead)}
              onClipPointerDown={onClipPointerDown} />
          ))}
          {/* I3：贯穿播放头竖线（标尺+轨道全域，随内容滚动；pointer-events-none 不挡交互） */}
          <div data-testid="playhead-line"
            className="absolute top-0 bottom-0 w-0.5 bg-[#6C5CE7] pointer-events-none z-10"
            style={{ left: 140 + playhead * pxPerSec }} />
        </div>
      </div>
    </div>
  );
}
