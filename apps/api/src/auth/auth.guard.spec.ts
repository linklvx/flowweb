import { describe, it, expect, vi } from 'vitest';

const mockFindUnique = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    session: { findUnique: mockFindUnique },
    $disconnect: mockDisconnect,
  })),
}));

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
    '/metrics',
  ];

  PUBLIC_PATHS.forEach(path => {
    it(`should allow public path: ${path}`, async () => {
      const ctx = { switchToHttp: () => ({ getRequest: () => ({ path, headers: {} }) }) };
      await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
    });
  });

  it('should reject protected path without cookie', async () => {
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ path: '/api/execution/execute', headers: {} }) }) };
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('Unauthorized');
  });

  it('should reject protected path with invalid session token', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockDisconnect.mockResolvedValue(undefined);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ path: '/api/execution/execute', headers: { cookie: 'flowweb.session_token=badtoken' } }) }) };
    await expect(guard.canActivate(ctx as any)).rejects.toThrow('Unauthorized');
  });

  it('should allow protected path with valid session token', async () => {
    const user = { id: 'u1', email: 'test@test.com' };
    mockFindUnique.mockResolvedValue({ user, expiresAt: new Date(Date.now() + 86400000) });
    mockDisconnect.mockResolvedValue(undefined);
    const req = { path: '/api/execution/execute', headers: { cookie: 'flowweb.session_token=validtoken' } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) };
    await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
    expect((req as any).user).toEqual(user);
  });

  it('should populate req.user on public subscription path when valid session cookie exists', async () => {
    const user = { id: 'u1', email: 'test@test.com' };
    mockFindUnique.mockResolvedValue({ user, expiresAt: new Date(Date.now() + 86400000) });
    mockDisconnect.mockResolvedValue(undefined);
    const req = { path: '/api/subscription/me', headers: { cookie: 'flowweb.session_token=validtoken' } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) };
    await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
    expect((req as any).user).toEqual(user);
  });

  it('should not throw on public subscription path without session cookie', async () => {
    const req = { path: '/api/subscription/me', headers: {} };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) };
    await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
    expect((req as any).user).toBeUndefined();
  });
});
