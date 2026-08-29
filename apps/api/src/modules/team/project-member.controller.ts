import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ProjectMemberService } from './project-member.service';
import { TeamGuard, TeamSource } from './team.guard';

type GrantRole = 'PROJECT_VIEWER' | 'PROJECT_EDITOR' | 'PROJECT_OWNER';

@Controller('api/project/:id/members')
@UseGuards(TeamGuard)
export class ProjectMemberController {
  constructor(@Inject(ProjectMemberService) private readonly svc: ProjectMemberService) {}

  @Get()
  @TeamSource('project')
  list(@Param('id') id: string, @Req() req: Request) {
    return this.svc.list(id, (req as any).user.id);
  }

  @Post()
  @TeamSource('project')
  add(@Param('id') id: string, @Body() body: { userId: string; role: GrantRole }, @Req() req: Request) {
    return this.svc.add(id, (req as any).user.id, body.userId, body.role);
  }

  @Patch(':userId')
  @TeamSource('project')
  changeRole(@Param('id') id: string, @Param('userId') userId: string, @Body() body: { role: GrantRole }, @Req() req: Request) {
    return this.svc.changeRole(id, (req as any).user.id, userId, body.role);
  }

  @Delete(':userId')
  @TeamSource('project')
  remove(@Param('id') id: string, @Param('userId') userId: string, @Req() req: Request) {
    return this.svc.remove(id, (req as any).user.id, userId);
  }
}
