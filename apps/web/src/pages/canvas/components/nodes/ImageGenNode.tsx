import { memo, useEffect, useState, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { io } from 'socket.io-client';
import { useNodeStore } from '@/stores/nodeStore';
import { ImageConfigPanel } from './ImageConfigPanel';
import { useMediaUrl } from '@/hooks/useMediaUrl';

const MAX_WIDTH = 548;
const MAX_HEIGHT = 500;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;

function calcConstrainedSize(naturalW: number, naturalH: number) {
  let w = naturalW;
  let h = naturalH;

  // Scale down to max dimensions maintaining aspect ratio
  if (w > MAX_WIDTH) {
    h = Math.round(h * (MAX_WIDTH / w));
    w = MAX_WIDTH;
  }
  if (h > MAX_HEIGHT) {
    w = Math.round(w * (MAX_HEIGHT / h));
    h = MAX_HEIGHT;
  }
  // Enforce minimum dimensions
  if (w < MIN_WIDTH) w = MIN_WIDTH;
  if (h < MIN_HEIGHT) h = MIN_HEIGHT;

  return { w, h };
}

function ImageGenNodeComponent({ id, selected }: NodeProps) {
  const nodeData = useNodeStore((s) => s.nodes[id]) as any;
  const status = nodeData?.status ?? 'idle';
  const fileId = nodeData?.fileId;
  const referenceImage = nodeData?.referenceImage;
  const { url: resultUrl } = useMediaUrl(fileId);
  const { url: refPreviewUrl } = useMediaUrl(referenceImage);

  const displayUrl = resultUrl || refPreviewUrl;

  // Dynamic sizing based on image aspect ratio
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const size = calcConstrainedSize(img.naturalWidth, img.naturalHeight);
    setImgSize(size);
  }, []);

  // Reset dimensions when image URL changes
  useEffect(() => {
    setImgSize(null);
  }, [displayUrl]);

  const containerWidth = imgSize ? imgSize.w : 548;
  const containerHeight = imgSize ? imgSize.h : 306;

  useEffect(() => {
    const socket = io('/execution', { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      console.log('[ImageGenNode] socket connected, joining default');
      socket.emit('join', 'default');
    });

    socket.on('connect_error', (err: any) => {
      console.error('[ImageGenNode] socket connect error:', err.message);
    });

    socket.on('node:status', (data: any) => {
      console.log('[ImageGenNode] received node:status:', data);
      if (data.nodeId !== id) return;
      if (data.status === 'loading') {
        useNodeStore.getState().setStatus(id, 'loading');
      } else if (data.status === 'done' && data.fileId) {
        console.log('[ImageGenNode] setting fileId:', data.fileId);
        useNodeStore.getState().setFileResult(id, data.fileId);
      } else if (data.status === 'error') {
        useNodeStore.getState().setStatus(id, 'error');
      }
      if (data.credits !== undefined) {
        window.dispatchEvent(new CustomEvent('credits:update', { detail: data.credits }));
      }
    });

    return () => { socket.disconnect(); };
  }, [id]);

  return (
    <div className="relative">
      <div
        className="absolute -top-[18px] left-0 text-[11px] text-[#999] font-medium flex items-center gap-1.5"
        style={{ width: containerWidth }}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'loading' ? 'bg-yellow-400 animate-pulse' : status === 'done' ? 'bg-[#4ade80]' : status === 'error' ? 'bg-red-400' : 'bg-gray-500'}`} />
        图片生成
      </div>
      <div
        className={`bg-[#222222] border rounded-lg transition-colors ${
          selected ? '' : 'border-white/10'
        }`}
        style={{
          width: containerWidth,
          ...(selected
            ? { borderColor: '#9CA3AF', borderWidth: '2px', borderStyle: 'solid' }
            : undefined),
        }}
      >
        <Handle type="target" position={Position.Left} className="!bg-[#60a5fa] !border-0 !w-2 !h-2" />
        <div
          className="flex items-center justify-center overflow-hidden rounded-lg transition-all duration-300"
          style={{ width: containerWidth, height: containerHeight }}
        >
          {displayUrl ? (
            <img
              src={displayUrl}
              alt="preview"
              className="max-w-full max-h-full object-contain"
              onLoad={handleImageLoad}
            />
          ) : status === 'loading' ? (
            <span className="text-yellow-400 text-xs">⏳ 生成中...</span>
          ) : (
            <span className="text-[#666] text-xs">图片预览区</span>
          )}
        </div>
        <Handle type="source" position={Position.Right} className="!bg-[#60a5fa] !border-0 !w-2 !h-2" />
      </div>
      {selected && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <ImageConfigPanel nodeId={id} />
        </div>
      )}
    </div>
  );
}

export const ImageGenNode = memo(ImageGenNodeComponent);
