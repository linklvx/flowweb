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
  // Express 路由大小写不敏感，大写变体必须照拦（C1 回归）
  it('大小写变体绕过防护：/API/admin/models USER → 403', async () => {
    await expect(guard.canActivate(ctx('/API/admin/models', { role: 'USER' }))).rejects.toThrow('需要管理员权限');
  });
  it('大小写变体绕过防护：/Api/Admin 未登录 → 401', async () => {
    await expect(guard.canActivate(ctx('/Api/Admin', undefined))).rejects.toThrow(UnauthorizedException);
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
