import { memo, useEffect, useState, useRef, useCallback } from 'react';
import { NodeResizeControl, useReactFlow, useInternalNode, type NodeProps } from '@xyflow/react';
import { useIsSingleSelected } from '@/hooks/useIsSingleSelected';
import { NodeHandle } from './NodeHandle';
import { subscribeNodeStatus, ensureExecutionSocket } from '@/services/executionSocket';
import { message } from 'antd';
import { useNodeStore } from '@/stores/nodeStore';
import { selectExecStatus } from '@/stores/execStatusView';
import { useCanvasStore } from '@/stores/canvasStore';
import { stopCapturing } from '@/stores/canvasUndo';
import { VideoConfigPanel } from './VideoConfigPanel';
import { VideoNodeToolbar } from './VideoNodeToolbar';
import { VideoTrimPanel } from './VideoTrimPanel';
import { VideoFullscreenViewer } from './VideoFullscreenViewer';
import { VideoHDPanel } from './VideoHDPanel';
import { videoTrimApi } from '@/services/video-trim.api';
import { useTrimTaskStatus } from '@/hooks/useTrimTaskStatus';
import { useVideoSeparateTask } from '@/hooks/useVideoSeparateTask';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { useVideoFrameCapture } from '@/hooks/useVideoFrameCapture';
import { videoSeparateApi } from '@/services/video-separate.api';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { canvasProjectId } from '@/utils/uploadContext';
import { uploadImageBlob } from '@/utils/mediaUploadUtils';
import { downloadMediaFile } from '@/utils/mediaDownload';
import { RESIZE_CONFIG, HANDLE_STYLE, CORNERS, adaptCustomSize } from '@/utils/resizeUtils';
import axios from 'axios';

const MAX_WIDTH = 548;
const MAX_HEIGHT = 500;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

function calcConstrainedSize(naturalW: number, naturalH: number) {
  let w = naturalW;
  let h = naturalH;

  if (w > MAX_WIDTH) {
    h = Math.round(h * (MAX_WIDTH / w));
    w = MAX_WIDTH;
  }
  if (h > MAX_HEIGHT) {
    w = Math.round(w * (MAX_HEIGHT / h));
    h = MAX_HEIGHT;
  }
  if (w < MIN_WIDTH) w = MIN_WIDTH;
  if (h < MIN_HEIGHT) h = MIN_HEIGHT;

  return { w, h };
}

function ratioDimensions(ratio: string) {
  const [rw, rh] = ratio.split(':').map(Number);
  if (!rw || !rh) return { w: 548, h: 309 };
  const base = 1000;
  const w = rw >= rh ? base : Math.round(base * (rw / rh));
  const h = rh >= rw ? base : Math.round(base * (rh / rw));
  return calcConstrainedSize(w, h);
}

function VideoGenNodeComponent({ id, selected, dragging }: NodeProps) {
  const nodeData = useNodeStore((s) => s.nodes[id]?.data) as any;
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const { getNodes, setNodes } = useReactFlow();
  const isSingleSelected = useIsSingleSelected(selected);
  // 批1-6（B2）：执行状态合并视图（exec 投影 → 对齐 → data.status；终态优先不回退）
  const status = useNodeStore((s) => selectExecStatus(s, id));
  const fileId = nodeData?.fileId;
  const referenceVideo = nodeData?.referenceVideo;
  // R2b-5：onError 自愈直通 <video>——展示哪个 hook 的 url 就传哪个的 onError（displayUrl 优先级与之一致）
  const { url: resultUrl, onError: onResultError } = useMediaUrl(fileId);
  const { url: refVideoUrl, onError: onRefVideoError } = useMediaUrl(referenceVideo);

  const displayUrl = resultUrl || refVideoUrl;

  const hasMedia = !!displayUrl;
  const isEditMode = !!(nodeData?.editMode);
  const showResizeHandles = isSingleSelected && hasMedia && !isEditMode;

  // Fullscreen state
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const fullscreenTriggerRef = useRef<HTMLButtonElement>(null);

  // Frame capture state
  const [capturingType, setCapturingType] = useState<'current' | 'first' | 'last' | null>(null);

  // Audio separate state
  const [audioSeparatingType, setAudioSeparatingType] = useState<'vocal' | 'background' | 'split' | null>(null);
  const [separateTaskId, setSeparateTaskId] = useState<string | null>(null);
  // trim/separate 任务快路径：单例 socket（useAsyncMediaTask 内部精确 on/off——不影响单例其它 handler）。
  // 勘误：原 socketRef.current 并非恒 null（mount effect 赋值后触发任务时的 re-render 传的是真 socket，
  // 快路径生效过）——迁移时传 null 会退化为 3s 纯轮询，此处接单例恢复原语义（socket 推送 + 10s 轮询兜底）。
  // ensure 幂等（page.tsx 已建连，此处仅取引用）；projectId 缺失时 null 走纯轮询兜底。
  const projectId = useCanvasStore((s) => s.projectId);
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
  const taskSocket = projectId ? ensureExecutionSocket(projectId) : null;
  const separateStatus = useVideoSeparateTask(separateTaskId, taskSocket, id);

  // Trim panel state
  const [trimMode, setTrimMode] = useState(false);
  const initialTrimState = useRef({ trimStart: 0, trimEnd: 0 });
  const [trimTaskId, setTrimTaskId] = useState<string | null>(null);
  const trimStatus = useTrimTaskStatus(trimTaskId, taskSocket, id);

  // HD panel state
  const [hdPanelOpen, setHdPanelOpen] = useState(false);

  // Close HD panel when node becomes unselected, multi-selected, or dragged
  useEffect(() => {
    if (!selected || !isSingleSelected || dragging) {
      setHdPanelOpen(false);
    }
  }, [selected, isSingleSelected, dragging]);

  // ESC key closes HD panel (skip when input is focused)
  useEffect(() => {
    if (!hdPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;
        setHdPanelOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hdPanelOpen]);

  const handleOpenTrim = useCallback(() => {
    const nd = useNodeStore.getState().nodes[id]?.data as any;
    const rawDuration = videoRef.current?.duration;
    const dur = Number.isFinite(rawDuration) ? rawDuration! : 0;
    const it = initialTrimState.current;
    it.trimStart = Number.isFinite(nd?.trimStart) ? nd!.trimStart : 0;
    it.trimEnd = Number.isFinite(nd?.trimEnd) ? nd!.trimEnd : dur;
    setTrimTaskId(null);
    setTrimMode(true);
  }, [id]);

  const handleCancelTrim = useCallback(() => {
    const s = useNodeStore.getState();
    const it = initialTrimState.current;
    s.updateVideoTrim(id, it.trimStart, it.trimEnd);
    setTrimMode(false);
    setTrimTaskId(null);
  }, [id]);

  const handleConfirmTrim = useCallback(async (start: number, end: number) => {
    const targetFileId = fileId || referenceVideo;
    if (!targetFileId) return;

    // Persist the user's trim selection to nodeStore
    useNodeStore.getState().updateVideoTrim(id, start, end);

    // Transition hook to processing state so panel shows "裁剪中..."
    trimStatus.setProcessing();
    setTrimTaskId(null);

    try {
      const { taskId } = await videoTrimApi.submitTrim({
        fileId: targetFileId,
        startTime: start,
        endTime: end,
        nodeId: id,
      });
      setTrimTaskId(taskId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[VideoGenNode] trim submission failed:', msg, err);
      trimStatus.setError(msg || '裁剪提交失败，请检查网络后重试');
    }
  }, [id, fileId, referenceVideo, trimStatus]);

  // Sync trim result to node data when completed
  useEffect(() => {
    if (trimStatus.status === 'done' && trimTaskId && trimStatus.outputFileId) {
      // Create a new child video node with the trimmed result
      useCanvasStore.getState().addChildNode(id, {
        fileId: trimStatus.outputFileId,
        model: nodeData?.model ?? 'hyvideo-v1.5',
        status: 'done',
        ratio: nodeData?.ratio ?? '16:9',
      });

      setTrimMode(false);
      setTrimTaskId(null);
    }
  }, [trimStatus.status, trimStatus.outputFileId, trimTaskId, id, nodeData?.model, nodeData?.ratio]);

  // Sync separate result to child nodes when completed
  useEffect(() => {
    if (separateStatus.status === 'done' && separateTaskId) {
      const videoFileId = separateStatus.data.videoFileId;
      const audioFileId = separateStatus.data.audioFileId;
      if (!videoFileId || !audioFileId) return;

      const sourceNode = useCanvasStore.getState().nodes.find(n => n.id === id);
      if (!sourceNode) return;

      const sourceTitle = (useNodeStore.getState().nodes[id]?.data as any)?.label || 'Video';

      const newNodeIds = useCanvasStore.getState().addChildNodes(id, [
        {
          data: {
            fileId: videoFileId,
            model: nodeData?.model ?? 'hyvideo-v1.5',
            status: 'done',
            ratio: nodeData?.ratio ?? '16:9',
            label: `${sourceTitle}-无音频`,
          },
          gridRow: 0,
          gridCol: 0,
          nodeType: 'videoGen',
        },
        {
          data: {
            fileId: audioFileId,
            status: 'done',
            label: `${sourceTitle}-分离音频`,
          },
          gridRow: 1,
          gridCol: 0,
          nodeType: 'audioGen',
        },
      ], { skipEdges: true });

      // 批2-3 R20：canEdit 假时 addChildNodes 静默返回 []——无新节点可连边，防 addEdge(id, undefined) 脏边
      if (newNodeIds.length === 0) return;

      const store = useCanvasStore.getState();
      store.addEdge(id, newNodeIds[0]);
      store.addEdge(id, newNodeIds[1]);

      store.selectNode(newNodeIds[0]);

      message.success('音视频分离完成');
      setSeparateTaskId(null);
      setAudioSeparatingType(null);
      useCanvasStore.getState().finishNodeProcess(id, 'done');
    }

    if (separateStatus.status === 'error' && separateTaskId) {
      const errMsg = separateStatus.data.error || '分离失败';
      message.error(errMsg);
      setSeparateTaskId(null);
      setAudioSeparatingType(null);
      useCanvasStore.getState().finishNodeProcess(id, 'error', errMsg);
    }
  }, [separateStatus.status, separateStatus.data, separateTaskId, id, nodeData?.model, nodeData?.ratio]);

  const handleOpenFullscreen = useCallback(() => {
    setFullscreenOpen(true);
  }, []);

  const handleCloseFullscreen = useCallback(() => {
    setFullscreenOpen(false);
  }, []);

  const handleDownload = useCallback(async () => {
    const targetFileId = fileId || referenceVideo;
    if (!targetFileId) return;
    // R2b-2：下载统一走 downloadMediaFile（url 优先/fileId 自愈/60s 延迟 revoke/失败 message.error——window.open 兜底移除）
    await downloadMediaFile({
      fileId: targetFileId,
      url: displayUrl ?? undefined,
      filename: nodeData?.mediaName ?? `视频-${id.slice(-6)}`,
    });
  }, [fileId, referenceVideo, displayUrl, nodeData?.mediaName, id]);

  // Dynamic sizing based on video aspect ratio (same as image node)
  const [vidSize, setVidSize] = useState<{ w: number; h: number } | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const handleVideoLoad = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const vid = e.currentTarget;
    const vidW = vid.videoWidth || 548;
    const vidH = vid.videoHeight || 306;
    setNaturalSize({ w: vid.videoWidth || vidW, h: vid.videoHeight || vidH });
    const newAspectRatio = vidW / vidH;
    const currentData = useNodeStore.getState().nodes[id]?.data as any;
    const existingCustomSize = currentData?.customSize;
    const existingAspectRatio = currentData?.aspectRatio;

    const ratioChanged = existingCustomSize && existingAspectRatio &&
      Math.abs(newAspectRatio - existingAspectRatio) > 0.01;

    let size: { w: number; h: number };
    if (ratioChanged) {
      const adapted = adaptCustomSize(existingCustomSize!, newAspectRatio);
      updateConfig(id, { customSize: adapted, aspectRatio: newAspectRatio } as any);
      size = { w: adapted.width, h: adapted.height };
    } else if (existingCustomSize && !ratioChanged) {
      size = { w: existingCustomSize.width, h: existingCustomSize.height };
    } else {
      size = calcConstrainedSize(vidW, vidH);
      updateConfig(id, { aspectRatio: newAspectRatio } as any);
    }

    setVidSize(size);

    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        return { ...n, width: size.w, height: size.h };
      }),
    );
  }, [id, updateConfig, setNodes]);

  useEffect(() => {
    setVidSize(null);
    setNaturalSize(null);
  }, [displayUrl]);

  const ratio = nodeData?.ratio ?? '16:9';
  const ratioSize = ratioDimensions(ratio);
  const containerWidth = vidSize ? vidSize.w : ratioSize.w;
  const containerHeight = vidSize ? vidSize.h : ratioSize.h;

  const internalNode = useInternalNode(id);
  const nodeWidth = internalNode?.width ?? containerWidth;
  const nodeHeight = internalNode?.height ?? containerHeight;

  // Editable title（产物节点 data 首渲染即含 label——初始化一次到位；普通节点无 label 行为不变）
  const [label, setLabel] = useState((nodeData as { label?: string } | undefined)?.label ?? 'Video');
  const [draft, setDraft] = useState(label);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(label);

  const saveTitle = useCallback(() => {
    const trimmed = draftRef.current.trim();
    if (trimmed) setLabel(trimmed);
    else {
      setDraft(label);
      draftRef.current = label;
    }
  }, [label]);

  const startEdit = useCallback(() => {
    setDraft(label);
    draftRef.current = label;
  }, [label]);

  const titleText = label || 'Video';

  // Real-time video generation status updates — 订阅 /execution 单例（连接/join/credits 转发归单例与 page 生命周期）
  useEffect(() => {
    const off = subscribeNodeStatus((data) => {
      if (data.nodeId !== id) return;
      if (data.status === 'loading') {
        useNodeStore.getState().setStatus(id, 'loading');
      } else if (data.status === 'done' && data.fileId) {
        useNodeStore.getState().setFileResult(id, data.fileId);
      } else if (data.status === 'error') {
        useNodeStore.getState().setStatus(id, 'error');
      }
    });
    return off;
  }, [id]);

  // Unmount cleanup for in-progress separate task
  const separateTaskIdRef = useRef(separateTaskId);
  separateTaskIdRef.current = separateTaskId;
  const nodeIdRef = useRef(id);
  nodeIdRef.current = id;

  useEffect(() => {
    return () => {
      if (separateTaskIdRef.current) {
        setSeparateTaskId(null);
        setAudioSeparatingType(null);
        useCanvasStore.getState().finishNodeProcess(nodeIdRef.current, 'error', 'cancelled');
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (fallbackCleanupRef.current) {
        fallbackCleanupRef.current();
        fallbackCleanupRef.current = null;
      }
    };
  }, []);

  // ---- Floating upload button ----

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackCleanupRef = useRef<(() => void) | null>(null);

  // Frame capture hook
  const videoDuration = Number.isFinite(videoRef.current?.duration) ? videoRef.current!.duration! : 0;
  const { captureCurrent, captureFirst, captureLast } = useVideoFrameCapture({
    videoSrc: displayUrl,
    duration: videoDuration,
    videoRef,
  });

  const handleCaptureFrame = useCallback(async (type: 'current' | 'first' | 'last') => {
    if (capturingType) return;
    setCapturingType(type);

    try {
      const captureFn = type === 'current' ? captureCurrent
        : type === 'first' ? captureFirst : captureLast;
      const blob = await captureFn();

      const { fileId } = await uploadImageBlob(blob, canvasProjectId());

      const store = useCanvasStore.getState();
      const videoNode = store.nodes.find((n) => n.id === id);
      if (!videoNode) { setCapturingType(null); return; }

      const vw = videoNode.measured?.width ?? videoNode.width ?? 400;
      const position = {
        x: videoNode.position.x + vw + 40,
        y: videoNode.position.y + 40,
      };

      const newNodeId = store.addNode('image', position, {
        fileId,
        status: 'done',
      });

      store.addEdge(id, newNodeId);
      store.selectNode(newNodeId);

      message.success('截帧成功');
    } catch (err: any) {
      const friendlyMsg = (() => {
        const msg = err?.message || '';
        if (msg.includes('视频未加载完成')) return '视频正在缓冲，请稍后重试';
        if (msg.includes('视频帧加载超时')) return '视频资源加载缓慢，请检查网络后重试';
        if (msg.includes('SecurityError')) return '视频资源无法访问，请检查源文件';
        return msg || '截帧失败，请重试';
      })();
      message.error(friendlyMsg);
    } finally {
      setCapturingType(null);
    }
  }, [id, capturingType, captureCurrent, captureFirst, captureLast]);

  const handleAudioSeparate = useCallback(async (type: 'vocal' | 'background' | 'split') => {
    if (type !== 'split') return;

    const targetFileId = fileId || referenceVideo;
    if (!targetFileId) return;

    setAudioSeparatingType(type);
    useCanvasStore.getState().startNodeProcess(id, 'separating');

    try {
      const { taskId } = await videoSeparateApi.submitSeparate({
        fileId: targetFileId,
        nodeId: id,
        mode: type,
      });
      setSeparateTaskId(taskId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '请求失败';
      message.error(msg);
      setAudioSeparatingType(null);
      useCanvasStore.getState().finishNodeProcess(id, 'error', msg);
    }
  }, [fileId, referenceVideo, id]);

  const handleUploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadProgress(0);

    try {
      const { fileId: fid, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
        projectId: canvasProjectId(),
      });

      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);

      const proxyUrl = uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        },
      });

      await confirmUpload({ fileId: fid, key, fileSize: file.size });

      updateConfig(id, { referenceVideo: fid });
    } catch (err: any) {
      console.error('[VideoGenNode] upload error:', err.message);
    } finally {
      setUploading(false);
    }
  }, [id, updateConfig]);

  const showReplaceButton = !resultUrl && !!referenceVideo && !!displayUrl;

  // ── Aspect-ratio-locked resize handlers ──

  const finishResize = useCallback(() => {
    const currentNodes = getNodes();
    const currentNode = currentNodes.find((n) => n.id === id);
    if (!currentNode) return;

    const w = currentNode.width ?? containerWidth;
    const h = currentNode.height ?? containerHeight;
    if (w > 0 && h > 0) {
      updateConfig(id, {
        customSize: { width: w, height: h },
      } as any);
      setVidSize({ w, h });
    }

    if (videoRef.current) {
      videoRef.current.style.pointerEvents = 'auto';
    }
    if (fallbackCleanupRef.current) {
      fallbackCleanupRef.current();
      fallbackCleanupRef.current = null;
    }
  }, [id, getNodes, updateConfig, containerWidth, containerHeight]);

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    if (videoRef.current) {
      videoRef.current.style.pointerEvents = 'none';
    }

    const onFallback = () => {
      finishResize();
      setIsResizing(false);
    };
    window.addEventListener('mouseup', onFallback);
    window.addEventListener('blur', onFallback);

    fallbackCleanupRef.current = () => {
      window.removeEventListener('mouseup', onFallback);
      window.removeEventListener('blur', onFallback);
      if (videoRef.current) {
        videoRef.current.style.pointerEvents = 'auto';
      }
    };
  }, [finishResize]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    finishResize();
    stopCapturing();
  }, [finishResize]);

  // Restore customSize dimensions on mount
  useEffect(() => {
    const cs = nodeData?.customSize as { width: number; height: number } | undefined;
    if (!cs || cs.width <= 0 || cs.height <= 0) return;

    const currentNodes = getNodes();
    const currentNode = currentNodes.find((n) => n.id === id);
    if (!currentNode || (currentNode.width === cs.width && currentNode.height === cs.height)) return;

    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        return { ...n, width: cs.width, height: cs.height };
      }),
    );
    setVidSize({ w: cs.width, h: cs.height });
  }, [nodeData?.customSize, id, getNodes, setNodes]);

  // Persist customSize when resize handles disappear mid-resize (e.g. edit mode entered)
  useEffect(() => {
    if (!showResizeHandles && isResizing) {
      const currentNodes = getNodes();
      const currentNode = currentNodes.find((n) => n.id === id);
      if (currentNode) {
        const w = currentNode.width ?? nodeWidth;
        const h = currentNode.height ?? nodeHeight;
        if (w > 0 && h > 0) {
          updateConfig(id, { customSize: { width: w, height: h } } as any);
        }
      }
      if (fallbackCleanupRef.current) {
        fallbackCleanupRef.current();
        fallbackCleanupRef.current = null;
      }
      setIsResizing(false);
    }
  }, [showResizeHandles, isResizing, id, nodeWidth, nodeHeight, getNodes, updateConfig]);

  return (
    <div className="relative canvas-node">
      {/* Hidden file input — for uploading reference video */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadFile(file);
        }}
      />

      {/* Floating upload button — only when selected and no video */}
      {isSingleSelected && !hasMedia && (
        <button
          className="nodrag nopan absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#222222]/80 backdrop-blur-lg text-[#ccc] px-3 py-2"
          style={{ bottom: 'calc(100% + 28px)' }}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-[#ccc] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">{uploadProgress}%</span>
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
                <path d="M7 9l5 -5l5 5" />
                <path d="M12 4l0 12" />
              </svg>
              <span className="text-sm">上传</span>
            </>
          )}
        </button>
      )}

      {/* Floating toolbar — only when selected and video loaded, hidden during trim */}
      <VideoNodeToolbar show={isSingleSelected && hasMedia && !trimMode} productMode={(nodeData as { origin?: string } | undefined)?.origin === 'video-edit'} onFullscreen={handleOpenFullscreen} fullscreenTriggerRef={fullscreenTriggerRef} onDownload={handleDownload} onTrim={handleOpenTrim} onCaptureFrame={handleCaptureFrame} capturingType={capturingType} onAudioSeparate={handleAudioSeparate} audioSeparatingType={audioSeparatingType} onHD={() => setHdPanelOpen(prev => !prev)} hdPanelOpen={hdPanelOpen} />

      {/* Title bar */}
      <div
        className="absolute z-[1] pointer-events-auto -translate-y-full left-1 -top-0 pb-2 overflow-hidden whitespace-nowrap flex items-center gap-1 text-[#999]"
        style={{ width: nodeWidth, lineHeight: '18px' }}
      >
        <span className="shrink-0 flex items-center" style={{ width: 12, height: 12 }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4.66699 2.64248C4.66717 1.82358 5.59736 1.35167 6.25781 1.83584L13.5674 7.19619C14.1117 7.59579 14.1118 8.40897 13.5674 8.8085L6.25781 14.1688C5.59734 14.6528 4.6671 14.1811 4.66699 13.3622V2.64248Z" fill="currentColor" />
          </svg>
        </span>
        <div className="relative min-w-0 max-w-full w-max shrink">
          <span
            className="invisible whitespace-pre inline-block pointer-events-none select-none align-top"
            aria-hidden="true"
            style={{ fontSize: 12, lineHeight: '18px' }}
          >
            {(draft || titleText) + ' '}
          </span>
          <input
            ref={titleInputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              draftRef.current = e.target.value;
            }}
            onFocus={startEdit}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') titleInputRef.current?.blur();
              if (e.key === 'Escape') {
                setDraft(label);
                draftRef.current = label;
                titleInputRef.current?.blur();
              }
            }}
            placeholder="请输入标题"
            className="nodrag absolute inset-0 w-full h-auto bg-transparent outline-none"
            style={{ fontSize: 12, lineHeight: '18px', minWidth: 0 }}
            aria-label="节点标题"
            maxLength={20}
          />
        </div>
        {naturalSize && (
          <span className="shrink-0 ml-auto" style={{ fontSize: 10, color: '#777' }}>
            {naturalSize.w} × {naturalSize.h}
          </span>
        )}
      </div>

      {/* Corner resize handles — only when single-selected with media, not in edit mode */}
      {showResizeHandles && CORNERS.map((corner) => (
        <NodeResizeControl
          key={corner}
          nodeId={id}
          position={corner}
          keepAspectRatio={true}
          minWidth={RESIZE_CONFIG.minSide}
          minHeight={RESIZE_CONFIG.minSide}
          maxWidth={RESIZE_CONFIG.maxSide}
          maxHeight={RESIZE_CONFIG.maxSide}
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
          style={HANDLE_STYLE}
          data-testid={`resize-control-${corner}`}
        />
      ))}

      {/* Node body */}
      <div
        className="bg-surface rounded-lg overflow-hidden"
        style={{
          width: nodeWidth,
          height: nodeHeight,
          border: '1px solid var(--fw-border)',
          margin: 2,
          ...(selected
            ? { border: '1px solid transparent', boxShadow: '0 0 0 3px #9CA3AF' }
            : {}),
        }}
      >
        <NodeHandle type="target" testId="target-handle" />
        <div
          className="flex items-center justify-center overflow-hidden rounded-lg transition-colors duration-300 relative group"
          style={{ width: '100%', height: '100%' }}
        >
          {displayUrl ? (
            <video
              ref={videoRef}
              src={displayUrl}
              crossOrigin="anonymous"
              controls
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
              onLoadedMetadata={handleVideoLoad}
              onError={resultUrl ? onResultError : onRefVideoError}
            />
          ) : status === 'loading' ? (
            <span className="text-yellow-400 text-xs">⏳ 生成中...</span>
          ) : (
            <div className="mb-4 text-[#666]">
              <svg width="64" height="64" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4.66699 2.64248C4.66717 1.82358 5.59736 1.35167 6.25781 1.83584L13.5674 7.19619C14.1117 7.59579 14.1118 8.40897 13.5674 8.8085L6.25781 14.1688C5.59734 14.6528 4.6671 14.1811 4.66699 13.3622V2.64248Z" fill="currentColor" />
              </svg>
            </div>
          )}

          {/* Replace button — only for user-uploaded videos (not AI-generated) */}
          {showReplaceButton && (
            <button
              className="nodrag nopan absolute top-2 right-2 [z-index:5] flex items-center gap-2 w-fit h-9 px-4 py-2 text-white text-sm font-medium rounded-[10px] bg-white/10 hover:bg-white/20 border border-white/10 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
                <path d="M7 9l5 -5l5 5" />
                <path d="M12 4l0 12" />
              </svg>
              替换
            </button>
          )}
        </div>
        <NodeHandle type="source" testId="source-handle" />
      </div>

      {/* Trim panel — shown below the node when trimMode is active */}
      {trimMode && hasMedia && (
        <div className="nodrag nopan absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4" style={{ width: nodeWidth }}>
          <VideoTrimPanel
            videoRef={videoRef}
            duration={Number.isFinite(videoRef.current?.duration) ? videoRef.current!.duration : 30}
            initialTrimStart={initialTrimState.current.trimStart}
            initialTrimEnd={initialTrimState.current.trimEnd}
            onConfirm={handleConfirmTrim}
            onCancel={handleCancelTrim}
            onRangeChange={(start, end) => {
              useNodeStore.getState().updateVideoTrim(id, start, end);
            }}
            taskStatus={trimStatus.status as any}
            error={trimStatus.error}
          />
        </div>
      )}

      {/* Bottom config panel */}
      {!trimMode && selected && !fileId && !referenceVideo && !hdPanelOpen && !marqueeSelecting && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <VideoConfigPanel nodeId={id} />
        </div>
      )}

      {/* HD panel */}
      {isSingleSelected && fileId && hdPanelOpen && !dragging && (
        <div className="nodrag nopan absolute -bottom-4 left-1/2 -translate-x-1/2 translate-y-full z-20 w-full min-w-[420px] max-w-[430px]">
          <VideoHDPanel nodeId={id} fileId={fileId} />
        </div>
      )}

      {/* Fullscreen viewer */}
      <VideoFullscreenViewer
        open={fullscreenOpen}
        onClose={handleCloseFullscreen}
        videoUrl={displayUrl ?? undefined}
        triggerRef={fullscreenTriggerRef}
        nodeData={nodeData}
      />
    </div>
  );
}

export const VideoGenNode = memo(VideoGenNodeComponent);
