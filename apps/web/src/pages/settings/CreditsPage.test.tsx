import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import { CreditsPage } from './CreditsPage';

function wrapped(data: unknown) {
  return { ok: true, json: () => Promise.resolve({ code: 0, data }) };
}

function mockBalanceResponse(overrides = {}) {
  return wrapped({
    credits: 100,
    subscriptionCredits: 50,
    subscriptionCreditsExpiry: null,
    balance: 200.5,
    updatedAt: '2026-07-23T12:00:00.000Z',
    ...overrides,
  });
}

function mockCreateOrderResponse() {
  return wrapped({
    id: 'o1',
    orderNo: 'RC20260723USER123456',
    amount: 100,
    status: 'PENDING',
    createdAt: '2026-07-23T12:00:00.000Z',
  });
}

function mockPayResponse() {
  return wrapped({
    orderNo: 'RC20260723USER123456',
    amount: 100,
    balanceBefore: 200.5,
    balanceAfter: 300.5,
    status: 'SUCCESS',
    paidAt: '2026-07-23T12:00:01.000Z',
  });
}

function mockOrdersResponse() {
  return wrapped({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
}

describe('CreditsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display both credit balance and account balance', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBalanceResponse())
      .mockResolvedValueOnce(mockOrdersResponse());

    render(<CreditsPage />);

    await waitFor(() => {
      expect(screen.getByText(/200\.50/)).toBeDefined();
    });
    // verify credit card shows credits value
    expect(screen.getByText('积分余额')).toBeDefined();
    expect(screen.getByText('账户余额（元）')).toBeDefined();
  });

  it('should format balance to 2 decimal places', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBalanceResponse({ balance: 100 }))
      .mockResolvedValueOnce(mockOrdersResponse());

    render(<CreditsPage />);

    await waitFor(() => {
      expect(screen.getByText(/100\.00/)).toBeDefined();
    });
  });

  it('should fill input when preset button is clicked', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBalanceResponse())
      .mockResolvedValueOnce(mockOrdersResponse());

    render(<CreditsPage />);

    await waitFor(() => {
      expect(screen.getByText(/200\.50/)).toBeDefined();
    });

    const btn50 = screen.getByText('¥50');
    fireEvent.click(btn50);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).toBe('50');
    });
  });

  it('should disable recharge button when amount is invalid', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBalanceResponse())
      .mockResolvedValueOnce(mockOrdersResponse());

    render(<CreditsPage />);

    await waitFor(() => {
      expect(screen.getByText(/200\.50/)).toBeDefined();
    });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    const rechargeBtn = screen.getByText('立即充值');

    // Negative number
    fireEvent.change(input, { target: { value: '-10' } });
    await waitFor(() => {
      expect(rechargeBtn.closest('button')?.disabled).toBe(true);
    });

    // Empty
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => {
      expect(rechargeBtn.closest('button')?.disabled).toBe(true);
    });
  });

  it('should show loading state on recharge button during full flow', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBalanceResponse())
      .mockResolvedValueOnce(mockOrdersResponse())
      .mockResolvedValueOnce(mockCreateOrderResponse())
      .mockResolvedValueOnce(mockPayResponse());

    render(<CreditsPage />);

    await waitFor(() => {
      expect(screen.getByText(/200\.50/)).toBeDefined();
    });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '100' } });

    const rechargeBtn = screen.getByText('立即充值');
    fireEvent.click(rechargeBtn);

    // Button should be loading/disabled during the request
    await waitFor(() => {
      expect(rechargeBtn.closest('button')?.disabled).toBe(true);
    });
  });

  it('should optimistically update balance after successful payment', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBalanceResponse())
      .mockResolvedValueOnce(mockOrdersResponse())
      .mockResolvedValueOnce(mockCreateOrderResponse())
      .mockResolvedValueOnce(mockPayResponse());

    render(<CreditsPage />);

    await waitFor(() => {
      expect(screen.getByText(/200\.50/)).toBeDefined();
    });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '100' } });

    const rechargeBtn = screen.getByText('立即充值');
    fireEvent.click(rechargeBtn);

    // After payment success, optimistic update shows 300.50
    await screen.findByText(/300\.50/, {}, { timeout: 3000 });
  });

  it('should display recharge order history', async () => {
    mockFetch
      .mockResolvedValueOnce(mockBalanceResponse())
      .mockResolvedValueOnce(wrapped({
        items: [{
          id: 'o1', orderNo: 'RC001', amount: 100,
          balanceBefore: 200.5, balanceAfter: 300.5,
          status: 'SUCCESS', payChannel: 'mock',
          paidAt: '2026-07-23T12:00:01.000Z', createdAt: '2026-07-23T12:00:00.000Z',
        }],
        total: 1, page: 1, pageSize: 20,
      }));

    render(<CreditsPage />);

    await waitFor(() => {
      expect(screen.getByText(/200\.50/)).toBeDefined();
    });

    // Expand order history
    fireEvent.click(screen.getByText('充值记录'));

    await waitFor(() => {
      expect(screen.getByText('RC001')).toBeDefined();
      expect(screen.getByText('成功')).toBeDefined();
    });
  });
});
