// apps/web/src/pages/canvas/components/groups/BatchAddNodeMenu.test.tsx
// B6-3（Spec B 需求 7 / 拍板②）：+号点击/拖线落空弹出的批量建点菜单——HandleAddNodeMenu 同构
// （背板遮罩+Escape 关闭+边界钳制）；选中项 → addNodeAndBatchConnect（建点+源集→新节点 N 边）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BatchAddNodeMenu } from './BatchAddNodeMenu';
import { useMenuStore } from '@/stores/menuStore';

const mockAddNodeAndBatchConnect = vi.fn(() => 'new-1'); // 构造时实现：clearAllMocks 只清调用记录（HandleAddNodeMenu.test 同款）

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = { addNodeAndBatchConnect: mockAddNodeAndBatchConnect };
      return typeof selector === 'function' ? selector(state) : state;
    }),
    { getState: () => ({ addNodeAndBatchConnect: mockAddNodeAndBatchConnect }) },
  ),
}));

const openMenu = () => {
  useMenuStore.getState().openBatchMenu({
    x: 400, y: 300, flowPoint: { x: 1200, y: 800 }, sourceIds: ['a', 'b'],
  });
};

describe('BatchAddNodeMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMenuStore.getState().closeBatchMenu();
    useMenuStore.getState().closeHandleMenu();
    useMenuStore.getState().close();
  });

  it('渲染 SOURCE_ITEMS 4 项（新节点=目标——HandleAddNodeMenu side=source 语义同款）', () => {
    openMenu();
    render(<BatchAddNodeMenu />);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '文本' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '图片' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '视频' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '音频' })).toBeTruthy();
  });

  it('未开 → 不渲染', () => {
    render(<BatchAddNodeMenu />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('选「文本」→ 建节点于 flowPoint-125/-30（HandleAddNodeMenu:46 同款落位）+ 源集→新节点批量连线 + 关闭', () => {
    openMenu();
    render(<BatchAddNodeMenu />);
    fireEvent.click(screen.getByRole('menuitem', { name: '文本' }));
    expect(mockAddNodeAndBatchConnect).toHaveBeenCalledWith('textInput', { x: 1200 - 125, y: 800 - 30 }, ['a', 'b']);
    expect(useMenuStore.getState().batchMenu).toBeUndefined();
  });

  it('点击背板关闭；Escape 关闭（AddNodeMenu 关闭机制同款）', () => {
    openMenu();
    render(<BatchAddNodeMenu />);
    fireEvent.click(screen.getByTestId('batch-add-node-menu-backdrop'));
    expect(useMenuStore.getState().batchMenu).toBeUndefined();
    // act 包裹：act 外的原生 store 写入被 React 18 批处理推迟，Escape 监听的 effect 须先刷新重挂
    act(() => { openMenu(); });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useMenuStore.getState().batchMenu).toBeUndefined();
  });

  it('menuStore 四向互斥：openBatchMenu 关 AddNodeMenu/handleMenu 态，其余 open 清 batchMenu', () => {
    useMenuStore.getState().open({ x: 1, y: 1 });
    openMenu();
    expect(useMenuStore.getState().isOpen).toBe(false);
    useMenuStore.getState().openHandleMenu({ x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } });
    expect(useMenuStore.getState().batchMenu).toBeUndefined();
    act(() => { openMenu(); });
    useMenuStore.getState().open({ x: 2, y: 2 });
    expect(useMenuStore.getState().batchMenu).toBeUndefined();
    act(() => { openMenu(); });
    useMenuStore.getState().openStyleLibrary('img9');
    expect(useMenuStore.getState().batchMenu).toBeUndefined();
  });
});
