// apps/api/src/modules/execution/execution-daemon.module.spec.ts
// Y0c T23（Z98/Z67/Z48）：COLLAB_ROLE 角色门第四面「守护与定时器装配」——ExecutionDaemonModule
// 结构性断言。先红锚（Z122⑧）：本 spec 落地时 COLLAB_ROLE 全仓零读者、模块不存在。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { envSchema, COLLAB_ROLE_DEFAULT } from '../../config/env';
import { ExecutionDaemonModule } from './execution-daemon.module';
import { IntentReconcileService } from './intent-reconcile.service';
import { TempCleanupSchedulerService } from '../temp-cleanup/temp-cleanup.scheduler.service';
import { SubscriptionSchedulerService } from '../subscription/task/subscription-scheduler.service';

const MIN_ENV = {
  DATABASE_URL: 'postgresql://localhost:5432/db',
  MINIO_ENDPOINT: 'http://127.0.0.1:9000',
  MINIO_ACCESS_KEY: 'minioadmin',
  MINIO_SECRET_KEY: 'minioadmin123',
};

/** providers 符号面提取（ClassProvider.provide 与 TypeProvider 自身双形态） */
function providerSymbols(mod: ReturnType<typeof ExecutionDaemonModule.register>): unknown[] {
  return (mod.providers ?? []).map((p) => (typeof p === 'function' ? p : (p as { provide?: unknown }).provide));
}

describe('COLLAB_ROLE env 契约（Z48——非法值 fail-fast 拒启+默认 api）', () => {
  it('三合法值过验（api/worker/all）', () => {
    for (const v of ['api', 'worker', 'all'] as const) {
      const r = envSchema.safeParse({ ...MIN_ENV, COLLAB_ROLE: v });
      expect(r.success, `COLLAB_ROLE=${v} 应过验`).toBe(true);
    }
  });

  it('词汇表外值拒启（spec :693 非法值→zod fail-fast）', () => {
    expect(envSchema.safeParse({ ...MIN_ENV, COLLAB_ROLE: 'sidecar' }).success).toBe(false);
  });

  it(`未设默认 ${COLLAB_ROLE_DEFAULT}（Z48 安全方向：worker 无 role⇒不消费——默认永不倒向 worker）`, () => {
    const r = envSchema.safeParse(MIN_ENV);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.COLLAB_ROLE).toBe(COLLAB_ROLE_DEFAULT);
  });

  it('空串=未设走默认（B13）', () => {
    const r = envSchema.safeParse({ ...MIN_ENV, COLLAB_ROLE: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.COLLAB_ROLE).toBe(COLLAB_ROLE_DEFAULT);
  });
});

describe('ExecutionDaemonModule 装配（Z98——reconcile 只在 api 从口头前提变结构约束）', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('api ⇒ daemon 装配：IntentReconcileService+temp-cleanup/subscription-task repeatable 注册三样（Z98 点名）', () => {
    vi.stubEnv('COLLAB_ROLE', 'api');
    const syms = providerSymbols(ExecutionDaemonModule.register());
    expect(syms).toContain(IntentReconcileService);
    expect(syms).toContain(TempCleanupSchedulerService);
    expect(syms).toContain(SubscriptionSchedulerService);
  });

  it('all ⇒ 同 api 装配（Z67① 本地单进程形态）', () => {
    vi.stubEnv('COLLAB_ROLE', 'all');
    const syms = providerSymbols(ExecutionDaemonModule.register());
    expect(syms).toContain(IntentReconcileService);
    expect(syms).toContain(TempCleanupSchedulerService);
    expect(syms).toContain(SubscriptionSchedulerService);
  });

  it('worker ⇒ providers 空（Z98 结构断言：role!=="api"∧role!=="all" ⇒ 空——双进程双倍回收钱防线）', () => {
    vi.stubEnv('COLLAB_ROLE', 'worker');
    expect(ExecutionDaemonModule.register().providers ?? []).toEqual([]);
  });

  it('worker ⇒ imports 空（不拖 CollabModule——worker 面纯净，T25 census 组⑰ 前置）', () => {
    vi.stubEnv('COLLAB_ROLE', 'worker');
    expect((ExecutionDaemonModule.register().imports ?? []) as unknown[]).toEqual([]);
  });

  it('未设 ⇒ 默认 api 装配（Z48 安全方向：仅显式 worker 排除，漏设永不静默丢守护）', () => {
    const saved = process.env.COLLAB_ROLE;
    delete process.env.COLLAB_ROLE;
    try {
      expect(providerSymbols(ExecutionDaemonModule.register())).toContain(IntentReconcileService);
    } finally {
      if (saved !== undefined) process.env.COLLAB_ROLE = saved;
    }
  });

  it('worker 进程零 reconcile timer（P0-3）：装配后 IntentReconcileService 不可得+onModuleInit 零调用+repeatable 注册零发生', async () => {
    vi.stubEnv('COLLAB_ROLE', 'worker');
    const reconcileInit = vi.spyOn(IntentReconcileService.prototype, 'onModuleInit').mockImplementation(() => {});
    const tempSchedInit = vi.spyOn(TempCleanupSchedulerService.prototype, 'onModuleInit').mockImplementation(async () => {});
    const subSchedInit = vi.spyOn(SubscriptionSchedulerService.prototype, 'onModuleInit').mockImplementation(async () => {});
    const app = await Test.createTestingModule({ imports: [ExecutionDaemonModule.register()] }).compile();
    expect(() => app.get(IntentReconcileService)).toThrow();
    expect(reconcileInit).not.toHaveBeenCalled();
    expect(tempSchedInit).not.toHaveBeenCalled();
    expect(subSchedInit).not.toHaveBeenCalled();
    await app.close();
  });
});
