#!/usr/bin/env node
// Y0b-1 T1a（Z2+三轮⑤）：squash census 工具。两模式：
//   node scripts/dump-schema-objects.mjs <URL>                          —— dump 指定库全量对象清单（stdout JSON）
//   node scripts/dump-schema-objects.mjs <URL> --replay-new <init.sql>  —— 建临时库 flowweb_census_new 重放 init 后 dump（stdout JSON，完毕即删临时库）
// 全量四组：columns（is_nullable/column_default）/constraints（全部 contype 含 FK）/indexes（全集 indexdef）/enums（全量）+ sequences + CollabLease 行数。
// 这是 squash 的唯一可信验收：Prisma migrate diff 不建模序列/partial WHERE/约束形态——"零差异"是假绿。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// pg 是 apps/api 的依赖（根 scripts/ 解析不到包级 node_modules）——createRequire 锚定 api 包解析（verify-indexes.mjs 同款）
const { Client } = createRequire(path.join(ROOT, 'apps/api/package.json'))('pg');

async function dump(client) {
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

const [url, mode, initPath] = [process.argv[2], process.argv[3], process.argv[4]];
if (!url || (mode === '--replay-new' && !initPath)) {
  console.error('usage: dump-schema-objects.mjs <URL> [--replay-new <init.sql>]');
  process.exit(2);
}
if (mode !== '--replay-new') {
  const c = new Client({ connectionString: url });
  await c.connect();
  console.log(JSON.stringify(await dump(c), null, 1));
  await c.end();
} else {
  // admin 连接（postgres 库）建/删临时库——CREATE DATABASE 不能在事务内，独立连接执行
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const ac = new Client({ connectionString: admin.toString() });
  await ac.connect();
  await ac.query('DROP DATABASE IF EXISTS flowweb_census_new');
  await ac.query('CREATE DATABASE flowweb_census_new');
  const nc = new Client({ connectionString: new URL(url).toString().replace(/\/[^/]*$/, '/flowweb_census_new') });
  await nc.connect();
  await nc.query(fs.readFileSync(initPath, 'utf8')); // client.query 支持多语句脚本
  console.log(JSON.stringify(await dump(nc), null, 1));
  await nc.end();
  await ac.query('DROP DATABASE flowweb_census_new');
  await ac.end();
}
