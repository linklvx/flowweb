// apps/web/src/stores/canvasCollabRuntime.t21-barrier.spec.ts
// Y1c T21（G4 门客户端——红先行）：save barrier 回执=advanceSavedSeq 第二入口（偏离 36：
// savedSeq 只由服务端持久化回执推进，provider synced 恒不推进）。回执双门=nonce 在飞匹配+
// 成功档 {clientSeq,committedSeq}；错误档（BARRIER_FAILED/maintenance）不产生 Durable 不推进。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSavedSeq, ensureDurableBeforeExecution, __t21BarrierTestSeam } from './canvasCollabRuntime';

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

// ═══ M-6（T21 收口）：四触发数字+Durable 判据（红性已诚实登记不可补——本组为绿证补齐）═══
describe('Y1c T21 收口：save barrier 四触发+Durable 判据', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seam.reset();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('触发①800ms idle：本地编辑去抖窗后恰发一 barrier（wire {nonce,clientSeq,sessionEpoch}）', () => {
    const sent: Array<Record<string, unknown>> = [];
    seam.setSendChannel((payload) => { sent.push(JSON.parse(payload)); });
    seam.simulateLocalEdit();
    seam.simulateLocalEdit();   // 连发两编辑——同窗合并
    expect(sent.length).toBe(0);   // 800ms 内未发
    vi.advanceTimersByTime(801);
    expect(sent.length).toBe(1);   // 恰一次（去抖合并）
    expect(typeof sent[0]!.nonce).toBe('string');
    expect(sent[0]!.clientSeq).toBe(2);
    expect(typeof sent[0]!.sessionEpoch).toBe('number');
    seam.setSendChannel(null);
  });

  it('触发②5s 上限：持续编辑不重置上限 timer——首编辑后 5s 恰发（编辑连发不饿死）', () => {
    const sent: unknown[] = [];
    seam.setSendChannel((p) => { sent.push(JSON.parse(p)); });
    seam.simulateLocalEdit();
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(700);
      seam.simulateLocalEdit();   // 每 700ms 编辑——idle 窗（800ms）永不满足
    }
    expect(sent.length).toBe(0);   // 4.2s 内零发送（idle 未达+上限未到）
    vi.advanceTimersByTime(850);   // 首编辑后 5s 上限到（idle 窗仍被续编辑推开）
    expect(sent.length).toBe(1);
    seam.setSendChannel(null);
  });

  it('触发③pagehide：未覆盖编辑在场→关页即发（fire-and-forget）', () => {
    const sent: unknown[] = [];
    seam.setSendChannel((p) => { sent.push(JSON.parse(p)); });
    seam.simulateLocalEdit();
    vi.advanceTimersByTime(801);
    expect(sent.length).toBe(1);   // idle 已发——再编辑制造未覆盖窗
    seam.simulateLocalEdit();
    seam.firePageHide();
    expect(sent.length).toBe(2);
    seam.setSendChannel(null);
  });

  it('触发④执行前 ensureDurable：回执覆盖后返回 savedSeq；Durable 判据=回执 clientSeq>=lastLocalEditSeq∧committedSeq', async () => {
    const sent: Array<Record<string, unknown>> = [];
    seam.setSendChannel((payload) => {
      sent.push(JSON.parse(payload));
      // 服务端即时回执（成功档——clientSeq 回显+committedSeq）
      const { nonce, clientSeq } = JSON.parse(payload) as { nonce: string; clientSeq: number };
      queueMicrotask(() => { seam.consumeBarrierReceipt({ nonce, clientSeq, committedSeq: '77' }); });
    });
    seam.simulateLocalEdit();
    vi.advanceTimersByTime(801);
    const docSeq = await ensureDurableBeforeExecution(500);
    expect(docSeq).toBe('77');   // 回执 committedSeq=执行 docSeq 下界
    expect(seam.durableCovered()).toBe(true);
    seam.setSendChannel(null);
  });

  it('Durable 判据负控：旧回执（clientSeq<lastLocalEditSeq）不构成覆盖——再编辑后 covered=false', () => {
    seam.simulateLocalEdit();   // 先有一编辑（clientSeq=1）——回执恰覆盖
    seam.armPending('old-1');
    seam.consumeBarrierReceipt({ nonce: 'old-1', clientSeq: 1, committedSeq: '10' });
    expect(seam.savedSeqValue()).toBe(10);
    expect(seam.durableCovered()).toBe(true);
    seam.simulateLocalEdit();   // 回执之后的新编辑——旧回执不再覆盖
    expect(seam.durableCovered()).toBe(false);
    expect(seam.savedSeqValue()).toBe(10);   // 旧回执不重复推进（单调）
  });
});
