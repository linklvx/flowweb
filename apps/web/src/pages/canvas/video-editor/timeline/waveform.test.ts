// apps/web/src/pages/canvas/video-editor/timeline/waveform.test.ts
import { describe, it, expect } from 'vitest';
import { peaksFromAudioBuffer, type PeakSource } from './waveform';

const mockBuffer = (samples: Float32Array, sampleRate = 48000): PeakSource => ({
  sampleRate, length: samples.length, getChannelData: () => samples,
});

describe('peaksFromAudioBuffer（从 AudioBuffer 抽固定数量峰值——useWaveformPeaks 解耦纯函数化）', () => {
  it('正弦波峰值接近 1', () => {
    const sr = 48000;
    const pcm = new Float32Array(sr); // 1 秒 440Hz
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 440 * (i / sr));
    const peaks = peaksFromAudioBuffer(mockBuffer(pcm), 50);
    expect(peaks).toHaveLength(50);
    for (const p of peaks) expect(p).toBeGreaterThan(0.9); // 每桶含完整周期
  });
  it('静音全 0', () => {
    const peaks = peaksFromAudioBuffer(mockBuffer(new Float32Array(4800)), 10);
    expect(peaks.every(p => p === 0)).toBe(true);
  });
  it('count 桶均分全长', () => {
    const pcm = new Float32Array(1000).fill(0.5);
    const peaks = peaksFromAudioBuffer(mockBuffer(pcm), 4);
    expect(peaks).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
  it('空数据返回 []', () => {
    expect(peaksFromAudioBuffer(mockBuffer(new Float32Array(0)), 10)).toEqual([]);
  });
});
