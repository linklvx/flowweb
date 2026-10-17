// apps/api/src/test-utils/dual-client-server.spec.ts
// T1.5 准入面夹具基座——夹具自身行为锚（红测先行）。
// 核心断言：connect() 经注入式 ws（Node ws 包 headers 选项）发送 Origin+Cookie header，
// 网关侧 onAuthenticate payload.requestHeaders 必须可见——T2（Origin 校验+cookie-only+query
// token 删除）的全部真连红锚共同硬前置。
// URL 侧：query token 退役（cookie 通道承载原 token 语义——gateway 现状 authenticate 的
// `requestParameters?.get('token') ?? parseSessionToken(cookie)` fallback 分支认证通过）。
import { describe, it, expect, vi } from 'vitest';
import { startDualClientServer } from './dual-client-server';

describe('T1.5 准入面夹具（注入式 ws）', () => {
  it('connect() 经注入式 ws 发送 Origin+Cookie header（网关侧 authenticate requestHeaders 可见）', async () => {
    const kit = await startDualClientServer();
    try {
      const seen: Record<string, string | null> = {};
      // spy 实例方法 authenticate（构造 Server 时捕获的箭头函数运行时经 this 解析到 prototype
      // ——spy 生效于真连路径；spy hooks.onAuthenticate 无效，因 server 配置在构造时已按值捕获
      // 原函数引用。T41 W3b 宿主随迁〔偏离 75〕：接线改 `(p) => this.sessionGuard.authenticate(p)`
      // ⇒ spy 宿主=gateway.sessionGuard 的 prototype，断言逐字保留）
      const proto = Object.getPrototypeOf(kit.gateway.sessionGuard) as Record<string, any>;
      const orig = proto.authenticate;
      const spy = vi.spyOn(proto, 'authenticate').mockImplementation(async function (this: unknown, p: any) {
        seen.origin = p.requestHeaders?.get?.('origin') ?? null;
        seen.cookie = p.requestHeaders?.get?.('cookie') ?? null;
        // T2 评审小修⑤：query token 退役的服务端证据——URL 无 query ⇒ 网关侧 requestParameters 无 token
        seen.queryToken = p.requestParameters?.get?.('token') ?? null;
        return orig.call(this, p);
      });
      const { provider, synced } = kit.connect('project:fx', 'tok', { origin: 'http://localhost:5173' });
      await synced;   // 认证通过本身即证明 cookie 通道承载原 token 语义
      expect(spy).toHaveBeenCalled();
      expect(seen.origin).toBe('http://localhost:5173');
      expect(seen.cookie).toContain('flowweb.session_token=tok');
      // query token 退役：provider URL 不再携带 ?token=（T2 cookie-only 落地零障碍）
      expect((provider as any).configuration.url).not.toContain('token=');
      // T2 评审小修⑤：服务端侧同证——网关收到的 requestParameters 无 token 键
      expect(seen.queryToken).toBeNull();
    } finally {
      await kit.dispose();
    }
  }, 15_000);

  it('connect() 缺省 origin 推导默认值（COLLAB_ALLOWED_ORIGINS 未设 → localhost:5173）', async () => {
    // T2 评审小修④：env save/restore 惯例（collab-ready.controller.spec.ts:41 先例形态）
    const saved = process.env.COLLAB_ALLOWED_ORIGINS;
    delete process.env.COLLAB_ALLOWED_ORIGINS;
    const kit = await startDualClientServer();
    try {
      const seen: Record<string, string | null> = {};
      const proto = Object.getPrototypeOf(kit.gateway.sessionGuard) as Record<string, any>;   // T41 W3b 宿主随迁（偏离 75）
      const orig = proto.authenticate;
      vi.spyOn(proto, 'authenticate').mockImplementation(async function (this: unknown, p: any) {
        seen.origin = p.requestHeaders?.get?.('origin') ?? null;
        seen.cookie = p.requestHeaders?.get?.('cookie') ?? null;
        return orig.call(this, p);
      });
      const { synced } = kit.connect('project:fx');   // 不传 origin——默认推导
      await synced;
      expect(seen.origin).toBe('http://localhost:5173');
      expect(seen.cookie).toContain('flowweb.session_token=tok');
    } finally {
      await kit.dispose();
      // T2 评审小修④：restore（dispose 失败也要恢复 env）
      if (saved === undefined) delete process.env.COLLAB_ALLOWED_ORIGINS; else process.env.COLLAB_ALLOWED_ORIGINS = saved;
    }
  }, 15_000);
});
