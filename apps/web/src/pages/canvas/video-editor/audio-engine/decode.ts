// apps/web/src/pages/canvas/video-editor/audio-engine/decode.ts
import { resamplePcm, type PcmData } from './pcm';

/** 解码媒体 PCM（统一 mediabunny：mp4 内嵌音轨与独立音频同路；vendor resolveAudioBufferForAsset 同款）。
 *  无音轨/失败 → null。输出重采样到 targetRate（AudioBufferSink 输出轨道原生采样率）。 */
export async function decodeMediaPcm(blob: Blob, targetRate: number): Promise<PcmData | null> {
  const { Input, ALL_FORMATS, BlobSource, AudioBufferSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    const sink = new AudioBufferSink(track);
    const chunks: Float32Array[][] = [];
    let len = 0;
    let sampleRate = targetRate;
    let channels = 1;
    for await (const { buffer } of sink.buffers(0)) {
      sampleRate = buffer.sampleRate;
      channels = buffer.numberOfChannels;
      const cs: Float32Array[] = [];
      for (let ch = 0; ch < channels; ch++) cs.push(buffer.getChannelData(ch).slice()); // 池复用防御拷贝
      chunks.push(cs);
      len += cs[0].length;
    }
    if (len === 0) return null;
    const merged: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) {
      const c = new Float32Array(len);
      let off = 0;
      for (const cs of chunks) { c.set(cs[ch], off); off += cs[ch].length; }
      merged.push(c);
    }
    return resamplePcm({ sampleRate, channels: merged }, targetRate);
  } catch {
    return null;
  } finally {
    try { input.dispose(); } catch { /* 已释放——Input.dispose() 返回 void（R2 审核 N1：B1 当时两处只修了 video-cache 一处） */ }
  }
}

/** Worker 安全解码（导出专用）：AudioSampleSink + copyTo('f32-planar')——AudioBufferSink 产出 Web Audio
 *  的 AudioBuffer（[Exposed=Window]，Worker 内 ReferenceError），读侧与写侧（AudioSampleSource）同理不可进 Worker。
 *  主线程预览继续用 decodeMediaPcm（AudioBufferSink 版，喂 Web Audio）。 */
export async function decodeMediaPcmRaw(blob: Blob, targetRate: number): Promise<PcmData | null> {
  const { Input, ALL_FORMATS, BlobSource, AudioSampleSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    const sink = new AudioSampleSink(track);
    const chunks: Float32Array[][] = [];
    let len = 0;
    let sampleRate = targetRate;
    let channels = 1;
    for await (const s of sink.samples(0)) {
      try {
        sampleRate = s.sampleRate;
        channels = s.numberOfChannels;
        const cs: Float32Array[] = [];
        for (let ch = 0; ch < channels; ch++) {
          const dst = new Float32Array(s.numberOfFrames);
          s.copyTo(dst, { planeIndex: ch, format: 'f32-planar' });
          cs.push(dst);
        }
        chunks.push(cs);
        len += cs[0].length;
      } finally {
        s.close(); // AudioSample 用后即弃（与写侧 add 后 close 同源纪律）
      }
    }
    if (len === 0) return null;
    const merged: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) {
      const c = new Float32Array(len);
      let off = 0;
      for (const cs of chunks) { c.set(cs[ch], off); off += cs[ch].length; }
      merged.push(c);
    }
    return resamplePcm({ sampleRate, channels: merged }, targetRate);
  } catch {
    return null;
  } finally {
    try { input.dispose(); } catch { /* 已释放 */ }
  }
}
