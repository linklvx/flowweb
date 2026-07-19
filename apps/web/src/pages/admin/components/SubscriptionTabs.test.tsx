import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlanManagementTab } from './SubscriptionTabs';

const mockPlans = [
  { id: 'plan1', name: '基础版', tier: 'basic', monthlyCredits: 100, priceMonthly: 50, firstPriceMonthly: 30, priceQuarterly: 135, firstPriceQuarterly: 90, priceAnnually: 480, firstPriceAnnually: 399, sort: 1, isActive: true },
  { id: 'plan2', name: '专业版', tier: 'pro', monthlyCredits: 500, priceMonthly: 200, firstPriceMonthly: 150, priceQuarterly: 540, firstPriceQuarterly: 400, priceAnnually: 1920, firstPriceAnnually: 1500, sort: 2, isActive: true },
];

describe('PlanManagementTab - inline editing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(data: any) {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ code: 0, data }),
    } as Response);
  }

  it('renders plans table', async () => {
    mockFetch(mockPlans);
    render(<PlanManagementTab />);
    await waitFor(() => {
      expect(screen.getByText('基础版')).toBeInTheDocument();
      expect(screen.getByText('专业版')).toBeInTheDocument();
    });
  });

  it('renders first price columns', async () => {
    mockFetch(mockPlans);
    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
    expect(screen.getByText('399')).toBeInTheDocument();
  });

  it('enters edit mode on cell click for name', async () => {
    mockFetch(mockPlans);
    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());

    fireEvent.click(screen.getByText('基础版'));
    const input = screen.getByDisplayValue('基础版') as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it('enters edit mode on cell click for number fields', async () => {
    mockFetch(mockPlans);
    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());

    fireEvent.click(screen.getByText('500'));
    const input = screen.getByDisplayValue('500');
    expect(input).toBeInTheDocument();
  });

  it('enters edit mode on first price cell click', async () => {
    mockFetch(mockPlans);
    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());

    fireEvent.click(screen.getByText('30'));
    const input = screen.getByDisplayValue('30');
    expect(input).toBeInTheDocument();
  });

  it('saves on blur and calls PATCH API', async () => {
    mockFetch(mockPlans);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();

    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());

    fireEvent.click(screen.getByText('基础版'));
    const input = screen.getByDisplayValue('基础版') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '新名称' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/subscription/plans/plan1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: '新名称' }),
        }),
      );
    });
  });

  it('saves first price field via PATCH API', async () => {
    mockFetch(mockPlans);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();

    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());

    fireEvent.click(screen.getByText('399'));
    const input = screen.getByDisplayValue('399');
    fireEvent.blur(input);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/subscription/plans/plan1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ firstPriceAnnually: 399 }),
        }),
      );
    });
  });

  it('cancels editing on Escape key', async () => {
    mockFetch(mockPlans);
    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());

    fireEvent.click(screen.getByText('基础版'));
    expect(screen.getByDisplayValue('基础版')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByDisplayValue('基础版'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByDisplayValue('基础版')).not.toBeInTheDocument();
    });
  });

  it('saves on Enter key for text field', async () => {
    mockFetch(mockPlans);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();

    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());

    fireEvent.click(screen.getByText('基础版'));
    const input = screen.getByDisplayValue('基础版') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '改名' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/subscription/plans/plan1'),
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: '改名' }) }),
      );
    });
  });
});
