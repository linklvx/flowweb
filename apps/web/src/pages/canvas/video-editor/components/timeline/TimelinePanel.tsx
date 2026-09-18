import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { TimelineRuler } from './TimelineRuler';
import { TrackRow } from './TrackRow';
import { PlayheadLine } from './PlayheadLine';
import { timeToPx, pxToTime, edgeHitTest, snapTime, collectSnapPoints, zoomByDelta, anchorZoomScroll, TRACK_HEADER_W } from '../../timeline/view-scale';
import { quantizeTime } from '../../timeline/clip-math';
import { missingSourceNodeIds } from '../../timeline/missing-source';
import { placeAssetInTrack } from '../../timeline/placement'; // 批3-3：错型 drop 建轨改道
import { ensurePoster } from '../../renderer/poster'; // 批3-4：拖拽入轨 poster 回退取帧（对称点击路径）
import { CLIP_BLOCK_MIN_PX } from './ClipBlock';
import type { Clip, VideoClip } from '../../types';
import { seekPlayback } from '../../hooks/playback'; // 点击菱形跳转播放头
import { useEditorKeyboard } from '../../hooks/useEditorKeyboard';
import { useCanvasStore } from '@/stores/canvasStore';

// TrackRow memo 生效性：不依赖组件态（getState 自取 playhead）——模块级常量，引用恒稳定
const handleSubtitleAdd = (trackId: string) => {
  const s = useEditorStore.getState();
  s.addSubtitleClip(trackId, s.playhead);
};

export function TimelinePanel() {
  const status = useEditorStore(s => s.status);
  const loadError = useEditorStore(s => s.loadError);
  const data = useEditorStore(s => s.data);
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  // 素材缺失态派生（spec 生命周期第 3 条）：订阅 canvasStore.nodes——低频，与 playhead 无关。
  // 局部变量名用 missingSet：与 import 的派生函数 missingSourceNodeIds 保持名称距离，防日后误写遮蔽
  const canvasNodes = useCanvasStore(s => s.nodes);
  const missingSet = useMemo(
    () => missingSourceNodeIds(data, new Set(canvasNodes.map(n => n.id))),
    [data, canvasNodes]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // R3⑥ 滚动响应式：scrollLeft 经 rAF single-flight 节流入 state——TimelineRuler 窗口化数据源（标尺只随视口滚动重渲）
  const [scrollLeft, setScrollLeft] = useState(0);
  const rafRef = useRef(0);
  const onScroll = () => {
    if (rafRef.current) return; // single-flight：在飞帧不再排
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollLeft(scrollRef.current?.scrollLeft ?? 0);
    });
  };
  // R17-F3：缩放后 scrollLeft 延迟到 useLayoutEffect 写入——wheel 事件当下 React 未重渲、内容宽仍是旧布局，
  // 同步写会被浏览器 clamp 到旧 scrollWidth-clientWidth → 靠右端锚点漂移
  const pendingScrollLeftRef = useRef<number | null>(null);
  useEditorKeyboard();

  // G9（Plan 2 M2 正式接）：viewportW 经 ResizeObserver 维护 state——panel 不订阅 playhead 后
  // 播放期间无每帧重渲，scrollRef.current.clientWidth 直读会停在首帧值
  const [viewportW, setViewportW] = useState(940);
  // 批3-5：scrollRef 滚动容器只在面板就绪分支进 DOM（下方条件渲染早退）——挂监听 effect 必须以
  // 该存在性为依赖，loading→ready 转换时重跑注册；否则 [] 依赖下首次挂载（loading JSX）早退，监听全程缺失
  const panelReady = status !== 'loading' && status !== 'error' && !!data;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [panelReady]);

  interface DragState {
    kind: 'move' | 'trim-left' | 'trim-right' | 'keyframe';
    clipId: string;
    startClientX: number;
    startClipStart: number;
    /** 拖拽起始比例尺快照——整个拖拽用同一比例尺（拖拽途中 Ctrl+滚轮改缩放会让 dxSec 换算基准突变） */
    startPxPerSec: number;
    pointerMovedOnce: boolean; // 首次 move 才 beginTransient——down-up 无位移不入栈历史
    /** keyframe 拖拽专用（move/trim 不读写）——仅 keyframe kind 写入，pointermove 分支以 ! 断言读取 */
    kfId?: string;
    startKfT?: number;
  }
  const dragRef = useRef<DragState | null>(null);

  // 拖动吸附指示线（批3-6）：ref 镜像存上一次值——onWindowPointerMove 注册于 useEffect(..., []) 是首渲闭包，
  // 函数体内直读 state snapGuideTime 恒为首值 null ⇒ "!== state" 守卫恒真失效；吸附点跳变远低于 move 频率，
  // 仅值变化才 setState，避免每帧重渲
  const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null);
  const snapGuideRef = useRef<number | null>(null);

  // TrackRow memo 生效性：deps 内 data/pxPerSec 变化时 TrackRow 本就因同名 props 变化重渲，
  // 其余 panel 级重渲（viewport resize 等）回调保持稳定不架空 memo
  const onClipPointerDown = useCallback((clip: Clip, e: React.PointerEvent) => {
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
  }, [status, data, pxPerSec]);

  // TrackRow memo 生效性：useCallback 固定引用（deps pxPerSec）——scrollLeft state 使 panel 随滚动重渲，
  // 裸函数每帧新引用会击穿 TrackRow memo（R3⑥ 窗口化配套）
  const onKeyframePointerDown = useCallback((kfId: string, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // 挡片段拖拽/片段选中路径——选中经 selectKeyframe 双写
    const es = useEditorStore.getState();
    const clip = Object.values(es.data?.clips ?? {}).find(c =>
      (c.type === 'video' || c.type === 'image' || c.type === 'audio') && (c as VideoClip).keyframes.some(k => k.id === kfId));
    es.selectKeyframe(kfId, clip?.id); // N3/决策 19：双写 selectedKeyframeId + selectedClipId（stopPropagation 挡了片段选中路径）
    // 点击跳转播放头（spec 第四节：可点击跳转）
    if (clip) seekPlayback(clip.start + (clip as VideoClip).keyframes.find(k => k.id === kfId)!.t);
    dragRef.current = {
      kind: 'keyframe', clipId: clip!.id, kfId,
      startClientX: e.clientX,
      startKfT: (clip as VideoClip).keyframes.find(k => k.id === kfId)!.t,
      startPxPerSec: pxPerSec, pointerMovedOnce: false, // B8：字段名对齐现码 DragState（pointerMovedOnce 机制与 moveClip/trimClip 同款）
    } as DragState & { kfId: string; startKfT: number };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [pxPerSec]);

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
      // 吸附指示线：值变化才 setState（ref 镜像守卫，见声明处）
      const nextGuide = snapped.snapped != null ? snapped.time : null;
      if (nextGuide !== snapGuideRef.current) { snapGuideRef.current = nextGuide; setSnapGuideTime(nextGuide); }
      es.moveClip(d.clipId, Math.max(0, snapped.time), targetTrackId, { transient: true });
    } else if (d.kind === 'keyframe') {
      if (!es.pendingSnapshot && !d.pointerMovedOnce) { es.beginTransient(); d.pointerMovedOnce = true; }
      es.moveKeyframe(d.clipId, d.kfId!, d.startKfT! + dxSec, { transient: true });
    } else {
      if (!es.pendingSnapshot && !d.pointerMovedOnce) { es.beginTransient(); d.pointerMovedOnce = true; }
      es.trimClip(d.clipId, d.kind === 'trim-left' ? 'left' : 'right', dxSec, { transient: true });
    }
  };

  const onWindowPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null; // 监听常驻（useEffect 管理），pointerup 只结束本次拖拽
    snapGuideRef.current = null; // 指示线随拖拽结束清理（同值 setState React bail out，无拖拽时零开销）
    setSnapGuideTime(null);
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
  // exp 曲线（zoomByDelta）+ 鼠标/播放头锚定（anchorZoomScroll 接线，Plan 3）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault(); // 阻浏览器缩放
      const es = useEditorStore.getState();
      const old = es.pxPerSec;
      const next = Math.min(500, Math.max(10, zoomByDelta(e.deltaY, old))); // 上限 500 暂留（store setPxPerSec 同 clamp）
      const rect = el.getBoundingClientRect();
      // 坐标口径红线：滚动区首行含 140px 轨头角位——clientX-rect.left 含该偏移必须扣除，否则锚点偏 140/pxPerSec 秒
      //（对照：drop 路径用轨道体自身 rect 无此问题，两处口径不同）
      const cursorOffsetPx = e.clientX - rect.left - TRACK_HEADER_W;
      // 鼠标距视口偏 15% 内锚播放头（opencut 阈值），其余锚光标处时间
      const anchorTime = es.playhead > 0 && (Math.abs(cursorOffsetPx / rect.width) > 0.15)
        ? pxToTime(cursorOffsetPx + el.scrollLeft, old)
        : es.playhead;
      // 解构改名防遮蔽组件级 scrollLeft state；viewportW 是既有签名死参（实现未消费）——传参无害勿赋语义
      const { scrollLeft: nextScrollLeft } = anchorZoomScroll({ scrollLeft: el.scrollLeft, anchorTime, oldPxPerSec: old, newPxPerSec: next, viewportW: rect.width - TRACK_HEADER_W });
      if (next === old) return; // R19③：clamp 端 zoomByDelta 回弹同值——zustand 同值不通知 → effect 不跑 → pending 残留；必须在 pending 赋值之前
      pendingScrollLeftRef.current = nextScrollLeft; // R17-F3：不同步写 el.scrollLeft——此刻 React 未重渲，目标值被旧布局 clamp
      es.setPxPerSec(next);
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [panelReady]);

  // R17-F3 提交后落（useLayoutEffect——DOM 已按新 pxPerSec 布局，写入不被 clamp）；
  // R18-G1：同一 effect 内同步刷标尺窗口化 state——否则缩放那一帧用「新 pxPerSec+旧 scrollLeft」算窗口错一帧
  useLayoutEffect(() => {
    if (pendingScrollLeftRef.current != null && scrollRef.current) {
      scrollRef.current.scrollLeft = pendingScrollLeftRef.current;
      setScrollLeft(pendingScrollLeftRef.current);
      pendingScrollLeftRef.current = null;
    }
  }, [pxPerSec]);

  // 左面板资产拖入（Task 16）：payload 由 dragStart 汇点解析（时长已定），此处只做轨道匹配 + 落点量化 + 入库
  // TrackRow memo 生效性：只捕获 pxPerSec（store 写入经 getState）——除缩放外恒稳定
  const handleClipDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-clip');
    if (!raw) return;
    const payload = JSON.parse(raw) as {
      mediaId: string; sourceNodeId?: string; mimeType: string;
      originalName?: string; durationSec?: number; url?: string; thumbnailUrl?: string;
    };
    // R7-N2：函数声明置于回调体顶部（严格模式块内 function 是块级作用域）——错型改道分支与兼容路径两处调用同函数作用域可见。
    // rect 取自 ev.currentTarget（被悬停轨）——trackId 换参不影响量化落点语义
    function dropIntoTrack(trackId: string, ev: React.DragEvent<HTMLDivElement>) {
      const rect = ev.currentTarget.getBoundingClientRect();
      const start = quantizeTime(Math.max(0, pxToTime(ev.clientX - rect.left, pxPerSec)));
      if (payload.originalName) {
        useEditorStore.getState().setMediaInfo(payload.mediaId, {
          name: payload.originalName,
          durationSec: payload.durationSec,
          mimeType: payload.mimeType, // R4-5②：payload.mimeType 就在手，与 setMediaInfo 保字段双保险
          url: payload.url, thumbnailUrl: payload.thumbnailUrl, // 批3-4：拖拽路径与点击同源下发（白名单 thumbnailUrl 只补缺，undefined 不覆盖）
        });
      }
      useEditorStore.getState().addClip({
        type: kind, mediaId: payload.mediaId,
        sourceNodeId: payload.sourceNodeId || undefined,
        trackId,
        start,
      });
      // 批3-4 poster fire-and-forget：对称点击路径（addAssetToTimeline）——视频 payload 缺缩略图时取首帧回写（白名单只补缺）
      const { url } = payload;
      if (!payload.thumbnailUrl && payload.mimeType.startsWith('video/') && url) {
        void ensurePoster(url).then((poster) => {
          if (poster) useEditorStore.getState().setMediaInfo(payload.mediaId, {
            name: payload.originalName ?? '', durationSec: payload.durationSec ?? 5, url, mimeType: payload.mimeType, thumbnailUrl: poster,
          });
        });
      }
    }
    const trackEl = e.currentTarget;
    const trackType = trackEl.dataset.trackType!;
    const kind = payload.mimeType.startsWith('video/') ? 'video'
      : payload.mimeType.startsWith('audio/') ? 'audio' : 'image';
    if (trackType === 'subtitle') return; // 字幕轨不接受 drop（review I1）——先于错型改道短路，防片段溜进其它轨
    // 轨道类型匹配：audio↔video 错型不再静默丢弃——走建轨策略改道（批3-3）；video/image 同进视频轨（图片归视频轨）恒兼容
    if (kind === 'audio' ? trackType !== 'audio' : trackType !== 'video') {
      const es = useEditorStore.getState();
      const p = placeAssetInTrack(es.data!, { mimeType: payload.mimeType });
      dropIntoTrack(p.createNewTrack ? es.addTrack(p.newTrackType!) : p.trackId, e);
      return; // 关键：改道后绝不继续走被悬停轨的 trackId 分支
    }
    dropIntoTrack(trackEl.dataset.trackId!, e); // 兼容路径
  }, [pxPerSec]);

  if (status === 'error') {
    return <div data-testid="timeline-error" className="h-full border-t border-[var(--ve-border)] bg-[var(--ve-panel)] flex flex-col items-center justify-center gap-2">
      <span className="text-[13px] text-[#F53F3F]">{loadError ?? '加载失败'}</span>
    </div>;
  }
  if (status === 'loading' || !data) {
    return <div data-testid="timeline-loading" className="h-full border-t border-[var(--ve-border)] bg-[var(--ve-panel)] flex items-center justify-center">
      <span className="text-[13px] text-[var(--ve-text-dim)]">工程加载中…（禁止编辑）</span>
    </div>;
  }

  return (
    <div data-testid="timeline-panel"
      className="h-full border-t border-[var(--ve-border)] bg-[var(--ve-panel)] flex flex-col min-h-0">
      {/* 工具行（撤销/重做/分割/删除已迁预览控制条——Plan 3） */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--ve-border)]">
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => useEditorStore.getState().addTrack('video')}
            className="text-[12px] text-[var(--ve-accent)] bg-transparent border-0 cursor-pointer px-1">+ 视频轨</button>
          <button type="button" onClick={() => useEditorStore.getState().addTrack('audio')}
            className="text-[12px] text-[var(--ve-accent)] bg-transparent border-0 cursor-pointer px-1">+ 音频轨</button>
          <span className="text-[11px] text-[var(--ve-text-dim)]">{pxPerSec.toFixed(0)} px/s</span>
        </div>
      </div>
      {/* 滚动区：角位 + 标尺（与轨道头 TRACK_HEADER_W 对齐——时间轴空间契约）+ 轨道；内容 wrapper relative 供贯穿播放头定位 */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-x-auto overflow-y-auto min-h-0">
        <div className="relative min-w-max">
          <div className="flex">
            <div className="shrink-0 h-7 border-b border-[var(--ve-border)] bg-[var(--ve-panel)]" style={{ width: TRACK_HEADER_W }} />
            <TimelineRuler data={data} pxPerSec={pxPerSec} widthPx={viewportW - TRACK_HEADER_W} scrollLeft={scrollLeft} />
          </div>
          {data.tracks.map(t => (
            <TrackRow key={t.id} track={t} data={data}
              missingSourceNodeIds={missingSet}
              onDropClip={handleClipDrop}
              onSubtitleAdd={handleSubtitleAdd}
              onClipPointerDown={onClipPointerDown}
              onKeyframePointerDown={onKeyframePointerDown} />
          ))}
          {/* I3：贯穿播放头竖线（自订阅——标尺+轨道全域，随内容滚动；pointer-events-none 不挡交互） */}
          <PlayheadLine />
          {/* 批3-6 拖动吸附指示线：挂含轨头的滚动内容层 ⇒ left 补偿 TRACK_HEADER_W（口径同 PlayheadLine） */}
          {snapGuideTime != null && (
            <div data-testid="snap-guide" className="absolute top-0 bottom-0 w-0.5 bg-[var(--ve-accent)] pointer-events-none z-[2]"
              style={{ left: TRACK_HEADER_W + timeToPx(snapGuideTime, pxPerSec) }} />
          )}
        </div>
      </div>
    </div>
  );
}
