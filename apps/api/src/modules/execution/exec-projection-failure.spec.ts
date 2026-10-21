// apps/api/src/modules/execution/exec-projection-failure.spec.ts
// Y0c T0（Z3）：collab_exec_projection_failed_total{cause}——吞错点观测
//（不改策略只加计数；cause=CollabAuthReason 词表∪not-serving∪other 有界词表——Z136④ 原口径 14 处；
//  Y0c T28（Z41）拆两半后 12 处：execution.service 11+ai-image-edit.processor process catch 1——
//  两 worker failed 钩子投影半移交 api 最终一致链，不再是吞错点）。
// 直构形态=各 service 构造器全 mock 依赖（onReserveFail/onFailed 白盒直调）。
import { describe, it, expect, vi } from 'vitest';
import { register } from 'prom-client';
import { ServiceUnavailableException } from '@nestjs/common';
import { ExecutionService } from './execution.service';
import { ExecutionProcessor } from './execution.processor';
import { AiImageEditProcessor } from '../ai-image-edit/ai-image-edit.processor';
import { classifyExecProjectionFailure } from './exec.metrics';

/** cause 维计数增量 */
async function causeDelta(cause: string, fn: () => Promise<unknown> | unknown): Promise<number> {
  const metric: any = register.getSingleMetric('collab_exec_projection_failed_total');
  const read = async () => (await metric.get()).values.find((v: any) => v.labels.cause === cause)?.value ?? 0;
  const before = await read();
  await fn();
  return (await read()) - before;
}

describe('Y0c T0：exec 投影吞错观测（collab_exec_projection_failed_total{cause}）', () => {
  it('classify：带 reason 抛错归 reason 词表/503 SUE 折 not-serving/其余（含 undefined）折 other——值域有界', () => {
    expect(classifyExecProjectionFailure(Object.assign(new Error('x'), { reason: 'db-unavailable' }))).toBe('db-unavailable');
    expect(classifyExecProjectionFailure(new ServiceUnavailableException('collab degraded: lease or spool'))).toBe('not-serving');
    expect(classifyExecProjectionFailure(Object.assign(new Error('x'), { reason: '' }))).toBe('other');   // 空 reason 不可作 label
    expect(classifyExecProjectionFailure(new Error('plain'))).toBe('other');
    expect(classifyExecProjectionFailure(undefined)).toBe('other');
  });

  it('classify：reason 经 COLLAB_AUTH_REASONS 14 值闭集白名单——非词表 reason（动态错误形态）折 other 不直透 label', () => {
    expect(classifyExecProjectionFailure(Object.assign(new Error('x'), { reason: 'lease-vacuum-xyz' }))).toBe('other');
    expect(classifyExecProjectionFailure(Object.assign(new Error('x'), { reason: 'pool exhausted @host:5432' }))).toBe('other');
    expect(classifyExecProjectionFailure(Object.assign(new Error('x'), { reason: 'invalid-doc-name' }))).toBe('invalid-doc-name');   // 词表值照常直透（闭集抽验）
  });

  it('execution.service onReserveFail：writeExecStatus reject 被 .catch 吞且计数+1（cause=not-serving——503 SUE），void_/emit 不受影响', async () => {
    const void_ = vi.fn().mockResolvedValue(undefined);
    const emitNodeStatus = vi.fn();
    const svc = new ExecutionService(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      { writeExecStatus: vi.fn().mockRejectedValue(new ServiceUnavailableException('collab not serving')) } as any,   // collabDoc
      {} as any,                                                                                                      // docWriter（onReserveFail 不触——Y0c T8 组批位）
      { emitNodeStatus } as any,                                                                                      // gateway
      {} as any,                                                                                                      // downloadQueue
      { void_ } as any,                                                                                               // intentService
      {} as any,                                                                                                      // upstreamMedia（Y1a T8——onReserveFail 不触）
    );
    const d = await causeDelta('not-serving', () =>
      (svc as any).onReserveFail('p1', { id: 'n1' }, { attempts: 1, intentId: 'i1' }, 'boom', 'SOME_CODE'));
    expect(d).toBe(1);
    expect(void_).toHaveBeenCalledTimes(1);
    expect(emitNodeStatus).toHaveBeenCalledTimes(1);
  });

  it('execution.processor onFailed（Y0c T28/Z41 拆两半）：钩子零投影写——计数零增 ∧意图终态照达（P14 兜底不外抛）', async () => {
    const fail = vi.fn().mockResolvedValue(undefined);
    const writeExecStatus = vi.fn().mockRejectedValue(new Error('doc gone'));
    const proc = new ExecutionProcessor(
      {} as any,
      { writeExecStatus } as any,
      { findByActiveNode: vi.fn().mockResolvedValue({ id: 'intent-1', attempts: 1, intentId: 'i1', execSeq: 1n }), fail } as any,
    );
    const d = await causeDelta('other', () =>
      proc.onFailed({ data: { projectId: 'p1', nodeId: 'n1' } } as any, new Error('job boom')));
    expect(d).toBe(0);   // 投影半移交 api 最终一致链——worker 失败钩子不再是吞错点
    expect(writeExecStatus).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith('intent-1', 'job boom', undefined, 1n); // T9：行代际
  });

  it('ai-image-edit.processor onFailed（Y0c T28/Z41 拆两半）：钩子零投影写——计数零增 ∧意图终态照达', async () => {
    const fail = vi.fn().mockResolvedValue(undefined);
    const writeExecStatus = vi.fn().mockRejectedValue(new ServiceUnavailableException('doc-vacuuming'));
    const proc = new AiImageEditProcessor(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      { writeExecStatus } as any,   // collabDoc
      {} as any,                                                                                                 // lightingConsumer
      { findByActiveNode: vi.fn().mockResolvedValue({ id: 'intent-2', attempts: 0, execSeq: 1n }), fail } as any,             // intentService
      {} as any,                                                                                                 // safeFetch（T6 注入面——onFailed 钩子不触下载）
    );
    const d = await causeDelta('not-serving', () =>
      proc.onFailed({ data: { projectId: 'p1', nodeId: 'n1' } } as any, new Error('edit boom')));
    expect(d).toBe(0);   // 投影半移交 api 最终一致链——worker 失败钩子不再是吞错点
    expect(writeExecStatus).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith('intent-2', 'edit boom', undefined, 1n);
  });
});
