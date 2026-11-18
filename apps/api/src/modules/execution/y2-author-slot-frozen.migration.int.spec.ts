// apps/api/src/modules/execution/y2-author-slot-frozen.migration.int.spec.ts
// Y2 B1（spec §D8/裁决 16/v6 段序）：冻结两列迁移结构断言——
//   ①迁移 SQL 五段序钉死：DELETE 先行（RefundObligation→悬空 plan→置空 Media 锚列→非终态 GenerationIntent
//     整删）→ADD COLUMN（frozen/authorMediaId 可空+released NOT NULL DEFAULT false）→终态行+余留 plan 行
//     回填（frozen=true/authorMediaId=null/released=true）→SET NOT NULL 仅 frozen 两表→部分索引
//     GenerationIntent_release_pending_idx（四标量谓词）。v6 重排根因=「②回填先于④加列」语句级报错+
//     宽/窄两读皆死——段序是本迁移的唯一正确性载体，文本锚锁死。
//   ②真库结构：三列类型/可空性/默认+部分索引在场（pg_indexes 谓词文本）。
//   数据态验收（非终态=0/悬空 plan=0/终态 frozen∧released=true——不锚行数）=一次性迁移验收：
//   fresh replay（空库出生即终态）+真实 dev 库人工双验留痕 ledger——不入常驻断言（新 claim 会再造
//   RUNNING 行使「非终态=0」恒假——migration-time 性质非持久不变量）。
// 红态=迁移目录不存在（Step 2 落 migration 后转绿）；无 DATABASE_URL（CI 未起库）自动 skip。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

const hasDb = !!process.env.DATABASE_URL;
const prisma = new PrismaClient();
const MIG_DIR = join(__dirname, '../../../prisma/migrations');

const migDirs = readdirSync(MIG_DIR).filter((d) => /^\d+_y2_author_slot_frozen$/.test(d));

(migDirs.length === 1 ? describe : describe.skip)('Y2 B1：冻结两列迁移结构（真 PG）', () => {
  it('① 五段序文本锚：DELETE 先行→ADD COLUMN→终态回填→SET NOT NULL 仅 frozen→部分索引四标量谓词', () => {
    expect(migDirs, '迁移目录恰一（<ts>_y2_author_slot_frozen）').toHaveLength(1);
    // 去注释后按语句切序（段序=正确性载体——v6 重排根因在序不在词）；空白归一（PG 书写自由度免疫）
    const sql = readFileSync(join(MIG_DIR, migDirs[0]!, 'migration.sql'), 'utf8').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
    const pos = {
      delRefund: sql.indexOf('DELETE FROM "RefundObligation"'),
      delPlan: sql.indexOf('DELETE FROM "ExecutionNodePlan"'),
      delIntent: sql.indexOf('DELETE FROM "GenerationIntent"'),
      addCol: sql.indexOf('ADD COLUMN "authorSlotFrozen"'),
      backfill: sql.indexOf('UPDATE "GenerationIntent"'),
      setNotNull: sql.indexOf('SET NOT NULL'),
      partialIdx: sql.indexOf('GenerationIntent_release_pending_idx'),
    };
    for (const [k, v] of Object.entries(pos)) expect(v, `${k} 段在场`).toBeGreaterThan(-1);
    // 段序：DELETE 族（锚列置空/悬空 plan/非终态意图）全在 ADD COLUMN 之前；回填在加列后；SET NOT NULL 在回填后；索引最后
    expect(Math.max(pos.delRefund, pos.delPlan, pos.delIntent)).toBeLessThan(pos.addCol);
    expect(pos.addCol).toBeLessThan(pos.backfill);
    expect(pos.backfill).toBeLessThan(pos.setNotNull);
    expect(pos.setNotNull).toBeLessThan(pos.partialIdx);
    // released 直加 NOT NULL DEFAULT false（②段——无回填依赖）；frozen 裸加可空（④段才 NOT NULL）
    expect(sql).toMatch(/ADD COLUMN "authorSlotReleased" BOOLEAN NOT NULL DEFAULT false/);
    expect(sql).toMatch(/ADD COLUMN "authorSlotFrozen" BOOLEAN/);
    expect(sql).toMatch(/ADD COLUMN "authorMediaId" TEXT/);
    // 部分索引四标量谓词（text 永不释放死行不进索引——migration-SQL-only 先例；空白归一后匹配）
    expect(sql).toMatch(/WHERE "status" = 'SUCCEEDED' AND "authorSlotFrozen" AND NOT "authorSlotReleased" AND "kind" IN \('video', 'image', 'outpaint', 'erase', 'redraw', 'lighting'\)/);
    // TeamCreditTransaction 不动
    expect(sql).not.toMatch(/TeamCreditTransaction/);
  });

  it('② 真库三列形态+部分索引在场（pg_indexes 谓词）', async () => {
    const cols = await prisma.$queryRaw<{ column_name: string; is_nullable: string; data_type: string; column_default: string | null }[]>`
      SELECT column_name, is_nullable, data_type, column_default FROM information_schema.columns
      WHERE table_name = 'GenerationIntent' AND column_name IN ('authorSlotFrozen','authorMediaId','authorSlotReleased')`;
    const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    expect(by.authorSlotFrozen?.is_nullable).toBe('NO');        // ④段 SET NOT NULL（回填覆盖全部余行后）
    expect(by.authorSlotFrozen?.data_type).toBe('boolean');
    expect(by.authorMediaId?.is_nullable).toBe('YES');
    expect(by.authorSlotReleased?.is_nullable).toBe('NO');
    expect(by.authorSlotReleased?.column_default).toBe('false');
    const planCols = await prisma.$queryRaw<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'ExecutionNodePlan' AND column_name IN ('authorSlotFrozen','authorMediaId')`;
    const planBy = Object.fromEntries(planCols.map((c) => [c.column_name, c]));
    expect(planBy.authorSlotFrozen?.is_nullable).toBe('NO');    // plan 表两列同款（无 released——裁决 16）
    expect(planBy.authorMediaId?.is_nullable).toBe('YES');
    const idx = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'GenerationIntent_release_pending_idx'`;
    expect(idx).toHaveLength(1);
    expect(idx[0]!.indexdef).toContain('USING btree ("completedAt")');   // PG 归一形态（public. 前缀+USING btree）
    expect(idx[0]!.indexdef).toContain("status = 'SUCCEEDED'");          // 四标量谓词全在场
    expect(idx[0]!.indexdef).toContain('"authorSlotFrozen"');
    expect(idx[0]!.indexdef).toContain('(NOT "authorSlotReleased")');
    expect(idx[0]!.indexdef).toContain('kind = ANY');                     // text 永不释放死行不进索引
  });

  afterAll(async () => { await prisma.$disconnect(); });
});
