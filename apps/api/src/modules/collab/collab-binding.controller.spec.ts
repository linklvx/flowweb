// apps/api/src/modules/collab/collab-binding.controller.spec.ts
// C3a-7（plan v3 Task C3a-7——spec 2026-11-11-foundation-batch-design.md §3.2-4 单写者+命令面两改）：
// BindMedia=校验+NodeArtifact/Projection 写（**零 MediaBinding 读写**——绑定经投影出现，客户端 doc 帧
// 自足）；CloneBinding 命令已删（第五轮 P1：web 生产零调用——type 非法 400）。
//   - 源配对=pairArtifact 唯一腿（NodeArtifact 行）+doc 源节点兜底（窄端口 MediaRefsReadPort——
//     分档映射写死：源节点不存在→400 SOURCE_NODE_MISSING；源 media 不在源节点→400 SOURCE_MEDIA_MISMATCH；
//     跨队→403；doc 不可读/lease 失守→503 SOURCE_DOC_UNREADABLE）；
//   - T25b 语义锚承前（跨团队 media ACL spec §5）。
// Y2 D2t（spec v2.13 §3 D5）：受理层重写——命令体五字段（sourceProjectId/commandId 幂等面；expectedRev
// 已随 B4 CAS 删除）；权限三查（目标编辑+源团队成员+源项目可读）；幂等查（completed 返原 id/pending
// 沿用新键/换源换项目→409 BIND_COMMAND_MISMATCH）；事务内占坑（assertCanUploadInTx+pending 行+
// StorageReservation ACTIVE——唯一冲突事务外 catch 重读幂等档非 500）；CopyObject 去重拷贝（桩）；
// 失败清理档。MinIO/quota/registration=桩（int 池真库面在 collab-binding.int.spec）。
// 构造=位置参数直建（Test.createTestingModule 面在 DI 环境联调 spec——collab-media.int 同款先例）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import * as Y from 'yjs';
import { CollabBindingController } from './collab-binding.controller';
import { type MediaRefsReadPort } from './media-refs-read.port';
import { type CollabSlotWritePort, type SlotWriteOutcome } from './slot-write.port';
import { ProjectPermissionService } from '../team/project-permission.service';
import { PrismaService } from '../../prisma/prisma.service';

const prisma: any = {};
const perm = { assertEditorWithTeam: vi.fn(), resolveWithTeam: vi.fn() };
const port: MediaRefsReadPort = { readNodeRefs: vi.fn() };
const minio: any = {
  buildKey: vi.fn(() => `uploads/u1/${Date.now()}/k-${Math.random().toString(36).slice(2)}.png`),
  copyObject: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
};
const quota: any = { assertCanUploadInTx: vi.fn(async () => undefined) };
const registration: any = { deletePending: vi.fn(async () => 1) };

/** 槽条件写端口桩（D3t——Y.Doc 直投真 collectMediaRefsForNode 形态；档位由 stateOf 布景驱动）。 */
const makeSlotPort = (stateOf: (pid: string, nodeId: string, slotId: string) => SlotWriteOutcome['slot'] = () => 'empty') => {
  const doc = new Y.Doc();
  const portSlot: CollabSlotWritePort = {
    async conditionalWrite(pid: string, nodeId: string, slotId: string): Promise<SlotWriteOutcome> {
      const slot = stateOf(pid, nodeId, slotId);
      if (slot === 'empty') {
        // 槽空才写——真 conditionalWrite 同款（Y.Doc 直投）
        const node = new Y.Map<unknown>();
        const data = new Y.Map<unknown>();
        data.set('mediaId', slotId);
        node.set('type', 'imageGen');
        node.set('data', data);
        (doc.getMap('nodes') as Y.Map<unknown>).set(nodeId, node);
      }
      const entry = (doc.getMap('nodes') as Y.Map<unknown>).get(nodeId);
      return { slot, snapshot: entry == null ? [] : [] };
    },
  };
  return { port: portSlot, doc };
};

const tx = {
  mediaBinding: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },   // 零读写断言面（任意操作被调=红）
  media: {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'm-new', ...args.data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUniqueOrThrow: vi.fn(async () => ({ factVersion: 1n })),
  },
  storageReservation: { create: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
  mediaFact: {},
  canvasProject: { findUniqueOrThrow: vi.fn(async () => ({ teamId: 't-dst' })) },
  // D3t 快照直调：projector 桩（真投影器走 $queryRaw——unit 池无 DB；projection 语义在 int 池钉）
  $queryRaw: vi.fn(async () => []),
  $executeRaw: vi.fn(async () => 0),
};
prisma.$transaction = (fn: (t: typeof tx) => Promise<unknown>) => fn(tx);

const req = () => ({ user: { id: 'u1' } }) as any;
const BIND_BODY = { type: 'BindMedia', sourceProjectId: 'p-src', sourceNodeId: 'n-src', mediaId: 'm1', targetNodeId: 'n-tgt', commandId: 'cmd-1' };
const ref = (mediaId: string) => ({ nodeId: 'n-src', mediaId, role: 'primary', targetField: 'mediaId', targetItemId: '' });

/** 源行真库形态（teamId=源队——权限三查第②③查的锚）。 */
const SRC_MEDIA_ROW = {
  id: 'm1', teamId: 't-src', bucket: 'flowai', key: 'uploads/u0/src.png', thumbnailKey: null, objectKey: null,
  mimeType: 'image/png', size: 100n, originalName: 'src.png', type: 'uploaded',
  naturalWidth: null, naturalHeight: null, sniffedMimeType: 'image/png', objectSha256: 'sha-0',
  deletedAt: null, deletionState: 'ACTIVE',
};

async function make(slotPort?: CollabSlotWritePort) {
  return new CollabBindingController(
    perm as unknown as ProjectPermissionService,
    prisma as unknown as PrismaService,
    port,
    minio as never,
    quota as never,
    registration as never,
    slotPort ?? makeSlotPort().port,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  perm.assertEditorWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't-dst' });
  // 源项目读权（三查第③查——resolveWithTeam 先例；role 非空即放行）
  perm.resolveWithTeam.mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't-src', teamStatus: 'ACTIVE' });
  prisma.teamMember = { findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }) };   // 三查第②查（源团队成员）
  prisma.media = { findFirst: vi.fn().mockResolvedValue(SRC_MEDIA_ROW), findUnique: vi.fn().mockResolvedValue(null) };
  prisma.nodeArtifact = { findFirst: vi.fn() };
  prisma.canvasProject = { findUniqueOrThrow: vi.fn(async () => ({ teamId: 't-dst' })) };
  quota.assertCanUploadInTx.mockResolvedValue(undefined);
  tx.media.updateMany.mockResolvedValue({ count: 1 });
  tx.media.findUniqueOrThrow.mockResolvedValue({ factVersion: 1n });
  tx.storageReservation.updateMany.mockResolvedValue({ count: 1 });
  tx.canvasProject.findUniqueOrThrow.mockResolvedValue({ teamId: 't-dst' });
});

describe('Y2 D2t：BindMedia 受理层——权限三查+幂等+占坑+去重拷贝（桩面）', () => {
  it('正路（pairArtifact 腿）：新 pending 行（新键/三幂等列/bucket=源行/teamId=目标/不复制关联列）+预留 ACTIVE+回执新 id+零 binding 读写', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });   // 源配对唯一腿（源项目域）
    const out = await c.command('p-dst', BIND_BODY, req());
    expect(out.type).toBe('BindMedia');
    expect(out.mediaId).toBe('m-new');
    expect(prisma.nodeArtifact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'p-src', nodeId: 'n-src', mediaId: 'm1' },   // ★两腿改查源项目域
    }));
    // 源行读面：ACTIVE 未软删门
    expect(prisma.media.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'm1', deletedAt: null, deletionState: 'ACTIVE' },
    }));
    // 占坑事务：配额门（目标团队+Number(源.size)）
    expect(quota.assertCanUploadInTx).toHaveBeenCalledWith(expect.anything(), 't-dst', 100);
    // pending 行落库面
    expect(tx.media.create).toHaveBeenCalledTimes(1);
    const rowData = (tx.media.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data as Record<string, unknown>;
    expect(rowData).toMatchObject({
      teamId: 't-dst', userId: 'u1', bucket: 'flowai', status: 'pending',
      bindCommandId: 'cmd-1', bindSourceMediaId: 'm1', bindTargetProjectId: 'p-dst',
      mimeType: 'image/png', size: 100n, originalName: 'src.png', type: 'uploaded',
      probeState: 'pending',
    });
    // ★不复制关联列（spec D5 ⑤）——data 键缺席（Prisma 落 DB 默认 NULL）
    for (const absent of ['projectId', 'nodeId', 'taskId', 'clientUploadId', 'sourceRegistrationKey']) {
      expect(rowData).not.toHaveProperty(absent);
    }
    expect(rowData.pendingExpiresAt).toBeInstanceOf(Date);
    expect(tx.storageReservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-dst', upperBoundBytes: 100n, state: 'ACTIVE' }),
    }));
    // CopyObject：显式源桶参数（源行 bucket 列）
    expect(minio.copyObject).toHaveBeenCalledWith('flowai', 'uploads/u0/src.png', expect.any(String));
    // 零 binding 读写维持（B4 后命令面零写）
    for (const op of Object.values(tx.mediaBinding)) expect(op).not.toHaveBeenCalled();
    expect(port.readNodeRefs).not.toHaveBeenCalled();   // pairArtifact 命中=doc 兜底不触发
  });

  it('doc 兜底腿：pairArtifact 缺→端口读源项目 doc refs 命中 mediaId→放行（源项目域读）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue(null);
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue([ref('m1')]);
    const out = await c.command('p-dst', BIND_BODY, req());
    expect(out.mediaId).toBe('m-new');
    expect(port.readNodeRefs).toHaveBeenCalledWith('p-src', 'n-src');   // ★读源项目（非目标项目）
  });

  it('★权限三查：非源团队成员→403（teamMember 缺行）', async () => {
    const c = await make();
    prisma.teamMember.findFirst.mockResolvedValue(null);
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toThrow(ForbiddenException);
    expect(tx.media.create).not.toHaveBeenCalled();
  });

  it('★权限三查：源项目无读权（resolveWithTeam role=null）→403', async () => {
    const c = await make();
    perm.resolveWithTeam.mockResolvedValue({ role: null, teamId: 't-src', teamStatus: 'ACTIVE' });
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toThrow(ForbiddenException);
    expect(tx.media.create).not.toHaveBeenCalled();
  });

  it('★分档①：源节点不在 doc（端口 null）→400 SOURCE_NODE_MISSING', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue(null);
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toMatchObject({ errorCode: 'SOURCE_NODE_MISSING', status: 400 });
  });

  it('★分档②：源 media 不在源节点 refs→400 SOURCE_MEDIA_MISMATCH', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue(null);
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockResolvedValue([ref('m-other')]);
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toMatchObject({ errorCode: 'SOURCE_MEDIA_MISMATCH', status: 400 });
  });

  it('★分档③：doc 不可读/lease 失守（端口 ServiceUnavailableException）→503 SOURCE_DOC_UNREADABLE', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue(null);
    (port.readNodeRefs as ReturnType<typeof vi.fn>).mockRejectedValue(new ServiceUnavailableException('collab not serving (lease not held)'));
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toMatchObject({ errorCode: 'SOURCE_DOC_UNREADABLE', status: HttpStatus.SERVICE_UNAVAILABLE });
  });

  it('media 不存在/软删→404', async () => {
    const c = await make();
    prisma.media.findFirst.mockResolvedValue(null);
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toThrow(NotFoundException);
  });

  it('C3b-4：DELETING media 拒新绑定——ACL 查询含 deletionState=ACTIVE 门', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });
    await c.command('p-dst', BIND_BODY, req());
    expect(prisma.media.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'm1', deletedAt: null, deletionState: 'ACTIVE' },
    }));
  });

  it('★源 size 零拒：空值不得当 0 字节过配额门（400 拒+零占坑事务）', async () => {
    const c = await make();
    prisma.media.findFirst.mockResolvedValue({ ...SRC_MEDIA_ROW, size: 0n });
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toMatchObject({ status: 400 });
    expect(quota.assertCanUploadInTx).not.toHaveBeenCalled();
    expect(tx.media.create).not.toHaveBeenCalled();
  });

  it('★幂等档：命中 completed→返回已有 id 不拷贝（零 CopyObject/零占坑事务）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });
    prisma.media.findUnique.mockResolvedValue({ id: 'm-done', status: 'completed', key: 'k-done', bindCommandId: 'cmd-1', bindSourceMediaId: 'm1', bindTargetProjectId: 'p-dst', teamId: 't-dst' });
    const out = await c.command('p-dst', BIND_BODY, req());
    expect(out.mediaId).toBe('m-done');
    expect(minio.copyObject).not.toHaveBeenCalled();
    expect(tx.media.create).not.toHaveBeenCalled();
  });

  it('★幂等档：命中 pending→沿用行上新键续走（零占坑事务，CopyObject 按行上新键）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });
    prisma.media.findUnique.mockResolvedValue({ id: 'm-pend', status: 'pending', key: 'k-pend', thumbnailKey: null, objectKey: null, bucket: 'flowai', bindCommandId: 'cmd-1', bindSourceMediaId: 'm1', bindTargetProjectId: 'p-dst', teamId: 't-dst' });
    const out = await c.command('p-dst', BIND_BODY, req());
    expect(out.mediaId).toBe('m-pend');
    expect(tx.media.create).not.toHaveBeenCalled();   // 不走第二次占坑事务
    expect(tx.storageReservation.create).not.toHaveBeenCalled();
    expect(minio.copyObject).toHaveBeenCalledWith('flowai', 'uploads/u0/src.png', 'k-pend');   // 沿用行上新键
  });

  it('★409 BIND_COMMAND_MISMATCH：换源 media→应用层比对（行上 bindSourceMediaId 不同）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });
    prisma.media.findUnique.mockResolvedValue({ id: 'm-pend', status: 'pending', key: 'k', bindCommandId: 'cmd-1', bindSourceMediaId: 'm-other', bindTargetProjectId: 'p-dst', teamId: 't-dst' });
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toMatchObject({ errorCode: 'BIND_COMMAND_MISMATCH', status: 409 });
    expect(minio.copyObject).not.toHaveBeenCalled();
  });

  it('★409 BIND_COMMAND_MISMATCH：换目标项目（行上 bindTargetProjectId 不同）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });
    prisma.media.findUnique.mockResolvedValue({ id: 'm-pend', status: 'pending', key: 'k', bindCommandId: 'cmd-1', bindSourceMediaId: 'm1', bindTargetProjectId: 'p-dst2', teamId: 't-dst' });
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toMatchObject({ errorCode: 'BIND_COMMAND_MISMATCH', status: 409 });
  });

  it('★唯一约束冲突（P2002）：$transaction 外 catch→重读走幂等档（响应非 500）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });
    // 占坑事务抛 P2002（并发同命令先提交）——重读命中 completed 走幂等档
    const err = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const realTx = prisma.$transaction;
    prisma.$transaction = vi.fn(async () => { throw err; });
    try {
      prisma.media.findUnique.mockResolvedValue({ id: 'm-won', status: 'completed', key: 'k-won', bindCommandId: 'cmd-1', bindSourceMediaId: 'm1', bindTargetProjectId: 'p-dst', teamId: 't-dst' });
      const out = await c.command('p-dst', BIND_BODY, req());
      expect(out.mediaId).toBe('m-won');   // 非 500——幂等档回执
      expect(prisma.media.findUnique).toHaveBeenCalledWith({ where: { teamId_bindCommandId: { teamId: 't-dst', bindCommandId: 'cmd-1' } } });
    } finally {
      prisma.$transaction = realTx;   // 复原（后续用例走占坑事务真形态）
    }
  });

  it('★CopyObject 失败清理档：删本轮已拷新键+deletePending（行+预留同事务）+不写槽', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });
    // 双键拷贝（key+thumbnailKey）——第二笔失败：已拷第一把新键须删（404 容忍）
    prisma.media.findFirst.mockResolvedValue({ ...SRC_MEDIA_ROW, thumbnailKey: 'thumb/t.png' });
    const copiedKeys: string[] = [];
    let n = 0;
    minio.copyObject.mockImplementation(async (_sb: string, _sk: string, dk: string) => {
      n += 1;
      copiedKeys.push(dk);
      if (n === 2) throw { $metadata: { httpStatusCode: 500 }, name: 'InternalError' };
      return undefined;
    });
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toThrow();
    // 删本轮已拷新键（首把——404 容忍由 delete 吞错形态承载）
    expect(minio.delete).toHaveBeenCalledWith(copiedKeys[0]);
    expect(registration.deletePending).toHaveBeenCalledWith('m-new');   // 删行+预留 RELEASED 同事务
    // 不写槽：零 NodeArtifact/Projection（B4 后命令面零写维持）
    expect(tx.mediaBinding.create).not.toHaveBeenCalled();
  });

  it('★三键去重：key+thumbnailKey 不同对象两把新键；objectKey=key 同对象共用同一把新键', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });
    prisma.media.findFirst.mockResolvedValue({ ...SRC_MEDIA_ROW, thumbnailKey: 'thumb/t.png', objectKey: 'uploads/u0/src.png' });
    const out = await c.command('p-dst', BIND_BODY, req());
    expect(out.mediaId).toBe('m-new');
    const keys = (minio.copyObject as ReturnType<typeof vi.fn>).mock.calls.map((a: unknown[]) => a[2] as string);
    expect(keys).toHaveLength(2);   // 两笔（key+thumbnailKey——objectKey 同对象不单拷）
    expect(new Set(keys).size).toBe(2);
    const row = (tx.media.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data as Record<string, unknown>;
    expect(row.thumbnailKey).toBe(keys[1]);   // thumbnailKey=第二把新键
    expect(row.objectKey).toBe(keys[0]);   // objectKey 与 key 共用同一把新键
  });

  it('坏 body（type 异/五字段缺一）→400；★CloneBinding 已删（400 BINDING_COMMAND_BAD_BODY）', async () => {
    const c = await make();
    for (const bad of [
      {}, { type: 'Nope' },
      { type: 'CloneBinding', sourceNodeId: 'n-src', targetNodeId: 'n-tgt' },   // ★命令删除锚（C3a-7）
      { ...BIND_BODY, sourceProjectId: '' },
      { ...BIND_BODY, sourceNodeId: '' },
      { ...BIND_BODY, mediaId: '' },
      { ...BIND_BODY, targetNodeId: '' },
      { ...BIND_BODY, commandId: '' },
      // expectedRev 已随 CAS 删除——不再受理（多余字段非拒档面——旧字段忽略）
    ]) {
      await expect(c.command('p-dst', bad, req())).rejects.toMatchObject({ errorCode: 'BINDING_COMMAND_BAD_BODY', status: 400 });
    }
  });

  it('编辑权门：assertEditorWithTeam（VIEWER→403）', async () => {
    const c = await make();
    perm.assertEditorWithTeam.mockRejectedValue(new ForbiddenException());
    await expect(c.command('p-dst', BIND_BODY, req())).rejects.toThrow(ForbiddenException);
  });

  it('C3a-7 零 MediaBinding 读写维持：全程零 binding delegate 调用（B4 后命令面零写）', async () => {
    const c = await make();
    prisma.nodeArtifact.findFirst.mockResolvedValue({ id: 'na1' });
    await c.command('p-dst', BIND_BODY, req());
    for (const op of Object.values(tx.mediaBinding)) expect(op).not.toHaveBeenCalled();
  });
});
