import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as react from 'react';

const rf = vi.hoisted(() => {
  let nodes: any[] = [];
  const listeners = new Set<() => void>();
  return {
    setNodes: (n: any[]) => { nodes = n; listeners.forEach((l) => l()); },
    useStore: (selector: any) =>
      react.useSyncExternalStore(
        (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); },
        () => selector({ nodes }),
      ),
  };
});

// canvasStore.ts:4 运行时 import applyNodeChanges/applyEdgeChanges，mock 工厂必须补导出
vi.mock('@xyflow/react', () => ({
  useStore: rf.useStore,
  applyNodeChanges: vi.fn(),
  applyEdgeChanges: vi.fn(),
}));

import { useIsSingleSelected } from './useIsSingleSelected';
import { useCanvasStore } from '@/stores/canvasStore';

function Probe({ selected }: { selected: boolean }) {
  const single = useIsSingleSelected(selected);
  return <div data-testid="probe">{single ? 'single' : 'multi'}</div>;
}

describe('useIsSingleSelected', () => {
  beforeEach(() => {
    useCanvasStore.setState({ lastPointerShiftKey: false, marqueeSelecting: false });
  });

  it('单选时为 true', () => {
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });

  it('Bug A 残留时序：先选中 A（count=1）再加选 B → A 的单选态消失', () => {
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('single');
    act(() => { rf.setNodes([{ id: 'a', selected: true }, { id: 'b', selected: true }]); });
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('减选回单选恢复 true', () => {
    rf.setNodes([{ id: 'a', selected: true }, { id: 'b', selected: true }]);
    render(<Probe selected />);
    act(() => { rf.setNodes([{ id: 'a', selected: true }, { id: 'b', selected: false }]); });
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });

  it('节点自身未选中恒为 false', () => {
    rf.setNodes([{ id: 'a', selected: false }]);
    render(<Probe selected={false} />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('Shift 多选抑制：flag=true 时单选也返回 false', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('边界：count=0 + flag=true 为 false', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    rf.setNodes([]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('恢复路径：flag true→false 且选中数不变时恢复 true（依赖 flag 订阅触发重渲染）', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
    act(() => { useCanvasStore.setState({ lastPointerShiftKey: false }); });
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });

  it('框选进行中抑制：marqueeSelecting=true 时单选返回 false', () => {
    useCanvasStore.setState({ marqueeSelecting: true });
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
  });

  it('框选结束恢复：marqueeSelecting true→false 且选中数不变时恢复 single（依赖标志订阅触发重渲染）', () => {
    useCanvasStore.setState({ marqueeSelecting: true });
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('multi');
    act(() => { useCanvasStore.setState({ marqueeSelecting: false }); });
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });
});
