// apps/api/src/modules/collab/collab-binding.int.spec.ts
// Y1c T25b 四读径③：BindMedia/CloneBinding typed 命令真库用例（真 PG——命令端点真库面+跨团队
// ACL 档）。装置=纯 PG 面（无 gateway：命令是 PG 权威写——CAS/binding upsert/projection pending
// 与 replaceMedia 同链，doc 交付归投影 poller 异步链不在本用例断言面）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { CollabBindingController } from './collab-binding.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';
import { ensureProjectFixture, cleanupProjectFixture } from '../../test-utils/db-fixtures';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;
const PID = 'y1c-t25b-bind';
const TEAM = 'y1c-t25b-team';
const TEAM_OTHER = 'y1c-t25b-team-x';
const UID = 'u-t25b-owner';

let prisma: PrismaClient;
let app: INestApplication;
let baseUrl = '';
let controller: CollabBindingController;

const req = () => ({ user: { id: UID } }) as any;

async function seedMedia(id: string, teamId: string) {
  await prisma.media.upsert({
    where: { id },
    update: { teamId, deletedAt: null },
    create: { id, userId: UID, bucket: 'flowai', key: `t25b/${id}.bin`, originalName: `${id}.bin`, mimeType: 'image/png', size: 100n, teamId, status: 'completed', type: 'uploaded' },
  });
}

maybe('T25b 四读径③ BindMedia/CloneBinding（真 PG——命令端点+跨团队 ACL）', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    await ensureProjectFixture(prisma, PID, 'y1c-t25b-bind');
    // 独立团队常量（ensureProjectFixture 建默认团队——本用例团队维显式两档：本项目挂 TEAM，他队 TEAM_OTHER）
    await prisma.user.upsert({ where: { id: UID }, update: {}, create: { id: UID, name: 't25b', email: 't25b-x@local.test', emailVerified: true } });
    await prisma.team.upsert({
      where: { id: TEAM },
      update: {},
      create: { id: TEAM, name: 't25b', ownerId: UID },
    });
    await prisma.team.upsert({
      where: { id: TEAM_OTHER },
      update: {},
      create: { id: TEAM_OTHER, name: 't25b-x', ownerId: UID },
    });
    await prisma.canvasProject.updateMany({ where: { id: PID }, data: { teamId: TEAM } });
    // 跨 run 残留 wipe（MediaBinding/NodeArtifact/ArtifactProjection/media）
    await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });
    await prisma.artifactProjection.deleteMany({ where: { projectId: PID } });
    await prisma.nodeArtifact.deleteMany({ where: { projectId: PID } });
    await prisma.media.deleteMany({ where: { id: { in: ['m-t25b-own', 'm-t25b-x', 'm-t25b-gone'] } } });
    await seedMedia('m-t25b-own', TEAM);
    await seedMedia('m-t25b-x', TEAM_OTHER);
    await seedMedia('m-t25b-gone', TEAM);
    await prisma.media.update({ where: { id: 'm-t25b-gone' }, data: { deletedAt: new Date() } });   // 软删档
    // 源节点 n-src 既有绑定（BindMedia 归属校验面+CloneBinding 源行）
    await prisma.mediaBinding.create({
      data: { mediaId: 'm-t25b-own', projectId: PID, nodeId: 'n-src', teamId: TEAM, role: 'primary', targetField: 'fileId', targetItemId: '' },
    });
    await prisma.mediaBinding.create({
      data: { mediaId: 'm-t25b-gone', projectId: PID, nodeId: 'n-src', teamId: TEAM, role: 'primary', targetField: 'images', targetItemId: 'cell-1' },
    });

    const nodeArtifacts = new NodeArtifactService();
    const registration = new MediaRegistrationService(prisma as unknown as PrismaService, {} as any, null);
    const perm = {
      assertEditorWithTeam: vi.fn(async () => ({ role: 'PROJECT_EDITOR' as const, teamId: TEAM })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [CollabBindingController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectPermissionService, useValue: perm },
        { provide: NodeArtifactService, useValue: nodeArtifacts },
        { provide: MediaRegistrationService, useValue: registration },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    const addr = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    controller = moduleRef.get(CollabBindingController);
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    await prisma?.mediaBinding.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma?.artifactProjection.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma?.nodeArtifact.deleteMany({ where: { projectId: PID } }).catch(() => undefined);
    await prisma?.media.deleteMany({ where: { id: { in: ['m-t25b-own', 'm-t25b-x', 'm-t25b-gone'] } } }).catch(() => undefined);
    await cleanupProjectFixture(prisma, PID);
    await prisma?.team.deleteMany({ where: { id: { in: [TEAM, TEAM_OTHER] } } }).catch(() => undefined);
    await prisma?.$disconnect();
  }, 30_000);

  it('BindMedia：源 media 绑到目标槽位（真 CAS rev 0→1+投影 pending+MediaBinding 行落地）', async () => {
    const out = await controller.command(PID, { type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm-t25b-own', targetNodeId: 'n-tgt', expectedRev: 0 }, req());
    expect(out).toEqual({ type: 'BindMedia', rev: 1, mediaId: 'm-t25b-own' });
    const artifact = await prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: 'n-tgt', role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(artifact?.rev).toBe(1);
    expect(artifact?.mediaId).toBe('m-t25b-own');
    expect(artifact?.state).toBe('stored');
    const projection = await prisma.artifactProjection.findFirst({ where: { artifactId: artifact!.id, artifactRev: 1 } });
    expect(projection?.state).toBe('pending');
    const binding = await prisma.mediaBinding.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: 'n-tgt', role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(binding?.mediaId).toBe('m-t25b-own');
  });

  it('★BindMedia 跨团队 ACL 档（真库）：源 media 团队≠目标项目团队→403+零写（NodeArtifact/binding 均无行）', async () => {
    await expect(controller.command(PID, { type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm-t25b-x', targetNodeId: 'n-x', expectedRev: 0 }, req()))
      .rejects.toMatchObject({ status: 403 });
    const artifact = await prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: 'n-x', role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(artifact).toBeNull();   // fail-closed：ACL 拒档零 NodeArtifact 行
    const binding = await prisma.mediaBinding.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: 'n-x', role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(binding).toBeNull();
  });

  it('BindMedia 真库 CAS：expectedRev 过时（rev 已 1 再以 0 提交）→409 ARTIFACT_REV_CONFLICT 零换代', async () => {
    await expect(controller.command(PID, { type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm-t25b-own', targetNodeId: 'n-tgt', expectedRev: 0 }, req()))
      .rejects.toMatchObject({ status: 409, errorCode: 'ARTIFACT_REV_CONFLICT' });
    const artifact = await prisma.nodeArtifact.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: 'n-tgt', role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(artifact?.rev).toBe(1);   // 旧 rev 保持（禁静默覆盖）
  });

  it('CloneBinding：绑定格位克隆（fileId 槽+images cell 槽位随行；软删槽跳过计数）+NodeArtifact 零写', async () => {
    const artifactsBefore = await prisma.nodeArtifact.count({ where: { projectId: PID, nodeId: 'n-clone' } });
    const out = await controller.command(PID, { type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-clone' }, req());
    expect(out).toEqual({ type: 'CloneBinding', cloned: 1, skippedDeleted: 1 });   // m-t25b-own 克隆+m-t25b-gone 软删跳过
    const b1 = await prisma.mediaBinding.findUnique({
      where: { projectId_nodeId_role_targetField_targetItemId: { projectId: PID, nodeId: 'n-clone', role: 'primary', targetField: 'fileId', targetItemId: '' } },
    });
    expect(b1?.mediaId).toBe('m-t25b-own');   // 绑定格位保留（slot 结构随行）
    const artifactsAfter = await prisma.nodeArtifact.count({ where: { projectId: PID, nodeId: 'n-clone' } });
    expect(artifactsAfter).toBe(artifactsBefore);   // ★产物引用清空（NodeArtifact 不挂旧产物）
  });

  it('真 HTTP 面：POST /api/projects/:pid/collab/bindings 路由可达（403 档经 wire 形态透出）', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PID}/collab/bindings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm-t25b-x', targetNodeId: 'n-wire', expectedRev: 0 }),
    });
    expect(res.status).toBe(403);   // 跨团队档 wire 透出（ACL 真库负控经 HTTP 面）
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain('跨团队');
  });
});
