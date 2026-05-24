import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

function MultiImageNodeComponent({ id, selected }: NodeProps) {
  return (
    <div className="bg-[#222222] rounded-lg" style={{ width: 400, height: 300 }}>
      <Handle type="target" position={Position.Left} className="!bg-[#f59e0b] !border-0 !w-2 !h-2" />
      <div className="flex items-center justify-center h-full text-[#555]">MultiImageNode</div>
      <Handle type="source" position={Position.Right} className="!bg-[#f59e0b] !border-0 !w-2 !h-2" />
    </div>
  );
}

export const MultiImageNode = memo(MultiImageNodeComponent);
