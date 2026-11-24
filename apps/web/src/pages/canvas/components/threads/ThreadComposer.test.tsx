// ThreadComposer.test.tsx（Y4b T11 M-2——提交契约两档；空 body 拒绝归 createThread→checkThreadComment）
// Y5 T8 评审 I：提交面随 canEdit 闸——只读态禁用提交（禁静默丢）+ store 仍返 false 时短提示。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { message } from 'antd';

import { ThreadComposer, type ThreadCreateInput } from './ThreadComposer';
import { useCanvasStore } from '@/stores/canvasStore';

const input: ThreadCreateInput = { nodeId: 'n1', kind: 'node', body: '' };

describe('ThreadComposer（Y4b T11 M-2 提交契约）', () => {
  beforeEach(() => {
    useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('正文 hello → onSubmit 收到原 input+body，成功即 onClose', () => {
    const onSubmit = vi.fn(() => true);
    const onClose = vi.fn();
    render(<ThreadComposer input={input} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('输入批注内容…'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }));
    expect(onSubmit).toHaveBeenCalledWith({ ...input, body: 'hello' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('onSubmit 返回 false → 不调用 onClose（窗口仍在）+ 短提示（禁静默丢）', () => {
    const warnSpy = vi.spyOn(message, 'warning').mockImplementation(() => ({} as never));
    const onSubmit = vi.fn(() => false);
    const onClose = vi.fn();
    render(<ThreadComposer input={input} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('输入批注内容…'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }));
    expect(onSubmit).toHaveBeenCalledWith({ ...input, body: 'hello' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('输入批注内容…')).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('Y5 T8：collabReadOnly=true ⇒ 提交按钮禁用、点击零写入（禁静默丢）', () => {
    useCanvasStore.setState({ collabReadOnly: true });
    const onSubmit = vi.fn(() => true);
    const onClose = vi.fn();
    render(<ThreadComposer input={input} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('输入批注内容…'), { target: { value: 'hello' } });
    const submit = screen.getByRole('button', { name: /提\s*交/ });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
