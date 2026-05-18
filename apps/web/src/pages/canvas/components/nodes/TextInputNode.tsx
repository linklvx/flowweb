import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { TextConfigPanel } from './TextConfigPanel';

function TextInputNodeComponent({ id, selected }: NodeProps) {
  const updateText = useNodeStore((s) => s.updateText);
  const nodeData = useNodeStore((s) => s.nodes[id]) as { type: 'text'; content: string } | undefined;
  const content = nodeData?.content ?? '';

  const [label, setLabel] = useState('文本输入');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const save = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed) {
      setLabel(trimmed);
    } else {
      setDraft(label);
    }
    setEditing(false);
  }, [draft, label]);

  const startEdit = useCallback(() => {
    setDraft(label);
    setEditing(true);
  }, [label]);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateText(id, e.target.value);
    },
    [id, updateText]
  );

  return (
    <div className="relative">
      <div className="absolute -top-[18px] left-0 w-[360px] text-[11px] text-[#999] font-medium">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') {
                setDraft(label);
                setEditing(false);
              }
            }}
            className="nodrag bg-[#222222] border border-[#3a3a3a] rounded px-1 py-0 text-[11px] text-[#ccc] outline-none w-[140px]"
            aria-label="节点标题"
            maxLength={20}
          />
        ) : (
          <span
            onClick={startEdit}
            className="cursor-pointer hover:text-[#ccc] transition-colors"
          >
            {label}
          </span>
        )}
      </div>
      <div
        className={`bg-[#222222] border rounded-lg w-[360px] transition-colors ${
          selected ? 'border-[#4ade80]' : 'border-[#3a3a3a]'
        }`}
      >
        <Handle type="target" position={Position.Left} className="!bg-[#555] !border-0 !w-2 !h-2" />
        <div className="p-3">
          <textarea
            value={content}
            onChange={onChange}
            placeholder="点击输入文本..."
            className="nodrag w-full h-[186px] bg-transparent border-0 rounded-md p-2 text-xs text-[#ccc] placeholder-[#666] resize-none focus:outline-none box-border transition-colors"
          />
        </div>
        <Handle type="source" position={Position.Right} className="!bg-[#555] !border-0 !w-2 !h-2" />
      </div>
      {selected && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 z-50 pt-4">
          <TextConfigPanel nodeId={id} />
        </div>
      )}
    </div>
  );
}

export const TextInputNode = memo(TextInputNodeComponent);
