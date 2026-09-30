// apps/api/src/common/redis/managed-redis.spec.ts
// 批3-2 B6：Redis 生命周期收口。现场清单（grep "new Redis" apps/api/src，2026-09-30）13 实例：
//   已有钩子 3：CollabRedisSync pub/sub（onModuleDestroy quit）、gateway RedisExtension
//   （extension onDestroy 由 server.destroy 驱动，hocuspocus-redis.esm.js:338-342）；
//   本次收口 10：8 个模块 REDIS_CLIENT 工厂 + auth.service.ts 硬编码 localhost（拔除改注入）
//   + auth.ts 顶层单例（AuthModule module-class 钩子关闭）。
// 机制：Nest 对 factory 产物 duck-typing 调用 onApplicationShutdown
//   （@nestjs/core hooks/on-app-shutdown.hook.js: hasOnAppShutdownHook = isFunction(...)，
//   遍历 getNonAliasProviders 的 instance）——ioredis 保活 event loop，不收口则 8s race
//   超时后进程退不出 → pm2 SIGKILL → stash 丢。
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Test } from '@nestjs/testing';
import { describe, it, expect, vi } from 'vitest';
import { createManagedRedis, REDIS_CLIENT } from './managed-redis';

describe('批3-2 B6 createManagedRedis', () => {
  it('返回带 onApplicationShutdown 的 Redis 实例，调用即 disconnect', () => {
    const client = createManagedRedis(undefined, { lazyConnect: true });   // lazyConnect：测试不建真实连接
    expect(typeof client.onApplicationShutdown).toBe('function');
    const disconnectSpy = vi.spyOn(client, 'disconnect').mockImplementation(() => {});
    client.onApplicationShutdown();
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('Nest 生命周期贯通：app.close() 自动调 provider 实例的 onApplicationShutdown', async () => {
    const client = createManagedRedis(undefined, { lazyConnect: true });
    const disconnectSpy = vi.spyOn(client, 'disconnect').mockImplementation(() => {});
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: REDIS_CLIENT, useFactory: () => client }],
    }).compile();
    await moduleRef.createNestApplication().close();
    expect(disconnectSpy).toHaveBeenCalled();
  });
});

/** 源码断言（仓内先例：metatype 断言用源码文本——esbuild 不发射 decorator metadata）：
 *  锁 8 个模块工厂 + auth.service/auth.ts 收口形态，防回退裸 new Redis。 */
const APP_ROOT = resolve(__dirname, '../..');
const MODULE_SITES = [
  'app.module.ts',
  'auth/auth.module.ts',
  'modules/media/media.module.ts',
  'modules/video-work/video-work.module.ts',
  'modules/recharge/recharge.module.ts',
  'modules/sms/sms.module.ts',
  'modules/subscription/subscription.module.ts',
  'modules/execution/execution.module.ts',
];

describe('批3-2 B6 模块工厂源码收口', () => {
  it('8 个 REDIS_CLIENT 工厂统一 createManagedRedis（onApplicationShutdown duck-typing）', () => {
    for (const site of MODULE_SITES) {
      const src = readFileSync(resolve(APP_ROOT, site), 'utf8');
      expect(src, `${site} 应使用 createManagedRedis`).toContain('createManagedRedis(');
    }
  });
  it('auth.service.ts 拔除硬编码 new Redis({host:"localhost"})，改注入 REDIS_CLIENT', () => {
    const src = readFileSync(resolve(APP_ROOT, 'auth/auth.service.ts'), 'utf8');
    expect(src).not.toContain('new Redis');
    expect(src).toContain("Inject(REDIS_CLIENT)");
  });
  it('auth.ts 顶层单例统一 createManagedRedis，AuthModule module 钩子关闭', () => {
    const authSrc = readFileSync(resolve(APP_ROOT, 'auth/auth.ts'), 'utf8');
    expect(authSrc).toContain('createManagedRedis(');
    const moduleSrc = readFileSync(resolve(APP_ROOT, 'auth/auth.module.ts'), 'utf8');
    expect(moduleSrc).toContain('authRedis.disconnect()');
  });
});
