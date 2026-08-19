import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/canvasApi', () => ({ saveCanvas: vi.fn() }));
vi.mock('@/api/projectApi', () => ({ syncNodes: vi.fn(), syncEdges: vi.fn() }));
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ nodes: [], edges: [] }) },
}));

import { saveCanvas } from '@/api/canvasApi';
import { SaveAsTemplateDialog } from '../SaveAsTemplateDialog';

describe('SaveAsTemplateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveCanvas).mockResolvedValue({} as never);
  });

  it('保存调 saveCanvas（projectId + name/description/isPublic）', async () => {
    render(
      <SaveAsTemplateDialog projectId="p1" projectName="我的画布" onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText('简要描述模板用途'), { target: { value: '描述' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveCanvas).toHaveBeenCalledWith('p1', {
      name: '我的画布', description: '描述', isPublic: false,
    }));
  });

  it('保存失败显示错误且不回调 onSaved', async () => {
    vi.mocked(saveCanvas).mockRejectedValue(new Error('boom'));
    const onSaved = vi.fn();
    render(<SaveAsTemplateDialog projectId="p1" projectName="n" onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
    await waitFor(() => expect(onSaved).not.toHaveBeenCalled());
  });
});
