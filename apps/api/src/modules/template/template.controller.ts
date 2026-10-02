import { Controller, Get, Patch, Delete, Param, Body, Query, Req, Inject, UsePipes, ValidationPipe } from '@nestjs/common';
import { TemplateService } from './template.service';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { TemplateListQueryDto } from './dto/template-list-query.dto';
import { Request } from 'express';

@Controller('api/templates')
export class TemplateController {
  constructor(@Inject(TemplateService) private readonly templateService: TemplateService) {}

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async getTemplates(@Query() query: TemplateListQueryDto, @Req() req: Request) {
    const userId = (req as any).user?.id || '';
    const data = await this.templateService.findMany(query as any, userId);
    return { success: true, data };
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async update(@Param('id') id: string, @Body() dto: UpdateTemplateDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) return { success: false, error: { code: 'UNAUTHORIZED', message: '未登录' } };
    const template = await this.templateService.update(id, dto, userId);
    return { success: true, data: template };
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) return { success: false, error: { code: 'UNAUTHORIZED', message: '未登录' } };
    await this.templateService.delete(id, userId);
    return { success: true, data: null };
  }
}
