import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useIsSingleSelected } from '@/hooks/useIsSingleSelected';
import { NodeHandle } from './NodeHandle';
import { useNodeStore } from '@/stores/nodeStore';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { canvasProjectId } from '@/utils/uploadContext';
import { getMediaUrl } from '@/api/mediaApi';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { MultiImageConfigPanel } from './MultiImageConfigPanel';
import axios from 'axios';

const STACKED_W = 400;
const STACKED_H = 300;
const STACKED_MAX_W = 450;
const STACKED_MAX_H = 450;
const STACKED_MIN_W = 150;
const STACKED_MIN_H = 100;
const MAX_WIDTH = 548;
const CELL_SIZE = 150;
const GAP = 8;

function calcConstrainedSize(naturalW: number, naturalH: number) {
  let w = naturalW;
  let h = naturalH;
  if (w > STACKED_MAX_W) { h = Math.round(h * (STACKED_MAX_W / w)); w = STACKED_MAX_W; }
  if (h > STACKED_MAX_H) { w = Math.round(w * (STACKED_MAX_H / h)); h = STACKED_MAX_H; }
  if (w < STACKED_MIN_W) w = STACKED_MIN_W;
  if (h < STACKED_MIN_H) h = STACKED_MIN_H;
  return { w, h };
}

const STACK_LAYERS = [
  { rotate: 5, scale: 0.965, left: 12, top: 4, zIndex: 3 },
  { rotate: 10, scale: 0.93, left: 24, top: 8, zIndex: 2 },
  { rotate: 15, scale: 0.895, left: 36, top: 12, zIndex: 1 },
];

interface MediaImageProps {
  fileId: string;
  alt: string;
  className?: string;
  onImageLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

function MediaImage({ fileId, alt, className, onImageLoad }: MediaImageProps) {
  const { url, loading, error } = useMediaUrl(fileId);

  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-[#1a1a2e] ${className ?? ''}`}>
        <div className="w-6 h-6 border-2 border-[#555] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !url) {
    return (
      <div className={`flex items-center justify-center bg-[#1a1a2e] ${className ?? ''}`}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </div>
    );
  }

  return <img src={url} alt={alt} className={className} loading="lazy" onLoad={onImageLoad} />;
}

function MultiImageNodeComponent({ id, selected }: NodeProps) {
  const nodeData = useNodeStore((s) => s.nodes[id]?.data) as any;
  const updateMultiImageImages = useNodeStore((s) => s.updateMultiImageImages);
  const setMainImageIndexStore = useNodeStore((s) => s.setMainImageIndex);
  const toggleExpanded = useNodeStore((s) => s.toggleExpanded);
  const updateMultiImageNodeStatus = useNodeStore((s) => s.updateMultiImageNodeStatus);
  const isSingleSelected = useIsSingleSelected(selected);

  const images: any[] = nodeData?.images ?? [];
  const mainImageIndex: number = nodeData?.mainImageIndex ?? 0;
  const expanded: boolean = nodeData?.expanded ?? false;
  const labelText: string = nodeData?.label ?? 'Multi-Image';

  // ---------- Editable title ----------
  const [label, setLabel] = useState(labelText);
  const [draft, setDraft] = useState(label);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(label);

  const saveTitle = useCallback(() => {
    const trimmed = draftRef.current.trim();
    if (trimmed) setLabel(trimmed);
    else { setDraft(label); draftRef.current = label; }
  }, [label]);

  const startEdit = useCallback(() => {
    setDraft(label);
    draftRef.current = label;
  }, [label]);

  const titleText = label || 'Multi-Image';

  // ---------- Dynamic image size ----------
  const mainImageFileId = images[mainImageIndex]?.id;
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setImgSize(null);
  }, [mainImageFileId]);

  const handleMainImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const size = calcConstrainedSize(img.naturalWidth, img.naturalHeight);
    setImgSize(size);
  }, []);

  // ---------- Computed sizes ----------
  const imageCount = images.length;
  const gridCols = imageCount <= 4 ? 2 : 3;
  const gridRows = Math.ceil(imageCount / gridCols);
  const expandedW = Math.min(gridCols * CELL_SIZE + (gridCols - 1) * GAP + 24, MAX_WIDTH);
  const expandedH = gridRows * CELL_SIZE + (gridRows - 1) * GAP + 48;

  const stackedW = imgSize ? imgSize.w : STACKED_W;
  const stackedH = imgSize ? imgSize.h : STACKED_H;
  const containerWidth = expanded ? expandedW : stackedW;
  const containerHeight = expanded ? expandedH : stackedH;

  // ---------- Upload ----------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleUploadFiles = useCallback(async (files: FileList) => {
    const fileArray = Array.from(files);
    const maxCount = 9;
    const currentCount = images.length;
    if (currentCount + fileArray.length > maxCount) {
      alert(`最多支持上传${maxCount}张图片`);
    }
    const toUpload = fileArray.slice(0, maxCount - currentCount);

    setUploading(true);
    updateMultiImageNodeStatus(id, 'loading');

    const newImages = [...images];

    for (const file of toUpload) {
      try {
        setUploadProgress(0);
        const { fileId, uploadUrl, key, fields } = await presignUpload({
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
          onUploadProgress: (e: any) => {
            if (e.total) setUploadProgress(Math.round((e.loaded / e.total) * 100));
          },
        });

        await confirmUpload({ fileId, key, fileSize: file.size });

        const { url: realUrl } = await getMediaUrl(fileId);

        newImages.push({ id: fileId, url: realUrl, name: file.name, status: 'success' as const });
      } catch (err: any) {
        console.error('[MultiImageNode] upload error:', err.message);
      }
    }

    updateMultiImageImages(id, newImages);
    updateMultiImageNodeStatus(id, 'done');
    setUploading(false);
  }, [id, images, updateMultiImageImages, updateMultiImageNodeStatus]);

  const stackLayerCount = Math.min(images.length - 1, 3);

  return (
    <div className="relative canvas-node">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) handleUploadFiles(files);
          e.target.value = '';
        }}
      />

      {isSingleSelected && (
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
          <svg width="12" height="12" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g opacity="1">
              <path fillRule="evenodd" clipRule="evenodd" d="M31.7998 3C33.727 3 35.293 2.998 36.5606 3.10157C37.8514 3.20704 39.0084 3.43147 40.0859 3.98047C41.7794 4.84333 43.1567 6.22061 44.0195 7.91407C44.5685 8.99162 44.793 10.1486 44.8984 11.4395C45.002 12.7071 45 14.273 45 16.2002V31.7998C45 33.727 45.002 35.293 44.8984 36.5606C44.793 37.8514 44.5685 39.0084 44.0195 40.0859C43.1567 41.7794 41.7794 43.1567 40.0859 44.0195C39.0084 44.5685 37.8514 44.793 36.5606 44.8984C35.293 45.002 33.727 45 31.7998 45H16.2002C14.273 45 12.7071 45.002 11.4395 44.8984C10.1486 44.793 8.99162 44.5685 7.91407 44.0195C6.22061 43.1567 4.84333 41.7794 3.98047 40.0859C3.43147 39.0084 3.20704 37.8514 3.10157 36.5606C2.998 35.293 3 33.727 3 31.7998V16.2002C3 14.273 2.998 12.7071 3.10157 11.4395C3.20704 10.1486 3.43147 8.99162 3.98047 7.91407C4.84333 6.22061 6.22061 4.84333 7.91407 3.98047C8.99162 3.43147 10.1486 3.20704 11.4395 3.10157C12.7071 2.998 14.273 3 16.2002 3H31.7998ZM16.6064 24.0537C16.0437 23.8709 15.4378 23.871 14.875 24.0537C14.6778 24.1178 14.3958 24.2616 13.8779 24.7012C13.3422 25.156 12.6948 25.8003 11.7207 26.7744L7 31.4951V31.7998C7 33.7928 7.00173 35.1675 7.08887 36.2344C7.17411 37.2777 7.33114 37.8498 7.54492 38.2695C8.02429 39.2103 8.78967 39.9757 9.73047 40.4551C10.1502 40.6689 10.7223 40.8259 11.7656 40.9111C12.8325 40.9983 14.2072 41 16.2002 41H31.7998C32.6238 41 33.342 40.9977 33.9766 40.9912L19.7598 26.7744C18.7856 25.8003 18.1383 25.155 17.6025 24.7002C17.085 24.2609 16.8036 24.1178 16.6064 24.0537ZM16.2002 7C14.2072 7 12.8325 7.00173 11.7656 7.08887C10.7223 7.17411 10.1502 7.33114 9.73047 7.54492C8.78967 8.02429 8.02429 8.78967 7.54492 9.73047C7.33114 10.1502 7.17411 10.7223 7.08887 11.7656C7.00173 12.8325 7 14.2072 7 16.2002V25.8389L8.89258 23.9463C9.82018 23.0187 10.5998 22.2365 11.2891 21.6514C11.9961 21.0511 12.7385 20.5413 13.6377 20.249C15.004 19.8051 16.4765 19.8042 17.8428 20.248C18.742 20.5402 19.4843 21.0511 20.1914 21.6514C20.8807 22.2366 21.6612 23.0186 22.5889 23.9463L38.79 40.1484C39.4929 39.6756 40.0676 39.0301 40.4551 38.2695C40.6689 37.8498 40.8259 37.2777 40.9111 36.2344C40.9983 35.1675 41 33.7928 41 31.7998V16.2002C41 14.2072 40.9983 12.8325 40.9111 11.7656C40.8259 10.7223 40.6689 10.1502 40.4551 9.73047C39.9757 8.78967 39.2103 8.02429 38.2695 7.54492C37.8498 7.33114 37.2777 7.17411 36.2344 7.08887C35.1675 7.00173 33.7928 7 31.7998 7H16.2002ZM31 13C33.2091 13 35 14.7909 35 17C35 19.2091 33.2091 21 31 21C28.7909 21 27 19.2091 27 17C27 14.7909 28.7909 13 31 13Z" fill="currentColor" />
            </g>
          </svg>
        </span>
        <div className="relative min-w-0 max-w-full w-max shrink">
          <span
            className="invisible whitespace-pre inline-block pointer-events-none select-none align-top"
            aria-hidden="true"
            style={{ fontSize: 12, lineHeight: '18px' }}
          >
            {(draft || titleText) + ' '}
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
      </div>

      {/* Card body — isolation creates stacking context for internal z-index layers */}
      <div
        className="bg-surface rounded-lg transition-colors"
        style={{
          isolation: 'isolate',
          width: containerWidth,
          height: containerHeight,
        }}
      >
        <NodeHandle type="target" testId="target-handle" />

        <div className="w-full h-full rounded-lg relative">
          {expanded && images.length > 0 ? (
            /* --- EXPANDED MODE --- */
            <div className="w-full h-full p-3 overflow-auto">
              <button
                className="nodrag nopan absolute top-2 right-2 z-10 bg-[#3a3a3a] text-[#ccc] rounded px-2 py-0.5 text-xs hover:bg-[#4a4a4a]"
                onClick={(e) => { e.stopPropagation(); toggleExpanded(id); }}
              >
                ✕
              </button>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                  gap: GAP,
                  paddingTop: 20,
                  paddingRight: 20,
                  paddingBottom: 20,
                }}
              >
                {images.map((img: any, i: number) => (
                  <div
                    key={img.id}
                    className="relative rounded-lg overflow-hidden group"
                    style={{
                      border: i === mainImageIndex ? '2px solid #f59e0b' : '2px solid transparent',
                      aspectRatio: '1/1',
                    }}
                  >
                    <MediaImage
                      fileId={img.id}
                      alt={img.name || ''}
                      className="w-full h-full object-cover"
                    />
                    {i === mainImageIndex && (
                      <div className="absolute top-1 right-1 bg-[#f59e0b] rounded-full w-5 h-5 flex items-center justify-center text-white text-xs">
                        ✓
                      </div>
                    )}
                    {i !== mainImageIndex && (
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          className="nodrag nopan bg-[#f59e0b] text-white text-xs px-2 py-1 rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMainImageIndexStore(id, i);
                            useNodeStore.getState().updateNodeData(id, { expanded: false } as any);
                          }}
                        >
                          设为主图
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : images.length === 0 ? (
            /* --- EMPTY STATE --- */
            <div className="flex items-center justify-center w-full h-full">
              <svg width="72" height="72" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#555]">
                <g opacity="0.35">
                  <path fillRule="evenodd" clipRule="evenodd" d="M31.7998 3C33.727 3 35.293 2.998 36.5606 3.10157C37.8514 3.20704 39.0084 3.43147 40.0859 3.98047C41.7794 4.84333 43.1567 6.22061 44.0195 7.91407C44.5685 8.99162 44.793 10.1486 44.8984 11.4395C45.002 12.7071 45 14.273 45 16.2002V31.7998C45 33.727 45.002 35.293 44.8984 36.5606C44.793 37.8514 44.5685 39.0084 44.0195 40.0859C43.1567 41.7794 41.7794 43.1567 40.0859 44.0195C39.0084 44.5685 37.8514 44.793 36.5606 44.8984C35.293 45.002 33.727 45 31.7998 45H16.2002C14.273 45 12.7071 45.002 11.4395 44.8984C10.1486 44.793 8.99162 44.5685 7.91407 44.0195C6.22061 43.1567 4.84333 41.7794 3.98047 40.0859C3.43147 39.0084 3.20704 37.8514 3.10157 36.5606C2.998 35.293 3 33.727 3 31.7998V16.2002C3 14.273 2.998 12.7071 3.10157 11.4395C3.20704 10.1486 3.43147 8.99162 3.98047 7.91407C4.84333 6.22061 6.22061 4.84333 7.91407 3.98047C8.99162 3.43147 10.1486 3.20704 11.4395 3.10157C12.7071 2.998 14.273 3 16.2002 3H31.7998ZM16.6064 24.0537C16.0437 23.8709 15.4378 23.871 14.875 24.0537C14.6778 24.1178 14.3958 24.2616 13.8779 24.7012C13.3422 25.156 12.6948 25.8003 11.7207 26.7744L7 31.4951V31.7998C7 33.7928 7.00173 35.1675 7.08887 36.2344C7.17411 37.2777 7.33114 37.8498 7.54492 38.2695C8.02429 39.2103 8.78967 39.9757 9.73047 40.4551C10.1502 40.6689 10.7223 40.8259 11.7656 40.9111C12.8325 40.9983 14.2072 41 16.2002 41H31.7998C32.6238 41 33.342 40.9977 33.9766 40.9912L19.7598 26.7744C18.7856 25.8003 18.1383 25.155 17.6025 24.7002C17.085 24.2609 16.8036 24.1178 16.6064 24.0537ZM16.2002 7C14.2072 7 12.8325 7.00173 11.7656 7.08887C10.7223 7.17411 10.1502 7.33114 9.73047 7.54492C8.78967 8.02429 8.02429 8.78967 7.54492 9.73047C7.33114 10.1502 7.17411 10.7223 7.08887 11.7656C7.00173 12.8325 7 14.2072 7 16.2002V25.8389L8.89258 23.9463C9.82018 23.0187 10.5998 22.2365 11.2891 21.6514C11.9961 21.0511 12.7385 20.5413 13.6377 20.249C15.004 19.8051 16.4765 19.8042 17.8428 20.248C18.742 20.5402 19.4843 21.0511 20.1914 21.6514C20.8807 22.2366 21.6612 23.0186 22.5889 23.9463L38.79 40.1484C39.4929 39.6756 40.0676 39.0301 40.4551 38.2695C40.6689 37.8498 40.8259 37.2777 40.9111 36.2344C40.9983 35.1675 41 33.7928 41 31.7998V16.2002C41 14.2072 40.9983 12.8325 40.9111 11.7656C40.8259 10.7223 40.6689 10.1502 40.4551 9.73047C39.9757 8.78967 39.2103 8.02429 38.2695 7.54492C37.8498 7.33114 37.2777 7.17411 36.2344 7.08887C35.1675 7.00173 33.7928 7 31.7998 7H16.2002ZM31 13C33.2091 13 35 14.7909 35 17C35 19.2091 33.2091 21 31 21C28.7909 21 27 19.2091 27 17C27 14.7909 28.7909 13 31 13Z" fill="currentColor" />
                </g>
              </svg>
            </div>
          ) : (
            /* --- STACKED MODE --- */
            <div className="relative w-full h-full flex items-center justify-center">
              {STACK_LAYERS.slice(0, stackLayerCount).map((layer, i) => (
                <div
                  key={i}
                  className="absolute rounded-xl border border-white/[0.06]"
                  style={{
                    left: layer.left,
                    top: layer.top,
                    transform: `rotate(${layer.rotate}deg) scale(${layer.scale})`,
                    zIndex: layer.zIndex,
                    minWidth: '100%',
                    minHeight: '100%',
                    background: 'rgba(255,255,255,0.03)',
                    backdropFilter: 'blur(12px)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)',
                  }}
                />
              ))}
              <div
                className="absolute rounded-xl overflow-hidden"
                style={{
                  zIndex: 4,
                  left: '50%',
                  top: '50%',
                  width: '100%',
                  height: '100%',
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                }}
              >
                <MediaImage
                  fileId={images[mainImageIndex]?.id}
                  alt={images[mainImageIndex]?.name || ''}
                  className="w-full h-full object-cover"
                  onImageLoad={handleMainImageLoad}
                />
              </div>
              {imageCount > 1 && (
                <button
                  className="nodrag nopan absolute top-2 right-2 rounded-full bg-[#f59e0b] text-white font-bold shadow-lg flex items-center justify-center hover:bg-[#d97706] transition-colors"
                  style={{ width: 28, height: 28, zIndex: 10, fontSize: 13 }}
                  onClick={(e) => { e.stopPropagation(); toggleExpanded(id); }}
                >
                  {imageCount}
                </button>
              )}
            </div>
          )}
        </div>

        <NodeHandle type="source" testId="source-handle" />

        {/* Border overlay — rendered above all internal content (shadows, image, badge) */}
        <div
          data-testid="border-overlay"
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{
            zIndex: 20,
            border: selected ? '3px solid #9CA3AF' : '1px solid var(--fw-border)',
          }}
        />
      </div>

      {isSingleSelected && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <MultiImageConfigPanel nodeId={id} />
        </div>
      )}
    </div>
  );
}

export const MultiImageNode = memo(MultiImageNodeComponent);
