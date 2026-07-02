import { Test, TestingModule } from '@nestjs/testing';
import { MediaProcessService } from './media-process.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { spawn } from 'child_process';
import { mkdir, rm } from 'fs/promises';
import * as path from 'path';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('mock-data')),
  writeFile: vi.fn(),
}));

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

function mockSpawnProc(stdout: string, exitCode = 0): EventEmitter {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  process.nextTick(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', exitCode);
  });
  return proc;
}

describe('MediaProcessService', () => {
  let service: MediaProcessService;
  let mockPrisma: any;
  let mockMinio: any;

  beforeEach(async () => {
    mockPrisma = { media: { create: vi.fn() } };
    mockMinio = {
      buildKey: vi.fn().mockReturnValue('generated/user123/video.mp4'),
      upload: vi.fn().mockResolvedValue(undefined),
    };
    mockSpawn.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaProcessService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MinioService, useValue: mockMinio },
      ],
    }).compile();

    service = module.get<MediaProcessService>(MediaProcessService);
  });

  describe('detectAudio', () => {
    it('should return true when audio track exists', async () => {
      mockSpawn.mockReturnValue(mockSpawnProc('audio\n', 0));
      const result = await service.detectAudio('/tmp/test.mp4');
      expect(result).toBe(true);
    });

    it('should return false when no audio track', async () => {
      mockSpawn.mockReturnValue(mockSpawnProc('', 0));
      const result = await service.detectAudio('/tmp/test.mp4');
      expect(result).toBe(false);
    });

    it('should return false on ffprobe error', async () => {
      mockSpawn.mockReturnValue(mockSpawnProc('', 1));
      const result = await service.detectAudio('/tmp/test.mp4');
      expect(result).toBe(false);
    });
  });

  describe('detectAudioCodec', () => {
    it('should extract AAC codec', async () => {
      mockSpawn.mockReturnValue(mockSpawnProc('aac\n', 0));
      const result = await service.detectAudioCodec('/tmp/test.mp4');
      expect(result).toBe('aac');
    });

    it('should return null on ffprobe error', async () => {
      mockSpawn.mockReturnValue(mockSpawnProc('', 1));
      const result = await service.detectAudioCodec('/tmp/test.mp4');
      expect(result).toBeNull();
    });
  });

  describe('detectDuration', () => {
    it('should parse float duration', async () => {
      mockSpawn.mockReturnValue(mockSpawnProc('120.5\n', 0));
      const result = await service.detectDuration('/tmp/test.mp4');
      expect(result).toBe(120.5);
    });
  });

  describe('detectMetadata', () => {
    it('should return full metadata object', async () => {
      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        const stdoutValues = ['60.0\n', '1920,1080,h264,5000\n', 'aac,192\n'];
        const idx = callCount - 1;
        return mockSpawnProc(stdoutValues[idx] || '', 0);
      });
      const result = await service.detectMetadata('/tmp/test.mp4');
      expect(result.duration).toBe(60);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.audioCodec).toBe('aac');
      expect(callCount).toBe(3);
    });
  });

  describe('runFfmpeg', () => {
    it('should resolve on exit code 0', async () => {
      const mockProc = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: Function) => {
          if (event === 'close') cb(0);
        }),
      };
      mockSpawn.mockReturnValue(mockProc);

      await expect(service.runFfmpeg(['-i', 'in.mp4', '-an', '-c:v', 'copy', 'out.mp4']))
        .resolves.toBeUndefined();
    });

    it('should reject on non-zero exit code', async () => {
      const mockProc = {
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: Function) => {
          if (event === 'close') cb(1);
        }),
      };
      mockSpawn.mockReturnValue(mockProc);

      await expect(service.runFfmpeg(['-i', 'in.mp4', '-c:v', 'copy', 'out.mp4']))
        .rejects.toThrow('FFmpeg exited with code 1');
    });
  });

  describe('uploadAndCreateMedia', () => {
    it('should upload and create Media record with sourceFileId/bizType in metadata', async () => {
      mockMinio.upload.mockResolvedValue(undefined);
      mockPrisma.media.create.mockResolvedValue({
        id: 'media-123',
        userId: 'user1',
        key: 'generated/user123/video.mp4',
        originalName: 'test_无音频.mp4',
        mimeType: 'video/mp4',
        size: 1024,
        projectId: 'proj1',
        nodeId: 'node1',
        type: 'generated',
        status: 'completed',
      });

      const result = await service.uploadAndCreateMedia({
        filePath: '/tmp/output.mp4',
        userId: 'user1',
        projectId: 'proj1',
        nodeId: 'node1',
        originalName: 'test_无音频.mp4',
        mimeType: 'video/mp4',
        sourceFileId: 'src-1',
        bizType: 'video_separate',
        metadata: { duration: 10.5, width: 1920, height: 1080 },
      });

      expect(mockMinio.upload).toHaveBeenCalled();
      expect(mockPrisma.media.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              sourceFileId: 'src-1',
              bizType: 'video_separate',
              duration: 10.5,
              width: 1920,
              height: 1080,
            }),
          }),
        }),
      );
      expect(result.id).toBe('media-123');
    });

    it('should prevent external metadata from overwriting sourceFileId/bizType', async () => {
      mockMinio.upload.mockResolvedValue(undefined);
      mockPrisma.media.create.mockResolvedValue({ id: 'media-456' });

      await service.uploadAndCreateMedia({
        filePath: '/tmp/output.mp4',
        userId: 'user1',
        projectId: 'proj1',
        nodeId: 'node1',
        originalName: 'test.mp4',
        mimeType: 'video/mp4',
        sourceFileId: 'system-src-id',
        bizType: 'system-biz-type',
        // 外部 metadata 尝试覆盖 sourceFileId/bizType
        metadata: { sourceFileId: 'malicious', bizType: 'overwrite', duration: 10 },
      });

      expect(mockPrisma.media.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              sourceFileId: 'system-src-id',   // 系统值胜出
              bizType: 'system-biz-type',       // 系统值胜出
              duration: 10,
            }),
          }),
        }),
      );
    });
  });

  describe('cleanupTempDir', () => {
    it('should call rm with recursive and force', async () => {
      await service.cleanupTempDir('task123', '/tmp/video-separate/');
      expect(rm).toHaveBeenCalledWith(path.join('/tmp/video-separate/', 'task123'), { recursive: true, force: true });
    });
  });

  describe('downloadWithRetry', () => {
    it('should retry once on first failure then succeed', async () => {
      let attempts = 0;
      const mockDownload = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) throw new Error('ECONNRESET');
        return Promise.resolve();
      });
      // We test the retry logic by spying on the internal downloadFile
      await service.downloadWithRetry('http://example.com/file.mp4', '/tmp/file.mp4', {
        timeoutMs: 1000,
        retries: 1,
        downloadFn: mockDownload,
      });
      expect(mockDownload).toHaveBeenCalledTimes(2);
    });
  });
});
