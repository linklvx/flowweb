#!/usr/bin/env node
// scripts/check-rebaseline-delta.mjs —— C1-2 三向 allowlist 对象门（spec 2026-11-11 foundation-batch
// §3.3-3「四层对象 delta 门（三向 allowlist）」；plan v3 Task C1-2）。
//
// 对比对象（两侧均为临时库真实重放——不依赖 dev 库现态，防快照腐烂）：
//   before = `gate-evidence/schema-before-v2.sql`（pre-batch 旧链 24 迁移全量重放——C1-1 证据；
//            重放结果先与 `schema-before-v2.objects.json` 五组逐行核对，基线证据漂移=结构性 exit 2）
//   after  = `apps/api/prisma/migrations/20261112120000_c1_rebaseline_init/migration.sql`（新终态 init）
// 七组对象：columns（键 table.column）/constraints/indexes/sequences/enums（schema-dump 六组复用）
// + functions（键 name(args)，pg_get_functiondef 原文）与 triggers（键 table.tgname，pg_get_triggerdef
// 原文）——schema-dump 六组不含函数/触发器，本脚本扩展查询（body 逐字比对）。
// 过滤：`_prisma%` 表、所有权/注释/SET 噪声（schema-dump 既有口径；函数/触发器按 public 命名空间过滤）。
//
// 三向分类：removed=old-only / added=new-only / changed=同键不同定义（FK onDelete、约束 body、函数/
// 触发器 body 逐字）。列类型 delta 不 hardcode：census=baseline 存活 naive 列（data_type=
// 'timestamp without time zone'）恰好全部转 timestamptz(3)——期望转换集逐列派生并写入 allowlist
// （删列中的 naive 列单列 removedNaiveColumns）；缺失/错误目标类型=红。
//
// 两模式（写面/读面分离——防自证）：
//   无 flag（gate，只读）：分类结果必须与 `scripts/rebaseline-delta-allowlist.json` **双向闭合**
//     （removed/added/changed 键集逐组相等——实测未登记→红；allowlist 多余条目→红；同类条目
//     def/body 与 allowlist 记录逐字不等→红）+ census 期望转换集相等。任何未登记差异 exit 1。
//   --update（生成/刷新，显式有意识动作）：按当前实测 delta 重写 allowlist（JSON 入库前人工审阅；
//     git diff 可审阅）——gate 运行时绝不写盘。allowlist 生成一次+人工审阅+入库，gate 只读。
//
// 退出码：0=PASS；1=差异未登记 / allowlist 未闭合 / schema 期望不符；2=结构性错误（文件缺失/解析
// 失败/临时库建删或重放失败/未知参数/基线证据漂移）。未知参数 fail-closed（对齐 C1-1 immutability）。
// 队列：verify 链 [db] 步（manifest 单源）——每次 verify 真实重放两库，秒级。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dump, Client } from './lib/schema-dump.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_SQL = path.join(ROOT, 'gate-evidence/schema-before-v2.sql');
export const BASELINE_OBJECTS = path.join(ROOT, 'gate-evidence/schema-before-v2.objects.json');
export const INIT_SQL = path.join(ROOT, 'apps/api/prisma/migrations/20261112120000_c1_rebaseline_init/migration.sql');
export const ALLOWLIST_FILE = path.join(ROOT, 'scripts/rebaseline-delta-allowlist.json');
const BASELINE_GROUPS = ['columns', 'constraints', 'indexes', 'sequences', 'enums'];
// 三向分类的七组（columns 走列分类器，其余六组走通用分类器）
export const DELTA_GROUPS = ['columns', 'constraints', 'indexes', 'sequences', 'enums', 'functions', 'triggers'];
const SCRATCH_DB = 'flowweb_rebaseline_delta';

/** CLI 参数判定（纯函数）：仅 --update；未知旗标 fail-closed（main 捕获→exit 2）。 */
export function parseArgs(argv) {
  const unknown = argv.filter((a) => a !== '--update');
  if (unknown.length) throw new Error(`未知参数: ${unknown.join(' ')}（仅支持 --update；无 flag=只读 gate）`);
  return { update: argv.includes('--update') };
}

/** 归一化 DB dump 为 { group: { key: def } }：同键定义逐字比对（对象 stable-stringify，函数/触发器原文）。 */
export function normalizeCensus(raw) {
  const rows = (xs) => xs ?? [];
  return {
    columns: Object.fromEntries(rows(raw.columns).map((r) => [
      `${r.table_name}.${r.column_name}`,
      { is_nullable: r.is_nullable, data_type: r.data_type, column_default: r.column_default },
    ])),
    constraints: Object.fromEntries(rows(raw.constraints).map((r) => [r.conname, { contype: r.contype, def: r.def }])),
    indexes: Object.fromEntries(rows(raw.indexes).map((r) => [r.indexname, { indexdef: r.indexdef }])),
    sequences: Object.fromEntries(rows(raw.sequences).map((name) => [name, null])),
    enums: Object.fromEntries(rows(raw.enums).map((r) => [r.typname, { values: r.values }])),
    functions: Object.fromEntries(rows(raw.functions).map((r) => [r.key, r.def])),
    triggers: Object.fromEntries(rows(raw.triggers).map((r) => [r.key, r.def])),
    tsColumns: Object.fromEntries(rows(raw.tsColumns).map((r) => [r.key, { data_type: r.data_type, precision: r.precision }])),
  };
}

/** 定义比较域：字符串（函数/触发器 body）原文；对象键排序后序列化（allowlist JSON 往返不改语义）。 */
function canonical(def) {
  if (typeof def === 'string' || def === null) return JSON.stringify(def);
  const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
  return JSON.stringify(sortKeys(def));
}

const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** 列类型 census（纯函数）：baseline naive 列 → 存活列必须 timestamptz(3)；删除的 naive 列单列。 */
export function deriveColumnCensus(beforeTs, afterTs, afterColumnKeys) {
  const adjusted = new Map(Object.entries(afterTs));
  const expectedConversions = [];
  const removedNaiveColumns = [];
  const missingConversions = [];
  for (const [key, row] of Object.entries(beforeTs)) {
    if (row.data_type !== 'timestamp without time zone') continue;
    if (!afterColumnKeys.has(key)) { removedNaiveColumns.push(key); continue; }
    const target = adjusted.get(key);
    if (target?.data_type === 'timestamp with time zone' && target.precision === 3) expectedConversions.push(key);
    else missingConversions.push({ key, after: target ? `${target.data_type}(${target.precision})` : 'missing' });
  }
  return {
    expectedConversions: expectedConversions.sort(),
    removedNaiveColumns: removedNaiveColumns.sort(),
    missingConversions: missingConversions.sort((a, b) => (a.key < b.key ? -1 : 1)),
  };
}

/** 列分类（纯函数）：conversionKeys 内的同键差异仅允许 data_type naive→tz（其余字段须逐字相等）。 */
export function classifyColumns(before, after, conversionKeys) {
  const removed = [];
  const added = [];
  const changed = [];
  for (const key of Object.keys(before).sort()) {
    if (!(key in after)) { removed.push({ key, def: before[key] }); continue; }
    if (canonical(before[key]) === canonical(after[key])) continue;
    if (conversionKeys.has(key)
      && before[key].is_nullable === after[key].is_nullable
      && before[key].column_default === after[key].column_default) continue;   // 期望转换（data_type 差）
    changed.push({ key, before: before[key], after: after[key] });
  }
  for (const key of Object.keys(after).sort()) if (!(key in before)) added.push({ key, def: after[key] });
  return { removed, added, changed };
}

/** 通用分类（纯函数）：constraints/indexes/sequences/enums/functions/triggers 六组。 */
export function classifyObjects(before, after, groups = DELTA_GROUPS.filter((g) => g !== 'columns')) {
  const removed = {};
  const added = {};
  const changed = {};
  for (const g of groups) {
    removed[g] = [];
    added[g] = [];
    changed[g] = [];
    const b = before[g] ?? {};
    const a = after[g] ?? {};
    for (const key of Object.keys(b).sort()) {
      if (!(key in a)) removed[g].push({ key, def: b[key] });
      else if (canonical(b[key]) !== canonical(a[key])) changed[g].push({ key, before: b[key], after: a[key] });
    }
    for (const key of Object.keys(a).sort()) if (!(key in b)) added[g].push({ key, def: a[key] });
  }
  return { removed, added, changed };
}

/** 三向 delta（纯函数）：列分类器 + 通用分类器 + census 派生。 */
export function computeDelta(before, after) {
  const census = deriveColumnCensus(before.tsColumns, after.tsColumns, new Set(Object.keys(after.columns)));
  const columns = classifyColumns(before.columns, after.columns, new Set(census.expectedConversions));
  const others = classifyObjects(before, after);
  return {
    removed: { columns: columns.removed, ...others.removed },
    added: { columns: columns.added, ...others.added },
    changed: { columns: columns.changed, ...others.changed },
    columnTypeCensus: {
      expectedConversions: census.expectedConversions,
      removedNaiveColumns: census.removedNaiveColumns,
    },
    missingConversions: census.missingConversions,
  };
}

/** allowlist 落盘形态（纯函数）：键/条目确定性排序（readdir/SQL 行序不保证——diff 可审阅）。 */
export function buildAllowlist(delta) {
  const triple = (kind) => Object.fromEntries(DELTA_GROUPS.map((g) => [
    g,
    [...(delta[kind][g] ?? [])].sort(byKey).map((e) => (kind === 'changed'
      ? { key: e.key, before: e.before, after: e.after }
      : { key: e.key, def: e.def })),
  ]));
  return {
    removed: triple('removed'),
    added: triple('added'),
    changed: triple('changed'),
    columnTypeCensus: {
      expectedConversions: [...delta.columnTypeCensus.expectedConversions].sort(),
      removedNaiveColumns: [...delta.columnTypeCensus.removedNaiveColumns].sort(),
    },
  };
}

/** 字符串集双向闭合（缺失/多余逐项）：实测未登记→红；allowlist 多余条目→红（防自证）。 */
function closeStringSets(actual, listed, label, violations) {
  const a = new Set(actual);
  const l = new Set(listed);
  for (const x of [...a].sort()) if (!l.has(x)) violations.push(`未登记 ${label}: ${x}（实测有、allowlist 未登记）`);
  for (const x of [...l].sort()) if (!a.has(x)) violations.push(`allowlist 多余 ${label}: ${x}（allowlist 有、实测无此差异）`);
}

/**
 * gate 只读判据（纯函数）：delta 与 allowlist 双向闭合 + 条目定义锚定 + census 相等。
 * 返回 { ok, violations[] }——任何未登记/多余差异、定义漂移、转换缺失均红。
 */
export function evaluateGate(delta, allowlist) {
  const violations = [];
  for (const kind of ['removed', 'added', 'changed']) {
    for (const g of DELTA_GROUPS) {
      const actual = delta[kind][g] ?? [];
      const listed = allowlist[kind]?.[g] ?? [];
      closeStringSets(actual.map((e) => e.key), listed.map((e) => e.key), `${kind}.${g}`, violations);
      const listedByKey = new Map(listed.map((e) => [e.key, e]));
      for (const e of actual) {
        const l = listedByKey.get(e.key);
        if (!l) continue;   // 未登记已由上报告
        if (kind === 'changed') {
          if (canonical(e.before) !== canonical(l.before)) violations.push(`changed.${g} ${e.key} before 定义漂移（与 allowlist 记录不符——须刷新 allowlist 并审阅）`);
          if (canonical(e.after) !== canonical(l.after)) violations.push(`changed.${g} ${e.key} after 定义漂移（与 allowlist 记录不符——须刷新 allowlist 并审阅）`);
        } else if (canonical(e.def) !== canonical(l.def)) {
          violations.push(`${kind}.${g} ${e.key} 定义与 allowlist 记录不符（body/def 逐字断言）`);
        }
      }
    }
  }
  for (const m of delta.missingConversions ?? []) {
    violations.push(`列类型转换缺失/错误: ${m.key}（after=${m.after}——期望 timestamp with time zone(3)，census 由 baseline 存活 naive 列派生）`);
  }
  const census = allowlist.columnTypeCensus ?? { expectedConversions: [], removedNaiveColumns: [] };
  closeStringSets(delta.columnTypeCensus.expectedConversions, census.expectedConversions ?? [], 'columnTypeCensus.expectedConversions', violations);
  closeStringSets(delta.columnTypeCensus.removedNaiveColumns, census.removedNaiveColumns ?? [], 'columnTypeCensus.removedNaiveColumns', violations);
  return { ok: violations.length === 0, violations };
}

/** DATABASE_URL：env 优先；否则读 apps/api/.env（check-fresh-replay 同款前置）。 */
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(ROOT, 'apps/api/.env');
  if (!fs.existsSync(envPath)) throw new Error('DATABASE_URL 未设置且 apps/api/.env 不存在');
  const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('apps/api/.env 中无 DATABASE_URL');
  return m[1];
}

const toDb = (url, name) => new URL(url).toString().replace(/\/[^/]*$/, `/${name}`);

/** 在临时库重放 SQL 后取全量 census（七组 + 时间列）。finally 必删临时库（绿红皆清）。 */
async function replayCensus(databaseUrl, sqlPath) {
  const admin = new Client({ connectionString: toDb(databaseUrl, 'postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
  await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  const c = new Client({ connectionString: toDb(databaseUrl, SCRATCH_DB) });
  try {
    await c.connect();
    // psql 元命令（pg_dump \restrict/\unrestrict 安全 token）driver 不可执行——按行剥除；其余逐字重放
    const sql = fs.readFileSync(sqlPath, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
    await c.query(sql);
    // pg_dump 输出 SET search_path=''（会话级）——schema-dump 的 collabLeaseRows 查询需 public 可解析
    await c.query('SET search_path TO public');
    const six = await dump(c);
    const functions = (await c.query(`SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS key,
        pg_get_functiondef(p.oid) AS def
      FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' ORDER BY 1`)).rows;
    const triggers = (await c.query(`SELECT c.relname || '.' || t.tgname AS key, pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname NOT LIKE '\\_prisma%' ORDER BY 1`)).rows;
    const tsColumns = (await c.query(`SELECT table_name || '.' || column_name AS key, data_type,
        datetime_precision::int AS precision
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name NOT LIKE '\\_prisma%' AND data_type LIKE 'timestamp%'`)).rows;
    return normalizeCensus({ ...six, functions, triggers, tsColumns });
  } finally {
    await c.end().catch(() => {});
    // 活连接已关；删库失败=结构性（残留会污染下次 verify——fail-closed 抛出）
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.end();
  }
}

/** 基线证据一致性：baseline SQL 重放的五组必须逐行等于 schema-before-v2.objects.json（基线漂移=exit 2）。 */
function assertBaselineSnapshot(replayed, objectsPath) {
  const raw = JSON.parse(fs.readFileSync(objectsPath, 'utf8'));
  const expected = normalizeCensus(raw);
  const drift = [];
  for (const g of BASELINE_GROUPS) {
    const keys = new Set([...Object.keys(replayed[g]), ...Object.keys(expected[g])]);
    for (const k of keys) {
      if (canonical(replayed[g][k]) !== canonical(expected[g][k])) drift.push(`${g}: ${k}`);
    }
  }
  if (drift.length) {
    throw new Error(`基线证据漂移：schema-before-v2.sql 重放与 schema-before-v2.objects.json 不一致（${drift.length} 处）：\n  - ${drift.slice(0, 10).join('\n  - ')}`);
  }
}

const counts = (groups) => DELTA_GROUPS.map((g) => `${g}=${groups[g]?.length ?? 0}`).join(' ');

async function main() {
  let flags;
  try { flags = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`rebaseline-delta FAIL: ${e.message}`); process.exitCode = 2; return; }
  for (const f of [BASELINE_SQL, BASELINE_OBJECTS, INIT_SQL]) {
    if (!fs.existsSync(f)) { console.error(`rebaseline-delta FAIL: 必需文件缺失: ${path.relative(ROOT, f)}`); process.exitCode = 2; return; }
  }
  const databaseUrl = resolveDatabaseUrl();

  const before = await replayCensus(databaseUrl, BASELINE_SQL);
  assertBaselineSnapshot(before, BASELINE_OBJECTS);
  const after = await replayCensus(databaseUrl, INIT_SQL);
  const delta = computeDelta(before, after);
  console.log(`rebaseline-delta: baseline(${path.basename(BASELINE_SQL)} 重放) → init(${path.basename(path.dirname(INIT_SQL))} 重放) 三向分类`);
  console.log(`  removed ${counts(delta.removed)}`);
  console.log(`  added   ${counts(delta.added)}`);
  console.log(`  changed ${counts(delta.changed)}`);
  console.log(`  列类型 census: 期望转换 ${delta.columnTypeCensus.expectedConversions.length} 列 / 删除 naive 列 ${delta.columnTypeCensus.removedNaiveColumns.length} 列`);

  if (flags.update) {
    if (delta.missingConversions.length) {
      console.error(`rebaseline-delta FAIL(--update): ${delta.missingConversions.length} 个存活 naive 列未转为 timestamptz(3)——拒绝生成 allowlist（先修 init）：`);
      for (const m of delta.missingConversions) console.error(`  - ${m.key} → ${m.after}`);
      process.exitCode = 1;
      return;
    }
    const allowlist = {
      _comment: 'C1-2 三向 allowlist（spec §3.3-3）：由 scripts/check-rebaseline-delta.mjs --update 生成一次、人工审阅后入库；gate 只读（防自证）。',
      baseline: 'gate-evidence/schema-before-v2.sql',
      baselineObjects: 'gate-evidence/schema-before-v2.objects.json',
      init: 'apps/api/prisma/migrations/20261112120000_c1_rebaseline_init/migration.sql',
      adr: 'gate-evidence/schema-baseline-adr.md',
      ...buildAllowlist(delta),
    };
    fs.writeFileSync(ALLOWLIST_FILE, JSON.stringify(allowlist, null, 2) + '\n');
    console.log(`rebaseline-delta --update: allowlist 已生成 → ${path.relative(ROOT, ALLOWLIST_FILE)}（人工审阅后随卡入库；gate 绝不写盘）`);
    process.exitCode = 0;
    return;
  }

  if (!fs.existsSync(ALLOWLIST_FILE)) {
    console.error(`rebaseline-delta FAIL: allowlist 缺失: ${path.relative(ROOT, ALLOWLIST_FILE)}——先跑 --update 生成并人工审阅（fail-closed）`);
    process.exitCode = 2;
    return;
  }
  let allowlist;
  try { allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8')); } catch (e) {
    console.error(`rebaseline-delta FAIL: allowlist 解析失败: ${e.message}`);
    process.exitCode = 2;
    return;
  }
  const result = evaluateGate(delta, allowlist);
  if (!result.ok) {
    console.error(`rebaseline-delta FAIL: ${result.violations.length} 项未登记差异/allowlist 未闭合：`);
    for (const v of result.violations) console.error(`  - ${v}`);
    console.error('rebaseline-delta: 红——对象 delta 必须逐项登记在 allowlist（--update 生成+人工审阅）；基线/init 漂移不得静默吸收');
    process.exitCode = 1;
    return;
  }
  console.log(`rebaseline-delta OK: 七组三向 delta 与 allowlist 双向闭合（removed ${Object.values(delta.removed).flat().length} / added ${Object.values(delta.added).flat().length} / changed ${Object.values(delta.changed).flat().length}；census 转换 ${delta.columnTypeCensus.expectedConversions.length} 列）`);
  process.exitCode = 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => { console.error(`rebaseline-delta 结构性失败: ${e.message}`); process.exitCode = 2; });
}
