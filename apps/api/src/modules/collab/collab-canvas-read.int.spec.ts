// apps/api/src/modules/collab/collab-canvas-read.int.spec.ts
// Y1c T25b 微批 C-1（双员同阻断）：用户面画布读端点真 HTTP 权限 int 例。★装置纪律=禁整模块
// mock 掩蔽——**真实链**：真 HTTP（undici fetch）+真 TransformInterceptor wire（{code:0,data}
// envelope 对拍——apiFetch 契约）+真 ProjectPermissionService（团队/成员行真 PG 查询——非
// EDITOR 403 档真实权限语义）；唯二替身=FakeAuthGuard（x-test-user 头播种 req.user——身份
// 提取面，media-content.int 先例同款）+CollabWritePort 哨兵（读芯归 readCanvas 既有覆盖——
// 本用例锁端点权限门+wire 形态）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TransformInterceptor } from '../../interceptors/transform.interceptor';
import { CollabCanvasReadController } from './collab-canvas-read.controller';
import { CollabWritePort } from './collab-write.port';
import { ProjectPermissionService } from '../team/project-permission.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureProjectFixture, cleanupProjectFixture, FIXTURE_TEAM } from '../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y1c-t25b-cvs';
const UID_EDITOR = 'u-t25b-cvs-editor';
const UID_OUTSIDER = 'u-t25b-cvs-out';

/** 身份播种替身（AuthGuard 的 req.user 播种——x-test-user 头即身份；权限判定面全真）。 */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const uid = req.headers['x-test-user'];
    if (typeof uid === 'string' && uid !== '') req.user = { id: uid };
    return true;
  }
}

let prisma: PrismaClient;
let app: INestApplication;
let baseUrl = '';

maybe('T25b 微批 C-1：GET /api/projects/:pid/collab/canvas（真 HTTP 权限+真 wire）', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    await ensureProjectFixture(prisma, PID, 'y1c-t25b-cvs');
    // EDITOR 真实成员行（FIXTURE_TEAM——ProjectPermissionService 团队角色回退链真查询）+外部用户（零成员行）
    for (const [uid, role] of [[UID_EDITOR, 'MEMBER'], [UID_OUTSIDER, 'MEMBER']] as const) {
      await prisma.user.upsert({ where: { id: uid }, update: {}, create: { id: uid, name: uid, email: `${uid}@local.test`, emailVerified: true } });
    }
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: FIXTURE_TEAM, userId: UID_EDITOR } },
      update: {},
      create: { teamId: FIXTURE_TEAM, userId: UID_EDITOR, role: 'MEMBER' },
    });
    // UID_OUTSIDER 故意不建成员行（团队外=resolve null → 403 真档）

    const moduleRef = await Test.createTestingModule({
      controllers: [CollabCanvasReadController],
      providers: [
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: PrismaService, useValue: prisma },
        ProjectPermissionService,
        // 读芯哨兵（sentinel 经 wire 断言零变换——readCanvas 本体归 collab-document 既有覆盖）
        { provide: CollabWritePort, useValue: { readCanvas: async () => ({ nodes: [{ id: 's-sentinel' }], edges: [] }) } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));   // 真 wire：main.ts 同款全局拦截器
    await app.listen(0);
    const addr = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    await prisma?.teamMember.deleteMany({ where: { userId: { in: [UID_EDITOR, UID_OUTSIDER] } } }).catch(() => undefined);
    await prisma?.user.deleteMany({ where: { id: { in: [UID_EDITOR, UID_OUTSIDER] } } }).catch(() => undefined);
    await cleanupProjectFixture(prisma, PID);
    await prisma?.$disconnect();
  }, 30_000);

  it('★c1-int-1 团队成员（EDITOR 档）→200+真 wire {code:0,data:{nodes,edges}}（apiFetch 解包契约——@NoTransform 裸形态对拍负控面）', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PID}/collab/canvas`, { headers: { 'x-test-user': UID_EDITOR } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: number; data: { nodes: Array<{ id: string }>; edges: unknown[] }; message: string };
    expect(body.code).toBe(0);                                       // envelope 形态（修前旧路径=@NoTransform 裸 {nodes,edges}——契约击穿面）
    expect(body.data.nodes.map((n) => n.id)).toEqual(['s-sentinel']);   // 哨兵零变换直通
    expect(Array.isArray(body.data.edges)).toBe(true);
  });

  it('★c1-int-2 团队外用户→403（真 ProjectPermissionService 团队回退链——非 EDITOR 恒拒生产语义；worker token 通道不再被借用）', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PID}/collab/canvas`, { headers: { 'x-test-user': UID_OUTSIDER } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain('编辑');
  });

  it('★c1-int-3 未播种身份（无 x-test-user）→assertEditor 空用户 403（不落 readCanvas——fail-closed）', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PID}/collab/canvas`);
    expect(res.status).toBe(403);
  });
});
