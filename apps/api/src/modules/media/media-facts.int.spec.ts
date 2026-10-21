// apps/api/src/modules/media/media-facts.int.spec.ts —— Y1a+Y1b T16（spec :45 P1/:91 Z18''④+T15 交接面：
// 「projected 后 facts 端点可达」）：POST /api/media/facts 真 PG 红绿——
//   ①按 mediaId 集返回事实流（factVersion wire=string——BigInt JSON 纪律；payload 透传）；
//   ②团队 ACL 单门（他队 mediaId 静默不返——Media.teamId 锚，batch 端点同口径）；
//   ③≤200 上界（超限 400）；④pending 行读后标 published+publishedAt（at-least-once：读不删行，
//   retention 7d 归 intent-reconcile；重拉可重复消费——客户端 factVersion 幂等去重）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaFactsController, MEDIA_FACTS_MAX_IDS } from './media-facts.controller';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();

const UID = `int-t16f-owner-${Date.now()}`;
let TID = '';
let OTHER_TID = '';

(hasDb ? describe : describe.skip)('Y1b T16：POST /api/media/facts（真 PG）', () => {
  let ctrl: MediaFactsController;
  let M_OWN: string;
  let M_OTHER: string;
  const PID = `int-t16f-${Date.now()}`;

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'int-t16f', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    TID = (await prisma.team.create({ data: { name: 'int-t16f-team', ownerId: UID } })).id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    OTHER_TID = (await prisma.team.create({ data: { name: 'int-t16f-other', ownerId: UID } })).id;
    await prisma.teamMember.create({ data: { teamId: OTHER_TID, userId: UID, role: 'OWNER' } });
    M_OWN = (await prisma.media.create({
      data: { userId: UID, teamId: TID, key: `int-t16f/own-${randomUUID().slice(0, 8)}`, originalName: 'a.mp4', mimeType: 'video/mp4', size: 1, type: 'generated', status: 'completed' },
    })).id;
    M_OTHER = (await prisma.media.create({
      data: { userId: UID, teamId: OTHER_TID, key: `int-t16f/other-${randomUUID().slice(0, 8)}`, originalName: 'b.mp4', mimeType: 'video/mp4', size: 1, type: 'generated', status: 'completed' },
    })).id;
    await prisma.mediaFactOutbox.createMany({
      data: [
        { mediaId: M_OWN, projectId: PID, factVersion: 0n, factType: 'state', payload: { status: 'processing' } },
        { mediaId: M_OWN, projectId: PID, factVersion: 1n, factType: 'state', payload: { status: 'completed' } },
        { mediaId: M_OTHER, projectId: PID, factVersion: 0n, factType: 'state', payload: { status: 'processing' } },
      ],
    });
    ctrl = new MediaFactsController(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma.mediaFactOutbox.deleteMany({ where: { projectId: PID } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID, OTHER_TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  });

  it('①按 mediaId 返回事实流（factVersion=string 升序；payload 透传）', async () => {
    const rows = await ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [M_OWN] });
    expect(rows).toHaveLength(1);
    expect(rows[0].mediaId).toBe(M_OWN);
    expect(rows[0].facts.map((f) => f.factVersion)).toEqual(['0', '1']);
    expect(rows[0].facts[1].payload).toEqual({ status: 'completed' });
  });

  it('②团队 ACL：他队 mediaId 静默不返（Media.teamId 锚）', async () => {
    const rows = await ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [M_OWN, M_OTHER] });
    expect(rows.map((r) => r.mediaId)).toEqual([M_OWN]);
  });

  it('④pending 读后标 published+publishedAt（at-least-once：读不删行，重拉仍可得）', async () => {
    // 前序用例已读过（published）——复位 pending 再验标记转换
    await prisma.mediaFactOutbox.updateMany({
      where: { mediaId: M_OWN },
      data: { state: 'pending', publishedAt: null },
    });
    const before = await prisma.mediaFactOutbox.findMany({ where: { mediaId: M_OWN } });
    expect(before.every((r) => r.state === 'pending')).toBe(true);
    await ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [M_OWN] });
    const after = await prisma.mediaFactOutbox.findMany({ where: { mediaId: M_OWN } });
    expect(after.every((r) => r.state === 'published' && r.publishedAt !== null)).toBe(true);
    // 重拉（published 行保留窗内可重复消费——客户端 factVersion 幂等去重）
    const again = await ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [M_OWN] });
    expect(again[0].facts).toHaveLength(2);
  });

  it('③超 200 拒 400；空数组合法空返；坏 body 拒 400', async () => {
    const ids = Array.from({ length: MEDIA_FACTS_MAX_IDS + 1 }, (_, i) => `m-${i}`);
    await expect(ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: ids }))
      .rejects.toMatchObject({ status: 400 });
    await expect(ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [] })).resolves.toEqual([]);
    await expect(ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: 'x' as never }))
      .rejects.toMatchObject({ status: 400 });
  });
});
