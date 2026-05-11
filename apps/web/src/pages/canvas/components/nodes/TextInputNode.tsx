import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';

function TextInputNodeComponent({ id, selected }: NodeProps) {
  const updateText = useNodeStore((s) => s.updateText);
  const nodeData = useNodeStore((s) => s.nodes[id]) as { type: 'text'; content: string } | undefined;
  const content = nodeData?.content ?? '';

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateText(id, e.target.value);
    },
    [id, updateText]
  );

  return (
    <div
      className={`bg-[#1a1a1a] border-2 rounded-xl w-64 transition-shadow ${selected ? 'border-[#4ade80] shadow-lg shadow-[#4ade80]/10' : 'border-[#444]'}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-[#4ade80] !border-2 !border-[#0f0f0f] !w-3 !h-3" />
      <div className="bg-[#2a2a2a] px-3 py-2 rounded-t-xl text-xs font-bold text-[#4ade80]">
        📝 文本输入节点
      </div>
      <div className="p-3">
        <textarea
          value={content}
          onChange={onChange}
          placeholder="输入 Prompt..."
          className="w-full h-16 bg-[#0f0f0f] border border-[#333] rounded-md p-2 text-xs text-[#ccc] resize-none focus:outline-none focus:border-[#4ade80] box-border"
        />
      </div>
      <Handle type="source" position={Position.Right} className="!bg-[#4ade80] !border-2 !border-[#0f0f0f] !w-3 !h-3" />
    </div>
  );
}

export const TextInputNode = memo(TextInputNodeComponent);
