// apps/web/src/pages/canvas/components/groups/NormalGroupRenderer.tsx
import { memo, useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import type { GroupNodeData } from '@/types/group';
import { resolveGroupColor } from '@/utils/groupColor';
import { GROUP_BOX, BADGE } from './selectionTokens';
import { CollapsedPreviewCard, type CollapsedPreviewCell } from './CollapsedPreviewCard';

interface Props { groupId: string; data: GroupNodeData; selected: boolean }

// 展开态 cells 兜底恒等空数组（selector 稳定引用——zustand Object.is 比对不触发多余重渲）
const EMPTY_CELLS: CollapsedPreviewCell[] = [];

function NormalGroupRendererComponent({ groupId, data, selected }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const renameGroup = useCanvasStore((s) => s.renameGroup);
  // 2d-4：画布团队 id（project 加载链写入）——折叠卡批量预取 batch 必显式携带（越权面同款门在服务端）
  const teamId = useCanvasStore((s) => s.teamId);
  const childCount = useCanvasStore((s) => {
    let count = 0;
    for (let i = 0; i < s.nodes.length; i++) if (s.nodes[i].parentId === groupId) count++;
    return count;
  });
  // 折叠卡 cells：子节点 → { nodeId, fileId }（fileId 取 data.fileId||referenceImage——GroupNode.tsx:55 先例）；
  // 展开态恒返回 EMPTY_CELLS（不逐 store 变更造新数组）
  const collapsed = data.collapsed === true;
  const cells = useCanvasStore((s) => {
    if (!collapsed) return EMPTY_CELLS;
    const out: CollapsedPreviewCell[] = [];
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      if (n.parentId !== groupId) continue;
      const d = n.data as { fileId?: unknown; referenceImage?: unknown } | undefined;
      out.push({ nodeId: n.id, fileId: (d?.fileId || d?.referenceImage) as string | undefined });
    }
    return out;
  });
  const name = data.name ?? '分组';

  useEffect(() => {
    if (editing) {
      committedRef.current = false;
      inputRef.current?.focus();
    }
  }, [editing]);

  // 2d-6：右键菜单「重命名」请求消费——进入与双击相同的编辑态（nonce 防重放：已消费的请求
  // 不因依赖重渲重开。折叠态渲染早退在 hooks 之后，折叠中消费=editing 置位待展开呈现——瞬态信号无超时语义）
  const renameRequest = useCanvasStore((s) => s.renameRequest);
  const consumedNonceRef = useRef(-1);
  useEffect(() => {
    if (!renameRequest || renameRequest.groupId !== groupId || renameRequest.nonce === consumedNonceRef.current) return;
    consumedNonceRef.current = renameRequest.nonce;
    setDraft(name);
    setEditing(true);
  }, [renameRequest, groupId, name]);

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

  // 2d-3：折叠分支=CollapsedPreviewCard（宫格预览卡；根 div 显式尺寸=COLLAPSED_SIZE 不变量载体随之入卡）
  if (collapsed) {
    return (
      <CollapsedPreviewCard
        name={name}
        color={data.color}
        selected={selected}
        cells={cells}
        teamId={teamId}
      />
    );
  }

  // F17/F22：展开态 1px 实线框 + 组色描边（未设色回退 --canvas-group-border——唯一回退点）；
  // 选中反馈由四角手柄承担，边框不随 selected 变化。组名入框：标题/编辑行驻框内顶部预留带（GROUP_PADDING_TOP）。
  const borderColor = resolveGroupColor(data.color) ?? 'var(--canvas-group-border)';

  return (
    <>
      <div
        data-testid="group-box"
        style={{
          position: 'absolute', inset: 0, borderRadius: GROUP_BOX.borderRadius,
          border: `1px solid ${borderColor}`,
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
            position: 'absolute', top: 0, left: 0,
            width: 140, zIndex: 2,
            fontSize: 13, color: 'var(--canvas-controls-text)', background: 'var(--canvas-controls-bg)',
            border: '1px solid var(--canvas-controls-border)', borderRadius: 4, padding: '2px 6px', outline: 'none',
          }}
        />
      ) : (
        <div
          onDoubleClick={() => { setDraft(name); setEditing(true); }}
          style={{
            position: 'absolute', top: 0, left: 0, zIndex: 2,
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
