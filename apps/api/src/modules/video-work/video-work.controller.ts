// 空壳，签名一次到位——rateLimiter 供 Task 4.2 getClientIp、cloneService 供 Task 6.2
import { Controller, Get, Query, Param, Post, Req, Inject, UnauthorizedException } from '@nestjs/common';
import { VideoWorkService } from './video-work.service';
import { VideoWorkCloneService } from './video-work-clone.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';

@Controller('api/video-works')
export class VideoWorkController {
  // 第八轮：三参与 Task 1.3 骨架完全一致（整块粘贴不会丢注入——Task 4.2 recordView 用 rateLimiter、6.2 用 cloneService）
  constructor(
    @Inject(VideoWorkService) private readonly service: VideoWorkService,
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService,
    @Inject(VideoWorkCloneService) private readonly cloneService: VideoWorkCloneService, // Task 6.1 前是空壳类，可注入
  ) {}

  @Get('categories')
  listCategories() { return this.service.listCategoriesPublic(); }

  @Get('settings') // 公开轮播设置（service.getSettings() Task 2.6 已定义——admin/公开共用）
  getSettings() { return this.service.getSettings(); }

  @Get()
  list(@Query('categoryId') categoryId: string | undefined,
       @Query('page') page = '1',
       @Query('pageSize') pageSize = '20') {
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(50, Math.max(1, Number(pageSize) || 20)); // 手写 clamp（X12）
    return this.service.listPublished(categoryId, p, ps);
  }

  @Get(':id')
  getDetail(@Param('id') id: string, @Req() req: any) {
    return this.service.getDetail(id, req.user?.id ?? null);
  }

  @Get(':id/process')
  getProcess(@Param('id') id: string) {
    return this.service.getProcessSnapshot(id);
  }

  @Post(':id/view')
  recordView(@Param('id') id: string, @Req() req: any) {
    return this.service.recordView(id, this.rateLimiter.getClientIp(req));
  }

  @Post(':id/like')
  async toggleLike(@Param('id') id: string, @Req() req: any) {
    if (!req.user?.id) throw new UnauthorizedException(); // D15：登录才能点赞（async——401 以 promise rejection 送达，同步 throw 会逸出 .rejects 断言）
    return this.service.toggleLike(id, req.user.id);
  }

  // Task 5.3 process / Task 6.2 clone 追加
}
