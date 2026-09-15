// 空壳
import { Controller, Inject } from '@nestjs/common';
import { VideoWorkService } from './video-work.service';

@Controller('api/admin/video-works')
export class AdminVideoWorkController {
  constructor(@Inject(VideoWorkService) private readonly service: VideoWorkService) {}
  // Task 2.x 逐步填充方法
}
