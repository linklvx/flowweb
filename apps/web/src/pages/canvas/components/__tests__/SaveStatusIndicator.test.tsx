import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/stores/canvasSyncRuntime', () => ({
  flushCanvasSync: vi.fn().mockResolvedValue(undefined),
}));

import { flushCanvasSync } from '@/stores/canvasSyncRuntime';
import { useCanvasStore } from '@/stores/canvasStore';
import { SaveStatusIndicator } from '../SaveStatusIndicator';

describe('SaveStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saved → 已保存', () => {
    useCanvasStore.setState({ saveStatus: 'saved' });
    render(<SaveStatusIndicator />);
    expect(screen.getByText('已保存')).toBeInTheDocument();
  });

  it('dirty/saving → 保存中…', () => {
    useCanvasStore.setState({ saveStatus: 'saving' });
    const { rerender } = render(<SaveStatusIndicator />);
    expect(screen.getByText('保存中…')).toBeInTheDocument();
    useCanvasStore.setState({ saveStatus: 'dirty' });
    rerender(<SaveStatusIndicator />);
    expect(screen.getByText('保存中…')).toBeInTheDocument();
  });

  it('error → 保存失败，点击重试触发 flush(retry)', async () => {
    useCanvasStore.setState({ saveStatus: 'error' });
    render(<SaveStatusIndicator />);
    fireEvent.click(screen.getByText('保存失败，点击重试'));
    expect(flushCanvasSync).toHaveBeenCalledWith('retry');
  });
});
