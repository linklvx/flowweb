import { describe, it, expect, vi } from 'vitest';
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

vi.mock('@xyflow/react', () => ({ useStore: rf.useStore }));

import { useIsSingleSelected } from './useIsSingleSelected';

function Probe({ selected }: { selected: boolean }) {
  const single = useIsSingleSelected(selected);
  return <div data-testid="probe">{single ? 'single' : 'multi'}</div>;
}

describe('useIsSingleSelected', () => {
  it('单选时为 true', () => {
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />);
    expect(screen.getByTestId('probe').textContent).toBe('single');
  });

  it('Bug A 残留时序：先选中 A（count=1）再加选 B → A 的单选态消失', () => {
    rf.setNodes([{ id: 'a', selected: true }]);
    render(<Probe selected />); // 此时 A 渲染，count=1
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
});
