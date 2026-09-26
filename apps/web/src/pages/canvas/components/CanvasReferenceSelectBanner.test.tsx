import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasReferenceSelectBanner } from './CanvasReferenceSelectBanner';
import { useNodeStore } from '@/stores/nodeStore';

// 固定 spy（vi.hoisted）——getState 每次返回同一对象，否则断言拿到全新 vi.fn() 恒 0 调用
const { selectNodeSpy } = vi.hoisted(() => ({ selectNodeSpy: vi.fn() }));
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ selectNode: selectNodeSpy }) },
}));

const setCenter = vi.fn();
const getNode = vi.fn();
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ setCenter, getNode }),
}));

describe('CanvasReferenceSelectBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNodeStore.setState({
      referenceSelect: null,
      nodes: { img1: { id: 'img1', type: 'imageGen', position: { x: 100, y: 200 }, data: {} } } as any,
    });
  });

  it('模式未激活不渲染', () => {
    render(<CanvasReferenceSelectBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('激活时渲染图标+文案(status)+返回节点+退出', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    render(<CanvasReferenceSelectBanner />);
    expect(screen.getByRole('status').textContent).toBe('从画布选择参考');
    expect(screen.getByRole('button', { name: '返回节点' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出' })).toBeInTheDocument();
  });

  it('notice 替换文案（满员提示）', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    useNodeStore.getState().flashReferenceNotice('最多 9 张参考图');
    render(<CanvasReferenceSelectBanner />);
    expect(screen.getByRole('status').textContent).toBe('最多 9 张参考图');
  });

  it('退出按钮 / Esc → 纯退出（不选中）', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    render(<CanvasReferenceSelectBanner />);
    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(useNodeStore.getState().referenceSelect).toBeNull();
    useNodeStore.getState().startReferenceSelect('img1');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useNodeStore.getState().referenceSelect).toBeNull();
  });

  it('返回节点 → 退出+setCenter 到节点中心（几何取 useReactFlow().getNode，P11）+selectNode', () => {
    useNodeStore.getState().startReferenceSelect('img1');
    // 几何从 RF 内部节点取（P11：nodeStore 节点无 measured/internals）
    getNode.mockReturnValue({
      id: 'img1',
      position: { x: 100, y: 200 },
      measured: { width: 200, height: 150 },
      internals: { positionAbsolute: { x: 100, y: 200 } },
    });
    render(<CanvasReferenceSelectBanner />);
    fireEvent.click(screen.getByRole('button', { name: '返回节点' }));
    expect(useNodeStore.getState().referenceSelect).toBeNull();
    expect(setCenter).toHaveBeenCalledWith(200, 275, expect.anything());
    expect(selectNodeSpy).toHaveBeenCalledWith('img1');
  });
});
