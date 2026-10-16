// 空壳，签名一次到位——cloneService 供 Task 6.2（rateLimiter 注入随 Y0c T36 删 getClientIp 退役——recordView 改 req.ip 单源）
import { Controller, Get, Query, Param, Post, Req, Inject, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { VideoWorkService } from './video-work.service';
import { VideoWorkCloneService } from './video-work-clone.service';

@Controller('api/video-works')
export class VideoWorkController {
  // 第八轮：三参与 Task 1.3 骨架完全一致（整块粘贴不会丢注入——Task 6.2 用 cloneService）
  constructor(
    @Inject(VideoWorkService) private readonly service: VideoWorkService,
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

  // E71（Y0b-2 T8）：公开免费读面收紧 30/min（双层缓存挡不住的对象删除/404 探测——@Throttle 全局守卫形态）
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':id/process')
  getProcess(@Param('id') id: string) {
    return this.service.getProcessSnapshot(id);
  }

  @Post(':id/view')
  recordView(@Param('id') id: string, @Req() req: any) {
    // T36（Z14③）：req.ip 单源（main.ts trust proxy 'loopback'——手写 getClientIp 已删，语义锚 xff-trust-proxy.spec）
    return this.service.recordView(id, req.ip ?? '127.0.0.1');
  }

  @Post(':id/like')
  async toggleLike(@Param('id') id: string, @Req() req: any) {
    if (!req.user?.id) throw new UnauthorizedException(); // D15：登录才能点赞（async——401 以 promise rejection 送达，同步 throw 会逸出 .rejects 断言）
    return this.service.toggleLike(id, req.user.id);
  }

  @Post(':id/clone')
  async clone(@Param('id') id: string, @Req() req: any) {
    if (!req.user?.id) throw new UnauthorizedException(); // 公开前缀下 optional auth（D4）；async——401 以 promise rejection 送达，同步 throw 会逸出 .rejects 断言（toggleLike D15 同款）
    return this.cloneService.clone(id, req.user.id);
  }
}
