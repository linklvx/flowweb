import { Controller, Get, Post, Param, Query, Body, UseGuards, UsePipes, Req, Inject, ValidationPipe } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaBatchService } from './media-batch.service';
import { BatchGetMediaDto } from './media.dto';
import { AuthGuard } from '../../auth/auth.guard';

@Controller('api/media')
@UseGuards(AuthGuard)
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
