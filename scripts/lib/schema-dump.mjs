// scripts/lib/schema-dump.mjs —— Y0b-5 T12-0d：census 对象清单 dump 单源（原 dump-schema-objects.mjs
// 的 dump() 原文迁移，查询一字不改；消费=dump-schema-objects.mjs CLI + check-fresh-replay.mjs 门禁）。
// pg 是 apps/api 的依赖（根 scripts/ 解析不到包级 node_modules）——createRequire 锚定 api 包解析（verify-indexes.mjs 同款）。
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const { Client } = createRequire(path.join(ROOT, 'apps/api/package.json'))('pg');

// 全量四组：columns（is_nullable/column_default）/constraints（全部 contype 含 FK）/indexes（全集 indexdef）
// /enums（全量）+ sequences + CollabLease 行数。
export async function dump(client) {
  const q = async (sql) => (await client.query(sql)).rows;
  return {
    columns: await q(`SELECT table_name, column_name, is_nullable, data_type, column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name NOT LIKE '\\_prisma%' ORDER BY table_name, column_name`),
    constraints: await q(`SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE connamespace='public'::regnamespace AND conrelid::regclass::text NOT LIKE '\\_prisma%' ORDER BY conname`),
    indexes: await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND indexname NOT LIKE '\\_prisma%' ORDER BY indexname`),
    sequences: await q(`SELECT relname FROM pg_class WHERE relkind='S' AND relnamespace='public'::regnamespace ORDER BY relname`).then((r) => r.map((x) => x.relname)),
    enums: await q(`SELECT t.typname, ARRAY_AGG(e.enumlabel ORDER BY e.enumsortorder) AS values FROM pg_type t
      JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typnamespace='public'::regnamespace GROUP BY t.typname ORDER BY t.typname`),
    collabLeaseRows: (await q('SELECT COUNT(*)::int AS n FROM "CollabLease"'))[0].n,
  };
}
