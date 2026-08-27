import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { mockGetBalance, mockGetOrders, mockCreateOrder, mockPayOrder } = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
  mockGetOrders: vi.fn(),
  mockCreateOrder: vi.fn(),
  mockPayOrder: vi.fn(),
}));

vi.mock('@/api/subscriptionApi', () => ({
  subscriptionApi: {
    getBalance: (...args: unknown[]) => mockGetBalance(...args),
    getRechargeOrders: (...args: unknown[]) => mockGetOrders(...args),
    createRechargeOrder: (...args: unknown[]) => mockCreateOrder(...args),
    payRechargeOrder: (...args: unknown[]) => mockPayOrder(...args),
  },
}));

vi.mock('@/components/WeChatQRModal', () => ({
  WeChatQRModal: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="wechat-qr-modal" /> : null,
}));

import { CreditsPage } from './CreditsPage';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBalance.mockResolvedValue({
    credits: 100,
    subscriptionCredits: 50,
    subscriptionCreditsExpiry: null,
    updatedAt: '2026-07-23T12:00:00.000Z',
    balance: 200.5,
  });
  mockGetOrders.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
});

describe('CreditsPage（S5：充值入口下线）', () => {
  it('显示积分余额并引导团队充值', async () => {
    render(<MemoryRouter><CreditsPage /></MemoryRouter>);
    expect(await screen.findByText('100')).toBeInTheDocument();
    expect(screen.getByText('积分余额')).toBeInTheDocument();
    expect(screen.getByText(/团队管理/)).toBeInTheDocument();
  });
});
