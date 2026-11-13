#!/usr/bin/env node
// scripts/check-updated-at-triggers.mjs —— C1-5 updatedAt 触发器 coverage 门（spec 2026-11-11 foundation-batch
// §3.3-2「trigger coverage gate（每个 updatedAt 表必挂，新增表漏挂即红）」；§4 新门禁入 verify 链；plan v3
// Task C1-5）。
//
// 判定以 **DB introspection 为准**：schema.prisma / migration 文本只能证明「写过 CREATE TRIGGER」，不能
// 证明目标库「已挂且启用」——未来 additive 迁移新增 updatedAt 表漏挂触发器时只有实测目录能抓住。
//   期望集 = information_schema.columns：public 下带 "updatedAt" 列的表（排除 _prisma% 迁移元数据）；
//   实测集 = pg_trigger（NOT tgisinternal）JOIN pg_proc（函数名）取 tgtype（时机/事件/行级）+tgenabled
//     （禁用态）+tgattr（UPDATE OF 列清单）+pg_get_triggerdef（原文，违规输出诊断面）。
//   每表恰须 1 个 `set_updated_at_<表名>` 触发器：BEFORE INSERT OR UPDATE FOR EACH ROW（tgtype=23）、
//   调用 set_updated_at()、启用态、无 UPDATE OF 列清单。偏离分档：缺挂/多挂/错名/错函数/错时机/禁用/
//   UPDATE OF/多余（触发器挂在无 updatedAt 列的表上）→ exit 1。
// 退出码（verify db 步语义=非零）：0=PASS；1=coverage 违规；2=结构性错误（DATABASE_URL 缺失/DB 不可达/
//   表集为空〔未迁移或错库——扫零即假绿，fail-closed〕）。
// 负控 = scripts/check-updated-at-triggers.test.mjs（纯函数六族+真实 DB 事务内 DROP→红→ROLLBACK→绿）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// pg 是 apps/api 的依赖（根 scripts/ 解析不到包级 node_modules）——createRequire 锚定 api 包（schema-dump 同款）。
const { Client } = createRequire(path.join(ROOT, 'apps/api/package.json'))('pg');

export const REQUIRED_FUNCTION = 'set_updated_at';
export const TRIGGER_PREFIX = 'set_updated_at_';
export const EXPECTED_TIMING = 'BEFORE INSERT OR UPDATE FOR EACH ROW';

// pg_trigger.tgtype 位掩码（PG 目录定义）：1=ROW 2=BEFORE 4=INSERT 8=DELETE 16=UPDATE 32=TRUNCATE 64=INSTEAD OF。
const TG_ROW = 1;
const TG_BEFORE = 2;
const TG_INSERT = 4;
const TG_DELETE = 8;
const TG_UPDATE = 16;
const TG_TRUNCATE = 32;
const TG_INSTEAD = 64;
const EXPECTED_TGTYPE = TG_ROW | TG_BEFORE | TG_INSERT | TG_UPDATE;   // = 23

/** 期望时机=恰为 BEFORE INSERT OR UPDATE FOR EACH ROW（位全等——多挂 DELETE/TRUNCATE/INSTEAD OF 或
 *  缺 INSERT/UPDATE 皆错时机；DELETE 行级 BEFORE 触发器会以 NEW=NULL 放行删除，不可容忍）。 */
export function isExpectedTiming(tgtype) {
  return tgtype === EXPECTED_TGTYPE;
}

/** 时机描述（违规诊断面——人类可读的实测形态）。 */
export function describeTiming(tgtype) {
  const timing = tgtype & TG_INSTEAD ? 'INSTEAD OF' : tgtype & TG_BEFORE ? 'BEFORE' : 'AFTER';
  const events = [
    tgtype & TG_INSERT ? 'INSERT' : null,
    tgtype & TG_DELETE ? 'DELETE' : null,
    tgtype & TG_UPDATE ? 'UPDATE' : null,
    tgtype & TG_TRUNCATE ? 'TRUNCATE' : null,
  ].filter(Boolean);
  const level = tgtype & TG_ROW ? 'FOR EACH ROW' : 'FOR EACH STATEMENT';
  return `${timing} ${events.join(' OR ') || '（无事件）'} ${level}`;
}

/**
 * coverage 判据（纯函数——自测负控消费）。tables=带 updatedAt 列的表名集；triggers 行形
 * {table,name,fn,tgtype,enabled,cols,def}。返回 { ok, violations[], stats{tables,triggers,covered} }。
 * 归属判定=表身：本表触发器（名以 set_updated_at_ 开头或函数为 set_updated_at）即候选——恰一且全维合规。
 */
export function evaluateCoverage({ tables, triggers }) {
  const violations = [];
  const tableSet = new Set(tables);
  const byTable = new Map();
  for (const tr of triggers) {
    if (!byTable.has(tr.table)) byTable.set(tr.table, []);
    byTable.get(tr.table).push(tr);
  }
  let covered = 0;
  for (const table of tables) {
    const expected = `${TRIGGER_PREFIX}${table}`;
    const candidates = (byTable.get(table) ?? [])
      .filter((t) => t.name.startsWith(TRIGGER_PREFIX) || t.fn === REQUIRED_FUNCTION);
    if (candidates.length === 0) {
      violations.push(`缺触发器：表 ${table} 有 updatedAt 列但未挂 ${expected}（set_updated_at()）——新增 updatedAt 表漏挂即红`);
      continue;
    }
    if (candidates.length > 1) {
      violations.push(`多挂：表 ${table} 有 ${candidates.length} 个 updatedAt 触发器（${candidates.map((c) => c.name).join(', ')}）——恰须 1 个 ${expected}`);
      continue;
    }
    const t = candidates[0];
    if (t.fn !== REQUIRED_FUNCTION) {
      violations.push(`错函数：${table}.${t.name} 调用 ${t.fn}()，期望 ${REQUIRED_FUNCTION}()（def: ${t.def}）`);
    } else if (t.name !== expected) {
      violations.push(`错名：表 ${table} 的 updatedAt 触发器名为 ${t.name}，期望 ${expected}（命名=表↔触发器可审计映射）`);
    } else if (t.cols) {
      violations.push(`错时机：${table}.${t.name} 带 UPDATE OF 列清单（tgattr=${t.cols}）——其余列更新不触发，期望全列 UPDATE`);
    } else if (t.enabled !== 'O') {
      violations.push(`禁用：${table}.${t.name} tgenabled='${t.enabled}'（非 'O'）——禁用/复制模式不写 updatedAt，coverage 假绿`);
    } else if (!isExpectedTiming(t.tgtype)) {
      violations.push(`错时机：${table}.${t.name} = ${describeTiming(t.tgtype)}，期望 ${EXPECTED_TIMING}`);
    } else {
      covered += 1;
    }
  }
  // 反向：本族触发器挂在无 updatedAt 列的表上（列删除/表改名后孤儿）——门必须双向闭合。
  for (const tr of triggers) {
    if (!(tr.name.startsWith(TRIGGER_PREFIX) || tr.fn === REQUIRED_FUNCTION)) continue;
    if (!tableSet.has(tr.table)) {
      violations.push(`多余：触发器 ${tr.table}.${tr.name}（${tr.fn}()）挂在无 updatedAt 列的表上（def: ${tr.def}）`);
    }
  }
  return { ok: violations.length === 0, violations, stats: { tables: tables.length, triggers: triggers.length, covered } };
}

/** DB introspection（单一查询面——gate 与自测共用；client=pg Client）。 */
export async function introspect(client) {
  const tables = (await client.query(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'updatedAt' AND table_name NOT LIKE '\\_prisma%'
     ORDER BY table_name`)).rows.map((r) => r.table_name);
  const triggers = (await client.query(
    `SELECT c.relname AS table, t.tgname AS name, p.proname AS fn, t.tgtype::int AS tgtype,
            t.tgenabled AS enabled, t.tgattr::text AS cols, pg_get_triggerdef(t.oid) AS def
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND n.nspname = 'public' AND c.relname NOT LIKE '\\_prisma%'
     ORDER BY c.relname, t.tgname`)).rows;
  return { tables, triggers };
}

/** DATABASE_URL：env 优先；否则读 apps/api/.env（check-fresh-replay/check-rebaseline-delta 同款前置）。 */
export function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(ROOT, 'apps/api/.env');
  if (!fs.existsSync(envPath)) throw new Error('DATABASE_URL 未设置且 apps/api/.env 不存在');
  const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('apps/api/.env 中无 DATABASE_URL');
  return m[1];
}

function errorText(e) {
  const parts = [e?.code, e?.message, ...(e?.errors ?? []).map((x) => x.message)].filter(Boolean);
  return parts.length ? parts.join('；') : String(e);
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();   // 缺失=throw→catch 结构性 exit 2（fail-closed）
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
  } catch (e) {
    console.error(`updated-at-triggers FAIL: DB 不可达（${errorText(e)}）`);
    process.exitCode = 2;
    return;
  }
  try {
    const snap = await introspect(client);
    if (snap.tables.length === 0) {
      console.error('updated-at-triggers FAIL: public 下零 updatedAt 表——数据库未迁移或连接错库（扫零=假绿，fail-closed）');
      process.exitCode = 2;
      return;
    }
    const r = evaluateCoverage(snap);
    const family = snap.triggers.filter((t) => t.name.startsWith(TRIGGER_PREFIX) || t.fn === REQUIRED_FUNCTION).length;
    if (!r.ok) {
      console.error(`updated-at-triggers FAIL: ${r.violations.length} 项 coverage 违规（${r.stats.covered}/${r.stats.tables} 表已覆盖；public 触发器 ${snap.triggers.length}/本族 ${family}）：`);
      for (const v of r.violations) console.error(`  - ${v}`);
      console.error('updated-at-triggers: 红——每个 updatedAt 表须恰挂 set_updated_at_<表>（BEFORE INSERT OR UPDATE FOR EACH ROW→set_updated_at()）；新增表须同迁移补触发器');
      process.exitCode = 1;
      return;
    }
    console.log(`updated-at-triggers OK: ${r.stats.covered}/${r.stats.tables} 表已覆盖（public 触发器 ${snap.triggers.length}/本族 ${family}；缺失: 无）`);
    console.log(`  缺失清单: 无（每表恰 1 个 ${TRIGGER_PREFIX}<表> = ${EXPECTED_TIMING} → ${REQUIRED_FUNCTION}()）`);
    process.exitCode = 0;
  } finally {
    await client.end().catch(() => {});
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => {
    console.error(`updated-at-triggers 结构性失败: ${errorText(e)}`);
    process.exitCode = 2;
  });
}
