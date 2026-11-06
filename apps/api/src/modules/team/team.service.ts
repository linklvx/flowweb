import { Injectable, Inject, BadRequestException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TEAM_FREE_SEAT_LIMIT } from './team.constants';
import { CreditLedgerService } from './credit-ledger.service';
import { TeamCreditService } from './team-credit.service';
import { TeamFundsGateService } from './team-funds-gate.service';
import { AuditService } from '../../common/audit/audit.service';
import { bootstrapPersonalTeam } from './team.bootstrap';
import { lockScope, fenceTeam, ProjectErasingError } from '../collab/project-lock';
import { findActiveErasureRun, createErasureRun, toRunView, type ErasureRunView } from '../collab/project-erasure';
import { DEFAULT_FOLDER_NAMES } from '../material-library/constants/material-library.constants';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
    @Inject(CreditLedgerService) private readonly ledger: CreditLedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TeamFundsGateService) private readonly fundsGate: TeamFundsGateService,
    @Inject(TeamCreditService) private readonly teamCredit: TeamCreditService,
  ) {}

  /** 审计 operatorName：调用点无现成名字时一次 user 查询兜底 */
  private async userName(userId: string): Promise<string> {
    return (await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? '未知';
  }

  /** 默认团队（个人项目）服务端不变量：操作禁令入口统一拦截 */
  private async assertNotPersonalTeam(teamId: string, action: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { isDefault: true } });
    if (team?.isDefault) throw new BadRequestException(`个人项目不支持此操作：${action}`);
  }

  /** 幂等：无个人团队用户任意时机调用可补建（注册钩子 / 历史用户兜底）。
   * 判据 = ownerId+isDefault（个人团队与成员身份解耦，加入他人团队不影响补建）。 */
  async ensureDefaultTeam(userId: string, userName?: string) {
    const name =
      userName ??
      (await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ??
      '用户';
    return bootstrapPersonalTeam(this.prisma, this.ledger, userId, name);
  }

  /** 主动建团 credits=0、无流水（注册赠送只给默认团队一次，防刷） */
  async createTeam(userId: string, name: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { name: name.trim() || `${user?.name ?? '用户'}的团队`, ownerId: userId, status: 'ACTIVE' },
      });
      await tx.teamMember.create({ data: { teamId: team.id, userId, role: 'OWNER' } });
      // 与个人项目体验一致：建团即有默认素材文件夹
      await tx.materialFolder.createMany({
        data: DEFAULT_FOLDER_NAMES.map((folderName, i) => ({
          name: folderName, teamId: team.id, userId, isDefault: true, sortOrder: i,
        })),
      });
      // Y0b-1（三轮 Z23）：建团钱包行经 ensureBalance（唯一创建口）；
      // Y0b-2（Z89）：ledgerTx 取通行证（app.ledger_tx）——ledger_guard 触发器对 TeamBalance 写结构性拦截
      await this.ledger.ensureBalance(await this.ledger.ledgerTx(tx), team.id);
      await this.audit.logTx(tx, {
        operatorId: userId,
        operatorName: user?.name ?? '用户',
        teamId: team.id,
        targetType: 'TEAM',
        targetId: team.id,
        action: 'create_team',
      });
      return team;
    });
  }

  async getMyTeams(userId: string) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      include: {
        team: {
          include: {
            balance: true,
            // Task 1 起 Team 侧为 subscriptions[]（一对多）：取最新 active 一条
            subscriptions: {
              where: { status: 'active' },
              orderBy: { currentPeriodEnd: 'desc' },
              take: 1,
              include: { plan: { select: { name: true } } },
            },
            _count: { select: { members: true, projects: true } },
          },
        },
      },
      orderBy: { team: { createdAt: 'asc' } },
    });
    const rows = await Promise.all(memberships.map(async (m) => {
      // 订阅状态分叉：默认团队查个人订阅（UserSubscription），普通团队查 TeamSubscription
      // 注意：默认团队每用户唯一——下方 isDefault 分支至多执行一次；若放开多 default 会退化为逐团队查询
      let subscription: { planName: string; status: string; currentPeriodEnd: Date } | null = null;
      if (m.team.isDefault) {
        const personal = await this.prisma.userSubscription.findFirst({
          where: { userId, status: 'active' },
          orderBy: { currentPeriodEnd: 'desc' },
          include: { plan: { select: { tier: true } } },
        });
        if (personal) {
          subscription = { planName: personal.plan.tier, status: personal.status, currentPeriodEnd: personal.currentPeriodEnd };
        }
      } else if (m.team.subscriptions[0]) {
        const teamSub = m.team.subscriptions[0];
        subscription = {
          planName: teamSub.plan.name,
          status: teamSub.status,
          currentPeriodEnd: teamSub.currentPeriodEnd,
        };
      }
      return {
        id: m.team.id,
        name: m.team.name,
        role: m.role,
        status: m.team.status,
        isDefault: m.team.isDefault,
        isOwner: m.team.ownerId === userId,
        memberCount: m.team._count.members,
        projectCount: m.team._count.projects,
        createdAt: m.team.createdAt,
        balance: {
          credits: m.team.balance?.credits ?? 0,
          subscriptionCredits: m.team.balance?.subscriptionCredits ?? 0,
        },
        subscription,
      };
    }));
    // 排序规则：默认团队固定第一（前端 ?? teams[0] 缺省不得落到真实团队）
    // → 我创建的（OWNER）优先于我加入的（MEMBER）→ 同级按创建时间升序
    return rows.sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        Number(b.isOwner) - Number(a.isOwner) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  async renameTeam(teamId: string, userId: string, name: string) {
    await this.assertNotPersonalTeam(teamId, '重命名');
    await this.assertEditable(teamId, userId);
    return this.prisma.team.update({ where: { id: teamId }, data: { name } });
  }

  /** OWNER/ADMIN 且团队 ACTIVE（改名/后续管理操作共用校验）。
   *  C4-a（红⑥-a）：DISBANDING 拦截统一 status!=='ACTIVE' 拒——写/管理操作 403（解散进行中团队
   *  不得再收管理面写；DISBANDED 既有拒承继）。 */
  private async assertEditable(teamId: string, userId: string) {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
      throw new ForbiddenException('仅团队管理员可操作');
    }
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { status: true } });
    if (!team || team.status !== 'ACTIVE') throw new ForbiddenException('团队已解散或解散中');
  }

  async listMembers(teamId: string, page = 1, pageSize = 20) {
    const [rows, total] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { teamId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { joinedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.teamMember.count({ where: { teamId } }),
    ]);
    // Y0b-2 T0：monthlyUsed 改道台账派生（与 getBalanceView.used 同源——批量聚合与单成员读共用同一 SQL）；
    // Y0b-2 T1：monthlyPeriod/monthlyUsed 列已删——monthlyUsed 出响应恒为派生值（无列幽灵）
    const usedMap = await this.teamCredit.derivedMonthlyUsedMap(this.prisma, teamId);
    const items = rows.map((r) => ({ ...r, monthlyUsed: usedMap.get(r.userId) ?? 0 }));
    return { items, total };
  }

  private async requireMember(teamId: string, userId: string) {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('非团队成员');
    return member;
  }

  async changeRole(teamId: string, callerId: string, targetUserId: string, role: 'ADMIN' | 'MEMBER') {
    await this.assertNotPersonalTeam(teamId, '调整角色');
    // 运行时白名单：controller 无 ValidationPipe，类型限定仅编译期生效，透传 'OWNER' 可铸出双 OWNER 破坏 ownerId 不变式
    if (role !== 'ADMIN' && role !== 'MEMBER') throw new BadRequestException('成员角色仅可设为 ADMIN 或 MEMBER');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER') throw new ForbiddenException('仅 OWNER 可调整角色');
    const target = await this.requireMember(teamId, targetUserId);
    if (target.role === 'OWNER') throw new BadRequestException('不能修改 OWNER 的角色');
    const updated = await this.prisma.teamMember.update({
      where: { teamId_userId: { teamId, userId: targetUserId } },
      data: { role },
    });
    this.emitPermChanged(targetUserId, teamId);   // Y0b-3 T8：角色变更面（perm 链结论失效信号）
    await this.audit.log({
      operatorId: callerId,
      operatorName: await this.userName(callerId),
      teamId,
      targetType: 'TEAM_MEMBER',
      targetId: targetUserId,
      action: 'change_role',
      beforeValue: { role: target.role },
      afterValue: { role },
    });
    return updated;
  }

  async removeMember(teamId: string, callerId: string, targetUserId: string) {
    await this.assertNotPersonalTeam(teamId, '移除成员');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
      throw new ForbiddenException('仅团队管理员可移除成员');
    }
    const target = await this.requireMember(teamId, targetUserId);
    if (target.role === 'OWNER') throw new BadRequestException('OWNER 不可被移除');
    const removed = await this.prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
    // Y1a+Y1b T5（v11.1④）：removed 标记——gateway 对该用户存量连接**直关**（不复验：removeMember
    // 不触碰 ProjectMember 表，语义 A 复验会放行显式行档=旧连接仍可写 doc 的越权面）。
    this.eventEmitter.emit('collab.perm.changed', { userId: targetUserId, teamId, removed: true });
    await this.audit.log({
      operatorId: callerId,
      operatorName: await this.userName(callerId),
      teamId,
      targetType: 'TEAM_MEMBER',
      targetId: targetUserId,
      action: 'remove_member',
    });
    return removed;
  }

  async setQuota(teamId: string, callerId: string, targetUserId: string, monthlyQuota: number) {
    await this.assertNotPersonalTeam(teamId, '调整配额');
    if (monthlyQuota < 0) throw new BadRequestException('配额不能为负数');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
      throw new ForbiddenException('仅团队管理员可配置额度');
    }
    const target = await this.requireMember(teamId, targetUserId);
    const updated = await this.prisma.teamMember.update({
      where: { teamId_userId: { teamId, userId: targetUserId } },
      data: { monthlyQuota },
    });
    await this.audit.log({
      operatorId: callerId,
      operatorName: await this.userName(callerId),
      teamId,
      targetType: 'TEAM_MEMBER',
      targetId: targetUserId,
      action: 'adjust_quota',
      beforeValue: { monthlyQuota: target.monthlyQuota },
      afterValue: { monthlyQuota },
    });
    return updated;
  }

  /** spec 1.3：事务内 原 OWNER→ADMIN / 目标→OWNER / Team.ownerId 同步 + logTx 审计 */
  async transferOwnership(teamId: string, callerId: string, targetUserId: string) {
    await this.assertNotPersonalTeam(teamId, '转让');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER') throw new ForbiddenException('仅 OWNER 可转让团队');
    if (targetUserId === callerId) throw new BadRequestException('不能转让给自己');
    const target = await this.requireMember(teamId, targetUserId);
    const operatorName = await this.userName(callerId);
    const team = await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.update({
        where: { teamId_userId: { teamId, userId: callerId } },
        data: { role: 'ADMIN' },
      });
      await tx.teamMember.update({
        where: { teamId_userId: { teamId, userId: targetUserId } },
        data: { role: 'OWNER' },
      });
      const updated = await tx.team.update({ where: { id: teamId }, data: { ownerId: targetUserId } });
      await this.audit.logTx(tx, {
        operatorId: callerId,
        operatorName,
        teamId,
        targetType: 'TEAM_MEMBER',
        targetId: targetUserId,
        action: 'transfer_ownership',
      });
      return updated;
    });
    // Y0b-3 T8：双向变更面——原 OWNER 降权（PROJECT_OWNER→PROJECT_EDITOR）+ 新 OWNER 升权；
    // 事务提交后 emit（事件=内存信号零 IO，但语义上结论以提交后为准）
    this.emitPermChanged(callerId, teamId);
    this.emitPermChanged(targetUserId, teamId);
    return team;
  }

  /** Y0b-3 T8：权限变更事件（collab 面即时复验——permCache 失效+立即 sweep；监听器零 await，
   *  emit 同步安全）。approve 不 emit：加成员对存量连接零影响（原无权连不上=无消费面）。 */
  private emitPermChanged(userId: string, teamId: string): void {
    this.eventEmitter.emit('collab.perm.changed', { userId, teamId });
  }

  /** 席位上限现算：active 订阅取 plan，否则免费常量（Task 10 getLimits 统一封装） */
  private async getSeatLimit(teamId: string): Promise<number> {
    const sub = await this.prisma.teamSubscription.findFirst({
      where: { teamId, status: 'active', currentPeriodEnd: { gt: new Date() } },
      select: { plan: { select: { seatLimit: true } } },
    });
    return sub?.plan.seatLimit ?? TEAM_FREE_SEAT_LIMIT;
  }

  async apply(teamId: string, userId: string, message?: string) {
    await this.assertNotPersonalTeam(teamId, '申请加入');
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { status: true, joinApproval: true },
    });
    if (!team || team.status !== 'ACTIVE') throw new BadRequestException('团队不存在或已解散');

    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (member) throw new BadRequestException('已是团队成员');

    if (!team.joinApproval) {
      return this.prisma.teamMember.create({ data: { teamId, userId, role: 'MEMBER' } });
    }

    const pending = await this.prisma.teamJoinRequest.findFirst({
      where: { teamId, userId, status: 'PENDING' },
    });
    if (pending) throw new BadRequestException('已有待处理的申请');

    return this.prisma.teamJoinRequest.create({
      data: { teamId, userId, status: 'PENDING', message },
    });
  }

  async approve(teamId: string, callerId: string, requestId: string) {
    await this.assertNotPersonalTeam(teamId, '审批加入申请');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
      throw new ForbiddenException('仅团队管理员可审批');
    }
    const request = await this.prisma.teamJoinRequest.findUnique({ where: { id: requestId } });
    if (!request || request.teamId !== teamId) throw new BadRequestException('申请不存在');
    if (request.status !== 'PENDING') throw new BadRequestException('申请已处理');

    const memberCount = await this.prisma.teamMember.count({ where: { teamId } });
    const seatLimit = await this.getSeatLimit(teamId);
    if (memberCount >= seatLimit) throw new BadRequestException('席位已满');

    const operatorName = await this.userName(callerId);
    return this.prisma.$transaction(async (tx) => {
      await tx.teamMember.create({ data: { teamId, userId: request.userId, role: 'MEMBER' } });
      const approved = await tx.teamJoinRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', decidedBy: callerId, decidedAt: new Date() },
      });
      await this.audit.logTx(tx, {
        operatorId: callerId,
        operatorName,
        teamId,
        targetType: 'TEAM_MEMBER',
        targetId: request.userId,
        action: 'approve_join',
      });
      return approved;
    });
  }

  async reject(teamId: string, callerId: string, requestId: string) {
    await this.assertNotPersonalTeam(teamId, '审批加入申请');
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
      throw new ForbiddenException('仅团队管理员可审批');
    }
    const request = await this.prisma.teamJoinRequest.findUnique({ where: { id: requestId } });
    if (!request || request.teamId !== teamId) throw new BadRequestException('申请不存在');
    if (request.status !== 'PENDING') throw new BadRequestException('申请已处理');
    const rejected = await this.prisma.teamJoinRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', decidedBy: callerId, decidedAt: new Date() },
    });
    await this.audit.log({
      operatorId: callerId,
      operatorName: await this.userName(callerId),
      teamId,
      targetType: 'TEAM_MEMBER',
      targetId: request.userId,
      action: 'reject_join',
    });
    return rejected;
  }

  async listRequests(teamId: string, callerId: string, status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') {
      throw new ForbiddenException('仅团队管理员可查看申请');
    }
    return this.prisma.teamJoinRequest.findMany({
      where: status ? { teamId, status } : { teamId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAuditLogs(teamId: string, callerId: string, page = 1, pageSize = 20) {
    const caller = await this.requireMember(teamId, callerId);
    if (caller.role !== 'OWNER' && caller.role !== 'ADMIN') throw new ForbiddenException('仅团队管理员可查看审计日志');
    const where = { teamId };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }

  /** C4-a（plan Task C4-1 红④——tombstone-only）：解散请求事务=lockScope('team')（advisory·锁序①）
   *  →fenceTeam（FOR SHARE 行锁读·锁序②——DISBANDING/DISBANDED 拒）→资金门（in-tx 扩查三面，不过
   *  回滚 409）→Team.status='DISBANDING'（tombstone——**废止请求内 team.delete 级联**：Team 行不删，
   *  物理删除归 worker saga）→team run 行（PENDING）→提交→emit+审计→202 返回 run 视图。
   *  **逐项目置 DELETING+子 run 由 worker 分批游标完成**（O(N) 批置分批——ProjectErasureRunPoller：
   *  team run WAITING_CHILDREN 等子 run 全 DONE→PURGING_TEAM〔TeamBalance/团队级对象〕→ledger 通行证
   *  →删 Team 行；一子 FAILED→team run FAILED 不删 Team——红⑤-b）。
   *  幂等：DISBANDING∧活跃 run→同 run 返回；DISBANDING∧无活跃 run（前 run FAILED）→409（re-drive 归
   *  C4-c ops 面）。MinIO 介质清理归 worker（C4-c manifest 批删——旧 team-media-cleanup 入队面废止）。 */
  async disbandTeam(teamId: string, userId: string): Promise<ErasureRunView> {
    await this.assertNotPersonalTeam(teamId, '解散');
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member || member.role !== 'OWNER') throw new ForbiddenException('仅 OWNER 可解散团队');

    const myTeamCount = await this.prisma.teamMember.count({ where: { userId } });
    if (myTeamCount <= 1) throw new BadRequestException('不能解散唯一团队');

    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { status: true } });
    if (!team || team.status === 'DISBANDED') throw new ConflictException('团队已解散');

    const run = await this.prisma.$transaction(async (tx) => {
      await lockScope(tx, 'team', teamId);   // 锁序①：team 维串行化（scope: 前缀键空间）
      const existing = await findActiveErasureRun(tx, 'team', teamId);
      if (existing) return toRunView(existing);   // 幂等：重复解散→同 run 202
      try {
        await fenceTeam(tx, teamId);   // 锁序②：FOR SHARE 行锁读（DISBANDING 无活跃 run/DISBANDED→拒）
      } catch (e) {
        if (e instanceof ProjectErasingError) throw new ConflictException('团队已解散或解散进行中');
        throw e;
      }
      await this.fundsGate.assertSettled(tx, { teamId });   // 资金门（in-tx 持锁检查——C4-a 扩查三面）
      await tx.team.update({ where: { id: teamId }, data: { status: 'DISBANDING' } });
      return toRunView(await createErasureRun(tx, {
        scopeType: 'team', scopeId: teamId, teamId, requestedBy: userId,
      }));
    }, { timeout: 15_000, maxWait: 5_000 });

    // 提交后副作用 best-effort（Team 行还在——DISBANDING=tombstone 非物理删；各环吞错保后环）
    // team.disbanding=请求侧信号（监听器消费归 C4-c——跨进程关连接面；旧 team.disbanded〔物理删语义〕
    // 随请求内级联废止，由 worker 会合终态承接）。
    await this.eventEmitter.emitAsync('team.disbanding', { teamId }).catch((e: unknown) =>
      this.logger.warn(`team.disbanding emit 失败（监听器各自兜底）: ${e}`));
    await this.audit.log({
      operatorId: userId,
      operatorName: await this.userName(userId),
      teamId,
      targetType: 'TEAM',
      targetId: teamId,
      action: 'disband_team',
    });
    return run;
  }
}
