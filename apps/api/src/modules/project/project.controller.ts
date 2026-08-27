import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Inject, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { ProjectService } from './project.service';

@Controller('api/projects')
export class ProjectController {
  constructor(@Inject(ProjectService) private readonly projectService: ProjectService) {}

  @Post()
  create(@Body() body: { name?: string }) {
    return this.projectService.create(body.name || '未命名项目');
  }

  @Get(':id')
  getProject(@Param('id') id: string) {
    return this.projectService.findById(id);
  }

  @Get(':id/folder')
  getProjectFolder(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.id;
    return this.projectService.getProjectFolder(id, userId);
  }

  // TODO(Task15): 端点随 autosave 链路退役删除——窗口期 no-op 200 兼容旧前端
  @Put(':id/viewport')
  updateViewport(@Param('id') id: string, @Body() body: { viewport: { x: number; y: number; zoom: number } }) {
    return { success: true };
  }

  // TODO(Task15): 端点随 autosave 链路退役删除——窗口期 no-op 200（echo version 保持前端 serverVersion 平滑）
  @Put(':id/canvas')
  syncCanvas(
    @Param('id') id: string,
    @Body() body: { nodes: any[]; edges: any[]; version: number },
  ) {
    return { version: body.version };
  }

  @Patch(':id')
  updateName(@Param('id') id: string, @Body() body: { name: string }) {
    return this.projectService.updateName(id, body.name);
  }

  @Delete('drafts')
  cleanDrafts(@Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.projectService.cleanDrafts(userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.projectService.delete(id);
  }
}
