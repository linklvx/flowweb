import { Controller, Get, Inject, Req, UnauthorizedException } from '@nestjs/common';
import { CreditService } from './credit.service';

@Controller('api/credits')
export class CreditController {
  constructor(@Inject(CreditService) private readonly service: CreditService) {}

  @Get('balance')
  async getBalance(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    const balance = await this.service.getOrCreateBalance(userId);
    return {
      credits: balance.credits,
      updatedAt: balance.updatedAt.toISOString(),
    };
  }
}
