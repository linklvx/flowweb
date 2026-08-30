import { Controller, Get, Inject } from '@nestjs/common';
import { HomeBannerService } from './home-banner.service';

@Controller('api/home-banners')
export class HomeBannerController {
  constructor(@Inject(HomeBannerService) private readonly service: HomeBannerService) {}

  @Get('active')
  listActive() {
    return this.service.listActive();
  }
}
