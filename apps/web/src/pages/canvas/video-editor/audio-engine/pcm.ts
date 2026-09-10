// apps/web/src/pages/canvas/video-editor/audio-engine/pcm.ts
import { SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs';

export interface PcmData { sampleRate: number; channels: Float32Array[]; }

/** 线性插值重采样（vendor retime/audio-stretch.ts buildResampledBuffer 形状，纯函数） */
export function resamplePcm(input: PcmData, targetRate: number): PcmData {
  if (input.sampleRate === targetRate) return input;
  const srcLen = input.channels[0].length;
  const ratio = input.sampleRate / targetRate;
  const outLen = Math.floor(srcLen / ratio);
  return {
    sampleRate: targetRate,
    channels: input.channels.map(c => {
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(srcLen - 1, i0 + 1);
        const f = pos - i0;
        out[i] = c[i0] * (1 - f) + c[i1] * f;
      }
      return out;
    }),
  };
}

/** soundtouch 尾部冲刷缓冲（spike 陷阱：source 抽干后不足 16384 帧的尾部输入被丢弃） */
const FLUSH_FRAMES = 16384;
const EXTRACT_CHUNK = 4096;

/** 离线变速不变调（spike 定案：SoundTouch + SimpleFilter 手动 extract）。
 *  mono 输入内部升双声道、输出还原单声道；输出按期望长度 round(len/tempo) 截/补
 *  （决策 2：比"最后非零扫描"确定，soundtouch 处理延迟差 ~2% 表现为尾部几十 ms 静音）。 */
export function stretchPcm(input: PcmData, tempo: number): PcmData {
  if (tempo === 1) return { sampleRate: input.sampleRate, channels: input.channels.map(c => c.slice()) };
  const wasMono = input.channels.length === 1;
  const src = wasMono ? [input.channels[0], input.channels[0]] : input.channels;
  const srcLen = src[0].length;
  const padded = src.map(c => {
    const p = new Float32Array(srcLen + FLUSH_FRAMES);
    p.set(c);
    return p;
  });
  const fakeBuffer = {
    sampleRate: input.sampleRate,
    numberOfChannels: 2,
    getChannelData: (i: number) => padded[i],
    duration: padded[0].length / input.sampleRate,
  } as unknown as AudioBuffer;
  const st = new SoundTouch(); // 实测构造无参——库不消费 sampleRate：Stretch 内部硬编码 44100 计算窗参（48k 下窗时长约短 8%，仅影响 WSOLA 窗长最优性，不影响变速比与音高——审查登记）
  st.tempo = tempo;
  const filter = new SimpleFilter(new WebAudioBufferSource(fakeBuffer), st);
  const inter = new Float32Array(EXTRACT_CHUNK * 2);
  const chunks: Float32Array[] = [];
  let totalFrames = 0;
  for (;;) {
    const n = filter.extract(inter, EXTRACT_CHUNK); // n = 帧数（每帧双声道交错 2 样本）
    if (n === 0) break;
    chunks.push(inter.slice(0, n * 2));
    totalFrames += n;
  }
  const outInter = new Float32Array(totalFrames * 2);
  let off = 0;
  for (const c of chunks) { outInter.set(c, off); off += c.length; }
  const expectedFrames = Math.round(srcLen / tempo); // 期望长度截/补
  const outChannels: Float32Array[] = [];
  const count = wasMono ? 1 : 2;
  for (let ch = 0; ch < count; ch++) {
    const out = new Float32Array(expectedFrames);
    for (let i = 0; i < expectedFrames; i++) {
      out[i] = i * 2 + ch < outInter.length ? outInter[i * 2 + ch] : 0;
    }
    outChannels.push(out);
  }
  return { sampleRate: input.sampleRate, channels: outChannels };
}
