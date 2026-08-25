import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Inject, ValidationPipe, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { ProjectService } from './project.service';
import { UpdateNodeDimensionsDto } from './dto/update-node-dimensions.dto';

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

  @Put(':id/viewport')
  updateViewport(@Param('id') id: string, @Body() body: { viewport: { x: number; y: number; zoom: number } }) {
    return this.projectService.updateViewport(id, body.viewport);
  }

  @Put(':id/nodes')
  syncNodes(@Param('id') id: string, @Body() body: { nodes: any[] }) {
    return this.projectService.syncNodes(id, body.nodes);
  }

  @Put(':id/edges')
  syncEdges(@Param('id') id: string, @Body() body: { edges: any[] }) {
    return this.projectService.syncEdges(id, body.edges);
  }

  @Patch(':id/nodes/dimensions')
  updateDimensions(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) dto: UpdateNodeDimensionsDto[],
  ) {
    return this.projectService.updateDimensions(id, dto);
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
