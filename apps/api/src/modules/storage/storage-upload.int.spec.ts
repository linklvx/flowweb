// apps/api/src/modules/storage/storage-upload.int.spec.ts —— Y1b T4 红用例（真 PG；MinIO/quota mock——int 池无 S3 service）
// DB 语义层：clientUploadId 幂等/completed 复用守卫/projectId 落列/confirmInTx pending CAS 并发双 confirm 恰一/
// sniffed 落列+probeState 路由/白名单外拒删。MinIO 语义（presign policy/真字节流）归 unit+T5 真 S3。
// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { StorageService } from './storage.service';
import { MediaRegistrationService } from '../media/media-registration.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();

const PID = `it-t4-proj-${Date.now()}`;
const UID = `it-t4-owner-${Date.now()}`;
const VIEWER = `it-t5-viewer-${Date.now()}`;
let TID = '';

/** PNG 最小可判型缓冲（签名+IHDR chunk 头——file-type 16.x 需可读 chunk，过短会 EndOfStream） */
const PNG_HEAD = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452', 'hex'),
  Buffer.alloc(13, 1),
]);
const M4A_HEAD = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(24, 0)]);
const GARBAGE_HEAD = Buffer.from('hello world this is not a media file at all');

const makeServices = () => {
  const deletes: string[] = [];
  const minio: any = {
    buildKey: vi.fn(() => `uploads/${UID}/it/${Math.random().toString(36).slice(2)}.png`),
    generatePresignedPost: vi.fn(async (key: string) => ({ url: 'http://minio/flowai', fields: { key } })),
    statSize: vi.fn(),
    getHeadBytes: vi.fn(),
    delete: vi.fn(async (key: string) => { deletes.push(key); }),
  };
  const quota: any = { assertCanUpload: vi.fn(), assertOnConfirm: vi.fn(), assertMember: vi.fn() };
  const registration = new MediaRegistrationService(prisma as unknown as PrismaService, minio);
  const perm = new ProjectPermissionService(prisma as unknown as PrismaService);   // T5 写 ACL：真权限链（显式行>创建者>团队回退）
  const storage = new StorageService(prisma as unknown as PrismaService, minio, quota, registration, perm);
  return { storage, minio, quota, registration, perm, deletes };
};

const presignDto = (over: Record<string, unknown> = {}) => ({
  fileName: 'a.png', fileSize: 100, fileType: 'image/png', type: 'uploaded' as const, teamId: TID, ...over,
});

(hasDb ? describe : describe.skip)('Y1b T4：upload presign/confirm（真 PG；MinIO/quota mock）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'it-t4', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'it-t4', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    await prisma.canvasProject.create({ data: { id: PID, name: 'it-t4', userId: UID, teamId: TID } });
    // T5 写 ACL 夹具：显式 VIEWER 行用户（团队成员但项目只读——resolveWithTeam 显式档）
    await prisma.user.upsert({
      where: { id: VIEWER },
      create: { id: VIEWER, name: 'it-t5-viewer', email: `${VIEWER}@test.local`, emailVerified: false },
      update: {},
    });
    await prisma.teamMember.create({ data: { teamId: TID, userId: VIEWER, role: 'MEMBER' } });
    await prisma.projectMember.create({ data: { projectId: PID, userId: VIEWER, role: 'PROJECT_VIEWER' } });
  }, 20_000);

  afterAll(async () => {
    await prisma.media.deleteMany({ where: { teamId: TID } });
    await prisma.projectMember.deleteMany({ where: { projectId: PID } });
    await prisma.canvasProject.deleteMany({ where: { id: PID } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: { in: [UID, VIEWER] } } });
    await prisma.$disconnect();
  }, 20_000);

  it('T4-① clientUploadId 幂等：网络重试同 uploadId 恰一行+同行同 key（红=现状重复行重复 key）', async () => {
    const { storage, minio } = makeServices();
    const cuid = `it-cuid-${Date.now()}`;
    const r1 = await storage.presignUpload(UID, presignDto({ clientUploadId: cuid }));
    const r2 = await storage.presignUpload(UID, presignDto({ clientUploadId: cuid }));
    expect(r2.fileId).toBe(r1.fileId); // 同行复用
    expect(r2.key).toBe(r1.key); // key 复用（不建新对象键）
    const rows = await prisma.media.findMany({ where: { teamId: TID, clientUploadId: cuid } });
    expect(rows).toHaveLength(1); // 恰一行
    expect(minio.generatePresignedPost).toHaveBeenCalledTimes(2); // 重试重新 presign（前 URL 可能已过期）
  });

  it('T4-①守卫 completed 行同 clientUploadId 再 presign → 409 拒（防同 key 覆写已完成对象——绕过 size/sniff 终判）', async () => {
    const { storage } = makeServices();
    const cuid = `it-cuid-done-${Date.now()}`;
    const r = await storage.presignUpload(UID, presignDto({ clientUploadId: cuid }));
    await prisma.media.update({ where: { id: r.fileId }, data: { status: 'completed' } });
    await expect(storage.presignUpload(UID, presignDto({ clientUploadId: cuid }))).rejects.toThrow('clientUploadId');
    const rows = await prisma.media.findMany({ where: { teamId: TID, clientUploadId: cuid } });
    expect(rows).toHaveLength(1); // 不建新行
  });

  it('T4-⑥ projectId 落行：三级回落①携带 projectId 时落列（红=现状缺失——binding/facts/IDOR 归属全空）', async () => {
    const { storage } = makeServices();
    const r = await storage.presignUpload(UID, presignDto({ teamId: undefined, projectId: PID }));
    const row = await prisma.media.findUnique({ where: { id: r.fileId } });
    expect(row!.projectId).toBe(PID);
  });

  it('T4-② confirmInTx pending CAS：并发双 confirm 恰一 completed（红=现状 storage:69-99 无守卫双 completed）', async () => {
    const { storage, minio } = makeServices();
    const r = await storage.presignUpload(UID, presignDto({}));
    const row0 = await prisma.media.findUnique({ where: { id: r.fileId } });
    minio.statSize.mockResolvedValue(Number(row0!.size));
    minio.getHeadBytes.mockResolvedValue(PNG_HEAD);
    const results = await Promise.allSettled([
      storage.confirmUpload(UID, { fileId: r.fileId, key: r.key, fileSize: 100 }),
      storage.confirmUpload(UID, { fileId: r.fileId, key: r.key, fileSize: 100 }),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
    const row = await prisma.media.findUnique({ where: { id: r.fileId } });
    expect(row!.status).toBe('completed');
    expect(row!.factVersion).toBe(1n); // 恰一次 status+sniff 变更（schema :311 单调事实版本）
  });

  it('T4-④ confirm sniffed 落列+probeState 按 sniffed 路由：png→pending / m4a→skipped；pendingExpiresAt 清空', async () => {
    const { storage: s1, minio: m1 } = makeServices();
    const r1 = await s1.presignUpload(UID, presignDto({}));
    const rowA = await prisma.media.findUnique({ where: { id: r1.fileId } });
    m1.statSize.mockResolvedValue(Number(rowA!.size));
    m1.getHeadBytes.mockResolvedValue(PNG_HEAD);
    await s1.confirmUpload(UID, { fileId: r1.fileId, key: r1.key, fileSize: 100 });
    const row1 = await prisma.media.findUnique({ where: { id: r1.fileId } });
    expect(row1!.sniffedMimeType).toBe('image/png');
    expect(row1!.probeState).toBe('pending'); // 图片→probe（sharp natural）
    expect(row1!.pendingExpiresAt).toBeNull(); // 离开 pending 态

    const { storage: s2, minio: m2 } = makeServices();
    const r2 = await s2.presignUpload(UID, presignDto({ fileName: 'b.m4a', fileType: 'audio/mp4' }));
    const rowB = await prisma.media.findUnique({ where: { id: r2.fileId } });
    m2.statSize.mockResolvedValue(Number(rowB!.size));
    m2.getHeadBytes.mockResolvedValue(M4A_HEAD);
    await s2.confirmUpload(UID, { fileId: r2.fileId, key: r2.key, fileSize: 100 });
    const row2 = await prisma.media.findUnique({ where: { id: r2.fileId } });
    expect(row2!.sniffedMimeType).toBe('audio/x-m4a'); // 以 sniffed 为准落列（声明 audio/mp4 不改写）
    expect(row2!.mimeType).toBe('audio/mp4'); // 声明列保持原值
    expect(row2!.probeState).toBe('skipped'); // probe claim 只吃 image/video 非 SVG——audio 无 natural 可算
  });

  it('T4-④白名单外：不可判型字节 → 删对象+删行+400（红=现状零嗅探直过 completed）', async () => {
    const { storage, minio, deletes } = makeServices();
    const r = await storage.presignUpload(UID, presignDto({}));
    const row0 = await prisma.media.findUnique({ where: { id: r.fileId } });
    minio.statSize.mockResolvedValue(Number(row0!.size));
    minio.getHeadBytes.mockResolvedValue(GARBAGE_HEAD);
    await expect(storage.confirmUpload(UID, { fileId: r.fileId, key: r.key, fileSize: 100 })).rejects.toThrow();
    expect(deletes).toContain(r.key); // 对象已删（行内 key）
    expect(await prisma.media.findUnique({ where: { id: r.fileId } })).toBeNull(); // 行已删
  });

  it('T5 写 ACL：projectId 形态要 project editor——显式 VIEWER presign → 403 拒（红=现状 quota.assertMember 仅验成员直过）；EDITOR/无显式行团队成员照常（真权限链）', async () => {
    const { storage } = makeServices();
    // 红：VIEWER（团队成员+显式 PROJECT_VIEWER 行）——现状 assertMember 放行
    await expect(storage.presignUpload(VIEWER, presignDto({ teamId: undefined, projectId: PID })))
      .rejects.toThrow(/编辑权限|Forbidden/);
    // 无显式行的普通团队成员 → 团队回退 PROJECT_EDITOR 放行（写门收紧不误伤）
    const { storage: s2 } = makeServices();
    const ok = await s2.presignUpload(UID, presignDto({ teamId: undefined, projectId: PID }));
    expect(ok.fileId).toBeTruthy();
  });
});
