#!/usr/bin/env node
// Y0b-2 T1（Z107/Z115）：migrate diff 棘轮——prisma migrate diff --from-migrations vs schema datamodel
// 的漂移行只许收窄禁新增（金标=migrate-diff-allowlist.txt，存逐字归一化 diff 行非裸对象名）。
// 已知词汇外对象（partial WHERE/CHECK/触发器/序列）prisma diff 不建模——金标里唯一历史行=
// pricing_rule_natural_key（NULLS NOT DISTINCT 语义 Prisma 不可表达，登记为永久豁免）。
// 退出码：0=PASS；1=新增漂移行（棘轮红）；2=结构性错误（DATABASE_URL 缺失/CLI 不可解析/shadow 建库失败）。
// --update：按当前 diff 重生成 allowlist（收窄后落盘，review 后同 commit）。
// 范式照抄 check-pricing-coverage.mjs（.env 取 DATABASE_URL+pg 建删临时 shadow——本脚本 shadow 由 prisma 自清重建）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(ROOT, 'apps/api');
// pg 是 apps/api 的依赖（根 scripts/ 解析不到包级 node_modules）——createRequire 锚定 api 包解析（verify-indexes.mjs 同款）
const { Client } = createRequire(path.join(API, 'package.json'))('pg');
const prismaCli = createRequire(path.join(API, 'package.json')).resolve('prisma/build/index.js');
const ALLOWLIST = path.join(ROOT, 'apps/api/prisma/migrate-diff-allowlist.txt');
const SHADOW = 'flowweb_shadow_tmp';

/** 归一化（Z115：与 allowlist 共用单源）——剥行首缩进+collapse 空白（prisma 输出缩进不稳定）。 */
export function normalizeDiffLine(line) {
  return line.trim().replace(/\s+/g, ' ');
}

function structural(msg) { console.error(`check-migrate-diff: 结构性错误（exit 2）——${msg}`); process.exit(2); }

let url = process.env.DATABASE_URL;
if (!url) {
  const envPath = path.join(API, '.env');
  const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) structural('DATABASE_URL 未设置');
  url = m[1];
}

// shadow 库自建/自清（prisma --shadow-database-url 会清空重建 schema，但库须先存在）
const admin = new Client({ connectionString: new URL(url).toString().replace(/\/[^/]*$/, '/postgres') });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${SHADOW}`);
await admin.query(`CREATE DATABASE ${SHADOW}`);
await admin.end();
const shadowUrl = new URL(url).toString().replace(/\/[^/]*$/, `/${SHADOW}`);

// prisma CLI 经 node 直启（spawnSync('pnpm') Windows ENOENT——Y0a-4 v4 实测登记）
const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'diff',
  '--from-migrations', './prisma/migrations',
  '--to-schema-datamodel', './prisma/schema.prisma',
  '--shadow-database-url', shadowUrl,
], { cwd: API, encoding: 'utf8' });
const dropAgain = new Client({ connectionString: admin.connectionParameters.host ? new URL(url).toString().replace(/\/[^/]*$/, '/postgres') : undefined });
await dropAgain.connect();
await dropAgain.query(`DROP DATABASE IF EXISTS ${SHADOW}`);
await dropAgain.end();
if (r.status !== 0) structural(`prisma migrate diff 退出 ${r.status}: ${(r.stderr || r.stdout || '').slice(0, 400)}`);

const diffLines = r.stdout.split(/\r?\n/).map(normalizeDiffLine).filter(Boolean);
const allowSrc = fs.existsSync(ALLOWLIST) ? fs.readFileSync(ALLOWLIST, 'utf8') : '';
const allow = new Set(allowSrc.split(/\r?\n/).map(normalizeDiffLine).filter(Boolean));

if (process.argv.includes('--update')) {
  fs.writeFileSync(ALLOWLIST, diffLines.join('\n') + '\n');
  console.log(`check-migrate-diff --update: 已落盘 ${diffLines.length} 行金标（${path.relative(ROOT, ALLOWLIST)}）`);
  process.exit(0);
}

const added = diffLines.filter((l) => !allow.has(l));
const stale = [...allow].filter((l) => !diffLines.includes(l));
if (added.length) {
  console.error(`check-migrate-diff FAIL（棘轮新增——schema 与迁移集漂移扩大，只许收窄禁新增）:\n  + ${added.join('\n  + ')}`);
  process.exit(1);
}
if (stale.length) {
  console.warn(`check-migrate-diff WARNING: 金标有 ${stale.length} 行已不在当前 diff（收窄——建议 node scripts/check-migrate-diff.mjs --update 后同 commit 落盘）`);
}
console.log(`check-migrate-diff OK: diff ${diffLines.length} 行 ⊆ 金标 ${allow.size} 行（金标=${path.relative(ROOT, ALLOWLIST)}）`);
