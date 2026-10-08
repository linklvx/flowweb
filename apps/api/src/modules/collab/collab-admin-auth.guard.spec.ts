// Y0a-4（W23）：独立停机令牌换装守卫用例——drain 不回退 PROMETHEUS_TOKEN（监控只读令牌≠停机权）。
// B5 教训修正：设 '' 无鉴别力——guard `admin ?? PROM` 中 '' 非 nullish（→token=''→!token 先抛），
// 改动前后该用例都绿=假门禁。必须 delete 造"未设"（undefined 才触发 ?? 回退）。
// 回填纪律：prev===undefined 时禁止 env.X=prev（会把键设成字符串 'undefined'=truthy 污染后续用例）。
import { describe, it, expect } from 'vitest';
import { CollabAdminAuthGuard } from './collab-admin-auth.guard';

describe('CollabAdminAuthGuard（W23 独立停机令牌）', () => {
  it('Y0a-4/W23：COLLAB_ADMIN_TOKEN 未设时不回退 PROMETHEUS_TOKEN（production 403）', () => {
    const prevAdmin = process.env.COLLAB_ADMIN_TOKEN, prevProm = process.env.PROMETHEUS_TOKEN, prevNode = process.env.NODE_ENV;
    delete process.env.COLLAB_ADMIN_TOKEN;   // ← 关键：'' 走 !token 分支测不到回退；undefined 才走 ?? PROM
    process.env.PROMETHEUS_TOKEN = 'prom-tok'; process.env.NODE_ENV = 'production';
    try {
      const guard = new CollabAdminAuthGuard();
      const ctx = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-prometheus-token': 'prom-tok' } }) }) } as any;
      expect(() => guard.canActivate(ctx)).toThrow();   // 真红相：现状回退 prom-tok 匹配→放行不抛→toThrow 红；删回退后=绿
    } finally {
      if (prevAdmin === undefined) delete process.env.COLLAB_ADMIN_TOKEN; else process.env.COLLAB_ADMIN_TOKEN = prevAdmin;
      if (prevProm === undefined) delete process.env.PROMETHEUS_TOKEN; else process.env.PROMETHEUS_TOKEN = prevProm;
      if (prevNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNode;
    }
  });

  it('Y0a-4/W23：COLLAB_ADMIN_TOKEN 设置且匹配→放行（防删回退时误删整个 token 校验）', () => {
    const prevAdmin = process.env.COLLAB_ADMIN_TOKEN, prevNode = process.env.NODE_ENV;
    process.env.COLLAB_ADMIN_TOKEN = 'admin-tok'; process.env.NODE_ENV = 'production';
    try {
      const guard = new CollabAdminAuthGuard();
      const ctx = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-prometheus-token': 'admin-tok' } }) }) } as any;
      expect(() => guard.canActivate(ctx)).not.toThrow();
    } finally {
      if (prevAdmin === undefined) delete process.env.COLLAB_ADMIN_TOKEN; else process.env.COLLAB_ADMIN_TOKEN = prevAdmin;
      if (prevNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNode;
    }
  });
});
