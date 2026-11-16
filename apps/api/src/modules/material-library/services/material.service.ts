import { Injectable, Inject, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { THUMBNAIL_GENERATOR_QUEUE } from '../constants/material-library.constants';
import { getOwnerTeamId, assertTeamMember } from '../../team/team.util';
import { restoreMediaToActive, MEDIA_DELETING_TX_TIMEOUT_MS } from '../../media-delivery/media-gc.service';
import { StorageQuotaService } from '../../team/storage-quota.service';

/** Media 行 DTO 白名单（Y1a T8：sourceUrl 零泄漏——provider 原始 URL 禁入任何响应面）。
 *  Prisma 5.22 生成 client 未启用 omitApi preview（构造器全局 omit/查询级 omit 均不可用）——
 *  出口统一 select 白名单（任务卡 fallback）；字段=shared MaterialFile 契约消费面+
 *  动态 URL 取数键（key/thumbnailKey——presign 产能非泄漏面）。导出=spec 断言对照。 */
export const MEDIA_DTO_SELECT = {
  id: true, key: true, originalName: true, mimeType: true, size: true,
  thumbnailKey: true, folderId: true, isFavorite: true, createdAt: true, updatedAt: true,
} as const;

/** 恢复重试判别（spec 2026-11-16-media-restore §1.2）：仅 55P03（FOR UPDATE NOWAIT 锁不可用——
 *  裸 SQLSTATE 或 P2010 包装 meta.code 双形状，artifact-commit.service.ts isRetryableFinalizeError
 *  同款）。P2028/P2024 不认（事务超时/池超时=原样抛，不进退避）。 */
export function isRestoreLockUnavailable(e: unknown): boolean {
  const err = e as { code?: string; meta?: { code?: string } };
  return err?.code === '55P03' || err?.meta?.code === '55P03';
}

@Injectable()
export class MaterialService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minioService: MinioService,
    @InjectQueue(THUMBNAIL_GENERATOR_QUEUE) private readonly thumbnailQueue: Queue,
    @Inject(StorageQuotaService) private readonly quota: StorageQuotaService,
  ) {}

  /** 团队维度入口统一门：外部 teamId 自证成员资格，否则回落本人默认团队 */
  private async resolveTeamId(teamId: string | undefined | null, userId: string): Promise<string> {
    const resolved = teamId ?? (await getOwnerTeamId(this.prisma, userId));
    await assertTeamMember(this.prisma, resolved, userId);
    return resolved;
  }

  /** T6 BigInt 序列化（禁全局 BigInt.prototype.toJSON——DTO/响应边界显式转换）：
   *  Media.size（BigInt 列）→ number（<2^53 展示口径）。Y1a T8 白名单化后响应行仅 size 为
   *  BigInt（factVersion/sourceExecSeq 不在 MaterialFile 契约面——两转换随之退役）。 */
  private serializeMediaRow<T extends Record<string, unknown>>(file: T) {
    return {
      ...file,
      size: Number(file.size),
    };
  }

  async getFilesByFolderId(userId: string, folderId: string | null, type?: 'image' | 'video' | 'audio', teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    const where: any = { teamId: resolved, folderId, deletedAt: null };

    if (type) {
      where.type = 'generated';
      switch (type) {
        case 'image':
          where.mimeType = { startsWith: 'image/' };
          break;
        case 'video':
          where.mimeType = { startsWith: 'video/' };
          break;
        case 'audio':
          where.mimeType = { startsWith: 'audio/' };
          break;
      }
    }

    const files = await this.prisma.media.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: MEDIA_DTO_SELECT,   // Y1a T8：sourceUrl 零泄漏
    });

    // Generate presigned URLs dynamically (never store expiring URLs in DB)
    // 3600s = 1hr for file list, sufficient for browse session
    return Promise.all(
      files.map(async (file) => ({
        ...this.serializeMediaRow(file),   // T6：BigInt 列显式转换（size/factVersion/sourceExecSeq）
        url: await this.minioService.generatePresignedGetUrl(file.key, 3600),
        thumbnailUrl: file.thumbnailKey
          ? await this.minioService.generatePresignedGetUrl(file.thumbnailKey, 3600)
          : null,
      })),
    );
  }

  async moveFile(userId: string, fileId: string, folderId: string | null, teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    // 文件与目标文件夹均按 teamId 过滤——跨团队目标统一报「不存在」，防存在性探测
    const file = await this.prisma.media.findFirst({
      where: { id: fileId, teamId: resolved, deletedAt: null },
      select: { id: true },
    });
    if (!file) throw new BadRequestException('文件不存在');

    if (folderId) {
      const folder = await this.prisma.materialFolder.findFirst({
        where: { id: folderId, teamId: resolved, deletedAt: null },
      });
      if (!folder) throw new BadRequestException('文件夹不存在');
    }

    const updated = await this.prisma.media.update({
      where: { id: fileId },
      data: { folderId },
      select: MEDIA_DTO_SELECT,   // Y1a T8：sourceUrl 零泄漏
    });

    if (!updated.thumbnailKey) {
      await this.thumbnailQueue.add('generate-thumbnail', {
        mediaId: updated.id,
        key: updated.key,
        mimeType: updated.mimeType,
      });
    }

    return this.serializeMediaRow(updated as Record<string, unknown>);   // T6：BigInt 列显式转换
  }

  async toggleFavorite(userId: string, fileId: string, teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    const file = await this.prisma.media.findFirst({
      where: { id: fileId, teamId: resolved, deletedAt: null },
      select: { id: true, isFavorite: true },
    });
    if (!file) throw new BadRequestException('文件不存在');

    const updated = await this.prisma.media.update({
      where: { id: fileId },
      data: { isFavorite: !file.isFavorite },
      select: MEDIA_DTO_SELECT,   // Y1a T8：sourceUrl 零泄漏
    });

    return this.serializeMediaRow(updated as Record<string, unknown>);   // T6：BigInt 列显式转换
  }

  async deleteFile(userId: string, fileId: string, teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    const file = await this.prisma.media.findFirst({
      where: { id: fileId, teamId: resolved, deletedAt: null },
      select: { id: true },
    });
    if (!file) throw new BadRequestException('文件不存在');

    return this.prisma.media.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
      select: MEDIA_DTO_SELECT,   // Y1a T8：sourceUrl 零泄漏
    });
  }

  async deleteFiles(userId: string, ids: string[], teamId?: string): Promise<number> {
    if (ids.length === 0) return 0;
    const resolved = await this.resolveTeamId(teamId, userId);
    const result = await this.prisma.media.updateMany({
      where: { id: { in: ids }, teamId: resolved, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  /** 恢复重试环（spec 2026-11-16-media-restore §1.2——等待只发生在事务外）：候选 FOR UPDATE
   *  NOWAIT 撞删除事务行锁（最长 MEDIA_DELETING_TX_TIMEOUT_MS）→55P03 整笔回滚（Team 锁随放）
   *  →事务外退避睡眠（不持任何行锁）；预算=单行删除事务上界+1s（不乘 MEDIA_GC_PAGE）；
   *  耗尽=409。配额 BadRequest/文件不存在/P2028 原样抛出（不重试）。 */
  async restoreFiles(userId: string, ids: string[], teamId?: string): Promise<number> {
    const resolved = await this.resolveTeamId(teamId, userId);   // 鉴权在重试循环外一次
    if (ids.length === 0) return 0;
    const deadline = Date.now() + MEDIA_DELETING_TX_TIMEOUT_MS + 1000;
    let backoff = 50;
    for (;;) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.restoreInTx(tx, resolved, ids),
          { timeout: 5_000, maxWait: 5_000 },
        );
      } catch (e) {
        if (!isRestoreLockUnavailable(e)) throw e;
        if (Date.now() >= deadline) throw new ConflictException('文件正在删除，请稍后重试');
        await new Promise((r) => setTimeout(r, backoff * (0.5 + Math.random() * 0.5)));
        backoff = Math.min(backoff * 2, 500);
      }
    }
  }

  async restoreFile(userId: string, fileId: string, teamId?: string): Promise<void> {
    const count = await this.restoreFiles(userId, [fileId], teamId);   // 瘦委托——鉴权只在 restoreFiles 里做一次
    if (count === 0) throw new BadRequestException('文件不存在');
  }

  /** 恢复事务体（spec §1.2 严格序）：Team 行锁（配额串行化锚）→候选 FOR UPDATE NOWAIT（等待零发生）
   *  →配额门（incoming>0 才进——软删行重入账字节）→plain 腿（ACTIVE∧软删只清 deletedAt）→
   *  restoreMediaToActive（锁内候选全集——原语不看 teamId，请求体原文不得直传）。两腿 WHERE 互斥
   *  不双计；候选行锁持有到提交=两腿之间 GC 插不进（次序非承重——不得拿掉 FOR UPDATE 用次序冒充锁）。 */
  private async restoreInTx(tx: Prisma.TransactionClient, teamId: string, ids: readonly string[]): Promise<number> {
    await this.quota.lockTeamQuota(tx, teamId);
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Media"
      WHERE "id" = ANY(${[...ids]}::text[]) AND "teamId" = ${teamId}::text AND "deletedAt" IS NOT NULL
      FOR UPDATE NOWAIT`;
    const lockedIds = locked.map((r) => r.id);
    if (lockedIds.length === 0) return 0;
    const agg = await tx.media.aggregate({
      _sum: { size: true },
      where: { id: { in: lockedIds }, status: 'completed', deletedAt: { not: null } },
    });
    const incoming = Number(agg._sum.size ?? 0);                 // getUsage 同算术域（BigInt→number）
    if (incoming > 0) await this.quota.assertCanUploadInTx(tx, teamId, incoming);
    const plain = await tx.$executeRaw`
      UPDATE "Media" SET "deletedAt" = NULL
      WHERE "id" = ANY(${lockedIds}::text[]) AND "teamId" = ${teamId}::text
        AND "deletionState" = 'ACTIVE' AND "deletedAt" IS NOT NULL`;
    const back = await restoreMediaToActive(tx, lockedIds);
    return plain + back;
  }

  async getFileCounts(userId: string, teamId?: string): Promise<{ image: number; video: number; audio: number }> {
    const resolved = await this.resolveTeamId(teamId, userId);
    const counts = await this.prisma.media.groupBy({
      by: ['mimeType'],
      where: { teamId: resolved, deletedAt: null, type: 'generated' },
      _count: true,
    });

    const result = { image: 0, video: 0, audio: 0 };
    counts.forEach((item: { mimeType: string; _count: number }) => {
      if (item.mimeType.startsWith('image/')) result.image += item._count;
      else if (item.mimeType.startsWith('video/')) result.video += item._count;
      else if (item.mimeType.startsWith('audio/')) result.audio += item._count;
    });

    return result;
  }

  async moveFiles(userId: string, ids: string[], folderId: string | null, teamId?: string): Promise<number> {
    if (ids.length === 0) return 0;
    const resolved = await this.resolveTeamId(teamId, userId);
    if (folderId) {
      const folder = await this.prisma.materialFolder.findFirst({
        where: { id: folderId, teamId: resolved, deletedAt: null },
      });
      if (!folder) throw new BadRequestException('文件夹不存在');
    }
    const result = await this.prisma.media.updateMany({
      where: { id: { in: ids }, teamId: resolved, deletedAt: null },
      data: { folderId },
    });
    return result.count;
  }
}
