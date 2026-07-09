import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';

const MAX_RETRIES = 3;

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

  // ========== Dual-account methods ==========

  /**
   * Business consumption: subscription-first deduction.
   * Priority: subscriptionCredits → credits (regular).
   * Updates consumedCredits on active subscription.
   * Writes CreditTransaction internally (type=consumption, referenceType=execution).
   */
  async consume(userId: string, amount: number, relatedId: string): Promise<void> {
    let retries = 0;

    while (retries < MAX_RETRIES) {
      const current = await this.prisma.userBalance.findUnique({ where: { userId } });
      if (!current) throw new BusinessException('CREDIT_INSUFFICIENT', '余额不存在');

      const subAvail = current.subscriptionCredits;
      const regAvail = current.credits;
      const totalAvail = subAvail + regAvail;

      if (totalAvail < amount) {
        throw new BusinessException('CREDIT_INSUFFICIENT', '积分余额不足');
      }

      const subDeduct = Math.min(subAvail, amount);
      const regDeduct = amount - subDeduct;

      const updateData: Record<string, unknown> = {
        version: { increment: 1 },
      };
      if (subDeduct > 0) updateData.subscriptionCredits = { decrement: subDeduct };
      if (regDeduct > 0) updateData.credits = { decrement: regDeduct };

      const result = await this.prisma.userBalance.updateMany({
        where: { userId, version: current.version },
        data: updateData,
      });

      if (result.count === 0) {
        retries++;
        continue; // version conflict → retry
      }

      // Read balance after successful deduction
      const updated = await this.prisma.userBalance.findUnique({ where: { userId } });

      // Update consumedCredits if subscription was used
      if (subDeduct > 0) {
        await this.prisma.userSubscription.updateMany({
          where: { userId, status: 'active' },
          data: { consumedCredits: { increment: subDeduct } },
        });
      }

      // Write CreditTransaction(s)
      if (subDeduct > 0) {
        await this.prisma.creditTransaction.create({
          data: {
            userId,
            amount: -subDeduct,
            type: 'consumption',
            creditType: 'subscription',
            referenceId: relatedId,
            referenceType: 'execution',
            balanceAfter: updated!.subscriptionCredits,
          },
        });
      }
      if (regDeduct > 0) {
        await this.prisma.creditTransaction.create({
          data: {
            userId,
            amount: -regDeduct,
            type: 'consumption',
            creditType: 'regular',
            referenceId: relatedId,
            referenceType: 'execution',
            balanceAfter: updated!.credits,
          },
        });
      }

      return;
    }

    throw new BusinessException('CREDIT_INSUFFICIENT', '操作冲突，请重试');
  }

  /**
   * Payment deduction: regular credits only.
   * Does NOT touch subscription credits or consumedCredits.
   * Writes CreditTransaction internally (type=subscription_payment, referenceType=order).
   */
  async deductRegular(userId: string, amount: number, relatedId: string): Promise<void> {
    let retries = 0;

    while (retries < MAX_RETRIES) {
      const current = await this.prisma.userBalance.findUnique({ where: { userId } });
      if (!current) throw new BusinessException('CREDIT_INSUFFICIENT', '余额不存在');

      if (current.credits < amount) {
        throw new BusinessException('CREDIT_INSUFFICIENT', '普通积分不足');
      }

      const result = await this.prisma.userBalance.updateMany({
        where: { userId, version: current.version, credits: { gte: amount } },
        data: { credits: { decrement: amount }, version: { increment: 1 } },
      });

      if (result.count === 0) {
        retries++;
        continue; // version conflict or balance changed → retry
      }

      const updated = await this.prisma.userBalance.findUnique({ where: { userId } });

      await this.prisma.creditTransaction.create({
        data: {
          userId,
          amount: -amount,
          type: 'subscription_payment',
          creditType: 'regular',
          referenceId: relatedId,
          referenceType: 'order',
          balanceAfter: updated!.credits,
        },
      });

      return;
    }

    throw new BusinessException('CREDIT_INSUFFICIENT', '操作冲突，请重试');
  }
}
