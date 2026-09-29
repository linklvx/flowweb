// apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.tsx
import { memo, useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import type { GroupNodeData } from '@/types/group';
import { COLLAPSED_SIZE } from '@/utils/groupLayout';
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
    setEditing(false);
  };

  if (data.collapsed) {
    return (
      <div
        style={{
          width: COLLAPSED_SIZE.width, height: COLLAPSED_SIZE.height, borderRadius: GROUP_BOX.borderRadius,
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
    <>
      <div
        data-testid="group-box"
        style={{
          position: 'absolute', inset: 0, borderRadius: GROUP_BOX.borderRadius,
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
            position: 'absolute', top: 0, left: 0, transform: 'translateY(calc(-100% - 10px))',
            width: 140, zIndex: 2,
            fontSize: 13, color: 'var(--canvas-controls-text)', background: 'var(--canvas-controls-bg)',
            border: '1px solid var(--canvas-controls-border)', borderRadius: 4, padding: '2px 6px', outline: 'none',
          }}
        />
      ) : (
        <div
          onDoubleClick={() => { setDraft(name); setEditing(true); }}
          style={{
            position: 'absolute', top: 0, left: 0, transform: 'translateY(calc(-100% - 10px))', zIndex: 2,
            display: 'flex', alignItems: 'center', gap: 6, padding: '0 2px',
            fontSize: 13, color: '#999', whiteSpace: 'nowrap',
          }}
        >
          <span>{name}</span>
          <span style={BADGE}>{childCount} 项</span>
        </div>
      )}
    </>
  );
}
export const NormalGroupRenderer = memo(NormalGroupRendererComponent);
