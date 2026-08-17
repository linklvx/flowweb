import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WeChatQRLogin } from './WeChatQRLogin';

describe('WeChatQRLogin', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    (window as any).WxLogin = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).WxLogin;
  });

  it('挂载后调 config 接口并初始化 WxLogin', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ appid: 'wx123' }),
    });

    render(<WeChatQRLogin />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/wechat/config');
    });
    await waitFor(() => {
      expect((window as any).WxLogin).toHaveBeenCalledWith(
        expect.objectContaining({
          self_redirect: false,
          appid: 'wx123',
          scope: 'snsapi_login',
        }),
      );
    });
  });

  it('config 失败 → 显示降级占位', async () => {
    (global.fetch as any).mockRejectedValue(new Error('network error'));

    render(<WeChatQRLogin />);

    await waitFor(() => {
      expect(screen.getByText(/微信登录暂时不可用/)).toBeInTheDocument();
    });
    expect(screen.getByText('邮箱登录')).toBeInTheDocument();
  });

  it('点击邮箱登录触发 onAlternativeLogin', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ appid: 'wx123' }),
    });
    const onAlternativeLogin = vi.fn();

    render(<WeChatQRLogin onAlternativeLogin={onAlternativeLogin} />);
    await waitFor(() => {
      expect(screen.getByText('邮箱登录')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('邮箱登录'));
    expect(onAlternativeLogin).toHaveBeenCalledTimes(1);
  });
});
