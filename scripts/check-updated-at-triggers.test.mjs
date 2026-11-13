// scripts/check-updated-at-triggers.test.mjs —— C1-5 coverage 门自测（node --test scripts/ 消费——import
// 零副作用；verify 链 scripts-node-test 步列举）。
// 负控（plan Task C1-5）：纯函数六族（缺挂/多挂/错名/错函数/错时机/多余）+真实 DB 三用例
// （48/48 绿；事务内 DROP 一个触发器→红→ROLLBACK→绿——零持久变更；**CLI 端到端 scratch 库**
// 重放新 init→exit 0 / DROP→exit 1 / 恢复→exit 0——评审 Minor-6 可复跑红证）+CLI exit 2（DB 不可达
// ——无 DB 依赖恒跑）。无 DB 时 DB 用例 skip。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  evaluateCoverage, describeTiming, isExpectedTiming, REQUIRED_FUNCTION, TRIGGER_PREFIX,
  introspect, resolveDatabaseUrl, EXPECTED_TIMING,
} from './check-updated-at-triggers.mjs';

/** 合规触发器行（纯函数夹具——真实 introspection 同形）。 */
const good = (table, over = {}) => ({
  table, name: `${TRIGGER_PREFIX}${table}`, fn: REQUIRED_FUNCTION, fnSchema: 'public', tgtype: 23,
  enabled: 'O', cols: '', whenExpr: null,
  def: `CREATE TRIGGER "${TRIGGER_PREFIX}${table}" BEFORE INSERT OR UPDATE ON public."${table}" FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  ...over,
});

test('绿：每表恰一个合规触发器（非空转：covered===tables）', () => {
  const r = evaluateCoverage({ tables: ['A', 'B'], triggers: [good('A'), good('B')] });
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true);
  assert.equal(r.stats.tables, 2);
  assert.equal(r.stats.covered, 2);
});

test('负控①缺挂：updatedAt 表无 set_updated_at_<表> → 红（新增表漏挂即红）', () => {
  const r = evaluateCoverage({ tables: ['A', 'B'], triggers: [good('A')] });
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0], /缺触发器：表 B/);
  assert.equal(r.stats.covered, 1);
});

test('负控②多挂：同表两个 set_updated_at 函数触发器 → 红', () => {
  const r = evaluateCoverage({ tables: ['A'], triggers: [good('A'), good('A', { name: `${TRIGGER_PREFIX}A_dup` })] });
  assert.equal(r.ok, false);
  assert.match(r.violations.join('\n'), /多挂：表 A/);
});

test('负控③错函数：名合规但调用别的函数/同名异 schema → 逐档红（Minor-5 加固）', () => {
  const cases = [
    { over: { fn: 'some_other_fn' }, why: /错函数：A\.set_updated_at_A 调用 some_other_fn\(\)/ },
    { over: { fnSchema: 'other' }, why: /错函数：A\.set_updated_at_A 调用 other\.set_updated_at\(\)/ },
    { over: { fnSchema: null }, why: /错函数/ },   // schema 不可解析（防未取到 schema 时静默放行）
  ];
  for (const c of cases) {
    const r = evaluateCoverage({ tables: ['A'], triggers: [good('A', c.over)] });
    assert.equal(r.ok, false, JSON.stringify(c.over));
    assert.match(r.violations[0], c.why, JSON.stringify(c.over));
  }
});

test('负控④错名：函数正确但触发器名不符 set_updated_at_<表> → 红（可审计映射）', () => {
  const r = evaluateCoverage({ tables: ['A'], triggers: [good('A', { name: 'a_updated_at' })] });
  assert.equal(r.ok, false);
  assert.match(r.violations[0], /错名：表 A 的 updatedAt 触发器名为 a_updated_at/);
});

test('负控⑤错时机：AFTER/语句级/DELETE 事件/UPDATE OF 列清单/禁用/条件 WHEN → 逐档红', () => {
  const cases = [
    { over: { tgtype: 5 }, why: /错时机/ },      // AFTER INSERT FOR EACH ROW
    { over: { tgtype: 6 }, why: /错时机/ },      // BEFORE INSERT FOR EACH STATEMENT
    { over: { tgtype: 31 }, why: /错时机/ },     // BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW
    { over: { tgtype: 21 }, why: /错时机/ },     // BEFORE UPDATE FOR EACH ROW（缺 INSERT）
    { over: { cols: '2' }, why: /UPDATE OF 列清单/ },
    { over: { enabled: 'D' }, why: /禁用/ },
    { over: { whenExpr: '(old."x" IS NULL)' }, why: /条件 WHEN/ },   // Minor-5 加固：tgqual 非 NULL
  ];
  for (const c of cases) {
    const r = evaluateCoverage({ tables: ['A'], triggers: [good('A', c.over)] });
    assert.equal(r.ok, false, JSON.stringify(c.over));
    assert.match(r.violations[0], c.why, JSON.stringify(c.over));
  }
  assert.equal(isExpectedTiming(23), true);
  assert.equal(describeTiming(23), EXPECTED_TIMING);
  assert.equal(describeTiming(31), 'BEFORE INSERT OR DELETE OR UPDATE FOR EACH ROW');
});

test('负控⑥多余：set_updated_at_* 挂在无 updatedAt 列的表上 → 红（列删除/改名后孤儿触发器）', () => {
  const r = evaluateCoverage({ tables: ['A'], triggers: [good('A'), good('Ghost')] });
  assert.equal(r.ok, false);
  assert.match(r.violations.join('\n'), /多余：触发器 Ghost\.set_updated_at_Ghost/);
});

// ── 真实 DB 三用例（无 DATABASE_URL 且无 apps/api/.env → skip；plan「可选 db 用例 skip 无 DB」）──
const dbUrl = (() => {
  try { return resolveDatabaseUrl(); } catch { return null; }
})();
// pg 是 apps/api 的依赖（根 scripts/ 解析不到包级 node_modules）——createRequire 锚定 api 包（门本体同款）。
const { Client } = createRequire(new URL('../apps/api/package.json', import.meta.url))('pg');

test('真实 DB：全量 updatedAt 表 coverage 绿（非空转：表数>0 且 covered===tables）', { skip: dbUrl == null }, async () => {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const r = evaluateCoverage(await introspect(client));
    assert.deepEqual(r.violations, []);
    assert.ok(r.stats.tables > 0, 'updatedAt 表计数必须 >0（未迁移库=扫零假绿）');
    assert.equal(r.stats.covered, r.stats.tables);
  } finally {
    await client.end();
  }
});

test('真实 DB 负控：事务内 DROP 一个触发器 → 红；ROLLBACK 恢复 → 绿（零持久变更）', { skip: dbUrl == null }, async () => {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const before = await introspect(client);
    const target = before.tables[0];
    assert.ok(target, 'updatedAt 表集不得为空');
    const trigger = `${TRIGGER_PREFIX}${target}`;
    await client.query('BEGIN');
    try {
      await client.query(`DROP TRIGGER "${trigger}" ON "${target}"`);
      const red = evaluateCoverage(await introspect(client));
      assert.equal(red.ok, false);
      assert.match(red.violations.join('\n'), new RegExp(`缺触发器：表 ${target}`));
      assert.equal(red.stats.covered, red.stats.tables - 1);
    } finally {
      await client.query('ROLLBACK');
    }
    const green = evaluateCoverage(await introspect(client));
    assert.deepEqual(green.violations, []);
  } finally {
    await client.end();
  }
});

// ── CLI 端到端（Minor-6：exit 1 场景固化为可复跑证据——scratch 库重放新 init，零触碰目标库）──
const GATE_SCRIPT = fileURLToPath(new URL('./check-updated-at-triggers.mjs', import.meta.url));
const INIT_SQL = fileURLToPath(new URL('../apps/api/prisma/migrations/20261112120000_c1_rebaseline_init/migration.sql', import.meta.url));
const toDbUrl = (url, name) => new URL(url).toString().replace(/\/[^/]*$/, `/${name}`);
const runGate = (databaseUrl) => spawnSync(process.execPath, [GATE_SCRIPT], {
  env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', timeout: 120_000,
});

test('真实 DB CLI 端到端：scratch 重放新 init→exit 0（48/48）；DROP 触发器→exit 1；恢复→exit 0', { skip: dbUrl == null }, async () => {
  const scratchName = `flowweb_c15_gate_${process.pid}_${Date.now().toString(36)}`;
  const admin = new Client({ connectionString: toDbUrl(dbUrl, 'postgres') });
  await admin.connect();
  let scratch = null;
  try {
    await admin.query(`CREATE DATABASE ${scratchName}`);
    const scratchUrl = toDbUrl(dbUrl, scratchName);
    scratch = new Client({ connectionString: scratchUrl });
    await scratch.connect();
    // 重放新 init（psql 元命令行剥除——check-rebaseline-delta 同款）
    const sql = fs.readFileSync(INIT_SQL, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n');
    await scratch.query(sql);
    await scratch.query('SET search_path TO public');
    const target = (await introspect(scratch)).tables[0];
    assert.ok(target, 'scratch 库 updatedAt 表集不得为空');

    const green1 = runGate(scratchUrl);
    assert.equal(green1.status, 0, green1.stderr);
    assert.match(green1.stdout, /updated-at-triggers OK: 48\/48 表已覆盖/);

    await scratch.query(`DROP TRIGGER "${TRIGGER_PREFIX}${target}" ON "${target}"`);
    const red = runGate(scratchUrl);
    assert.equal(red.status, 1, `门须 exit 1（实际 ${red.status}）: ${red.stdout}${red.stderr}`);
    assert.match(red.stderr, new RegExp(`缺触发器：表 ${target}`));

    await scratch.query(`CREATE TRIGGER "${TRIGGER_PREFIX}${target}" BEFORE INSERT OR UPDATE ON "${target}" FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
    const green2 = runGate(scratchUrl);
    assert.equal(green2.status, 0, green2.stderr);
    assert.match(green2.stdout, /updated-at-triggers OK: 48\/48 表已覆盖/);
  } finally {
    if (scratch) await scratch.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`)
      .catch((e) => console.warn(`updated-at-triggers 自测 WARNING: scratch 库 ${scratchName} 删除失败（${e.message}）——残留下次同名不会复用（名含 pid+时间戳）`));
    await admin.end().catch(() => {});
  }
});

test('CLI exit 2：DB 不可达 → 结构性非零（fail-closed，不误判 coverage 绿；毫秒级）', () => {
  const unreachable = 'postgresql://flowweb:flowweb_dev@127.0.0.1:1/flowweb';
  const r = runGate(unreachable);
  assert.equal(r.status, 2, `须 exit 2（实际 ${r.status}）: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /DB 不可达/);
});
