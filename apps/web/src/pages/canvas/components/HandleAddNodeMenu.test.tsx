import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { HandleAddNodeMenu } from './HandleAddNodeMenu';
import { useMenuStore } from '@/stores/menuStore';

const mockAddNode = vi.fn(() => 'new-1'); // 构造时实现：clearAllMocks 只清调用记录、保留 implementation（mockReset 才清），此写法在 beforeEach clearAllMocks 下安全
const mockAddEdge = vi.fn();

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = { addNode: mockAddNode, addEdge: mockAddEdge };
      return typeof selector === 'function' ? selector(state) : state;
    }),
    { getState: () => ({ addNode: mockAddNode, addEdge: mockAddEdge }) },
  ),
}));

const openMenu = (side: 'source' | 'target') => {
  useMenuStore.getState().openHandleMenu({
    x: 400, y: 300, nodeId: 'img1', side,
    flowPoint: { x: 1200, y: 800 },
  });
};

describe('HandleAddNodeMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMenuStore.getState().closeHandleMenu();
    useMenuStore.getState().close();
  });

  it('source 侧渲染 4 项（文本/图片/视频/音频）', () => {
    openMenu('source');
    render(<HandleAddNodeMenu />);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '文本' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '图片' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '视频' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '音频' })).toBeTruthy();
  });

  it('target 侧仅渲染 2 项（文本/图片）', () => {
    openMenu('target');
    render(<HandleAddNodeMenu />);
    expect(screen.getByRole('menuitem', { name: '文本' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '图片' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '视频' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '音频' })).not.toBeInTheDocument();
  });

  it('source 侧选「文本」→ 建节点于松手点-半宽高 + 建边 原→新（handle: 确定性 id）', () => {
    openMenu('source');
    render(<HandleAddNodeMenu />);
    fireEvent.click(screen.getByRole('menuitem', { name: '文本' }));
    expect(mockAddNode).toHaveBeenCalledWith('textInput', { x: 1200 - 125, y: 800 - 30 });
    expect(mockAddEdge).toHaveBeenCalledWith('img1', 'new-1', undefined, undefined, 'handle:img1:new-1');
    expect(useMenuStore.getState().handleMenu).toBeUndefined();
  });

  it('target 侧选「图片」→ 建边 新→原', () => {
    openMenu('target');
    render(<HandleAddNodeMenu />);
    fireEvent.click(screen.getByRole('menuitem', { name: '图片' }));
    expect(mockAddNode).toHaveBeenCalledWith('imageGen', { x: 1200 - 125, y: 800 - 30 });
    expect(mockAddEdge).toHaveBeenCalledWith('new-1', 'img1', undefined, undefined, 'handle:new-1:img1');
  });

  it('点击背板关闭；Escape 关闭', () => {
    openMenu('source');
    render(<HandleAddNodeMenu />);
    fireEvent.click(screen.getByTestId('handle-add-node-menu-backdrop'));
    expect(useMenuStore.getState().handleMenu).toBeUndefined();
    // act 包裹：act 外的原生 store 写入被 React 18 批处理推迟，Escape 监听的 effect 须先刷新重挂
    act(() => { openMenu('source'); });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useMenuStore.getState().handleMenu).toBeUndefined();
  });

  it('menuStore 三向互斥：openHandleMenu 关闭 AddNodeMenu 态，open 清 handleMenu，openStyleLibrary 清 isOpen/handleMenu', () => {
    useMenuStore.getState().open({ x: 1, y: 1 });
    openMenu('source');
    expect(useMenuStore.getState().isOpen).toBe(false);
    useMenuStore.getState().open({ x: 2, y: 2 });
    expect(useMenuStore.getState().handleMenu).toBeUndefined();
    // 三切片（spec §4.1）：openStyleLibrary 清 isOpen/handleMenu，open/openHandleMenu 清 styleLibrary
    useMenuStore.getState().openStyleLibrary('img9');
    expect(useMenuStore.getState().isOpen).toBe(false);
    expect(useMenuStore.getState().handleMenu).toBeUndefined();
    useMenuStore.getState().open({ x: 3, y: 3 });
    expect(useMenuStore.getState().styleLibrary).toBeNull();
  });
});
