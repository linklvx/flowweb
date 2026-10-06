#!/usr/bin/env node
// 订阅域关键索引/约束存在性断言 runner（文档治理批 1 Task 3-4 方案 a）。
// 定死 node+pg 唯一形态：psql 不在 PATH 且 $DATABASE_URL 在 Windows npm script 不展开；
// 且 psql 空结果集退出码 0 恰是假绿机制——本 runner 断言每块 ≥1 行。
// 运行时机：上线前/订阅迁移后（docs/README.md 运维节）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

function findRepoRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('findRepoRoot: 6 层内未找到 pnpm-workspace.yaml');
}
const ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
// pg 是 apps/api 的依赖（根 scripts/ 解析不到包级 node_modules）——createRequire 锚定 api 包解析
const { Client } = createRequire(path.join(ROOT, 'apps/api/package.json'))('pg');

// DATABASE_URL 解析序：env > apps/api/.env（prisma 同源）
let url = process.env.DATABASE_URL;
if (!url) {
  const envPath = path.join(ROOT, 'apps/api/.env');
  if (!fs.existsSync(envPath)) throw new Error('DATABASE_URL 未设置且 apps/api/.env 不存在');
  const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('apps/api/.env 中无 DATABASE_URL');
  url = m[1];
}

const sqlPath = path.join(ROOT, 'apps/api/prisma/verify-indexes.sql');
const raw = fs.readFileSync(sqlPath, 'utf8');
// 语句块切分：按空行分段→段内剥注释行→余非空即语句块（与文件"注释头+语句"的块结构一一对应）
const blocks = raw
  .split(/\r?\n\s*\r?\n/)
  .map((b) => b.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join('\n').trim())
  .filter(Boolean);
if (blocks.length < 2) {
  console.error(`verify-indexes: 语句块仅 ${blocks.length}（解析失败或文件退化）`);
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();
let failed = 0;
let blockNo = 0;
for (const b of blocks) {
  blockNo++;
  let res;
  try {
    res = await client.query(b);
  } catch (e) {
    failed++;
    console.error(`[块 ${blockNo}] SQL 错误: ${e.message}——SQL: ${b.replace(/\s+/g, ' ').slice(0, 90)}…`);
    continue;
  }
  const names = res.rows.map((r) => r.indexname ?? r.conname ?? JSON.stringify(r)).join(', ');
  if (res.rowCount === 0) {
    failed++;
    console.error(`[块 ${blockNo}] 空（索引/约束不存在）——SQL: ${b.replace(/\s+/g, ' ').slice(0, 90)}…`);
  } else {
    console.log(`[块 ${blockNo}] ${res.rowCount} 行: ${names}`);
  }
}
await client.end();
if (failed > 0) {
  console.error(`verify-indexes: ${failed}/${blocks.length} 块断言失败`);
  process.exit(1);
}
console.log(`verify-indexes: PASS（${blocks.length} 块全 ≥1 行）`);
