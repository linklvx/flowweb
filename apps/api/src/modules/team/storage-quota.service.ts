import { Injectable, Inject, BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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

  /** presign 前校验（Q7 第一道）——**非门禁快路径**（观测/预检面；真门禁=assertCanUploadInTx
   *  事务内〔I-2 收口〕；materialize observeQuota 软限观测消费本形态）。
   *  Y1c T23：ACTIVE 预留计入——「两并发 presign 同过」oversale 收口（usage+ΣACTIVE+incoming
   *  三段和；预留随锚行终态原子 SETTLED/RELEASED，无独立 TTL 释放=无让渡-确认竞态窗）。 */
  async assertCanUpload(teamId: string, incomingBytes: number): Promise<void> {
    const { storageLimitBytes } = await this.subscription.getLimits(teamId);
    const usage = await this.getUsage(teamId);
    const reserved = await this.activeReservationBytes(teamId);
    if (usage + reserved + incomingBytes > storageLimitBytes) {
      throw new BadRequestException('存储空间不足，请清理素材或升级团队订阅');
    }
  }

  /** Y1c T23 收口 I-2（Q7 根修——assert→insert 无锁非原子）：presign 门禁事务内形态——
   *  ①Team 行 FOR UPDATE=同团队 presign 串行化锚（锁序纪律：业务行→counter 先例——Team 行先于
   *  预留读/写）；②usage+ΣACTIVE+incoming 三段和（prepareUploadInTx 事务内消费——对方未提交
   *  预留经行锁排队后可见，双并发恰一方过门）。 */
  async assertCanUploadInTx(tx: Prisma.TransactionClient, teamId: string, incomingBytes: number): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId}::text FOR UPDATE`;
    const { storageLimitBytes } = await this.subscription.getLimits(teamId);
    const usageAgg = await tx.media.aggregate({
      _sum: { size: true },
      where: { teamId, status: 'completed', deletedAt: null },
    });
    const reservedAgg = await tx.storageReservation.aggregate({
      _sum: { upperBoundBytes: true },
      where: { teamId, state: 'ACTIVE' },
    });
    const usage = Number(usageAgg._sum.size ?? 0);
    const reserved = Number(reservedAgg._sum.upperBoundBytes ?? 0);
    if (usage + reserved + incomingBytes > storageLimitBytes) {
      throw new BadRequestException('存储空间不足，请清理素材或升级团队订阅');
    }
  }

  /** confirm 二次校验（Q7：两并发 presign 可同过，confirm 按 actualSize 终判）；
   *  超限拒档。D1：key 形参已删（bucket 本是死参）——删的是行内 media.key。原 key 形参吃请求体，
   *  构成任意对象删除面（自 presign 造 pending 行 + 传受害者 key 即可删任意已发布作品对象）。
   *  Y1c T23：ACTIVE 预留计入（排除自身——自身字节经 actualSize 入账；他者在飞预留照计）。
   *  T23 收口 M-7：**对象删除永远是最后一步**——先行=pending 行终态 CAS 删行+预留 RELEASED 同
   *  事务（CAS 0 命中=并发 confirm 已完成档让位——对象归 confirm 所有不删，409 镜像 confirmInTx
   *  冲突档）；CAS 命中后对象删（404 容忍）。 */
  async assertOnConfirm(mediaId: string, actualSize: number): Promise<void> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media?.teamId) return;
    const { storageLimitBytes } = await this.subscription.getLimits(media.teamId);
    const usage = await this.getUsage(media.teamId);
    const reserved = await this.activeReservationBytes(media.teamId, mediaId);
    if (usage + reserved + actualSize > storageLimitBytes) {
      const claimed = await this.prisma.$transaction(async (tx) => {
        // 行终态 CAS：pending 守卫删行（并发 confirm 已完成=0 行让位——对象不删）
        const r = await tx.media.deleteMany({ where: { id: mediaId, status: 'pending' } });
        if (r.count === 0) return false;
        await tx.storageReservation.updateMany({
          where: { mediaId, state: 'ACTIVE' },
          data: { state: 'RELEASED' },
        });
        return true;
      });
      if (!claimed) {
        // 并发 confirm 已完成档——对象归 confirm 所有（M-7：旧形态 minio.delete 先行=误删其对象
        // 而行终态悬挂）；quota 超限事实交由该 confirm 流程自身语义。
        throw new ConflictException('上传已在确认中或已完成');
      }
      try {
        await this.minio.delete(media.key);
      } catch {
        // 对象不存在——继续（行已终态）
      }
      throw new BadRequestException('存储空间不足，上传已取消');
    }
  }

  /** 素材直传归属校验（D4）：用户须为 teamId 成员（规范实现在 team.util.ts，此处委托防双实现漂移） */
  async assertMember(teamId: string, userId: string): Promise<void> {
    await assertTeamMember(this.prisma, teamId, userId);
  }
}
