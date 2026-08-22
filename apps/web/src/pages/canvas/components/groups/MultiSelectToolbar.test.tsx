// MultiSelectToolbar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiSelectToolbar } from './MultiSelectToolbar';

const mk = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, data, selected: true }) as any;

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (sel: any) => sel({
    nodes: [
      mk('n1', 'imageGen', { status: 'done', fileId: 'f1' }),
      mk('n2', 'textInput'),
    ],
  }),
}));

describe('MultiSelectToolbar', () => {
  it('多选 ≥2 时显示打组按钮', () => {
    render(<MultiSelectToolbar />);
    expect(screen.getByText(/打组/)).toBeTruthy();
  });

  it('点击打组调用 groupNodes', () => {
    const spy = vi.fn();
    render(<MultiSelectToolbar onGroup={spy} />);
    // 先打开下拉
    fireEvent.click(screen.getByRole('button', { name: /打组/ }));
    // 再点下拉项
    fireEvent.click(screen.getByText('打组（Ctrl+G）'));
    expect(spy).toHaveBeenCalledWith(['n1', 'n2']);
  });
});
