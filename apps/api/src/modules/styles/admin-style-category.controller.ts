import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UsePipes, ValidationPipe } from '@nestjs/common';
import { AdminStyleService } from './admin-style.service';
import { CreateStyleCategoryDto, UpdateStyleCategoryDto } from './dto/style-category.dto';

@Controller('api/admin/style-categories')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) // 仓内无全局 pipe（先例 admin-home-banner.controller.ts:12）
export class AdminStyleCategoryController {
  constructor(@Inject(AdminStyleService) private readonly service: AdminStyleService) {}

  @Get() list() { return this.service.listCategories(); }
  @Post() create(@Body() dto: CreateStyleCategoryDto) { return this.service.createCategory(dto); }
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateStyleCategoryDto) { return this.service.updateCategory(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.deleteCategory(id); }
}
