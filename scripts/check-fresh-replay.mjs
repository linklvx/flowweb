#!/usr/bin/env node
// scripts/check-fresh-replay.mjs —— Y0b-5 T12-0d：fresh-replay 门禁（写好未接门禁的终结）。
// scratch 库（flowweb_fresh_replay）drop+create → prisma migrate deploy 重放 migrations/*（生产同机制）
// → 与 DATABASE_URL 主库对象清单双向比对（lib/schema-dump.mjs 单源五组：columns/constraints/indexes/
// sequences/enums——collabLeaseRows 是数据计数非结构，不比）。绿红皆 drop scratch。
// 这是 squash 的唯一可信验收：check-migrate-diff 的 prisma diff 不建模序列/partial WHERE/约束形态。
// CREATEDB 前置=T12-0c（ALTER ROLE flowweb CREATEDB——建/删 scratch 均以连接用户执行，管理员零参与）。
// 退出码：0=五组双向一致；1=漂移/结构性失败。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dump, Client } from './lib/schema-dump.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(ROOT, 'apps/api');
const prismaCli = createRequire(path.join(API, 'package.json')).resolve('prisma/build/index.js');
const MIG_DIR = path.join(API, 'prisma/migrations');
const SCRATCH = 'flowweb_fresh_replay';
const GROUPS = ['columns', 'constraints', 'indexes', 'sequences', 'enums'];

let url = process.env.DATABASE_URL;
if (!url) {
  const envPath = path.join(API, '.env');
  if (!fs.existsSync(envPath)) throw new Error('DATABASE_URL 未设置且 apps/api/.env 不存在');
  const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('apps/api/.env 中无 DATABASE_URL');
  url = m[1];
}
const toDb = (name) => new URL(url).toString().replace(/\/[^/]*$/, `/${name}`);

async function dropScratch() {
  const ac = new Client({ connectionString: toDb('postgres') });
  await ac.connect();
  await ac.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
  await ac.end();
}

async function main() {
  await dropScratch();
  const ac = new Client({ connectionString: toDb('postgres') });
  await ac.connect();
  await ac.query(`CREATE DATABASE ${SCRATCH}`);
  await ac.end();
  const nMigrations = fs.readdirSync(MIG_DIR).filter((d) => /^\d+_/.test(d)).length;
  try {
    // 生产同机制重放（migrate deploy——非手写 SQL 拼装；env DATABASE_URL 覆盖 .env 是 Prisma CLI 优先级）
    const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: API, encoding: 'utf8', env: { ...process.env, DATABASE_URL: toDb(SCRATCH) },
    });
    if (r.status !== 0) {
      console.error(`fresh-replay FAIL: prisma migrate deploy 重放退出 ${r.status}:\n${(r.stderr || r.stdout || '').slice(-800)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`fresh-replay: scratch(${SCRATCH}) 重放 ${nMigrations} 迁移: ${r.stdout.trim().split(/\r?\n/).filter((l) => /migration|applied|up to date/i.test(l)).slice(-2).join(' | ') || 'ok'}`);

    const mainC = new Client({ connectionString: url });
    const scratchC = new Client({ connectionString: toDb(SCRATCH) });
    let a; let b;
    try {
      await mainC.connect(); await scratchC.connect();
      [a, b] = [await dump(mainC), await dump(scratchC)];
    } finally {
      // dump/connect 抛错也必 end 两连接——否则句柄悬挂进程不退 1+scratch 活连接致 DROP 失败残留
      await mainC.end().catch(() => {});
      await scratchC.end().catch(() => {});
    }

    let bad = 0;
    for (const g of GROUPS) {
      const rows = (x) => x[g].map((row) => JSON.stringify(row));   // 同一查询两侧行序确定——序列化行做集合元素
      const sa = new Set(rows(a)), sb = new Set(rows(b));
      const onlyMain = [...sa].filter((x) => !sb.has(x));
      const onlyScratch = [...sb].filter((x) => !sa.has(x));
      if (onlyMain.length || onlyScratch.length) {
        bad++;
        console.error(`fresh-replay FAIL [${g}]: 主库独有 ${onlyMain.length} 行 / scratch 独有 ${onlyScratch.length} 行`);
        for (const s of onlyMain.slice(0, 3)) console.error(`  主库+ ${s}`);
        for (const s of onlyScratch.slice(0, 3)) console.error(`  scratch+ ${s}`);
      }
    }
    if (bad) {
      console.error(`fresh-replay FAIL: ${bad}/${GROUPS.length} 组漂移——主库与迁移集不一致（squash 验收红：改主库 or 改迁移后 baseline 对齐）`);
      process.exitCode = 1;
    } else {
      console.log(`fresh-replay OK: 五组对象清单（${GROUPS.join('/')}）主库 ≡ scratch 重放（${nMigrations} 迁移）——双向一致`);
    }
  } finally {
    await dropScratch().catch((e) => console.error(`fresh-replay WARNING: scratch 清理失败（${e.message}）——残留 ${SCRATCH} 下次自清`));
  }
}

main().catch((e) => { console.error(`fresh-replay 结构性失败: ${e.message}`); process.exitCode = 1; });
