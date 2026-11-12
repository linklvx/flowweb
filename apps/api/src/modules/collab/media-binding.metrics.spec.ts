// apps/api/src/modules/collab/media-binding.metrics.spec.ts
// C3a-8 质量收口 Minor（新指标零测试）：gap_seq 首现/清零语义 + write_total/skip_total 落地。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearMediaBindingGap,
  mediaBindingGapSeq,
  mediaBindingSkipTotal,
  mediaBindingWriteTotal,
  observeMediaBindingGap,
  recordMediaBindingProjection,
} from './media-binding.metrics';

const gaugeValue = async (): Promise<number> => {
  const m = await mediaBindingGapSeq.get();
  return m.values[0]?.value ?? 0;
};

const counterValue = async (
  metric: { get(): Promise<{ values: Array<{ labels: Record<string, string | number>; value: number }> }> },
  labels: Record<string, string>,
): Promise<number> => {
  const m = await metric.get();
  return m.values.find((v) => Object.entries(labels).every(([k, x]) => String(v.labels[k]) === x))?.value ?? 0;
};

describe('C3a-8 指标语义（media-binding.metrics）', () => {
  beforeEach(() => { clearMediaBindingGap(); });

  it('gap_seq：首现只写一次；rebuild 清零后可再记（最后观测语义）', async () => {
    expect(await gaugeValue()).toBe(0);
    observeMediaBindingGap(5n);
    expect(await gaugeValue()).toBe(5);
    observeMediaBindingGap(9n);   // 未闭合——首现语义：不覆盖
    expect(await gaugeValue()).toBe(5);
    clearMediaBindingGap();       // rebuild CAS 清 dirty → 归 0
    expect(await gaugeValue()).toBe(0);
    observeMediaBindingGap(9n);   // 闭合后再失败=新首现
    expect(await gaugeValue()).toBe(9);
  });

  it('write_total/skip_total：投影统计落地（append 净写/三档 skip；零值不 inc）', async () => {
    const w0 = await counterValue(mediaBindingWriteTotal, { source: 'append' });
    const m0 = await counterValue(mediaBindingSkipTotal, { reason: 'missing' });
    const c0 = await counterValue(mediaBindingSkipTotal, { reason: 'cross-team' });
    const s0 = await counterValue(mediaBindingSkipTotal, { reason: 'soft-deleted' });
    recordMediaBindingProjection('append', { written: 2, skipped: { missing: 1, 'cross-team': 1, 'soft-deleted': 0 } });
    expect(await counterValue(mediaBindingWriteTotal, { source: 'append' })).toBe(w0 + 2);
    expect(await counterValue(mediaBindingSkipTotal, { reason: 'missing' })).toBe(m0 + 1);
    expect(await counterValue(mediaBindingSkipTotal, { reason: 'cross-team' })).toBe(c0 + 1);
    expect(await counterValue(mediaBindingSkipTotal, { reason: 'soft-deleted' })).toBe(s0);   // 零不 inc
  });
});
