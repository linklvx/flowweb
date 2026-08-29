import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Inject, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ProjectService } from './project.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamGuard, TeamSource } from '../team/team.guard';
import { assertTeamMember } from '../team/team.util';

@Controller('api/projects')
export class ProjectController {
  constructor(
    @Inject(ProjectService) private readonly projectService: ProjectService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post()
  create(@Body() body: { name?: string; teamId?: string }, @Req() req: Request) {
    return this.projectService.create(body.name || '未命名项目', (req as any).user?.id, undefined, undefined, body.teamId);
  }

  @Get(':id')
  @TeamSource('project')
  @UseGuards(TeamGuard)
  getProject(@Param('id') id: string) {
    return this.projectService.findById(id);
  }

  @Get(':id/folder')
  async getProjectFolder(@Param('id') id: string, @Query('teamId') teamId: string | undefined, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId || !teamId) return { folderId: null };
    await assertTeamMember(this.prisma, teamId, userId);
    return this.projectService.getProjectFolder(id, userId, teamId);
  }


  @Patch(':id')
  @TeamSource('project')
  @UseGuards(TeamGuard)
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
  @TeamSource('project')
  @UseGuards(TeamGuard)
  delete(@Param('id') id: string) {
    return this.projectService.delete(id);
  }
}
