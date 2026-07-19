import {
  Controller, Get, Patch, Post, Body, UploadedFile, Req,
  UseInterceptors, BadRequestException, Inject,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SubscriptionBannerService } from '../subscription-banner.service';
import { UpdateBannerDto } from '../dto/update-banner.dto';
import { MinioService } from '../../minio/minio.service';

@Controller('api/admin/subscription')
export class AdminBannerController {
  constructor(
    @Inject(SubscriptionBannerService) private readonly bannerService: SubscriptionBannerService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  @Get('banner')
  async getAdminBanner() {
    return this.bannerService.getAdminBanner();
  }

  @Patch('banner')
  async updateBanner(@Body() dto: UpdateBannerDto, @Req() req: any) {
    return this.bannerService.updateBanner(dto, req.user?.id);
  }

  @Post('banner/upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.mimetype)) {
        return cb(new BadRequestException('仅支持 jpg/png/webp'), false);
      }
      cb(null, true);
    },
  }))
  async uploadBannerImage(@UploadedFile() file: { buffer: Buffer; mimetype: string }) {
    if (!file) throw new BadRequestException('未上传文件');

    // Magic number validation
    const head = file.buffer;
    const isJPEG = head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF;
    const isPNG  = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47;
    const isWebP = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
                && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    if (!(isJPEG || isPNG || isWebP)) {
      throw new BadRequestException('文件类型不匹配');
    }

    // Upload to MinIO
    const ext = file.mimetype.split('/')[1];
    const key = this.minio.buildKey('uploaded', 'system', { ext: ext === 'jpeg' ? 'jpg' : ext });
    await this.minio.upload(key, file.buffer, file.mimetype);

    return { imageKey: key };
  }
}
