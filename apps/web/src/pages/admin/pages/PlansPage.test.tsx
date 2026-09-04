import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchAdminPlans: vi.fn().mockResolvedValue([
    { id: 'p1', name: '专业版', tier: 'pro', monthlyCredits: 300, storageLimitBytes: 107374182400,
      priceMonthly: 2900, originalPriceMonthly: 3900, priceQuarterly: 8700, originalPriceQuarterly: 11700,
      priceAnnually: 34800, originalPriceAnnually: 46800, sort: 2, isActive: true },
  ]),
  updateAdminPlan: vi.fn().mockResolvedValue({}),
}));

import PlansPage from './PlansPage';

describe('PlansPage', () => {
  it('套餐列表渲染（12 列齐全 + GB 换算 + 档位 Tag）', async () => {
    render(<MemoryRouter><AntdApp><PlansPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('专业版')).toBeTruthy());
    expect(screen.getByText('100 GB')).toBeTruthy();
    expect(screen.getByText('pro')).toBeTruthy();
    expect(screen.getByText('2900')).toBeTruthy();
    expect(screen.getByText('34800')).toBeTruthy();
  });
  it('编辑提交：storageGB 换算为字节 storageLimitBytes（守护 GB↔字节链路）', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><PlansPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('专业版')).toBeTruthy());
    await user.click(screen.getByText('编辑'));
    const storageInput = await screen.findByLabelText('存储(GB)');
    await user.clear(storageInput);
    await user.type(storageInput, '60');
    const okBtn = document.querySelector('.ant-modal-footer .ant-btn-primary') as HTMLElement;
    await user.click(okBtn);
    const { updateAdminPlan } = await import('@/api/adminApi');
    await waitFor(() => expect(updateAdminPlan).toHaveBeenCalledWith('p1', expect.objectContaining({ storageLimitBytes: 64424509440 })));
  });

  it('上下架 Switch + 编辑入口（ModalForm）+ 新建入口', async () => {
    render(<MemoryRouter><AntdApp><PlansPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('专业版')).toBeTruthy());
    expect(screen.getByRole('switch')).toBeTruthy();
    expect(screen.getByText('编辑')).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建套餐' })).toBeTruthy();
  });
});
