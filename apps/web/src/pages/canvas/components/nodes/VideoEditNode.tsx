// apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx
import { memo, useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Tooltip } from 'antd';
import { NodeHandle } from './NodeHandle';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { detectVideoEditorCapabilities } from '@/pages/canvas/video-editor/capabilities';
import { formatShortTime, totalDuration } from '@/pages/canvas/video-editor/timeline/timecode';
import { getProjectByNode } from '@/api/videoProjectApi';
import type { ProjectData } from '@/pages/canvas/video-editor/types';
import { renderFrameAt } from '@/pages/canvas/video-editor/renderer/render-frame';
import type { FrameRenderDeps } from '@/pages/canvas/video-editor/renderer/render-frame';
import { videoCache } from '@/pages/canvas/video-editor/renderer/video-cache';
import { clearImageBitmaps, getImageBitmap } from '@/pages/canvas/video-editor/renderer/image-cache';
import { resolveMediaBlob } from '@/pages/canvas/video-editor/renderer/media-blob';
import { CanvasRenderer, CANVAS_W, CANVAS_H } from '@/pages/canvas/video-editor/renderer/canvas-renderer';
import { batchGetMedia } from '@/api/mediaApi';

const TRACK_COLORS: Record<string, string> = { video: '#6C5CE7', image: '#6C5CE7', audio: '#95DE64', subtitle: '#FFD666' };

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1" y="1" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
      <rect x="8" y="1" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
      <rect x="1" y="8" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
      <rect x="8" y="8" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
    </svg>
  );
}

function VideoEditNodeComponent({ id, selected }: NodeProps) {
  const openEditor = useVideoEditorStore((s) => s.openEditor);
  const closedAt = useVideoEditorStore((s) => s.closedAt);
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [{ canPreview }] = useState(detectVideoEditorCapabilities);

  useEffect(() => {
    let cancelled = false;
    // closedAt 递增且 sourceNodeId 匹配本节点 → 编辑器关闭后刷新缩略；
    // 挂载首取（closedAt===0 或 sourceNodeId 尚未指向任何节点）始终放行（M2 精确化）
    const cs = useVideoEditorStore.getState();
    const isMine = cs.sourceNodeId === id;
    if (closedAt > 0 && !isMine) return;
    getProjectByNode(id)
      .then((p) => { if (!cancelled) setProjectData(p?.data ?? null); })
      .catch(() => { /* 失败保留现状：首载 null→空态，refetch 保留旧缩略（review M3） */ });
    return () => { cancelled = true; };
  }, [id, closedAt]);

  const miniNodeId = useVideoEditorStore(s => s.miniPlaybackNodeId);
  const [miniPlaying, setMiniPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const miniPlayingRef = useRef(false); // IO/selected 回调读最新值
  miniPlayingRef.current = miniPlaying;
  const rafRef = useRef(0); // B8：上提至 stopMini 之前（引用顺序即声明顺序，防执行者困惑）
  const projectDataRef = useRef<ProjectData | null>(null); // N2：释放入口读最新工程数据（IO effect deps:[] 闭包捕获的是首渲染 null）
  projectDataRef.current = projectData;
  // N2：IO effect deps:[] 捕获首渲染闭包 → 三个释放入口统一走 ref 取最新实例
  const stopMiniRef = useRef<() => void>(() => {});
  stopMiniRef.current = () => {
    setMiniPlaying(false);
    cancelAnimationFrame(rafRef.current);
    // 资源纪律③：释放本工程解码与帧缓存（mediaIds 从最新 projectData 派生）；无音频故不碰 audioEngine（决策 16）
    const pd = projectDataRef.current;
    const mids = new Set(pd ? Object.values(pd.clips).filter(c => c.type !== 'subtitle').map(c => c.mediaId) : []); // 偏离：计划裸 map——SubtitleClip 无 mediaId（TS 2339），按库内既有窄化惯用法（auto-edges.ts）剔除字幕片
    for (const m of mids) videoCache.release(m);
    clearImageBitmaps();
    if (useVideoEditorStore.getState().miniPlaybackNodeId === id) useVideoEditorStore.getState().stopMiniPlayback();
  };
  const stopMini = () => stopMiniRef.current();

  const startMini = async () => {
    if (!projectData || !canPreview) return;
    useVideoEditorStore.getState().startMiniPlayback(id); // 播 B 停 A（他节点经 miniNodeId 副责停）
    setMiniPlaying(true); // R4：置位必须先于 await——fireEvent.click 是同步 act，只 flush React 队列不 flush 用户 promise 续体，置位若在 await 后则点击返回时 miniPlaying 仍 false（用例 1 的画布断言/用例 4 的 IO 回调读 ref 同根因必红）；先置位=点击即时进播放态，URL 晚到首帧黑底、tick 每帧重读 mediaUrlsRef 到达后自动出画
    if (mediaUrlsRef.current.size === 0) await loadMediaUrls(); // ref 已填充则跳过（R2：省重复 RTT 与重复签 URL）
  };

  // 互斥：他节点接管 → 停
  useEffect(() => { if (miniPlaying && miniNodeId !== id) stopMini(); }, [miniNodeId]);
  // 取消选中 → 停
  useEffect(() => { if (!selected && miniPlaying) stopMini(); }, [selected]);
  // IO 视口监听（资源纪律③）——回调经 stopMiniRef 取最新闭包（N2）
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting && miniPlayingRef.current) stopMiniRef.current();
    });
    io.observe(root);
    return () => io.disconnect();
  }, []);
  // R4：卸载清理——节点删除/画布卸载时若在播：停播并释放（videoCache 条目与 ImageBitmap 不残留到 LRU/收起才回收）；deps:[] 经 ref 取最新闭包（N2 同款）
  useEffect(() => () => { if (miniPlayingRef.current) stopMiniRef.current(); }, []);
  // 迷你播放媒体源解析：工程 clips 的 mediaId 集合 → batchGetMedia 批查 presigned url（节点场景无 mediaInfo，决策 10 配套）
  const mediaUrlsRef = useRef<Map<string, string>>(new Map());
  const loadMediaUrls = async () => {
    if (!projectData) return;
    const fileIds = [...new Set(Object.values(projectData.clips).filter(c => c.type !== 'subtitle').map(c => c.mediaId))]; // 同上：剔除字幕片（TS 窄化）
    if (fileIds.length === 0) return;
    try {
      const rows = await batchGetMedia(fileIds);
      mediaUrlsRef.current = new Map(rows.map(r => [r.id, r.url]));
    } catch { /* 静默：无源则黑底播放 */ }
  };
  const resolveMiniBlob = (mediaId: string) => resolveMediaBlob(mediaId, mediaUrlsRef.current.get(mediaId));

  // 播放循环（perf 时钟本地推进——决策 16：无音频，不建 AudioContext 不锚 engine；与编辑器同构但数据源是本地 projectData）
  useEffect(() => {
    if (!miniPlaying || !projectData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = CANVAS_W; canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const deps: FrameRenderDeps = {
      video: videoCache,
      images: { getImageBitmap },
      getMediaUrl: (mediaId) => mediaUrlsRef.current.get(mediaId), // A3：UrlSource 直连
      getBlob: resolveMiniBlob, // 图片 ImageBitmap 用
      renderer: new CanvasRenderer(ctx),
    };
    let t0 = performance.now() / 1000;
    let pending = false;
    const tick = () => {
      const t = (performance.now() / 1000) - t0;
      const total = totalDuration(projectData);
      if (t >= total) { stopMini(); return; }
      if (!pending) { pending = true; renderFrameAt(projectData, t, deps).catch(() => {}).finally(() => { pending = false; }); }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [miniPlaying, projectData]);

  const dur = projectData ? totalDuration(projectData) : 0;
  const ratio = dur > 0 ? 288 / dur : 0; // 缩略区有效宽 288（316−2 border−24 padding≈290 取整 288）

  return (
    <div ref={rootRef} className="relative canvas-node" data-testid={`video-edit-node-${id}`}>
      <div
        className="bg-white rounded-lg overflow-hidden box-border"
        style={{
          width: 316,
          border: '1px solid #E5E7EB',
          margin: 2,
          ...(selected ? { border: '1px solid transparent', boxShadow: '0 0 0 3px #9CA3AF' } : {}),
        }}
      >
        <NodeHandle type="target" testId="video-edit-target" />
        {/* 标题栏 */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#F0F0F0] [border-bottom-style:solid]">
          <GridIcon />
          <span className="text-[14px] font-medium text-[#1F2329]">多轨道剪辑</span>
        </div>
        {/* 工具栏：迷你播放 + 简略时间码 + 全屏编辑 */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <button type="button" data-testid="node-play-btn"
            disabled={!canPreview || !projectData}
            onClick={() => { if (miniPlaying) stopMini(); else void startMini(); }}
            className={`text-[12px] bg-transparent border-0 px-1 ${canPreview && projectData ? 'text-[#6C5CE7] cursor-pointer' : 'text-[#C9CDD4] cursor-not-allowed'}`}>
            {miniPlaying ? '⏸' : '▶'}
          </button>
          <span className="text-[12px] text-[#86909C]">{formatShortTime(0)} / {formatShortTime(dur)}</span>
          <Tooltip title={canPreview ? '' : '当前浏览器不支持 WebCodecs，请使用最新版 Chrome/Edge'}>
            {/* disabled 控件不派发鼠标事件（Chromium 行为）且 antd5 Trigger 无 disabled 兼容包裹——span 包裹使 hover 可达（review C1） */}
            <span className="ml-auto inline-flex">
              <button
                type="button"
                className="text-[12px] text-[#6C5CE7] bg-transparent border-0 px-1 py-0.5 cursor-pointer disabled:text-[#C9CDD4] disabled:cursor-not-allowed"
                disabled={!canPreview}
                onClick={() => openEditor(id)}
              >
                ⤢ 全屏编辑
              </button>
            </span>
          </Tooltip>
        </div>
        {/* 轨道区：播放时渲染迷你画布替代只读缩略（片段色块 + 播放头位置） */}
        {miniPlaying ? (
          <div className="px-3 pb-3">
            <canvas data-testid="node-mini-canvas" ref={canvasRef}
              className="w-full bg-black rounded-md" style={{ aspectRatio: '16 / 9' }} />
          </div>
        ) : (
          <div className="px-3 pb-3 flex flex-col gap-1" data-testid="node-track-thumb">
            {projectData && projectData.tracks.length > 0 ? (
              projectData.tracks.map((t) => (
                <div key={t.id} className="relative h-[6px] rounded-sm bg-[#F2F3F5] overflow-hidden" data-testid={`node-track-${t.id}`}>
                  {t.clips.map((cid) => {
                    const c = projectData.clips[cid];
                    if (!c) return null;
                    return (
                      <div key={cid} data-testid={`node-clip-${cid}`}
                        className="absolute top-0 bottom-0 rounded-sm"
                        style={{ left: c.start * ratio, width: Math.max(2, c.duration * ratio), background: TRACK_COLORS[c.type] ?? '#6C5CE7' }} />
                    );
                  })}
                </div>
              ))
            ) : (
              <div className="h-[28px] rounded-md border border-dashed border-[#E5E7EB] [border-top-style:dashed] flex items-center justify-center">
                <span className="text-[12px] text-[#86909C]">+ 添加素材</span>
              </div>
            )}
          </div>
        )}
        <NodeHandle type="source" testId="video-edit-source" />
      </div>
    </div>
  );
}

export const VideoEditNode = memo(VideoEditNodeComponent);
