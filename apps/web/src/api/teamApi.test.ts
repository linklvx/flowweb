import { describe, it, expect, vi } from 'vitest';
import { teamDisplayName } from './teamApi';

describe('teamDisplayName', () => {
  it('默认团队显示「个人项目」', () => {
    expect(teamDisplayName({ isDefault: true, name: 'Alice的团队' })).toBe('个人项目');
  });
  it('普通团队显示原名', () => {
    expect(teamDisplayName({ isDefault: false, name: '梦幻团队' })).toBe('梦幻团队');
  });
});

describe('listTeamRechargeOrders kind 参数', () => {
  it('不传 kind 返回全部订单（billing 页用），传 kind 则过滤', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { items: [], total: 0 } }) });
    const { listTeamRechargeOrders } = await import('./teamApi');
    await listTeamRechargeOrders('t-1');
    expect((global.fetch as any).mock.calls[0][0]).toBe('/api/team/t-1/recharge/orders?page=1&pageSize=20');
    await listTeamRechargeOrders('t-1', 2, 10, 'credits');
    expect((global.fetch as any).mock.calls[1][0]).toBe('/api/team/t-1/recharge/orders?kind=credits&page=2&pageSize=10');
    await listTeamRechargeOrders('t-1', 1, 20, 'subscription');
    expect((global.fetch as any).mock.calls[2][0]).toBe('/api/team/t-1/recharge/orders?kind=subscription&page=1&pageSize=20');
  });
});
