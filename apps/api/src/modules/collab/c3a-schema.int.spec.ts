// apps/api/src/modules/collab/c3a-schema.int.spec.ts —— C3a-2（地基修复批·C3a 卡）schema additive
// 行为钉（spec 2026-11-11-foundation-batch-design.md §0 水位不变量/§3.2-6）：
//   ① CanvasDoc.{mediaBindingSeq,bindingsDirty} 新列默认——新建行走 schema 默认（0n/false），迁移内
//      `UPDATE "CanvasDoc" SET "bindingsDirty"=true` 只改既有行（既有项目全置 dirty——修 0==0 假覆盖，
//      第七轮 P0-5）：文件级钉「ADD COLUMN 形态的迁移必同文件带回填」+匹配数兜底（0 匹配即红——
//      C1 终态 init 整表 CREATE TABLE 形态后本钉由 C1-1 显式改写，防静默空真）；
//   ② Media.deletionState 默认 'ACTIVE'+CHECK 拒域外值（'BOGUS'）——列本卡落位，C3b-4 才消费；
//   ③ ProjectionBackfillState 四态 CHECK+verifiedSeq BigInt（超 Number.MAX_SAFE_INTEGER——BigInt
//      读写路径）+updatedAt（@db.Timestamptz(3)——C2-1 tsz 纪律，无 @updatedAt：C1 触发器前显式写）；
//   ④ 无 FK 钉（spec §0 原文「projectId @id」=独立状态行，不挂 CanvasProject 关系）+registry 入册
//      （scope-column.registry PROJECT_COLUMN_MODELS——门㊲ schema 闭包+erasure 批删收编）。
// 红态=迁移前模型/列不存在（编译级红，C2-1 先例）；无 DATABASE_URL（CI 未起库）自动 skip。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ensureProjectFixture, cleanupProjectFixture, FIXTURE_TEAM, FIXTURE_USER } from '../../test-utils/db-fixtures';
import { PROJECT_COLUMN_MODELS } from './scope-column.registry';

const hasDb = !!process.env.DATABASE_URL;

const PID = 'c3a2-schema-int';
const prisma = new PrismaClient();
const MEDIA_ID = `it-c3a2-media-${Date.now()}`;

const MIG_DIR = join(__dirname, '../../../prisma/migrations');

(hasDb ? describe : describe.skip)('C3a-2：schema additive（真 PG）', () => {
  beforeAll(async () => {
    await ensureProjectFixture(prisma, PID, 'c3a2-schema');
    await prisma.media.create({
      data: {
        id: MEDIA_ID, userId: FIXTURE_USER, teamId: FIXTURE_TEAM,
        key: `uploads/${FIXTURE_USER}/c3a2/${Date.now()}.png`,
        originalName: 'a.png', mimeType: 'image/png', size: 100n, type: 'uploaded',
      },
    });
  }, 20_000);

  afterAll(async () => {
    await prisma.projectionBackfillState.deleteMany({ where: { projectId: PID } });
    await prisma.media.deleteMany({ where: { id: MEDIA_ID } });
    await cleanupProjectFixture(prisma, PID);
    await prisma.$disconnect();
  }, 20_000);

  it('① CanvasDoc 新列：新建行 schema 默认（mediaBindingSeq=0n ∧ bindingsDirty=false）+迁移回填语句同文件钉', async () => {
    await prisma.canvasDoc.create({ data: { projectId: PID, generation: 0, schemaVersion: 3 } });
    const doc = await prisma.canvasDoc.findUniqueOrThrow({ where: { projectId: PID } });
    expect(doc.mediaBindingSeq).toBe(0n);
    expect(doc.bindingsDirty).toBe(false); // schema 默认如实——迁移 UPDATE 只改既有行（回填≠新行默认）

    // 迁移回填钉：给既有表 ADD COLUMN "bindingsDirty" 的迁移文件必含全量置 dirty（既有项目≠假覆盖绿）。
    // 空白容忍正则+匹配数兜底（死断言根修）：prisma 生成物 ADD COLUMN 与列名间为多空格（实测 5 格），
    // 单空格 includes 恒 0 匹配→for 零迭代=恒绿假覆盖；兜底钉 ADD COLUMN 时代真匹配≥1——0 即红
    // （正则/迁移失守），C1 终态 init 整表 CREATE TABLE 形态后本钉由 C1-1 显式改写（届时回填已在
    // 生产应用完成——防静默空真）。
    const sqlOf = (d: string) => readFileSync(join(MIG_DIR, d, 'migration.sql'), 'utf8');
    const adders = readdirSync(MIG_DIR).filter((d) => /^\d+_/.test(d))
      .filter((d) => /ADD COLUMN\s+"bindingsDirty"/.test(sqlOf(d)));
    expect(adders.length, 'ADD COLUMN 形态迁移须在场（C1 init 整表形态前；0=正则/迁移失守）').toBeGreaterThan(0);
    for (const d of adders) {
      expect(
        sqlOf(d).replace(/--[^\n]*/g, '').includes('UPDATE "CanvasDoc" SET "bindingsDirty" = true'),
        `${d} 加列必带回填`,
      ).toBe(true);
    }
  });

  it('② Media.deletionState：默认 ACTIVE；DELETING 可写；域外值 CHECK 拒', async () => {
    const m = await prisma.media.findUniqueOrThrow({ where: { id: MEDIA_ID } });
    expect(m.deletionState).toBe('ACTIVE');
    await prisma.media.update({ where: { id: MEDIA_ID }, data: { deletionState: 'DELETING' } });
    expect((await prisma.media.findUniqueOrThrow({ where: { id: MEDIA_ID } })).deletionState).toBe('DELETING');
    await expect(
      prisma.media.update({ where: { id: MEDIA_ID }, data: { deletionState: 'BOGUS' } }),
    ).rejects.toThrowError(/Media_deletionState_check/);
  });

  it('③ ProjectionBackfillState：四态全过+域外拒+verifiedSeq BigInt（>2^53）+updatedAt 显式写读回', async () => {
    const sentAt = new Date();
    const beyondSafe = 9_007_199_254_740_993n; // 2^53+1——超 Number.MAX_SAFE_INTEGER，钉 BigInt 路径
    await prisma.projectionBackfillState.create({
      data: { projectId: PID, backfillEpoch: 'e0', state: 'PENDING', verifiedSeq: 0n, updatedAt: sentAt },
    });
    for (const s of ['RUNNING', 'DONE', 'FAILED'] as const) {
      await prisma.projectionBackfillState.update({ where: { projectId: PID }, data: { state: s, verifiedSeq: beyondSafe } });
    }
    const row = await prisma.projectionBackfillState.findUniqueOrThrow({ where: { projectId: PID } });
    expect(row.state).toBe('FAILED');
    expect(row.verifiedSeq).toBe(beyondSafe);
    expect(Math.abs(row.updatedAt.getTime() - sentAt.getTime())).toBeLessThanOrEqual(1); // 显式写读回 sanity——tz 判别钉在 C2-1 roundtrip spec（本断言无 naive/tsz 判别力）
    await expect(
      prisma.projectionBackfillState.update({ where: { projectId: PID }, data: { state: 'BOGUS' } }),
    ).rejects.toThrowError(/ProjectionBackfillState_state_check/);
  });

  it('④ 无 FK 钉（spec §0「projectId @id」独立状态行）+registry 入册（门㊲——erasure 批删收编）', async () => {
    const fks = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_constraint
      WHERE conrelid = '"ProjectionBackfillState"'::regclass AND contype = 'f'`;
    expect(fks[0].n).toBe(0n); // 零外键——项目删除清行由 registry 批删承载，无 Cascade 耦合
    expect(PROJECT_COLUMN_MODELS).toContain('ProjectionBackfillState');
  });
});
