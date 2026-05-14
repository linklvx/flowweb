import { describe, it, expect, vi } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock('./auth', () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

import { auth } from './auth';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  const guard = new AuthGuard();

  const PUBLIC_PATHS = [
    '/api/health',
    '/api/content/cards',
    '/api/node-types/image/models',
    '/api/auth/sign-in',
    '/api/auth/sign-up',
    '/api/announcements/active',
    '/api/pricing/calculate',
  ];

  PUBLIC_PATHS.forEach(path => {
    it(`should allow public path: ${path}`, async () => {
      const ctx = { switchToHttp: () => ({ getRequest: () => ({ path, headers: {} }) }) };
      await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
    });
  });

  it('should reject protected path without valid session', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ path: '/api/execution/execute', headers: {} }) }) };
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('Unauthorized');
  });

  it('should allow protected path with valid session', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1', email: 'test@test.com' } });
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ path: '/api/execution/execute', headers: { cookie: 'valid' } }) }) };
    await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
  });
});
