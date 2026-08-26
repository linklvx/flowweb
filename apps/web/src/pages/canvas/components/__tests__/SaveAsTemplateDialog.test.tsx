import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/canvasApi', () => ({ saveCanvas: vi.fn() }));
vi.mock('@/stores/canvasSyncRuntime', () => ({ flushCanvasSync: vi.fn() }));

import { saveCanvas } from '@/api/canvasApi';
import { flushCanvasSync } from '@/stores/canvasSyncRuntime';
import { SaveAsTemplateDialog } from '../SaveAsTemplateDialog';

describe('SaveAsTemplateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(flushCanvasSync).mockResolvedValue(true);
    vi.mocked(saveCanvas).mockResolvedValue({} as never);
  });

  it('保存：先 flush 再提交模板元数据（不再直接同步 nodes/edges）', async () => {
    const onSaved = vi.fn();
    render(<SaveAsTemplateDialog projectId="p1" projectName="我的画布" onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByPlaceholderText('简要描述模板用途'), { target: { value: '描述' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveCanvas).toHaveBeenCalledWith('p1', {
      name: '我的画布', description: '描述', isPublic: false,
    }));
    expect(flushCanvasSync).toHaveBeenCalledWith('template');
    expect(onSaved).toHaveBeenCalled();
  });

  it('flush 失败：显示错误且不提交模板（防旧数据建模板）', async () => {
    vi.mocked(flushCanvasSync).mockResolvedValue(false);
    const onSaved = vi.fn();
    render(<SaveAsTemplateDialog projectId="p1" projectName="n" onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/画布保存失败/)).toBeInTheDocument();
    expect(saveCanvas).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).not.toHaveBeenCalled());
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
