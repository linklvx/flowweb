import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TopologyService } from './topology.service';
import { UpstreamMediaService } from './upstream-media.service';
import { normalizeIntentParams } from './normalize-intent-params';
import { MaterialService } from '../material-library/services/material.service';
import { MediaBatchService } from '../media/media-batch.service';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

// Y1a T8 真连用例（真 PG——vitest.int.config：DATABASE_URL 无则整文件 skip）。
// 四断言族：
//  ①红测 1（拓扑投影滞后）：上游 NodeArtifact 行已建+doc 尚无 fileId → collectUpstreamData
//    经 NodeArtifact reader 取到 mediaId（核心改造已落——本用例为真库链防回归）；
//  ②红测 2（URL 变即新键）：同一 Media 行、两次外呼解析（fake presign URL 不同）→ paramsHash 不变
//    （幂等键不变=重试不开新 intent 重复扣费——kill 后 query-first 不重复扣费的前提，T9 续建）；
//  ③红测 3（sourceUrl 过期降级）：sourceUrlExpiresAt 已过 → resolveCallUrl 走 presigned GET 降级
//    （未过期直传 provider 自家 URL）；
//  ④红测 4（sourceUrl 零泄漏）：material/media-batch 序列化出口零 sourceUrl
//    （material 改前红=serializeMediaRow spread 整行；media-batch T5 已白名单——防回归）。
const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();
const PID = 'int-um-08';
const UID = 'int-um-08-owner';

// fake MinIO（int 不连真对象存储——presign 产能注入；URL 递增模拟续签）
let presignSeq = 0;
const fakeMinio = {
  generatePresignedGetUrl: vi.fn(async (key: string, ttl: number) => {
    presignSeq += 1;
    return `https://minio.local:9000/flowai/${key}?sig=fake-${presignSeq}&ttl=${ttl}`;
  }),
};

const topology = new TopologyService();
const upstreamMedia = new UpstreamMediaService(prisma as unknown as PrismaService, fakeMinio as any);
const mediaBatch = new MediaBatchService(prisma as unknown as PrismaService);

let TID = '';
let MEDIA_ID = '';
const UPSTREAM_NODE = 'n-up';
const DOWNSTREAM_NODE = 'n-down';

(hasDb ? describe : describe.skip)('Y1a T8 上游媒体解析+paramsHash 稳定身份（真 PG）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: UID, email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'int-um-08-team', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });   // material 出口 assertTeamMember 门
    // 上游产物 Media 行：sourceUrl 未过期（+7d）——finalize 产物形态
    const media = await prisma.media.create({
      data: {
        userId: UID, teamId: TID,
        bucket: 'flowai', key: `results/${UID}/p1/${UPSTREAM_NODE}/2026-10-21/up.png`,
        originalName: 'up.png', mimeType: 'image/png', size: 1234n,
        type: 'generated', status: 'completed',
        sourceUrl: 'https://provider-oss.example.com/r1.png',
        sourceUrlExpiresAt: new Date(Date.now() + 7 * 86400_000),
      },
    });
    MEDIA_ID = media.id;
    // 上游 NodeArtifact 行（读侧契约夹具——T10 写侧未建：模拟 finalize 产物形态）
    await prisma.nodeArtifact.create({
      data: {
        projectId: PID, nodeId: UPSTREAM_NODE, teamId: TID,
        role: 'primary', targetField: 'result', targetItemId: '',
        mediaId: MEDIA_ID, state: 'stored',
      },
    });
  });

  afterAll(async () => {
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID } });
    await prisma.media.deleteMany({ where: { teamId: TID } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  });

  it('红测 1（拓扑投影滞后）：doc 尚无 fileId/resultUrl → NodeArtifact reader 取到 mediaId（doc 读源退役）', async () => {
    const nodes = [
      { id: UPSTREAM_NODE, type: 'imageGen', data: {} },   // doc 无产物键（投影滞后形态）
      { id: DOWNSTREAM_NODE, type: 'imageGen', data: {} },
    ];
    const edges = [{ source: UPSTREAM_NODE, target: DOWNSTREAM_NODE }];
    const upstream = await topology.collectUpstreamData(PID, DOWNSTREAM_NODE, nodes, edges, upstreamMedia.readUpstreamMediaId.bind(upstreamMedia));
    expect(upstream.imageMediaId).toBe(MEDIA_ID);
  });

  it('非终态槽位行（materializing）→ 不注入（finalize 未完成）', async () => {
    await prisma.nodeArtifact.update({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: UPSTREAM_NODE, role: 'primary', targetField: 'result', targetItemId: '' } },
      data: { state: 'materializing' },
    });
    await expect(upstreamMedia.readUpstreamMediaId(PID, UPSTREAM_NODE)).resolves.toBeNull();
    await prisma.nodeArtifact.update({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: UPSTREAM_NODE, role: 'primary', targetField: 'result', targetItemId: '' } },
      data: { state: 'stored' },
    });
  });

  it('红测 2（URL 变即新键根修）：同一 Media 外呼解析 URL 变（presign 续签）→ paramsHash 不变（幂等键稳定——重试不重复扣费）', async () => {
    const nodes = [
      { id: UPSTREAM_NODE, type: 'imageGen', data: {} },
      { id: DOWNSTREAM_NODE, type: 'imageGen', data: {} },
    ];
    const edges = [{ source: UPSTREAM_NODE, target: DOWNSTREAM_NODE }];
    const mkClaimInput = async () => {
      const upstream = await topology.collectUpstreamData(PID, DOWNSTREAM_NODE, nodes, edges, upstreamMedia.readUpstreamMediaId.bind(upstreamMedia));
      return { model: 'img-v2', prompt: 'p', resolution: '2048x2048', imageMediaId: upstream.imageMediaId };
    };
    const hashA = normalizeIntentParams('image', await mkClaimInput());
    // 降级形态（sourceUrl 过期）下两次外呼解析——fake presign 递增 ⇒ URL 必不同（判定前提自证）
    await prisma.media.update({
      where: { id: MEDIA_ID },
      data: { sourceUrlExpiresAt: new Date(Date.now() - 86400_000) },
    });
    const urlA = await upstreamMedia.resolveCallUrl(MEDIA_ID);
    const hashMid = normalizeIntentParams('image', await mkClaimInput());
    const urlB = await upstreamMedia.resolveCallUrl(MEDIA_ID);
    expect(urlB).not.toBe(urlA);          // 外呼 URL 确已变化
    expect(hashMid).toBe(hashA);          // 身份稳定 → 幂等键不变（重复扣费缺口已闭合）
    await prisma.media.update({   // 还原未过期（后续用例复用行）
      where: { id: MEDIA_ID },
      data: { sourceUrlExpiresAt: new Date(Date.now() + 7 * 86400_000) },
    });
  });

  it('sourceUrl 未过期 → 直传 provider 自家 URL（presign 零调用）', async () => {
    fakeMinio.generatePresignedGetUrl.mockClear();
    await expect(upstreamMedia.resolveCallUrl(MEDIA_ID)).resolves.toBe('https://provider-oss.example.com/r1.png');
    expect(fakeMinio.generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it('红测 3（sourceUrl 过期降级）：sourceUrlExpiresAt 已过 → presigned GET 降级（/flowai 公网形态仍可达 provider）', async () => {
    await prisma.media.update({
      where: { id: MEDIA_ID },
      data: { sourceUrlExpiresAt: new Date(Date.now() - 86400_000) },
    });
    const url = await upstreamMedia.resolveCallUrl(MEDIA_ID);
    expect(url).toMatch(/^https:\/\/minio\.local:9000\/flowai\//);
    expect(fakeMinio.generatePresignedGetUrl).toHaveBeenCalled();
    await prisma.media.update({   // 还原未过期（后续用例复用行）
      where: { id: MEDIA_ID },
      data: { sourceUrlExpiresAt: new Date(Date.now() + 7 * 86400_000) },
    });
  });

  it('红测 4（sourceUrl 零泄漏）：material 出口响应零 sourceUrl（改前红=serializeMediaRow spread 整行）；media-batch 出口同断言（防回归）', async () => {
    // MaterialService 直构（依赖三注入——int 真库行出口断言）
    const material = new MaterialService(prisma as unknown as PrismaService, fakeMinio as any, { add: vi.fn() } as any);
    const files = await material.getFilesByFolderId(UID, null, undefined, TID);
    const row = files.find((f: any) => f.id === MEDIA_ID);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('sourceUrl');          // provider 原始 URL 禁入任何响应面
    expect(JSON.stringify(files)).not.toContain('provider-oss.example.com');

    const batch = await mediaBatch.batchGet(UID, TID, [MEDIA_ID]);
    expect(batch).toHaveLength(1);
    expect(JSON.stringify(batch)).not.toContain('provider-oss.example.com');
    expect(batch[0]).not.toHaveProperty('sourceUrl');
  });
});
