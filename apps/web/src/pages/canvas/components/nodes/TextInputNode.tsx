import { memo, useCallback, useState, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { TextConfigPanel } from './TextConfigPanel';
import { TextNodeToolbar } from './TextNodeToolbar';

function TextInputNodeComponent({ id, selected }: NodeProps) {
  const updateText = useNodeStore((s) => s.updateText);
  const nodeData = useNodeStore((s) => s.nodes[id]) as { type: 'text'; content: string } | undefined;
  const content = nodeData?.content ?? '';

  const [label, setLabel] = useState('文本输入');
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(label);

  const save = useCallback(() => {
    const trimmed = draftRef.current.trim();
    if (trimmed) setLabel(trimmed);
    else {
      setDraft(label);
      draftRef.current = label;
    }
  }, [label]);

  const startEdit = useCallback(() => {
    setDraft(label);
    draftRef.current = label;
  }, [label]);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateText(id, e.target.value);
    },
    [id, updateText]
  );

  const titleText = label || '文本输入';

  return (
    <div className="relative">
      {/* Toolbar — above title bar, shown when selected */}
      {selected && (
        <div className="absolute left-1/2 -translate-x-1/2 z-10" style={{ top: -80 }}>
          <TextNodeToolbar nodeId={id} />
        </div>
      )}
      {/* Title bar — below toolbar, above card body */}
      <div
        className="absolute z-[1] pointer-events-auto -translate-y-full left-1 -top-0 pb-2 w-[360px] overflow-hidden whitespace-nowrap flex items-center gap-1 text-[#999]"
        style={{ lineHeight: '18px' }}
      >
        <span className="shrink-0 flex items-center" style={{ width: 12, height: 12 }}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9.719 10.256a.583.583 0 0 1 0 1.166H2.041a.583.583 0 0 1 0-1.166h7.678ZM7.8 6.417a.583.583 0 0 1 0 1.166H2.041a.583.583 0 0 1 0-1.166H7.8ZM11.958 2.578a.583.583 0 0 1 0 1.167H2.041a.583.583 0 0 1 0-1.167h9.917Z" fill="currentColor" />
          </svg>
        </span>
        <div className="relative min-w-0 max-w-full w-max shrink">
          <span
            className="invisible whitespace-pre inline-block pointer-events-none select-none align-top"
            aria-hidden="true"
            style={{ fontSize: 12, lineHeight: '18px' }}
          >
            {titleText}
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              draftRef.current = e.target.value;
            }}
            onFocus={startEdit}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') inputRef.current?.blur();
              if (e.key === 'Escape') {
                setDraft(label);
                draftRef.current = label;
                inputRef.current?.blur();
              }
            }}
            placeholder="请输入标题"
            className="nodrag absolute inset-0 box-border w-full p-0 h-auto bg-transparent text-inherit border-none outline-none"
            style={{ fontSize: 12, lineHeight: '18px', minWidth: 0 }}
            aria-label="节点标题"
            maxLength={20}
          />
        </div>
      </div>
      {/* Card body */}
      <div
        className={`bg-[#222222] border rounded-lg w-[360px] transition-colors ${
          selected ? 'border-white/40' : 'border-[#3a3a3a]'
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
