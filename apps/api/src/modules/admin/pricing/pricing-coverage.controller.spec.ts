// Y0b-5 T14：GET /api/admin/pricing/coverage——admin 定价页红标数据源端点。路由 metadata smoke
// （Z14 同款——vitest_api_env_quirks：esbuild 不发射 design:paramtypes，断言走 decorator 运行时
// metadata）+AdminGuard 全局路径守卫承载断言（浏览器拿不到 prometheus token——红标必须走 admin 端点）
// +service 透传形状。
import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { PricingCoverageController } from './pricing-coverage.controller';
import { AdminGuard } from '../../../auth/admin.guard';

const ctx = (path: string | undefined, user: any) => ({
  getType: () => 'http',
  switchToHttp: () => ({ getRequest: () => ({ path, user }) }),
}) as any;

describe('PricingCoverageController（Y0b-5 T14——Y0b-1 移交收口）', () => {
  it('路由 smoke：@Controller("api/admin/pricing")+GET coverage（与 pricing-rules 控制器分立）', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PricingCoverageController)).toBe('api/admin/pricing');
    expect(Reflect.getMetadata(PATH_METADATA, PricingCoverageController.prototype.coverage)).toBe('coverage');
    expect(Reflect.getMetadata(METHOD_METADATA, PricingCoverageController.prototype.coverage)).toBe(RequestMethod.GET);
  });

  it('AdminGuard 全局路径守卫承载：/api/admin/pricing/coverage 非管理员 403/未登录 401/ADMIN 放行（无 per-controller guard——路径前缀即守卫契约）', async () => {
    const guard = new AdminGuard();
    await expect(guard.canActivate(ctx('/api/admin/pricing/coverage', { role: 'USER' }))).rejects.toThrow('需要管理员权限');
    await expect(guard.canActivate(ctx('/api/admin/pricing/coverage', undefined))).rejects.toThrow();
    await expect(guard.canActivate(ctx('/api/admin/pricing/coverage', { role: 'ADMIN' }))).resolves.toBe(true);
  });

  it('透传 service.coverage()：{ok,missing} 形状（ready 布尔不因 coverage 翻——执域=admin 红标+preflight 脚本，本端点只读不 gating）', async () => {
    const svc = { coverage: vi.fn().mockResolvedValue({ ok: false, missing: [{ modelId: 'm1', name: 'GLM', problem: '缺 (model,null,null) active 基础规则——模型全灭' }] }) };
    const controller = new PricingCoverageController(svc as any);
    const r = await controller.coverage();
    expect(r).toEqual({ ok: false, missing: [{ modelId: 'm1', name: 'GLM', problem: expect.any(String) }] });
    expect(svc.coverage).toHaveBeenCalledTimes(1);
  });
});
