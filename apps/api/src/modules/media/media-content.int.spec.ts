// apps/api/src/modules/media/media-content.int.spec.ts —— Y1a+Y1b T5 红测（int：真 PG+真 S3+真 HTTP）
// 出口判据「CI 真 S3」的本体：content ready 态真上传/下载对象（CI=rustfs/本地=MinIO——S3 兼容语义双实现容）；
// 读 ACL 团队级单门四例（同 team 跨项目 200——v10.1「跨项目 403」在团队回退语义下永不可绿的钉）/跨 team 403/
// 公开页已发布 workId 200/被移出团队 403；删读侧 presign 旁路（/url 404+batch 响应零 presign）。
// processing 态映射归 media-content.controller.spec（unit）；无 DATABASE_URL/MINIO_ENDPOINT 自动 skip。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { MediaService } from './media.service';
import { MediaBatchService } from './media-batch.service';
import { MediaController } from './media.controller';
import { MediaContentController } from './media-content.controller';
import { SafeRemoteFetchService } from './safe-remote-fetch.service';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;
const hasS3 = !!process.env.MINIO_ENDPOINT;
const maybe = hasDb && hasS3 ? describe : describe.skip;

const prisma = new PrismaClient();

/** 测试鉴权桩：x-test-user 头即身份（AuthGuard 的 req.user 播种替身——单门测的是 service 层真实查询） */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const uid = req.headers['x-test-user'];
    if (uid) req.user = { id: String(uid) };
    return true;
  }
}

const OWNER = `it-t5-owner-${Date.now()}`;
const MEMBER = `it-t5-member-${Date.now()}`;
const STRANGER = `it-t5-stranger-${Date.now()}`;
let TEAM_A = '';
let TEAM_B = '';
let PROJ_A = '';
let PROJ_B = '';
let mediaId = '';
let objectKey = '';
let app: INestApplication;
let baseUrl = '';
let minio: MinioService;
const BYTES = Buffer.from('hello world');   // 11 字节——Range 切片可肉眼断言

async function get(path: string, uid: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers: { 'x-test-user': uid, ...headers } } as never);
}

maybe('Y1a+Y1b T5：content 读 ACL 团队级单门+删旁路+ready 态真 S3（真 PG+真 S3）', () => {
  beforeAll(async () => {
    // —— PG 夹具：team A（owner+member+跨项目显式 VIEWER 行）、team B（stranger 域）、已发布作品锚 ——
    for (const uid of [OWNER, MEMBER, STRANGER]) {
      await prisma.user.upsert({
        where: { id: uid },
        create: { id: uid, name: `it-t5-${uid.slice(-6)}`, email: `${uid}@test.local`, emailVerified: false },
        update: {},
      });
    }
    const teamA = await prisma.team.create({ data: { name: 'it-t5-a', ownerId: OWNER } });
    TEAM_A = teamA.id;
    await prisma.teamMember.create({ data: { teamId: TEAM_A, userId: OWNER, role: 'OWNER' } });
    await prisma.teamMember.create({ data: { teamId: TEAM_A, userId: MEMBER, role: 'MEMBER' } });
    const teamB = await prisma.team.create({ data: { name: 'it-t5-b', ownerId: STRANGER } });
    TEAM_B = teamB.id;
    await prisma.teamMember.create({ data: { teamId: TEAM_B, userId: STRANGER, role: 'OWNER' } });
    PROJ_A = (await prisma.canvasProject.create({ data: { name: 'it-t5-pa', userId: OWNER, teamId: TEAM_A } })).id;
    PROJ_B = (await prisma.canvasProject.create({ data: { name: 'it-t5-pb', userId: OWNER, teamId: TEAM_A } })).id;
    // 跨项目显式行：MEMBER 仅在 PROJ_B 有 VIEWER 行（v10.1 按项目门会 403 的场景样本）
    await prisma.projectMember.create({ data: { projectId: PROJ_B, userId: MEMBER, role: 'PROJECT_VIEWER' } });

    // —— 真 S3：建桶（幂等）+真上传对象+Media 行（status=completed）——
    const useSsl = (process.env.MINIO_USE_SSL ?? '').toLowerCase() === 'true';
    minio = new MinioService({
      endpoint: process.env.MINIO_ENDPOINT!,
      accessKey: process.env.MINIO_ACCESS_KEY!,
      secretKey: process.env.MINIO_SECRET_KEY!,
      bucket: process.env.MINIO_BUCKET || 'flowai',
      useSsl,
    });
    await minio.ensureBucket();
    objectKey = `uploads/${OWNER}/it-t5/${Date.now()}/a.txt`;
    await minio.upload(objectKey, BYTES, 'text/plain');
    const media = await prisma.media.create({
      data: {
        userId: OWNER, teamId: TEAM_A, key: objectKey, originalName: 'a.txt',
        mimeType: 'text/plain', size: BigInt(BYTES.length), projectId: PROJ_A,
        type: 'uploaded', status: 'completed', sniffedMimeType: 'text/plain',
      },
    });
    mediaId = media.id;

    // —— HTTP 面：真 controller（单门/assertMediaReadable/两态路由经真实 service+真 S3）——
    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController, MediaContentController],
      providers: [
        MediaService,
        MediaBatchService,
        SafeRemoteFetchService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  }, 60_000);

  afterAll(async () => {
    try { if (objectKey) await minio.delete(objectKey); } catch { /* 清理尽力 */ }
    await prisma.videoWork.deleteMany({ where: { videoMediaId: mediaId } });
    await prisma.media.deleteMany({ where: { id: mediaId } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: [PROJ_A, PROJ_B] } } });
    await prisma.canvasProject.deleteMany({ where: { id: { in: [PROJ_A, PROJ_B] } } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TEAM_A, TEAM_B]);
    await prisma.user.deleteMany({ where: { id: { in: [OWNER, MEMBER, STRANGER] } } });
    await app?.close();
    await prisma.$disconnect();
  }, 60_000);

  it('单门①同 team 跨项目 200：MEMBER 仅在 PROJ_B 有显式 VIEWER 行，读 PROJ_A 的 media → 200 真字节（团队回退单门——v10.1「跨项目 403」永不可绿的钉）', async () => {
    const res = await get(`/api/media/${mediaId}/content`, MEMBER);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('hello world');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('单门②跨 team 403：STRANGER（team B owner）读 team A media → 403', async () => {
    const res = await get(`/api/media/${mediaId}/content`, STRANGER);
    expect(res.status).toBe(403);
  });

  it('单门③公开页按已发布 workId 200：STRANGER 非成员，但 media 被已发布作品引用 → 200（作品引用兜底——平台作品对全员可读）', async () => {
    const w = await prisma.videoWork.create({
      data: { title: 'it-t5', authorName: 'it', videoKey: objectKey, videoMediaId: mediaId, status: 'PUBLISHED', publishedAt: new Date() },
    });
    try {
      const res = await get(`/api/media/${mediaId}/content`, STRANGER);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('hello world');
    } finally {
      await prisma.videoWork.delete({ where: { id: w.id } });
    }
  });

  it('单门④被移出团队后 403：删 teamMember 行（removeMember 终态）→ 403', async () => {
    await prisma.teamMember.delete({ where: { teamId_userId: { teamId: TEAM_A, userId: MEMBER } } });
    try {
      const res = await get(`/api/media/${mediaId}/content`, MEMBER);
      expect(res.status).toBe(403);
    } finally {
      await prisma.teamMember.create({ data: { teamId: TEAM_A, userId: MEMBER, role: 'MEMBER' } });
    }
  });

  it('删读侧 presign 旁路①：GET /api/media/:id/url → 404（端点删除——现状 200 绕过 MIME/单门）', async () => {
    const res = await get(`/api/media/${mediaId}/url`, OWNER);
    expect(res.status).toBe(404);
  });

  it('删读侧 presign 旁路②：POST /api/media/batch 响应降级 content 路由——url 字段=/api/media/:id/content 形态，零 X-Amz 签名', async () => {
    const res = await fetch(`${baseUrl}/api/media/batch?teamId=${TEAM_A}`, {
      method: 'POST',
      headers: { 'x-test-user': OWNER, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [mediaId] }),
    });
    expect(res.status).toBe(201);   // Nest @Post 默认 201（既有行为维持——非本卡改造面）
    const rows = (await res.json()) as Array<{ url: string; thumbnailUrl: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe(`/api/media/${mediaId}/content`);
    expect(rows[0].url).not.toMatch(/X-Amz/);
    expect(JSON.stringify(rows)).not.toMatch(/X-Amz|Signature/);   // 整响应零 presign 签名面
  });

  it('ready 真 S3 全链：HEAD Content-Length=11；Range bytes=6-10 → 206 "world"+Content-Range；Range 越界 → 416；If-None-Match 命中 → 304（视频可拖动的顺序读契约）', async () => {
    const headRes = await fetch(`${baseUrl}/api/media/${mediaId}/content`, { method: 'HEAD', headers: { 'x-test-user': OWNER } });
    expect(headRes.status).toBe(200);
    expect(Number(headRes.headers.get('content-length'))).toBe(11);
    expect(headRes.headers.get('accept-ranges')).toBe('bytes');

    const range = await get(`/api/media/${mediaId}/content`, OWNER, { range: 'bytes=6-10' });
    expect(range.status).toBe(206);
    expect(Buffer.from(await range.arrayBuffer()).toString()).toBe('world');
    expect(range.headers.get('content-range')).toBe('bytes 6-10/11');

    const invalid = await get(`/api/media/${mediaId}/content`, OWNER, { range: 'bytes=999-' });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe('bytes */11');

    const etag = headRes.headers.get('etag')!;
    expect(etag).toBeTruthy();
    const notMod = await get(`/api/media/${mediaId}/content`, OWNER, { 'if-none-match': etag });
    expect(notMod.status).toBe(304);
  });
});
