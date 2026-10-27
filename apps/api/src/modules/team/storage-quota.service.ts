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
    return Number(agg._sum.size ?? 0); // Media.size BigInt（T2 质评收口）——用量算术域保持 number（T6 收紧：禁全局 BigInt.prototype.toJSON，序列化在响应构造处显式转换——本返回已 number 无 BigInt 面）
  }

  /** Y1c T23（迁移三——spec §6.3 资源回收）：ACTIVE 预留字节数（在飞上传的上界预留——pending 行
   *  尚未入 usage，预留即其配额占位；confirm→SETTLED 实字节入账后停止计入=双计收口）。
   *  excludeMediaId=confirm 终判场景排除自身（自身字节经 actualSize 入账）。 */
  private async activeReservationBytes(teamId: string, excludeMediaId?: string): Promise<number> {
    const agg = await this.prisma.storageReservation.aggregate({
      _sum: { upperBoundBytes: true },
      where: { teamId, state: 'ACTIVE', ...(excludeMediaId ? { mediaId: { not: excludeMediaId } } : {}) },
    });
    return Number(agg._sum.upperBoundBytes ?? 0);
  }

  /** presign 前校验（Q7 第一道）。
   *  Y1c T23：ACTIVE 预留计入硬门——「两并发 presign 同过」oversale 收口（usage+ΣACTIVE+incoming
   *  三段和；预留随锚行终态原子 SETTLED/RELEASED，无独立 TTL 释放=无让渡-确认竞态窗）。 */
  async assertCanUpload(teamId: string, incomingBytes: number): Promise<void> {
    const { storageLimitBytes } = await this.subscription.getLimits(teamId);
    const usage = await this.getUsage(teamId);
    const reserved = await this.activeReservationBytes(teamId);
    if (usage + reserved + incomingBytes > storageLimitBytes) {
      throw new BadRequestException('存储空间不足，请清理素材或升级团队订阅');
    }
  }

  /** confirm 二次校验（Q7：两并发 presign 可同过，confirm 按 actualSize 终判）；
   *  超限：删 MinIO 对象 + 删 pending Media + 抛错。
   *  D1：key 形参已删（bucket 本是死参）——删的是行内 media.key。原 key 形参吃请求体，
   *  构成任意对象删除面（自 presign 造 pending 行 + 传受害者 key 即可删任意已发布作品对象）。
   *  Y1c T23：ACTIVE 预留计入（排除自身——自身字节经 actualSize 入账；他者在飞预留照计）；
   *  拒档=对象删+行删+预留 RELEASED 同事务原子（锚行终态迁移=释放唯一时机）。 */
  async assertOnConfirm(mediaId: string, actualSize: number): Promise<void> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media?.teamId) return;
    const { storageLimitBytes } = await this.subscription.getLimits(media.teamId);
    const usage = await this.getUsage(media.teamId);
    const reserved = await this.activeReservationBytes(media.teamId, mediaId);
    if (usage + reserved + actualSize > storageLimitBytes) {
      try {
        await this.minio.delete(media.key);
      } catch {
        // 对象不存在——继续删记录
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.media.delete({ where: { id: mediaId } });
        await tx.storageReservation.updateMany({
          where: { mediaId, state: 'ACTIVE' },
          data: { state: 'RELEASED' },
        });
      });
      throw new BadRequestException('存储空间不足，上传已取消');
    }
  }

  /** 素材直传归属校验（D4）：用户须为 teamId 成员（规范实现在 team.util.ts，此处委托防双实现漂移） */
  async assertMember(teamId: string, userId: string): Promise<void> {
    await assertTeamMember(this.prisma, teamId, userId);
  }
}
