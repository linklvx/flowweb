// apps/api/src/auth/auth.spec.ts
// Y0c T34（Z12/Z79/RC3）：auth.ts 惰性化锚——模块级 const env 读四点（trustedOrigins CORS_ORIGIN/
// redisUrl REDIS_URL/SESSION_COOKIE_OPTIONS.secure NODE_ENV/betterAuth baseURL BETTER_AUTH_URL）
// 原在 import 期求值（dotenv→validateEnv 写回之前=Z79 违规面；NODE_ENV 未设档读到 undefined）。
// 改惰性单例/函数：调用期求值恒在 validateEnv 之后（请求/DI 时序）⇒ 写回等价（Z45②）。
// 直接可观察面=secure 判据；getAuth() 单例面在此钉形状，真库链路（databaseHooks/getSession 直查）
// 由 auth.role.spec（int 语义）+auth.service.spec（mock 链路）回归承担。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSessionCookieOptions, getAuth, closeAuthRedis } from './auth';

afterEach(() => { vi.unstubAllEnvs(); });

describe('T34：getSessionCookieOptions()——secure 判据调用期读 NODE_ENV（旧 const 冻结 ⇒ 红）', () => {
  it('stub production ⇒ secure=true（旧形态：import 时点 NODE_ENV=test 冻结 false）', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(getSessionCookieOptions().secure).toBe(true);
  });

  it('development ⇒ secure=false；形状面（httpOnly/path/sameSite/maxAge=7d）原样保持', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(getSessionCookieOptions()).toEqual({
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,   // = session.expiresIn (7d) 强约束注记随函数迁移
    });
  });
});

describe('T34：getAuth() 惰性单例 + closeAuthRedis() 关停面', () => {
  it('getAuth() 两次同实例（单例缓存）且 api 面在位（betterAuth 构造后移至首调用）', () => {
    const a = getAuth();
    expect(a).toBe(getAuth());
    expect(typeof a.api.signInEmail).toBe('function');
  });

  it('closeAuthRedis 可安全调用（未建连/已建连均 no-throw——AuthModule.onApplicationShutdown 消费）', () => {
    expect(() => closeAuthRedis()).not.toThrow();
  });
});
