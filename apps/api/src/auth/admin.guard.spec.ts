import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

const ctx = (path: string | undefined, user: any, type = 'http') => ({
  getType: () => type,
  switchToHttp: () => ({ getRequest: () => ({ path, user }) }),
}) as any;

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('非 HTTP 上下文（ws gateway）直接放行', async () => {
    await expect(guard.canActivate(ctx(undefined, undefined, 'ws'))).resolves.toBe(true);
  });
  it('非 admin 前缀放行（/api/team/plans）', async () => {
    await expect(guard.canActivate(ctx('/api/team/plans', { role: 'USER' }))).resolves.toBe(true);
  });
  it('前缀边界：/api/adminx 不拦', async () => {
    await expect(guard.canActivate(ctx('/api/adminx', { role: 'USER' }))).resolves.toBe(true);
  });
  it('/api/admin 无尾斜杠精确命中：未登录 401', async () => {
    await expect(guard.canActivate(ctx('/api/admin', undefined))).rejects.toThrow(UnauthorizedException);
  });
  it('USER 访问 admin 路径 403 中文 message', async () => {
    await expect(guard.canActivate(ctx('/api/admin/models', { role: 'USER' }))).rejects.toThrow('需要管理员权限');
  });
  it('ADMIN 放行', async () => {
    await expect(guard.canActivate(ctx('/api/admin/models', { role: 'ADMIN' }))).resolves.toBe(true);
  });
});
