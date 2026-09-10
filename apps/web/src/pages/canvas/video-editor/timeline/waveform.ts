// apps/web/src/pages/canvas/video-editor/timeline/waveform.ts
/** 最小结构接口——jsdom 无 AudioBuffer，测试造 mock；真数据由 audio-engine（Plan 3）解码供给 */
export interface PeakSource {
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/** 分桶取绝对峰值；峰值按 mediaId 缓存（spec 第五节——不为每片段 new wavesurfer 实例） */
export function peaksFromAudioBuffer(buffer: PeakSource, count: number, channel = 0): number[] {
  if (count <= 0) return [];
  const data = buffer.getChannelData(channel);
  if (data.length === 0) return [];
  const bucket = data.length / count;
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(data.length, Math.floor((i + 1) * bucket));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
  }
  return peaks;
}
