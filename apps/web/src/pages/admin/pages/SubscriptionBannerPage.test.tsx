import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/subscriptionApi', () => ({
  // subscriptionApi 是对象导出，mock 形状必须一致
  subscriptionApi: {
    getAdminBanner: vi.fn().mockResolvedValue({
      id: 'b1', title: '限时特惠', subtitle: '开通立减',
      backgroundImageKey: 'k1', backgroundImageUrl: null,
      countdownEndAt: null, autoExtend: false, isActive: true, createdAt: '', updatedAt: '',
    }),
    updateBanner: vi.fn().mockResolvedValue({}),
    uploadBannerImage: vi.fn(),
  },
}));

import SubscriptionBannerPage from './SubscriptionBannerPage';

describe('SubscriptionBannerPage（单资源配置，复用 subscriptionApi）', () => {
  it('加载并回填现有配置（title/isActive）', async () => {
    render(<MemoryRouter><AntdApp><SubscriptionBannerPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByDisplayValue('限时特惠')).toBeTruthy());
    // 页面有两个开关（autoExtend + isActive），getByRole 会因多匹配抛错
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('上传成功后清空 URL 输入（互斥：key 优先会静默吞 URL）', async () => {
    const { subscriptionApi } = await import('@/api/subscriptionApi');
    (subscriptionApi.uploadBannerImage as ReturnType<typeof vi.fn>).mockResolvedValue({ imageKey: 'k-new' });
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><SubscriptionBannerPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByDisplayValue('限时特惠')).toBeTruthy());
    const urlInput = screen.getByLabelText(/背景图 URL/);
    await user.type(urlInput, 'https://img/x.png');
    // user-event v14 只拦截 pointer-events:none，不查 display——直接对隐藏 input 上传（内部赋 files + 派发 change）
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await user.upload(input, file);
    await waitFor(() => expect(subscriptionApi.uploadBannerImage).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByLabelText(/背景图 URL/) as HTMLInputElement).value).toBe(''));
  });
});
