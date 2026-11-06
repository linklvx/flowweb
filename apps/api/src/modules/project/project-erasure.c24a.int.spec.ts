// C4-a（plan Task C4-1 红①②⑦——生产就绪收尾批·project-erasure）：project.service.delete/
// cleanDrafts tombstone-only int spec（真 PG）。断言面：
//  红① delete=tombstone+run（请求返回行仍在 DELETING）+幂等（重复删→同 run 202）+kill -9 on emit
//   （提交后 emit 崩→run 行持久恢复锚——重复请求同 run）+DONE 后再删（restore 形态）→新 run
//   （partial unique）+DRY_RUN（dryRun=true 且跳过 lifecycle 置位——项目不隐藏）+资金门扩查拦截
//   （ExecutionRequest/RefundObligation/StorageReservation 三面→409 回滚）；
//  红② cleanDrafts 判据（origin NULL/'user'∧无 Template∧24h tombstone；origin='clone' 不删）；
//  红⑦ 读路径（tombstone 后 findById→404〔PrismaService 读过滤〕+admin 开关 runWithIncludeDeleted
//   可见 DELETING——raw client 断言行在）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { ProjectService } from './project.service';
import { TeamFundsGateService } from '../team/team-funds-gate.service';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithIncludeDeleted } from '../../prisma/read-path.filter';
import { FIXTURE_USER, FIXTURE_TEAM } from '../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

maybe('C4-a 红①②⑦ project tombstone-only（真 PG）', () => {
  const prisma = new PrismaClient();          // raw 面（断言/fixture——不过读过滤）
  const prismaService = new PrismaService();  // 服务面（读过滤生效——红⑦ 载体）
  const fundsGate = new TeamFundsGateService(prismaService as any);
  const emitter = { emitAsync: vi.fn(async () => []) };
  const teamService = { ensureDefaultTeam: async () => ({ id: FIXTURE_TEAM }) } as any;
  const service = new ProjectService(prismaService as any, teamService, fundsGate, emitter as any);
  const createdIds: string[] = [];
  let seq = 0;
  const mkProject = async (opts: { origin?: string | null; updatedAt?: Date; userId?: string } = {}) => {
    const id = `c24a-proj-${Date.now().toString(36)}-${seq++}`;
    await prisma.canvasProject.create({
      data: { id, name: `c24a-${seq}`, teamId: FIXTURE_TEAM, userId: opts.userId ?? null, origin: opts.origin ?? null },
    });
    if (opts.updatedAt) {
      await prisma.$executeRaw`UPDATE "CanvasProject" SET "updatedAt" = ${opts.updatedAt} WHERE id = ${id}`;
    }
    createdIds.push(id);
    return id;
  };

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: FIXTURE_USER }, update: {},
      create: { id: FIXTURE_USER, name: 'c24a', email: 'c24a@local.test', emailVerified: true },
    });
    for (const [uid, email] of [['c24a-draft-user', 'c24a-draft@local.test'], ['c24a-read-user', 'c24a-read@local.test']] as const) {
      await prisma.user.upsert({
        where: { id: uid }, update: {},
        create: { id: uid, name: uid, email, emailVerified: true },
      });
    }
    await prisma.team.upsert({
      where: { id: FIXTURE_TEAM }, update: {},
      create: { id: FIXTURE_TEAM, name: 'c24a-team', ownerId: FIXTURE_USER },
    });
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.projectErasureRun.deleteMany({ where: { scopeId: id } }).catch(() => undefined);
      await prisma.executionRequest.deleteMany({ where: { projectId: id } }).catch(() => undefined);
      await prisma.template.deleteMany({ where: { projectId: id } }).catch(() => undefined);
      await prisma.canvasProject.deleteMany({ where: { id } }).catch(() => undefined);
    }
    // 资金门 fixture 三面（execSeq 全局 @unique——残留行跨 run 撞键；media/reservation/orphan 无 FK 面）
    const intentIds = (await prisma.generationIntent.findMany({ where: { teamId: FIXTURE_TEAM, idemKey: { startsWith: 'idem-c24a-proj-' } }, select: { id: true } })).map((r) => r.id);
    if (intentIds.length > 0) await prisma.refundObligation.deleteMany({ where: { intentRowId: { in: intentIds } } }).catch(() => undefined);
    await prisma.generationIntent.deleteMany({ where: { id: { in: intentIds } } }).catch(() => undefined);
    await prisma.storageReservation.deleteMany({ where: { teamId: FIXTURE_TEAM } }).catch(() => undefined);
    await prisma.media.deleteMany({ where: { key: { startsWith: 'c24a-' } } }).catch(() => undefined);
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  });

  it('红①-a delete=tombstone+run：请求返回时行仍在（DELETING）+run PENDING+emit project.gone', async () => {
    const id = await mkProject();
    const run = await service.delete(id, FIXTURE_USER);
    expect(run).toMatchObject({ scopeType: 'project', scopeId: id, state: 'PENDING', dryRun: false });
    const row = await prisma.canvasProject.findUniqueOrThrow({ where: { id } });
    expect(row.lifecycleState).toBe('DELETING');   // tombstone-only：行不物理删
    const runRow = await prisma.projectErasureRun.findUnique({ where: { erasureId: run.erasureId } });
    expect(runRow).toMatchObject({ scopeType: 'project', scopeId: id, state: 'PENDING', requestedBy: FIXTURE_USER, dryRun: false });
    expect(emitter.emitAsync).toHaveBeenCalledWith('project.gone', { projectIds: [id] });
  });

  it('红①-b kill -9 on emit→run 恢复：提交后 emit 崩（上抛不回滚）→行 DELETING+run 持久；重复删除请求→活跃 run 存在→同 run 幂等返回', async () => {
    const id = await mkProject();
    const boom = { emitAsync: vi.fn(async () => { throw new Error('kill -9 on emit'); }) };
    const svc = new ProjectService(prismaService as any, teamService, fundsGate, boom as any);
    // tombstone-only：emit 崩溃不影响已提交状态（catch-warn 形态——run=恢复锚）
    const run1 = await svc.delete(id, FIXTURE_USER);
    const row = await prisma.canvasProject.findUniqueOrThrow({ where: { id } });
    expect(row.lifecycleState).toBe('DELETING');
    const again = await service.delete(id, FIXTURE_USER);
    expect(again.erasureId).toBe(run1.erasureId);   // 幂等：同 run（非二行）
    expect(again.state).toBe('PENDING');
  });

  it('红①-c DONE 后再删（restore 形态）→新 run（partial unique：终态 run 不阻塞新 run）', async () => {
    const id = await mkProject();
    const run1 = await service.delete(id, FIXTURE_USER);
    await prisma.projectErasureRun.update({ where: { erasureId: run1.erasureId }, data: { state: 'DONE', completedAt: new Date() } });
    // restore 形态：行回 ACTIVE（PITR 恢复点）——DONE run 在档再删=新 run
    await prisma.canvasProject.update({ where: { id }, data: { lifecycleState: 'ACTIVE' } });
    const run2 = await service.delete(id, FIXTURE_USER);
    expect(run2.erasureId).not.toBe(run1.erasureId);
    expect(run2.state).toBe('PENDING');
  });

  it('红①-d DRY_RUN：dryRun=true 且跳过 lifecycle 置位（项目不隐藏）；dryRun run 后真实删→新真实 run（不占真实唯一）', async () => {
    const id = await mkProject();
    const dry = await service.delete(id, FIXTURE_USER, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    const row = await prisma.canvasProject.findUniqueOrThrow({ where: { id } });
    expect(row.lifecycleState).toBe('ACTIVE');   // 跳过置位——项目不隐藏
    const real = await service.delete(id, FIXTURE_USER);
    expect(real.dryRun).toBe(false);
    expect(real.erasureId).not.toBe(dry.erasureId);
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id } })).lifecycleState).toBe('DELETING');
  });

  it('红①-e 资金门扩查三面拦截（in-tx 持锁检查→409 回滚：不置位无 run 行）', async () => {
    // 面 1：ExecutionRequest ADMITTED∧reservedCredit>0
    const idExec = await mkProject();
    await prisma.executionRequest.create({
      data: {
        requestId: `rq-${idExec}`, projectId: idExec, generation: 1, historyId: 'h', docSeq: 1n, frozenDocSeq: 1n,
        userId: FIXTURE_USER, teamId: FIXTURE_TEAM, kind: 'text', state: 'ADMITTED', reservedCredit: 5, totalCredit: 5,
        planHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await expect(service.delete(idExec, FIXTURE_USER)).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS', status: 409 });
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: idExec } })).lifecycleState).toBe('ACTIVE');
    expect(await prisma.projectErasureRun.findFirst({ where: { scopeId: idExec } })).toBeNull();
    // 面 2：RefundObligation PENDING（经 GenerationIntent 归属）——execSeq 全局 @unique：时间基防残留撞键
    const idRefund = await mkProject();
    const gi = await prisma.generationIntent.create({
      data: {
        projectId: idRefund, nodeId: 'n1', userId: FIXTURE_USER, teamId: FIXTURE_TEAM, intentId: `it-${idRefund}`,
        kind: 'text', paramsHash: 'ph', creditCost: 1, heartbeatAt: new Date(), deadlineAt: new Date(), idemKey: `idem-${idRefund}`, execSeq: BigInt(Date.now()),
      },
    });
    await prisma.refundObligation.create({ data: { intentRowId: gi.id, execSeq: 1n, reversesId: 'r1', creditAmount: 1 } });
    await expect(service.delete(idRefund, FIXTURE_USER)).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS', status: 409 });
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: idRefund } })).lifecycleState).toBe('ACTIVE');
    // 面 3：StorageReservation ACTIVE（经 Media.projectId 归属）
    const idStorage = await mkProject();
    const media = await prisma.media.create({
      data: { userId: FIXTURE_USER, teamId: FIXTURE_TEAM, key: `c24a-${idStorage}`, originalName: 'f', mimeType: 'image/png', size: 1n, projectId: idStorage, type: 'uploaded' },
    });
    await prisma.storageReservation.create({ data: { teamId: FIXTURE_TEAM, mediaId: media.id, upperBoundBytes: 10n } });
    await expect(service.delete(idStorage, FIXTURE_USER)).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS', status: 409 });
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: idStorage } })).lifecycleState).toBe('ACTIVE');
  });

  it('红② cleanDrafts 同批 tombstone：判据=（origin NULL|user）∧无 Template∧24h；origin=clone 不删', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const user = 'c24a-draft-user';
    const idUser = await mkProject({ origin: null, updatedAt: old, userId: user });       // origin NULL（存量语义等同 user）
    const idClone = await mkProject({ origin: 'clone', updatedAt: old, userId: user });   // clone 谱系——不删
    const idTemplate = await mkProject({ origin: 'user', updatedAt: old, userId: user }); // 有 Template——不删
    await prisma.template.create({ data: { name: 'tpl', userId: user, projectId: idTemplate, teamId: FIXTURE_TEAM } });
    const idFresh = await mkProject({ origin: 'user', userId: user });                    // 24h 内——不删
    const res = await service.cleanDrafts(user);
    expect(res.deletedCount).toBe(1);
    const states = await prisma.canvasProject.findMany({
      where: { id: { in: [idUser, idClone, idTemplate, idFresh] } },
      select: { id: true, lifecycleState: true },
    });
    const byId = new Map(states.map((s) => [s.id, s.lifecycleState]));
    expect(byId.get(idUser)).toBe('DELETING');   // 判据命中→tombstone
    expect(byId.get(idClone)).toBe('ACTIVE');    // 红②：clone 不被删
    expect(byId.get(idTemplate)).toBe('ACTIVE'); // 有 Template 不删
    expect(byId.get(idFresh)).toBe('ACTIVE');    // 24h 内不删
    expect(await prisma.projectErasureRun.findFirst({ where: { scopeId: idUser, dryRun: false } })).toMatchObject({ state: 'PENDING' });
    expect(emitter.emitAsync).toHaveBeenCalledWith('project.gone', { projectIds: [idUser] });
  });

  it('红②-b cleanDrafts create 接线：clone 谱系经 create(origin) 落列（VideoWorkCloneService 同参）', async () => {
    const created = await service.create('c24a-clone-origin', FIXTURE_USER, undefined, undefined, undefined, 'clone');
    createdIds.push(created.id);
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: created.id } })).origin).toBe('clone');
    const userCreated = await service.create('c24a-user-origin', FIXTURE_USER);
    createdIds.push(userCreated.id);
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: userCreated.id } })).origin).toBe('user');
  });

  it('红⑦ 读路径：tombstone 后 findById（PrismaService 面）→404；admin 开关 runWithIncludeDeleted 可见 DELETING（raw 断言行在）', async () => {
    const id = await mkProject();
    const owner = 'c24a-read-user';
    await prisma.canvasProject.update({ where: { id }, data: { userId: owner } });
    expect(await service.findById(id, owner)).toMatchObject({ id });   // ACTIVE——读得到
    await service.delete(id, FIXTURE_USER);
    await expect(service.findById(id, owner)).rejects.toThrow(NotFoundException);   // 读过滤→404
    // raw 面：行仍在（tombstone 非物理删）
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id } })).lifecycleState).toBe('DELETING');
    // admin/worker/erasure 开关：ALS 包裹内全量可见（includeDeleted 显式开关形态）
    await runWithIncludeDeleted(async () => {
      expect(await prismaService.canvasProject.findUnique({ where: { id } })).toMatchObject({ id, lifecycleState: 'DELETING' });
    });
    // 开关作用域边界：包裹外恢复过滤
    expect(await prismaService.canvasProject.findUnique({ where: { id } })).toBeNull();
  });
});
