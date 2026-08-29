import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { TeamSubscriptionService } from './team-subscription.service';
import { assertTeamMember } from './team.util';

@Injectable()
export class StorageQuotaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(TeamSubscriptionService) private readonly subscription: TeamSubscriptionService,
  ) {}

  /** 用量 = completed 且未软删的 Media size 之和 */
  async getUsage(teamId: string): Promise<number> {
    const agg = await this.prisma.media.aggregate({
      _sum: { size: true },
      where: { teamId, status: 'completed', deletedAt: null },
    });
    return agg._sum.size ?? 0;
  }

  /** presign 前校验（Q7 第一道） */
  async assertCanUpload(teamId: string, incomingBytes: number): Promise<void> {
    const { storageLimitBytes } = await this.subscription.getLimits(teamId);
    const usage = await this.getUsage(teamId);
    if (usage + incomingBytes > storageLimitBytes) {
      throw new BadRequestException('存储空间不足，请清理素材或升级团队订阅');
    }
  }

  /** confirm 二次校验（Q7：两并发 presign 可同过，confirm 按 actualSize 终判）；
   * 超限：删 MinIO 对象 + 删 pending Media + 抛错 */
  async assertOnConfirm(mediaId: string, actualSize: number, key: string, bucket: string): Promise<void> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media?.teamId) return;
    const { storageLimitBytes } = await this.subscription.getLimits(media.teamId);
    const usage = await this.getUsage(media.teamId);
    if (usage + actualSize > storageLimitBytes) {
      try {
        await this.minio.delete(key);
      } catch {
        // 对象不存在——继续删记录
      }
      await this.prisma.media.delete({ where: { id: mediaId } });
      throw new BadRequestException('存储空间不足，上传已取消');
    }
  }

  /** 素材直传归属校验（D4）：用户须为 teamId 成员（规范实现在 team.util.ts，此处委托防双实现漂移） */
  async assertMember(teamId: string, userId: string): Promise<void> {
    await assertTeamMember(this.prisma, teamId, userId);
  }
}
