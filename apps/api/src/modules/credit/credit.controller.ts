import { BadRequestException, Controller, Get, Inject, Req, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { availableCredits } from '../team/team.util';

@Controller('api/credits')
export class CreditController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // 换源默认团队 TeamBalance；subscriptionCreditsExpiry 现读 active 订阅（前端订阅态判据，保留字段）
  @Get('balance')
  async getBalance(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    const team = await this.prisma.team.findFirst({ where: { ownerId: userId, isDefault: true } });
    if (!team) throw new BadRequestException('个人团队未初始化');
    const balance = await this.prisma.teamBalance.findUnique({ where: { teamId: team.id } });
    const sub = await this.prisma.userSubscription.findFirst({
      where: { userId, status: 'active', currentPeriodEnd: { gt: new Date() } },
      orderBy: { currentPeriodEnd: 'desc' },
      select: { currentPeriodEnd: true },
    });
    return {
      credits: balance?.credits ?? 0,
      subscriptionCredits: balance?.subscriptionCredits ?? 0,
      total: availableCredits(balance ?? { credits: 0, subscriptionCredits: 0 }),
      subscriptionCreditsExpiry: sub?.currentPeriodEnd?.toISOString() ?? null,
      updatedAt: (balance?.updatedAt ?? new Date()).toISOString(),
    };
  }
}
