import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'reflect-metadata';
import type { Mock } from 'vitest';
import type { Job } from 'bullmq';
import { ThumbnailGeneratorConsumer } from './thumbnail-generator.consumer';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import ffmpeg from 'fluent-ffmpeg';

vi.mock('fluent-ffmpeg', () => {
  // autoEnd：默认 on('end') 即触发（既有 seekSec 用例语义）；T7 超时用例关断走 kill+error 路径
  let autoEnd = true;
  const command = {
    inputOptions: vi.fn().mockReturnThis(),
    screenshots: vi.fn().mockReturnThis(),
    kill: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'end' && autoEnd) setImmediate(cb);
      return command;
    }),
  };
  return {
    default: vi.fn(() => command),
    __setAutoEnd: (v: boolean) => { autoEnd = v; },
  };
});

vi.mock('sharp', () => {
  const toBuffer = vi.fn().mockResolvedValue(Buffer.from('webp'));
  const webp = vi.fn(() => ({ toBuffer }));
  return { default: vi.fn(() => ({ webp })) };
});

vi.mock('fs', async () => {
  const { EventEmitter } = await import('events');
  return {
    createWriteStream: vi.fn(() => {
      const ws = new EventEmitter();
      setImmediate(() => ws.emit('finish'));
      return ws;
    }),
    readFileSync: vi.fn(() => Buffer.from('jpeg')),
  };
});

vi.mock('tmp', () => {
  const fileSync = vi.fn((opts: { postfix: string }) => ({ name: `/tmp/fake${opts.postfix}` }));
  return {
    default: { setGracefulCleanup: vi.fn(), fileSync },
    setGracefulCleanup: vi.fn(),
    fileSync,
  };
});

type ThumbnailJobData = { mediaId: string; key: string; mimeType: string; seekSec?: number };

describe('ThumbnailGeneratorConsumer', () => {
  let consumer: ThumbnailGeneratorConsumer;
  let prisma: { media: { update: ReturnType<typeof vi.fn> } };
  let minio: { getObject: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn> };

  const ffmpegCommand = () => {
    const mock = ffmpeg as unknown as Mock;
    return mock.mock.results[0]?.value as { screenshots: Mock };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = { media: { update: vi.fn().mockResolvedValue({}) } };
    minio = {
      getObject: vi.fn().mockResolvedValue({ pipe: vi.fn() }),
      upload: vi.fn().mockResolvedValue(undefined),
    };
    consumer = new ThumbnailGeneratorConsumer(
      prisma as unknown as PrismaService,
      minio as unknown as MinioService,
    );
  });

  it('job 带 seekSec: 3 → ffmpeg 抽帧时间点为 3（视频剪辑器导出产物防前导黑场）', async () => {
    const job = {
      data: { mediaId: 'm-1', key: 'gen/m-1.mp4', mimeType: 'video/mp4', seekSec: 3 },
    } as unknown as Job<ThumbnailJobData>;

    await consumer.process(job);

    expect(ffmpegCommand().screenshots).toHaveBeenCalledWith(
      expect.objectContaining({ timestamps: [3] }),
    );
  });

  it('job 不带 seekSec → 抽帧时间点保持默认 1（素材上传路径回归保护）', async () => {
    const job = {
      data: { mediaId: 'm-2', key: 'uploads/m-2.mp4', mimeType: 'video/mp4' },
    } as unknown as Job<ThumbnailJobData>;

    await consumer.process(job);

    expect(ffmpegCommand().screenshots).toHaveBeenCalledWith(
      expect.objectContaining({ timestamps: [1] }),
    );
  });

  // Y1a+Y1b T7（spec Z7''）：thumbnail ffmpeg 消费面沙箱化——inputOptions 注入 -protocol_whitelist
  // +超时 SIGKILL（现状两者皆无=红；fluent-ffmpeg 非裸 spawn 但同批改）。
  it('T7 沙箱①：视频截图命令注入 -protocol_whitelist file,http,https,tcp,tls（红：现状无白名单）', async () => {
    const job = {
      data: { mediaId: 'm-3', key: 'uploads/m-3.mp4', mimeType: 'video/mp4' },
    } as unknown as Job<ThumbnailJobData>;
    await consumer.process(job);
    const cmd = ffmpegCommand() as unknown as { inputOptions: Mock };
    expect(cmd.inputOptions).toHaveBeenCalledWith(['-protocol_whitelist', 'file,http,https,tcp,tls']);
  });

  it('T7 沙箱②：截图命令 60s 无 end/error → SIGKILL（红：现状挂死占队列并发槽）', async () => {
    const ffmock = await import('fluent-ffmpeg') as unknown as { __setAutoEnd: (v: boolean) => void };
    ffmock.__setAutoEnd(false);
    // shouldAdvanceTime：真微步推进（getObject→pipe→writeStream finish 的 setImmediate 链真实走完）
    // ——纯 fake timers 定长 flush 循环在并行负载下偶发饿死（verify 全量实测）；waitFor 到命令构造即稳。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const job = {
        data: { mediaId: 'm-4', key: 'uploads/m-4.mp4', mimeType: 'video/mp4' },
      } as unknown as Job<ThumbnailJobData>;
      const ret = consumer.process(job).catch(() => 'rejected');
      await vi.waitFor(
        () => expect((ffmpeg as unknown as Mock).mock.calls.length).toBeGreaterThan(0),
        { timeout: 5_000, interval: 10 },
      );
      await vi.advanceTimersByTimeAsync(60_000);
      const cmd = ffmpegCommand() as unknown as { kill: Mock; on: Mock };
      expect(cmd.kill).toHaveBeenCalledWith('SIGKILL');
      // kill 后 fluent-ffmpeg 发 error——手动触发收口（process 上抛由 catch 捕获）
      const onError = (cmd.on.mock.calls as unknown as Array<[string, () => void]>)
        .find(([e]) => e === 'error')?.[1];
      onError?.();
      expect(await ret).toBe('rejected');
    } finally {
      vi.useRealTimers();
      ffmock.__setAutoEnd(true);
    }
  });
});

// Y0c T30（Z146 v4 事实更正）：BullMQ 默认并发 1 是保守界非「无上界」——显式登记参数 1 防漂移
// （stitch.consumer:28 显式 concurrency:2 同款形态）。断言=@Processor 第二参 WORKER_METADATA
// 元数据直读（'bullmq:worker_metadata'——bull-metadata.accessor.js:28 消费）。
describe('Y0c T30 并发上界（Z146）', () => {
  it('@Processor worker options 显式 concurrency:1（默认值显式登记防漂移）', () => {
    expect(Reflect.getMetadata('bullmq:worker_metadata', ThumbnailGeneratorConsumer))
      .toMatchObject({ concurrency: 1 });
  });
});
