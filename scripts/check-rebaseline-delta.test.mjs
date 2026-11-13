// scripts/check-rebaseline-delta.test.mjs —— C1-2 三向 allowlist 对象门（红测先行，纯函数不依赖 DB）。
// 覆盖：分类边界（removed/added/changed）；列类型 census 派生；四负控（缺 ledger_guard→红 /
// 多一列 naive→红 / 少 removed 条目→红 / 多一个非预期对象→红）；allowlist 双向闭合（多余条目也红）；
// gate 侧不自动写（--update 之外只读——parseArgs 只认 --update）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from './lib/schema-dump.mjs';
import {
  parseArgs, normalizeCensus, computeDelta, evaluateGate, buildAllowlist, DELTA_GROUPS,
  checkBaselineAnchors, checkAllowlistMeta, contentSha256, chainSqlPaths, chainInitError, INIT_SQL,
} from './check-rebaseline-delta.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const def = (x) => JSON.parse(JSON.stringify(x));

/** 归一化 census fixture：八组全给默认空，允许逐组覆写。 */
function census({ columns = {}, constraints = {}, indexes = {}, sequences = {}, enums = {}, functions = {}, triggers = {}, tsColumns = {}, tables = [] } = {}) {
  return normalizeCensus({
    columns: Object.entries(columns).map(([key, d]) => {
      const i = key.indexOf('.');
      return { table_name: key.slice(0, i), column_name: key.slice(i + 1), ...d };
    }),
    constraints: Object.entries(constraints).map(([conname, d]) => ({ conname, ...d })),
    indexes: Object.entries(indexes).map(([indexname, d]) => ({ indexname, ...d })),
    sequences: Object.keys(sequences),
    enums: Object.entries(enums).map(([typname, d]) => ({ typname, values: d.values })),
    functions: Object.entries(functions).map(([key, d]) => ({ key, def: d })),
    triggers: Object.entries(triggers).map(([key, d]) => ({ key, def: d })),
    tsColumns: Object.entries(tsColumns).map(([key, d]) => ({ key, ...d })),
    tables,
  });
}

const NAIVE = 'timestamp without time zone';
const TZ = 'timestamp with time zone';
const col = (data_type, column_default = null, is_nullable = 'NO') => ({ is_nullable, data_type, column_default });

function emptyGroups() {
  return Object.fromEntries(DELTA_GROUPS.map((g) => [g, []]));
}

/** 空 allowlist（gate 对零 delta 显式绿）。 */
function allowlistFixture(overrides = {}) {
  return {
    removed: emptyGroups(),
    added: emptyGroups(),
    changed: emptyGroups(),
    columnTypeCensus: { expectedConversions: [], removedNaiveColumns: [] },
    ...overrides,
  };
}

// 复用的最小场景：基线有一个 naive 列转 tz、一个 ledger_guard 函数、一个 outbox 索引。
function baselineFixture() {
  return census({
    columns: { 'T.a': col(NAIVE), 'T.keep': col('text') },
    tsColumns: { 'T.a': { data_type: NAIVE, precision: 3 } },
    constraints: { Old_pkey: { contype: 'p', def: 'PRIMARY KEY (id)' } },
    indexes: { old_outbox_idx: { indexdef: 'CREATE INDEX old_outbox_idx ON public."Outbox" USING btree (x)' } },
    enums: { OldState: { values: '{a,b}' } },
    functions: { 'ledger_guard()': 'CREATE OR REPLACE FUNCTION public.ledger_guard() RETURNS trigger ...' },
    triggers: { 'Outbox.old_guard': 'CREATE TRIGGER old_guard BEFORE INSERT ON public."Outbox" FOR EACH ROW EXECUTE FUNCTION ledger_guard()' },
  });
}

function afterFixture() {
  return census({
    columns: { 'T.a': col(TZ), 'T.keep': col('text') },
    tsColumns: { 'T.a': { data_type: TZ, precision: 3 } },
    functions: { 'ledger_guard()': 'CREATE OR REPLACE FUNCTION public.ledger_guard() RETURNS trigger ...' },
  });
}

/** 与 baselineFixture→afterFixture 的实测 delta 完全一致的 allowlist。 */
function matchingAllowlist(delta) {
  return buildAllowlist(delta);
}

test('分类边界：removed=old-only / added=new-only / changed=同键不同定义（未变不计）', () => {
  const before = census({
    constraints: { A_fkey: { contype: 'f', def: 'FOREIGN KEY (x) REFERENCES "X"(id)' }, B_check: { contype: 'c', def: 'CHECK (y > 0)' } },
    functions: { 'f()': 'body-v1' },
    triggers: { 'T.trg': 'trg-v1' },
  });
  const after = census({
    constraints: { A_fkey: { contype: 'f', def: 'FOREIGN KEY (x) REFERENCES "X"(id) ON DELETE CASCADE' }, C_fkey: { contype: 'f', def: 'FOREIGN KEY (z) REFERENCES "Z"(id)' }, B_check: { contype: 'c', def: 'CHECK (y > 0)' } },
    functions: { 'f()': 'body-v2' },
    triggers: { 'T.trg': 'trg-v1' },
  });
  const d = computeDelta(before, after);
  assert.deepEqual(d.removed.constraints, []);
  assert.deepEqual(d.added.constraints.map((e) => e.key), ['C_fkey']);
  assert.deepEqual(d.changed.constraints.map((e) => e.key), ['A_fkey']);
  assert.deepEqual(d.changed.functions.map((e) => e.key), ['f()']);   // body 逐字变化=changed
  assert.deepEqual(d.changed.triggers, []);                            // 同键同定义不计
});

test('列类型 census：期望转换集由 baseline 存活 naive 列派生（不 hardcode 数字）；outbox 删除列单列', () => {
  const before = census({
    columns: { 'T.a': col(NAIVE), 'T.b': col(NAIVE), 'Outbox.dead': col(NAIVE), 'T.text': col('text') },
    tsColumns: { 'T.a': { data_type: NAIVE, precision: 3 }, 'T.b': { data_type: NAIVE, precision: 3 }, 'Outbox.dead': { data_type: NAIVE, precision: 3 } },
  });
  const after = census({
    columns: { 'T.a': col(TZ), 'T.b': col(TZ), 'T.text': col('text') },
    tsColumns: { 'T.a': { data_type: TZ, precision: 3 }, 'T.b': { data_type: TZ, precision: 3 } },
  });
  const d = computeDelta(before, after);
  assert.deepEqual(d.columnTypeCensus.expectedConversions, ['T.a', 'T.b']);
  assert.deepEqual(d.columnTypeCensus.removedNaiveColumns, ['Outbox.dead']);
  assert.deepEqual(d.missingConversions, []);
  // 转换列不计入 changed（语义=期望转换而非定义漂移）；删除列照常入 removed.columns
  assert.deepEqual(d.changed.columns, []);
  assert.deepEqual(d.removed.columns.map((e) => e.key), ['Outbox.dead']);
  assert.deepEqual(evaluateGate(d, allowlistFixture({
    removed: { ...emptyGroups(), columns: [{ key: 'Outbox.dead', def: col(NAIVE) }] },
    columnTypeCensus: { expectedConversions: ['T.a', 'T.b'], removedNaiveColumns: ['Outbox.dead'] },
  })).ok, true);
});

test('负控① 缺 ledger_guard→红（基线有、after 无=removed 未登记）', () => {
  const before = baselineFixture();
  const after = afterFixture();
  delete after.functions['ledger_guard()'];
  const d = computeDelta(before, after);
  const allowlist = matchingAllowlist(computeDelta(before, afterFixture()));
  const r = evaluateGate(d, allowlist);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes('removed.functions') && v.includes('ledger_guard')), r.violations.join('\n'));
});

test('负控② 多一列 naive→红（新增 naive 列不在 allowlist；遗留未转换=missing conversion 红）', () => {
  // ① 新增一列 naive（added.columns 未登记）
  const base = baselineFixture();
  const afterAdd = afterFixture();
  afterAdd.columns['T.newNaive'] = col(NAIVE);
  afterAdd.tsColumns['T.newNaive'] = { data_type: NAIVE, precision: 3 };
  const allowlist = matchingAllowlist(computeDelta(base, afterFixture()));
  const r1 = evaluateGate(computeDelta(base, afterAdd), allowlist);
  assert.equal(r1.ok, false);
  assert.ok(r1.violations.some((v) => v.includes('未登记 added.columns') && v.includes('T.newNaive')), r1.violations.join('\n'));

  // ② 存活 naive 列未转换（基线 naive、after 仍 naive）——census 缺失即红
  const afterStillNaive = afterFixture();
  afterStillNaive.columns['T.a'] = col(NAIVE);
  afterStillNaive.tsColumns['T.a'] = { data_type: NAIVE, precision: 3 };
  const r2 = evaluateGate(computeDelta(base, afterStillNaive), allowlist);
  assert.equal(r2.ok, false);
  assert.ok(r2.violations.some((v) => v.includes('列类型转换缺失') && v.includes('T.a')), r2.violations.join('\n'));
});

test('负控③ 少 removed 条目→红（实测 removed 索引未在 allowlist 登记）', () => {
  const d = computeDelta(baselineFixture(), afterFixture());
  const allowlist = matchingAllowlist(d);
  allowlist.removed.indexes = [];   // 人工删掉一条
  const r = evaluateGate(d, allowlist);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes('未登记 removed.indexes') && v.includes('old_outbox_idx')), r.violations.join('\n'));
});

test('负控④ 多一个非预期对象→红（after 多出函数/触发器/索引）', () => {
  const after = afterFixture();
  after.functions['evil()'] = 'CREATE OR REPLACE FUNCTION public.evil() RETURNS void ...';
  after.triggers['T.evil_trg'] = 'CREATE TRIGGER evil_trg BEFORE INSERT ON public."T" FOR EACH ROW EXECUTE FUNCTION evil()';
  after.indexes['evil_idx'] = { indexdef: 'CREATE INDEX evil_idx ON public."T" USING btree (x)' };
  const allowlist = matchingAllowlist(computeDelta(baselineFixture(), afterFixture()));
  const r = evaluateGate(computeDelta(baselineFixture(), after), allowlist);
  assert.equal(r.ok, false);
  for (const [group, key] of [['functions', 'evil()'], ['triggers', 'T.evil_trg'], ['indexes', 'evil_idx']]) {
    assert.ok(r.violations.some((v) => v.includes(`未登记 added.${group}`) && v.includes(key)), r.violations.join('\n'));
  }
});

test('allowlist 双向闭合：多余条目也红（实际无此差异——防自证 allowlist）', () => {
  const d = computeDelta(baselineFixture(), afterFixture());
  const allowlist = matchingAllowlist(d);
  allowlist.added.constraints = [{ key: 'Ghost_fkey', def: { contype: 'f', def: 'FOREIGN KEY (ghost)' } }];
  allowlist.columnTypeCensus.expectedConversions = ['T.a', 'Ghost.a'];
  const r = evaluateGate(d, allowlist);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes('allowlist 多余 added.constraints') && v.includes('Ghost_fkey')), r.violations.join('\n'));
  assert.ok(r.violations.some((v) => v.includes('Ghost.a')), r.violations.join('\n'));
});

test('allowlist 定义锚定：added/changed 的定义与 allowlist 记录不符即红（body 逐字）', () => {
  const d = computeDelta(baselineFixture(), afterFixture());
  const allowlist = matchingAllowlist(d);
  allowlist.removed.indexes[0].def = { indexdef: '被改写的旧定义' };
  const r1 = evaluateGate(d, allowlist);
  assert.equal(r1.ok, false);
  assert.ok(r1.violations.some((v) => v.includes('removed.indexes') && v.includes('定义与 allowlist 记录不符')), r1.violations.join('\n'));

  const d2 = computeDelta(census({ functions: { 'f()': 'v1' } }), census({ functions: { 'f()': 'v2' } }));
  const a2 = matchingAllowlist(d2);
  a2.changed.functions[0].after = 'v2-tampered';
  const r2 = evaluateGate(d2, a2);
  assert.equal(r2.ok, false);
  assert.ok(r2.violations.some((v) => v.includes('changed.functions') && v.includes('after 定义漂移')), r2.violations.join('\n'));
});

test('buildAllowlist：确定性排序落盘（键序稳定——diff 可审阅）', () => {
  const delta = {
    removed: { ...emptyGroups(), indexes: [{ key: 'z_idx', def: { indexdef: 'z' } }, { key: 'a_idx', def: { indexdef: 'a' } }] },
    added: { ...emptyGroups(), functions: [{ key: 'set_updated_at()', def: 'body' }] },
    changed: emptyGroups(),
    columnTypeCensus: { expectedConversions: ['T.b', 'T.a'], removedNaiveColumns: [] },
    missingConversions: [],
  };
  const a = buildAllowlist(delta);
  assert.deepEqual(a.removed.indexes.map((e) => e.key), ['a_idx', 'z_idx']);
  assert.deepEqual(a.columnTypeCensus.expectedConversions, ['T.a', 'T.b']);
  assert.deepEqual(Object.keys(a), ['removed', 'added', 'changed', 'columnTypeCensus']);
});

test('parseArgs：默认=只读 gate；--update 生成；未知旗标 fail-closed 抛错（exit 2 语义）', () => {
  assert.deepEqual(parseArgs([]), { update: false });
  assert.deepEqual(parseArgs(['--update']), { update: true });
  assert.throws(() => parseArgs(['--updat']), /未知参数: --updat/);
  assert.throws(() => parseArgs(['--update', '--write']), /未知参数: --write/);
});

test('normalizeCensus：columns 键=table.column（def 三字段）；函数/触发器 def 保持原文', () => {
  const n = census({
    columns: { 'T.a': col(NAIVE, 'CURRENT_TIMESTAMP') },
    functions: { 'f()': 'CREATE FUNCTION ...' },
    triggers: { 'T.trg': 'CREATE TRIGGER ...' },
  });
  assert.deepEqual(def(n.columns['T.a']), { is_nullable: 'NO', data_type: NAIVE, column_default: 'CURRENT_TIMESTAMP' });
  assert.equal(n.functions['f()'], 'CREATE FUNCTION ...');
  assert.equal(n.triggers['T.trg'], 'CREATE TRIGGER ...');
  assert.equal(n.sequences && typeof n.sequences, 'object');
});

// fixture 表名用 LegacyOutbox 代名：真实旧表名会命中 media-fact-outbox.retirement.spec 的
// PascalCase 零命中 grep 锚（扫描域含 root scripts/*.mjs）——勿改回真名。
test('负控⑤ tables 组：少 removed 表条目→红 / 多一个未登记表→红（行残留/空壳表可检出）', () => {
  const before = census({ tables: ['LegacyOutbox'] });
  const after = census({ tables: [] });
  const d = computeDelta(before, after);
  assert.deepEqual(d.removed.tables.map((e) => e.key), ['LegacyOutbox']);
  const allowlist = buildAllowlist(d);
  assert.deepEqual(allowlist.removed.tables.map((e) => e.key), ['LegacyOutbox']);

  // 少 removed 表条目→红
  const missing = JSON.parse(JSON.stringify(allowlist));
  missing.removed.tables = [];
  const r1 = evaluateGate(d, missing);
  assert.equal(r1.ok, false);
  assert.ok(r1.violations.some((v) => v.includes('未登记 removed.tables') && v.includes('LegacyOutbox')), r1.violations.join('\n'));

  // after 多一个未登记表（新增表/空壳残留）→红
  const r2 = evaluateGate(computeDelta(before, census({ tables: ['Ghost'] })), allowlist);
  assert.equal(r2.ok, false);
  assert.ok(r2.violations.some((v) => v.includes('未登记 added.tables') && v.includes('Ghost')), r2.violations.join('\n'));

  // 空壳表残留（after 仍有该表、仅列/约束/索引被删）：removed.tables 期望未发生→allowlist 多余条目红
  const r3 = evaluateGate(computeDelta(before, census({ tables: ['LegacyOutbox'] })), allowlist);
  assert.equal(r3.ok, false);
  assert.ok(r3.violations.some((v) => v.includes('allowlist 多余 removed.tables') && v.includes('LegacyOutbox')), r3.violations.join('\n'));
});

test('基线证据锚定：sha256 不一致/缺失→结构性错误（gate 重放前 exit 2 语义）', () => {
  const recorded = { sqlSha256: 'a'.repeat(64), objectsSha256: 'b'.repeat(64) };
  assert.deepEqual(checkBaselineAnchors(recorded, recorded), []);
  const mismatch = checkBaselineAnchors(recorded, { sqlSha256: 'c'.repeat(64), objectsSha256: 'b'.repeat(64) });
  assert.ok(mismatch.some((v) => v.includes('sqlSha256')), mismatch.join('\n'));
  const missing = checkBaselineAnchors(undefined, recorded);
  assert.ok(missing.some((v) => v.includes('缺失')), missing.join('\n'));
});

test('contentSha256：按入库内容 LF 口径（工作树 CRLF 材料化不产生跨平台假红）', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebaseline-anchor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const crlf = path.join(dir, 'crlf.txt');
  const lf = path.join(dir, 'lf.txt');
  fs.writeFileSync(crlf, 'a\r\nb\r\n');
  fs.writeFileSync(lf, 'a\nb\n');
  assert.equal(contentSha256(crlf), contentSha256(lf));
  fs.writeFileSync(lf, 'a\nc\n');
  assert.notEqual(contentSha256(crlf), contentSha256(lf));
});

test('M-5 allowlist 元数据与实际路径一致（不一致=结构性错误 exit 2 语义）', () => {
  const expected = {
    baseline: 'gate-evidence/schema-before-v2.sql',
    baselineObjects: 'gate-evidence/schema-before-v2.objects.json',
    init: 'apps/api/prisma/migrations/20261112120000_c1_rebaseline_init/migration.sql',
    adr: 'gate-evidence/schema-baseline-adr.md',
  };
  assert.deepEqual(checkAllowlistMeta(expected, expected), []);
  const bad = checkAllowlistMeta({ ...expected, init: 'apps/api/prisma/migrations/old_init/migration.sql' }, expected);
  assert.ok(bad.some((v) => v.includes('init') && v.includes('old_init')), bad.join('\n'));
  const missing = checkAllowlistMeta({}, expected);
  assert.ok(missing.some((v) => v.includes('缺失')), missing.join('\n'));
});

// C3b-1 起迁移链含 init 后增量——after 重放面=全链（C1-6 卡注记②：新迁移 new-only 对象未登记即红）
test('chainSqlPaths：after 重放面=迁移链目录序全量（init 首位+其后增量 migration.sql）', () => {
  const paths = chainSqlPaths();
  assert.ok(paths.length >= 1, '迁移链至少含 init');
  assert.equal(paths[0], INIT_SQL, '目录序首位=init（rebaseline 锚——init 缺位=gate 结构性 exit 2）');
  assert.ok(paths.every((p) => p.endsWith('migration.sql')), '链元素=各迁移目录的 migration.sql');
  const dirs = paths.map((p) => path.basename(path.dirname(p)));
  assert.deepEqual([...dirs].sort(), dirs, '链序=目录名字典序');
});

test('chainInitError：init 缺位→非空错误（抽迁移/空链 fail-closed 负控）；init 在链→null', () => {
  const increment = path.join(path.dirname(INIT_SQL), '..', '20269999000000_x_increment', 'migration.sql');
  assert.equal(chainInitError([INIT_SQL, increment]), null, 'init 在链（任意位）=无错');
  assert.ok(chainInitError([increment]), '链抽掉 init=非空错误');
  assert.match(String(chainInitError([increment])), /缺失 init/, '错误文案含「缺失 init」（main exit 2 依据）');
  assert.match(String(chainInitError([])), /缺失 init/, '空链（init 目录被删）同样 fail-closed');
});

test('M-6 allowlist 未知组/未知 kind→红（不得静默忽略）', () => {
  const d = computeDelta(baselineFixture(), afterFixture());
  const allowlist = matchingAllowlist(d);
  allowlist.added.bogusGroup = [{ key: 'X', def: null }];
  allowlist.mystery = { x: 1 };
  const r = evaluateGate(d, allowlist);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes('未知组 added.bogusGroup')), r.violations.join('\n'));
  assert.ok(r.violations.some((v) => v.includes('未知 kind: mystery')), r.violations.join('\n'));
});

// —— I-1 并发自测（DB 依赖；DB 不可达时跳过，不进静态档）——
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(ROOT, 'apps/api/.env');
  if (!fs.existsSync(envPath)) return null;
  const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  return m ? m[1] : null;
}

async function dbReachable(url) {
  const c = new Client({ connectionString: url });
  try {
    await c.connect();
    await c.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}

/** spawn 一个 gate 实例：watchdog 60s 未退出=挂起（I-1 回归）→ reject。 */
function runGateProcess() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/check-rebaseline-delta.mjs')], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const watchdog = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`gate 进程挂起 >60s（I-1 失败路径未退出）：\n${output.slice(-2000)}`));
    }, 60_000);
    child.on('error', (e) => { clearTimeout(watchdog); reject(e); });
    child.on('exit', (code) => { clearTimeout(watchdog); resolve({ code, output }); });
  });
}

test('I-1 并发自测：两实例并行→有限时间退出且 exit∈{0,2}，无残留临时库', async (t) => {
  const url = databaseUrl();
  if (!url || !(await dbReachable(url))) { t.skip('DATABASE_URL 不可用——并发 DB 自测跳过'); return; }
  const [a, b] = await Promise.all([runGateProcess(), runGateProcess()]);
  for (const r of [a, b]) assert.ok([0, 2].includes(r.code), `gate exit=${r.code}（只允许 0/2）\n${r.output.slice(-2000)}`);
  assert.ok([a, b].some((r) => r.code === 0), `两实例均非 0（advisory lock 外结构性失败）\nA:${a.output.slice(-800)}\nB:${b.output.slice(-800)}`);
  const admin = new Client({ connectionString: new URL(url).toString().replace(/\/[^/]*$/, '/postgres') });
  await admin.connect();
  try {
    const r = await admin.query("SELECT 1 FROM pg_database WHERE datname='flowweb_rebaseline_delta'");
    assert.equal(r.rowCount, 0, '临时库 flowweb_rebaseline_delta 残留');
  } finally {
    await admin.end().catch(() => {});
  }
});
