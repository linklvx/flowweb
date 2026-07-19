import { Controller, Get, Inject } from '@nestjs/common';
import { SubscriptionBannerService } from './subscription-banner.service';

@Controller('api/subscription')
export class SubscriptionBannerPublicController {
  constructor(
    @Inject(SubscriptionBannerService) private readonly bannerService: SubscriptionBannerService,
  ) {}

  @Get('banner')
  async getPublicBanner() {
    return this.bannerService.getPublicBanner();
  }
}
