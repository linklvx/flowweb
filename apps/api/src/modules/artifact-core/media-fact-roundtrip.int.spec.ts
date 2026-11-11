// apps/api/src/modules/artifact-core/media-fact-roundtrip.int.spec.ts —— C2-1（地基修复批·C2 卡）
// MediaFact 当前态表 timestamptz round-trip 行为钉（spec 2026-11-11-foundation-batch-design.md §3.1）。
// 背景：本仓既有 ~167 个 DateTime 列为 naive timestamp(3)（@default(now())=DB 会话墙 vs Prisma Date=UTC 墙
// 的时间墙混用——C1 卡终态 rebaseline）；MediaFact 作为新表自第一天即 @db.Timestamptz(3)，本测试钉死
// instant 语义（Date 参数绑定写入——批序纪律「C2/C3a 开发期时间写法=Date 参数绑定」）。
// 防回归锚：Asia/Shanghai（+8）会话下用独立 pg Client（独占连接非 Prisma 池——SET TIME ZONE 在连接池
// 不可靠）读回。naive 列在 +8 会话被 pg 按 +8 墙解析 → 以下两断言均出现 8h 偏斜；tsz 恒 instant：
//   ① 读回 updatedAt 的 epoch ms 与写入 Date 的 epoch ms 相等（毫秒级容差）；
//   ② 同会话 SELECT now() 与读回 updatedAt 差在秒级小窗（8h=28_800_000ms 必红）。
// 无 DATABASE_URL（CI 未起库）自动 skip；vitest 不自动加载 apps/api/.env——靠 shell export 注入。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { deleteTeamsWithPass } from '../../test-utils/intent-fixture';

const hasDb = !!process.env.DATABASE_URL;

const prisma = new PrismaClient();

const UID = `it-c21fact-owner-${Date.now()}`;
let TID = '';
let MEDIA_ID = '';

(hasDb ? describe : describe.skip)('C2-1：MediaFact timestamptz round-trip（真 PG，+8 会话独立 pg 连接）', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: UID },
      create: { id: UID, name: 'it-c21fact', email: `${UID}@test.local`, emailVerified: false },
      update: {},
    });
    const team = await prisma.team.create({ data: { name: 'it-c21fact', ownerId: UID } });
    TID = team.id;
    await prisma.teamMember.create({ data: { teamId: TID, userId: UID, role: 'OWNER' } });
    const media = await prisma.media.create({
      data: {
        userId: UID, teamId: TID, key: `uploads/${UID}/it/${Date.now()}.png`,
        originalName: 'a.png', mimeType: 'image/png', size: 100n, type: 'uploaded',
      },
    });
    MEDIA_ID = media.id;
  }, 20_000);

  afterAll(async () => {
    // MediaFact 经 media FK Cascade 随 team→media 级联链全清
    await deleteTeamsWithPass(prisma as unknown as PrismaService, [TID]);
    await prisma.user.deleteMany({ where: { id: UID } });
    await prisma.$disconnect();
  }, 20_000);

  it('+8 会话读回：updatedAt instant 与写入 Date 相等（ms 容差）∧ 与同会话 now() 差秒级（无 8h 偏斜）', async () => {
    const sentAt = new Date(); // Date 参数绑定——显式 updatedAt（非 @updatedAt/@default 托管）
    await prisma.mediaFact.create({
      data: {
        mediaId: MEDIA_ID, factType: 'state', factVersion: 1n,
        payload: { status: 'processing' }, updatedAt: sentAt,
      },
    });

    // 独占 pg 连接切 +8 会话再读——naive 列此读法暴露 8h 偏斜，tsz 恒 instant（本测试的判别面）
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    try {
      await pg.query(`SET TIME ZONE 'Asia/Shanghai'`);
      const { rows } = await pg.query<{ updatedAt: Date; n: Date }>(
        `SELECT "updatedAt", now() AS n FROM "MediaFact" WHERE "mediaId" = $1 AND "factType" = 'state'`,
        [MEDIA_ID],
      );
      expect(rows).toHaveLength(1);
      const backMs = rows[0].updatedAt.getTime();
      expect(Math.abs(backMs - sentAt.getTime())).toBeLessThanOrEqual(1); // ① instant round-trip（毫秒级容差）
      expect(Math.abs(rows[0].n.getTime() - backMs)).toBeLessThan(60_000); // ② 同会话 now() 邻近（8h 必红）
    } finally {
      await pg.end();
    }
  });
});
