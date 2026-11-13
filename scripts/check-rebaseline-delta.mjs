#!/usr/bin/env node
// scripts/check-rebaseline-delta.mjs —— C1-2 三向 allowlist 对象门（spec 2026-11-11 foundation-batch
// §3.3-3「四层对象 delta 门（三向 allowlist）」；plan v3 Task C1-2）。
//
// 对比对象（两侧均为临时库真实重放——不依赖 dev 库现态，防快照腐烂）：
//   before = `gate-evidence/schema-before-v2.sql`（pre-batch 旧链 24 迁移全量重放——C1-1 证据；
//            重放结果先与 `schema-before-v2.objects.json` 五组逐行核对，基线证据漂移=结构性 exit 2）
//   after  = 迁移链全量重放（目录序：init `20261112120000_c1_rebaseline_init` + 其后增量迁移——C3b-1
//            起 init 后出现增量（首笔=oracle 双表+DeletionBarrier），新迁移对象未登记 allowlist 即红
//            ——C1-6 卡注记②「new-only 对象未登记即红」；C1-2 落地时链=单一 init，行为不变）
// 八类对象（八组）：tables（pg_class relkind='r'——表存在性；空壳表残留可检出）/columns（键
// table.column）/constraints/indexes/sequences/enums（schema-dump 六组复用）+ functions（键
// name(args)，pg_get_functiondef 原文）与 triggers（键 table.tgname，pg_get_triggerdef 原文）——
// schema-dump 六组不含表集合/函数/触发器，本脚本扩展查询（body 逐字比对）。
// 过滤：`_prisma%` 表、所有权/注释/SET 噪声（schema-dump 既有口径；表/函数/触发器按 public 命名空间过滤）。
//
// 三向分类：removed=old-only / added=new-only / changed=同键不同定义（FK onDelete、约束 body、函数/
// 触发器 body 逐字）。列类型 delta 不 hardcode：census=baseline 存活 naive 列（data_type=
// 'timestamp without time zone'）恰好全部转 timestamptz(3)——期望转换集逐列派生并写入 allowlist
// （删列中的 naive 列单列 removedNaiveColumns）；缺失/错误目标类型=红。
//
// 两模式（写面/读面分离——防自证）：
//   无 flag（gate，只读）：先校验 allowlist `baselineAnchors`（两基线证据文件 sha256——被改动即
//     exit 2，不进入重放/判定）；再分类并与 `scripts/rebaseline-delta-allowlist.json` **双向闭合**
//     （removed/added/changed 键集逐组相等——实测未登记→红；allowlist 多余条目→红；同类条目
//     def/body 与 allowlist 记录逐字不等→红）+ census 期望转换集相等。任何未登记差异 exit 1。
//   --update（生成/刷新，显式有意识动作）：按当前实测 delta 重写 allowlist（含 baselineAnchors；
//     JSON 入库前人工审阅；git diff 可审阅）——gate 运行时绝不写盘。allowlist 生成一次+人工审阅+入库。
//
// baselineAnchors 哈希域=入库内容（LF 归一化，git blob 域）：core.autocrlf=true 的 Windows 检出会
// 材料化 CRLF——裸字节哈希对同一 git 内容在 Linux CI（LF 检出）产生假红（check-migration-immutability
// 同款先例）；pg_dump `\restrict` token 不剥除（入库字节固定，token 只在同库重跑时变化）。
//
// 退出码：0=PASS；1=差异未登记 / allowlist 未闭合 / schema 期望不符；2=结构性错误（文件缺失/解析
// 失败/临时库建删或重放失败/未知参数/基线证据漂移）。未知参数 fail-closed（对齐 C1-1 immutability）。
// 队列：verify 链 [db] 步（manifest 单源）——每次 verify 真实重放两库，秒级。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dump, Client } from './lib/schema-dump.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_SQL = path.join(ROOT, 'gate-evidence/schema-before-v2.sql');
export const BASELINE_OBJECTS = path.join(ROOT, 'gate-evidence/schema-before-v2.objects.json');
export const INIT_SQL = path.join(ROOT, 'apps/api/prisma/migrations/20261112120000_c1_rebaseline_init/migration.sql');
export const MIG_DIR = path.join(ROOT, 'apps/api/prisma/migrations');
export const ALLOWLIST_FILE = path.join(ROOT, 'scripts/rebaseline-delta-allowlist.json');
const BASELINE_GROUPS = ['columns', 'constraints', 'indexes', 'sequences', 'enums'];
// 三向分类的八组（columns 走列分类器，其余七组走通用分类器；tables=表存在性）
export const DELTA_GROUPS = ['columns', 'constraints', 'indexes', 'sequences', 'enums', 'functions', 'triggers', 'tables'];
const OBJECT_GROUPS = DELTA_GROUPS.filter((g) => g !== 'columns');
// allowlist 顶层已知键（元数据 + 三向组 + census）——未知 kind 静默忽略=自证漏洞，evaluateGate 判红
const ALLOWLIST_KEYS = ['_comment', 'baseline', 'baselineObjects', 'init', 'adr', 'baselineAnchors', 'removed', 'added', 'changed', 'columnTypeCensus'];
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
    tables: Object.fromEntries(rows(raw.tables).map((name) => [name, null])),
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

/** 错误文本：pg 连接失败可能是 AggregateError（message 空，细节在 errors[]）——拼接 code/message/errors。 */
function errorText(e) {
  const parts = [e?.code, e?.message, ...(e?.errors ?? []).map((x) => x.message)].filter(Boolean);
  return parts.length ? parts.join('；') : String(e);
}

/** 内容 sha256：按**入库内容**（LF 归一化——git blob 域）计算。core.autocrlf=true 的 Windows 检出
 *  会材料化 CRLF，裸字节哈希对同一 git 内容在 Linux CI（LF 检出）产生假红——沿用
 *  check-migration-immutability 的 LF 归一化先例。不剥除 pg_dump `\restrict` token（入库字节固定）。 */
export function contentSha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath).toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
}

/** allowlist 元数据断言（纯函数）：baseline/baselineObjects/init/adr 必须与脚本常量一致——
 *  防止 allowlist 指向另一份基线/init 自证通过。返回违反清单（缺失/不一致=main exit 2）。 */
export function checkAllowlistMeta(meta, expected) {
  const violations = [];
  for (const [key, want] of Object.entries(expected)) {
    if (!meta?.[key]) violations.push(`allowlist 元数据 ${key} 缺失（期望 "${want}"；--update 重生成）`);
    else if (meta[key] !== want) violations.push(`allowlist 元数据 ${key} 不一致（allowlist="${meta[key]}" 实际="${want}"）`);
  }
  return violations;
}

/** 基线证据锚定（纯函数）：gate 重放前校验 allowlist baselineAnchors——基线 SQL 与 objects 快照
 *  被同步篡改/漂移时不再自证通过。返回违反清单（空=通过）；缺失/不一致=结构性错误（main→exit 2）。 */
export function checkBaselineAnchors(recorded, actual) {
  const violations = [];
  for (const key of ['sqlSha256', 'objectsSha256']) {
    if (!recorded?.[key]) violations.push(`baselineAnchors.${key} 缺失（allowlist 须由 --update 生成/刷新）`);
    else if (recorded[key] !== actual[key]) violations.push(`baselineAnchors.${key} 不一致（allowlist=${recorded[key]} 实际=${actual[key]}）——基线证据文件被改动`);
  }
  return violations;
}

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

/** 通用分类（纯函数）：constraints/indexes/sequences/enums/functions/triggers/tables 七组。 */
export function classifyObjects(before, after) {
  const removed = {};
  const added = {};
  const changed = {};
  for (const g of OBJECT_GROUPS) {
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
  for (const key of Object.keys(allowlist)) {
    if (!ALLOWLIST_KEYS.includes(key)) violations.push(`allowlist 未知 kind: ${key}（已知: ${ALLOWLIST_KEYS.join('/')}——未知键不得静默忽略）`);
  }
  for (const kind of ['removed', 'added', 'changed']) {
    for (const g of Object.keys(allowlist[kind] ?? {})) {
      if (!DELTA_GROUPS.includes(g)) violations.push(`allowlist 未知组 ${kind}.${g}（已知组: ${DELTA_GROUPS.join('/')}——未知组不得静默忽略）`);
    }
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
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
// allowlist 元数据期望值（单一来源——--update 写入 + gate 断言同一常量；防指向另一份基线/init 自证）
const ALLOWLIST_META = {
  baseline: rel(BASELINE_SQL),
  baselineObjects: rel(BASELINE_OBJECTS),
  init: rel(INIT_SQL),
  adr: 'gate-evidence/schema-baseline-adr.md',
};

/** 迁移链 SQL 文件（目录序全量——init 首位+其后增量）：after 重放面=C3b-1 起 init 后有增量迁移。 */
export function chainSqlPaths() {
  return fs.readdirSync(MIG_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d+_/.test(e.name))
    .map((e) => e.name).sort()
    .map((d) => path.join(MIG_DIR, d, 'migration.sql'));
}

/** 链 init 缺位校验（fail-closed 纯函数——抽迁移/删 init 目录即非空错误，main 据此 exit 2）。 */
export function chainInitError(afterPaths) {
  return afterPaths.includes(INIT_SQL)
    ? null
    : `迁移链缺失 init（${rel(INIT_SQL)} 不在 ${rel(MIG_DIR)} 目录序内）`;
}

/** 重放阶段错误标记（M-4 归属）：已附文件路径，外层取数 catch 不得二次包装误标阶段。 */
class ReplayError extends Error {}

/**
 * 在临时库重放 SQL 后取全量 census（八组 + 时间列）。
 * 失败路径纪律（I-1）：admin 连接/建库/DROP/CREATE 全在 try 内，finally 必删临时库并 end admin
 * （活 socket 不撑事件循环——任何失败都干净 exit 2 不挂起）；`pg_try_advisory_lock` 序列化并发
 * 实例——拿不到锁立即 exit 2 并提示（临时库单名，并发 DROP/CREATE 互踩=评审实测挂起面）。
 */
async function replayCensus(databaseUrl, sqlPaths, label) {
  const admin = new Client({ connectionString: toDb(databaseUrl, 'postgres') });
  let created = false;
  try {
    await admin.connect();
    const locked = (await admin.query('SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS ok', [SCRATCH_DB])).rows[0].ok;
    if (!locked) throw new Error(`另一个 rebaseline-delta 实例正在使用临时库 ${SCRATCH_DB}（advisory lock 占用）——并发 verify 请排队/串行重跑`);
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
    created = true;
    const c = new Client({ connectionString: toDb(databaseUrl, SCRATCH_DB) });
    try {
      try {
        await c.connect();
        for (const sqlPath of sqlPaths) {
          try {
            // psql 元命令（pg_dump \restrict/\unrestrict 安全 token）driver 不可执行——按行剥除；其余逐字重放
            const sql = fs.readFileSync(sqlPath, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
            await c.query(sql);
          } catch (e) {
            // M-4：重放错误附阶段+文件路径（锁占用/建库错误保持原语义，不误标"重放失败"）
            throw new ReplayError(`${label} 重放失败（${rel(sqlPath)}）：${errorText(e)}`);
          }
        }
        // pg_dump 输出 SET search_path=''（会话级）——schema-dump 的 collabLeaseRows 查询需 public 可解析
        await c.query('SET search_path TO public');
        const six = await dump(c);
        const functions = (await c.query(`SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS key,
            pg_get_functiondef(p.oid) AS def
          FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' ORDER BY 1`)).rows;
        const triggers = (await c.query(`SELECT c.relname || '.' || t.tgname AS key, pg_get_triggerdef(t.oid) AS def
          FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname NOT LIKE '\\_prisma%' ORDER BY 1`)).rows;
        const tables = (await c.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE c.relkind='r' AND n.nspname='public' AND c.relname NOT LIKE '\\_prisma%' ORDER BY 1`)).rows.map((r) => r.relname);
        const tsColumns = (await c.query(`SELECT table_name || '.' || column_name AS key, data_type,
            datetime_precision::int AS precision
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name NOT LIKE '\\_prisma%' AND data_type LIKE 'timestamp%'`)).rows;
        return normalizeCensus({ ...six, functions, triggers, tables, tsColumns });
      } catch (e) {
        if (e instanceof ReplayError) throw e;   // 已附文件路径——不二次包装误标阶段
        // M-4：取数阶段错误附阶段名（重放错误已在逐文件处附路径——此处不再误标具体文件）
        throw new Error(`${label} 取数失败：${errorText(e)}`);
      }
    } finally {
      await c.end().catch(() => {});
    }
  } finally {
    if (created) {
      // 活连接已关；删库失败只告警（不遮蔽原始错误）——残留 DROP IF EXISTS 下次自清
      await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`).catch((e) => console.error(`rebaseline-delta WARNING: 临时库清理失败（${errorText(e)}）——残留 ${SCRATCH_DB} 下次自清`));
    }
    await admin.end().catch(() => {});   // 释放 advisory lock + 关闭 socket（失败路径不得挂起）
  }
}

/** 基线证据一致性：baseline SQL 重放的五组必须逐行等于 schema-before-v2.objects.json（基线漂移=exit 2）。 */
function assertBaselineSnapshot(replayed, objectsPath) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(objectsPath, 'utf8')); } catch (e) {
    throw new Error(`基线快照解析失败（${rel(objectsPath)}）：${e.message}`);
  }
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
  const baselineAnchors = {
    sqlSha256: contentSha256(BASELINE_SQL),
    objectsSha256: contentSha256(BASELINE_OBJECTS),
  };

  // gate：allowlist 与基线锚定必须在**重放前**通过（基线被同步篡改=结构性，不进入 delta 判定）
  let allowlist = null;
  if (!flags.update) {
    if (!fs.existsSync(ALLOWLIST_FILE)) {
      console.error(`rebaseline-delta FAIL: allowlist 缺失: ${rel(ALLOWLIST_FILE)}——先跑 --update 生成并人工审阅（fail-closed）`);
      process.exitCode = 2;
      return;
    }
    try { allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8')); } catch (e) {
      console.error(`rebaseline-delta FAIL: allowlist 解析失败（${rel(ALLOWLIST_FILE)}）：${e.message}`);
      process.exitCode = 2;
      return;
    }
    const metaViolations = checkAllowlistMeta(allowlist, ALLOWLIST_META);
    if (metaViolations.length) {
      console.error('rebaseline-delta FAIL: allowlist 元数据与实际路径不一致（结构性——拒绝重放）：');
      for (const v of metaViolations) console.error(`  - ${v}`);
      process.exitCode = 2;
      return;
    }
    const anchorViolations = checkBaselineAnchors(allowlist.baselineAnchors, baselineAnchors);
    if (anchorViolations.length) {
      console.error('rebaseline-delta FAIL: 基线证据锚定失败（结构性——拒绝重放）：');
      for (const v of anchorViolations) console.error(`  - ${v}`);
      console.error('rebaseline-delta: 基线 SQL / objects 快照被改动——恢复证据文件（git checkout）或人工审阅后 --update 刷新 allowlist');
      process.exitCode = 2;
      return;
    }
  }

  const before = await replayCensus(databaseUrl, [BASELINE_SQL], 'baseline');
  assertBaselineSnapshot(before, BASELINE_OBJECTS);
  // after=迁移链全量重放（目录序）：init 首位+其后增量（C3b-1 起）——init 缺位=结构性错误（fail-closed，
  // 防基线 init 目录被删后空链静默判定）。allowlist 元数据 init 锚=init 文件（rebaseline 身份不变）。
  const afterPaths = chainSqlPaths();
  const initError = chainInitError(afterPaths);
  if (initError) {
    console.error(`rebaseline-delta FAIL: ${initError}——结构性错误`);
    process.exitCode = 2;
    return;
  }
  const after = await replayCensus(databaseUrl, afterPaths, 'chain');
  const delta = computeDelta(before, after);
  const incrementCount = afterPaths.length - 1;
  console.log(`rebaseline-delta: baseline(${path.basename(BASELINE_SQL)} 重放) → chain(init ${path.basename(path.dirname(INIT_SQL))} + ${incrementCount} 增量迁移重放) 三向分类`);
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
    const next = {
      _comment: 'C1-2 三向 allowlist（spec §3.3-3）：由 scripts/check-rebaseline-delta.mjs --update 生成一次、人工审阅后入库；gate 只读（防自证）。',
      ...ALLOWLIST_META,
      baselineAnchors,
      ...buildAllowlist(delta),
    };
    fs.writeFileSync(ALLOWLIST_FILE, JSON.stringify(next, null, 2) + '\n');
    console.log(`rebaseline-delta --update: allowlist 已生成 → ${path.relative(ROOT, ALLOWLIST_FILE)}（人工审阅后随卡入库；gate 绝不写盘）`);
    console.log(`  baselineAnchors: sql=${baselineAnchors.sqlSha256.slice(0, 16)}… objects=${baselineAnchors.objectsSha256.slice(0, 16)}…（LF=入库内容口径）`);
    process.exitCode = 0;
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
  console.log(`rebaseline-delta OK: 八组三向 delta 与 allowlist 双向闭合（removed ${Object.values(delta.removed).flat().length} / added ${Object.values(delta.added).flat().length} / changed ${Object.values(delta.changed).flat().length}；census 转换 ${delta.columnTypeCensus.expectedConversions.length} 列）`);
  process.exitCode = 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => { console.error(`rebaseline-delta 结构性失败: ${errorText(e)}`); process.exitCode = 2; });
}
