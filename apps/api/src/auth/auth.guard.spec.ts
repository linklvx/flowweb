import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthGuard } from './auth.guard';

function ctxFor(path: string, headers: Record<string, string> = {}) {
  const req = { path, headers };
  return { ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any, req };
}

describe('AuthGuard（批3-3：SessionService.touch 注入 + DB 异常不吞 401 + 单例 Prisma）', () => {
  let touch: ReturnType<typeof vi.fn>;
  let guard: AuthGuard;

  beforeEach(() => {
    touch = vi.fn();
    guard = new AuthGuard({ touch } as any);
  });

  const PUBLIC_PATHS = [
    '/api/health',
    '/api/content/cards',
    '/api/node-types/image/models',
    '/api/auth/sign-in',
    '/api/auth/sign-up',
    '/api/announcements/active',
    '/api/pricing/calculate',
    '/metrics',
    '/api/ready',   // Y0a-3：就绪探针（PUBLIC+@SkipThrottle）
    '/api/drain',   // Y0a-3：部署链停写入口（PUBLIC 放行 AuthGuard，CollabAdminAuthGuard 把关）
  ];

  PUBLIC_PATHS.forEach(path => {
    it(`should allow public path: ${path}`, async () => {
      const { ctx } = ctxFor(path);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(touch).not.toHaveBeenCalled();   // 无 cookie 零查询
    });
  });

  it('should reject protected path without cookie', async () => {
    const { ctx } = ctxFor('/api/execution/execute');
    await expect(guard.canActivate(ctx)).rejects.toThrow('Unauthorized');
  });

  it('should reject protected path with invalid session token（touch → null）', async () => {
    touch.mockResolvedValue(null);
    const { ctx } = ctxFor('/api/execution/execute', { cookie: 'flowweb.session_token=badtoken' });
    await expect(guard.canActivate(ctx)).rejects.toThrow('Unauthorized');
    expect(touch).toHaveBeenCalledWith('badtoken');
  });

  it('should allow protected path with valid session token + populate req.user', async () => {
    const user = { id: 'u1', email: 'test@test.com' };
    touch.mockResolvedValue({ user, expiresAt: new Date(Date.now() + 86400000) });
    const { ctx, req } = ctxFor('/api/execution/execute', { cookie: 'flowweb.session_token=validtoken' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req as any).user).toEqual(user);
  });

  it('should populate req.user on public path when valid session cookie exists', async () => {
    const user = { id: 'u1' };
    touch.mockResolvedValue({ user, expiresAt: new Date(Date.now() + 86400000) });
    const { ctx, req } = ctxFor('/api/subscription/me', { cookie: 'flowweb.session_token=validtoken' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req as any).user).toEqual(user);
  });

  it('批3-3：protected 路径 DB 异常 → 503 语义（现状吞成 401 的修正——DB 抖动不是"请登录"）', async () => {
    touch.mockRejectedValue(new Error('connection terminated'));
    const { ctx } = ctxFor('/api/execution/execute', { cookie: 'flowweb.session_token=validtoken' });
    const err: any = await guard.canActivate(ctx).catch((e) => e);
    expect(err.getStatus()).toBe(503);
  });

  it('批3-3：public 路径 DB 异常 → 仍放行（公共路径可用性不受 DB 抖动影响）', async () => {
    touch.mockRejectedValue(new Error('connection terminated'));
    const { ctx, req } = ctxFor('/api/content/cards', { cookie: 'flowweb.session_token=validtoken' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req as any).user).toBeUndefined();
  });

  it('/api/video-works 前缀公开放行', async () => {
    const { ctx } = ctxFor('/api/video-works');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('批3-3 单例 Prisma 取证修正：guard 源码不再 per-request new PrismaClient（session 查询走注入的 SessionService）', () => {
    const src = readFileSync(resolve(__dirname, 'auth.guard.ts'), 'utf8');
    expect(src).not.toContain('new PrismaClient');
    expect(src).not.toContain(`import('@prisma/client')`);
  });
});
