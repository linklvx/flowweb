// apps/web/src/pages/canvas/video-editor/audio-engine/engine.ts
import type { ProjectData } from '../types';
import { decodeMediaPcm } from './decode';
import { stretchPcm, type PcmData } from './pcm';
import { buildGainPoints, gainValueAt } from './gain';

// ---- Web Audio 结构类型（实时/离线/测试 fake 共用，不依赖具体实现）----
export interface AudioParamLike {
  value: number;
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  cancelScheduledValues(t: number): void;
}
export interface GainNodeLike { gain: AudioParamLike; connect(node: unknown): unknown; disconnect(): void; }
export interface BufferSourceLike {
  buffer: unknown;
  connect(node: unknown): unknown;
  start(when?: number, offset?: number, duration?: number): void;
  stop(t?: number): void;
  onended: (() => void) | null;
}
export interface AudioBufferLike {
  numberOfChannels: number; length: number; sampleRate: number;
  getChannelData(channel: number): Float32Array;
}
export interface AudioContextLike {
  currentTime: number; sampleRate: number; state: string;
  destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): BufferSourceLike;
  createGain(): GainNodeLike;
  resume(): Promise<void>; suspend(): Promise<void>;
}

export type ClockMode = 'ctx' | 'perf';

interface TimeBase { mode: ClockMode; baseMedia: number; baseReal: number; }

export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private masterVolume = 1;
  private sources: BufferSourceLike[] = [];
  /** A1 单份驻留（R2）：只存 AudioBuffer——prepare 解码+变速后立即转换，PcmData 局部变量即弃。
   *  双份常驻（PcmData + AudioBuffer）按 spec 口径 345.6MB/轨 ×2 = 690MB/轨不可接受。 */
  private bufferCache = new Map<string, AudioBufferLike>();
  private timeBase: TimeBase | null = null;
  private clockMode: ClockMode = 'ctx';

  constructor(private readonly deps: { ctxFactory?: () => AudioContextLike } = {}) {}

  /** 惰性创建（必须在用户手势调用链内首次触发）；测试经 ctxFactory 注入 */
  getContext(): AudioContextLike {
    if (!this.ctx) {
      this.ctx = this.deps.ctxFactory
        ? this.deps.ctxFactory()
        : new AudioContext() as unknown as AudioContextLike;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVolume;
      this.master.connect(this.ctx.destination);
      void this.ctx.resume();
    }
    return this.ctx;
  }
  getContextCreated(): boolean { return this.ctx !== null; }

  setClockMode(mode: ClockMode): void { this.clockMode = mode; }

  /** 主时钟（决策 8 单一真相）：ctx 模式锚 ctx.currentTime；perf 模式锚 performance.now（无 PCM 不空转 ctx） */
  now(): number {
    if (!this.timeBase) return 0;
    const real = this.timeBase.mode === 'ctx' ? this.ctx!.currentTime : performance.now() / 1000;
    return this.timeBase.baseMedia + (real - this.timeBase.baseReal);
  }

  /** 命名历史沿用（R3 五-4 登记）：实现已是 AudioBuffer 单份驻留（A1）——语义即 hasAudioBuffer/releaseAudioBuffers。
   *  Plan 4 导出路径消费时注意：此处查/清的是 AudioBuffer 缓存，PcmData 在 prepare 后即弃。 */
  hasPcm(key?: string): boolean { return key ? this.bufferCache.has(key) : this.bufferCache.size > 0; }
  releasePcm(): void { this.bufferCache.clear(); }

  /** 播放前预处理：按 (mediaId:speed) 解码 + soundtouch 变速 → **立即转 AudioBuffer 单份驻留**（决策 3 + A1） */
  async prepare(data: ProjectData, getBlob: (mediaId: string) => Promise<Blob | null>): Promise<void> {
    const needed = new Set<string>();
    for (const c of Object.values(data.clips)) {
      if (c.type === 'video' || c.type === 'audio') needed.add(`${c.mediaId}:${c.playbackSpeed}`);
    }
    if (needed.size === 0) { this.setClockMode('perf'); return; }
    const ctx = this.getContext(); // 手势链路内创建
    const targetRate = ctx.sampleRate;
    for (const key of needed) {
      if (this.bufferCache.has(key)) continue;
      const sep = key.lastIndexOf(':');
      const mediaId = key.slice(0, sep);
      const speed = Number(key.slice(sep + 1));
      const blob = await getBlob(mediaId);
      if (!blob) continue;
      const raw = await decodeMediaPcm(blob, targetRate);
      if (!raw) continue; // 无音轨（纯视频/图片）
      const pcm = speed === 1 ? raw : stretchPcm(raw, speed);
      this.bufferCache.set(key, this.toBuffer(ctx, pcm)); // A1：PcmData 即弃，只留 AudioBuffer
    }
    this.setClockMode(this.hasPcm() ? 'ctx' : 'perf');
  }

  /** 播放/seek 统一入口：stop 旧 source → resume（G2：suspend 后二次打开 currentTime 冻结修复）→ 锚定时钟 → 全量调度（决策 6：一次性调度替代 lookahead + G4 AudioBuffer 复用） */
  playFrom(data: ProjectData, from: number): void {
    this.stopSources();
    if (this.ctx) this.resumeCtx(); // G2：ctx 已存在时 getContext 不会 resume，必须显式恢复
    const real = this.clockMode === 'ctx' ? this.getContext().currentTime : performance.now() / 1000;
    this.timeBase = { mode: this.clockMode, baseMedia: from, baseReal: real };
    if (this.clockMode === 'perf') return; // 无音频：只锚时钟
    const ctx = this.getContext();
    const ctxNow = ctx.currentTime;
    for (const tr of data.tracks) {
      for (const cid of tr.clips) {
        const clip = data.clips[cid] as ProjectData['clips'][string];
        if (!clip || (clip.type !== 'video' && clip.type !== 'audio')) continue;
        const clipEnd = clip.start + clip.duration;
        if (clipEnd <= from) continue;
        const key = `${clip.mediaId}:${clip.playbackSpeed}`;
        const buffer = this.bufferCache.get(key);
        if (!buffer) continue;
        const src = ctx.createBufferSource();
        src.buffer = buffer; // A1：prepare 已建好，playFrom 零复制（G4）
        const gain = ctx.createGain();
        src.connect(gain);
        gain.connect(this.master!);
        const when = clip.start > from ? ctxNow + (clip.start - from) : ctxNow;
        const consumed = Math.max(0, from - clip.start) * clip.playbackSpeed;
        const offset = (clip.sourceStart + consumed) / clip.playbackSpeed; // stretched 坐标 = 原坐标/speed（决策 3）
        const duration = clip.duration - Math.max(0, from - clip.start);
        this.applyGain(gain.gain, buildGainPoints(data, cid), clip.start, from, ctxNow);
        src.start(when, offset, duration);
        this.sources.push(src);
      }
    }
  }

  private applyGain(param: AudioParamLike, points: { t: number; value: number }[], clipStart: number, from: number, ctxNow: number): void {
    param.cancelScheduledValues(0);
    if (points.length === 0) return;
    param.setValueAtTime(gainValueAt(points, from - clipStart), ctxNow); // from 处插值锚点
    for (const p of points) {
      const abs = clipStart + p.t;
      if (abs <= from) continue;
      param.linearRampToValueAtTime(p.value, ctxNow + (abs - from));
    }
  }

  /** PcmData → AudioBuffer 一次性转换（A1：转换后 PcmData 由调用方丢弃，单份驻留） */
  private toBuffer(ctx: AudioContextLike, pcm: PcmData): AudioBufferLike {
    const buf = ctx.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate);
    for (let ch = 0; ch < pcm.channels.length; ch++) buf.getChannelData(ch).set(pcm.channels[ch]);
    return buf;
  }

  private stopSources(): void {
    for (const s of this.sources) { try { s.stop(); } catch { /* 已结束 */ } }
    this.sources = [];
  }

  stop(): void { this.stopSources(); this.timeBase = null; }
  suspend(): void { void this.ctx?.suspend(); }
  resumeCtx(): void { if (this.ctx) void this.ctx.resume(); }
  setMasterVolume(v: number): void {
    this.masterVolume = v;
    if (this.master) this.master.gain.value = v;
  }
  getMasterVolume(): number { return this.masterVolume; }
}

/** 全局单例（决策 7：实例数恒 1，suspend/resume 不 close——AudioContext 上限约 6 的物理保障） */
export const audioEngine = new AudioEngine();
