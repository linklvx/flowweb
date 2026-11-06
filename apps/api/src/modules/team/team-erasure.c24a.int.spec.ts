// C4-a（plan Task C4-1 红④⑤⑤-b⑥-a——生产就绪收尾批·project-erasure）：team.service.disbandTeam
// tombstone-only+worker 轮询骨架 int spec（真 PG）。断言面：
//  红④ 解散请求事务=lockScope+fenceTeam→资金门（in-tx 扩查）→Team.status='DISBANDING'+team run 行
//   （PENDING）→202；废止请求内 team.delete 级联（Team 行不删）；BullMQ 入队失败→run 轮询兜底
//   （cleanupQueue.add 拒绝态不受影响——run 行=唯一唤醒源，poller.tick 推进）；
//  红⑤ team 解散与项目并发交错→零复活（FOR SHARE 互斥：team 批 UPDATE 等全部 FOR SHARE 持有者）；
//  红⑤-b team run 等子 run 会合（WAITING_CHILDREN→子全 DONE→PURGING_TEAM→ledger 通行证→删 Team 行
//   →DONE；一子 FAILED→team run FAILED 不删 Team）；
//  红⑥-a DISBANDING 全路径拦截（创建项目/邀请/充值 URL 路由〔TeamGuard〕/管理操作 403；重复解散 409）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TeamService } from './team.service';
import { TeamGuard } from './team.guard';
import { assertTeamMember } from './team.util';
import { TeamFundsGateService } from './team-funds-gate.service';
import { ProjectErasureRunPoller } from '../collab/project-erasure.poller';
import { ErasureContextService } from '../collab/project-lock';
import { CreditLedgerService } from './credit-ledger.service';
import { PrismaService } from '../../prisma/prisma.service';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

maybe('C4-a 红④⑤⑤-b⑥-a team tombstone-only+会合（真 PG）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const fundsGate = new TeamFundsGateService(prismaService as any);
  const ledger = new CreditLedgerService(prismaService as any);
  const emitter = { emit: vi.fn(), emitAsync: vi.fn(async () => []) };
  const audit = { log: vi.fn(async () => undefined), logTx: vi.fn(async () => undefined) };
  const teamCredit = { derivedMonthlyUsedMap: vi.fn(async () => new Map()) };
  // 红④：旧 cleanupQueue（team-media-cleanup 入队）随请求内级联废止——run 行=唯一唤醒源（无 BullMQ
  // kick 面=不存在可失败的入队；poller.tick 即兜底）。MinIO 介质清理归 worker saga（C4-c）。
  const service = new TeamService(
    prismaService as any, emitter as any,
    ledger as any, audit as any, fundsGate, teamCredit as any,
  );
  const poller = new ProjectErasureRunPoller(
    prismaService as any, ledger as any, new ErasureContextService(),
  );
  const owner = `c24a-team-owner-${Date.now().toString(36)}`;
  const otherTeamOfOwner = `c24a-other-${Date.now().toString(36)}`;
  const teamReg: string[] = [];
  let seq = 0;
  const mkTeam = async (nProjects = 0) => {
    const teamId = `c24a-team-${Date.now().toString(36)}-${seq++}`;
    await prisma.team.create({ data: { id: teamId, name: `c24a-team-${seq}`, ownerId: owner } });
    await prisma.teamMember.create({ data: { teamId, userId: owner, role: 'OWNER' } });
    teamReg.push(teamId);
    const projectIds: string[] = [];
    for (let i = 0; i < nProjects; i++) {
      const pid = `${teamId}-p${i}`;
      await prisma.canvasProject.create({ data: { id: pid, name: pid, teamId, userId: owner } });
      projectIds.push(pid);
    }
    return { teamId, projectIds };
  };

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: owner }, update: {},
      create: { id: owner, name: owner, email: `${owner}@local.test`, emailVerified: true },
    });
    // 唯一团队禁令解锁：owner 需≥2 团队
    await prisma.team.upsert({
      where: { id: otherTeamOfOwner }, update: {},
      create: { id: otherTeamOfOwner, name: 'c24a-other', ownerId: owner },
    });
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: otherTeamOfOwner, userId: owner } },
      update: {}, create: { teamId: otherTeamOfOwner, userId: owner, role: 'OWNER' },
    });
  });

  afterAll(async () => {
    // Team.owner Restrict：先删团队成员行再删团队；DISBANDING 团队直接物理删（测试域）
    for (const tid of teamReg) {
      await prisma.projectErasureRun.deleteMany({ where: { scopeId: tid } }).catch(() => undefined);
      await prisma.projectErasureRun.deleteMany({ where: { teamId: tid } }).catch(() => undefined);
      await prisma.canvasProject.deleteMany({ where: { teamId: tid } }).catch(() => undefined);
      await prisma.teamMember.deleteMany({ where: { teamId: tid } }).catch(() => undefined);
      await prisma.team.deleteMany({ where: { id: tid } }).catch(() => undefined);
    }
    await prisma.projectErasureRun.deleteMany({ where: { scopeId: otherTeamOfOwner } }).catch(() => undefined);
    await prisma.teamMember.deleteMany({ where: { teamId: otherTeamOfOwner, userId: owner } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { id: otherTeamOfOwner } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: owner } }).catch(() => undefined);
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 20_000);

  it('红④-a 解散请求=tombstone+run：Team.status=DISBANDING+team run PENDING；Team 行不删（废止请求内级联）；cleanupQueue.add 拒绝态不受影响（轮询兜底——run 行=唯一唤醒源）', async () => {
    const { teamId } = await mkTeam(1);
    const run = await service.disbandTeam(teamId, owner);
    expect(run).toMatchObject({ scopeType: 'team', scopeId: teamId, state: 'PENDING', dryRun: false });
    const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    expect(team.status).toBe('DISBANDING');   // tombstone-only：Team 行在
    expect(team.status).not.toBe('DISBANDED');
    expect(await prisma.projectErasureRun.findFirst({ where: { scopeType: 'team', scopeId: teamId } })).toMatchObject({ state: 'PENDING', requestedBy: owner });
    // 红④ 兜底面：poller.tick 推进（无需任何通知/入队成功）
    await poller.tick();
    const after = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeType: 'team', scopeId: teamId } });
    expect(after.claimOwner).toBeTruthy();   // claim 生效（lease 心跳面）
    expect(['RUNNING', 'WAITING_CHILDREN']).toContain(after.state);
  });

  it('红④-b 重复解散：DISBANDING∧活跃 run→同 run 幂等 202（不二行）', async () => {
    const { teamId } = await mkTeam(0);
    const run1 = await service.disbandTeam(teamId, owner);
    const run2 = await service.disbandTeam(teamId, owner);
    expect(run2.erasureId).toBe(run1.erasureId);
    expect(await prisma.projectErasureRun.count({ where: { scopeType: 'team', scopeId: teamId } })).toBe(1);
  });

  it('红⑤ team 批置与并发 FOR SHARE 持有者互斥→零复活：批 UPDATE 等持有者提交后才 tombstone', async () => {
    const { teamId, projectIds } = await mkTeam(1);
    const pid = projectIds[0];
    await service.disbandTeam(teamId, owner);
    // 模拟并发 appendBatch 事务：fenceProject FOR SHARE 持有（未提交）；tick 的事务在批 UPDATE
    //（行排他）上排队——持有者提交前项目不复活不越置，提交后被 tombstone（零复活）。
    let tickPromise: Promise<void> | null = null;
    await prismaService.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "lifecycleState" FROM "CanvasProject" WHERE "id" = ${pid}::text FOR SHARE`;
      tickPromise = poller.tick();
      await new Promise((r) => setTimeout(r, 400));
      expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: pid } })).lifecycleState).toBe('ACTIVE');   // 互斥：持有者在档批置不落
    });
    await tickPromise!;   // 持有者提交后 tick 完成
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: pid } })).lifecycleState).toBe('DELETING');   // 零复活：持有者提交后被 tombstone
    const teamRun = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeType: 'team', scopeId: teamId } });
    expect(await prisma.projectErasureRun.findFirst({ where: { scopeType: 'project', scopeId: pid, parentRunId: teamRun.erasureId } })).toMatchObject({ state: 'PENDING' });
  });

  it('红⑤-b 会合判定：一子 FAILED→team run FAILED 不删 Team；子全 DONE→PURGING_TEAM（ledger 通行证）→删 Team 行→team run DONE', async () => {
    // 负路径：一子 FAILED
    const { teamId: t1, projectIds: p1 } = await mkTeam(2);
    await service.disbandTeam(t1, owner);
    await poller.tick();   // 分批置 DELETING+子 run
    const teamRun1 = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeType: 'team', scopeId: t1 } });
    expect(teamRun1.state).toBe('WAITING_CHILDREN');   // 全批置完→会合态
    const children1 = await prisma.projectErasureRun.findMany({ where: { parentRunId: teamRun1.erasureId } });
    expect(children1).toHaveLength(2);
    await prisma.projectErasureRun.update({ where: { erasureId: children1[0].erasureId }, data: { state: 'DONE', completedAt: new Date() } });
    await prisma.projectErasureRun.update({ where: { erasureId: children1[1].erasureId }, data: { state: 'FAILED', error: 'x' } });
    await poller.tick();   // 会合判定：FAILED 传染
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: teamRun1.erasureId } })).state).toBe('FAILED');
    expect(await prisma.team.findUnique({ where: { id: t1 } })).not.toBeNull();   // 不删 Team
    // 正路径：子全 DONE→删 Team（TeamBalance 行经 ledger 单一口 ensureBalance 建——single-writer 门禁）
    const { teamId: t2, projectIds: p2 } = await mkTeam(2);
    await ledger.runInTx(async (tx) => ledger.ensureBalance(tx, t2));   // 钱包行在=级联删 TeamBalance 触发 ledger_guard（通行证面实证载体）
    await service.disbandTeam(t2, owner);
    await poller.tick();   // 分批+子 run（子 PENDING）
    const teamRun2 = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeType: 'team', scopeId: t2 } });
    const children2 = await prisma.projectErasureRun.findMany({ where: { parentRunId: teamRun2.erasureId } });
    expect(children2).toHaveLength(2);
    for (const c of children2) {
      await prisma.projectErasureRun.update({ where: { erasureId: c.erasureId }, data: { state: 'DONE', completedAt: new Date() } });
    }
    await poller.tick();   // 会合：全 DONE→PURGING_TEAM→ledger 通行证→team.delete→DONE
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: teamRun2.erasureId } })).state).toBe('DONE');
    expect(await prisma.team.findUnique({ where: { id: t2 } })).toBeNull();   // 删 Team 行（级联成员/项目行）
    expect(p1).toHaveLength(2);   // （负路径团队项目行由 afterAll 清理——Team 行保留面红⑤-b 断言已尽）
    expect(p2).toHaveLength(2);   // （正路径团队项目行随 Team 级联删除——红⑤-b 断言已尽）
  });

  it('红⑥-a DISBANDING 全路径拦截：创建项目/邀请 400；URL 路由（TeamGuard）403；管理操作 403；重复解散 409', async () => {
    const { teamId } = await mkTeam(0);
    const run = await service.disbandTeam(teamId, owner);
    // 创建项目（assertTeamMember 嵌套 team.status='ACTIVE' 过滤）→403
    await expect(assertTeamMember(prisma as any, teamId, owner)).rejects.toThrow(ForbiddenException);
    // 邀请（apply：status!=='ACTIVE'→400 已既有）
    await expect(service.apply(teamId, owner)).rejects.toThrow('团队不存在或已解散');
    // 管理操作（assertEditable：status!=='ACTIVE'→403）
    await expect(service.renameTeam(teamId, owner, 'x')).rejects.toThrow(ForbiddenException);
    // URL 路由（TeamGuard 直团队源：status!=='ACTIVE'→403）
    const guard = new TeamGuard(new Reflector(), prismaService as any);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ params: { id: teamId }, user: { id: owner } }) }),
      getHandler: () => function handler() {},   // 无 TEAM_SOURCE 元数据=team 直源
    } as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    // 重复解散：DISBANDING 无活跃 run → 409（终态 run 后 re-drive 归 C4-c ops 面）
    await prisma.projectErasureRun.update({ where: { erasureId: run.erasureId }, data: { state: 'FAILED', error: 'seed' } });
    await expect(service.disbandTeam(teamId, owner)).rejects.toThrow(ConflictException);
  });
});
