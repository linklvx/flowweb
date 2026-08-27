import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TeamService } from './team.service';
import { TeamGuard } from './team.guard';

@Controller('api/team')
@UseGuards(TeamGuard)
export class TeamController {
  constructor(@Inject(TeamService) private readonly teamService: TeamService) {}

  @Get('mine')
  getMyTeams(@Req() req: Request) {
    return this.teamService.getMyTeams((req as any).user.id);
  }

  @Patch(':id')
  renameTeam(@Param('id') id: string, @Body() body: { name: string }, @Req() req: Request) {
    return this.teamService.renameTeam(id, (req as any).user.id, body.name);
  }

  @Post(':id/disband')
  disbandTeam(@Param('id') id: string, @Req() req: Request) {
    return this.teamService.disbandTeam(id, (req as any).user.id);
  }
}
