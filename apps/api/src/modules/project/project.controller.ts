import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Inject, Req, UnauthorizedException, UseGuards, HttpCode, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { ProjectService } from './project.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamGuard, TeamSource } from '../team/team.guard';
import { ProjectPermissionService } from '../team/project-permission.service';
import { assertTeamMember } from '../team/team.util';

@Controller('api/projects')
export class ProjectController {
  constructor(
    @Inject(ProjectService) private readonly projectService: ProjectService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
  ) {}

  @Post()
  create(@Body() body: { name?: string; teamId?: string }, @Req() req: Request) {
    return this.projectService.create(body.name || '未命名项目', (req as any).user?.id, undefined, undefined, body.teamId);
  }

  @Get(':id')
  @TeamSource('project')
  @UseGuards(TeamGuard)
  getProject(@Param('id') id: string, @Req() req: Request) {
    // Y0b-5 T5：透传请求者 uid（collabViewerUid——四维本地缓存键 uid 维）
    return this.projectService.findById(id, (req as any).user?.id);
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

  // C4-a（红⑥-b）：删项目鉴权=ProjectPermissionService 判 PROJECT_OWNER（ProjectRole 解析链 :894-898
  // ——显式 PROJECT_OWNER 行/创建者/团队 OWNER；MEMBER→PROJECT_EDITOR→403）。tombstone-only：202+run
  // 视图；?dryRun=true=演练档（跳过 lifecycle 置位）。TeamGuard 仍在（团队成员面+团队态拦截）。
  @Delete(':id')
  @TeamSource('project')
  @UseGuards(TeamGuard)
  @HttpCode(202)
  async delete(@Param('id') id: string, @Query('dryRun') dryRun: string | undefined, @Req() req: Request) {
    const userId = (req as any).user?.id;
    const role = await this.perm.resolve(id, userId);
    if (role !== 'PROJECT_OWNER') throw new ForbiddenException('仅项目 OWNER 可删除');
    return this.projectService.delete(id, userId, { dryRun: dryRun === 'true' || dryRun === '1' });
  }
}
