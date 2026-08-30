import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import type { HomeBanner } from '@prisma/client';
import type { CreateHomeBannerDto, UpdateHomeBannerDto } from '@flowweb/shared';

const ORDER_BY = [{ sortOrder: 'asc' }, { createdAt: 'asc' }] as const;

@Injectable()
export class HomeBannerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  async listActive() {
    const rows = await this.prisma.homeBanner.findMany({
      where: { active: true },
      orderBy: [...ORDER_BY],
    });
    return this.withUrls(rows);
  }

  async listAll() {
    const rows = await this.prisma.homeBanner.findMany({
      orderBy: [...ORDER_BY],
    });
    return this.withUrls(rows);
  }

  private async withUrls(rows: HomeBanner[]) {
    return Promise.all(
      rows.map(async (b) => ({
        ...b,
        imageUrl: await this.minio.generatePresignedGetUrl(b.imageKey, 3600),
      })),
    );
  }

  async create(dto: CreateHomeBannerDto) {
    return this.prisma.homeBanner.create({
      data: {
        title: dto.title ?? null,
        subtitle: dto.subtitle ?? null,
        linkUrl: dto.linkUrl ?? null,
        imageKey: dto.imageKey,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateHomeBannerDto) {
    const existing = await this.prisma.homeBanner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner 不存在');

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.subtitle !== undefined) data.subtitle = dto.subtitle;
    if (dto.linkUrl !== undefined) data.linkUrl = dto.linkUrl;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) data.active = dto.active;
    const imageChanged = dto.imageKey !== undefined && dto.imageKey !== existing.imageKey;
    if (imageChanged) data.imageKey = dto.imageKey;

    const updated = await this.prisma.homeBanner.update({ where: { id }, data });
    if (imageChanged) {
      // 换图后清理旧对象；失败不阻断（次要清理，S3 delete 幂等）
      await this.minio.delete(existing.imageKey).catch(() => {});
    }
    return updated;
  }

  async remove(id: string) {
    const existing = await this.prisma.homeBanner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner 不存在');
    // 先删对象再删行：S3 delete 幂等（对象不存在也成功）；失败则抛错，DB 行未删可重试
    await this.minio.delete(existing.imageKey);
    return this.prisma.homeBanner.delete({ where: { id } });
  }
}
