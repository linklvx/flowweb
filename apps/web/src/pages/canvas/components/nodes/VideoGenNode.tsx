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
      <div className="absolute -top-[18px] left-0 w-80 text-[11px] text-[#999] font-medium flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'loading' ? 'bg-yellow-400 animate-pulse' : status === 'done' ? 'bg-[#4ade80]' : status === 'error' ? 'bg-red-400' : 'bg-gray-500'}`} />
        视频生成
      </div>
      <div
        className={`bg-[#222222] border rounded-lg w-80 transition-colors ${
          selected ? 'border-[#c084fc]' : 'border-[#3a3a3a]'
        }`}
      >
        <Handle type="target" position={Position.Left} className="!bg-[#c084fc] !border-0 !w-2 !h-2" />
        <div className="p-3">
          <div className="h-[200px] bg-transparent border border-[#3a3a3a] rounded-md flex items-center justify-center overflow-hidden">
            {videoUrl ? (
              <video controls className="w-full h-full object-contain">
                <source src={videoUrl} type="video/mp4" />
              </video>
            ) : status === 'loading' ? (
              <span className="text-yellow-400 text-xs">⏳ 生成中...</span>
            ) : (
              <span className="text-[#666] text-xs">视频预览区</span>
            )}
          </div>
        </div>
        <Handle type="source" position={Position.Right} className="!bg-[#c084fc] !border-0 !w-2 !h-2" />
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
