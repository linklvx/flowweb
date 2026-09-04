import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./client', () => ({ apiFetch: vi.fn().mockResolvedValue({}) }));
import { apiFetch } from './client';
import {
  fetchAdminPlans, createAdminPlan, updateAdminPlan,
  fetchAdminSubscriptions, updateAdminSubscription, grantCredits,
} from './adminApi';

afterEach(() => vi.clearAllMocks());

describe('admin subscription 封装（路径/方法/body）', () => {
  it('fetchAdminPlans → GET /admin/subscription/plans', async () => {
    await fetchAdminPlans();
    expect(apiFetch).toHaveBeenCalledWith('/admin/subscription/plans');
  });
  it('createAdminPlan → POST，updateAdminPlan → PATCH /:id', async () => {
    await createAdminPlan({ name: 'x' } as any);
    await updateAdminPlan('p1', { priceMonthly: 100 });
    expect(apiFetch).toHaveBeenCalledWith('/admin/subscription/plans', expect.objectContaining({ method: 'POST' }));
    expect(apiFetch).toHaveBeenCalledWith('/admin/subscription/plans/p1', expect.objectContaining({ method: 'PATCH' }));
  });
  it('fetchAdminSubscriptions → 服务端分页参数', async () => {
    await fetchAdminSubscriptions({ page: 2, pageSize: 20 });
    expect(apiFetch).toHaveBeenCalledWith('/admin/subscription/subscriptions?page=2&pageSize=20');
  });
  it('grantCredits → POST credits/grant', async () => {
    await grantCredits({ userId: 'u1', amount: 10, creditType: 'regular' });
    expect(apiFetch).toHaveBeenCalledWith('/admin/subscription/credits/grant', expect.objectContaining({ method: 'POST' }));
  });
});
