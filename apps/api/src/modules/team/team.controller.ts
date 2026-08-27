import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TeamService } from './team.service';
import { TeamRechargeService } from './team-recharge.service';
import { SkipTeamGuard, TeamGuard } from './team.guard';

@Controller('api/team')
@UseGuards(TeamGuard)
export class TeamController {
  constructor(
    @Inject(TeamService) private readonly teamService: TeamService,
    private readonly teamRecharge: TeamRechargeService,
  ) {}

  @Get('mine')
  getMyTeams(@Req() req: Request) {
    return this.teamService.getMyTeams((req as any).user.id);
  }

  @Get(':id/members')
  listMembers(@Param('id') id: string, @Query() query: { page?: string; pageSize?: string }) {
    return this.teamService.listMembers(id, Number(query.page) || 1, Number(query.pageSize) || 20);
  }

  @Patch(':id/members/:memberUserId/role')
  changeRole(@Param('id') id: string, @Param('memberUserId') memberUserId: string, @Body() body: { role: 'ADMIN' | 'MEMBER' }, @Req() req: Request) {
    return this.teamService.changeRole(id, (req as any).user.id, memberUserId, body.role);
  }

  @Delete(':id/members/:memberUserId')
  removeMember(@Param('id') id: string, @Param('memberUserId') memberUserId: string, @Req() req: Request) {
    return this.teamService.removeMember(id, (req as any).user.id, memberUserId);
  }

  @Patch(':id/members/:memberUserId/quota')
  setQuota(@Param('id') id: string, @Param('memberUserId') memberUserId: string, @Body() body: { monthlyQuota: number }, @Req() req: Request) {
    return this.teamService.setQuota(id, (req as any).user.id, memberUserId, body.monthlyQuota);
  }

  @Patch(':id')
  renameTeam(@Param('id') id: string, @Body() body: { name: string }, @Req() req: Request) {
    return this.teamService.renameTeam(id, (req as any).user.id, body.name);
  }

  @Post(':id/join-requests')
  @SkipTeamGuard()
  apply(@Param('id') id: string, @Body() body: { message?: string }, @Req() req: Request) {
    return this.teamService.apply(id, (req as any).user.id, body.message);
  }

  @Get(':id/join-requests')
  listRequests(@Param('id') id: string, @Query() query: { status?: 'PENDING' | 'APPROVED' | 'REJECTED' }, @Req() req: Request) {
    return this.teamService.listRequests(id, (req as any).user.id, query.status);
  }

  @Post(':id/join-requests/:requestId/approve')
  approve(@Param('id') id: string, @Param('requestId') requestId: string, @Req() req: Request) {
    return this.teamService.approve(id, (req as any).user.id, requestId);
  }

  @Post(':id/join-requests/:requestId/reject')
  reject(@Param('id') id: string, @Param('requestId') requestId: string, @Req() req: Request) {
    return this.teamService.reject(id, (req as any).user.id, requestId);
  }

  @Post(':id/recharge/orders')
  createRechargeOrder(@Param('id') id: string, @Body() body: { amount: number }, @Req() req: Request) {
    return this.teamRecharge.createTeamOrder(id, (req as any).user.id, Math.round(Number(body.amount) * 100));
  }

  @Post(':id/recharge/orders/:orderNo/pay')
  payRechargeOrder(@Param('id') id: string, @Param('orderNo') orderNo: string, @Req() req: Request) {
    return this.teamRecharge.payTeamOrder(orderNo, (req as any).user.id);
  }

  @Post(':id/disband')
  disbandTeam(@Param('id') id: string, @Req() req: Request) {
    return this.teamService.disbandTeam(id, (req as any).user.id);
  }
}
