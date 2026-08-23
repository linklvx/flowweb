// apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.tsx
import { memo, useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import type { GroupNodeData } from '@/types/group';
import { GROUP_BOX, BADGE } from './selectionTokens';

interface Props { groupId: string; data: GroupNodeData; selected: boolean }

function NormalGroupRendererComponent({ groupId, data, selected }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const renameGroup = useCanvasStore((s) => s.renameGroup);
  const childCount = useCanvasStore((s) => {
    let count = 0;
    for (let i = 0; i < s.nodes.length; i++) if (s.nodes[i].parentId === groupId) count++;
    return count;
  });
  const name = data.name ?? '分组';

  useEffect(() => {
    if (editing) {
      committedRef.current = false;
      inputRef.current?.focus();
    }
  }, [editing]);

  const submit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    renameGroup(groupId, draft.trim() || '分组');
    setEditing(false);
  };
  const cancel = () => {
    committedRef.current = true;
    // 先移除 onBlur 监听，防止 blur 后再次触发 submit
    if (inputRef.current) {
      inputRef.current.onblur = null;
    }
    setEditing(false);
  };

  if (data.collapsed) {
    return (
      <div
        style={{
          width: 200, height: 64, borderRadius: GROUP_BOX.borderRadius,
          border: `${GROUP_BOX.borderWidth}px dashed ${selected ? GROUP_BOX.selectedBorder : GROUP_BOX.border}`,
          background: 'rgba(26,26,26,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          color: '#cccccc', fontSize: 13,
        }}
      >
        <span>{name}</span>
        <span style={BADGE}>{childCount} 项</span>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        data-testid="group-box"
        style={{
          position: 'absolute', inset: 0, borderRadius: GROUP_BOX.borderRadius,
          border: `${GROUP_BOX.borderWidth}px dashed ${selected ? GROUP_BOX.selectedBorder : GROUP_BOX.border}`,
          background: GROUP_BOX.background, pointerEvents: 'none',
        }}
      />
      {editing ? (
        <input
          ref={inputRef}
          className="nodrag nopan"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if ((e.nativeEvent as KeyboardEvent).isComposing) return;
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') cancel();
          }}
          style={{
            position: 'absolute', top: 8, left: 12, width: 140, zIndex: 2,
            fontSize: 12, color: '#fff', background: '#1a1a1a',
            border: '1px solid #555', borderRadius: 4, padding: '2px 6px', outline: 'none',
          }}
        />
      ) : (
        <div
          onDoubleClick={() => { setDraft(name); setEditing(true); }}
          style={{
            position: 'absolute', top: 8, left: 12, zIndex: 2,
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#0a0a0a', padding: '0 6px',
            fontSize: 12, color: '#cccccc', whiteSpace: 'nowrap',
          }}
        >
          <span>{name}</span>
          <span style={BADGE}>{childCount} 项</span>
        </div>
      )}
    </div>
  );
}
export const NormalGroupRenderer = memo(NormalGroupRendererComponent);
