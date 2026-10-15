// apps/api/src/app.module.spec.ts
// Y0c T30（Z98 四面之二/§0.6 偏离 40）：processor 注册门结构断言——app.module forRoot
// `extraOptions.manualRegistration` 按 COLLAB_ROLE 门控（role=api⇒@nestjs/bullmq BullRegistrar
// onModuleInit 早退整个 register()⇒explorer 不为全图 17 个 @Processor 建 Worker；all⇒建=降级
// 单进程消费面保活）。worker.module forRoot 零功能改动恒注册（worker 进程消费面本体）。
// 静态元数据断言形态=module-split.spec 同款（Reflect 读 forRoot DynamicModule，不 compile 不连线）；
// AppModule 动态导入+vi.resetModules（module-scope validateEnv 在模块作用域——env 桩先行，
// worker.module.spec 同款纪律）。行为面真验证（queue.getWorkers()+exec-smoke 双进程）归 T33。
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/db';
process.env.MINIO_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.MINIO_ACCESS_KEY ??= 'minioadmin';
process.env.MINIO_SECRET_KEY ??= 'minioadmin123';

import { describe, it, expect, afterEach, vi } from 'vitest';
import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';

// BULL_EXTRA_OPTIONS_TOKEN 字面值（bull.constants.js:8——包 index 未导出该常量；forRoot 把
// extraOptions 解构进此 token 的 provider：bull.module.js:56-64 实证，registrar getModuleExtras
// 按 strict:false 取回）
const BULL_EXTRA_OPTIONS_TOKEN = 'BULLMQ_EXTRA_OPTIONS';

/** 重导入 AppModule（resetModules 使 module-scope validateEnv 重跑）并提取 forRoot 的
 *  BULL_EXTRA_OPTIONS provider useValue；找不到 provider=undefined（fail-closed 断言面）。 */
async function forRootExtraOptions(): Promise<Record<string, unknown> | undefined> {
  // prom-client 是外部化 CJS 依赖——vi.resetModules 不重置其 registry，而 store.metrics 等模块级
  // new Counter 会随 app.module 图重评估重复注册（di-smoke/worker.module.spec 同款 clear 先例）
  const { register } = await import('prom-client');
  register.clear();
  const { AppModule } = await import('./app.module');
  const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ?? []) as unknown[];
  for (const imp of imports) {
    const providers = (imp as { providers?: unknown })?.providers;
    if (!Array.isArray(providers)) continue;
    const hit = providers.find(
      (p) => (p as { provide?: unknown })?.provide === BULL_EXTRA_OPTIONS_TOKEN) as
      | { useValue?: Record<string, unknown> }
      | undefined;
    if (hit) return hit.useValue;
  }
  return undefined;
}

describe('Y0c T30 processor 注册门（Z98 四面之二）——forRoot extraOptions.manualRegistration 按 role', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('role=api ⇒ manualRegistration:true（api 进程不装配消费面——内存隔离+Z130/Z148② 侦测前提）', async () => {
    vi.stubEnv('COLLAB_ROLE', 'api');
    vi.resetModules();
    expect(await forRootExtraOptions()).toMatchObject({ manualRegistration: true });
  }, 60000);

  it('role=all ⇒ manualRegistration:false（Z67① 本地单进程形态消费面保活）', async () => {
    vi.stubEnv('COLLAB_ROLE', 'all');
    vi.resetModules();
    expect(await forRootExtraOptions()).toMatchObject({ manualRegistration: false });
  }, 60000);

  it('未设 ⇒ 默认 api ⇒ manualRegistration:true（Z48 安全方向：漏设永不静默装配消费面）', async () => {
    const saved = process.env.COLLAB_ROLE;
    delete process.env.COLLAB_ROLE;
    vi.resetModules();
    try {
      expect(await forRootExtraOptions()).toMatchObject({ manualRegistration: true });
    } finally {
      if (saved !== undefined) process.env.COLLAB_ROLE = saved;
    }
  }, 60000);
});
