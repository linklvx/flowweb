import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAudioPeaks } from './useAudioPeaks';
import { peaksFromAudioBuffer } from '../timeline/waveform';

vi.mock('../audio-engine/decode', () => ({
  decodeMediaPcm: vi.fn(async () => null),
}));
// 偏离登记：getMediaBlob 真实现会 fetch('http://u...')，jsdom 下失败 → blob null → 早退 peaks 恒 null，
// 计划测试漏 mock 该依赖——最小补 mock 挡网络层，测试语义（解码→peaks→缓存）不变。
vi.mock('../renderer/media-blob', () => ({
  getMediaBlob: vi.fn(async () => new Blob()),
}));
import { decodeMediaPcm } from '../audio-engine/decode';

const pcm = { sampleRate: 48000, channels: [new Float32Array(48000).fill(0.5)] };

describe('useAudioPeaks（mediaId 缓存——模块级 Map 跨用例存活，故各用例用不同 mediaId 隔离）', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('解码 → peaksFromAudioBuffer 结果缓存（二次挂载不重解码）', async () => {
    vi.mocked(decodeMediaPcm).mockResolvedValue(pcm as never);
    const { result: r1 } = renderHook(() => useAudioPeaks('m1', 'http://u1'));
    await waitFor(() => expect(r1.current).not.toBeNull());
    expect(r1.current).toHaveLength(200);
    expect(decodeMediaPcm).toHaveBeenCalledTimes(1);
    const { result: r2 } = renderHook(() => useAudioPeaks('m1', 'http://u1'));
    await waitFor(() => expect(r2.current).not.toBeNull());
    expect(decodeMediaPcm).toHaveBeenCalledTimes(1); // 命中模块级缓存
  });
  it('无 url / 解码失败 → null 不炸', async () => {
    const { result } = renderHook(() => useAudioPeaks('m9a', undefined));
    expect(result.current).toBeNull();
    vi.mocked(decodeMediaPcm).mockResolvedValue(null);
    const { result: r2 } = renderHook(() => useAudioPeaks('m9b', 'http://u2'));
    await waitFor(() => expect(r2.current).toBeNull());
  });
});
