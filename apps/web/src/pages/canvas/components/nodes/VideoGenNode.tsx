import { memo, useEffect, useState, useRef, useCallback } from 'react';
import { NodeResizeControl, useReactFlow, useInternalNode, type NodeProps } from '@xyflow/react';
import { NodeHandle } from './NodeHandle';
import { io } from 'socket.io-client';
import { useNodeStore } from '@/stores/nodeStore';
import { VideoConfigPanel } from './VideoConfigPanel';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { presignUpload, confirmUpload } from '@/api/storageApi';
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

function VideoGenNodeComponent({ id, selected }: NodeProps) {
  const nodeData = useNodeStore((s) => s.nodes[id]?.data) as any;
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const { getNodes, setNodes } = useReactFlow();
  const isSingleSelected = selected && getNodes().filter((n) => n.selected).length === 1;
  const status = nodeData?.status ?? 'idle';
  const fileId = nodeData?.fileId;
  const referenceVideo = nodeData?.referenceVideo;
  const { url: resultUrl } = useMediaUrl(fileId);
  const { url: refVideoUrl } = useMediaUrl(referenceVideo);

  const displayUrl = resultUrl || refVideoUrl;

  const hasMedia = !!displayUrl;
  const isEditMode = !!(nodeData?.editMode);
  const showResizeHandles = isSingleSelected && hasMedia && !isEditMode;

  // Dynamic sizing based on video aspect ratio (same as image node)
  const [vidSize, setVidSize] = useState<{ w: number; h: number } | null>(null);

  const handleVideoLoad = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const vid = e.currentTarget;
    const vidW = vid.videoWidth || 548;
    const vidH = vid.videoHeight || 306;
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
  }, [displayUrl]);

  const ratio = nodeData?.ratio ?? '16:9';
  const ratioSize = ratioDimensions(ratio);
  const containerWidth = vidSize ? vidSize.w : ratioSize.w;
  const containerHeight = vidSize ? vidSize.h : ratioSize.h;

  const internalNode = useInternalNode(id);
  const nodeWidth = internalNode?.width ?? containerWidth;
  const nodeHeight = internalNode?.height ?? containerHeight;

  // Editable title
  const [label, setLabel] = useState('Video');
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

  // Socket.io for real-time video generation status updates
  useEffect(() => {
    const socket = io('/execution', { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      console.log('[VideoGenNode] socket connected, joining default');
      socket.emit('join', 'default');
    });

    socket.on('connect_error', (err: any) => {
      console.error('[VideoGenNode] socket connect error:', err.message);
    });

    socket.on('node:status', (data: any) => {
      console.log('[VideoGenNode] received node:status:', data);
      if (data.nodeId !== id) return;
      if (data.status === 'loading') {
        useNodeStore.getState().setStatus(id, 'loading');
      } else if (data.status === 'done' && data.fileId) {
        console.log('[VideoGenNode] setting fileId:', data.fileId);
        useNodeStore.getState().setFileResult(id, data.fileId);
      } else if (data.status === 'error') {
        useNodeStore.getState().setStatus(id, 'error');
      }
      if (data.credits !== undefined) {
        window.dispatchEvent(new CustomEvent('credits:update', { detail: data.credits }));
      }
    });

    return () => { socket.removeAllListeners() };
  }, [id]);

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

  const handleUploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadProgress(0);

    try {
      const { fileId: fid, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
      });

      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);

      const proxyUrl = import.meta.env.DEV
        ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
        : uploadUrl;

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

      {/* Floating upload button — only when selected */}
      {selected && (
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

      {/* Title bar */}
      <div
        className="absolute z-[1] pointer-events-auto -translate-y-full left-1 -top-0 pb-2 overflow-hidden whitespace-nowrap flex items-center gap-1 text-[#999]"
        style={{ width: containerWidth, lineHeight: '18px' }}
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
            className="nodrag absolute inset-0 box-border w-full p-0 h-auto bg-transparent text-inherit border-none outline-none"
            style={{ fontSize: 12, lineHeight: '18px', minWidth: 0 }}
            aria-label="节点标题"
            maxLength={20}
          />
        </div>
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
        className="bg-[#222222] rounded-lg overflow-hidden"
        style={{
          width: nodeWidth,
          height: nodeHeight,
          border: '1px solid #3F3F46',
          margin: 2,
          ...(selected
            ? { borderColor: 'transparent', boxShadow: '0 0 0 3px #9CA3AF' }
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
              controls
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
              onLoadedMetadata={handleVideoLoad}
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
              className="nodrag nopan absolute top-2 right-2 z-5 flex items-center gap-2 w-fit h-9 px-4 py-2 text-white text-sm font-medium rounded-[10px] bg-white/10 hover:bg-white/20 cursor-pointer border border-white/10 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
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

      {/* Bottom config panel */}
      {selected && !fileId && !referenceVideo && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <VideoConfigPanel nodeId={id} />
        </div>
      )}
    </div>
  );
}

export const VideoGenNode = memo(VideoGenNodeComponent);
