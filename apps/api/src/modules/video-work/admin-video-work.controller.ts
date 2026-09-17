import {
  BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Put, Query,
  UploadedFile, UseInterceptors, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VideoWorkService } from './video-work.service';
import { CreateVideoCategoryDto, UpdateVideoCategoryDto } from './dto/video-category.dto';
import { CreateVideoTagDto, UpdateVideoTagDto } from './dto/video-tag.dto';
import { CreateVideoWorkDto } from './dto/create-video-work.dto';
import { UpdateVideoWorkDto } from './dto/update-video-work.dto';
import { UpdateVideoWorkSettingsDto } from './dto/update-video-work-settings.dto';
import { PresignVideoDto } from './dto/presign-video.dto';

@Controller('api/admin/video-works')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) // 类级挂载（C2 Task 2.1——仓库无全局 pipe，不挂则 {...dto} 把 publishedAt 等任意字段透传进 Prisma；先例 admin-home-banner.controller.ts:12）
export class AdminVideoWorkController {
  constructor(@Inject(VideoWorkService) private readonly service: VideoWorkService) {}

  // ==== 静态段子资源（声明在作品 :id 路由之前） ====
  @Get('categories') listCategories() { return this.service.listAllCategories(); }
  @Post('categories') createCategory(@Body() dto: CreateVideoCategoryDto) { return this.service.createCategory(dto); }
  @Put('categories/:id') updateCategory(@Param('id') id: string, @Body() dto: UpdateVideoCategoryDto) { return this.service.updateCategory(id, dto); }
  @Delete('categories/:id') deleteCategory(@Param('id') id: string) { return this.service.deleteCategory(id); }

  @Get('tags') listTags() { return this.service.listAllTags(); }
  @Post('tags') createTag(@Body() dto: CreateVideoTagDto) { return this.service.createTag(dto); }
  @Put('tags/:id') updateTag(@Param('id') id: string, @Body() dto: UpdateVideoTagDto) { return this.service.updateTag(id, dto); }
  @Delete('tags/:id') deleteTag(@Param('id') id: string) { return this.service.deleteTag(id); }

  @Post('upload-cover')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.mimetype)) return cb(new BadRequestException('仅支持 jpg/png/webp'), false); // 显式抛——静默拒绝会让用户看到 'file is required'（banner 先例 admin-home-banner.controller.ts:45）
      cb(null, true);
    },
  }))
  async uploadCover(@UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string }) { // 仓库无 @types/multer——内联类型；async 对齐 banner 先例（admin-home-banner.controller.ts:50）——同步 throw 会绕过 rejects 断言
    if (!file) throw new BadRequestException('file is required');
    return this.service.uploadCover(file.buffer, file.mimetype);
  }

  @Get('settings') getSettings() { return this.service.getSettings(); }
  @Put('settings') updateSettings(@Body() dto: UpdateVideoWorkSettingsDto) {
    return this.service.updateSettings(dto);
  }

  @Post('presign-video')
  presignVideo(@Body() dto: PresignVideoDto) { return this.service.presignVideo(dto); } // Task 2：静态段声明（:id 之前）

  @Get('canvas-check')
  canvasCheck(@Query('id') id: string) { return this.service.canvasCheck(id); } // @Query 原始类型保持——类 DTO 反而任何多余 query 参数 400（whitelist 对原始类型不生效）

  // Task 2.2+ 追加：upload-cover / settings / 作品 :id CRUD（声明在全部静态段之后）

  // ==== 作品 CRUD（:id 参数路由，声明在全部静态段之后——spec §4.2 红线） ====
  @Get() listWorks(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    return this.service.listAllWorks(Math.max(1, Number(page) || 1), Math.min(50, Math.max(1, Number(pageSize) || 20)));
  }
  @Post() createWork(@Body() dto: CreateVideoWorkDto) { return this.service.createWork(dto); }
  @Get(':id') getWork(@Param('id') id: string) { return this.service.getWorkById(id); }
  @Put(':id') updateWork(@Param('id') id: string, @Body() dto: UpdateVideoWorkDto) { return this.service.updateWork(id, dto); }
  @Delete(':id') deleteWork(@Param('id') id: string) { return this.service.removeWork(id); }
}
