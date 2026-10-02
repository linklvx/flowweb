// GroupContextMenu.test.tsx（2d-6 新建）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const cs = vi.hoisted(() => ({ state: {} as Record<string, any> }));

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ screenToFlowPosition: () => ({ x: 0, y: 0 }) }),
}));
// 照 TextConfigPanel.test.tsx:40 先例——选择器订阅 + getState 双面 mock
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    (sel: any) => sel(cs.state),
    { getState: () => cs.state },
  ),
}));

import { GroupContextMenu } from './GroupContextMenu';

describe('GroupContextMenu（2d-6 右键重命名入口）', () => {
  beforeEach(() => {
    cs.state = {
      hasGroupClipboard: () => false,
      duplicateGroup: vi.fn(),
      copyGroupToClipboard: vi.fn(),
      pasteGroupClipboard: vi.fn(),
      deleteNode: vi.fn(),
    };
  });

  it('菜单含「重命名」项 → 触发编辑态回调（与 NormalGroupRenderer 双击共享编辑态——回调接线以现场组件状态形态最小改动）', () => {
    const onRename = vi.fn();
    const onClose = vi.fn();
    render(<GroupContextMenu groupId="g1" x={0} y={0} onRename={onRename} onClose={onClose} />);
    fireEvent.click(screen.getByText('重命名'));
    expect(onRename).toHaveBeenCalledWith('g1');
    expect(onClose).toHaveBeenCalledTimes(1);   // 触发后即收菜单（与创建副本同款）
  });
});
