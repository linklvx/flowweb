// apps/api/src/modules/media/media-probe.poller.ts —— Y1a+Y1b T7：probe 单相（worker 进程 DB poller）
// spec Z7''（v13/v14 口径）：claim `probeState IN(pending, running∧lease过期) ∧ status='completed'
// ∧ sniffedMimeType image/video 非 SVG ∧ deletedAt IS NULL`（MIME 路由用 sniffed——伪报 audio 的
// 图片按 sniffed=image 入池）FOR UPDATE SKIP LOCKED+probeRunId CAS。
// 分型批（v10 裁决）：图片批 4/lease 180s+sharp 并发 1（批内串行）；视频 batch 1/lease 5min
// （批 2×90s 覆盖不了下载+ffprobe）；nextProbeAt jitter 指数退避。
// server natural done 同事务：natural 列（EXIF 处理后 display 语义——EXIF 5/6/7/8（90° 系）宽高
// 全交换；rotation 血缘留存不渲染，v5 裁决一律 display）+factVersion+1+MediaFactOutbox
// （factType='natural'，来源=union(Media.projectId, binding.projectId)——spec :288-304）。
// 图片：sharp 40MP+downscale 产品策略+重编码剥 EXIF/polyglot 载荷（spec「图片 sharp 40MP+downscale
// +并发 1+EXIF 5-8」；UI 侧 40MP 上限提示归前端）；视频：ffprobe 15s+SIGKILL+protocol_whitelist，
// metadata 只留 codec/duration/bitrate。
// probe 仅上传路径：唯一入池面=confirm（T4 confirmInTx 按 sniffed 预置 pending）；生成路径
// （materialize/八处 generated create 面）零 enqueue——materialize 复用同一次下载算 natural（T12）。
// 装配=worker.module 平铺 provider（MediaModule 闭包含 controller——census ⑰ 不可导入；
// SafeRemoteFetchService 同款先例）；API 进程不注册（spec 进程拓扑：probe 归 worker）。
// R28 纪律：原生 setInterval+unref（@Cron 全仓未导入——参照 media-registration sweep）。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma, ProbeState, Media } from '@prisma/client';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { Counter, register } from 'prom-client';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { FFMPEG_PROTOCOL_WHITELIST, FFPROBE_TIMEOUT_MS, ffprobePath } from '../media-process/media-process.service';

// ── 分型批参数（v10 裁决——G23 韧性门的机制本体） ──
export const PROBE_POLL_INTERVAL_MS = 10_000;
export const PROBE_IMAGE_BATCH = 4;
export const PROBE_IMAGE_LEASE_MS = 180_000;
export const PROBE_VIDEO_BATCH = 1;
export const PROBE_VIDEO_LEASE_MS = 300_000;
/** 视频下载上界：lease 5min − ffprobe 15s − 收尾余量（批内单视频串行） */
export const PROBE_VIDEO_DOWNLOAD_TIMEOUT_MS = 240_000;
/** 图片像素产品上限（spec「sharp 40MP+downscale」；UI 侧另有上限提示——v7 清单⑥） */
export const MAX_IMAGE_PIXELS = 40_000_000;
/** 瞬态失败重试上界（mismatch/missing 永久类一轮即终——不无限重试） */
export const MAX_PROBE_ATTEMPTS = 5;
/** 退避基数 30s×2^(n-1) 封顶 1h，抖幅 ×[0.5,1.5]（nextProbeAt jitter 指数退避） */
const PROBE_BACKOFF_BASE_MS = 30_000;
const PROBE_BACKOFF_MAX_MS = 3_600_000;

/** ffmpeg/ffprobe 沙箱白名单+ffprobe 超时——单源=media-process.service（T7 沙箱化本体；
 *  poller 侧 re-export 供单测引用，禁再抄第二份字面量。ffprobePath 同源复用——census ㉒
 *  env 键白名单单读点维持（Z79）） */
export { FFMPEG_PROTOCOL_WHITELIST, FFPROBE_TIMEOUT_MS };

/** probe 内部失败分类：permanent=true 一轮即 failed（mismatch=permanent 语义 v10.1） */
class ProbeFailure extends Error {
  constructor(
    readonly kind: string,
    readonly permanent: boolean,
    message: string,
  ) {
    super(message);
  }
}

export function buildFfprobeArgs(inputPath: string): string[] {
  return [
    '-v', 'error',
    '-protocol_whitelist', FFMPEG_PROTOCOL_WHITELIST,
    '-show_entries', 'format=duration,bit_rate:stream=codec_type,codec_name,width,height,side_data_list',
    '-of', 'json',
    '-i', inputPath,
  ];
}

export function computeProbeBackoffMs(attempts: number): number {
  const base = Math.min(PROBE_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), PROBE_BACKOFF_MAX_MS);
  return Math.round(base * (0.5 + Math.random()));
}

/** 观测（spec §5 观测增补：probe_lease_expired_total+失败分类计数；done 按分型） */
const probeLeaseExpiredTotal = new Counter({
  name: 'probe_lease_expired_total',
  help: 'Y1b T7：probe lease 过期接管计数（worker 崩溃残留行的回收面——spec 观测增补）',
  registers: [register],
});
const probeFailTotal = new Counter({
  name: 'probe_fail_total',
  help: 'Y1b T7：probe 失败分类计数（failure_kind=mismatch/missing=permanent；timeout/download/ffprobe/internal=transient）',
  labelNames: ['failure_kind'],
  registers: [register],
});
const probeDoneTotal = new Counter({
  name: 'probe_done_total',
  help: 'Y1b T7：probe 完成计数（mime_family=image/video）',
  labelNames: ['mime_family'],
  registers: [register],
});

/** sharp 可重编码输出格式（同族保持——sniffed 列不漂移；不可编码族（如 bmp）落 webp 并同步 sniffed） */
const SHARP_OUTPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff']);
const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  avif: 'image/avif', gif: 'image/gif', tiff: 'image/tiff',
};

/** EXIF orientation 1-8：5/6/7/8（90° 系）宽高全交换（spec Z5'' display 契约/记忆锚） */
export function displayDims(width: number, height: number, orientation: number): { w: number; h: number } {
  return orientation >= 5 ? { w: height, h: width } : { w: width, h: height };
}

function isNotFound(e: unknown): boolean {
  const err = e as { $metadata?: { httpStatusCode?: number }; name?: string };
  return err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey';
}

@Injectable()
export class MediaProbePoller implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MediaProbePoller.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  onModuleInit(): void {
    const t = setInterval(() => {
      void this.tick().catch((e) => this.logger.warn(`probe tick: ${e}`));
    }, PROBE_POLL_INTERVAL_MS);
    t.unref?.();
    this.timer = t;
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 一轮：图片批（批内串行=sharp 并发 1）→ 视频批（batch 1）。busy 防重入（长视频不叠轮）。 */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const row of await this.claimImageBatch()) await this.probeRow(row);
      for (const row of await this.claimVideoBatch()) await this.probeRow(row);
    } finally {
      this.busy = false;
    }
  }

  async claimImageBatch(): Promise<Media[]> {
    return this.claim('image');
  }

  async claimVideoBatch(): Promise<Media[]> {
    return this.claim('video');
  }

  /** 两段式事务 claim：SELECT ... FOR UPDATE SKIP LOCKED（互斥+_prev 取接管计数）→ 同事务
   *  UPDATE 置 running/runId/lease（行锁保持至 commit——两段间他 worker 不可夺）。 */
  private async claim(family: 'image' | 'video'): Promise<Media[]> {
    const runId = randomUUID();
    const leaseUntil = new Date(Date.now() + (family === 'image' ? PROBE_IMAGE_LEASE_MS : PROBE_VIDEO_LEASE_MS));
    const batch = family === 'image' ? PROBE_IMAGE_BATCH : PROBE_VIDEO_BATCH;
    const mimeCond = family === 'image'
      ? Prisma.sql`("sniffedMimeType" LIKE 'image/%' AND "sniffedMimeType" NOT IN ('image/svg+xml', 'image/svg'))`
      : Prisma.sql`"sniffedMimeType" LIKE 'video/%'`;
    return this.prisma.$transaction(async (tx) => {
      // 时区陷阱（本地/生产实证）：Prisma DateTime 落 PG naive timestamp=UTC 墙钟，而 now() 转 naive
      // 用会话 TimeZone（Asia/Shanghai=+8h）——裸比 now() 恒判"已过期"（lease/退避全失效）。
      // 一律 (now() AT TIME ZONE 'utc') 取 UTC naive 对齐（CI postgres TZ=UTC 时两者等价，兼容双环境）。
      const candidates = await tx.$queryRaw<{ id: string; prev: ProbeState }[]>(Prisma.sql`
        SELECT "id", "probeState" AS "prev" FROM "Media"
        WHERE "status" = 'completed' AND "deletedAt" IS NULL AND ${mimeCond}
          AND (
            ("probeState" = 'pending' AND ("nextProbeAt" IS NULL OR "nextProbeAt" <= (now() AT TIME ZONE 'utc')))
            OR ("probeState" = 'running' AND "probeLeaseUntil" < (now() AT TIME ZONE 'utc'))
          )
        ORDER BY "nextProbeAt" NULLS FIRST, "createdAt" ASC
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED`);
      if (candidates.length === 0) return [];
      const takeovers = candidates.filter((c) => c.prev === 'running').length;
      if (takeovers > 0) probeLeaseExpiredTotal.inc(takeovers);
      const ids = candidates.map((c) => c.id);
      await tx.media.updateMany({
        where: { id: { in: ids } },
        data: { probeState: 'running', probeRunId: runId, probeLeaseUntil: leaseUntil, nextProbeAt: null },
      });
      return tx.media.findMany({ where: { id: { in: ids } } });
    });
  }

  /** 单行 probe：按 sniffed 分派（claim 已过滤——default 分支防御性 permanent）。 */
  async probeRow(row: Media): Promise<void> {
    const sniffed = row.sniffedMimeType ?? '';
    try {
      const result = sniffed.startsWith('image/')
        ? await this.probeImage(row)
        : sniffed.startsWith('video/')
          ? await this.probeVideo(row)
          : (() => { throw new ProbeFailure('unsupported', true, `probe 路由不支持的 sniffed=${sniffed}`); })();
      const ok = await this.doneNatural({ mediaId: row.id, probeRunId: row.probeRunId!, ...result });
      if (ok) probeDoneTotal.inc({ mime_family: sniffed.startsWith('video/') ? 'video' : 'image' });
    } catch (e) {
      const failure = e instanceof ProbeFailure
        ? e
        : new ProbeFailure('internal', false, e instanceof Error ? e.message : String(e));
      probeFailTotal.inc({ failure_kind: failure.kind });
      await this.fail(row, failure);
    }
  }

  /** 图片：sharp 解码（失败=mismatch permanent）→ EXIF 5-8 交换判型 → 超 40MP downscale
   *  → rotate() 自旋+重编码（剥 EXIF/polyglot）→ 回写对象（同 key）→ done。 */
  private async probeImage(row: Media): Promise<Omit<DoneNaturalParams, 'mediaId' | 'probeRunId'>> {
    const buffer = await this.fetchObject(row.key);
    let meta: sharp.Metadata;
    try {
      meta = await sharp(buffer).metadata();
    } catch (e) {
      throw new ProbeFailure('mismatch', true, `sharp 解码失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!meta.width || !meta.height) {
      throw new ProbeFailure('mismatch', true, '图片尺寸不可得（内容非可解码图像）');
    }
    const orientation = typeof meta.orientation === 'number' && meta.orientation >= 1 && meta.orientation <= 8
      ? meta.orientation
      : 1;
    const disp = displayDims(meta.width, meta.height, orientation);

    let pipeline = sharp(buffer).rotate(); // auto-orient（EXIF 旋转落入像素+标签剥离）
    if (disp.w * disp.h > MAX_IMAGE_PIXELS) {
      const scale = Math.sqrt(MAX_IMAGE_PIXELS / (disp.w * disp.h));
      pipeline = pipeline.resize({
        width: Math.max(1, Math.floor(disp.w * scale)),
        height: Math.max(1, Math.floor(disp.h * scale)),
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    const format = SHARP_OUTPUT_FORMATS.has(meta.format ?? '') ? meta.format! : 'webp';
    const out = await pipeline.toFormat(format).toBuffer({ resolveWithObject: true })
      .catch((e: unknown) => {
        throw new ProbeFailure('mismatch', true, `sharp 重编码失败: ${e instanceof Error ? e.message : String(e)}`);
      });
    const mime = MIME_BY_FORMAT[format];
    try {
      await this.minio.upload(row.key, out.data, mime);
    } catch (e) {
      throw new ProbeFailure('upload', false, `对象回写失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    return {
      naturalWidth: out.info.width,     // resolveWithObject=旋转/缩放后真身（display 权威）
      naturalHeight: out.info.height,
      naturalRotation: orientation >= 2 ? orientation : null,
      size: BigInt(out.data.length),
      sniffedMimeType: mime === row.sniffedMimeType ? undefined : mime,   // 不可编码族回写后 sniffed 同步
    };
  }

  /** 视频：getObject 流落盘（超时断流）→ ffprobe（15s+SIGKILL+白名单）→ display 旋转交换
   *  → metadata 只留 codec/duration/bitrate。finally 清理临时目录。 */
  private async probeVideo(row: Media): Promise<Omit<DoneNaturalParams, 'mediaId' | 'probeRunId'>> {
    const dir = await mkdtemp(join(tmpdir(), 'media-probe-'));
    try {
      const inputPath = join(dir, 'input');
      await this.downloadToFile(row.key, inputPath, PROBE_VIDEO_DOWNLOAD_TIMEOUT_MS);
      const stdout = await this.runFfprobe(inputPath);

      let info: FfprobeJson;
      try {
        info = JSON.parse(stdout) as FfprobeJson;
      } catch {
        throw new ProbeFailure('mismatch', true, 'ffprobe 输出不可解析');
      }
      const video = info.streams?.find((s) => s.codec_type === 'video');
      if (!video?.width || !video?.height) {
        throw new ProbeFailure('mismatch', true, '无视频流（内容非可解码视频）');
      }
      let rotation = 0;
      for (const sd of video.side_data_list ?? []) {
        if (typeof sd.rotation === 'number') rotation += sd.rotation;
      }
      const swap = Math.abs(rotation) % 180 === 90;   // displaymatrix 90° 系→display 交换（同 EXIF 5-8 语义）
      const metadata: Record<string, unknown> = {};
      const duration = parseFloat(info.format?.duration ?? '');
      if (Number.isFinite(duration)) metadata.duration = duration;
      const bitrate = parseInt(info.format?.bit_rate ?? '', 10);
      if (Number.isFinite(bitrate)) metadata.bitrate = bitrate;
      if (video.codec_name) metadata.videoCodec = video.codec_name;
      const audio = info.streams?.find((s) => s.codec_type === 'audio');
      if (audio?.codec_name) metadata.audioCodec = audio.codec_name;
      return {
        naturalWidth: swap ? video.height : video.width,
        naturalHeight: swap ? video.width : video.height,
        naturalRotation: rotation !== 0 ? Math.round(((rotation % 360) + 360) % 360) : null,
        metadata,
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async fetchObject(key: string): Promise<Buffer> {
    let stream: NodeJS.ReadableStream & { destroy(): void };
    try {
      stream = await this.minio.getObject(key);
    } catch (e) {
      throw isNotFound(e)
        ? new ProbeFailure('missing', true, `对象不存在 key=${key}`)
        : new ProbeFailure('download', false, `对象读失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    const chunks: Buffer[] = [];
    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (e: Error) => reject(new ProbeFailure('download', false, e.message)));
    });
  }

  private async downloadToFile(key: string, destPath: string, timeoutMs: number): Promise<void> {
    let stream: NodeJS.ReadableStream & { destroy(): void };
    try {
      stream = await this.minio.getObject(key);
    } catch (e) {
      throw isNotFound(e)
        ? new ProbeFailure('missing', true, `对象不存在 key=${key}`)
        : new ProbeFailure('download', false, `对象读失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    const dest = createWriteStream(destPath);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        stream.destroy();
        dest.destroy();
        reject(new ProbeFailure('download', false, `Download timeout (${timeoutMs}ms)`));
      }, timeoutMs);
      stream.on('data', (c: Buffer) => dest.write(c));
      stream.on('end', () => dest.end(() => {
        clearTimeout(timer);
        resolve();
      }));
      stream.on('error', (e: Error) => {
        clearTimeout(timer);
        reject(new ProbeFailure('download', false, e.message));
      });
      dest.on('error', (e: Error) => {
        clearTimeout(timer);
        reject(new ProbeFailure('download', false, e.message));
      });
    });
  }

  /** ffprobe 沙箱：spawn 数组（无 shell）+15s 超时 SIGKILL+protocol_whitelist 前置。 */
  private runFfprobe(inputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(ffprobePath(), buildFfprobeArgs(inputPath), { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new ProbeFailure('timeout', false, `ffprobe timeout (${FFPROBE_TIMEOUT_MS}ms)`));
      }, FFPROBE_TIMEOUT_MS);
      proc.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
      proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new ProbeFailure('mismatch', true, `ffprobe 退出码 ${code}: ${stderr.slice(-200)}`));
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new ProbeFailure('ffprobe', false, `ffprobe 启动失败: ${err.message}`));
      });
    });
  }

  /** done 同事务：probeRunId CAS（lease 易主后旧代 0 行=fenced）+natural 列+factVersion+1
   *  +outbox（来源 union(Media.projectId, binding.projectId)；无项目锚=零行——无消费房间）。 */
  async doneNatural(params: DoneNaturalParams): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.media.updateMany({
        where: { id: params.mediaId, probeRunId: params.probeRunId },
        data: {
          probeState: 'done',
          probeError: null,
          probeFailureKind: null,
          probedAt: new Date(),
          naturalWidth: params.naturalWidth,
          naturalHeight: params.naturalHeight,
          naturalRotation: params.naturalRotation,
          naturalSource: params.naturalSource ?? 'probe',
          ...(params.metadata ? { metadata: params.metadata as Prisma.InputJsonValue } : {}),
          ...(params.size !== undefined ? { size: params.size } : {}),
          ...(params.sniffedMimeType ? { sniffedMimeType: params.sniffedMimeType } : {}),
          factVersion: { increment: 1 },
        },
      });
      if (count !== 1) return false;   // fenced：lease 过期已被新代接管（或行已删）
      const row = await tx.media.findUnique({
        where: { id: params.mediaId },
        select: { factVersion: true, projectId: true },
      });
      if (!row) return false;
      const bindings = await tx.mediaBinding.findMany({
        where: { mediaId: params.mediaId },
        select: { projectId: true },
      });
      const projects = new Set<string>([row.projectId, ...bindings.map((b) => b.projectId)].filter((p): p is string => !!p));
      if (projects.size > 0) {
        await tx.mediaFactOutbox.createMany({
          data: [...projects].map((projectId) => ({
            mediaId: params.mediaId,
            projectId,
            factVersion: row.factVersion,
            factType: 'natural',
            payload: {
              naturalWidth: params.naturalWidth,
              naturalHeight: params.naturalHeight,
              naturalRotation: params.naturalRotation,
              source: 'probe',
            },
          })),
          skipDuplicates: true,   // [mediaId,projectId,factType,factVersion] 四元组唯一（S0.1）
        });
      }
      return true;
    });
  }

  /** 失败：permanent（mismatch/missing）或瞬态耗尽（MAX_PROBE_ATTEMPTS）→ failed 终态；
   *  瞬态 → pending+nextProbeAt jitter 指数退避（热循环红线：非立即重投）。同 probeRunId CAS。 */
  private async fail(row: Media, failure: ProbeFailure): Promise<void> {
    const attempts = row.probeAttempts + 1;
    const terminal = failure.permanent || attempts >= MAX_PROBE_ATTEMPTS;
    await this.prisma.media.updateMany({
      where: { id: row.id, probeRunId: row.probeRunId },
      data: {
        probeAttempts: attempts,
        probeError: failure.message.slice(0, 512),
        probeFailureKind: failure.kind,
        probeState: terminal ? 'failed' : 'pending',
        nextProbeAt: terminal ? null : new Date(Date.now() + computeProbeBackoffMs(attempts)),
      },
    }).catch((e) => this.logger.warn(`probe fail 写回失败 mediaId=${row.id}（下轮 lease 过期自愈）: ${e}`));
  }
}

export interface DoneNaturalParams {
  mediaId: string;
  probeRunId: string;
  naturalWidth: number;
  naturalHeight: number;
  naturalRotation: number | null;
  naturalSource?: string;
  metadata?: Record<string, unknown>;
  size?: bigint;
  sniffedMimeType?: string;
}

interface FfprobeJson {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    side_data_list?: Array<{ rotation?: number }>;
  }>;
  format?: { duration?: string; bit_rate?: string };
}
