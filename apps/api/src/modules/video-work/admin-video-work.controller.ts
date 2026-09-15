import { Controller, Get, Post, Put, Delete, Body, Param, Query, Inject, UsePipes, ValidationPipe } from '@nestjs/common';
import { VideoWorkService } from './video-work.service';
import { CreateVideoCategoryDto, UpdateVideoCategoryDto } from './dto/video-category.dto';
import { CreateVideoTagDto, UpdateVideoTagDto } from './dto/video-tag.dto';

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

  @Get('candidates')
  listCandidates(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    return this.service.listCandidates(Math.max(1, Number(page) || 1), Math.min(50, Math.max(1, Number(pageSize) || 20)));
  }

  // Task 2.2+ 追加：candidates / upload-cover / settings / 作品 :id CRUD（声明在全部静态段之后）
}
