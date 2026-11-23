// ThreadComposer.test.tsx（Y4b T11 M-2——提交契约两档；空 body 拒绝归 createThread→checkThreadComment）
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ThreadComposer, type ThreadCreateInput } from './ThreadComposer';

const input: ThreadCreateInput = { nodeId: 'n1', kind: 'node', body: '' };

describe('ThreadComposer（Y4b T11 M-2 提交契约）', () => {
  it('正文 hello → onSubmit 收到原 input+body，成功即 onClose', () => {
    const onSubmit = vi.fn(() => true);
    const onClose = vi.fn();
    render(<ThreadComposer input={input} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('输入批注内容…'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }));
    expect(onSubmit).toHaveBeenCalledWith({ ...input, body: 'hello' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('onSubmit 返回 false → 不调用 onClose（窗口仍在）', () => {
    const onSubmit = vi.fn(() => false);
    const onClose = vi.fn();
    render(<ThreadComposer input={input} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('输入批注内容…'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }));
    expect(onSubmit).toHaveBeenCalledWith({ ...input, body: 'hello' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('输入批注内容…')).toBeInTheDocument();
  });
});
