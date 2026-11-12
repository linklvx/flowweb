// scripts/check-raw-sql-time.test.mjs —— C1-4 raw SQL 时间语义门自测（node --test scripts/ 消费——import 零副作用）。
// 负控（plan Task C1-4 Step 1 ②③）：fixture 含 ::timestamp / AT TIME ZONE / date_trunc('day', now()) → 红；
// extract(epoch) 合法 → 绿（豁免非空转）；::timestamptz / timestamptz 明示形态 → 绿。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRawSqlTime, countRawCalls } from './check-raw-sql-time.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'apps/api/src/modules/x/claim.service.ts';
const mk = (src, rel = REL) => [{ rel, src }];
const scan = (src, opts) => scanRawSqlTime(mk(src), opts);

test('负控②a：::timestamp 参数 cast → 红；::timestamp(3) → 红', () => {
  for (const cast of ['::timestamp', '::timestamp(3)', ':: timestamp (3)']) {
    const src = 'await prisma.$executeRaw`UPDATE "T" SET "a" = ${v}' + cast + ' WHERE id = ${id}`;';
    assert.ok(scan(src).some((p) => p.includes('无时区 timestamp')), cast);
  }
});

test('负控②a：timestamp 无时区类型/字面量声明 → 红（含 as timestamp / timestamp(3) DDL）', () => {
  for (const src of [
    'await prisma.$executeRaw`ALTER TABLE "T" ADD COLUMN "a" timestamp(3)`;',
    'await prisma.$queryRaw`SELECT CAST(${v} AS timestamp)`;',
    'await prisma.$queryRaw`SELECT ${v}::timestamp without time zone`;',
    'await prisma.$queryRaw`SELECT timestamp \'2026-01-01 00:00:00\'`;',
  ]) {
    assert.ok(scan(src).some((p) => p.includes('无时区 timestamp')), src);
  }
});

test('绿：::timestamptz / ::timestamp with time zone / timestamptz 字面量（目标形态）零误伤', () => {
  const src = [
    'await prisma.$executeRaw`UPDATE "T" SET "a" = ${v}::timestamptz WHERE id = ${id}`;',
    'await prisma.$queryRaw`SELECT now()::timestamp with time zone`;',
    'await prisma.$queryRaw`SELECT ${v}::timestamptz(3), timestamptz \'2026-01-01 00:00:00+08\'`;',
    'await prisma.$queryRaw`SELECT "nextProbeAt" <= now() FROM "Media"`;',
  ].join('\n');
  assert.deepEqual(scan(src), []);
});

test('负控②b：补偿式 AT TIME ZONE → 红（无白名单——放行须显式白名单+注释）', () => {
  for (const src of [
    'await prisma.$queryRaw`SELECT "expiresAt" AT TIME ZONE \'UTC\' < now() FROM "CollabLease"`;',
    'await prisma.$queryRaw`SELECT ("nextProbeAt" AT TIME ZONE \'Asia/Shanghai\')::timestamp <= now() FROM "Media"`;',
  ]) {
    assert.ok(scan(src).some((p) => p.includes('AT TIME ZONE')), src);
  }
});

test('负控②c：无显式时区日历函数 date_trunc(' + "'day', now()) → 红" , () => {
  const cases = [
    'await prisma.$queryRaw`SELECT date_trunc(\'day\', now())`;',
    'await prisma.$queryRaw`SELECT date_part(\'day\', now())`;',
    'await prisma.$queryRaw`SELECT EXTRACT(DAY FROM now())`;',
    'await prisma.$queryRaw`SELECT extract(dow from "createdAt") FROM "Media"`;',
  ];
  for (const src of cases) assert.ok(scan(src).some((p) => p.includes('日历函数')), src);
});

test('负控③：extract(epoch) 瞬时安全豁免 → 绿（豁免非空转）+ date_part(\'epoch\') 同豁免', () => {
  const src = [
    'await prisma.$queryRaw`SELECT EXTRACT(EPOCH FROM (now() - MIN("updatedAt")))::float8 AS age FROM "MediaFact"`;',
    'const rows = await prisma.$queryRaw`SELECT coalesce(max(EXTRACT(EPOCH FROM (now() - query_start)) * 1000), 0)::float8 AS max_wait_ms`;',
    'await prisma.$queryRaw`SELECT date_part(\'epoch\', now() - "createdAt") FROM "T"`;',
  ].join('\n');
  assert.deepEqual(scan(src), []);
});

test('显式时区日历函数：date_trunc(\'day\', now() AT TIME ZONE \'Asia/Shanghai\')——无白名单仍红（AT TIME ZONE 面）；白名单化后绿', () => {
  const src = 'await prisma.$queryRaw`SELECT date_trunc(\'day\', now() AT TIME ZONE \'Asia/Shanghai\') AS d`;';
  assert.ok(scan(src).some((p) => p.includes('AT TIME ZONE')));
  assert.deepEqual(scan(src, { atTimeZoneAllowlist: [{ file: REL, reason: '显式时区日历分桶（评审白名单）' }] }), []);
});

test('只扫 raw SQL 实参：普通字符串/注释里的日历函数不误伤', () => {
  const src = [
    '// date_trunc(\'day\', now()) 是禁用形态（注释=说明文本，不扫）',
    'const label = "date_trunc(day) 形态";',
    'await prisma.$queryRaw`SELECT "a" FROM "T" WHERE "b" = ${label}`;',
  ].join('\n');
  assert.deepEqual(scan(src), []);
});

test('SQL 注释内命中不误伤（-- 与 /* */ 剥除后再判）', () => {
  const src = 'await prisma.$queryRaw`SELECT 1 -- date_trunc(\'day\', now())\n/* ::timestamp */ FROM "T"`;';
  assert.deepEqual(scan(src), []);
});

test('测试文件豁免（*.spec.ts / test-utils / *.test.mjs）——布景/断言素材合法', () => {
  const src = 'await prisma.$queryRaw`SELECT ${v}::timestamp, date_trunc(\'day\', now())`;';
  assert.deepEqual(scanRawSqlTime(mk(src, 'apps/api/src/modules/x/claim.int.spec.ts')), []);
  assert.deepEqual(scanRawSqlTime(mk(src, 'apps/api/src/test-utils/fixture.ts')), []);
  assert.deepEqual(scanRawSqlTime(mk(src, 'scripts/x.test.mjs')), []);
});

test('Prisma.sql 包裹/Unsafe 字符串实参：负控三档同拦', () => {
  const cases = [
    'await prisma.$queryRaw(Prisma.sql`SELECT ${v}::timestamp`);',
    'await prisma.$queryRaw<{ a: Date }[]>(Prisma.sql`SELECT date_trunc(\'day\', now()) AS a`);',
    'await prisma.$executeRawUnsafe(\'UPDATE "T" SET "a" = now()::timestamp\');',
  ];
  for (const src of cases) assert.ok(scan(src).length > 0, src);
});

test('M1：JS 注释/普通字符串里的伪调用不误报（模板实参保留）', () => {
  const src = [
    '// 伪调用：await prisma.$queryRaw`SELECT ${v}::timestamp`',
    '/* 块注释：await prisma.$executeRaw`UPDATE "T" SET "a" = now()::timestamp` */',
    "const hint = 'await prisma.$queryRaw`SELECT 1::timestamp`';",
    'const hint2 = "await prisma.$queryRaw`SELECT date_trunc(\'day\', now())`";',
    'await prisma.$queryRaw`SELECT "a" FROM "T" WHERE "b" = ${hint}`;',
  ].join('\n');
  assert.deepEqual(scan(src), []);
});

test('M1：SQL 引号段误红修复——\'timestamp\' 串 / "timestamp" 标识符 / \'AT TIME ZONE\' 串=绿', () => {
  const src = [
    'await prisma.$queryRaw`SELECT \'timestamp\' AS label, "timestamp" FROM "T"`;',
    'await prisma.$queryRaw`SELECT 1 AS x WHERE note = \'AT TIME ZONE\'`;',
    'await prisma.$queryRaw`SELECT date_part(\'epoch\', now() - "createdAt") AS age FROM "T"`;',
  ].join('\n');
  assert.deepEqual(scan(src), []);
  // 非 epoch 域仍红（掩蔽不吞 date_part 首参）
  assert.ok(scan('await prisma.$queryRaw`SELECT date_part(\'day\', now())`;')
    .some((p) => p.includes('日历函数')));
});

test('M2：timezone(zone, ts) 函数形态=补偿式（与 AT TIME ZONE 同义）→ 红；白名单化 → 绿', () => {
  const src = 'await prisma.$queryRaw`SELECT timezone(\'UTC\', now()) AS n, timezone(\'Asia/Shanghai\', "createdAt") AS c FROM "T"`;';
  assert.ok(scan(src).some((p) => p.includes('补偿式时区转换')));
  assert.deepEqual(scan(src, { atTimeZoneAllowlist: [{ file: REL, reason: '显式时区分桶（评审白名单）' }] }), []);
});

test('M4：三参 date_trunc(unit, ts, tz) 显式时区放行；两参仍红', () => {
  assert.deepEqual(scan('await prisma.$queryRaw`SELECT date_trunc(\'day\', now(), \'Asia/Shanghai\') AS d`;'), []);
  assert.ok(scan('await prisma.$queryRaw`SELECT date_trunc(\'day\', now()) AS d`;')
    .some((p) => p.includes('日历函数')));
});

test('M4：白名单 reason 缺失/空白 → fail-closed throw（评审显式引入）', () => {
  const src = 'await prisma.$queryRaw`SELECT "a" AT TIME ZONE \'UTC\' FROM "T"`;';
  assert.throws(() => scan(src, { atTimeZoneAllowlist: [{ file: REL }] }), /fail-closed/);
  assert.throws(() => scan(src, { atTimeZoneAllowlist: [{ file: REL, reason: '   ' }] }), /fail-closed/);
  assert.throws(() => scan(src, { atTimeZoneAllowlist: [{ file: '', reason: 'x' }] }), /fail-closed/);
});

test('真实仓源零违规且非空转（apps/api/src + scripts + apps/api/scripts 生产面 raw 调用点 >0）', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(p);
    return p.endsWith('.ts') || p.endsWith('.mjs') ? [p] : [];
  });
  const dirs = ['apps/api/src', 'scripts', 'apps/api/scripts'];
  const files = dirs.flatMap((d) => walk(path.join(ROOT, d))).map((f) => ({
    rel: path.relative(ROOT, f).split(path.sep).join('/'),
    src: fs.readFileSync(f, 'utf8'),
  }));
  assert.deepEqual(scanRawSqlTime(files), []);
  assert.ok(countRawCalls(files) > 0, 'raw SQL 调用点计数为 0=判据空转');
});
