import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { mockGetBalance, mockGetDefaultTeam, mockCreateTeamOrder, mockPayTeamOrder, mockListTeamOrders } = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
  mockGetDefaultTeam: vi.fn(),
  mockCreateTeamOrder: vi.fn(),
  mockPayTeamOrder: vi.fn(),
  mockListTeamOrders: vi.fn(),
}));

vi.mock('@/api/subscriptionApi', () => ({
  subscriptionApi: {
    getBalance: (...args: unknown[]) => mockGetBalance(...args),
  },
}));

vi.mock('@/api/teamApi', () => ({
  getDefaultTeam: (...args: unknown[]) => mockGetDefaultTeam(...args),
  createTeamRechargeOrder: (...args: unknown[]) => mockCreateTeamOrder(...args),
  payTeamOrder: (...args: unknown[]) => mockPayTeamOrder(...args),
  listTeamRechargeOrders: (...args: unknown[]) => mockListTeamOrders(...args),
}));

vi.mock('@/components/WeChatQRModal', () => ({
  WeChatQRModal: ({ visible, onCancel }: { visible: boolean; onCancel?: () => void }) =>
    visible ? <div data-testid="wechat-qr-modal" onClick={onCancel} /> : null,
}));

import { CreditsPage } from './CreditsPage';

beforeEach(() => {
  vi.clearAllMocks();
  // 新返回结构（Task 13）：无 balance 字段；credits 取非档位撞值数字
  mockGetBalance.mockResolvedValue({
    credits: 12345,
    subscriptionCredits: 50,
    total: 12395,
    subscriptionCreditsExpiry: null,
    updatedAt: '2026-07-23T12:00:00.000Z',
  });
  mockGetDefaultTeam.mockResolvedValue({ id: 'team-1', name: '默认团队', isDefault: true });
  mockListTeamOrders.mockResolvedValue({ items: [], total: 0 });
});

describe('CreditsPage（积分展示 + 团队充值）', () => {
  it('显示积分余额与充值档位', async () => {
    render(<MemoryRouter><CreditsPage /></MemoryRouter>);
    expect(await screen.findByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('积分余额')).toBeInTheDocument();
    expect(screen.getByText(/归属默认团队/)).toBeInTheDocument();
  });

  it('充值走默认团队下单链路（createTeamRechargeOrder + payTeamOrder）', async () => {
    mockCreateTeamOrder.mockResolvedValue({ outTradeNo: 'TEAM1' });
    mockPayTeamOrder.mockResolvedValue({ orderNo: 'TEAM1', amount: 1000, status: 'PENDING', codeUrl: 'weixin://x' });

    render(<MemoryRouter><CreditsPage /></MemoryRouter>);
    const payButton = await screen.findByRole('button', { name: /微信支付 ¥10/ });
    fireEvent.click(payButton);

    await waitFor(() => expect(mockCreateTeamOrder).toHaveBeenCalledWith('team-1', 10));
    await waitFor(() => expect(mockPayTeamOrder).toHaveBeenCalledWith('team-1', 'TEAM1'));
    await waitFor(() => expect(screen.getByTestId('wechat-qr-modal')).toBeInTheDocument());
  });

  it('取消二维码弹窗后刷新余额与充值记录（对齐 TeamPage）', async () => {
    mockCreateTeamOrder.mockResolvedValue({ outTradeNo: 'TEAM1' });
    mockPayTeamOrder.mockResolvedValue({ orderNo: 'TEAM1', amount: 1000, status: 'PENDING', codeUrl: 'weixin://x' });

    render(<MemoryRouter><CreditsPage /></MemoryRouter>);
    const payButton = await screen.findByRole('button', { name: /微信支付 ¥10/ });
    fireEvent.click(payButton);
    await waitFor(() => expect(screen.getByTestId('wechat-qr-modal')).toBeInTheDocument());

    const balanceCalls = mockGetBalance.mock.calls.length;
    const ordersCalls = mockListTeamOrders.mock.calls.length;
    fireEvent.click(screen.getByTestId('wechat-qr-modal'));
    await waitFor(() => expect(mockGetBalance.mock.calls.length).toBeGreaterThan(balanceCalls));
    await waitFor(() => expect(mockListTeamOrders.mock.calls.length).toBeGreaterThan(ordersCalls));
  });
});
