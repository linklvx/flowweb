// apps/web/src/pages/canvas/video-editor/audio-engine/pcm.test.ts
import { describe, it, expect } from 'vitest';
import { stretchPcm, resamplePcm, type PcmData } from './pcm';

const sine = (sr: number, sec: number, freq: number): Float32Array => {
  const p = new Float32Array(sr * sec);
  for (let i = 0; i < p.length; i++) p[i] = Math.sin(2 * Math.PI * freq * (i / sr));
  return p;
};
const mono = (ch: Float32Array, sr = 48000): PcmData => ({ sampleRate: sr, channels: [ch] });
const stereo = (ch: Float32Array, sr = 48000): PcmData => ({ sampleRate: sr, channels: [ch, ch] });

/** 主频估计（spike estimateFrequency 同源：正向过零计数 / 有效信号时长）。
 *  偏离登记：原计划版"双向过零/2 × sr/length"分母含决策 2 契约补零区，
 *  对任何 tempo≠1 输出系统性低估 freq×信号占比（tempo=2 实测 431Hz=440×98%）——
 *  实现经 spike 正向法验证保持 440Hz，故修正度量分母为有效信号长度（1e-4 阈值同 spike 裁剪）。 */
const dominantFreq = (d: Float32Array, sr: number) => {
  let lastNZ = d.length - 1;
  while (lastNZ >= 0 && Math.abs(d[lastNZ]) < 1e-4) lastNZ--;
  const secs = (lastNZ + 1) / sr;
  let z = 0;
  for (let i = 1; i <= lastNZ; i++) if (d[i - 1] < 0 && d[i] >= 0) z++;
  return z / secs;
};
/** 尾部信号窗口最大绝对值（R2 N4：单点采样 |sinθ|<0.1 概率 6.4% 会 flaky——440Hz 周期 109 样本，
 *  任意 200 样本窗口必含峰值区 max≈1；补零区 max=0。零 flake 且锁住"尾部是真实信号非补零"） */
const tailMax = (arr: Float32Array, from: number): number => {
  let m = 0;
  for (let i = from; i < Math.min(arr.length, from + 200); i++) m = Math.max(m, Math.abs(arr[i]));
  return m;
};

describe('stretchPcm（soundtouch 离线变速，spike 定案路线）', () => {
  it('tempo=1 恒等（长度与内容）', () => {
    const input = stereo(sine(48000, 0.5, 440));
    const out = stretchPcm(input, 1);
    expect(out.channels[0].length).toBe(input.channels[0].length);
    expect(out.channels[0]).not.toBe(input.channels[0]); // 拷贝语义：tempo≠1 恒返新数组，tempo=1 同样不别名输入（与 resamplePcm 同采样率零拷贝直返的约定相反——见各自注释）
  });
  it('tempo=2：输出长度=期望值且尾部非静音（G8 假绿修复——长度恒等于 round(len/tempo)，±容差断言恒真无锁力）', () => {
    const input = stereo(sine(48000, 2, 440));
    const out = stretchPcm(input, 2);
    const expected = input.channels[0].length / 2;
    expect(out.channels[0].length).toBe(Math.round(expected)); // 锁决策 2 契约：期望长度截/补
    // spike 实测 2× 输出 0.980s（98%）——93% 位置起的 200 样本窗口必须是真实信号非尾部补零（N4 max-窗口）
    expect(tailMax(out.channels[0], Math.floor(expected * 0.93))).toBeGreaterThan(0.3);
  });
  it('tempo=2：主频保持 440Hz（变速不变调，±2% 容差）', () => {
    const out = stretchPcm(stereo(sine(48000, 2, 440)), 2);
    expect(Math.abs(dominantFreq(out.channels[0], out.sampleRate) - 440) / 440).toBeLessThan(0.02);
  });
  it('tempo=0.5：长度=期望值且尾部非静音（spike 实测 0.5× 输出 97%）且主频保持', () => {
    // 偏离登记：输入 2s——注释引用的"spike 97%"是 2s 输入数据（3.886s/4s）；原计划 1s 输入实测输出
    // 仅 92.6%（soundtouch 固定 WSOLA 延迟在小输入中占比更大），93% 窗口必然落补零区 tailMax=0
    const out = stretchPcm(stereo(sine(48000, 2, 440)), 0.5);
    const expected = 48000 * 4;
    expect(out.channels[0].length).toBe(Math.round(expected));
    expect(tailMax(out.channels[0], Math.floor(expected * 0.93))).toBeGreaterThan(0.3); // N4 max-窗口
    expect(Math.abs(dominantFreq(out.channels[0], out.sampleRate) - 440) / 440).toBeLessThan(0.02);
  });
  it('mono 输入：内部升双声道处理，输出仍单声道', () => {
    const out = stretchPcm(mono(sine(48000, 1, 440)), 2);
    expect(out.channels).toHaveLength(1);
    expect(out.channels[0].length).toBe(24000);
  });
});

describe('resamplePcm（线性插值）', () => {
  it('同采样率直返', () => {
    const input = mono(sine(48000, 0.1, 440));
    const out = resamplePcm(input, 48000);
    expect(out.channels[0]).toBe(input.channels[0]); // 引用直返（零拷贝）
  });
  it('48000→24000：长度减半', () => {
    const out = resamplePcm(mono(sine(48000, 1, 440)), 24000);
    expect(out.channels[0].length).toBe(24000);
    expect(out.sampleRate).toBe(24000);
  });
  it('线性插值精度：[0,1] sr2→4 期望 [0, 0.5, 1, 1]（变异守护——nearest-neighbor 变体必红）', () => {
    const out = resamplePcm({ sampleRate: 2, channels: [new Float32Array([0, 1])] }, 4);
    expect(Array.from(out.channels[0])).toEqual([0, 0.5, 1, 1]);
  });
});
