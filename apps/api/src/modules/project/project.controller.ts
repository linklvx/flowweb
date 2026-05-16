import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Inject } from '@nestjs/common';
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

  @Patch(':id')
  updateName(@Param('id') id: string, @Body() body: { name: string }) {
    return this.projectService.updateName(id, body.name);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.projectService.delete(id);
  }
}
