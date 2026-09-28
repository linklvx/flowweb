import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { composeStoryboard } from './stitch.composer';
import { STORYBOARD_STITCH_QUEUE } from './storyboard.constants';
import { STITCH_WIDTH_MAP, RATIO_MAP } from './stitch.size';

interface StitchJobData {
  projectId: string;
  userId: string;
  fileIds: string[];
  gridRows: number;
  gridCols: number;
  aspectRatio: string;
  showIndex: boolean;
  resolution: '2K' | '4K';
}

const CONCURRENCY = 3;
const JOB_TIMEOUT_MS = 120_000; // P1-4：bullmq 5.75 无 job timeout 选项，consumer 内部兜底

@Processor(STORYBOARD_STITCH_QUEUE, { concurrency: 2 }) // P1-新2：第二参数是 NestWorkerOptions 对象（@nestjs/bullmq@10.2.1）；4K 合成内存峰值高，限并发
export class StitchConsumer extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
    private gateway: ExecutionGateway,
  ) {
    super();
  }

  async process(job: Job<StitchJobData>) {
    const d = job.data;
    const cellW = Math.round((STITCH_WIDTH_MAP[d.resolution] - (d.gridCols - 1) * 2) / d.gridCols);
    const cellH = Math.round(cellW / RATIO_MAP[d.aspectRatio]);
    const width = STITCH_WIDTH_MAP[d.resolution];

    // P1-4：合成全流程限时（取图+合成+上传），超时抛错走 BullMQ 重试
    const run = async () => {
      // 并发 3 取图（简单分批）
      const buffers: (Buffer | null)[] = new Array(d.fileIds.length).fill(null);
      for (let i = 0; i < d.fileIds.length; i += CONCURRENCY) {
        const batch = d.fileIds.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (fileId, j) => {
            try {
              const media = await this.prisma.media.findUnique({ where: { id: fileId } });
              if (!media) return; // Media 记录缺失 → 留 null（灰占位）
              const stream = await this.minioService.getObject(media.key);
              const chunks: Buffer[] = [];
              for await (const chunk of stream) chunks.push(chunk as Buffer); // 流错误经 for-await 抛出，被此处捕获
              buffers[i + j] = Buffer.concat(chunks);
            } catch {
              // 单图失败 → 该格灰占位继续拼（spec 7.3），不让整个 job 失败
            }
          })
        );
      }
      const failedCount = buffers.filter((b) => b === null).length;
      if (failedCount === d.fileIds.length) throw new Error('全部图片获取失败');

      // 宫格对齐：buffers 按 fileIds 顺序 = cells 顺序（前端保证 cells 先于空位）
      const capacity = d.gridRows * d.gridCols;
      const cells: (Buffer | null)[] = [
        ...buffers,
        ...new Array(capacity - buffers.length).fill(null),
      ];

      const out = await composeStoryboard({
        images: cells,
        cellWidth: cellW,
        cellHeight: cellH,
        rows: d.gridRows,
        cols: d.gridCols,
        gap: 2,
        showIndex: d.showIndex,
      });
      const height = Math.round(d.gridRows * cellH + (d.gridRows - 1) * 2);

      const key = `stitch/${job.id}.jpg`;
      await this.minioService.upload(key, out, 'image/jpeg');
      // 归属 = project.teamId（project 缺失即失败，不回落个人团队）
      const projectTeamId = (await this.prisma.canvasProject.findUnique({
        where: { id: d.projectId },
        select: { teamId: true },
      }))?.teamId;
      if (!projectTeamId) {
        Sentry.captureException(new Error(`stitch: project team missing for project ${d.projectId}`));
        throw new Error('PROJECT_TEAM_MISSING');
      }
      const media = await this.prisma.media.create({
        data: {
          userId: d.userId,
          teamId: projectTeamId,
          bucket: 'flowai',
          key,
          originalName: `storyboard-stitch-${job.id}.jpg`,
          mimeType: 'image/jpeg',
          size: out.length,
          projectId: d.projectId,
          status: 'completed',
          type: 'generated',
        },
      });

      const result = {
        taskId: job.id!,
        fileId: media.id,
        width,
        height,
        cellCount: d.fileIds.length,
        failedCount,
      };
      this.gateway.emitStitchStatus(d.projectId, { ...result, status: 'COMPLETED' });
      return result;
    };

    return Promise.race([
      run(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`拼接任务超时（${JOB_TIMEOUT_MS / 1000}s）`)), JOB_TIMEOUT_MS).unref()
      ),
    ]);
  }
}
