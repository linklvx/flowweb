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

  // ═══ 评审 P1-1（C4-a spec 评审 2026-11-06）：资金门 TOCTOU 回归窗 ═══
  // 旧 disbandTeam 的 Team FOR UPDATE 与 generation-intent claim 的 Team FOR SHARE（claimTx
  // generation-intent.service.ts:149）互斥=门后置可见（Z26「穿门窗口关闭」）；C4-a fenceTeam=FOR
  // SHARE 与 claim FOR SHARE **兼容**——并发未提交 claim（ExecutionRequest+reservedCredit 置入中）
  // 期间 fence/门①先行通过⇒团队可带在飞冻结资金进 DISBANDING 且会合 PURGING_TEAM 无二次过门。
  // 修法=team.update（行排他）后**重跑一次 assertSettled**：先到 claim 已提交可见→409 回滚；后到
  // claim 被 DISBANDING 拒（claimTx FOR SHARE 读 status≠ACTIVE 即拒）。
  it('P1-1-a 并发未提交 claim 持 Team FOR SHARE+置入 reservedCredit → disbandTeam 阻塞于 team.update→claim 提交→门②见资金→409 回滚（team 仍 ACTIVE 无 run）', async () => {
    const { teamId } = await mkTeam(0);
    const prismaB = new PrismaClient();   // 双 PrismaClient 并发夹具（C2-1 红③-c 先例形态）
    let disbandPromise: Promise<unknown> | null = null;
    await prismaB.$transaction(async (tx) => {
      // claim 形态仿真：claimTx 首句 Team FOR SHARE（generation-intent.service.ts:149 同款）+同事务
      // 置入 ExecutionRequest（reservedCredit>0）——提交前 disband 的门①不可见
      await tx.$queryRaw`SELECT "status" FROM "Team" WHERE id = ${teamId}::text FOR SHARE`;
      disbandPromise = service.disbandTeam(teamId, owner);
      await new Promise((r) => setTimeout(r, 400));
      // 阻塞面实证：disband 卡在 team.update（行排他等 claim 的 FOR SHARE）——Team 仍 ACTIVE 未置 DISBANDING
      expect((await prisma.team.findUniqueOrThrow({ where: { id: teamId } })).status).toBe('ACTIVE');
      await tx.executionRequest.create({
        data: {
          requestId: `rq-p11-${teamId}`, projectId: `p11-${teamId}`, generation: 1, historyId: 'h', docSeq: 1n, frozenDocSeq: 1n,
          userId: owner, teamId, kind: 'text', state: 'ADMITTED', reservedCredit: 4, totalCredit: 4,
          planHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000),
        },
      });   // claim 载荷在事务内——提交后才对 disband 门②可见
    });   // claim 提交（FOR SHARE 释放→disband 的 team.update 获得→门②见资金）
    await expect(disbandPromise).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS', status: 409 });
    expect((await prisma.team.findUniqueOrThrow({ where: { id: teamId } })).status).toBe('ACTIVE');   // 整事务回滚
    expect(await prisma.projectErasureRun.findFirst({ where: { scopeType: 'team', scopeId: teamId } })).toBeNull();
    await prisma.executionRequest.deleteMany({ where: { teamId, requestId: `rq-p11-${teamId}` } });
    await prismaB.$disconnect();
  });

  it('P1-1-b 对照：claim 持锁提交但零资金载荷 → 门②放行（disband 成功——非误杀）', async () => {
    const { teamId } = await mkTeam(0);
    const prismaB = new PrismaClient();
    let disbandPromise: Promise<unknown> | null = null;
    await prismaB.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "status" FROM "Team" WHERE id = ${teamId}::text FOR SHARE`;
      disbandPromise = service.disbandTeam(teamId, owner);
      await new Promise((r) => setTimeout(r, 300));
    });   // claim 提交（零资金）
    const run = await disbandPromise;
    expect(run).toMatchObject({ scopeType: 'team', scopeId: teamId, state: 'PENDING' });
    await prismaB.$disconnect();
  });

  // ═══ 评审 P2-6：资金门 team 维三面独立断言（现仅 project 维有——C4-a 红①-e 补齐对称面） ═══
  it('P2-6 资金门 team 维三面：ExecutionRequest(teamId)/RefundObligation(经 intent.teamId)/StorageReservation(teamId) 任一在飞 ⇒ 409', async () => {
    const t1 = (await mkTeam(0)).teamId;
    await prisma.executionRequest.create({
      data: {
        requestId: `rq-p26a-${t1}`, projectId: 'p26-any', generation: 1, historyId: 'h', docSeq: 1n, frozenDocSeq: 1n,
        userId: owner, teamId: t1, kind: 'text', state: 'EXECUTING', reservedCredit: 2, totalCredit: 2,
        planHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await expect(fundsGate.assertSettled(prisma as any, { teamId: t1 })).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS' });
    await prisma.executionRequest.deleteMany({ where: { teamId: t1 } });

    const t2 = (await mkTeam(0)).teamId;
    const gi = await prisma.generationIntent.create({
      data: {
        projectId: 'p26-any2', nodeId: 'n1', userId: owner, teamId: t2, intentId: `it-p26-${t2}`,
        kind: 'text', paramsHash: 'ph', creditCost: 1, heartbeatAt: new Date(), deadlineAt: new Date(),
        idemKey: `idem-p26-${t2}-${Date.now()}`, execSeq: BigInt(Date.now() + 1),
      },
    });
    await prisma.refundObligation.create({ data: { intentRowId: gi.id, execSeq: 1n, reversesId: 'r1', creditAmount: 1 } });
    await expect(fundsGate.assertSettled(prisma as any, { teamId: t2 })).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS' });
    await prisma.refundObligation.deleteMany({ where: { intentRowId: gi.id } });
    await prisma.generationIntent.deleteMany({ where: { id: gi.id } });

    const t3 = (await mkTeam(0)).teamId;
    await prisma.storageReservation.create({ data: { teamId: t3, mediaId: `sr-p26-${t3}-${Date.now()}`, upperBoundBytes: 10n } });
    await expect(fundsGate.assertSettled(prisma as any, { teamId: t3 })).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS' });
    await prisma.storageReservation.deleteMany({ where: { teamId: t3 } });
    // 三面全清后放行（门非全拒）
    await expect(fundsGate.assertSettled(prisma as any, { teamId: t3 })).resolves.toBeUndefined();
  });

  // ═══ 评审 P2-1：毒丸 run——Team 行缺失（out-of-band/PITR）+子全 DONE→team.delete P2025 裸抛=
  // 整事务回滚 run 永悬 WAITING_CHILDREN 每 tick WARN 无限重试（评审实跑 dev 库积压已代清） ═══
  it('P2-1 Team 行缺失+子全 DONE → P2025 折幂等成功置 DONE（零永悬重试——目标态 Team 不在已达成）', async () => {
    const { teamId, projectIds } = await mkTeam(1);
    await service.disbandTeam(teamId, owner);
    await poller.tick();   // 分批置 DELETING+子 run（1 子）
    const teamRun = await prisma.projectErasureRun.findFirstOrThrow({ where: { scopeType: 'team', scopeId: teamId } });
    const children = await prisma.projectErasureRun.findMany({ where: { parentRunId: teamRun.erasureId } });
    expect(children).toHaveLength(1);
    await prisma.projectErasureRun.update({ where: { erasureId: children[0].erasureId }, data: { state: 'DONE', completedAt: new Date() } });
    // out-of-band Team 行消失（无钱包行——ledger_guard 零触发面；项目行随级联消亡）
    await prisma.canvasProject.deleteMany({ where: { teamId } });
    await prisma.teamMember.deleteMany({ where: { teamId } });
    await prisma.team.delete({ where: { id: teamId } });
    await poller.tick();   // 修前：P2025 回滚 WARN 永悬；修后：折幂等 DONE
    expect((await prisma.projectErasureRun.findUniqueOrThrow({ where: { erasureId: teamRun.erasureId } })).state).toBe('DONE');
    expect(projectIds).toHaveLength(1);   // （fixture 行已随 Team 级联清——afterAll catch 兜底）
  });
});
