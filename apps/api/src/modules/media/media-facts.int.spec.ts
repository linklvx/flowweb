// apps/api/src/modules/media/media-facts.int.spec.ts —— Y1a+Y1b T16（spec :45 P1/:91 Z18''④+T15 交接面：
// 「projected 后 facts 端点可达」）：POST /api/media/facts 真 PG 红绿——C2-3 改道 MediaFact 当前态
// 读道（旧 outbox 种子/pending→published 标记面随读道退役归 C2-4）：
//   ①按 mediaId 集返回当前态行（归一：state 前 natural 后+版本归一到 max；factVersion wire=string）；
//   ②团队 ACL 单门（他队 mediaId 静默不返——Media.teamId 锚，batch 端点同口径）；
//   ③软删过滤（deletedAt:null——软删 media 的 facts 不出）；
//   ④无 state 行的 media 自 Media.status 合成 state 行（历史/边缘媒体——spec §3.1-3）；
//   ⑤≤200 上界（超限 400）；空数组合法空返；坏 body 拒 400。
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

(hasDb ? describe : describe.skip)('C2-3：POST /api/media/facts（真 PG——MediaFact 当前态读道）', () => {
  let ctrl: MediaFactsController;
  let M_OWN: string;
  let M_OTHER: string;
  let M_NAT: string;
  let M_SOFT: string;

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
    const now = new Date();
    const makeMedia = async (teamId: string, over: Record<string, unknown> = {}) =>
      (await prisma.media.create({
        data: { userId: UID, teamId, key: `int-t16f/${randomUUID().slice(0, 8)}`, originalName: 'a.mp4', mimeType: 'video/mp4', size: 1, type: 'generated', status: 'completed', ...over },
      })).id;
    // state v2+natural v1（版本错位——归一到 max '2'）
    M_OWN = await makeMedia(TID, { factVersion: 2n });
    await prisma.mediaFact.createMany({
      data: [
        { mediaId: M_OWN, factType: 'state', factVersion: 2n, payload: { status: 'completed' }, updatedAt: now },
        { mediaId: M_OWN, factType: 'natural', factVersion: 1n, payload: { naturalWidth: 640, naturalHeight: 480 }, updatedAt: now },
      ],
    });
    M_OTHER = await makeMedia(OTHER_TID, { factVersion: 1n });
    await prisma.mediaFact.create({
      data: { mediaId: M_OTHER, factType: 'state', factVersion: 1n, payload: { status: 'completed' }, updatedAt: now },
    });
    // 纯 natural（无 state 行——端点合成面）
    M_NAT = await makeMedia(TID, { factVersion: 1n });
    await prisma.mediaFact.create({
      data: { mediaId: M_NAT, factType: 'natural', factVersion: 1n, payload: { naturalWidth: 1280, naturalHeight: 720 }, updatedAt: now },
    });
    // 软删（facts 在行但 deletedAt 置位——过滤面）
    M_SOFT = await makeMedia(TID, { factVersion: 1n, deletedAt: now });
    await prisma.mediaFact.create({
      data: { mediaId: M_SOFT, factType: 'state', factVersion: 1n, payload: { status: 'completed' }, updatedAt: now },
    });
    ctrl = new MediaFactsController(prisma as unknown as PrismaService);
  }, 20_000);

  afterAll(async () => {
    await prisma.mediaFact.deleteMany({ where: { mediaId: { in: [M_OWN, M_OTHER, M_NAT, M_SOFT].filter(Boolean) } } });
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID, OTHER_TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('①按 mediaId 返回当前态行：state 前 natural 后+版本归一到 max（payload 透传；factVersion=string）', async () => {
    const rows = await ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [M_OWN] });
    expect(rows).toEqual([
      { mediaId: M_OWN, facts: [
        { factVersion: '2', factType: 'state', payload: { status: 'completed' } },
        { factVersion: '2', factType: 'natural', payload: { naturalWidth: 640, naturalHeight: 480 } },
      ] },
    ]);
  });

  it('②团队 ACL：他队 mediaId（含 fact 行）静默不返（Media.teamId 锚）', async () => {
    const rows = await ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [M_OWN, M_OTHER] });
    expect(rows.map((r) => r.mediaId)).toEqual([M_OWN]);
  });

  it('③软删过滤：deletedAt 置位 media 的 facts 不出（deletedAt:null 判据）', async () => {
    const rows = await ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [M_SOFT, M_OWN] });
    expect(rows.map((r) => r.mediaId)).toEqual([M_OWN]);
  });

  it('④无 state 行→Media.status 合成 state 行（版本=归一值——历史/边缘媒体不丢状态）', async () => {
    const rows = await ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [M_NAT] });
    expect(rows).toEqual([
      { mediaId: M_NAT, facts: [
        { factVersion: '1', factType: 'state', payload: { status: 'completed' } },   // 合成（Media.status=completed 直传）
        { factVersion: '1', factType: 'natural', payload: { naturalWidth: 1280, naturalHeight: 720 } },
      ] },
    ]);
  });

  it('⑤超 200 拒 400；空数组合法空返；坏 body 拒 400', async () => {
    const ids = Array.from({ length: MEDIA_FACTS_MAX_IDS + 1 }, (_, i) => `m-${i}`);
    await expect(ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: ids }))
      .rejects.toMatchObject({ status: 400 });
    await expect(ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: [] })).resolves.toEqual([]);
    await expect(ctrl.facts({ user: { id: UID } } as never, TID, { mediaIds: 'x' as never }))
      .rejects.toMatchObject({ status: 400 });
  });
});
