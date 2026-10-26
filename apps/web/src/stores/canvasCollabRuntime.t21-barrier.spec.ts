// apps/web/src/stores/canvasCollabRuntime.t21-barrier.spec.ts
// Y1c T21（G4 门客户端——红先行）：save barrier 回执=advanceSavedSeq 第二入口（偏离 36：
// savedSeq 只由服务端持久化回执推进，provider synced 恒不推进）。回执双门=nonce 在飞匹配+
// 成功档 {clientSeq,committedSeq}；错误档（BARRIER_FAILED/maintenance）不产生 Durable 不推进。
import { describe, it, expect, beforeEach } from 'vitest';
import { getSavedSeq, __t21BarrierTestSeam } from './canvasCollabRuntime';

const seam = __t21BarrierTestSeam();

describe('Y1c T21：save barrier 客户端（回执双入口同汇 advanceSavedSeq）', () => {
  beforeEach(() => { seam.reset(); });

  it('成功回执：nonce 在飞匹配 → advanceSavedSeq 推进（savedSeq 单调）', () => {
    seam.armPending('bar-1');
    expect(getSavedSeq()).toBe(0);
    const hit = seam.consumeBarrierReceipt({ nonce: 'bar-1', clientSeq: 3, committedSeq: '42' });
    expect(hit).toBe(true);
    expect(getSavedSeq()).toBe(42);
  });

  it('错误回执（error:BARRIER_FAILED——仅 committedSeq 无 clientSeq 覆盖形态）：不推进 savedSeq', () => {
    seam.armPending('bar-2');
    const hit = seam.consumeBarrierReceipt({ nonce: 'bar-2', error: 'BARRIER_FAILED', committedSeq: '7' });
    expect(hit).toBe(true);
    expect(getSavedSeq()).toBe(0);   // 错误档永不产生 Durable
  });

  it('陈旧 nonce（断线新 nonce 后旧回执迟到）：整体忽略零状态变化', () => {
    seam.armPending('bar-3');
    expect(seam.consumeBarrierReceipt({ nonce: 'stale-other', clientSeq: 9, committedSeq: '99' })).toBe(false);
    expect(getSavedSeq()).toBe(0);
  });

  it('单调性：旧 committedSeq 回执不回退 savedSeq', () => {
    seam.armPending('bar-4');
    seam.consumeBarrierReceipt({ nonce: 'bar-4', clientSeq: 1, committedSeq: '50' });
    seam.armPending('bar-5');
    seam.consumeBarrierReceipt({ nonce: 'bar-5', clientSeq: 2, committedSeq: '30' });
    expect(getSavedSeq()).toBe(50);   // 只前进
  });
});
