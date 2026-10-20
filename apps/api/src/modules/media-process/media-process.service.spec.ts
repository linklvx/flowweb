import { Test, TestingModule } from '@nestjs/testing';
import { MediaProcessService } from './media-process.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { spawn } from 'child_process';
import { mkdir, rm } from 'fs/promises';
import * as path from 'path';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { createWriteStream } from 'fs';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('mock-data')),
  writeFile: vi.fn(),
}));
vi.mock('fs', () => ({ createWriteStream: vi.fn() }));

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;
const mockCreateWriteStream = createWriteStream as unknown as ReturnType<typeof vi.fn>;

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

/** 永不 close 的进程（timeout kill 断言用）——kill 为 spy */
function mockSpawnHanging(): any {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

/** createWriteStream 替身：收 writes/end/destroy（事件面与真流一致） */
function mockWritable() {
  const w = new EventEmitter() as any;
  w.writes = [] as Buffer[];
  w.write = vi.fn((c: Buffer) => { w.writes.push(c); });
  w.end = vi.fn((cb?: () => void) => { cb?.(); });
  w.destroy = vi.fn();
  return w;
}

describe('MediaProcessService', () => {
  let service: MediaProcessService;
  let mockPrisma: any;
  let mockMinio: any;

  beforeEach(async () => {
    mockPrisma = {
      media: { create: vi.fn() },
      canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 'team1' }) },
      team: { findFirst: vi.fn().mockResolvedValue({ id: 'team1' }) },
    };
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

    // Y0c T34（Z79/RC3）：FFMPEG_PATH/FFPROBE_PATH 惰性化——模块级 const（import 期冻结=Z79 违规面）
    // 改调用期读函数（video-trim.constants 同款；消费点 spawn 实参同批改道）。
    it('T34：stubEnv FFPROBE_PATH ⇒ spawn 用新路径（旧实现=冻结默认 ffprobe ⇒ 红）', async () => {
      mockSpawn.mockReturnValue(mockSpawnProc('audio\n', 0));
      vi.stubEnv('FFPROBE_PATH', '/opt/custom/ffprobe');
      try {
        await service.detectAudio('/tmp/test.mp4');
        expect(mockSpawn.mock.calls[0][0]).toBe('/opt/custom/ffprobe');
      } finally {
        vi.unstubAllEnvs();
      }
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
        on: vi.fn((event: string, cb: (code: number) => void) => {
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
        on: vi.fn((event: string, cb: (code: number) => void) => {
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

    it('有 project 上下文：teamId = project.teamId（非 getOwnerTeamId 反推）', async () => {
      mockPrisma.canvasProject.findUnique.mockResolvedValue({ teamId: 't-team' });
      mockPrisma.media.create.mockResolvedValue({ id: 'media-team' });

      await service.uploadAndCreateMedia({
        filePath: '/tmp/output.mp4',
        userId: 'user1',
        projectId: 'proj1',
        nodeId: 'node1',
        originalName: 'test.mp4',
        mimeType: 'video/mp4',
        sourceFileId: 'src-1',
        bizType: 'video_separate',
      });

      expect(mockPrisma.media.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ teamId: 't-team' }),
        }),
      );
      expect(mockPrisma.team.findFirst).not.toHaveBeenCalled();
    });

    it('project 查不到 → 抛错不建 Media（不回落个人团队）', async () => {
      mockPrisma.canvasProject.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadAndCreateMedia({
          filePath: '/tmp/output.mp4',
          userId: 'user1',
          projectId: 'proj-missing',
          nodeId: 'node1',
          originalName: 'test.mp4',
          mimeType: 'video/mp4',
          sourceFileId: 'src-1',
          bizType: 'video_separate',
        }),
      ).rejects.toThrow('PROJECT_TEAM_MISSING');
      expect(mockPrisma.media.create).not.toHaveBeenCalled();
    });

    it('无 project 上下文（projectId 空）→ 回落个人团队', async () => {
      mockPrisma.media.create.mockResolvedValue({ id: 'media-personal' });

      await service.uploadAndCreateMedia({
        filePath: '/tmp/output.mp4',
        userId: 'user1',
        projectId: '',
        nodeId: 'node1',
        originalName: 'test.mp4',
        mimeType: 'video/mp4',
        sourceFileId: 'src-1',
        bizType: 'video_separate',
      });

      expect(mockPrisma.media.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ teamId: 'team1' }),
        }),
      );
      expect(mockPrisma.team.findFirst).toHaveBeenCalled();
    });
  });

  describe('cleanupTempDir', () => {
    it('should call rm with recursive and force', async () => {
      await service.cleanupTempDir('task123', '/tmp/video-separate/');
      expect(rm).toHaveBeenCalledWith(path.join('/tmp/video-separate/', 'task123'), { recursive: true, force: true });
    });
  });

  describe('T7 沙箱化（spec Z7 口径「ffprobe 15s+SIGKILL+protocol_whitelist」——trim/separate/thumbnail 同改）', () => {
    it('runFfmpeg：spawn 实参前置 -protocol_whitelist file,http,https,tcp,tls（红：现状无白名单）', async () => {
      mockSpawn.mockReturnValue(mockSpawnProc('', 0));
      await service.runFfmpeg(['-i', 'in.mp4', '-an', '-c:v', 'copy', '-y', 'out.mp4']);
      const args = mockSpawn.mock.calls[0][1] as string[];
      expect(args[0]).toBe('-protocol_whitelist');
      expect(args[1]).toBe('file,http,https,tcp,tls');
      expect(args.slice(2)).toEqual(['-i', 'in.mp4', '-an', '-c:v', 'copy', '-y', 'out.mp4']);
    });

    it('ffprobe（detectDuration）：args 含 -protocol_whitelist（红：现状无白名单）', async () => {
      mockSpawn.mockReturnValue(mockSpawnProc('12.5\n', 0));
      await service.detectDuration('/tmp/a.mp4');
      const args = mockSpawn.mock.calls[0][1] as string[];
      const wl = args.indexOf('-protocol_whitelist');
      expect(wl).toBeGreaterThanOrEqual(0);
      expect(args[wl + 1]).toBe('file,http,https,tcp,tls');
    });

    it('ffprobe 15s 超时 SIGKILL（红：现状 detect* 无超时——挂死进程永久占并发）', async () => {
      const proc = mockSpawnHanging();
      mockSpawn.mockReturnValue(proc);
      vi.useFakeTimers();
      try {
        const ret = service.detectDuration('/tmp/a.mp4').then(
          () => 'resolved',
          (e: Error) => `rejected:${e.message.includes('timeout') ? 'timeout' : 'other'}`,
        );
        await vi.advanceTimersByTimeAsync(15_000);
        expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
        expect(await ret).toBe('rejected:timeout');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('downloadObjectToFile（T6 登记承接：minio SDK 直取——内网数据搬运不经 presigned HTTP 往返）', () => {
    it('getObject 流写文件：字节顺序落盘（红：方法不存在=编译红）', async () => {
      mockMinio.getObject = vi.fn().mockResolvedValue(Readable.from([Buffer.from('ab'), Buffer.from('cd')]));
      const dest = mockWritable();
      mockCreateWriteStream.mockReturnValue(dest);
      await service.downloadObjectToFile('k1', '/tmp/f.mp4', { timeoutMs: 5_000, retries: 1 });
      expect(mockMinio.getObject).toHaveBeenCalledWith('k1');
      expect(Buffer.concat(dest.writes).toString()).toBe('abcd');
    });

    it('重试语义维持：首轮 ECONNRESET 次轮成功（getObject 两调）', async () => {
      let n = 0;
      mockMinio.getObject = vi.fn().mockImplementation(async () => {
        n++;
        if (n === 1) throw new Error('ECONNRESET');
        return Readable.from([Buffer.from('ok')]);
      });
      const dest = mockWritable();
      mockCreateWriteStream.mockReturnValue(dest);
      await service.downloadObjectToFile('k2', '/tmp/f.mp4', { timeoutMs: 5_000, retries: 1 });
      expect(n).toBe(2);
      expect(Buffer.concat(dest.writes).toString()).toBe('ok');
    });

    it('超时断流：流不结束 → timeoutMs 后销毁流+reject（防 1GB 视频挂死占 lease）', async () => {
      const never = new Readable({ read() { /* 永不产出 */ } });
      mockMinio.getObject = vi.fn().mockResolvedValue(never);
      mockCreateWriteStream.mockReturnValue(mockWritable());
      await expect(
        service.downloadObjectToFile('k3', '/tmp/f.mp4', { timeoutMs: 20, retries: 0 }),
      ).rejects.toThrow('Download timeout');
      expect(never.destroyed).toBe(true);
    });
  });
});
