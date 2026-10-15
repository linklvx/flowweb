// apps/api/src/modules/worker-presence/worker-presence.service.spec.ts
// Y0c T29-II（Z130/Z148②）：WorkerPresenceService 红测——付费三队列 worker 存活探测（getWorkers
// 形态见偏离 39：CLIENT LIST，registered 即活性信号）+5s TTL 缓存（付费路径零额外 RTT）+
// assertAdmittable fail-closed（registered=0 ⇒ 503 WORKER_ABSENT + collab_worker_absent_total{queue}
// inc；探测失败 ⇒ unknown 放行——enqueue 自身失败暴露真因，不做双重失败）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { register } from 'prom-client';
import { QUEUE_NAMES } from '../../config/queue.constants';
import { WorkerPresenceService, PRESENCE_CACHE_TTL_MS, PAID_QUEUE_NAMES } from './worker-presence.service';

function fakeQueue(workers: unknown[] = [], waiting = 0) {
  return {
    getWorkers: vi.fn(async () => workers),
    getWaitingCount: vi.fn(async () => waiting),
  };
}

async function counterValue(queue: string): Promise<number> {
  const m = register.getSingleMetric('collab_worker_absent_total') as any;
  if (!m) return NaN;
  const v = await m.get();
  return v.values.find((x: any) => x.labels.queue === queue)?.value ?? 0;
}

describe('Y0c T29-II WorkerPresenceService（Z130/Z148②）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('PAID_QUEUE_NAMES=付费三队列（execution/ai-image-edit/ai-result-download——Z130① 单源 QUEUE_NAMES）', () => {
    expect(PAID_QUEUE_NAMES).toEqual([QUEUE_NAMES.EXECUTION, QUEUE_NAMES.AI_IMAGE_EDIT, QUEUE_NAMES.AI_DOWNLOAD]);
  });

  it('getPresence：registered=getWorkers().length+waiting=getWaitingCount()（偏离 39 两键维度）', async () => {
    const svc = new WorkerPresenceService(
      fakeQueue([{}, {}], 3) as any, fakeQueue() as any, fakeQueue() as any,
    );
    expect(await svc.getPresence(QUEUE_NAMES.EXECUTION)).toEqual({ registered: 2, waiting: 3 });
  });

  it('getPresence：TTL 5s 缓存——窗内二次调用零再探测（付费路径不加 RTT）；过窗再探', async () => {
    const exec = fakeQueue([{}], 0);
    const svc = new WorkerPresenceService(exec as any, fakeQueue() as any, fakeQueue() as any);
    await svc.getPresence(QUEUE_NAMES.EXECUTION);
    await svc.getPresence(QUEUE_NAMES.EXECUTION);
    expect(exec.getWorkers).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PRESENCE_CACHE_TTL_MS + 1);
    await svc.getPresence(QUEUE_NAMES.EXECUTION);
    expect(exec.getWorkers).toHaveBeenCalledTimes(2);
  });

  it('getPresence：探测失败（Redis 错）⇒ null=unknown（不写缓存——下轮重探）', async () => {
    const exec = { getWorkers: vi.fn(async () => { throw new Error('redis down'); }), getWaitingCount: vi.fn(async () => 0) };
    const svc = new WorkerPresenceService(exec as any, fakeQueue() as any, fakeQueue() as any);
    expect(await svc.getPresence(QUEUE_NAMES.EXECUTION)).toBeNull();
    expect(await svc.getPresence(QUEUE_NAMES.EXECUTION)).toBeNull();
    expect(exec.getWorkers).toHaveBeenCalledTimes(2);
  });

  it('assertAdmittable：registered=0 ⇒ 503 WORKER_ABSENT + collab_worker_absent_total{queue} inc', async () => {
    const before = await counterValue(QUEUE_NAMES.AI_IMAGE_EDIT);
    const svc = new WorkerPresenceService(fakeQueue() as any, fakeQueue([], 0) as any, fakeQueue() as any);
    await expect(svc.assertAdmittable(QUEUE_NAMES.AI_IMAGE_EDIT)).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ code: 'WORKER_ABSENT' }),
    });
    expect(await counterValue(QUEUE_NAMES.AI_IMAGE_EDIT)).toBe(before + 1);
  });

  it('assertAdmittable：registered≥1 ⇒ 放行（计数不动）', async () => {
    const before = await counterValue(QUEUE_NAMES.EXECUTION);
    const svc = new WorkerPresenceService(fakeQueue([{}]) as any, fakeQueue() as any, fakeQueue() as any);
    await expect(svc.assertAdmittable(QUEUE_NAMES.EXECUTION)).resolves.toBeUndefined();
    expect(await counterValue(QUEUE_NAMES.EXECUTION)).toBe(before);
  });

  it('assertAdmittable：探测失败 ⇒ unknown 放行不拒（enqueue 自身会失败暴露真因——不做双重失败）', async () => {
    const before = await counterValue(QUEUE_NAMES.AI_DOWNLOAD);
    const dl = { getWorkers: vi.fn(async () => { throw new Error('redis down'); }), getWaitingCount: vi.fn(async () => 0) };
    const svc = new WorkerPresenceService(fakeQueue() as any, fakeQueue() as any, dl as any);
    await expect(svc.assertAdmittable(QUEUE_NAMES.AI_DOWNLOAD)).resolves.toBeUndefined();
    expect(await counterValue(QUEUE_NAMES.AI_DOWNLOAD)).toBe(before);
  });

  it('拒绝异常形态=ServiceUnavailableException（CollabNotServingFilter 认 WORKER_ABSENT 码附 Retry-After: 30）', async () => {
    const svc = new WorkerPresenceService(fakeQueue([], 0) as any, fakeQueue() as any, fakeQueue() as any);
    const err = await svc.assertAdmittable(QUEUE_NAMES.EXECUTION).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
  });
});
