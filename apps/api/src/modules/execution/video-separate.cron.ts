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
