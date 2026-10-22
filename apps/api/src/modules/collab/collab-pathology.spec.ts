// apps/api/src/modules/collab/collab-pathology.spec.ts
// T18（Z4''-v14）：order 域病理装载档——计数+告警（shared scanOrderPathology 单源判定；
// 本 spec 锚 api 挂点行为：clean 零副作用/逐档计数/告警分级/不抛）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { register } from 'prom-client';
import { observeOrderPathologyOnLoad } from './collab-pathology';

const logger = { warn: vi.fn(), error: vi.fn() } as unknown as Pick<Logger, 'warn' | 'error'> & { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

async function metricDelta(kind: string, fn: () => unknown): Promise<number> {
  const metric: any = register.getSingleMetric('collab_order_pathology_total');
  const countOf = async () =>
    (await metric.get()).values.find((s: any) => s.labels?.kind === kind)?.value ?? 0;
  const before = await countOf();
  await fn();
  return (await countOf()) - before;
}

beforeEach(() => {
  (logger.warn as unknown as ReturnType<typeof vi.fn>).mockClear();
  (logger.error as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe('observeOrderPathologyOnLoad（装载档挂点——T18）', () => {
  it('clean doc ⇒ 零计数零日志', async () => {
    const inc = await metricDelta('duplicate-key', () =>
      observeOrderPathologyOnLoad(logger, 'project:clean', [
        { id: 'a', parentId: null, data: { order: '5000' } },
        { id: 'b', parentId: null, data: { order: '5100' } },
      ]));
    expect(inc).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('同层重复键 ⇒ duplicate-key 档 +1（doc 级）+ WARN 结构化日志（含修复指引=CLI renumber-layer）——不抛', async () => {
    const inc = await metricDelta('duplicate-key', () =>
      observeOrderPathologyOnLoad(logger, 'project:dup', [
        { id: 'a', parentId: null, data: { order: '5000' } },
        { id: 'b', parentId: null, data: { order: '5000' } },
      ]));
    expect(inc).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const line = (logger.warn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toContain('"event":"collab_order_pathology"');
    expect(line).toContain('collab-renumber-layer');
    expect(line).toContain('"duplicateKeyNodes":2');
    expect(logger.error).not.toHaveBeenCalled();   // 无 hard 档——不升 ERROR
  });

  it('非法键（hard 档）⇒ hard-key +1 + ERROR（损坏上限分级）+soft/missing 各自计数', async () => {
    const hard = await metricDelta('hard-key', () =>
      observeOrderPathologyOnLoad(logger, 'project:bad', [
        { id: 'bad', parentId: null, data: { order: 'not-a-key' } },
        { id: 'soft', parentId: null, data: { order: `5.${'5'.repeat(30)}` } },
        { id: 'bare', parentId: null, data: {} },
      ]));
    expect(hard).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const line = (logger.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toContain('"hardKeyNodes":1');
    expect(line).toContain('"softKeyNodes":1');
    expect(line).toContain('"missingKeyNodes":1');
  });

  it('观测永不 throw（读序容忍不 500——病理非执法）', () => {
    expect(() => observeOrderPathologyOnLoad(logger, 'project:x', [
      { id: 'a', parentId: null, data: Object.create(null) },   // 原型 null 的 data——读侧全函数
    ])).not.toThrow();
  });
});
