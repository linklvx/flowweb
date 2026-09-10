import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Job } from 'bullmq';
import { ThumbnailGeneratorConsumer } from './thumbnail-generator.consumer';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import ffmpeg from 'fluent-ffmpeg';

vi.mock('fluent-ffmpeg', () => {
  const command = {
    screenshots: vi.fn().mockReturnThis(),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'end') setImmediate(cb);
      return command;
    }),
  };
  return { default: vi.fn(() => command) };
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
});
