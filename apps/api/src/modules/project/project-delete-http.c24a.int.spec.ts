// C4-a spec 评审 P1-2（2026-11-06）：HTTP 重复删除 202 同 run（plan 红①字面「重复删除→活跃 run
// 存在→202 返回该 run」）。C4-a 首版 TeamGuard @TeamSource('project')+perm.resolve 经恒激活读过滤
// 对 DELETING 行 404 先于 service 幂等路径——偏离。修法=DELETE 路由拆 guard 改 handler 内
// runWithIncludeDeleted 包裹存在性/权限解析面（最小面）。HTTP 装置=collab-ops-unfreeze.c23 int 同族
// （app.listen(0)+raw fetch+真守卫链+手动构造 useValue 直注——esbuild 无 emitDecoratorMetadata）。
// 断言：①首删 202+run 视图；②重复删除 202 **同 erasureId**（修前红=404）；③缺失 404；④MEMBER 403。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../../auth/session.service';
import { AuthGuard } from '../../auth/auth.guard';
import { Reflector } from '@nestjs/core';
import { TeamGuard } from '../team/team.guard';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { TeamFundsGateService } from '../team/team-funds-gate.service';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const OWNER = `c24a-http-owner-${Date.now().toString(36)}`;
const MEMBER = `c24a-http-member-${Date.now().toString(36)}`;
const TEAM = `c24a-http-team-${Date.now().toString(36)}`;
const OWNER_COOKIE = `flowweb.session_token=c24a-http-tok-owner`;
const MEMBER_COOKIE = `flowweb.session_token=c24a-http-tok-member`;

let prisma: PrismaClient;
let app: INestApplication;
let baseUrl: string;
const createdProjects: string[] = [];

async function del(id: string, cookie: string): Promise<{ status: number; json: any }> {
  const r = await fetch(`${baseUrl}/api/projects/${id}`, { method: 'DELETE', headers: { cookie } });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function seedUser(id: string, token: string): Promise<void> {
  await prisma.user.upsert({
    where: { id }, update: {},
    create: { id, name: id, email: `${id}@local.test`, emailVerified: true },
  });
  await prisma.session.deleteMany({ where: { token } });
  await prisma.session.create({
    data: { id: `sess-${token}`, userId: id, token, expiresAt: new Date(Date.now() + 3_600_000) },
  });
}

maybe('C4-a 评审 P1-2：HTTP DELETE 重复删除幂等 202 同 run', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    await seedUser(OWNER, 'c24a-http-tok-owner');
    await seedUser(MEMBER, 'c24a-http-tok-member');
    await prisma.team.create({ data: { id: TEAM, name: 'c24a-http', ownerId: OWNER } });
    await prisma.teamMember.create({ data: { teamId: TEAM, userId: OWNER, role: 'OWNER' } });
    await prisma.teamMember.create({ data: { teamId: TEAM, userId: MEMBER, role: 'MEMBER' } });

    // 真守卫链装置：PrismaService 实例（读过滤恒激活——本 spec 的红/绿载体）+真 guard 链
    const prismaService = new PrismaService();
    const sessionSvc = new SessionService(prisma as unknown as PrismaService);
    const fundsGate = new TeamFundsGateService(prismaService as any);
    const emitter = { emitAsync: vi.fn(async () => []) };
    const teamService = { ensureDefaultTeam: async () => ({ id: TEAM }) } as any;
    const projectService = new ProjectService(prismaService as any, teamService, fundsGate, emitter as any);
    const perm = new ProjectPermissionService(prismaService as any);
    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        { provide: PrismaService, useValue: prismaService },
        { provide: ProjectService, useValue: projectService },
        { provide: ProjectPermissionService, useValue: perm },
        // @UseGuards(TeamGuard) 类令牌解析（esbuild 无 emitDecoratorMetadata——类 provider 构造注入
        // 不解析：useValue 实例直注，c23 同律）
        { provide: TeamGuard, useValue: new TeamGuard(new Reflector(), prismaService as any) },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new AuthGuard(sessionSvc));   // 生产装配面=app.module APP_GUARD（TeamGuard 面=路由自挂）
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await app?.close();
    for (const pid of createdProjects) {
      await prisma.projectErasureRun.deleteMany({ where: { scopeId: pid } }).catch(() => undefined);
      await prisma.canvasProject.deleteMany({ where: { id: pid } }).catch(() => undefined);
    }
    await prisma.teamMember.deleteMany({ where: { teamId: TEAM } }).catch(() => undefined);
    await prisma.team.deleteMany({ where: { id: TEAM } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: [OWNER, MEMBER] } } });
    await prisma.user.deleteMany({ where: { id: { in: [OWNER, MEMBER] } } });
    await prisma.$disconnect();
  }, 20_000);

  const mkProject = async () => {
    const pid = `c24a-http-p-${Date.now().toString(36)}-${createdProjects.length}`;
    await prisma.canvasProject.create({ data: { id: pid, name: pid, teamId: TEAM, userId: OWNER } });
    createdProjects.push(pid);
    return pid;
  };

  it('P1-2-a 首删 202+run 视图；重复删除 202 **同 erasureId**（修前红=404 先于幂等路径）', async () => {
    const pid = await mkProject();
    const first = await del(pid, OWNER_COOKIE);
    expect(first.status).toBe(202);
    expect(first.json).toMatchObject({ scopeType: 'project', scopeId: pid, state: 'PENDING' });
    const again = await del(pid, OWNER_COOKIE);
    expect(again.status).toBe(202);   // 修前：TeamGuard project 源读过滤 → 404（偏离 plan 红①字面）
    expect(again.json.erasureId).toBe(first.json.erasureId);
    expect(again.json.state).toBe('PENDING');
    // raw 面：行仍在（DELETING）+run 恰一条（幂等非二行）
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: pid } })).lifecycleState).toBe('DELETING');
    expect(await prisma.projectErasureRun.count({ where: { scopeId: pid } })).toBe(1);
  });

  it('P1-2-b 缺失行 → 404（包裹内真缺失仍 404——includeDeleted 只放行 DELETING 行非造行）', async () => {
    const r = await del('c24a-nonexistent-pid', OWNER_COOKIE);
    expect(r.status).toBe(404);
  });

  it('P1-2-c MEMBER（非 OWNER——perm 解析链 403 档随修后路由面不回归）', async () => {
    const pid = await mkProject();
    const r = await del(pid, MEMBER_COOKIE);
    expect(r.status).toBe(403);
    expect((await prisma.canvasProject.findUniqueOrThrow({ where: { id: pid } })).lifecycleState).toBe('ACTIVE');
  });
});
