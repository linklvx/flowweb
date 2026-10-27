// apps/api/src/modules/collab/collab-binding.controller.spec.ts
// Y1c T25b 四读径③（plan :337 登记——T22 残留面承接）：复制/粘贴 typed BindMedia/CloneBinding
// 命令端点。★红形态=「shared 契约在位零 api/web 实现」（runtime-projection.ts:221-245 契约零消费）
// ——端点不存在（import 红）→实装后绿。语义锚（T5c/T22 卡原文+COPY_PASTE_COMMAND_CONTRACT）：
//   - BindMedia=源 nodeId/mediaId 作命令参数（服务端校验权限/归属后写 PG binding+发 feed 经投影
//     poller 交付链——与 replaceMedia 同 PG 权威面）；expectedRev CAS（F2 同门）；
//   - CloneBinding=绑定格位克隆（MediaBinding 行 role/targetField/targetItemId 槽位随行），
//     NodeArtifact 不写（产物引用清空——lifecycle：复制≠产物继承）；
//   - 跨团队 media ACL：源 media 团队≠目标项目团队→403 拒（collab-media replace 先例同口径）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, HttpStatus } from '@nestjs/common';
import { CollabBindingController } from './collab-binding.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { NodeArtifactService } from '../artifact-core/node-artifact.service';
import { MediaRegistrationService } from '../artifact-core/media-registration.service';

const prisma: any = {};
const perm = { assertEditorWithTeam: vi.fn() };
const nodeArtifacts = { casUpsert: vi.fn() };
const registration = { bindInTx: vi.fn() };

function txOf<T>(impl: T): { $transaction: (fn: (tx: T) => Promise<unknown>) => Promise<unknown> } {
  return { $transaction: (fn: (tx: T) => Promise<unknown>) => fn(impl) };
}
const tx = {
  artifactProjection: { updateMany: vi.fn(), createMany: vi.fn() },
  mediaBinding: { findFirst: vi.fn(), findMany: vi.fn() },
  nodeArtifact: { findFirst: vi.fn() },
  media: { findFirst: vi.fn(), findMany: vi.fn() },
};
prisma.$transaction = (fn: (t: typeof tx) => Promise<unknown>) => fn(tx);

const req = () => ({ user: { id: 'u1' } }) as any;
const BIND_BODY = { type: 'BindMedia', sourceNodeId: 'n-src', mediaId: 'm1', targetNodeId: 'n-tgt', expectedRev: 0 };

async function make() {
  const moduleRef = await Test.createTestingModule({
    controllers: [CollabBindingController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: ProjectPermissionService, useValue: perm },
      { provide: NodeArtifactService, useValue: nodeArtifacts },
      { provide: MediaRegistrationService, useValue: registration },
    ],
  }).compile();
  return moduleRef.get(CollabBindingController);
}

beforeEach(() => {
  vi.clearAllMocks();
  perm.assertEditorWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' });
  prisma.media = { findFirst: vi.fn(), findMany: vi.fn() };
  prisma.mediaBinding = { findFirst: vi.fn(), findMany: vi.fn() };
  prisma.nodeArtifact = { findFirst: vi.fn() };
});

describe('T25b 四读径③：BindMedia typed 命令', () => {
  it('源 media 绑到目标槽位（CAS+投影 pending+binding upsert——replace 同 PG 权威面）+归属校验（源节点配对）', async () => {
    const c = await make();
    prisma.media.findFirst.mockResolvedValue({ teamId: 't1' });
    tx.mediaBinding.findFirst.mockResolvedValue({ id: 'b1' });   // 源配对（MediaBinding 面）
    nodeArtifacts.casUpsert.mockResolvedValue({ won: true, rev: 1, artifactId: 'a1' });
    const out = await c.command('p1', BIND_BODY, req());
    expect(out).toEqual({ type: 'BindMedia', rev: 1, mediaId: 'm1' });
    expect(nodeArtifacts.casUpsert).toHaveBeenCalledWith(tx, expect.objectContaining({
      projectId: 'p1', nodeId: 'n-tgt', teamId: 't1', targetField: 'fileId', expectedRev: 0, mediaId: 'm1',
    }));
    expect(tx.artifactProjection.createMany).toHaveBeenCalled();   // 投影 pending（feed 经 poller deliverArtifact 链）
    expect(registration.bindInTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      mediaId: 'm1', projectId: 'p1', nodeId: 'n-tgt', teamId: 't1',
    }));
  });

  it('★跨团队 media ACL：源 media 团队≠目标项目团队→403 拒（spec §5 媒体权限——源团队私有媒体不随粘贴外泄）', async () => {
    const c = await make();
    prisma.media.findFirst.mockResolvedValue({ teamId: 't-other' });   // 他队 media
    await expect(c.command('p1', BIND_BODY, req())).rejects.toThrow(ForbiddenException);
    expect(nodeArtifacts.casUpsert).not.toHaveBeenCalled();
  });

  it('media 不存在/软删→404；源配对缺失（任意 mediaId 冒配源 nodeId）→400 SOURCE_MEDIA_MISMATCH', async () => {
    const c = await make();
    prisma.media.findFirst.mockResolvedValue(null);
    await expect(c.command('p1', BIND_BODY, req())).rejects.toThrow(NotFoundException);
    prisma.media.findFirst.mockResolvedValue({ teamId: 't1' });
    tx.mediaBinding.findFirst.mockResolvedValue(null);
    tx.nodeArtifact.findFirst.mockResolvedValue(null);   // MediaBinding+NodeArtifact 两面均无配对
    await expect(c.command('p1', BIND_BODY, req())).rejects.toMatchObject({ errorCode: 'SOURCE_MEDIA_MISMATCH', status: 400 });
  });

  it('CAS 0 行=superseded→409 ARTIFACT_REV_CONFLICT（F2 同门——禁静默覆盖并发生成）', async () => {
    const c = await make();
    prisma.media.findFirst.mockResolvedValue({ teamId: 't1' });
    tx.mediaBinding.findFirst.mockResolvedValue({ id: 'b1' });
    nodeArtifacts.casUpsert.mockResolvedValue({ won: false, rev: 3 });
    await expect(c.command('p1', BIND_BODY, req())).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('坏 body（type 异/字段缺/expectedRev 非法）→400', async () => {
    const c = await make();
    for (const bad of [
      {}, { type: 'Nope' },
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

describe('T25b 四读径③：CloneBinding typed 命令（绑定格位保留+产物引用清空）', () => {
  it('源 MediaBinding 行逐槽克隆到目标（role/targetField/targetItemId 格位保留）+NodeArtifact 零写（复制≠产物继承）', async () => {
    const c = await make();
    tx.mediaBinding.findMany.mockResolvedValue([
      { mediaId: 'm1', role: 'primary', targetField: 'fileId', targetItemId: '' },
      { mediaId: 'm2', role: 'primary', targetField: 'images', targetItemId: 'cell-2' },
    ]);
    prisma.media.findMany.mockResolvedValue([{ id: 'm1', teamId: 't1' }, { id: 'm2', teamId: 't1' }]);
    const out = await c.command('p1', { type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-tgt' }, req());
    expect(out).toEqual({ type: 'CloneBinding', cloned: 2, skippedDeleted: 0 });
    expect(registration.bindInTx).toHaveBeenCalledTimes(2);
    expect(registration.bindInTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      mediaId: 'm2', projectId: 'p1', nodeId: 'n-tgt', teamId: 't1', role: 'primary', targetField: 'images', targetItemId: 'cell-2',
    }));
    expect(nodeArtifacts.casUpsert).not.toHaveBeenCalled();   // ★产物引用清空（NodeArtifact 不挂旧产物）
  });

  it('★跨团队任一绑定 media→整命令 403 拒（fail-closed 原子——部分克隆=静默丢绑定面）', async () => {
    const c = await make();
    tx.mediaBinding.findMany.mockResolvedValue([{ mediaId: 'm1', role: 'primary', targetField: 'fileId', targetItemId: '' }]);
    prisma.media.findMany.mockResolvedValue([{ id: 'm1', teamId: 't-other' }]);
    await expect(c.command('p1', { type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-tgt' }, req())).rejects.toThrow(ForbiddenException);
    expect(registration.bindInTx).not.toHaveBeenCalled();
  });

  it('软删 media 槽位跳过计数（skippedDeleted——引用已死不 FK 违例）+零绑定源=cloned 0 幂等 no-op', async () => {
    const c = await make();
    tx.mediaBinding.findMany.mockResolvedValue([
      { mediaId: 'm1', role: 'primary', targetField: 'fileId', targetItemId: '' },
      { mediaId: 'm-gone', role: 'primary', targetField: 'images', targetItemId: 'c1' },
    ]);
    prisma.media.findMany.mockResolvedValue([{ id: 'm1', teamId: 't1' }]);   // m-gone 软删缺席
    const out = await c.command('p1', { type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-tgt' }, req());
    expect(out).toEqual({ type: 'CloneBinding', cloned: 1, skippedDeleted: 1 });
    expect(registration.bindInTx).toHaveBeenCalledTimes(1);
    tx.mediaBinding.findMany.mockResolvedValue([]);
    const out2 = await c.command('p1', { type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-tgt' }, req());
    expect(out2).toEqual({ type: 'CloneBinding', cloned: 0, skippedDeleted: 0 });
  });
});
