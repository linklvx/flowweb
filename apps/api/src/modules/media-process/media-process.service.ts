import { Injectable, Logger, Inject } from '@nestjs/common';
import { spawn } from 'child_process';
import { mkdir, rm, readFile } from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { getOwnerTeamId } from '../team/team.util';
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
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
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
        teamId: await getOwnerTeamId(this.prisma, userId),
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
