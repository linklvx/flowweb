import { Module } from '@nestjs/common';
import { HomeBannerController } from './home-banner.controller';
import { AdminHomeBannerController } from './admin-home-banner.controller';
import { HomeBannerService } from './home-banner.service';

@Module({
  controllers: [HomeBannerController, AdminHomeBannerController],
  providers: [HomeBannerService],
})
export class HomeBannerModule {}
