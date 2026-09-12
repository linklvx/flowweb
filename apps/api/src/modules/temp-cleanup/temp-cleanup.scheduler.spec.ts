// apps/api/src/modules/temp-cleanup/temp-cleanup.scheduler.spec.ts
import { describe, it, expect, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { TempCleanupSchedulerService } from './temp-cleanup.scheduler.service';

describe('TempCleanupSchedulerService（调度注册——镜像 subscription-scheduler 先例）', () => {
  it('先清旧 repeatable 再 add（防重启重复注册）；每小时 17 分 UTC + 固定 jobId', async () => {
    const order: string[] = [];
    const queue = {
      getRepeatableJobs: vi.fn().mockImplementation(async () => { order.push('get'); return [{ key: 'stale-key' }]; }),
      removeRepeatableByKey: vi.fn().mockImplementation(async () => { order.push('remove'); }),
      add: vi.fn().mockImplementation(async () => { order.push('add'); }),
    };
    const svc = new TempCleanupSchedulerService(queue as unknown as Queue);
    await svc.onModuleInit();
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('stale-key');
    expect(order.indexOf('remove')).toBeLessThan(order.indexOf('add')); // 先清旧再注册
    expect(queue.add).toHaveBeenCalledWith('temp-cleanup', undefined, {
      repeat: { pattern: '17 * * * *', tz: 'UTC' }, // 避开整点扎堆 + tz 显式（先例同款）
      jobId: 'temp-cleanup-hourly',
    });
  });
});
