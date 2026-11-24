// NodeContextMenu.tsx（Y4b T11 入口 A——全节点右键菜单）
// 定位/视觉同 GroupContextMenu 先例（绝对定位 div + 内联 menuItem + memo）；纯展示组件——
// 无 useReactFlow 依赖（本菜单无坐标换算需求），坐标由调用方传 clientX/clientY 原样落位。
// Y5 T8 评审 I：只读态由调用方不打开本菜单（本菜单唯一项=批注写动作——禁广告不可用动作）。
import { memo } from 'react';

interface Props {
  nodeId: string;
  x: number;
  y: number;
  /** 「批注」动作：调用方打开 ThreadComposer（node 形态） */
  onAnnotate: (nodeId: string) => void;
  onClose: () => void;
}

const menuItem = (): React.CSSProperties => ({
  padding: '8px 16px',
  cursor: 'pointer',
  color: '#fff',
  background: 'none',
  border: 'none',
  fontSize: 13,
  textAlign: 'left',
  width: '100%',
});

function NodeContextMenuComponent({ nodeId, x, y, onAnnotate, onClose }: Props) {
  return (
    <div
      data-testid="node-context-menu"
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
      <button
        style={menuItem()}
        onClick={() => { onAnnotate(nodeId); onClose(); }}
      >
        批注
      </button>
    </div>
  );
}

export const NodeContextMenu = memo(NodeContextMenuComponent);
