// 空壳，签名一次到位——rateLimiter 供 Task 4.2 getClientIp、cloneService 供 Task 6.2
import { Controller, Inject } from '@nestjs/common';
import { VideoWorkService } from './video-work.service';
import { VideoWorkCloneService } from './video-work-clone.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';

@Controller('api/video-works')
export class VideoWorkController {
  constructor(
    @Inject(VideoWorkService) private readonly service: VideoWorkService,
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService,
    @Inject(VideoWorkCloneService) private readonly cloneService: VideoWorkCloneService, // Task 6.1 前是空壳类，可注入
  ) {}
  // Task 3.x/4.x/5.3/6.2 逐步填充方法
}
