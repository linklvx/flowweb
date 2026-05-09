import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
    });
  }
}
