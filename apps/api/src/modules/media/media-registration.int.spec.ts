// apps/api/src/modules/media/media-registration.int.spec.ts —— Y1b T4 骨架红测（真 PG；MinIO mock）
// 新建 service 的红=编译级（模块/方法不存在）；此处为绿态行为钉：
// prepareUpload 并发同 clientUploadId（真 PG 并发用例）/pendingExpiresAt 落值窗/TTL sweep 分档/bindInTx current-state upsert。
// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  MediaRegistrationService, PENDING_UPLOAD_TTL_MS,
} from './media-registration.service';
import { PrismaService } from '../../prisma/prisma.service';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();

const UID = `it-t4reg-owner-${Date.now()}`;
let TID = '';

const makeReg = () => {
  const deletes: string[] = [];
  const minio: any = {
    buildKey: vi.fn(() => `uploads/${UID}/it/${Math.random().toString(36).slice(2)}.png`),
    delete: vi.fn(async (key: string) => { deletes.push(key); }),
  };
  const reg = new MediaRegistrationService(prisma as unknown as PrismaService, minio);
  return { reg, minio, deletes };
};

const prepareParams = (over: Record<string, unknown> = {}) => ({
  userId: UID, teamId: TID, key: `uploads/${UID}/it/${Math.random().toString(36).slice(2)}.png`,
  fileName: 'a.png', mimeType: 'image/png', size: 100, type: 'uploaded', ...over,
});

(hasDb ? describe : describe.skip)('Y1b T4：MediaRegistrationService 骨架（真 PG；MinIO mock）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'it-t4reg', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'it-t4reg', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
  }, 20_000);

  afterAll(async () => {
    await prisma.media.deleteMany({ where: { teamId: TID } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('T4-① 并发 prepareUpload 同 clientUploadId：真 PG 并发竞态（findUnique 双 miss→双 create→P2002）→恰一行同 mediaId', async () => {
    const { reg } = makeReg();
    const cuid = `it-reg-cuid-${Date.now()}`;
    const [a, b] = await Promise.all([
      reg.prepareUpload(prepareParams({ clientUploadId: cuid })),
      reg.prepareUpload(prepareParams({ clientUploadId: cuid })),
    ]);
    expect(a.id).toBe(b.id); // P2002 败方重读胜者行
    const rows = await prisma.media.findMany({ where: { teamId: TID, clientUploadId: cuid } });
    expect(rows).toHaveLength(1);
  });

  it('T4-③ prepareUploadInTx 落 pendingExpiresAt≈+24h（TTL 窗）+temp 型 expiresAt 7d 语义维持', async () => {
    const { reg } = makeReg();
    const m = await reg.prepareUpload(prepareParams({ type: 'temp' }));
    const ttl = m.pendingExpiresAt!.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(PENDING_UPLOAD_TTL_MS - 60_000);
    expect(ttl).toBeLessThan(PENDING_UPLOAD_TTL_MS + 60_000);
    const sevenDays = m.expiresAt!.getTime() - Date.now();
    expect(sevenDays).toBeGreaterThan(7 * 24 * 3600_000 - 60_000);
  });

  it('T4-③ TTL sweep：过期 pending 行删+对象删；未过期行保留；completed 行保留（即使 pendingExpiresAt 已过——只扫 pending 态）', async () => {
    const { reg, deletes } = makeReg();
    const expired = await reg.prepareUpload(prepareParams({}));
    const fresh = await reg.prepareUpload(prepareParams({}));
    const done = await reg.prepareUpload(prepareParams({}));
    await prisma.media.update({ where: { id: expired.id }, data: { pendingExpiresAt: new Date(Date.now() - 1000) } });
    await prisma.media.update({ where: { id: done.id }, data: { status: 'completed', pendingExpiresAt: new Date(Date.now() - 1000) } });

    const removed = await reg.sweepExpiredPending();
    expect(removed).toBe(1);
    expect(deletes).toContain(expired.key); // 对象已删
    expect(await prisma.media.findUnique({ where: { id: expired.id } })).toBeNull(); // 过期行已删
    expect(await prisma.media.findUnique({ where: { id: fresh.id } })).not.toBeNull(); // 未过期保留
    expect(await prisma.media.findUnique({ where: { id: done.id } })).not.toBeNull(); // completed 不进扫
  });

  it('T4-③ sweep 对象 404 容忍：对象不存在仍删行（幂等——崩溃窗自愈重扫）', async () => {
    const { reg, minio } = makeReg();
    const m = await reg.prepareUpload(prepareParams({}));
    await prisma.media.update({ where: { id: m.id }, data: { pendingExpiresAt: new Date(Date.now() - 1000) } });
    minio.delete.mockRejectedValue({ name: 'NoSuchKey' }); // 对象已不在（前轮已删后崩溃）
    expect(await reg.sweepExpiredPending()).toBe(1);
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeNull();
  });

  it('T4-bind bindInTx：同槽位同 media 重 bind 恰一行（current-state——update 无净变更幂等）；不同 targetItemId 分行', async () => {
    const { reg } = makeReg();
    const m = await reg.prepareUpload(prepareParams({}));
    const projectId = `it-bind-p-${Date.now()}`; // 槽位锚——闭包外单次求值（每调用重算会跨毫秒换槽位）
    const bind = (targetItemId = '') => prisma.$transaction((tx) => reg.bindInTx(tx, {
      mediaId: m.id, projectId, nodeId: 'n1', teamId: TID, targetItemId,
    }));
    await bind();
    await bind(); // 同槽位同 media 重 bind=current-state 幂等（update 无净变更）
    await bind('item-2'); // 不同槽位=新行
    const rows = await prisma.mediaBinding.findMany({ where: { mediaId: m.id } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.targetItemId))).toEqual(new Set(['', 'item-2']));
  });

  it('T4-bind 分歧场景（v14.2 裁决㉜）：同槽位先 bind mediaA 再 bind mediaB → 恰一行且行.mediaId===B（current-state；create-only 已废止——旧实现此断言红：mediaId 仍 A）', async () => {
    const { reg } = makeReg();
    const mediaA = await reg.prepareUpload(prepareParams({}));
    const mediaB = await reg.prepareUpload(prepareParams({}));
    const projectId = `it-bind-cs-${Date.now()}`; // 槽位锚——闭包外单次求值（每调用重算会跨毫秒换槽位）
    const bind = (mediaId: string) => prisma.$transaction((tx) => reg.bindInTx(tx, {
      mediaId, projectId, nodeId: 'n1', teamId: TID,
    }));
    await bind(mediaA.id);
    await bind(mediaB.id); // 同槽位换 media=current-state 改行
    const rows = await prisma.mediaBinding.findMany({ where: { projectId, nodeId: 'n1' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].mediaId).toBe(mediaB.id);
  });

  it('T4-② confirmInTx CAS 语义补充：非 pending 行 confirm → 0 行命中 409（幂等重放/已完成终判拒绝）', async () => {
    const { reg } = makeReg();
    const m = await reg.prepareUpload(prepareParams({}));
    await prisma.media.update({ where: { id: m.id }, data: { status: 'completed' } });
    await expect(
      prisma.$transaction((tx) => reg.confirmInTx(tx, { mediaId: m.id, actualSize: 100, sniffedMimeType: 'image/png' })),
    ).rejects.toThrow('上传已在确认中或已完成');
  });
});
