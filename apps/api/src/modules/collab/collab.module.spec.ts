// apps/api/src/modules/collab/collab.module.spec.ts
// Y0c T34（Z45③）：COLLAB_* 装配惰性化——useValue（模块加载期求值，先于 dotenv→
// validateEnv 写回=Z79 违规面）⇒ useFactory（DI 解析期=NestFactory.create 时求值，恒在
// main.ts validateEnv 之后⇒写回等价成立）。
// TD-32/C2 T16：COLLAB_PORT 锚由源码文本改**行为断言**（provider useFactory 调用期解析——
// 0 保留/blank 回退/非法 fail-fast 三档直接驱动工厂，不再依赖源码形态匹配）。
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { CollabModule } from './collab.module';

type ProviderEntry = { provide?: unknown; useFactory?: () => unknown };
const providers = (Reflect.getMetadata('providers', CollabModule) ?? []) as ProviderEntry[];
const factoryOf = (token: string): (() => unknown) | undefined =>
  providers.find((p) => p.provide === token)?.useFactory;

describe('T34（Z45③）/TD-32 T16：collab 装配 useFactory 惰性化（行为断言）', () => {
  it('COLLAB_PORT useFactory：调用期解析——0 保留/blank 回退 3001/显式值透传/非法 fail-fast', () => {
    const f = factoryOf('COLLAB_PORT');
    expect(typeof f).toBe('function');
    const old = process.env.COLLAB_PORT;
    try {
      process.env.COLLAB_PORT = '0';
      expect(f!()).toBe(0);
      process.env.COLLAB_PORT = '31001';
      expect(f!()).toBe(31001);
      process.env.COLLAB_PORT = '';
      expect(f!()).toBe(3001);
      delete process.env.COLLAB_PORT;
      expect(f!()).toBe(3001);
      process.env.COLLAB_PORT = '0x10';
      expect(() => f!()).toThrow(/非法/);
    } finally {
      if (old === undefined) delete process.env.COLLAB_PORT;
      else process.env.COLLAB_PORT = old;
    }
  });

  it('COLLAB_DEBOUNCE/COLLAB_TIMEOUT 仍 useFactory（Z45③ 形态保持）', () => {
    expect(typeof factoryOf('COLLAB_DEBOUNCE')).toBe('function');
    expect(typeof factoryOf('COLLAB_TIMEOUT')).toBe('function');
  });
});
