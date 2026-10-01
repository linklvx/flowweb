import { memo } from 'react';
import { Modal } from 'antd';
import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';

interface Props {
  groupId: string;
  x: number;
  y: number;
  onClose: () => void;
}

const menuItem = (disabled?: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  cursor: disabled ? 'not-allowed' : 'pointer',
  color: disabled ? '#666' : '#fff',
  background: 'none',
  border: 'none',
  fontSize: 13,
  textAlign: 'left',
  width: '100%',
});

function GroupContextMenuComponent({ groupId, x, y, onClose }: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const canPaste = useCanvasStore.getState().hasGroupClipboard();
  const duplicateGroup = useCanvasStore((s) => s.duplicateGroup);
  const copyGroupToClipboard = useCanvasStore((s) => s.copyGroupToClipboard);
  const pasteGroupClipboard = useCanvasStore((s) => s.pasteGroupClipboard);
  const deleteNode = useCanvasStore((s) => s.deleteNode);

  const handleDuplicate = () => {
    duplicateGroup(groupId);
    onClose();
  };

  const handleCopy = () => {
    copyGroupToClipboard(groupId);
    onClose();
  };

  const handlePaste = () => {
    // 粘贴落点换算缝（2a-6）：菜单坐标（clientX/Y）→ flow 坐标在调用点完成——store 薄壳只收 flow 位置
    pasteGroupClipboard(screenToFlowPosition({ x, y }));
    onClose();
  };

  const handleDelete = () => {
    Modal.confirm({
      title: '删除组',
      content: '将删除组及全部子节点',
      okButtonProps: { danger: true },
      onOk: () => {
        // Delete group node and all children
        const state = useCanvasStore.getState();
        const group = state.nodes.find((n) => n.id === groupId);
        if (!group) return;

        const children = state.nodes.filter((n) => n.parentId === groupId);
        const childIds = new Set(children.map((n) => n.id));

        // Delete all children
        for (const childId of childIds) {
          deleteNode(childId);
        }

        // Delete group itself
        deleteNode(groupId);

        // Delete edges connected to group nodes
        const ns = useNodeStore.getState();
        for (const childId of childIds) {
          ns.deleteNode(childId);
        }
        ns.deleteNode(groupId);

        onClose();
      },
    });
  };

  return (
    <div
      className="absolute z-50"
      style={{
        left: x,
        top: y,
        background: 'rgba(0, 0, 0, 0.85)',
        borderRadius: 8,
        padding: '4px 0',
        minWidth: 160,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button style={menuItem()} onClick={handleDuplicate}>
        创建副本
      </button>
      <button style={menuItem()} onClick={handleCopy}>
        复制
      </button>
      <button style={menuItem(!canPaste)} disabled={!canPaste} onClick={handlePaste}>
        粘贴
      </button>
      <div style={{ height: 1, background: 'var(--fw-overlay-2)', margin: '4px 0' }} />
      <button
        style={menuItem()}
        onClick={handleDelete}
        className="hover:!text-red-400"
      >
        删除
      </button>
    </div>
  );
}

export const GroupContextMenu = memo(GroupContextMenuComponent);
