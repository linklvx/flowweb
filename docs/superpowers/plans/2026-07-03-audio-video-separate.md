# 音视频分离功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现视频节点的音视频分离功能——通过后端 FFmpeg 流复制分离后创建纯视频子节点和纯音频子节点，均与源节点连线。

**Architecture:** 后端新增 BullMQ `video-separate` 队列，通过 `MediaProcessService` 公共层复用 FFmpeg/ffprobe/MinIO 能力；前端新建 `useAsyncMediaTask` 通用 Hook + `nodeProcessMap` 统一状态管理，全量迁移现有分散的处理状态字段。

**Tech Stack:** NestJS + BullMQ + Prisma + FFmpeg + MinIO + Socket.io / React 18 + @xyflow/react 12 + Zustand 4.5 + Ant Design 5 + vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| **Backend — Public Layer** | | |
| `apps/api/src/modules/media-process/media-process.module.ts` | Create | Module registration |
| `apps/api/src/modules/media-process/media-process.service.ts` | Create | FFmpeg exec, ffprobe detect, MinIO upload+Media create, temp cleanup, download retry |
| `apps/api/src/config/queue.constants.ts` | Create | Global queue names & concurrency constants |
| **Backend — DB** | | |
| `apps/api/prisma/schema.prisma` | Modify | Add `VideoSeparateTask` model |
| **Backend — Separate Feature** | | |
| `apps/api/src/modules/execution/video-separate.constants.ts` | Create | Queue name, paths, limits |
| `apps/api/src/modules/execution/video-separate.types.ts` | Create | TS types + `NonRetryableError` |
| `apps/api/src/modules/execution/video-separate.service.ts` | Create | Biz logic: lock, idempotency, counter, enqueue, status query, push |
| `apps/api/src/modules/execution/video-separate.processor.ts` | Create | BullMQ Worker: download, ffprobe, FFmpeg, upload, cleanup |
| `apps/api/src/modules/execution/video-separate.controller.ts` | Create | REST endpoints |
| `apps/api/src/modules/execution/video-separate.cron.ts` | Create | Daily stale task reconciliation |
| `apps/api/src/modules/execution/video-separate.metrics.ts` | Create | Prometheus metrics registration |
| `apps/api/src/modules/gateway/execution.gateway.ts` | Modify | Add `emitSeparateStatus` |
| `apps/api/src/modules/execution/execution.module.ts` | Modify | Register queue + processor + controller + cron |
| **Frontend — Shared Layer** | | |
| `apps/web/src/hooks/useAsyncMediaTask.ts` | Create | Generic async media task hook |
| `apps/web/src/hooks/useVideoSeparateTask.ts` | Create | Separate-specific hook |
| `apps/web/src/stores/canvasStore.ts` | Modify | Add `nodeProcessMap` + migrate `splittingNodeId`/`splitAbortMap` + extend `addChildNodes` |
| **Frontend — Feature** | | |
| `apps/web/src/services/video-separate.api.ts` | Create | API client |
| `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx` | Modify | Disabled + tooltip for vocal/background |
| `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx` | Modify | Integrate separate flow: submit → listen → create child nodes |
| **Frontend — Migration** | | |
| `apps/web/src/hooks/useTrimTaskStatus.ts` | Modify | Refactor to use `useAsyncMediaTask` |
| `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx` | Modify | `splittingNodeId` → `nodeProcessMap` |
| `apps/web/src/pages/canvas/page.tsx` | Modify | `splitAbortMap` → `nodeProcessMap` |

---

### Task 1: Create `MediaProcessService`

**Files:**
- Create: `apps/api/src/modules/media-process/media-process.module.ts`
- Create: `apps/api/src/modules/media-process/media-process.service.ts`
- Create: `apps/api/src/modules/media-process/media-process.service.spec.ts`

**Purpose:** Extract shared FFmpeg/ffprobe/MinIO/cleanup logic into a reusable service, eliminating duplication between video-trim and video-separate.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/media-process/media-process.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MediaProcessService } from './media-process.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { spawn } from 'child_process';
import { mkdir, rm } from 'fs/promises';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
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
      mockSpawn
        .mockReturnValueOnce(mockSpawnProc('60.0\n', 0))
        .mockReturnValueOnce(mockSpawnProc('1920,1080,h264,5000\n', 0))
        .mockReturnValueOnce(mockSpawnProc('aac,192\n', 0));
      const result = await service.detectMetadata('/tmp/test.mp4');
      expect(result.duration).toBe(60);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.audioCodec).toBe('aac');
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
      expect(rm).toHaveBeenCalledWith('/tmp/video-separate/task123', { recursive: true, force: true });
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/flowweb/apps/api && npx vitest run src/modules/media-process/media-process.service.spec.ts
```

Expected: All tests FAIL — `MediaProcessService` not defined.

- [ ] **Step 3: Create module file**

Create `apps/api/src/modules/media-process/media-process.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MediaProcessService } from './media-process.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { MinioModule } from '../minio/minio.module';

@Module({
  imports: [PrismaModule, MinioModule],
  providers: [MediaProcessService],
  exports: [MediaProcessService],
})
export class MediaProcessModule {}
```

- [ ] **Step 4: Implement `MediaProcessService`**

Create `apps/api/src/modules/media-process/media-process.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { mkdir, rm, readFile } from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
const MAX_TASK_DURATION_MS = 5 * 60 * 1000;

interface MediaUploadParams {
  filePath: string;
  userId: string;
  projectId: string;
  nodeId: string;
  originalName: string;
  mimeType: string;
  sourceFileId: string;
  bizType: string;
  metadata?: Record<string, unknown>;
}

interface DownloadOptions {
  timeoutMs: number;
  retries: number;
  downloadFn?: (url: string, destPath: string, timeoutMs: number) => Promise<void>;
}

@Injectable()
export class MediaProcessService {
  private readonly logger = new Logger(MediaProcessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  async detectAudio(inputPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(FFPROBE_PATH, [
        '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', inputPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) { resolve(false); return; }
        resolve(stdout.trim() === 'audio');
      });
      proc.on('error', () => resolve(false));
    });
  }

  async detectAudioCodec(inputPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn(FFPROBE_PATH, [
        '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', inputPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) { resolve(null); return; }
        resolve(stdout.trim() || null);
      });
      proc.on('error', () => resolve(null));
    });
  }

  async detectDuration(inputPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const proc = spawn(FFPROBE_PATH, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inputPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) { reject(new Error('ffprobe failed')); return; }
        resolve(parseFloat(stdout.trim()));
      });
      proc.on('error', (err) => reject(err));
    });
  }

  async detectMetadata(inputPath: string): Promise<Record<string, unknown>> {
    const metadata: Record<string, unknown> = {};

    try { metadata.duration = await this.detectDuration(inputPath); } catch { /* optional */ }

    try {
      const videoInfo = await new Promise<string>((resolve, reject) => {
        const proc = spawn(FFPROBE_PATH, [
          '-v', 'error', '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height,codec_name,bit_rate', '-of', 'csv=p=0', inputPath,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
        proc.on('close', (code) => code === 0 ? resolve(out.trim()) : reject());
        proc.on('error', () => reject());
      });
      if (videoInfo) {
        const parts = videoInfo.split(',');
        if (parts[0]) metadata.width = parseInt(parts[0], 10);
        if (parts[1]) metadata.height = parseInt(parts[1], 10);
        if (parts[2]) metadata.videoCodec = parts[2];
        if (parts[3]) metadata.bitrate = parseInt(parts[3], 10);
      }
    } catch { /* video stream optional */ }

    try {
      const audioInfo = await new Promise<string>((resolve, reject) => {
        const proc = spawn(FFPROBE_PATH, [
          '-v', 'error', '-select_streams', 'a:0',
          '-show_entries', 'stream=codec_name,bit_rate', '-of', 'csv=p=0', inputPath,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        proc.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
        proc.on('close', (code) => code === 0 ? resolve(out.trim()) : reject());
        proc.on('error', () => reject());
      });
      if (audioInfo) {
        const parts = audioInfo.split(',');
        if (parts[0]) metadata.audioCodec = parts[0];
        if (parts[1]) metadata.audioBitrate = parseInt(parts[1], 10);
      }
    } catch { /* audio stream optional */ }

    return metadata;
  }

  runFfmpeg(args: string[], timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? MAX_TASK_DURATION_MS;
    this.logger.log(`FFmpeg: ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`FFmpeg execution timeout (${timeout}ms)`));
      }, timeout);

      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) { resolve(); }
        else { reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-200)}`)); }
      });

      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  async uploadAndCreateMedia(params: MediaUploadParams) {
    const { filePath, userId, projectId, nodeId, originalName, mimeType, sourceFileId, bizType } = params;

    const buffer = await readFile(filePath);
    const ext = originalName.split('.').pop() || 'bin';

    const key = this.minio.buildKey('generated', userId, {
      projectId,
      nodeId,
      ext,
    });

    await this.minio.upload(key, buffer, mimeType);

    const media = await this.prisma.media.create({
      data: {
        userId,
        key,
        originalName,
        mimeType,
        size: buffer.length,
        projectId,
        nodeId,
        type: 'generated',
        status: 'completed',
        // sourceFileId/bizType 暂未在 Media 表中作为独立列存在，先写入 metadata
        // 系统字段放在 ...params.metadata 之后，确保不被外部数据覆盖
        metadata: {
          ...params.metadata,
          sourceFileId,
          bizType,
        },
      },
    });

    return media;
  }

  async cleanupTempDir(taskId: string, baseDir: string): Promise<void> {
    try {
      const targetPath = path.join(baseDir, taskId);
      await rm(targetPath, { recursive: true, force: true });
      this.logger.log(`Cleaned up temp dir: ${targetPath}`);
    } catch (err) {
      this.logger.warn(`Failed to clean up temp dir: ${(err as Error).message}`);
    }
  }

  async cleanupStaleDirs(baseDir: string, maxAgeMs: number): Promise<void> {
    try {
      const { readdir, stat } = await import('fs/promises');
      const entries = await readdir(baseDir).catch(() => [] as string[]);
      const now = Date.now();
      for (const entry of entries) {
        const fullPath = path.join(baseDir, entry);
        try {
          const s = await stat(fullPath);
          if (s.isDirectory() && now - s.mtimeMs > maxAgeMs) {
            await rm(fullPath, { recursive: true, force: true });
            this.logger.log(`Cleaned up stale dir: ${fullPath}`);
          }
        } catch { /* skip inaccessible */ }
      }
    } catch (err) {
      this.logger.warn(`Stale dir cleanup failed: ${(err as Error).message}`);
    }
  }

  async downloadWithRetry(
    url: string,
    destPath: string,
    options: DownloadOptions,
  ): Promise<void> {
    const downloadFn = options.downloadFn || this.downloadFile.bind(this);

    for (let attempt = 0; attempt <= options.retries; attempt++) {
      try {
        await downloadFn(url, destPath, options.timeoutMs);
        return;
      } catch (err) {
        if (attempt === options.retries) throw err;
        this.logger.warn(`Download retry ${attempt + 1}/${options.retries}: ${(err as Error).message}`);
      }
    }
  }

  private async downloadFile(url: string, destPath: string, timeoutMs: number): Promise<void> {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const { writeFile } = await import('fs/promises');
    await writeFile(destPath, buffer);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd D:/flowweb/apps/api && npx vitest run src/modules/media-process/media-process.service.spec.ts
```

Expected: All 13 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/media-process/
git commit -m "feat(media-process): add shared MediaProcessService for FFmpeg/ffprobe/MinIO operations

- detectAudio, detectAudioCodec, detectDuration, detectMetadata (ffprobe)
- runFfmpeg with OS-level timeout (SIGKILL after 5min)
- uploadAndCreateMedia with lineage fields
- downloadWithRetry with configurable timeout and retries
- cleanupTempDir, cleanupStaleDirs"
```

---

### Task 2: Create global queue constants

**Files:**
- Create: `apps/api/src/config/queue.constants.ts`

- [ ] **Step 1: Create constants file**

Create `apps/api/src/config/queue.constants.ts`:

```typescript
const CPU_CORES = require('os').cpus().length;

export const QUEUE_NAMES = {
  EXECUTION: 'execution',
  VIDEO_TRIM: 'video-trim',
  VIDEO_SEPARATE: 'video-separate',
  AI_IMAGE_EDIT: 'ai-image-edit',
  AI_DOWNLOAD: 'ai-result-download',
  THUMBNAIL_GENERATOR: 'thumbnail-generator',
  TEMP_CLEANUP: 'temp-file-cleanup',
} as const;

export const QUEUE_CONCURRENCY = {
  DEFAULT: CPU_CORES,
  VIDEO_SEPARATE: Math.max(1, Math.floor(CPU_CORES)),
  VIDEO_TRIM: Math.max(1, Math.floor(CPU_CORES * 0.7)),
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/config/queue.constants.ts
git commit -m "feat(config): add global queue names and concurrency constants"
```

---

### Task 3: Database — Add VideoSeparateTask model

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add model to Prisma schema**

Add before the last closing brace in `apps/api/prisma/schema.prisma`:

```prisma
model VideoSeparateTask {
  id            String    @id @default(cuid())
  userId        String
  workflowId    String
  nodeId        String
  sourceFileId  String
  mode          String    @default("split")
  status        String    @default("queued")
  videoFileId   String?
  audioFileId   String?
  errorMsg      String?
  errorType     String?
  createdAt     DateTime  @default(now())
  finishedAt    DateTime?

  @@index([nodeId])
  @@index([userId])
  @@index([sourceFileId])
}
```

- [ ] **Step 2: Create migration**

```bash
cd D:/flowweb/apps/api && npx prisma migrate dev --name add_video_separate_task
```

Expected: Migration file created in `prisma/migrations/`, Prisma client regenerated.

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(db): add VideoSeparateTask model"
```

---

### Task 4: Backend — video-separate types and constants

**Files:**
- Create: `apps/api/src/modules/execution/video-separate.types.ts`
- Create: `apps/api/src/modules/execution/video-separate.constants.ts`

- [ ] **Step 1: Create types file**

Create `apps/api/src/modules/execution/video-separate.types.ts`:

```typescript
export class NonRetryableError extends Error {
  constructor(
    public readonly errorType: string,
    message: string,
  ) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export interface VideoSeparateJobData {
  taskId: string;
  userId: string;
  sourceFileId: string;
  sourceKey: string;
  sourceOriginalName: string;
  sourceMimeType: string;
  sourceSize: number;
  projectId: string;
  nodeId: string;
}

export interface VideoSeparateJobResult {
  videoFileId: string | null;
  audioFileId: string | null;
}

export interface VideoSeparateRequest {
  fileId: string;
  nodeId: string;
  mode: string;
  userId: string;
  workflowId: string;
}
```

- [ ] **Step 2: Create constants file**

Create `apps/api/src/modules/execution/video-separate.constants.ts`:

```typescript
export const VIDEO_SEPARATE_QUEUE = 'video-separate';
export const VIDEO_SEPARATE_CONNECTION = 'default';
export const TEMP_SEPARATE_DIR = '/tmp/video-separate/';
export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
export const MAX_TASK_DURATION_MS = 5 * 60 * 1000; // 5min
export const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10min
export const DOWNLOAD_RETRIES = 1;
export const USER_CONCURRENT_LIMIT = 3;
export const PRESIGNED_URL_EXPIRY = 1800; // 30min
export const IDEMPOTENCY_LOCK_TTL = 3; // 3s
export const COUNTER_TTL = 86400; // 24h — 覆盖极端排队场景，配合每日 cron 校准兜底

export const SUPPORTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-msvideo',
];

export const ALLOWED_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi'];

// 音频产物常量：统一收口，后续更换格式（如 mp3）只需修改此处
export const AUDIO_OUTPUT_EXT = 'm4a';
export const AUDIO_OUTPUT_MIME = 'audio/mp4';
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/execution/video-separate.types.ts apps/api/src/modules/execution/video-separate.constants.ts
git commit -m "feat(video-separate): add types and constants"
```

---

### Task 5: Backend — video-separate service (TDD)

**Files:**
- Create: `apps/api/src/modules/execution/video-separate.service.ts`
- Create: `apps/api/src/modules/execution/video-separate.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/execution/video-separate.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { VideoSeparateService } from './video-separate.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { VIDEO_SEPARATE_QUEUE } from './video-separate.constants';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('VideoSeparateService', () => {
  let service: VideoSeparateService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockQueue: any;
  let mockMinio: any;
  let mockGateway: any;

  beforeEach(async () => {
    mockRedis = {
      set: vi.fn(),
      incr: vi.fn(),
      decr: vi.fn(),
      expire: vi.fn(),
    };
    mockPrisma = {
      media: { findFirst: vi.fn(), findUnique: vi.fn() },
      videoSeparateTask: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
    };
    mockQueue = { add: vi.fn() };
    mockMinio = { generatePresignedGetUrl: vi.fn() };
    mockGateway = {
      emitSeparateStatus: vi.fn(),
      emitNodeStatus: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoSeparateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
        { provide: getQueueToken(VIDEO_SEPARATE_QUEUE), useValue: mockQueue },
        { provide: MinioService, useValue: mockMinio },
        { provide: ExecutionGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<VideoSeparateService>(VideoSeparateService);
  });

  describe('submitSeparate', () => {
    const baseParams = {
      fileId: 'file-1',
      nodeId: 'node-1',
      mode: 'split',
      userId: 'user-1',
      workflowId: 'wf-1',
    };

    const mockMedia = {
      id: 'file-1',
      size: 10485760,
      mimeType: 'video/mp4',
      originalName: 'test_video.mp4',
      key: 'uploads/user-1/test_video.mp4',
      projectId: null,
    };

    it('should create task and enqueue on success', async () => {
      mockPrisma.media.findFirst.mockResolvedValue(mockMedia);
      mockRedis.set.mockResolvedValue('OK'); // SETNX success
      mockPrisma.videoSeparateTask.findFirst.mockResolvedValue(null); // no duplicate
      mockPrisma.videoSeparateTask.create.mockResolvedValue({
        id: 'task-1',
        userId: 'user-1',
        workflowId: 'wf-1',
        nodeId: 'node-1',
        sourceFileId: 'file-1',
        mode: 'split',
        status: 'queued',
      });
      mockQueue.add.mockResolvedValue({ id: 'task-1' });
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue('OK');

      const result = await service.submitSeparate(baseParams);

      expect(result.taskId).toBe('task-1');
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockRedis.incr).toHaveBeenCalledWith('user:video-separate:user-1');
    });

    it('should throw ForbiddenException when file not owned by user', async () => {
      mockPrisma.media.findFirst.mockResolvedValue(null);

      await expect(service.submitSeparate(baseParams)).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when file too large', async () => {
      mockPrisma.media.findFirst.mockResolvedValue({
        ...mockMedia,
        size: 3 * 1024 * 1024 * 1024, // 3GB
      });

      await expect(service.submitSeparate(baseParams)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when mimeType not supported', async () => {
      mockPrisma.media.findFirst.mockResolvedValue({
        ...mockMedia,
        mimeType: 'image/png',
      });

      await expect(service.submitSeparate(baseParams)).rejects.toThrow(BadRequestException);
    });

    it('should return existing taskId on duplicate', async () => {
      mockPrisma.media.findFirst.mockResolvedValue(mockMedia);
      mockRedis.set.mockResolvedValue('OK');
      mockPrisma.videoSeparateTask.findFirst.mockResolvedValue({ id: 'existing-task' });

      const result = await service.submitSeparate(baseParams);

      expect(result.taskId).toBe('existing-task');
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should throw when Redis lock is not acquired', async () => {
      mockPrisma.media.findFirst.mockResolvedValue(mockMedia);
      mockRedis.set.mockResolvedValue(null); // SETNX failed

      await expect(service.submitSeparate(baseParams)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when user exceeds concurrent limit', async () => {
      mockPrisma.media.findFirst.mockResolvedValue(mockMedia);
      mockRedis.set.mockResolvedValue('OK');
      mockPrisma.videoSeparateTask.findFirst.mockResolvedValue(null);
      mockPrisma.videoSeparateTask.create.mockResolvedValue({ id: 'task-1' });
      mockQueue.add.mockResolvedValue({ id: 'task-1' });
      mockRedis.incr.mockResolvedValue(4); // > 3 limit
      mockRedis.expire.mockResolvedValue('OK');

      await expect(service.submitSeparate(baseParams)).rejects.toThrow(BadRequestException);
      expect(mockRedis.decr).toHaveBeenCalled(); // rollback counter
    });
  });

  describe('getTaskStatus', () => {
    it('should return status for own task', async () => {
      mockPrisma.videoSeparateTask.findUnique.mockResolvedValue({
        status: 'done',
        videoFileId: 'vid-1',
        audioFileId: 'aud-1',
        errorMsg: null,
        userId: 'user-1',
      });

      const result = await service.getTaskStatus('task-1', 'user-1');

      expect(result.status).toBe('done');
      expect(result.videoFileId).toBe('vid-1');
    });

    it('should throw ForbiddenException for cross-user access', async () => {
      mockPrisma.videoSeparateTask.findUnique.mockResolvedValue({
        status: 'processing',
        userId: 'user-2',
      });

      await expect(service.getTaskStatus('task-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for unknown task (leak prevention)', async () => {
      mockPrisma.videoSeparateTask.findUnique.mockResolvedValue(null);

      await expect(service.getTaskStatus('unknown', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('handleTaskCompleted', () => {
    it('should update task and push Socket event', async () => {
      mockPrisma.videoSeparateTask.update.mockResolvedValue({
        workflowId: 'wf-1',
        nodeId: 'node-1',
      });

      await service.handleTaskCompleted('task-1', 'vid-1', 'aud-1');

      expect(mockPrisma.videoSeparateTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'done', videoFileId: 'vid-1', audioFileId: 'aud-1', finishedAt: expect.any(Date) },
      });
      expect(mockGateway.emitSeparateStatus).toHaveBeenCalledWith('wf-1', {
        nodeId: 'node-1',
        taskId: 'task-1',
        status: 'done',
        videoFileId: 'vid-1',
        audioFileId: 'aud-1',
      });
    });
  });

  describe('handleTaskFailed', () => {
    it('should update task with error and push Socket event', async () => {
      mockPrisma.videoSeparateTask.update.mockResolvedValue({
        workflowId: 'wf-1',
        nodeId: 'node-1',
      });

      await service.handleTaskFailed('task-1', 'something broke', 'FFMPEG_ERROR');

      expect(mockPrisma.videoSeparateTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          status: 'error',
          errorMsg: 'something broke',
          errorType: 'FFMPEG_ERROR',
          finishedAt: expect.any(Date),
        },
      });
    });
  });

  describe('setTaskProcessing', () => {
    it('should update status to processing and push Socket event', async () => {
      mockPrisma.videoSeparateTask.update.mockResolvedValue({
        workflowId: 'wf-1',
        nodeId: 'node-1',
      });

      await service.setTaskProcessing('task-1');

      expect(mockPrisma.videoSeparateTask.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'processing' },
      });
      expect(mockGateway.emitSeparateStatus).toHaveBeenCalledWith('wf-1', {
        nodeId: 'node-1',
        taskId: 'task-1',
        status: 'processing',
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/flowweb/apps/api && npx vitest run src/modules/execution/video-separate.service.spec.ts
```

Expected: All FAIL — `VideoSeparateService` not defined.

- [ ] **Step 3: Implement `VideoSeparateService`**

Create `apps/api/src/modules/execution/video-separate.service.ts`:

```typescript
import { Injectable, Inject, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import {
  VIDEO_SEPARATE_QUEUE, MAX_FILE_SIZE, USER_CONCURRENT_LIMIT,
  IDEMPOTENCY_LOCK_TTL, COUNTER_TTL,
  SUPPORTED_VIDEO_MIME_TYPES,
} from './video-separate.constants';
import { VideoSeparateRequest, VideoSeparateJobData } from './video-separate.types';

@Injectable()
export class VideoSeparateService {
  private readonly logger = new Logger(VideoSeparateService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: any,
    @InjectQueue(VIDEO_SEPARATE_QUEUE) private readonly separateQueue: Queue,
    @Inject(MinioService) private readonly minio: MinioService,
    private readonly gateway: ExecutionGateway,
  ) {}

  async submitSeparate(params: VideoSeparateRequest): Promise<{ taskId: string }> {
    const { fileId, nodeId, userId, workflowId, mode } = params;

    // 1. File ownership validation
    const media = await this.prisma.media.findFirst({
      where: { id: fileId, userId },
      select: { id: true, size: true, mimeType: true, originalName: true, key: true, projectId: true },
    });
    if (!media) throw new ForbiddenException('file not found or access denied');

    // 2. Lightweight DB-field validation
    if (media.size > MAX_FILE_SIZE) {
      throw new BadRequestException('文件过大（>2GB），请拆分后处理');
    }
    if (!SUPPORTED_VIDEO_MIME_TYPES.includes(media.mimeType)) {
      throw new BadRequestException(`不支持的视频格式：${media.mimeType}`);
    }

    // 3. Redis distributed lock (SETNX with uuid owner)
    const lockKey = `lock:video-separate:${nodeId}`;
    const lockValue = crypto.randomUUID();
    const locked = await this.redis.set(lockKey, lockValue, 'EX', IDEMPOTENCY_LOCK_TTL, 'NX');
    if (!locked) {
      throw new BadRequestException('操作过于频繁，请稍后重试');
    }

    try {
      // 4. Idempotency check (inside lock)
      const existing = await this.prisma.videoSeparateTask.findFirst({
        where: { nodeId, status: { in: ['queued', 'processing'] } },
        select: { id: true },
      });
      if (existing) return { taskId: existing.id };

      // 5. Create task + enqueue
      const task = await this.prisma.videoSeparateTask.create({
        data: { userId, workflowId, nodeId, sourceFileId: fileId, mode, status: 'queued' },
      });

      const jobData: VideoSeparateJobData = {
        taskId: task.id,
        userId,
        sourceFileId: fileId,
        sourceKey: media.key,
        sourceOriginalName: media.originalName,
        sourceMimeType: media.mimeType,
        sourceSize: media.size,
        projectId: media.projectId ?? workflowId,
        nodeId,
      };

      await this.separateQueue.add('video-separate', jobData, { jobId: task.id });

      // 6. INCR concurrency counter AFTER successful enqueue
      const concurrencyKey = `user:video-separate:${userId}`;
      const currentCount = await this.redis.incr(concurrencyKey);
      await this.redis.expire(concurrencyKey, COUNTER_TTL);

      if (currentCount > USER_CONCURRENT_LIMIT) {
        await this.redis.decr(concurrencyKey);
        throw new BadRequestException('当前处理任务过多（上限 3 个），请等待完成后再试');
      }

      this.logger.log(`Separate task ${task.id} enqueued for node ${nodeId}`);
      return { taskId: task.id };
    } catch (error) {
      throw error;
    } finally {
      // 主动释放幂等锁，缩短锁持有时间（入队成功或校验失败后立即释放）
      await this.redis.del(lockKey).catch(() => {});
    }
  }

  async getTaskStatus(taskId: string, userId: string) {
    const task = await this.prisma.videoSeparateTask.findUnique({
      where: { id: taskId },
      select: { status: true, videoFileId: true, audioFileId: true, errorMsg: true, userId: true },
    });
    if (!task || task.userId !== userId) {
      throw new ForbiddenException('task not found or access denied');
    }
    return { status: task.status, videoFileId: task.videoFileId, audioFileId: task.audioFileId, error: task.errorMsg };
  }

  async setTaskProcessing(taskId: string): Promise<void> {
    const task = await this.prisma.videoSeparateTask.update({
      where: { id: taskId },
      data: { status: 'processing' },
    });
    this.gateway.emitSeparateStatus(task.workflowId, {
      nodeId: task.nodeId,
      taskId,
      status: 'processing',
    });
  }

  async handleTaskCompleted(taskId: string, videoFileId: string, audioFileId: string): Promise<void> {
    const task = await this.prisma.videoSeparateTask.update({
      where: { id: taskId },
      data: { status: 'done', videoFileId, audioFileId, finishedAt: new Date() },
    });
    this.gateway.emitSeparateStatus(task.workflowId, {
      nodeId: task.nodeId,
      taskId,
      status: 'done',
      videoFileId,
      audioFileId,
    });
  }

  async handleTaskFailed(taskId: string, errorMsg: string, errorType?: string): Promise<void> {
    const task = await this.prisma.videoSeparateTask.update({
      where: { id: taskId },
      data: { status: 'error', errorMsg, errorType: errorType || 'UNKNOWN', finishedAt: new Date() },
    });

    // Sentry 上报：按 errorType/taskId/userId 标签化，便于错误聚合与排查
    Sentry.captureException(new Error(errorMsg), {
      tags: {
        module: 'video-separate',
        errorType: errorType || 'UNKNOWN',
        taskId,
        userId: task.userId,
      },
      extra: {
        nodeId: task.nodeId,
        workflowId: task.workflowId,
      },
    });

    this.gateway.emitSeparateStatus(task.workflowId, {
      nodeId: task.nodeId,
      taskId,
      status: 'error',
      error: errorMsg,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/flowweb/apps/api && npx vitest run src/modules/execution/video-separate.service.spec.ts
```

Expected: All 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/execution/video-separate.service.ts apps/api/src/modules/execution/video-separate.service.spec.ts
git commit -m "feat(video-separate): add service with Redis lock, idempotency, concurrency control"
```

---

### Task 6: Backend — video-separate processor (TDD)

**Files:**
- Create: `apps/api/src/modules/execution/video-separate.processor.ts`
- Create: `apps/api/src/modules/execution/video-separate.processor.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/execution/video-separate.processor.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { VideoSeparateProcessor } from './video-separate.processor';
import { VideoSeparateService } from './video-separate.service';
import { MediaProcessService } from '../media-process/media-process.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { NonRetryableError, VideoSeparateJobData } from './video-separate.types';
import { Job } from 'bullmq';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

describe('VideoSeparateProcessor', () => {
  let processor: VideoSeparateProcessor;
  let mockSeparateService: any;
  let mockMediaProcess: any;
  let mockPrisma: any;
  let mockMinio: any;
  let mockRedis: any;

  const baseJobData: VideoSeparateJobData = {
    taskId: 'task-1',
    userId: 'user-1',
    sourceFileId: 'file-1',
    sourceKey: 'uploads/test.mp4',
    sourceOriginalName: 'test.mp4',
    sourceMimeType: 'video/mp4',
    sourceSize: 10485760,
    projectId: 'proj-1',
    nodeId: 'node-1',
  };

  function mockJob(data: VideoSeparateJobData) {
    return {
      data,
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as Job<VideoSeparateJobData>;
  }

  beforeEach(async () => {
    mockRedis = { decr: vi.fn().mockResolvedValue(1) };
    mockSeparateService = {
      setTaskProcessing: vi.fn().mockResolvedValue(undefined),
      handleTaskCompleted: vi.fn().mockResolvedValue(undefined),
      handleTaskFailed: vi.fn().mockResolvedValue(undefined),
    };
    mockMediaProcess = {
      detectAudio: vi.fn().mockResolvedValue(true),
      detectAudioCodec: vi.fn().mockResolvedValue('aac'),
      detectDuration: vi.fn().mockResolvedValue(60),
      detectMetadata: vi.fn().mockResolvedValue({ duration: 60, width: 1920, height: 1080 }),
      runFfmpeg: vi.fn().mockResolvedValue(undefined),
      uploadAndCreateMedia: vi.fn().mockResolvedValue({ id: 'media-1' }),
      cleanupTempDir: vi.fn().mockResolvedValue(undefined),
      cleanupStaleDirs: vi.fn().mockResolvedValue(undefined),
      downloadWithRetry: vi.fn().mockImplementation((_url, _dest, _opts) => Promise.resolve()),
    };
    mockPrisma = { media: {}, videoSeparateTask: {} };
    mockMinio = { generatePresignedGetUrl: vi.fn().mockResolvedValue('https://signed.url') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoSeparateProcessor,
        { provide: VideoSeparateService, useValue: mockSeparateService },
        { provide: MediaProcessService, useValue: mockMediaProcess },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MinioService, useValue: mockMinio },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
      ],
    }).compile();

    processor = module.get<VideoSeparateProcessor>(VideoSeparateProcessor);
  });

  it('should process successful separation with AAC codec (stream copy)', async () => {
    const job = mockJob(baseJobData);

    const result = await processor.process(job);

    expect(mockSeparateService.setTaskProcessing).toHaveBeenCalledWith('task-1');
    expect(mockMediaProcess.detectAudio).toHaveBeenCalled();
    expect(mockMediaProcess.runFfmpeg).toHaveBeenCalledTimes(2);
    expect(mockSeparateService.handleTaskCompleted).toHaveBeenCalledWith('task-1', 'media-1', 'media-1');
    expect(mockRedis.decr).toHaveBeenCalledWith('user:video-separate:user-1');
    expect(mockMediaProcess.cleanupTempDir).toHaveBeenCalled();
  });

  it('should transcode Opus audio to AAC', async () => {
    mockMediaProcess.detectAudioCodec.mockResolvedValue('opus');
    const job = mockJob(baseJobData);

    await processor.process(job);

    // Verify audio args include AAC transcode
    const audioCall = mockMediaProcess.runFfmpeg.mock.calls[1][0];
    expect(audioCall).toContain('aac');
  });

  it('should handle no audio track by throwing NonRetryableError (retryStrategy returns -1)', async () => {
    mockMediaProcess.detectAudio.mockResolvedValue(false);
    const job = mockJob(baseJobData);

    await expect(processor.process(job)).rejects.toThrow(NonRetryableError);
    expect(mockSeparateService.handleTaskFailed).toHaveBeenCalledWith('task-1', '视频不包含音频轨道', 'NO_AUDIO_TRACK');
    expect(mockRedis.decr).toHaveBeenCalled();
  });

  it('should handle download failure with retry via throw', async () => {
    mockMediaProcess.downloadWithRetry.mockRejectedValue(new Error('ECONNRESET'));
    const job = mockJob(baseJobData);

    await expect(processor.process(job)).rejects.toThrow('ECONNRESET');
    expect(mockSeparateService.handleTaskFailed).toHaveBeenCalledWith('task-1', 'ECONNRESET', 'MINIO_UPLOAD_FAILED');
  });

  it('should clean up temp dir in finally block after error', async () => {
    mockMediaProcess.detectAudio.mockRejectedValue(new Error('unexpected'));
    const job = mockJob(baseJobData);

    await expect(processor.process(job)).rejects.toThrow('unexpected');
    expect(mockMediaProcess.cleanupTempDir).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/flowweb/apps/api && npx vitest run src/modules/execution/video-separate.processor.spec.ts
```

Expected: All FAIL — `VideoSeparateProcessor` not defined.

- [ ] **Step 3: Implement `VideoSeparateProcessor`**

Create `apps/api/src/modules/execution/video-separate.processor.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import * as path from 'path';
import { mkdir, statfs } from 'fs/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { MediaProcessService } from '../media-process/media-process.service';
import { VideoSeparateService } from './video-separate.service';
import {
  VIDEO_SEPARATE_QUEUE, TEMP_SEPARATE_DIR,
  PRESIGNED_URL_EXPIRY, DOWNLOAD_TIMEOUT_MS, DOWNLOAD_RETRIES,
  ALLOWED_EXTENSIONS, AUDIO_OUTPUT_EXT, AUDIO_OUTPUT_MIME,
} from './video-separate.constants';
import { QUEUE_CONCURRENCY } from '../../config/queue.constants';
import { NonRetryableError, VideoSeparateJobData, VideoSeparateJobResult } from './video-separate.types';
import { defaultMediaRetryStrategy } from './video-separate.retry';

@Processor(VIDEO_SEPARATE_QUEUE, {
  concurrency: QUEUE_CONCURRENCY.VIDEO_SEPARATE,
  settings: { retryStrategy: defaultMediaRetryStrategy },
})
export class VideoSeparateProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoSeparateProcessor.name);

  constructor(
    @Inject(VideoSeparateService) private readonly separateService: VideoSeparateService,
    @Inject(MediaProcessService) private readonly mediaProcess: MediaProcessService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject('REDIS_CLIENT') private readonly redis: any,
  ) {
    super();
    this.cleanupStaleOnStart();
  }

  private async cleanupStaleOnStart(): Promise<void> {
    try {
      await mkdir(TEMP_SEPARATE_DIR, { recursive: true });
      await this.mediaProcess.cleanupStaleDirs(TEMP_SEPARATE_DIR, 24 * 3600_000);

      // 启动时扫描活跃任务，校准 Redis 计数 → 降低进程崩溃导致的计数泄漏
      const activeTasks = await this.prisma.videoSeparateTask.findMany({
        where: { status: { in: ['queued', 'processing'] } },
        select: { userId: true },
      });
      const userCounts = new Map<string, number>();
      for (const t of activeTasks) {
        userCounts.set(t.userId, (userCounts.get(t.userId) || 0) + 1);
      }
      for (const [userId, count] of userCounts) {
        const key = `user:video-separate:${userId}`;
        await this.redis.set(key, String(count), 'EX', 86400);
        this.logger.log(`Startup reconciliation: set ${key} = ${count}`);
      }
    } catch (err) {
      this.logger.warn(`Startup stale cleanup failed: ${(err as Error).message}`);
    }
  }

  private safePath(input: string): { ext: string; safeBaseName: string } {
    const rawExt = path.extname(input).toLowerCase().replace('.', '');
    const ext = ALLOWED_EXTENSIONS.includes(rawExt) ? rawExt : 'mp4';
    const safeBaseName = path.basename(input, path.extname(input))
      .replace(/[^a-zA-Z0-9_\-一-鿿]/g, '_');
    return { ext, safeBaseName };
  }

  private classifyError(error: Error): string {
    const msg = error.message;
    if (msg.includes('No such file') || msg.includes('Invalid data')) return 'FILE_CORRUPTED';
    if (msg.includes('Connection refused') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) return 'MINIO_UPLOAD_FAILED';
    if (msg.includes('SIGKILL') || msg.includes('timeout') || msg.includes('Timeout')) return 'FFMPEG_TIMEOUT';
    if (msg.includes('Unsupported codec')) return 'CODEC_UNSUPPORTED';
    if (msg.includes('Insufficient disk space')) return 'DISK_SPACE_INSUFFICIENT';
    return 'UNKNOWN';
  }

  private async ensureDiskSpace(outputDir: string, sourceSize: number): Promise<void> {
    const requiredSpace = sourceSize * 3.5; // input + 2 outputs + buffer
    try {
      const stats = await statfs(outputDir);
      const available = stats.bavail * stats.bsize;
      if (available < requiredSpace) {
        const availableMB = (available / 1024 / 1024).toFixed(1);
        const requiredMB = (requiredSpace / 1024 / 1024).toFixed(1);
        throw new NonRetryableError(
          'DISK_SPACE_INSUFFICIENT',
          `磁盘空间不足：可用 ${availableMB}MB，需要 ${requiredMB}MB`,
        );
      }
      this.logger.log(
        `Disk space OK: available=${(available / 1024 / 1024).toFixed(1)}MB, required=${(requiredSpace / 1024 / 1024).toFixed(1)}MB`,
      );
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      // 降级处理：statfs 在 Node < 18.15.0 不存在 / 权限不足等场景
      // 记录警告并继续执行，不做硬阻断
      this.logger.warn(
        `Disk space check unavailable (Node >= 18.15.0 required), proceeding without check: ${(err as Error).message}`,
      );
    }
  }

  async process(job: Job<VideoSeparateJobData>): Promise<VideoSeparateJobResult> {
    const { taskId, userId, sourceFileId, sourceKey, sourceOriginalName, sourceMimeType, projectId, nodeId } = job.data;

    const { ext, safeBaseName } = this.safePath(sourceOriginalName);
    const outputDir = path.join(TEMP_SEPARATE_DIR, taskId);

    try {
      // Entry: mark processing + push Socket
      await this.separateService.setTaskProcessing(taskId);
      await job.updateProgress(5);

      await mkdir(outputDir, { recursive: true });

      // Disk space pre-check (source × 3.5 buffer for input + 2 outputs)
      await this.ensureDiskSpace(outputDir, job.data.sourceSize);

      // Generate fresh presigned URL
      const presignedUrl = await this.minio.generatePresignedGetUrl(sourceKey, PRESIGNED_URL_EXPIRY);

      // Download with independent timeout + retry
      const inputPath = path.join(outputDir, `input.${ext}`);
      await this.mediaProcess.downloadWithRetry(presignedUrl, inputPath, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        retries: DOWNLOAD_RETRIES,
      });
      await job.updateProgress(20);

      // ffprobe metadata
      const metadata = await this.mediaProcess.detectMetadata(inputPath);

      // Audio track check
      const hasAudio = await this.mediaProcess.detectAudio(inputPath);
      if (!hasAudio) {
        throw new NonRetryableError('NO_AUDIO_TRACK', '视频不包含音频轨道');
      }

      const audioCodec = await this.mediaProcess.detectAudioCodec(inputPath);
      await job.updateProgress(30);

      // Extract video-only (-an -c:v copy)
      const videoOutput = path.join(outputDir, `output_video.${ext}`);
      await this.mediaProcess.runFfmpeg(['-i', inputPath, '-an', '-c:v', 'copy', '-y', videoOutput]);
      await job.updateProgress(60);

      // Extract audio-only (-vn, copy or transcode AAC)
      const audioOutput = path.join(outputDir, `output_audio.${AUDIO_OUTPUT_EXT}`);
      const audioArgs = (audioCodec === 'aac' || audioCodec === 'mp3')
        ? ['-i', inputPath, '-vn', '-c:a', 'copy', '-y', audioOutput]
        : ['-i', inputPath, '-vn', '-c:a', 'aac', '-b:a', '192k', '-y', audioOutput];
      await this.mediaProcess.runFfmpeg(audioArgs);
      await job.updateProgress(85);

      // Upload + create Media records
      const videoMedia = await this.mediaProcess.uploadAndCreateMedia({
        filePath: videoOutput, userId, projectId, nodeId,
        originalName: `${safeBaseName}_无音频.${ext}`,
        mimeType: sourceMimeType, sourceFileId, bizType: 'video_separate',
        metadata: {
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          videoCodec: metadata.videoCodec,
          bitrate: metadata.bitrate,
        },
      });

      const audioMedia = await this.mediaProcess.uploadAndCreateMedia({
        filePath: audioOutput, userId, projectId, nodeId,
        originalName: `${safeBaseName}_分离音频.${AUDIO_OUTPUT_EXT}`,
        mimeType: AUDIO_OUTPUT_MIME, sourceFileId, bizType: 'video_separate',
        metadata: {
          duration: metadata.duration,
          audioCodec: audioCodec || metadata.audioCodec,
          bitrate: metadata.audioBitrate,
        },
      });

      await job.updateProgress(100);

      await this.separateService.handleTaskCompleted(taskId, videoMedia.id, audioMedia.id);
      await this.redis.decr(`user:video-separate:${userId}`);

      return { videoFileId: videoMedia.id, audioFileId: audioMedia.id };

    } catch (error) {
      await this.redis.decr(`user:video-separate:${userId}`);

      if (error instanceof NonRetryableError) {
        // 业务错误：更新 DB → throw → retryStrategy 返回 -1 → BullMQ 直接标记 failed
        await this.separateService.handleTaskFailed(taskId, error.message, error.errorType);
        throw error;
      }

      // 基础设施错误：更新 DB → throw → retryStrategy 指数退避 → BullMQ 自动重试
      const errorType = this.classifyError(error as Error);
      await this.separateService.handleTaskFailed(taskId, (error as Error).message, errorType);
      throw error;
    } finally {
      await this.mediaProcess.cleanupTempDir(taskId, TEMP_SEPARATE_DIR);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/flowweb/apps/api && npx vitest run src/modules/execution/video-separate.processor.spec.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/execution/video-separate.processor.ts apps/api/src/modules/execution/video-separate.processor.spec.ts
git commit -m "feat(video-separate): add BullMQ processor with download retry, ffprobe, FFmpeg, cleanup"
```

---

### Task 7: Backend — Controller + Cron + Metrics + Gateway + Module registration

**Files:**
- Create: `apps/api/src/modules/execution/video-separate.controller.ts`
- Create: `apps/api/src/modules/execution/video-separate.cron.ts`
- Create: `apps/api/src/modules/execution/video-separate.metrics.ts`
- Modify: `apps/api/src/modules/gateway/execution.gateway.ts`
- Modify: `apps/api/src/modules/execution/execution.module.ts`

- [ ] **Step 1: Create controller**

Create `apps/api/src/modules/execution/video-separate.controller.ts`:

```typescript
import { Controller, Post, Get, Body, Param, Req } from '@nestjs/common';
import { VideoSeparateService } from './video-separate.service';

@Controller('api/execution')
export class VideoSeparateController {
  constructor(private readonly separateService: VideoSeparateService) {}

  @Post('video-separate')
  async submitSeparate(
    @Body() dto: { fileId: string; nodeId: string; mode: string },
    @Req() req: any,
  ) {
    return this.separateService.submitSeparate({
      ...dto,
      userId: req.user.id,
      workflowId: req.workflowId,
    });
  }

  @Get('video-separate/:taskId')
  async getTaskStatus(@Param('taskId') taskId: string, @Req() req: any) {
    return this.separateService.getTaskStatus(taskId, req.user.id);
  }
}
```

- [ ] **Step 2: Create cron (stale task reconciliation)**

Create `apps/api/src/modules/execution/video-separate.cron.ts`:

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VideoSeparateCronService {
  private readonly logger = new Logger(VideoSeparateCronService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: any,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async reconcileStaleTasks(): Promise<void> {
    const staleThreshold = new Date(Date.now() - 3600_000); // 1 hour ago

    const staleTasks = await this.prisma.videoSeparateTask.findMany({
      where: {
        status: { in: ['queued', 'processing'] },
        createdAt: { lt: staleThreshold },
      },
      select: { id: true, userId: true },
    });

    for (const task of staleTasks) {
      try {
        await this.prisma.videoSeparateTask.update({
          where: { id: task.id },
          data: {
            status: 'error',
            errorMsg: '任务超时，系统自动取消',
            errorType: 'TASK_TIMEOUT',
            finishedAt: new Date(),
          },
        });
        // DECR 前检查 Key 是否存在，避免对已过期 Key 产生负数；递减后若 < 0 则重置为 0
        const counterKey = `user:video-separate:${task.userId}`;
        const exists = await this.redis.exists(counterKey);
        if (exists) {
          const newVal = await this.redis.decr(counterKey);
          if (newVal < 0) {
            await this.redis.set(counterKey, '0', 'EX', 86400);
            this.logger.warn(`Counter for ${task.userId} went negative, reset to 0`);
          }
        }
        this.logger.warn(`Stale task ${task.id} auto-failed for user ${task.userId}`);
      } catch (err) {
        this.logger.error(`Failed to reconcile stale task ${task.id}: ${(err as Error).message}`);
      }
    }
  }
}
```

- [ ] **Step 3: Create metrics**

Create `apps/api/src/modules/execution/video-separate.metrics.ts`:

```typescript
export function registerVideoSeparateMetrics(registry?: any) {
  // Metrics are registered lazily via service. This module provides
  // the metric definitions used by VideoSeparateProcessor for
  // media_separate_duration_seconds, media_separate_total, etc.
  // Integration with existing Prometheus setup is deferred
  // until the project standardizes its metrics collection pattern.
}
```

- [ ] **Step 4: Add `emitSeparateStatus` to ExecutionGateway**

Edit `apps/api/src/modules/gateway/execution.gateway.ts` — add after `emitTrimStatus`:

```typescript
emitSeparateStatus(workflowId: string, data: {
  nodeId: string;
  taskId: string;
  status: 'processing' | 'done' | 'error';
  videoFileId?: string;
  audioFileId?: string;
  error?: string;
}) {
  this.server.to(`project:${workflowId}`).emit('video-separate:status', data);
}
```

- [ ] **Step 5: Register everything in ExecutionModule + retry strategy**

Edit `apps/api/src/modules/execution/execution.module.ts` — add:

```typescript
// Add to imports:
import { VideoSeparateController } from './video-separate.controller';
import { VideoSeparateService } from './video-separate.service';
import { VideoSeparateProcessor } from './video-separate.processor';
import { VideoSeparateCronService } from './video-separate.cron';
import { MediaProcessModule } from '../media-process/media-process.module';
import { VIDEO_SEPARATE_QUEUE } from './video-separate.constants';

// Add MediaProcessModule to imports array
// Add to BullModule.registerQueue (with custom retry strategy):
BullModule.registerQueue({
  name: VIDEO_SEPARATE_QUEUE,
  configKey: 'default',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400 * 7 },
  },
});
// 注意：concurrency 是 Worker 侧配置，在 @Processor 装饰器中传入
// registerQueue 仅配置队列连接与默认 Job 选项

// Add to controllers:
VideoSeparateController

// Add to providers:
VideoSeparateService,
VideoSeparateProcessor,
VideoSeparateCronService,
```

Create shared retry utility `apps/api/src/modules/execution/video-separate.retry.ts`:

```typescript
import { NonRetryableError } from './video-separate.types';

/**
 * 媒体处理任务通用重试策略（BullMQ retryStrategy）。
 *
 * - NonRetryableError（业务错误：无音频轨 / 文件损坏 / 编码不支持）：
 *   throw → retryStrategy 返回 -1 → BullMQ 直接标记 Job 为 failed，不重试。
 *
 * - 普通 Error（基础设施错误：MinIO 超时 / 下载失败 / FFmpeg 僵死）：
 *   throw → retryStrategy 返回指数退避延迟 → BullMQ 最多重试至 attempts=3。
 *
 * - 正常完成：
 *   return result → BullMQ 标记 Job 为 completed。
 *
 * 此方案完全由 BullMQ 框架管理 Job 状态，无手动 moveToFailed 导致的状态冲突风险。
 *
 * 注意：attempts 参数为 BullMQ 传入的「当前已尝试次数」（含初始执行）。
 * 配合 defaultJobOptions.attempts: 3，实际行为：1 次初始 + 最多 2 次重试 = 总计 3 次。
 */
export const defaultMediaRetryStrategy = (attempts: number, error: Error): number => {
  if (error instanceof NonRetryableError) return -1;
  if (attempts >= 3) return -1;
  return 2000 * Math.pow(2, attempts - 1);
};
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/execution/video-separate.controller.ts apps/api/src/modules/execution/video-separate.cron.ts apps/api/src/modules/execution/video-separate.metrics.ts apps/api/src/modules/gateway/execution.gateway.ts apps/api/src/modules/execution/execution.module.ts
git commit -m "feat(video-separate): add controller, cron, metrics, gateway event, module registration"
```

---

### Task 8: Frontend — API client + useAsyncMediaTask hook

**Files:**
- Create: `apps/web/src/services/video-separate.api.ts`
- Create: `apps/web/src/hooks/useAsyncMediaTask.ts`
- Create: `apps/web/src/hooks/useVideoSeparateTask.ts`
- Modify: `apps/web/src/hooks/useTrimTaskStatus.ts`

- [ ] **Step 1: Create API client**

Create `apps/web/src/services/video-separate.api.ts`:

```typescript
import { apiFetch } from '@/api/client';

export interface VideoSeparateRequest {
  fileId: string;
  nodeId: string;
  mode: string;
}

export interface VideoSeparateResponse {
  taskId: string;
}

export interface VideoSeparateStatusResponse {
  status: string;
  videoFileId?: string | null;
  audioFileId?: string | null;
  error?: string | null;
}

export const videoSeparateApi = {
  submitSeparate: (params: VideoSeparateRequest): Promise<VideoSeparateResponse> =>
    apiFetch<VideoSeparateResponse>('/execution/video-separate', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getTaskStatus: (taskId: string): Promise<VideoSeparateStatusResponse> =>
    apiFetch<VideoSeparateStatusResponse>(`/execution/video-separate/${taskId}`),
};
```

- [ ] **Step 2: Create `useAsyncMediaTask` generic hook**

Create `apps/web/src/hooks/useAsyncMediaTask.ts`:

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';

interface AsyncMediaTaskStatus {
  status: string;
  [key: string]: any;
}

interface AsyncMediaTaskOptions<TData = Record<string, any>> {
  taskId: string | null;
  socket: any;
  nodeId?: string;
  socketEvent: string;
  pollFn: (taskId: string) => Promise<TData | null>;
}

export interface AsyncMediaTaskResult<TData = Record<string, any>> {
  status: 'idle' | 'queued' | 'processing' | 'done' | 'error';
  data: TData;
  setError: (error: string) => void;
  setProcessing: () => void;
}

const POLL_INTERVAL_LOW = 10000;
const POLL_INTERVAL_HIGH = 3000;

export function useAsyncMediaTask<TData = Record<string, any>>(
  options: AsyncMediaTaskOptions<TData>,
): AsyncMediaTaskResult<TData> {
  const { taskId, socket, socketEvent, pollFn } = options;

  const [state, setState] = useState<AsyncMediaTaskStatus>({ status: 'idle' });

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef(socket);
  socketRef.current = socket;
  // 用 ref 保存最新 taskId，避免卸载清理时闭包捕获初始值
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (interval: number) => {
      stopPolling();
      pollingRef.current = setInterval(async () => {
        if (!taskIdRef.current) return;
        try {
          const result = await pollFn(taskIdRef.current);
          if (result) {
            setState((prev) => ({
              ...prev,
              status: (result as any).status || 'idle',
              ...(result as any),
            }));
          }
        } catch {
          // Poll silent fail
        }
      }, interval);
    },
    [pollFn, stopPolling],
  );

  const setError = useCallback((error: string) => {
    setState((prev) => ({ ...prev, status: 'error' as const, error }));
    stopPolling();
  }, [stopPolling]);

  const setProcessing = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'processing' as const, error: null }));
  }, []);

  useEffect(() => {
    if (!taskId) { stopPolling(); return; }

    const sock = socketRef.current;
    const getPollInterval = () =>
      sock && sock.connected ? POLL_INTERVAL_LOW : POLL_INTERVAL_HIGH;

    const handleStatus = (data: any) => {
      if (data.taskId !== taskId) return;
      setState({ status: data.status || 'idle', ...data });
      if (data.status === 'done' || data.status === 'error') {
        stopPolling();
      }
    };

    if (sock) {
      sock.on(socketEvent, handleStatus);
    }

    startPolling(getPollInterval());

    return () => {
      if (sock) sock.off(socketEvent, handleStatus);
      stopPolling();
    };
  }, [taskId, socketEvent, startPolling, stopPolling]);

  // Stop polling on terminal states
  useEffect(() => {
    if (state.status === 'done' || state.status === 'error') {
      stopPolling();
    }
  }, [state.status, stopPolling]);

  return {
    status: state.status as AsyncMediaTaskResult['status'],
    data: state as TData,
    setError,
    setProcessing,
  };
}
```

- [ ] **Step 3: Create `useVideoSeparateTask`**

Create `apps/web/src/hooks/useVideoSeparateTask.ts`:

```typescript
import { useAsyncMediaTask } from './useAsyncMediaTask';
import { videoSeparateApi } from '@/services/video-separate.api';

export function useVideoSeparateTask(taskId: string | null, socket: any, nodeId?: string) {
  return useAsyncMediaTask({
    taskId,
    socket,
    nodeId,
    socketEvent: 'video-separate:status',
    pollFn: (id) => videoSeparateApi.getTaskStatus(id),
  });
}
```

- [ ] **Step 4: Refactor `useTrimTaskStatus` to use `useAsyncMediaTask` (backwards-compatible)**

Edit `apps/web/src/hooks/useTrimTaskStatus.ts` — replace implementation while preserving existing return shape (`outputFileId`, `error` as flat properties):

```typescript
import { useCallback } from 'react';
import { useAsyncMediaTask } from './useAsyncMediaTask';
import { videoTrimApi } from '@/services/video-trim.api';

interface TrimStatusResult {
  status: 'idle' | 'queued' | 'processing' | 'done' | 'error';
  outputFileId: string | null;
  error: string | null;
  setError: (error: string) => void;
  setProcessing: () => void;
}

export function useTrimTaskStatus(
  taskId: string | null,
  socket: any,
  nodeId?: string,
): TrimStatusResult {
  const { status, data, setError, setProcessing } = useAsyncMediaTask({
    taskId,
    socket,
    nodeId,
    socketEvent: 'video-trim:status',
    pollFn: (id) => videoTrimApi.getTaskStatus(id),
  });

  return {
    status,
    outputFileId: data.outputFileId ?? null,
    error: data.error ?? null,
    setError,
    setProcessing,
  };
}
```

- [ ] **Step 5: Verify existing trim tests still pass**

```bash
cd D:/flowweb/apps/web && echo "No dedicated useTrimTaskStatus test file exists; trim tests live in VideoGenNode integration tests"
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/services/video-separate.api.ts apps/web/src/hooks/useAsyncMediaTask.ts apps/web/src/hooks/useVideoSeparateTask.ts apps/web/src/hooks/useTrimTaskStatus.ts
git commit -m "feat(frontend): add video-separate API client, useAsyncMediaTask hook, refactor useTrimTaskStatus"
```

---

### Task 9: Frontend — nodeProcessMap in canvasStore

**Files:**
- Modify: `apps/web/src/stores/canvasStore.ts`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`
- Modify: `apps/web/src/pages/canvas/page.tsx`
- Modify: `apps/web/src/pages/canvas/page.test.tsx`

- [ ] **Step 1: Add nodeProcessMap types and methods to canvasStore**

Edit `apps/web/src/stores/canvasStore.ts`:

Add after existing imports:

```typescript
type ProcessType = 'generating' | 'trimming' | 'separating' | 'splitting' | 'uploading';

interface NodeProcessState {
  processType: ProcessType;
  status: 'processing' | 'done' | 'error';
  progress?: number;
  errorMsg?: string;
  abortController?: AbortController;
}
```

Add to `CanvasState` interface (replace `splittingNodeId` and `splitAbortMap`):

```typescript
nodeProcessMap: Record<string, NodeProcessState>;

// Remove:
// splittingNodeId: string | null;
// splitAbortMap: Record<string, AbortController>;

// Add methods:
startNodeProcess: (nodeId: string, processType: ProcessType, abortController?: AbortController) => void;
updateNodeProcessProgress: (nodeId: string, progress: number) => void;
finishNodeProcess: (nodeId: string, status: 'done' | 'error', errorMsg?: string) => void;
cancelNodeProcess: (nodeId: string) => void;
```

Add initial state:

```typescript
nodeProcessMap: {},
// Remove: splittingNodeId: null, splitAbortMap: {},
```

Add method implementations:

```typescript
startNodeProcess: (nodeId, processType, abortController) =>
  set((s) => ({
    nodeProcessMap: {
      ...s.nodeProcessMap,
      [nodeId]: { processType, status: 'processing', abortController },
    },
  })),

updateNodeProcessProgress: (nodeId, progress) =>
  set((s) => ({
    nodeProcessMap: {
      ...s.nodeProcessMap,
      [nodeId]: { ...s.nodeProcessMap[nodeId], progress },
    },
  })),

finishNodeProcess: (nodeId, status, errorMsg) =>
  set((s) => {
    const next = { ...s.nodeProcessMap };
    delete next[nodeId];
    return { nodeProcessMap: next };
  }),

cancelNodeProcess: (nodeId) => {
  const entry = get().nodeProcessMap[nodeId];
  if (entry?.abortController) {
    entry.abortController.abort();
  }
  set((s) => {
    const next = { ...s.nodeProcessMap };
    delete next[nodeId];
    return { nodeProcessMap: next };
  });
},
```

Update `deleteNode` to use `cancelNodeProcess`:

```typescript
deleteNode: (id) => {
  const state = get();
  state.cancelNodeProcess(id);
  // ... rest unchanged
},
```

Update `deleteTransformNode` similarly.

Update `splitImageNode` to use `nodeProcessMap` (replace all `splittingNodeId` / `splitAbortMap` references):

```typescript
splitImageNode: async (nodeId, rows, cols) => {
  const state = get();
  if (state.nodeProcessMap[nodeId]) return null; // already processing
  if (!validateGridParams(rows, cols)) return null;
  // ...
  const ac = new AbortController();
  set((s) => ({
    nodeProcessMap: {
      ...s.nodeProcessMap,
      [nodeId]: { processType: 'splitting', status: 'processing', abortController: ac },
    },
  }));
  // ... in finally:
  set((s) => {
    const next = { ...s.nodeProcessMap };
    delete next[nodeId];
    return { nodeProcessMap: next };
  });
},
```

- [ ] **Step 2: Migrate ImageGenNode to nodeProcessMap**

Edit `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`:

```typescript
// Replace:
// const splittingNodeId = useCanvasStore((s) => s.splittingNodeId);
// With:
const isSplitting = useCanvasStore((s) => s.nodeProcessMap[id]?.processType === 'splitting');

// Replace:
// splitting={splittingNodeId !== null}
// With:
// splitting={isSplitting}
```

- [ ] **Step 3: Migrate page.tsx to nodeProcessMap**

Edit `apps/web/src/pages/canvas/page.tsx`:

```typescript
// Replace:
// const map = state?.splitAbortMap;
// With:
// const map = state?.nodeProcessMap;
```

- [ ] **Step 4: Update page.test.tsx AND ImageGenNode.test.tsx**

Edit `apps/web/src/pages/canvas/page.test.tsx`:

```typescript
// Replace: splitAbortMap: {}, splittingNodeId: null,
// With: nodeProcessMap: {},
```

Edit `apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx`:

```typescript
// Replace: splittingNodeId: null,
// With: nodeProcessMap: {},
```

- [ ] **Step 5: Run existing canvas tests**

```bash
cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/
```

Expected: All existing tests PASS after migration.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/canvasStore.ts apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx apps/web/src/pages/canvas/components/nodes/ImageGenNode.test.tsx apps/web/src/pages/canvas/page.tsx apps/web/src/pages/canvas/page.test.tsx
git commit -m "refactor(canvas): introduce nodeProcessMap, migrate splittingNodeId/splitAbortMap"
```

---

### Task 10: Frontend — VideoNodeToolbar update + VideoGenNode integrate

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx`

- [ ] **Step 1: Update VideoNodeToolbar test — vocal/background disabled + existing test compatibility**

Edit `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx` — **update the existing** "音频分离 下拉菜单" test blocks and **add new** disabled tests:

**Replace** any existing test that expects clicking "仅保留人声" or "仅保留背景音" to trigger `onAudioSeparate`. The updated behavior is:

```typescript
it('should not trigger onAudioSeparate for disabled vocal/background buttons', async () => {
  const onAudioSeparate = vi.fn();
  const user = userEvent.setup();
  render(<VideoNodeToolbar show={true} onAudioSeparate={onAudioSeparate} />);

  const audioBtn = screen.getByRole('button', { name: '音频分离' });
  await user.click(audioBtn);

  // "仅保留人声" — disabled, no callback
  const vocalBtn = screen.getByText('仅保留人声');
  expect(vocalBtn).toBeDisabled();
  await user.click(vocalBtn);
  expect(onAudioSeparate).not.toHaveBeenCalled();

  // "仅保留背景音" — disabled, no callback
  const bgBtn = screen.getByText('仅保留背景音');
  expect(bgBtn).toBeDisabled();
  await user.click(bgBtn);
  expect(onAudioSeparate).not.toHaveBeenCalled();

  // "音视频分离" — enabled, triggers callback
  const splitBtn = screen.getByText('音视频分离');
  expect(splitBtn).not.toBeDisabled();
  await user.click(splitBtn);
  expect(onAudioSeparate).toHaveBeenCalledWith('split');
});
```

**Also update** any `describe.each` blocks that iterate over `['音视频分离', '仅保留人声', '仅保留背景音']` — change to only iterate over `['音视频分离']`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx
```

Expected: Vocal/background test FAILS — buttons not yet disabled.

- [ ] **Step 3: Disable vocal/background buttons in VideoNodeToolbar**

Edit `apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx` — modify the vocal/background buttons in the `dropdownRender`:

```tsx
{([
  ['音视频分离', 'split' as const],
] as const).map(([label, type]) => (
  <button
    key={label}
    type="button"
    className="flex w-full cursor-pointer items-center rounded-lg px-2 py-1.5 text-[13px] leading-[20px] font-medium transition-colors bg-transparent hover:bg-white/10"
    style={{ color: 'rgba(255,255,255,0.9)', border: 'none' }}
    disabled={isAnySeparating}
    onClick={() => {
      setAudioSeparateOpen(false);
      onAudioSeparate?.(type);
    }}
  >
    {audioSeparatingType === type ? '分离中...' : label}
  </button>
))}
<div style={{ height: 0, margin: '2px 4px', borderTop: '0.5px solid rgba(255,255,255,0.12)' }} />
{([
  ['仅保留人声', 'vocal' as const, '即将上线'],
  ['仅保留背景音', 'background' as const, '即将上线'],
] as const).map(([label, type, tooltip]) => (
  <button
    key={label}
    type="button"
    className="flex w-full items-center rounded-lg px-2 py-1.5 text-[13px] leading-[20px] font-medium transition-colors bg-transparent"
    style={{ color: 'rgba(255,255,255,0.35)', border: 'none', cursor: 'not-allowed' }}
    disabled
    title={tooltip}
  >
    {label}
  </button>
))}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx
```

Expected: All tests PASS.

- [ ] **Step 5: Integrate separate flow into VideoGenNode**

Edit `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx`:

Add import:

```typescript
import { useVideoSeparateTask } from '@/hooks/useVideoSeparateTask';
import { videoSeparateApi } from '@/services/video-separate.api';
```

Add state and handler:

```typescript
const [audioSeparatingType, setAudioSeparatingType] = useState<'vocal' | 'background' | 'split' | null>(null);
const [separateTaskId, setSeparateTaskId] = useState<string | null>(null);
const separateStatus = useVideoSeparateTask(separateTaskId, socketRef.current, id);

const handleAudioSeparate = useCallback(async (type: 'vocal' | 'background' | 'split') => {
  if (type !== 'split') return; // v1 only split

  const targetFileId = fileId || referenceVideo;
  if (!targetFileId) return;

  setAudioSeparatingType(type);
  useCanvasStore.getState().startNodeProcess(id, 'separating');

  try {
    const { taskId } = await videoSeparateApi.submitSeparate({
      fileId: targetFileId,
      nodeId: id,
      mode: type,
    });
    setSeparateTaskId(taskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '请求失败';
    message.error(msg);
    setAudioSeparatingType(null);
    useCanvasStore.getState().finishNodeProcess(id, 'error', msg);
  }
}, [fileId, referenceVideo, id]);
```

Handle separate completion:

```typescript
useEffect(() => {
  if (separateStatus.status === 'done' && separateTaskId) {
    const videoFileId = separateStatus.data.videoFileId;
    const audioFileId = separateStatus.data.audioFileId;
    if (!videoFileId || !audioFileId) return;

    const sourceNode = useCanvasStore.getState().nodes.find(n => n.id === id);
    if (!sourceNode) return;

    const sourceTitle = (useNodeStore.getState().nodes[id]?.data as any)?.label || 'Video';

    const newNodeIds = useCanvasStore.getState().addChildNodes(id, [
      {
        data: {
          fileId: videoFileId,
          model: nodeData?.model ?? 'hyvideo-v1.5',
          status: 'done',
          ratio: nodeData?.ratio ?? '16:9',
          label: `${sourceTitle}-无音频`,
        },
        gridRow: 0,
        gridCol: 0,
        nodeType: 'videoGen',
      },
      {
        data: {
          fileId: audioFileId,
          status: 'done',
          label: `${sourceTitle}-分离音频`,
        },
        gridRow: 1,
        gridCol: 0,
        nodeType: 'audioGen',
      },
    ], { skipEdges: true });  // 跳过自动连线，手动创建含 handle 标识的边

    // 手动创建连线，明确指定 handle 标识
    const store = useCanvasStore.getState();
    store.addEdge(id, newNodeIds[0], 'output:video', 'input:default');
    store.addEdge(id, newNodeIds[1], 'output:audio', 'input:default');

    // Auto-select the video child node
    store.selectNode(newNodeIds[0]);

    message.success('音视频分离完成');
    setSeparateTaskId(null);
    setAudioSeparatingType(null);
    useCanvasStore.getState().finishNodeProcess(id, 'done');
  }

  if (separateStatus.status === 'error' && separateTaskId) {
    const errMsg = separateStatus.data.error || '分离失败';
    message.error(errMsg);
    setSeparateTaskId(null);
    setAudioSeparatingType(null);
    useCanvasStore.getState().finishNodeProcess(id, 'error', errMsg);
  }
}, [separateStatus.status, separateStatus.data, separateTaskId, id, nodeData?.model, nodeData?.ratio]);

// Unmount cleanup: 顶层 ref + useEffect，符合 Rules of Hooks
const separateTaskIdRef = useRef(separateTaskId);
separateTaskIdRef.current = separateTaskId;
const nodeIdRef = useRef(id);
nodeIdRef.current = id;

useEffect(() => {
  return () => {
    if (separateTaskIdRef.current) {
      setSeparateTaskId(null);
      setAudioSeparatingType(null);
      useCanvasStore.getState().finishNodeProcess(nodeIdRef.current, 'error', 'cancelled');
    }
  };
}, []); // 仅在 mount/unmount 时执行
```

Update VideoNodeToolbar render to pass props:

```tsx
<VideoNodeToolbar
  show={selected && hasMedia && !trimMode}
  onFullscreen={handleOpenFullscreen}
  fullscreenTriggerRef={fullscreenTriggerRef}
  onDownload={handleDownload}
  onTrim={handleOpenTrim}
  onCaptureFrame={handleCaptureFrame}
  capturingType={capturingType}
  onAudioSeparate={handleAudioSeparate}
  audioSeparatingType={audioSeparatingType}
/>
```

- [ ] **Step 6: Update addChildNodes + addEdge to support nodeType, collision, handles, return IDs**

Edit `apps/web/src/stores/canvasStore.ts`:

```typescript
interface AddChildNodeItem {
  data: Record<string, unknown>;
  gridRow: number;
  gridCol: number;
  nodeType?: string;
}

// Optional options bag for addChildNodes (backwards-compatible — existing callers unchanged)
interface AddChildNodesOptions {
  /** When true, skip creating edges from source to child nodes.
   *  Caller is responsible for creating edges manually (e.g. with handle identifiers). */
  skipEdges?: boolean;
}

// Inside addChildNodes:
const nodeType = item.nodeType || sourceNode.type;
if (!Object.values(nodeTypeMap).includes(nodeType)) {
  console.warn(`[addChildNodes] Unknown node type: ${nodeType}`);
}

// Collision detection using resolveGridPosition (reuse existing layout constants)
const GAP = 20;
const nodeW = sourceNode.measured?.width ?? sourceNode.width ?? 400;
const nodeH = sourceNode.measured?.height ?? sourceNode.height ?? 300;
// ... use resolveGridPosition for each child node

// Return created node IDs for caller to use
return newIds;  // already returned, confirm caller receives them
```

**Extend `addEdge` to support handle parameters:**

```typescript
// canvasStore.ts — update addEdge signature
addEdge: (source: string, target: string, sourceHandle?: string, targetHandle?: string) => {
  const id = getId('edge');
  const edge: Edge = { id, source, target, type: 'default', sourceHandle, targetHandle };
  set((s) => ({ edges: [...s.edges, edge] }));
  return id;
},
```

**`resolveGridPosition` implementation — reuse existing `sw/sh/GAP` constants from addChildNodes:**

```typescript
function resolveGridPosition(
  baseX: number, baseY: number, gridRow: number, gridCol: number,
  nodeW: number, nodeH: number, existingNodes: Node[], gap: number,
): { x: number; y: number } {
  let col = gridCol;
  for (let attempt = 0; attempt < 10; attempt++) {
    const x = baseX + col * (nodeW + gap);
    const y = baseY + gridRow * (nodeH + gap);
    const overlaps = existingNodes.some(n => {
      const nw = n.measured?.width ?? n.width ?? 200;
      const nh = n.measured?.height ?? n.height ?? 200;
      return !(x + nodeW < n.position.x || x > n.position.x + nw ||
               y + nodeH < n.position.y || y > n.position.y + nh);
    });
    if (!overlaps) return { x, y };
    col++;
  }
  return { x: baseX, y: baseY + (gridRow + 1) * (nodeH + gap) };
}
```

- [ ] **Step 7: Run canvas tests**

```bash
cd D:/flowweb/apps/web && npx vitest run src/pages/canvas/
```

Expected: All existing tests continue to PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.tsx apps/web/src/pages/canvas/components/nodes/VideoNodeToolbar.test.tsx apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx apps/web/src/stores/canvasStore.ts
git commit -m "feat(canvas): integrate video separate flow — toolbar, VideoGenNode, addChildNodes with nodeType"
```

---

### Task 11: Integration verification

**Files:** No new files. Verify end-to-end flow.

- [ ] **Step 1: TypeScript type check**

```bash
cd D:/flowweb/apps/api && npx tsc --noEmit
cd D:/flowweb/apps/web && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 2: Run all backend tests**

```bash
cd D:/flowweb/apps/api && npx vitest run
```

Expected: All tests PASS (new + existing).

- [ ] **Step 3: Run all frontend tests**

```bash
cd D:/flowweb/apps/web && npx vitest run
```

Expected: All tests PASS (new + existing).

- [ ] **Step 4: Manual verification checklist**

1. Start services: `pnpm dev`
2. Upload a test video to a videoGen node
3. Click video node → toolbar appears → click [音频分离] → [音视频分离]
4. Verify: button shows loading, Socket `processing` event received
5. Verify: upon completion, 2 child nodes created (videoGen + audioGen)
6. Verify: both child nodes connected to source via edges
7. Verify: child nodes have semantic labels (`{title}-无音频`, `{title}-分离音频`)
8. Verify: child video plays, child audio shows waveform/plays
   - **重要**：确认音频节点支持 `audio/mp4` (.m4a) 格式。`.m4a` 使用 `audio/mp4` MIME（IANA 标准），浏览器原生 `<audio>` 支持。
   - 若前端 AudioGenNode 的白名单不包含 `audio/mp4`，需补充该类型。
9. Test: delete source node before separation completes → no crash
10. Test: click "仅保留人声" → disabled, tooltip shows
11. Test: server restart while task is processing → Redis counter reconciled on startup

- [ ] **Step 5: Pre-deployment checklist**

1. Confirm FFmpeg/ffprobe installed on worker host:
   ```bash
   ffmpeg -version
   ffprobe -version
   ```
2. Verify env vars: `FFMPEG_PATH`, `FFPROBE_PATH` (default: `ffmpeg`/`ffprobe` on PATH)
3. **Confirm Node.js >= 18.15.0 on worker host** (required by `fs/promises.statfs`):
   ```bash
   node -v  # must be >= v18.15.0
   ```
4. Verify `/tmp/video-separate/` read/write permissions for worker process
5. Confirm Redis connection pool supports concurrent INCR/DECR ops
6. Confirm MinIO bucket CORS (already configured for the SaaS domain)
7. Verify API route `/api/execution/video-separate` accessible behind APISIX gateway
8. Run DB migration: `npx prisma migrate deploy`

- [ ] **Step 6: Final commit (if needed)**

```bash
git add .
git commit -m "chore: final integration verification fixes, deploy checklist"
```

---

## Dependency Graph

```
Task 1 (MediaProcessService) ──┐
Task 2 (queue constants) ──────┤
Task 3 (DB migration) ─────────┼──→ Task 5 (service TDD)
                               │         │
                               │         └──→ Task 6 (processor TDD)
                               │                   │
                               │                   └──→ Task 7 (controller+cron+metrics+gateway+module)
                               │
Task 4 (types+consts) ─────────┘

Task 8 (frontend hooks+api) ──→ Task 9 (nodeProcessMap) ──→ Task 10 (toolbar+VideoGenNode)
                                                                     │
                                                                     └──→ Task 11 (integration)
```

Tasks 1-4 can run in parallel. Tasks 5-6 are sequential. Task 7 depends on 5-6. Tasks 8-10 are sequential on frontend. Task 11 is final.
