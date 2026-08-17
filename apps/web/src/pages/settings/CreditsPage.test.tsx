import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('CreditsPage', () => {
  it('should display credit balance and account balance', async () => {
    render(<CreditsPage />);

    expect(await screen.findByText('100')).toBeInTheDocument();
    expect(screen.getByText(/200\.50/)).toBeInTheDocument();
    expect(screen.getByText('积分余额')).toBeInTheDocument();
    expect(screen.getByText('账户余额（元）')).toBeInTheDocument();
  });

  it('should select preset amount and update recharge button', async () => {
    render(<CreditsPage />);
    await screen.findByText(/200\.50/);

    fireEvent.click(screen.getByText('¥50'));
    expect(screen.getByText('立即充值 ¥50')).toBeInTheDocument();
  });

  it('should create order, pay, and show QR modal on recharge', async () => {
    mockCreateOrder.mockResolvedValue({
      id: 'o1', orderNo: 'RC001', amount: 10, status: 'PENDING', createdAt: '2026-07-23T12:00:00.000Z',
    });
    mockPayOrder.mockResolvedValue({
      orderNo: 'RC001', amount: 10, status: 'SUCCESS', codeUrl: 'weixin://wxpay/RC001',
    });

    render(<CreditsPage />);
    await screen.findByText(/200\.50/);

    fireEvent.click(screen.getByText('立即充值 ¥10'));

    await waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledWith(10);
      expect(mockPayOrder).toHaveBeenCalledWith('RC001');
    });
    expect(await screen.findByTestId('wechat-qr-modal')).toBeInTheDocument();
  });

  it('should display recharge order history', async () => {
    mockGetOrders.mockResolvedValue({
      items: [{
        id: 'o1', orderNo: 'RC001', amount: 100,
        balanceBefore: 200.5, balanceAfter: 300.5,
        status: 'SUCCESS', payChannel: 'mock', prepayId: null, transactionId: null,
        paidAt: '2026-07-23T12:00:01.000Z', expiredAt: null, closedAt: null,
        createdAt: '2026-07-23T12:00:00.000Z',
      }],
      total: 1, page: 1, pageSize: 20,
    });

    render(<CreditsPage />);
    await screen.findByText(/200\.50/);

    fireEvent.click(screen.getByText('充值记录'));

    expect(await screen.findByText('RC001')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
  });
});
