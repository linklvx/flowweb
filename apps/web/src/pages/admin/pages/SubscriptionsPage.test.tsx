import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchAdminSubscriptions: vi.fn().mockResolvedValue({
    items: [{ id: 's1', userId: 'u1', planId: 'p1', plan: { name: '专业版' }, tier: 'pro', period: 'monthly',
      status: 'active', paidAmount: 2900, totalCredits: 300, consumedCredits: 10,
      subscribedAt: '2026-09-01T00:00:00.000Z', currentPeriodStart: '2026-09-01T00:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z', nextGrantDate: '2026-10-01T00:00:00.000Z' }],
    total: 21, page: 1, pageSize: 20,
  }),
  cancelAdminSubscription: vi.fn().mockResolvedValue({}),
}));

import SubscriptionsPage from './SubscriptionsPage';

describe('SubscriptionsPage', () => {
  it('列表渲染（真实字段：档位/周期/到期日）且请求带服务端分页参数', async () => {
    render(<MemoryRouter><AntdApp><SubscriptionsPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('专业版')).toBeTruthy());
    expect(screen.getByText('monthly')).toBeTruthy();
    const { fetchAdminSubscriptions } = await import('@/api/adminApi');
    expect(fetchAdminSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
  });
  it('active 状态行显示「作废」且确认后调用 cancelAdminSubscription', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><SubscriptionsPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('作废')).toBeTruthy());
    await user.click(screen.getByText('作废'));
    const okBtn = document.querySelector('.ant-popover .ant-btn-primary') as HTMLElement;
    await user.click(okBtn);
    const { cancelAdminSubscription } = await import('@/api/adminApi');
    await waitFor(() => expect(cancelAdminSubscription).toHaveBeenCalledWith('s1'));
  });
});
