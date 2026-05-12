import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { VideoConfigPanel } from './VideoConfigPanel';

function VideoGenNodeComponent({ id, selected }: NodeProps) {
  const nodeData = useNodeStore((s) => s.nodes[id]) as any;
  const status = nodeData?.status ?? 'idle';
  const videoUrl = nodeData?.videoUrl;

  return (
    <div className="relative">
      <div
        className={`bg-[#1a1a1a] border-2 rounded-xl w-80 transition-all ${selected ? 'border-[#c084fc] shadow-lg shadow-[#c084fc]/20' : 'border-[#555]'}`}
      >
        <Handle type="target" position={Position.Left} className={`!border-2 !border-[#0f0f0f] !w-3 !h-3 ${selected ? '!bg-[#c084fc] shadow-[0_0_8px_#c084fc]' : '!bg-[#c084fc]'}`} />
        <div className="bg-[#2a2a2a] px-3 py-1 rounded-t-xl text-xs font-bold text-[#c084fc] flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status === 'loading' ? 'bg-yellow-400 animate-pulse' : status === 'done' ? 'bg-[#4ade80]' : status === 'error' ? 'bg-red-400' : 'bg-gray-500'}`} />
          🎬 视频生成节点
        </div>
        <div className="m-2 bg-[#0f0f0f] border border-dashed border-[#333] rounded-md flex items-center justify-center overflow-hidden" style={{ height: 200 }}>
          {videoUrl ? (
            <video controls className="w-full h-full object-contain">
              <source src={videoUrl} type="video/mp4" />
            </video>
          ) : status === 'loading' ? (
            <span className="text-yellow-400 text-sm">⏳ 生成中...</span>
          ) : (
            <span className="text-gray-600 text-sm">🎬 视频预览区</span>
          )}
        </div>
        <Handle type="source" position={Position.Right} className={`!border-2 !border-[#0f0f0f] !w-3 !h-3 ${selected ? '!bg-[#c084fc] shadow-[0_0_8px_#c084fc]' : '!bg-[#c084fc]'}`} />
      </div>
      {selected && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <VideoConfigPanel nodeId={id} />
        </div>
      )}
    </div>
  );
}

export const VideoGenNode = memo(VideoGenNodeComponent);
