import { memo, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { io } from 'socket.io-client';
import { useNodeStore } from '@/stores/nodeStore';
import { ImageConfigPanel } from './ImageConfigPanel';

function ImageGenNodeComponent({ id, selected }: NodeProps) {
  const nodeData = useNodeStore((s) => s.nodes[id]) as any;
  const status = nodeData?.status ?? 'idle';
  const resultUrl = nodeData?.resultUrl;

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
      } else if (data.status === 'done' && data.resultUrl) {
        console.log('[ImageGenNode] setting resultUrl:', data.resultUrl);
        useNodeStore.getState().setResult(id, data.resultUrl);
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
      <div className="absolute -top-[18px] left-0 w-[580px] text-[11px] text-[#999] font-medium flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'loading' ? 'bg-yellow-400 animate-pulse' : status === 'done' ? 'bg-[#4ade80]' : status === 'error' ? 'bg-red-400' : 'bg-gray-500'}`} />
        图片生成
      </div>
      <div
        className={`bg-[#222222] border rounded-lg w-[580px] transition-colors ${
          selected ? '' : 'border-white/10'
        }`}
        style={
          selected
            ? { borderColor: '#9CA3AF', borderWidth: '2px', borderStyle: 'solid' }
            : undefined
        }
      >
        <Handle type="target" position={Position.Left} className="!bg-[#60a5fa] !border-0 !w-2 !h-2" />
        <div className="p-3">
          <div className="h-[306px] bg-transparent border border-[#3a3a3a] rounded-md flex items-center justify-center overflow-hidden">
            {resultUrl ? (
              <img src={resultUrl} alt="generated" className="w-full h-full object-cover" />
            ) : status === 'loading' ? (
              <span className="text-yellow-400 text-xs">⏳ 生成中...</span>
            ) : (
              <span className="text-[#666] text-xs">图片预览区</span>
            )}
          </div>
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
