import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

function VideoGenNodeComponent({ selected }: NodeProps) {
  return (
    <div
      className={`bg-[#1a1a1a] border-2 rounded-xl w-64 transition-shadow ${selected ? 'border-[#c084fc] shadow-lg shadow-[#c084fc]/10' : 'border-[#555]'}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#c084fc] !border-2 !border-[#0f0f0f] !w-3 !h-3" />
      <div className="bg-[#2a2a2a] px-3 py-2 rounded-t-xl text-xs font-bold text-[#c084fc]">
        🎬 视频生成节点
      </div>
      <div className="p-6 text-center">
        <span className="text-xs text-[#666]">视频生成 — Phase 3</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-[#c084fc] !border-2 !border-[#0f0f0f] !w-3 !h-3" />
    </div>
  );
}

export const VideoGenNode = memo(VideoGenNodeComponent);
