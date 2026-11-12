// apps/api/src/modules/collab/collab-binding.controller.spec.ts
// C3a-7（plan v3 Task C3a-7——spec 2026-11-11-foundation-batch-design.md §3.2-4 单写者+命令面两改）：
// BindMedia=校验+NodeArtifact/Projection 写（**零 MediaBinding 读写**——绑定经投影出现，客户端 doc 帧
// 自足）；CloneBinding 命令已删（第五轮 P1：web 生产零调用——type 非法 400）。
//   - 源配对=pairArtifact 唯一腿（NodeArtifact 行）+doc 源节点兜底（窄端口 MediaRefsReadPort——
//     分档映射写死：源节点不存在→400 SOURCE_NODE_MISSING；源 media 不在源节点→400 SOURCE_MEDIA_MISMATCH；
//     跨队→403；doc 不可读/lease 失守→503 SOURCE_DOC_UNREADABLE）；
//   - T25b 语义锚承前（expectedRev CAS F2 同门/跨团队 media ACL spec §5）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { CollabBindingController } from './collab-binding.controller';
import { MEDIA_REFS_READ_PORT, type MediaRefsReadPort } from './media-refs-read.port';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import type { MediaRef } from '@flowweb/shared';

const prisma: any = {};
const perm = { assertEditorWithTeam: vi.fn() };
const nodeArtifacts = { casUpsert: vi.fn() };
const port: MediaRefsReadPort = { readNodeRefs: vi.fn() };

function txOf<T>(impl: T): { $transaction: (fn: (tx: T) => Promise<unknown>) => Promise<unknown> } {
  return { $transaction: (fn: (tx: T) => Promise<unknown>) => fn(impl) };
}
const tx = {
  artifactProjection: { updateMany: vi.fn(), createMany: vi.fn() },
  mediaBinding: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },   // 零读写断言面（任意操作被调=红）
};
prisma.$transaction = (fn: (t: typeof tx) => Promise<unknown>) => fn(tx);

const req = () => ({ user: { id: 'u1' } }) as any;
const BIND_BODY = { type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm1', targetNodeId: 'n-tgt', expectedRev: 0 };
const ref = (mediaId: string): MediaRef => ({ nodeId: 'n-src', mediaId, role: 'primary', targetField: 'fileId', targetItemId: '' });

async function make() {
  const moduleRef = await Test.createTestingModule({
    controllers: [CollabBindingController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: ProjectPermissionService, useValue: perm },
      { provide: NodeArtifactService, useValue: nodeArtifacts },
      { provide: MEDIA_REFS_READ_PORT, useValue: port },
    ],
  }).compile();
  return moduleRef.get(CollabBindingController);
}

beforeEach(() => {
  vi.clearAllMocks();
  perm.assertEditorWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' });
  prisma.media = { findFirst: vi.fn().mockResolvedValue({ teamId: 't1' }) };
  prisma.nodeArtifact = { findFirst: vi.fn() };
  nodeArtifacts.casUpsert.mockResolvedValue({ won: true, rev: 1, artifactId: 'a1' });
});

describe('C3a-7：BindMedia——校验+NodeArtifact/Projection 写（零 MediaBinding 读写）', () => {
  it('pairArtifact 腿命中：CAS+投影 pending 落地+零 binding 面（端口不被调+tx.mediaBinding 零操作）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });   // 源配对唯一腿（NodeArtifact 面）
    const out = await c.command('p1', BIND_BODY, req());
    expect(out).toEqual({ type: 'BindMedia', rev: 1, mediaId: 'm1' });
    expect(nodeArtifacts.casUpsert).toHaveBeenCalledWith(tx, expect.objectContaining({
      projectId: 'p1', nodeId: 'n-tgt', teamId: 't1', targetField: 'fileId', expectedRev: 0, mediaId: 'm1',
    }));
    expect(tx.artifactProjection.createMany).toHaveBeenCalled();   // 投影 pending（feed 经 poller deliverArtifact 链）
    expect(port.readNodeRefs).not.toHaveBeenCalled();   // pairArtifact 命中=doc 兜底不触发
    for (const op of Object.values(tx.mediaBinding)) expect(op).not.toHaveBeenCalled();   // ★零 binding 读写
  });

  it('doc 兜底腿：pairArtifact 缺→端口读源节点 refs 命中 mediaId→放行（活 doc 读=命令面即时校验）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue(null);
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue([ref('m1'), ref('m2')]);
    const out = await c.command('p1', BIND_BODY, req());
    expect(out).toEqual({ type: 'BindMedia', rev: 1, mediaId: 'm1' });
    expect(port.readNodeRefs).toHaveBeenCalledWith('p1', 'n-src');
  });

  it('★分档①：源节点不在 doc（端口 null）→400 SOURCE_NODE_MISSING', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue(null);
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(c.command('p1', BIND_BODY, req())).rejects.toMatchObject({ errorCode: 'SOURCE_NODE_MISSING', status: 400 });
    expect(nodeArtifacts.casUpsert).not.toHaveBeenCalled();
  });

  it('★分档②：源 media 不在源节点 refs→400 SOURCE_MEDIA_MISMATCH（任意 mediaId 冒配源 nodeId 拒）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue(null);
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue([ref('m-other')]);
    await expect(c.command('p1', BIND_BODY, req())).rejects.toMatchObject({ errorCode: 'SOURCE_MEDIA_MISMATCH', status: 400 });
    expect(nodeArtifacts.casUpsert).not.toHaveBeenCalled();
  });

  it('★分档③：跨团队 media ACL——源 media 团队≠目标项目团队→403 拒（spec §5 媒体权限）', async () => {
    const c = await make();
    prisma.media.findFirst.mockResolvedValue({ teamId: 't-other' });
    await expect(c.command('p1', BIND_BODY, req())).rejects.toThrow(ForbiddenException);
    expect(nodeArtifacts.casUpsert).not.toHaveBeenCalled();
  });

  it('★分档④：doc 不可读/lease 失守（端口 ServiceUnavailableException）→503 SOURCE_DOC_UNREADABLE', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue(null);
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockRejectedValue(new ServiceUnavailableException('collab not serving (lease not held)'));
    await expect(c.command('p1', BIND_BODY, req())).rejects.toMatchObject({ errorCode: 'SOURCE_DOC_UNREADABLE', status: HttpStatus.SERVICE_UNAVAILABLE });
    expect(nodeArtifacts.casUpsert).not.toHaveBeenCalled();
  });

  it('media 不存在/软删→404', async () => {
    const c = await make();
    prisma.media.findFirst.mockResolvedValue(null);
    await expect(c.command('p1', BIND_BODY, req())).rejects.toThrow(NotFoundException);
  });

  it('CAS 0 行=superseded→409 ARTIFACT_REV_CONFLICT（F2 同门——禁静默覆盖并发生成）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });
    nodeArtifacts.casUpsert.mockResolvedValue({ won: false, rev: 3 });
    await expect(c.command('p1', BIND_BODY, req())).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('坏 body（type 异/字段缺/expectedRev 非法）→400；★CloneBinding 已删（type=CloneBinding→400 BINDING_COMMAND_BAD_BODY）', async () => {
    const c = await make();
    for (const bad of [
      {}, { type: 'Nope' },
      { type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-tgt' },   // ★命令删除锚（C3a-7）
      { ...BIND_BODY, mediaId: '' },
      { ...BIND_BODY, expectedRev: -1 },
      { ...BIND_BODY, expectedRev: 1.5 },
    ]) {
      await expect(c.command('p1', bad, req())).rejects.toMatchObject({ errorCode: 'BINDING_COMMAND_BAD_BODY', status: 400 });
    }
  });

  it('编辑权门：assertEditorWithTeam（VIEWER→403）', async () => {
    const c = await make();
    perm.assertEditorWithTeam.mockRejectedValue(new ForbiddenException());
    await expect(c.command('p1', BIND_BODY, req())).rejects.toThrow(ForbiddenException);
  });
});
