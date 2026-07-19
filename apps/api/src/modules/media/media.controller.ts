import { Controller, Get, Param, Query, UseGuards, Req, Inject, BadRequestException } from '@nestjs/common';
import { MediaService } from './media.service';
import { MinioService } from '../minio/minio.service';
import { AuthGuard } from '../../auth/auth.guard';

@Controller('api/media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly mediaService: MediaService,
    @Inject(MinioService) private readonly minioService: MinioService,
  ) {}

  @Get(':fileId/url')
  async getUrl(@Req() req: any, @Param('fileId') fileId: string) {
    const url = await this.mediaService.getMediaUrl(fileId, req.user.id);
    return { url };
  }

  @Get('by-key')
  async getUrlByKey(@Query('key') key: string) {
    if (!key) throw new BadRequestException('key is required');
    const url = await this.minioService.generatePresignedGetUrl(key, 900);
    return { url };
  }
}
