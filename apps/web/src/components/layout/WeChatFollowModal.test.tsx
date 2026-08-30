import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeChatFollowModal } from './WeChatFollowModal';

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return { ...actual, Modal: (p: { open: boolean; children: React.ReactNode }) => (p.open ? <div data-testid="modal-root">{p.children}</div> : null) };
});

describe('WeChatFollowModal', () => {
  it('open 时渲染标题、二维码与引导文案', () => {
    render(<WeChatFollowModal open onClose={vi.fn()} />);
    expect(screen.getByText('关注公众号')).toBeInTheDocument();
    expect(screen.getByAltText('公众号二维码')).toHaveAttribute('src', '/img/wechat-qrcode.jpg');
    expect(screen.getByText('扫码关注公众号，获取最新动态和专属福利')).toBeInTheDocument();
  });

  it('open=false 不渲染', () => {
    render(<WeChatFollowModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('modal-root')).toBeNull();
  });
});
