import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const api = vi.hoisted(() => ({
  getMyTeams: vi.fn(),
  getTeamBalanceView: vi.fn(),
  listTeamPlans: vi.fn(),
  listTeamRechargeOrders: vi.fn(),
  createTeamRechargeOrder: vi.fn(),
  payTeamOrder: vi.fn(),
  createSubscriptionOrder: vi.fn(),
}));
vi.mock('@/api/teamApi', () => ({
  ...api,
  teamDisplayName: (t: { isDefault: boolean; name: string }) => (t.isDefault ? '个人项目' : t.name),
}));
vi.mock('@/components/WeChatQRModal', () => ({
  WeChatQRModal: ({ visible }: { visible: boolean }) => (visible ? <div data-testid="wechat-qr-modal" /> : null),
}));

import TeamBillingPage from './TeamBillingPage';

const teamFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 't-1', name: '梦幻团队', role: 'OWNER', status: 'ACTIVE',
  isDefault: false, isOwner: true, createdAt: '2026-08-01', memberCount: 3, projectCount: 0,
  balance: { credits: 100, subscriptionCredits: 50 },
  subscription: { planName: '团队月卡', status: 'active', currentPeriodEnd: '2026-09-30' },
  ...overrides,
});

function renderBilling(id = 't-1') {
  return render(
    <MemoryRouter initialEntries={[`/team/${id}/billing`]}>
      <Routes><Route path="/team/:id/billing" element={<TeamBillingPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('TeamBillingPage', () => {
  beforeEach(() => {
    api.getMyTeams.mockResolvedValue([teamFixture()]);
    api.getTeamBalanceView.mockResolvedValue({ credits: 100, subscriptionCredits: 50, total: 150, quota: 0, used: 0 });
    api.listTeamPlans.mockResolvedValue([{ id: 'plan1', name: '团队月卡', priceMonthly: 3000, monthlyCredits: 300, seatLimit: 5, isActive: true }]);
    api.listTeamRechargeOrders.mockResolvedValue({ items: [], total: 0 });
  });

  it('非成员/团队不存在时提示无权', async () => {
    api.getMyTeams.mockResolvedValue([]);
    renderBilling('t-other');
    expect(await screen.findByText(/无权访问/)).toBeInTheDocument();
  });

  it('默认团队 billing 重定向 /settings/credits', async () => {
    api.getMyTeams.mockResolvedValue([teamFixture({ id: 't-default', isDefault: true })]);
    render(
      <MemoryRouter initialEntries={['/team/t-default/billing']}>
        <Routes>
          <Route path="/team/:id/billing" element={<TeamBillingPage />} />
          <Route path="/settings/credits" element={<div data-testid="credits-page-marker" />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('credits-page-marker')).toBeInTheDocument());
  });

  it('渲染团队名/余额/充值档位/套餐/订单记录', async () => {
    renderBilling();
    expect(await screen.findByText(/梦幻团队/)).toBeInTheDocument();
    // 余额来自 refresh 第二轮异步 commit，与团队名（teams state）不同链，必须 waitFor 防竞态
    await waitFor(() => expect(screen.getByTestId('billing-balance-total')).toHaveTextContent('150'));
    // 锚定 ^¥10 避免与 ¥100 档位产生 multiple matches
    expect(screen.getByRole('button', { name: /^¥10 / })).toBeInTheDocument();
    expect(await screen.findByText('团队月卡')).toBeInTheDocument();
  });

  it('充值下单走团队链路：createTeamRechargeOrder + payTeamOrder', async () => {
    api.createTeamRechargeOrder.mockResolvedValue({ outTradeNo: 'TEAM1' });
    api.payTeamOrder.mockResolvedValue({ orderNo: 'TEAM1', amount: 1000, status: 'PENDING', codeUrl: 'wx://qr' });
    renderBilling();
    // 计划原文 /¥10/ 会同时命中 ¥10/¥100 档位与下单按钮（multiple elements）；
    // 实现为「选档 → 微信支付下单」两步，此处点击下单按钮（默认选中 10 元）
    fireEvent.click(await screen.findByRole('button', { name: /^微信支付 ¥10$/ }));
    await waitFor(() => expect(api.createTeamRechargeOrder).toHaveBeenCalledWith('t-1', 10));
    await waitFor(() => expect(api.payTeamOrder).toHaveBeenCalledWith('t-1', 'TEAM1'));
    await waitFor(() => expect(screen.getByTestId('wechat-qr-modal')).toBeInTheDocument());
  });

  it('订阅下单走 createSubscriptionOrder + payTeamOrder', async () => {
    api.createSubscriptionOrder.mockResolvedValue({ outTradeNo: 'TEAM2' });
    api.payTeamOrder.mockResolvedValue({ orderNo: 'TEAM2', amount: 3000, status: 'PENDING', codeUrl: 'wx://qr2' });
    renderBilling();
    fireEvent.click(await screen.findByRole('button', { name: /开通团队订阅/ }));
    await waitFor(() => expect(api.createSubscriptionOrder).toHaveBeenCalledWith('t-1', 'plan1'));
    await waitFor(() => expect(api.payTeamOrder).toHaveBeenCalledWith('t-1', 'TEAM2'));
    await waitFor(() => expect(screen.getByTestId('wechat-qr-modal')).toBeInTheDocument());
  });
});
