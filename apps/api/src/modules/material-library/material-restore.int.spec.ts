// apps/api/src/modules/material-library/material-restore.int.spec.ts
// 素材恢复接线（spec 2026-11-16-media-restore-design.md v3 §1.2-§3/§4——plan 2026-11-17-media-restore Task 2）：
// 恢复事务八腿（真 PG）。四条防假绿指令落点：②lost 腿用原 runId 直调删除序（恢复后 deletedAt 已空，
// sweep 候选查询读不到这行）；③配额超限看「当即拒绝+deletedAt 仍在+<1s」（拒绝本身=没进退避）；
// ⑤跨团队腿他队行必须 DELETING+软删（普通软删行原语 WHERE 不匹配——原文直传也判过=假绿）；
// ⑧Team 锁采样：A 握媒体行 600ms、恢复 Promise 采样期间 pending、会话 C 400ms 循环零 55P03。
// 夹具纪律（开工契约③）：全文件唯一 isDefault:true 团队（getOwnerTeamId findFirst 无次序）专供
// 「不传 teamId」路径；超限/采样腿用 isDefault:false 团队+显式 teamId（超限态不外溢）。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MaterialService, isRestoreLockUnavailable } from './services/material.service';
import { StorageQuotaService } from '../team/storage-quota.service';
import { TEAM_FREE_STORAGE_LIMIT_BYTES } from '../team/team.constants';
import { MediaGcService, claimMediaForDeletion } from '../media-delivery/media-gc.service';
import type { DeletionBarrierPort } from '../collab/deletion-barrier.port';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;
const maybe = hasDb ? describe : describe.skip;

const prisma = new PrismaClient();
const prismaService = new PrismaService();

const UID = `int-restore-owner-${Date.now()}`;
const OUTSIDER = `int-restore-out-${Date.now()}`;
let TID = '';          // isDefault:true——「不传 teamId」路径专用（全文件唯一）
let TID_Q = '';        // 超限两腿（isDefault:false）
let TID_S = '';        // 采样腿（isDefault:false）
let TID_OTHER = '';    // 跨团队腿他队

/** 删除序直调所需的 barrier/minio 极简 stub（镜像 media-deleting.okBarrier 形态不导入）。 */
const okBarrier = (): DeletionBarrierPort => ({
  prepare: async () => ({ outcome: 'verified', barrierId: `stub-${randomUUID()}`, projects: [], expiresAt: Date.now() + 60_000 }),
  release: async () => true,
}) as unknown as DeletionBarrierPort;
const minioStub = { delete: vi.fn(async () => undefined) };

/** 服务直构：限额 stub=免费档常量（TeamSubscriptionService 三依赖不深构——限值单源在 getLimits，
 *  配额门算式（usage+ΣACTIVE+incoming≤limit）走真 PG）。 */
const FREE_LIMIT = TEAM_FREE_STORAGE_LIMIT_BYTES;
const quota = new StorageQuotaService(
  prismaService, {} as never,
  { getLimits: async () => ({ seatLimit: 1, storageLimitBytes: FREE_LIMIT }) } as never,
);
const service = new MaterialService(prismaService, {} as never, { add: vi.fn() } as never, quota);

const seed = (teamId: string, over: Record<string, unknown> = {}) =>
  prisma.media.create({
    data: {
      userId: UID, teamId, key: `restore/${randomUUID().slice(0, 8)}`,
      originalName: 'a.mp4', mimeType: 'video/mp4', size: 100, type: 'generated', status: 'completed', ...over,
    },
  });

maybe('素材恢复事务（真 PG——spec §1.2/§1.3）', () => {
  beforeAll(async () => {
    for (const uid of [UID, OUTSIDER]) {
      await prisma.user.upsert({
        where: { id: uid },
        create: { id: uid, name: `int-restore-${uid.slice(0, 12)}`, email: `${uid}@test.local`, emailVerified: false },
        update: {},
      });
    }
    TID = (await prisma.team.create({ data: { name: 'int-restore-default', ownerId: UID, isDefault: true } })).id;
    TID_Q = (await prisma.team.create({ data: { name: 'int-restore-quota', ownerId: UID, isDefault: false } })).id;
    TID_S = (await prisma.team.create({ data: { name: 'int-restore-sample', ownerId: UID, isDefault: false } })).id;
    TID_OTHER = (await prisma.team.create({ data: { name: 'int-restore-other', ownerId: UID, isDefault: false } })).id;
    for (const tid of [TID, TID_Q, TID_S]) {
      await prisma.teamMember.create({ data: { teamId: tid, userId: UID, role: 'OWNER' } });
    }
  }, 30_000);

  afterAll(async () => {
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID, TID_Q, TID_S, TID_OTHER]);
    await prisma.user.deleteMany({ where: { id: { in: [UID, OUTSIDER] } } });
    await prisma.$disconnect();
    await prismaService.$disconnect().catch(() => undefined);
  }, 30_000);

  it('①plain happy：软删行恢复（deletedAt 置空+审计列留痕+folderId 不动）；重复 id 幂等 count 1', async () => {
    const folder = await prisma.materialFolder.create({ data: { name: 'f-restore', userId: UID, teamId: TID } });
    // 预置「上次 GC 尝试」审计痕迹——恢复不得擦除（spec §1.1 审计列不动）
    const m = await seed(TID, {
      deletedAt: new Date(), folderId: folder.id,
      deletionRunId: 'prior-gc-run', deletionReason: 'media-gc', deletionRequestedAt: new Date(Date.now() - 3600_000),
    });
    const count = await service.restoreFiles(UID, [m.id, m.id]);   // 不传 teamId=默认团队路径（TID 全文件唯一 isDefault）
    expect(count).toBe(1);
    const row = await prisma.media.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.deletedAt).toBeNull();
    expect(row.deletionState).toBe('ACTIVE');
    expect(row.deletionRunId).toBe('prior-gc-run');                // 审计列留痕
    expect(row.folderId).toBe(folder.id);                          // folderId 不动
  }, 30_000);

  it('②DELETING 后腿+GC lost（原 runId 直调删除序——防假绿㊚）', async () => {
    const m = await seed(TID, { deletedAt: new Date() });
    const runId = `lost-${randomUUID().slice(0, 8)}`;
    expect([...await claimMediaForDeletion(prisma as never, [m.id], { runId, reason: 'media-gc' })]).toEqual([m.id]);
    const count = await service.restoreFiles(UID, [m.id], TID);
    expect(count).toBe(1);
    const row = await prisma.media.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.deletionState).toBe('ACTIVE');                      // 后腿拉回（spec §1.3 GC claim 先提交档）
    expect(row.deletedAt).toBeNull();
    // GC 删除事务 FOR UPDATE 所有权门失守——恢复后 deletedAt 已空，sweep 候选读不到这行，只能直调
    const gc = new MediaGcService(prismaService, minioStub as never, okBarrier());
    const outcome = await (gc as unknown as {
      executeDeletionSequence: (c: { id: string; teamId: string }, runId: string) => Promise<string>;
    }).executeDeletionSequence({ id: m.id, teamId: TID }, runId);
    expect(outcome).toBe('lost');
    expect(await prisma.media.findUnique({ where: { id: m.id } })).toBeTruthy();   // 行仍在
    expect(minioStub.delete).not.toHaveBeenCalled();               // 失守即中止——对象未删
  }, 30_000);

  it('③配额超限整批回滚（防假绿㊞）：当即拒绝+deletedAt 仍在+<1s', async () => {
    await seed(TID_Q, { size: FREE_LIMIT + 1 });                   // live completed 行顶满 usage（>免费档限额）
    const soft = await seed(TID_Q, { deletedAt: new Date() });
    const t0 = Date.now();
    await expect(service.restoreFiles(UID, [soft.id], TID_Q)).rejects.toThrow(BadRequestException);
    expect(Date.now() - t0).toBeLessThan(1_000);                   // 当即拒绝=没进退避重试
    expect((await prisma.media.findUniqueOrThrow({ where: { id: soft.id } })).deletedAt).not.toBeNull();
  }, 30_000);

  it('④incoming=0 已超限团队放行：pending 行恢复不计费不入门', async () => {
    // TID_Q 已超限（③的 6GiB live 行仍在）——pending 行恢复后不入 usage（getUsage 同口径）
    const pending = await seed(TID_Q, { status: 'pending', deletedAt: new Date() });
    expect(await service.restoreFiles(UID, [pending.id], TID_Q)).toBe(1);
    expect((await prisma.media.findUniqueOrThrow({ where: { id: pending.id } })).deletedAt).toBeNull();
  }, 30_000);

  it('⑤跨团队 DELETING 行不被拉回（开工契约②——他队行必须 DELETING+软删才是真证）', async () => {
    const mine = await seed(TID, { deletedAt: new Date() });
    const theirs = await seed(TID_OTHER, { deletedAt: new Date() });
    expect([...await claimMediaForDeletion(prisma as never, [theirs.id], { runId: `xt-${randomUUID().slice(0, 8)}`, reason: 'media-gc' })]).toEqual([theirs.id]);
    const live = await seed(TID);                                  // 本队未软删 id（同批钉 count）
    expect(await service.restoreFiles(UID, [mine.id, theirs.id, live.id], TID)).toBe(1);
    const row = await prisma.media.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(row.deletionState).toBe('DELETING');                    // 原语只收锁内候选——他队行未被拉回 ACTIVE
    expect(row.deletedAt).not.toBeNull();
  }, 30_000);

  it('⑥单条不存在：未软删/不存在均「文件不存在」（先于配额判）', async () => {
    const notSoft = await seed(TID);
    await expect(service.restoreFile(UID, notSoft.id, TID)).rejects.toThrow('文件不存在');
    await expect(service.restoreFile(UID, 'no-such-id', TID)).rejects.toThrow('文件不存在');
  }, 30_000);

  it('⑦空批两档：成员→0（不进事务）；非成员→403 形态（鉴权先于短路）', async () => {
    await expect(service.restoreFiles(UID, [], TID)).resolves.toBe(0);
    await expect(service.restoreFiles(OUTSIDER, [], TID)).rejects.toThrow();
  }, 30_000);

  it('⑧Team 锁不被占住（防假绿㊝）：A 握媒体行 600ms，恢复 pending，会话 C 400ms 采样零 55P03', async () => {
    const m = await seed(TID_S, { deletedAt: new Date() });
    const clientA = new PrismaClient();
    const clientC = new PrismaClient();
    try {
      const aDone = clientA.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Media" WHERE "id" = ${m.id}::text FOR UPDATE`;
        await new Promise((r) => setTimeout(r, 600));              // 只握这一行媒体（不锁 Team 行）
      });
      await new Promise((r) => setTimeout(r, 30));                 // A 先握紧
      const restorePromise = service.restoreFiles(UID, [m.id], TID_S);   // NOWAIT 失败→事务外退避（pending）
      const t0 = Date.now();
      let lockErrors = 0;
      while (Date.now() - t0 < 400) {
        try {
          await clientC.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '50ms'`;
            await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${TID_S}::text FOR UPDATE`;
          });
        } catch (e) {
          if (isRestoreLockUnavailable(e)) lockErrors += 1; else throw e;
        }
      }
      expect(lockErrors).toBe(0);                                  // Team 锁只在毫秒级临界区被持有
      await aDone;
      await expect(restorePromise).resolves.toBe(1);               // A 放开后恢复收敛
    } finally {
      await clientA.$disconnect();
      await clientC.$disconnect();
    }
  }, 15_000);
});
