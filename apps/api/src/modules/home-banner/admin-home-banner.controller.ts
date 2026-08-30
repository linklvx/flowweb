import {
  BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post,
  UploadedFile, UseInterceptors, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { HomeBannerService } from './home-banner.service';
import { MinioService } from '../minio/minio.service';
import { CreateHomeBannerDto } from './dto/create-home-banner.dto';
import { UpdateHomeBannerDto } from './dto/update-home-banner.dto';

@Controller('api/admin/home-banners')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AdminHomeBannerController {
  constructor(
    @Inject(HomeBannerService) private readonly service: HomeBannerService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  @Get()
  list() {
    return this.service.listAll();
  }

  @Post()
  create(@Body() dto: CreateHomeBannerDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateHomeBannerDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.mimetype)) {
        return cb(new BadRequestException('仅支持 jpg/png/webp'), false);
      }
      cb(null, true);
    },
  }))
  async upload(@UploadedFile() file: { buffer: Buffer; mimetype: string }) {
    if (!file) throw new BadRequestException('未上传文件');

    const head = file.buffer;
    const isJPEG = head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF;
    const isPNG = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47;
    const isWebP = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
      && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    if (!(isJPEG || isPNG || isWebP)) {
      throw new BadRequestException('文件类型不匹配');
    }

    const ext = file.mimetype.split('/')[1];
    const key = this.minio.buildKey('uploaded', 'system', { ext: ext === 'jpeg' ? 'jpg' : ext });
    await this.minio.upload(key, file.buffer, file.mimetype);
    return { imageKey: key };
  }
}
