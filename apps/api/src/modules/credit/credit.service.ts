import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CreditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getBalance(userId: string) {
    return this.prisma.userBalance.findUnique({ where: { userId } });
  }

  async getOrCreateBalance(userId: string) {
    return this.prisma.userBalance.upsert({
      where: { userId },
      create: { userId, credits: 100 },
      update: {},
    });
  }

  async deduct(userId: string, cost: number): Promise<{ success: boolean; newBalance?: number }> {
    const current = await this.prisma.userBalance.findUnique({ where: { userId } });
    if (!current) return { success: false };
    if (current.credits < cost) return { success: false };

    const result = await this.prisma.userBalance.updateMany({
      where: { userId, version: current.version },
      data: { credits: { decrement: cost }, version: { increment: 1 } },
    });

    if (result.count === 0) return { success: false };

    const updated = await this.prisma.userBalance.findUnique({ where: { userId } });
    return { success: true, newBalance: updated!.credits };
  }
}
