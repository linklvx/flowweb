import { Controller, Get, Post, Param, Query, Body, UsePipes, Req, Inject, ValidationPipe } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaBatchService } from './media-batch.service';
import { BatchGetMediaDto } from './media.dto';

// 批7 gate 真启动取证：类级 @UseGuards(AuthGuard) 在宿主模块上下文实例化——批3-3 给 AuthGuard 加
// SessionService 依赖后 MediaModule 解析不到（AuthModule 未导入）启动即炸；且全局 APP_GUARD
// （app.module.ts:95）本就覆盖全部路由，类级注册是双重执行（每请求两次 session touch）。删除。
@Controller('api/media')
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly mediaService: MediaService,
    @Inject(MediaBatchService) private readonly batchService: MediaBatchService,
  ) {}

  @Get(':fileId/url')
  async getUrl(@Req() req: any, @Param('fileId') fileId: string): Promise<{ url: string; ttlSec: number }> {
    return this.mediaService.getMediaUrl(fileId, req.user.id); // 透传（旧 { url } 包装删除）
  }

  @Get('by-key')
  async getUrlByKey(@Query('key') key: string) {
    const url = await this.mediaService.getPresignedUrlByKey(key); // 校验下沉 service，controller 变薄
    return { url };
  }

  // 方法级 ValidationPipe（media.controller 无 class 级 pipe——不挂则 @ArrayMaxSize 等 DTO 装饰器纯装饰，
  // ids 不校验不剥离）；@Query 裸 string 依然不经过 pipe（ValidationPipe 只作用 body 的 metatype）——
  // teamId 为 Prisma 等值 where 无注入面，越权已由 batchGet 内 assertTeamMember 封堵
  @Post('batch')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  batch(@Req() req: any, @Query('teamId') teamId: string | undefined, @Body() dto: BatchGetMediaDto) {
    return this.batchService.batchGet(req.user?.id, teamId, dto.ids);
  }
}
