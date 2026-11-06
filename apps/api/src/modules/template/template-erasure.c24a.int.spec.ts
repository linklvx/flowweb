// C4-a（plan Task C4-1 红③⑥-b——生产就绪收尾批·project-erasure）：template.service.delete 交互事务
// 原子化（红③）+project.controller DELETE PROJECT_OWNER 鉴权（红⑥-b）int spec（真 PG）。
//  红③：lockProject+tombstone+资金门 in-tx——模板行删除与项目 tombstone/run 行同事务原子（资金门
//   拦截⇒模板行不删——数组事务时代的"gate 失败模板仍删"竞窗根除）；无关联工程=仅删模板（原行为）。
//  红⑥-b：MEMBER（团队角色回退=PROJECT_EDITOR）→403；显式 PROJECT_OWNER 非创建者→通过（tombstone）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { TemplateService } from './template.service';
import { ProjectService } from '../project/project.service';
import { ProjectController } from '../project/project.controller';
import { TeamFundsGateService } from '../team/team-funds-gate.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FIXTURE_USER, FIXTURE_TEAM } from '../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

maybe('C4-a 红③⑥-b template 原子事务+controller 鉴权（真 PG）', () => {
  const prisma = new PrismaClient();
  const prismaService = new PrismaService();
  const fundsGate = new TeamFundsGateService(prismaService as any);
  const emitter = { emitAsync: vi.fn(async () => []) };
  const teamService = { ensureDefaultTeam: async () => ({ id: FIXTURE_TEAM }) } as any;
  const projectService = new ProjectService(prismaService as any, teamService, fundsGate, emitter as any);
  const perm = new ProjectPermissionService(prismaService as any);
  const templateService = new TemplateService(
    prismaService as any, {} as any, teamService, fundsGate, perm, emitter as any,
  );
  const controller = new ProjectController(projectService, prismaService as any, perm);
  const createdIds: string[] = [];
  let seq = 0;
  const mkProject = async () => {
    const id = `c24a-tpl-proj-${Date.now().toString(36)}-${seq++}`;
    await prisma.canvasProject.create({ data: { id, name: `c24a-tpl-${seq}`, teamId: FIXTURE_TEAM, userId: FIXTURE_USER } });
    createdIds.push(id);
    return id;
  };

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: FIXTURE_USER }, update: {},
      create: { id: FIXTURE_USER, name: 'c24a-tpl', email: 'c24a-tpl@local.test', emailVerified: true },
    });
    await prisma.team.upsert({
      where: { id: FIXTURE_TEAM }, update: {},
      create: { id: FIXTURE_TEAM, name: 'c24a-tpl-team', ownerId: FIXTURE_USER },
    });
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await prisma.projectErasureRun.deleteMany({ where: { scopeId: id } }).catch(() => undefined);
      await prisma.template.deleteMany({ where: { projectId: id } }).catch(() => undefined);
      await prisma.canvasProject.deleteMany({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  });

  it('红③-a 模板级联删工程=交互事务原子：lockProject+tombstone+资金门 in-tx+模板行同事务删', async () => {
    const projectId = await mkProject();
    const tpl = await prisma.template.create({ data: { name: 'c24a-tpl', userId: FIXTURE_USER, projectId, teamId: FIXTURE_TEAM } });
    const run = await templateService.delete(tpl.id, FIXTURE_USER);
    expect(run).toMatchObject({ scopeType: 'project', scopeId: projectId, state: 'PENDING', dryRun: false });
    expect(await prisma.template.findUnique({ where: { id: tpl.id } })).toBeNull();              // 模板行删（解除 projectId FK）
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: projectId } })).lifecycleState).toBe('DELETING');   // tombstone
    expect(await prisma.projectErasureRun.findFirst({ where: { scopeId: projectId } })).toMatchObject({ state: 'PENDING' });
    expect(emitter.emitAsync).toHaveBeenCalledWith('project.gone', { projectIds: [projectId] });
  });

  it('红③-b 资金门拦截⇒整事务回滚（原子：模板行不删、不置位、无 run 行）', async () => {
    const projectId = await mkProject();
    const tpl = await prisma.template.create({ data: { name: 'c24a-tpl-gated', userId: FIXTURE_USER, projectId, teamId: FIXTURE_TEAM } });
    await prisma.executionRequest.create({
      data: {
        requestId: `rq-tpl-${projectId}`, projectId, generation: 1, historyId: 'h', docSeq: 1n, frozenDocSeq: 1n,
        userId: FIXTURE_USER, teamId: FIXTURE_TEAM, kind: 'text', state: 'EXECUTING', reservedCredit: 3, totalCredit: 3,
        planHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await expect(templateService.delete(tpl.id, FIXTURE_USER)).rejects.toMatchObject({ errorCode: 'TEAM_HAS_ACTIVE_FUNDS', status: 409 });
    expect(await prisma.template.findUnique({ where: { id: tpl.id} })).not.toBeNull();          // 原子：模板行回滚在
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: projectId } })).lifecycleState).toBe('ACTIVE');
    expect(await prisma.projectErasureRun.findFirst({ where: { scopeId: projectId } })).toBeNull();
    await prisma.executionRequest.deleteMany({ where: { projectId } });
  });

  it('红③-c 无关联工程：仅删模板（原行为保留——tombstone 不涉）', async () => {
    emitter.emitAsync.mockClear();   // 共享 spy——前序用例 emit 不计入本断言
    const tpl = await prisma.template.create({ data: { name: 'c24a-tpl-bare', userId: FIXTURE_USER, teamId: FIXTURE_TEAM } });
    const res = await templateService.delete(tpl.id, FIXTURE_USER);
    expect(res).toBeNull();
    expect(await prisma.template.findUnique({ where: { id: tpl.id } })).toBeNull();
    expect(emitter.emitAsync).not.toHaveBeenCalledWith('project.gone', expect.anything());
  });

  it('红⑥-b-a MEMBER（团队角色回退=PROJECT_EDITOR）→403（不 tombstone 无 run）', async () => {
    const projectId = await mkProject();
    const member = 'c24a-tpl-member';
    await prisma.user.upsert({ where: { id: member }, update: {}, create: { id: member, name: member, email: `${member}@local.test`, emailVerified: true } });
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: FIXTURE_TEAM, userId: member } },
      update: { role: 'MEMBER' },
      create: { teamId: FIXTURE_TEAM, userId: member, role: 'MEMBER' },
    });
    await expect(controller.delete(projectId, undefined, { user: { id: member } } as any))
      .rejects.toThrow(ForbiddenException);
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: projectId } })).lifecycleState).toBe('ACTIVE');
    expect(await prisma.projectErasureRun.findFirst({ where: { scopeId: projectId } })).toBeNull();
    await prisma.teamMember.delete({ where: { teamId_userId: { teamId: FIXTURE_TEAM, userId: member } } }).catch(() => undefined);
  });

  it('红⑥-b-b 显式 PROJECT_OWNER 非创建者→通过（202 run——perm.resolve 解析链含显式行档）', async () => {
    const projectId = await mkProject();
    const explicitOwner = 'c24a-tpl-owner';
    await prisma.user.upsert({ where: { id: explicitOwner }, update: {}, create: { id: explicitOwner, name: explicitOwner, email: `${explicitOwner}@local.test`, emailVerified: true } });
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: FIXTURE_TEAM, userId: explicitOwner } },
      update: { role: 'MEMBER' },
      create: { teamId: FIXTURE_TEAM, userId: explicitOwner, role: 'MEMBER' },   // 团队角色=MEMBER（回退 EDITOR 档）
    });
    await prisma.projectMember.create({ data: { projectId, userId: explicitOwner, role: 'PROJECT_OWNER' } });     // 显式行=OWNER（优先于回退链）
    const run = await controller.delete(projectId, undefined, { user: { id: explicitOwner } } as any);
    expect(run).toMatchObject({ scopeId: projectId, state: 'PENDING' });
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: projectId } })).lifecycleState).toBe('DELETING');
  });
});
