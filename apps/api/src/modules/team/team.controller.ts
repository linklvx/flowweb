import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TeamService } from './team.service';
import { TeamCreditService } from './team-credit.service';
import { TeamRechargeService } from './team-recharge.service';
import { TeamSubscriptionService } from './team-subscription.service';
import { StorageQuotaService } from './storage-quota.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SkipTeamGuard, TeamGuard } from './team.guard';

@Controller('api/team')
@UseGuards(TeamGuard)
export class TeamController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamService) private readonly teamService: TeamService,
    private readonly teamCredit: TeamCreditService,
    private readonly teamRecharge: TeamRechargeService,
    private readonly teamSubscription: TeamSubscriptionService,
    private readonly quota: StorageQuotaService,
  ) {}

  @Post('create')
  @SkipTeamGuard()
  createTeam(@Body() body: { name: string }, @Req() req: Request) {
    return this.teamService.createTeam((req as any).user.id, body.name);
  }

  /** 成员级只读：上架团队套餐（TeamBillingPage 用；admin 全量走 /api/admin/team-plans） */
  @Get('plans')
  @SkipTeamGuard()
  async listActivePlans() {
    const plans = await this.prisma.teamPlan.findMany({
      where: { isActive: true },
      orderBy: { sort: 'asc' },
    });
    // storageLimitBytes 为 BigInt，JSON 序列化会 500（对齐 admin-team-plan.controller 处理）
    return plans.map((p) => ({ ...p, storageLimitBytes: Number(p.storageLimitBytes) }));
  }

  @Get(':id/balance')
  getBalance(@Param('id') id: string, @Req() req: Request) {
    return this.teamCredit.getBalanceView(id, (req as any).user.id);
  }

  @Get(':id/transactions')
  async listTransactions(@Param('id') id: string, @Query() query: { page?: string; pageSize?: string }) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    // Y0b-1（T1b 质量审）：seq 为 BigInt 审计计数器——select 显式列集（web TeamDetail 只用
    // createdAt/type/amount/creditType/balanceAfter+rowKey id），整行透传 JSON.stringify(BigInt) 500
    // 契约 4：where 自有键 teamId 内联调用点（Y0b-1 扫描锚⑥——变量前置隔长注释=锚盲区）
    const [items, total] = await Promise.all([
      this.prisma.teamCreditTransaction.findMany({
        where: { teamId: id }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        select: {
          id: true, type: true, amount: true, creditType: true,
          balanceAfter: true, createdAt: true,
        },
      }),
      this.prisma.teamCreditTransaction.count({ where: { teamId: id } }),
    ]);
    return { items, total };
  }

  @Get(':id/limits')
  getLimits(@Param('id') id: string) {
    return this.teamSubscription.getLimits(id);
  }

  @Get(':id/storage-usage')
  getStorageUsage(@Param('id') id: string) {
    return this.quota.getUsage(id);
  }

  @Get('mine')
  getMyTeams(@Req() req: Request) {
    return this.teamService.getMyTeams((req as any).user.id);
  }

  // 无 :id 路由守卫本就放行，显式声明防未来类级守卫变化
  @SkipTeamGuard()
  @Get('default')
  getDefault(@Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.teamService.ensureDefaultTeam(userId).then((t) => ({ id: t.id, name: t.name, isDefault: true }));
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

  @Get(':id/audit-logs')
  listAuditLogs(@Param('id') id: string, @Query() q: { page?: string; pageSize?: string }, @Req() req: Request) {
    return this.teamService.listAuditLogs(id, (req as any).user.id, Number(q.page) || 1, Number(q.pageSize) || 20);
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

  @Get(':id/recharge/orders')
  listRechargeOrders(@Param('id') id: string, @Query('kind') kind: 'credits' | 'subscription', @Query() query: { page?: string; pageSize?: string }) {
    return this.teamRecharge.listOrders(id, Number(query.page) || 1, Number(query.pageSize) || 20, kind);
  }

  @Post(':id/recharge/orders/:orderNo/pay')
  payRechargeOrder(@Param('id') id: string, @Param('orderNo') orderNo: string, @Req() req: Request) {
    return this.teamRecharge.payTeamOrder(orderNo, (req as any).user.id);
  }

  @Post(':id/subscription/orders')
  createSubscriptionOrder(@Param('id') id: string, @Body() body: { planId: string }, @Req() req: Request) {
    return this.teamSubscription.createSubscriptionOrder(id, (req as any).user.id, body.planId);
  }

  @Post(':id/disband')
  disbandTeam(@Param('id') id: string, @Req() req: Request) {
    return this.teamService.disbandTeam(id, (req as any).user.id);
  }

  @Post(':id/transfer-ownership')
  transferOwnership(@Param('id') id: string, @Body() body: { targetUserId: string }, @Req() req: Request) {
    return this.teamService.transferOwnership(id, (req as any).user.id, body.targetUserId);
  }
}
