import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from '@flowweb/shared';

function mapMutexError(e: unknown): unknown {
  if ((e as { code?: string })?.code === 'P2002') {
    return new ConflictException('已有启用中的公告，请先禁用');
  }
  return e;
}

@Injectable()
export class ContentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCards() {
    return this.prisma.contentCard.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getActiveAnnouncement() {
    return this.prisma.announcement.findFirst({
      where: { active: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listAnnouncements() {
    return this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAnnouncement(dto: CreateAnnouncementDto) {
    const data = {
      message: dto.message,
      bgColor: dto.bgColor ?? '#0f2761',
      textColor: dto.textColor ?? '#ffffff',
      linkText: dto.linkText ?? null,
      linkUrl: dto.linkUrl ?? null,
      active: dto.active ?? false,
    };
    if (!data.active) {
      return this.prisma.announcement.create({ data });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.announcement.updateMany({ where: { active: true }, data: { active: false } });
        return tx.announcement.create({ data });
      });
    } catch (e) {
      throw mapMutexError(e);
    }
  }

  async updateAnnouncement(id: string, dto: UpdateAnnouncementDto) {
    const data: Record<string, unknown> = {};
    if (dto.message !== undefined) data.message = dto.message;
    if (dto.bgColor !== undefined) data.bgColor = dto.bgColor;
    if (dto.textColor !== undefined) data.textColor = dto.textColor;
    if (dto.linkText !== undefined) data.linkText = dto.linkText;
    if (dto.linkUrl !== undefined) data.linkUrl = dto.linkUrl;
    if (dto.active !== undefined) data.active = dto.active;

    if (data.active !== true) {
      return this.prisma.announcement.update({ where: { id }, data });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.announcement.updateMany({ where: { active: true }, data: { active: false } });
        return tx.announcement.update({ where: { id }, data });
      });
    } catch (e) {
      throw mapMutexError(e);
    }
  }

  async deleteAnnouncement(id: string) {
    return this.prisma.announcement.delete({ where: { id } });
  }
}
