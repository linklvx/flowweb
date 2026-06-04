import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FolderInputModal from './FolderInputModal';

describe('FolderInputModal', () => {
  it('should render with title', () => {
    render(
      <FolderInputModal
        open={true}
        title="新建文件夹"
        defaultValue=""
        onOk={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('新建文件夹')).toBeInTheDocument();
  });

  it('should call onOk with trimmed value on Enter', () => {
    const onOk = vi.fn();
    render(
      <FolderInputModal open={true} title="新建" defaultValue="" onOk={onOk} onCancel={vi.fn()} />,
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  我的文件夹  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOk).toHaveBeenCalledWith('我的文件夹');
  });

  it('should call onCancel on cancel button click', () => {
    const onCancel = vi.fn();
    render(
      <FolderInputModal open={true} title="新建" defaultValue="" onOk={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /取.*消/ }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('should disable ok button when value is only whitespace', () => {
    render(
      <FolderInputModal open={true} title="新建" defaultValue="" onOk={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    const okBtn = screen.getByRole('button', { name: /确.*定/ });
    expect(okBtn).toBeDisabled();
  });

  it('should autoFocus input on open', async () => {
    render(
      <FolderInputModal open={true} title="新建" defaultValue="" onOk={vi.fn()} onCancel={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveFocus();
    });
  });

  it('should reset value to defaultValue when reopened', () => {
    const { rerender } = render(
      <FolderInputModal open={true} title="重命名" defaultValue="旧名称" onOk={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('旧名称');

    fireEvent.change(input, { target: { value: '新名称' } });
    expect(input).toHaveValue('新名称');

    // Close and reopen with different defaultValue
    rerender(
      <FolderInputModal open={false} title="重命名" defaultValue="新默认" onOk={vi.fn()} onCancel={vi.fn()} />,
    );
    rerender(
      <FolderInputModal open={true} title="重命名" defaultValue="新默认" onOk={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('新默认');
  });
});
