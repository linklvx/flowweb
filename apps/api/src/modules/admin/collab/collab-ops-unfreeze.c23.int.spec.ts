// C2-3（plan Task C2-3——生产就绪收尾批·replay-canary）：解冻 ack HTTP 端点红先行 int spec
// （C2-1/C2-2 评审移交：unfreezeOpsGateCompact service 方法已落、无端点——本 spec 结构红=控制器
// 缺失 0 test load，c22a 先红形态同款）。
//  覆盖四件（task 验收口径：鉴权+AuditLog+幂等+全局哨兵行形态）：
//  ①鉴权三档：无 session cookie→401（AuthGuard——/api/admin 非 public 路径）／USER 角色→403
//    （AdminGuard——path 前缀 /api/admin/* 的 ADMIN 角色门）／ADMIN+有效 session→200。
//  ②AuditLog 同事务落痕：解冻成功行（action='collab_ops_gate_unfreeze'，operatorId/operatorName
//    取自 req.user〔session 面〕，targetId=projectId）恰一条——ack 凭证与状态翻转原子（c21 service
//    层已证；本 spec 证端点接线透传不丢）。
//  ③幂等：已 OPEN 再 POST→{unfrozen:false}+审计行数不增（service 幂等语义端点面不破）。
//  ④全局哨兵行（projectId=''——body 形态承载，path param 空段不可表达）：freeze 全局行→同端点解冻
//    +审计落痕（人工 break-glass freeze 的 ack 出口同源，审计旁路禁——C2-1 裁定「审计即 ack 本身」）。
// BigInt 契约：version 恒十进制字符串（JSON 落库纪律——c21 service 注释同律）。
// HTTP 装置=collab-write-endpoint.int.spec 同族：app.listen(0)+raw fetch（真路由+真守卫链）。
// 运行：DATABASE_URL=postgresql://flowweb:flowweb_dev@localhost:5432/flowweb pnpm --filter @flowweb/api test:int
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { SessionService } from '../../../auth/session.service';
import { AuthGuard } from '../../../auth/auth.guard';
import { AdminGuard } from '../../../auth/admin.guard';
import { CollabOpsUnfreezeController } from './collab-ops-unfreeze.controller';
import { freezeOpsGateCompact } from '../../collab/collab-ops-gate.service';
import { OPS_GATE_COMPACT } from '../../collab/project-governance.service';
import { ensureProjectFixture, cleanupProjectFixture } from '../../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const PID = 'c23-unfreeze-int';
const ADMIN_ID = 'c23-admin-1';
const USER_ID = 'c23-user-1';
const ADMIN_TOKEN = 'c23-tok-admin';
const USER_TOKEN = 'c23-tok-user';

let prisma: PrismaClient;
let app: INestApplication;
let baseUrl: string;

/** raw fetch POST（write-endpoint int spec 同族装置面）。 */
async function post(body: unknown, cookie?: string): Promise<{ status: number; json: any }> {
  const r = await fetch(`${baseUrl}/api/admin/collab/ops-gate/unfreeze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function seedUser(id: string, role: 'ADMIN' | 'USER', token: string): Promise<void> {
  await prisma.user.upsert({
    where: { id },
    update: { role },
    create: { id, name: `c23-${role.toLowerCase()}`, email: `${id}@local.test`, emailVerified: true, role },
  });
  await prisma.session.deleteMany({ where: { token } });
  await prisma.session.create({
    data: { id: `c23-sess-${id}`, userId: id, token, expiresAt: new Date(Date.now() + 3600_000) },
  });
}

async function gateState(projectId: string): Promise<{ state: string; version: bigint; unfrozenAt: Date | null } | null> {
  return prisma.collabOpsGate.findUnique({ where: { gate_projectId: { gate: OPS_GATE_COMPACT, projectId } } }) as
    Promise<{ state: string; version: bigint; unfrozenAt: Date | null } | null>;
}

async function auditCount(projectId: string): Promise<number> {
  return prisma.auditLog.count({ where: { action: 'collab_ops_gate_unfreeze', targetId: projectId } });
}

maybe('C2-3 解冻 ack 端点（POST /api/admin/collab/ops-gate/unfreeze）', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    await ensureProjectFixture(prisma, PID);
    await seedUser(ADMIN_ID, 'ADMIN', ADMIN_TOKEN);
    await seedUser(USER_ID, 'USER', USER_TOKEN);
    // vitest esbuild 无 emitDecoratorMetadata——类 provider 构造注入不解析（write-endpoint int spec
    // 同款惯例）：手动构造+useValue 直注。
    const sessionSvc = new SessionService(prisma as unknown as PrismaService);
    const moduleRef = await Test.createTestingModule({
      controllers: [CollabOpsUnfreezeController],
      providers: [
        { provide: PrismaService, useValue: prisma },   // write-endpoint int spec 同款：已连接实例直注（模块自建 PrismaService 连接面不在本 spec 举证域）
        { provide: SessionService, useValue: sessionSvc },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    // 生产装配面=app.module APP_GUARD 三件（Throttler/Auth/Admin——auth.guard.ts+admin.guard.ts
    // 原实例挂载；Throttler 非本 spec 面不挂）。AdminGuard 注册序在 AuthGuard 后=req.user 已挂载
    // （app.module.ts 注释同律）。
    app.useGlobalGuards(new AuthGuard(sessionSvc), new AdminGuard());
    await app.listen(0);
    const addr = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await app?.close();
    await cleanupProjectFixture(prisma, PID);
    await prisma.session.deleteMany({ where: { userId: { in: [ADMIN_ID, USER_ID] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ADMIN_ID, USER_ID] } } });
    // 全局哨兵行=('compact','')是建库常驻行（迁移笔二回填——c20「常驻性」断言钉 version=0 态、
    // c21/t27 两行校验依赖其在档）：**不删**，且本 spec 全局行用例 freeze+unfreeze 走过后 version
    // +2——afterAll 归位迁移回填原形态（state/version/frozenAt 全零——dev 库共享面不污染后续 spec）。
    await prisma.$executeRaw`
      UPDATE "CollabOpsGate" SET "state" = 'OPEN', "version" = 0, "frozenAt" = NULL, "frozenBy" = NULL, "unfrozenAt" = NULL, "reason" = NULL
      WHERE "gate" = ${OPS_GATE_COMPACT} AND "projectId" = ''`;
    await prisma.auditLog.deleteMany({ where: { action: 'collab_ops_gate_unfreeze' } });
    await prisma.$disconnect();
  });

  it('鉴权①：无 session cookie→401（AuthGuard——/api/admin 非 public 路径）', async () => {
    const r = await post({ projectId: PID });
    expect(r.status).toBe(401);
  });

  it('鉴权②：USER 角色→403（AdminGuard——ADMIN 角色门）', async () => {
    const r = await post({ projectId: PID }, `flowweb.session_token=${USER_TOKEN}`);
    expect(r.status).toBe(403);
  });

  it('主链：FROZEN→解冻 200+AuditLog 恰一条+version 十进制字符串+幂等二连零虚审计', async () => {
    const fro = await freezeOpsGateCompact(prisma, { projectId: PID, frozenBy: 'canary-verify', reason: 'c23-int 布景' });
    expect(fro.frozen).toBe(true);
    const before = await gateState(PID);
    expect(before?.state).toBe('FROZEN');
    const auditsBefore = await auditCount(PID);

    const r = await post({ projectId: PID, remark: 'c23-int：语义复核完毕，修复 B（假信号）归档' }, `flowweb.session_token=${ADMIN_TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ unfrozen: true, version: String((before?.version ?? 0n) + 1n) });

    const after = await gateState(PID);
    expect(after?.state).toBe('OPEN');
    expect(after?.unfrozenAt).not.toBeNull();
    expect(await auditCount(PID)).toBe(auditsBefore + 1);
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'collab_ops_gate_unfreeze', targetId: PID },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.operatorId).toBe(ADMIN_ID);
    expect(row.operatorName).toBe('c23-admin');
    expect(row.targetType).toBe('PROJECT');
    expect((row.beforeValue as { state?: string }).state).toBe('FROZEN');
    expect((row.afterValue as { state?: string }).state).toBe('OPEN');

    // 幂等：已 OPEN→{unfrozen:false}+审计行数不增
    const r2 = await post({ projectId: PID }, `flowweb.session_token=${ADMIN_TOKEN}`);
    expect(r2.status).toBe(200);
    expect(r2.json).toEqual({ unfrozen: false, version: null });
    expect(await auditCount(PID)).toBe(auditsBefore + 1);
  });

  it('全局哨兵行形态：projectId=\'\'（body 承载——path param 空段不可表达）同端点解冻+审计落痕', async () => {
    await prisma.$executeRaw`
      INSERT INTO "CollabOpsGate" ("gate", "projectId", "state") VALUES (${OPS_GATE_COMPACT}, '', 'OPEN')
      ON CONFLICT DO NOTHING`;
    const fro = await freezeOpsGateCompact(prisma, { projectId: '', frozenBy: 'manual-breakglass', reason: 'c23-int 全局行布景' });
    expect(fro.frozen).toBe(true);

    const r = await post({ projectId: '', remark: 'c23-int：全局行 break-glass 解冻 ack' }, `flowweb.session_token=${ADMIN_TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.json.unfrozen).toBe(true);
    expect(await gateState('')).toMatchObject({ state: 'OPEN' });
    expect(await auditCount('')).toBe(1);
  });

  it('参数面：DTO 契约直证（缺 projectId→class-validator 红；projectId=\'\'（全局行）+remark 过——'
    + 'HTTP 400 档依赖 @UsePipes metatype 解析〔design:paramtypes〕，vitest esbuild 不发不可复现，'
    + '生产 nest build（tsc）在位）', async () => {
    const { validateOrReject } = await import('class-validator');
    const { UnfreezeOpsGateDto } = await import('./dto/unfreeze-ops-gate.dto');
    const bad = new UnfreezeOpsGateDto();
    await expect(validateOrReject(bad)).rejects.toThrow();   // 缺 projectId
    const badType = new UnfreezeOpsGateDto();
    badType.projectId = 123 as unknown as string;
    await expect(validateOrReject(badType)).rejects.toThrow();   // 非字符串
    const ok = new UnfreezeOpsGateDto();
    ok.projectId = '';
    ok.remark = 'c23-int：全局哨兵行';
    await expect(validateOrReject(ok)).resolves.toBeUndefined();
  });
});
