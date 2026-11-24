import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthController } from './auth.controller';

// Task 5（Y5 local-first）：/me 有效 session 增 sessionExpiresAt/serverNow（毫秒，服务端钟）；
// 无 session 恒 {user:null} 且两字段均不在场（客户端 Task 6 消费——缺省即视为无截止时间）。
describe('AuthController.getMe session TTL fields', () => {
  let controller: AuthController;
  let mockSvc: Record<string, any>;
  let mockPrisma: Record<string, any>;

  beforeEach(() => {
    mockSvc = {
      getSession: vi.fn(),
    };

    // getMe 补偿走 bootstrapPersonalTeam：首查命中即 no-op（同 auth.controller.spec 形态）
    mockPrisma = {
      team: { findFirst: vi.fn().mockResolvedValue({ id: 't-default', isDefault: true }) },
      materialFolder: { createMany: vi.fn() },
    } as any;

    controller = new AuthController(
      mockSvc as any,
      mockPrisma as any,
      { ledgerTx: async (raw: any) => raw, ensureBalance: vi.fn(), lockBalance: vi.fn(), mutate: vi.fn() } as any,
      { checkIpRateLimit: vi.fn(), checkPhoneRateLimit: vi.fn(), releasePhoneLock: vi.fn() } as any,
      { generateOtp: vi.fn(), storeOtp: vi.fn(), sendSms: vi.fn(), deleteOtp: vi.fn() } as any,
      { get: vi.fn(), del: vi.fn() } as any,
    );
  });

  it('有效 session → 响应含 sessionExpiresAt/serverNow 毫秒整数，sessionExpiresAt > serverNow', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const user = { id: 'u1', email: 'u1@test.com' };
    mockSvc.getSession.mockResolvedValue({ user, expiresAt });

    const req = { headers: { cookie: 'flowweb.session_token=valid' } };
    const mockRes = { cookie: vi.fn(), json: vi.fn() };

    await controller.getMe(req as any, mockRes as any);

    const body = mockRes.json.mock.calls[0][0];
    expect(body.user).toEqual(user);
    expect(Number.isInteger(body.sessionExpiresAt)).toBe(true);
    expect(Number.isInteger(body.serverNow)).toBe(true);
    expect(body.sessionExpiresAt).toBe(expiresAt.getTime());
    expect(body.sessionExpiresAt).toBeGreaterThan(body.serverNow);
  });

  it('无 session → 响应恒为 {user:null}，两字段均不在场', async () => {
    mockSvc.getSession.mockResolvedValue(null);

    const req = { headers: {} };
    const mockRes = { cookie: vi.fn(), json: vi.fn() };

    await controller.getMe(req as any, mockRes as any);

    const body = mockRes.json.mock.calls[0][0];
    expect(body).toEqual({ user: null });
    expect(body).not.toHaveProperty('sessionExpiresAt');
    expect(body).not.toHaveProperty('serverNow');
  });
});
