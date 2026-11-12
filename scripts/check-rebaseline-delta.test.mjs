// scripts/check-rebaseline-delta.test.mjs —— C1-2 三向 allowlist 对象门（红测先行，纯函数不依赖 DB）。
// 覆盖：分类边界（removed/added/changed）；列类型 census 派生；四负控（缺 ledger_guard→红 /
// 多一列 naive→红 / 少 removed 条目→红 / 多一个非预期对象→红）；allowlist 双向闭合（多余条目也红）；
// gate 侧不自动写（--update 之外只读——parseArgs 只认 --update）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs, normalizeCensus, computeDelta, evaluateGate, buildAllowlist, DELTA_GROUPS,
} from './check-rebaseline-delta.mjs';

const def = (x) => JSON.parse(JSON.stringify(x));

/** 归一化 census fixture：七组全给默认空，允许逐组覆写。 */
function census({ columns = {}, constraints = {}, indexes = {}, sequences = {}, enums = {}, functions = {}, triggers = {}, tsColumns = {} } = {}) {
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
