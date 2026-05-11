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
    <>
      <div
        className={`bg-[#1a1a1a] border-2 rounded-xl w-80 transition-all ${selected ? 'border-[#60a5fa] shadow-lg shadow-[#60a5fa]/20' : 'border-[#555]'}`}
      >
        <Handle type="target" position={Position.Left} className={`!border-2 !border-[#0f0f0f] !w-3 !h-3 ${selected ? '!bg-[#60a5fa] shadow-[0_0_8px_#60a5fa]' : '!bg-[#60a5fa]'}`} />
        <div className="bg-[#2a2a2a] px-3 py-2 rounded-t-xl text-xs font-bold text-[#60a5fa] flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status === 'loading' ? 'bg-yellow-400 animate-pulse' : status === 'done' ? 'bg-[#4ade80]' : status === 'error' ? 'bg-red-400' : 'bg-gray-500'}`} />
          🖼 图片生成节点
        </div>
        <div className="m-3 h-52 bg-[#0f0f0f] border border-dashed border-[#333] rounded-md flex items-center justify-center overflow-hidden">
          {resultUrl ? (
            <img src={resultUrl} alt="generated" className="w-full h-full object-cover" />
          ) : status === 'loading' ? (
            <span className="text-yellow-400 text-sm">⏳ 生成中...</span>
          ) : (
            <span className="text-gray-600 text-sm">🖼 图片预览区</span>
          )}
        </div>
        <Handle type="source" position={Position.Right} className={`!border-2 !border-[#0f0f0f] !w-3 !h-3 ${selected ? '!bg-[#60a5fa] shadow-[0_0_8px_#60a5fa]' : '!bg-[#60a5fa]'}`} />
      </div>
      {/* Config panel — only when selected */}
      {selected && <ImageConfigPanel nodeId={id} />}
    </>
  );
}

export const ImageGenNode = memo(ImageGenNodeComponent);
