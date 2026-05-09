import { Controller, Get, Inject, Query } from '@nestjs/common';
import { CreditService } from './credit.service';

@Controller('api/credits')
export class CreditController {
  constructor(@Inject(CreditService) private readonly service: CreditService) {}

  @Get('balance')
  async getBalance(@Query('userId') userId: string) {
    const balance = await this.service.getOrCreateBalance(userId || 'default-user');
    return { credits: balance.credits };
  }
}
