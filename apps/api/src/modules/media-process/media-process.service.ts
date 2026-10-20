import { Injectable, Logger, Inject } from '@nestjs/common';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdir, rm, readFile } from 'fs/promises';
import * as path from 'path';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { getOwnerTeamId } from '../team/team.util';
import { MinioService } from '../minio/minio.service';

// T34（Z79/RC3）：模块级 const（import 期冻结=违规面）改调用期读函数（video-trim.constants 同款）
function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}
export function ffprobePath(): string {
  return process.env.FFPROBE_PATH || 'ffprobe';
}
const MAX_TASK_DURATION_MS = 5 * 60 * 1000;

// Y1a+Y1b T7（spec Z7''）：ffmpeg/ffprobe 沙箱白名单+ffprobe 统一超时——trim/separate/thumbnail
// 消费面同批改（本地临时文件=face 'file'；http/https/tcp/tls 维持同清单——media-probe.poller 同源常量）
export const FFMPEG_PROTOCOL_WHITELIST = 'file,http,https,tcp,tls';
export const FFPROBE_TIMEOUT_MS = 15_000;

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

export interface DownloadObjectOptions {
  timeoutMs: number;
  retries: number;
}

@Injectable()
export class MediaProcessService {
  private readonly logger = new Logger(MediaProcessService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  /** T7 沙箱：ffprobe 统一 spawn（数组形态无 shell+protocol_whitelist 前置+15s 超时 SIGKILL） */
  private runFfprobe(args: string[], timeoutMs: number = FFPROBE_TIMEOUT_MS): Promise<string> {
    const fullArgs = ['-v', 'error', '-protocol_whitelist', FFMPEG_PROTOCOL_WHITELIST, ...args];
    return new Promise((resolve, reject) => {
      const proc = spawn(ffprobePath(), fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`ffprobe execution timeout (${timeoutMs}ms)`));
      }, timeoutMs);
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`ffprobe exited with code ${code}`));
      });
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  async detectAudio(inputPath: string): Promise<boolean> {
    return this.runFfprobe(['-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', inputPath])
      .then((stdout) => stdout.trim() === 'audio')
      .catch(() => false);
  }

  async detectAudioCodec(inputPath: string): Promise<string | null> {
    return this.runFfprobe(['-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', inputPath])
      .then((stdout) => stdout.trim() || null)
      .catch(() => null);
  }

  async detectDuration(inputPath: string): Promise<number> {
    const stdout = await this.runFfprobe(['-show_entries', 'format=duration', '-of', 'csv=p=0', inputPath]);
    return parseFloat(stdout.trim());
  }

  async detectMetadata(inputPath: string): Promise<Record<string, unknown>> {
    const metadata: Record<string, unknown> = {};

    try { metadata.duration = await this.detectDuration(inputPath); } catch { /* optional */ }

    try {
      const videoInfo = await this.runFfprobe([
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,codec_name,bit_rate', '-of', 'csv=p=0', inputPath,
      ]);
      if (videoInfo.trim()) {
        const parts = videoInfo.trim().split(',');
        if (parts[0]) metadata.width = parseInt(parts[0], 10);
        if (parts[1]) metadata.height = parseInt(parts[1], 10);
        if (parts[2]) metadata.videoCodec = parts[2];
        if (parts[3]) metadata.bitrate = parseInt(parts[3], 10);
      }
    } catch { /* video stream optional */ }

    try {
      const audioInfo = await this.runFfprobe([
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name,bit_rate', '-of', 'csv=p=0', inputPath,
      ]);
      if (audioInfo.trim()) {
        const parts = audioInfo.trim().split(',');
        if (parts[0]) metadata.audioCodec = parts[0];
        if (parts[1]) metadata.audioBitrate = parseInt(parts[1], 10);
      }
    } catch { /* audio stream optional */ }

    return metadata;
  }

  runFfmpeg(args: string[], timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? MAX_TASK_DURATION_MS;
    // T7 沙箱：白名单前置（全局 option——须在首个 -i 前）+既有 5min SIGKILL 维持
    const fullArgs = ['-protocol_whitelist', FFMPEG_PROTOCOL_WHITELIST, ...args];
    this.logger.log(`FFmpeg: ${fullArgs.join(' ')}`);

    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath(), fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
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

    // 归属 = project.teamId（project 缺失即失败，不回落个人团队）；projectId 为空（个人素材）回落个人团队
    let teamId: string;
    if (projectId) {
      const projectTeamId = (await this.prisma.canvasProject.findUnique({
        where: { id: projectId },
        select: { teamId: true },
      }))?.teamId;
      if (!projectTeamId) {
        Sentry.captureException(new Error(`media-process: project team missing for project ${projectId}`));
        throw new Error('PROJECT_TEAM_MISSING');
      }
      teamId = projectTeamId;
    } else {
      teamId = await getOwnerTeamId(this.prisma, userId);
    }

    const media = await this.prisma.media.create({
      data: {
        userId,
        teamId,
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

  /** T6 登记承接（Y1b T7 落地）：minio SDK 直取（getObject 流落盘）——内网数据搬运不经
   *  presigned HTTP 往返+消 SSRF 门必拒面（旧 downloadWithRetry 下载自家 presigned URL 形态退役）。
   *  超时断流（timeoutMs 销毁流+dest）+重试语义维持（retries 次内 ECONNRESET 类可重试）。 */
  async downloadObjectToFile(
    key: string,
    destPath: string,
    options: DownloadObjectOptions,
  ): Promise<void> {
    for (let attempt = 0; attempt <= options.retries; attempt++) {
      try {
        const stream = await this.minio.getObject(key);   // 取流失败（网络类）同样进重试
        const dest = createWriteStream(destPath);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            stream.destroy();
            dest.destroy();
            reject(new Error(`Download timeout (${options.timeoutMs}ms)`));
          }, options.timeoutMs);
          stream.on('data', (c: Buffer) => dest.write(c));
          stream.on('end', () => dest.end(() => {
            clearTimeout(timer);
            resolve();
          }));
          stream.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
          dest.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
        });
        return;
      } catch (err) {
        if (attempt === options.retries) throw err;
        this.logger.warn(`Download retry ${attempt + 1}/${options.retries}: ${(err as Error).message}`);
      }
    }
  }
}
