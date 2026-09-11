// apps/web/src/pages/canvas/video-editor/export/worker.ts
// 不加 /// <reference lib="webworker" />——apps/web lib 为 ES2022+DOM，混挂 webworker lib 报 TS6200/2374/2403。
// 用 DOM lib：OffscreenCanvas/createImageBitmap/FileSystemFileHandle 均在 DOM lib，
// self 与 onmessage 经 as unknown 强转访问。
// ⚠ DOM lib 声明 OfflineAudioContext/AudioBuffer 只是编译期可见——运行时 Worker 无这些全局
// （Web Audio [Exposed=Window]）——Worker 代码零 Web Audio 依赖。
import { runExport, EXPORT_FPS, type ExportOutput } from './controller';
import { mixdownTimeline, MIX_SAMPLE_RATE, type MixdownPcm } from '../audio-engine/mixdown';
import { decodeMediaPcmRaw } from '../audio-engine/decode';
import { stretchPcm } from '../audio-engine/pcm';
import { VideoCacheService, openMediabunnySink } from '../renderer/video-cache';
import { CanvasRenderer } from '../renderer/canvas-renderer';
import { EXPORT_BITRATES, exportPixelRatio } from './precheck';
import { createEtaTracker } from './eta';
import { canvasSizeOf } from '../timeline/canvas-size';
import { totalDuration } from '../timeline/timecode';
import type { ExportResolution } from '@flowweb/shared';
import type { ProjectData } from '../types';
import type { StreamTargetChunk } from 'mediabunny';

export interface WorkerRunParams {
  data: ProjectData;
  resolution: ExportResolution;
  targetSize: { width: number; height: number }; // computeExportSize 主线程单点求值（取偶短边档位）
  mediaUrls: Record<string, string>;            // mediaId → presigned GET url
  saveFileHandle: FileSystemFileHandle | null;  // FSA 优先，null 回退 BufferTarget
}

type Post = (msg: unknown, transfer?: Transferable[]) => void; // transfer 透传——done 的 buffer 零拷贝转移

/** 环境不支持用显式类型判定（关键词兜底只留给 Worker OOM） */
export class UnsupportedEnvError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsupportedEnvError'; }
}

function classifyError(err: unknown): 'unsupported' | 'memory' | 'unknown' {
  if (err instanceof UnsupportedEnvError) return 'unsupported';
  const msg = String((err as Error)?.message ?? err);
  if (/NotSupportedError|not supported|isConfigSupported/i.test(msg)) return 'unsupported';
  if (/OOM|out of memory|Array buffer allocation failed/.test(msg)) return 'memory';
  return 'unknown';
}

async function runInWorker(params: WorkerRunParams, post: Post): Promise<{ buffer: ArrayBuffer | null; fsa: boolean }> {
  const { data, resolution, targetSize, mediaUrls, saveFileHandle } = params;

  // 合成 canvas：物理像素 = targetSize（computeExportSize 取偶短边档位），逻辑坐标仍按 canvasSizeOf(data) 绘制
  const offscreen = new OffscreenCanvas(targetSize.width, targetSize.height);
  const ctx2d = offscreen.getContext('2d')!;
  const size = canvasSizeOf(data);
  ctx2d.scale(targetSize.width / size.width, targetSize.height / size.height);

  // 视频帧缓存（Worker 独立实例）
  const videoCache = new VideoCacheService({ openSink: openMediabunnySink });

  // 图片/音频 blob 缓存（estimateMemoryBytes 只算 PCM——源文件 blob 峰值另计，Worker terminate 整体回收有界）
  const blobCache = new Map<string, Blob>();
  const getBlob = async (mediaId: string): Promise<Blob | null> => {
    const url = mediaUrls[mediaId];
    if (!url) return null;
    if (!blobCache.has(mediaId)) {
      try { blobCache.set(mediaId, await (await fetch(url)).blob()); } catch { return null; }
    }
    return blobCache.get(mediaId) ?? null;
  };
  const bitmaps = new Map<string, ImageBitmap>();
  const images = {
    getImageBitmap: async (mediaId: string, blob: Blob): Promise<ImageBitmap | null> => {
      if (!bitmaps.has(mediaId)) {
        try { bitmaps.set(mediaId, await createImageBitmap(blob)); } catch { return null; }
      }
      return bitmaps.get(mediaId) ?? null;
    },
  };

  // PCM 解析（mixdown 依赖：blob → decodeMediaPcm → 变速 stretchPcm，按 mediaId:speed 缓存）
  // 缓存仅服务"同 mediaId 多片共享解码"，runExport 返回前整体清空
  const pcmCache = new Map<string, MixdownPcm>();
  const resolvePcm = async (mediaId: string, speed: number): Promise<MixdownPcm | null> => {
    const key = `${mediaId}:${speed}`;
    if (pcmCache.has(key)) return pcmCache.get(key) ?? null;
    const blob = await getBlob(mediaId);
    if (!blob) return null;
    const raw = await decodeMediaPcmRaw(blob, MIX_SAMPLE_RATE);
    if (!raw) return null; // 无音轨
    const pcm = speed === 1 ? raw : stretchPcm(raw, speed);
    pcmCache.set(key, pcm);
    return pcm;
  };

  // mediabunny 写侧装配（懒加载拆包——需 vite.config worker.format:'es'）
  // AAC 守卫（canAac + polyfill 注册 + 复测）下沉至 createOutput 的 hasAudio 分支——
  // 原装配段无条件版在 polyfill 因嵌套子 Worker/CSP 失败时连坐纯视频工程
  const { Output, Mp4OutputFormat, CanvasSource, AudioSampleSource, AudioSample, BufferTarget, StreamTarget, canEncodeAudio } = await import('mediabunny');
  const canAac = () => canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: MIX_SAMPLE_RATE, bitrate: 128_000 }).catch(() => false);

  // createWritable 是 Promise——"能不能写"判定前置 await；失败（句柄失效/权限撤销）→ 回退 BufferTarget
  const fsaWritable = saveFileHandle ? await saveFileHandle.createWritable().catch(() => null) : null;
  let bufferResult: ArrayBuffer | null = null;
  const makeBufferTarget = () => new BufferTarget({ onFinalize: (buffer: ArrayBuffer) => { bufferResult = buffer; } });
  const createOutput = async (opts: { hasAudio: boolean }): Promise<ExportOutput> => {
    // fastStart 显式——FSA 流式路径必须 false（moov 尾置顺序写，内存有界前提）；Buffer 路径默认 auto
    const format = fsaWritable ? new Mp4OutputFormat({ fastStart: false }) : new Mp4OutputFormat();
    let target: InstanceType<typeof BufferTarget> | InstanceType<typeof StreamTarget>;
    if (fsaWritable) {
      // FSA StreamTarget 流式直写（WritableStream<StreamTargetChunk> 适配 FileSystemWritableFileStream）
      const writable = fsaWritable;
      target = new StreamTarget(new WritableStream<StreamTargetChunk>({
        async write(chunk) {
          await writable.write({ type: 'write', position: chunk.position, data: chunk.data });
        },
        async close() { await writable.close(); },
        async abort() { await writable.abort(); },
      }));
    } else {
      target = makeBufferTarget(); // 回退事实经 done.fsa 标记回传主线程择源
    }
    const output = new Output({ format, target });
    const canvasSource = new CanvasSource(offscreen, {
      // 码率按像素量缩放（spec 5.3：21:9 比 16:9 多像素）——exportPixelRatio 含 clamp（窄画布不降码率）
      codec: 'avc', bitrate: Math.round(EXPORT_BITRATES[resolution].video * exportPixelRatio(canvasSizeOf(data), resolution)), keyFrameInterval: 2,
    });
    output.addVideoTrack(canvasSource, { frameRate: EXPORT_FPS });
    let audioSource: InstanceType<typeof AudioSampleSource> | null = null;
    if (opts.hasAudio) {
      // 守卫下沉——只有真要建音轨才检测/注册/失败：
      // Worker 内环境与主线程 detectExportCapabilities 不同（polyfill 依赖子 Worker + WASM + AudioData）——
      // 注册后复测仍 false 必须显式失败（归 unsupported），否则落到 output.start() 才爆成 unknown；
      // 纯视频工程（mixdown null）不走到这里——polyfill 环境性失败不连坐
      if (!(await canAac())) {
        (await import('@mediabunny/aac-encoder')).registerAacEncoder(); // AAC 静默 polyfill
        if (!(await canAac())) throw new UnsupportedEnvError('音频编码不可用（AAC native 与 polyfill 均失败）');
      }
      audioSource = new AudioSampleSource({ codec: 'aac', bitrate: EXPORT_BITRATES[resolution].audio });
    }
    const audioTrack = audioSource ? output.addAudioTrack(audioSource) : null;
    return {
      videoTrack: { add: (t: number, d: number) => canvasSource.add(t, d) },
      // controller 契约是 raw f32——这里交织 L/R 为 interleaved f32、按 ~5s 分块构造 AudioSample 喂源。
      // AudioSampleInit { data, format:'f32'(interleaved), numberOfChannels, sampleRate, timestamp(秒) }；
      // 释放用 close()（AudioSample 无 dispose() 命名方法；[Symbol.dispose]() 是调 close() 的语法糖，
      // ES2022 lib 下其类型依赖 esnext.disposable 不可用）。
      audioTrack: audioTrack ? { add: async (channels: Float32Array[], sampleRate: number) => {
        const [left, right] = channels;
        const framesPerChunk = sampleRate * 5; // 每块 5s（48k×2ch×5s ≈ 1.9MB）控峰值
        for (let start = 0; start < left.length; start += framesPerChunk) {
          const n = Math.min(framesPerChunk, left.length - start);
          const interleaved = new Float32Array(n * 2);
          for (let i = 0; i < n; i++) {
            interleaved[i * 2] = left[start + i];
            interleaved[i * 2 + 1] = right[start + i];
          }
          const sample = new AudioSample({ data: interleaved, format: 'f32', numberOfChannels: 2, sampleRate, timestamp: start / sampleRate });
          try { await audioSource!.add(sample); } finally { sample.close(); }
        }
      } } : null,
      start: () => output.start(),
      finalize: () => output.finalize(),
      cancel: () => output.cancel(),
    };
  };

  const ac = new AbortController(); // worker 内协作取消（真实取消走 terminate，此为 mock 测试同构）
  const totalFrames = Math.round(totalDuration(data) * EXPORT_FPS);
  const eta = createEtaTracker(totalFrames);
  let frameSeen = 0;

  try {
    await runExport(data, resolution, {
      video: videoCache,
      images,
      getMediaUrl: (mediaId) => mediaUrls[mediaId],
      getBlob,
      renderer: new CanvasRenderer(ctx2d as unknown as CanvasRenderingContext2D),
      mixdown: (d, onP) => mixdownTimeline(d, resolvePcm, onP),
      createOutput,
      onProgress: (phase, ratio) => {
        if (phase === 'encode') {
          frameSeen += 1;                 // controller 每帧恰一次 encode 回调
          eta.observe(frameSeen - 1);     // 0-based 帧号
          if (frameSeen % 30 === 0) {
            const e = eta.etaSec();
            if (e != null) post({ type: 'eta', etaSec: e }); // 每 30 帧节流上报
          }
        }
        post({ type: 'progress', phase, ratio });
      },
      signal: ac.signal,
    });
  } finally {
    pcmCache.clear(); // 混音 PCM 用后即弃、错误路径同样回收
    blobCache.clear(); // 源文件 blob 同弃——长工程多素材的堆占用不等到 terminate 才释放
  }

  // fsa 标记随 done 回传——主线程据此择源（FSA 成功读文件 / 回退读 buffer）
  return { buffer: bufferResult, fsa: !!fsaWritable };
}

// DOM lib 下 self 是 Window 类型——onmessage 赋值类型兼容，Worker 运行时 self 为 DedicatedWorkerGlobalScope；
// postMessage 经强转
self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as { type: string; params?: WorkerRunParams };
  if (msg.type !== 'run' || !msg.params) return;
  const post = (m: unknown, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage(m, transfer ?? []);
  try {
    const { buffer, fsa } = await runInWorker(msg.params, post);
    // done 必须带 fsa 标记；buffer 走 transfer list 零拷贝转移——15min 1080p ≈1.6GB 若复制直接顶爆内存
    post({ type: 'done', buffer, fsa }, buffer ? [buffer] : []);
  } catch (err) {
    post({ type: 'error', category: classifyError(err), message: String((err as Error)?.message ?? err) });
  }
};
