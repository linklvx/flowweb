// scripts/check-schema-timestamptz.test.mjs —— C1-4 schema 门自测（node --test scripts/ 消费——import 零副作用）。
// 负控（plan Task C1-4 Step 1 ①）：真实 schema 临时副本加一个无 Timestamptz 的 DateTime → 红；
// 豁免面非空转：真实 schema 的 DateTime 计数 >0 且全带 @db.Timestamptz(3) → 绿。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCHEMA_REL, scanSchema, stripLineComment } from './check-schema-timestamptz.mjs';

const realSchema = fs.readFileSync(new URL(`../${SCHEMA_REL}`, import.meta.url), 'utf8');

test('真实 schema 零违规（非空转：DateTime 字段计数 >0 且全带 @db.Timestamptz(3)）', () => {
  const { problems, dateTimeFields } = scanSchema(realSchema);
  assert.deepEqual(problems, []);
  assert.ok(dateTimeFields > 0, 'schema 内 DateTime 字段计数必须 >0（扫零=假绿）');
});

test('负控①：真实 schema 副本抹掉某 DateTime 的 @db.Timestamptz(3) → 恰一条红（model.field 定位）', () => {
  const line = /^\s*createdAt\s+DateTime\s+@default\(now\(\)\) @db\.Timestamptz\(3\)$/m;
  assert.ok(line.test(realSchema), '真实 schema 缺 createdAt 基准行——负控夹具漂移');
  const mutated = realSchema.replace(line, '  createdAt DateTime @default(now())');
  const { problems } = scanSchema(mutated);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /createdAt/);
  assert.match(problems[0], /Timestamptz\(3\)/);
});

test('负控②：DateTime? 可空字段缺 Timestamptz → 红', () => {
  const src = [
    'model Sample {',
    '  id        String    @id',
    '  deletedAt DateTime?',
    '  createdAt DateTime  @db.Timestamptz(3)',
    '}',
  ].join('\n');
  const { problems } = scanSchema(src);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Sample\.deletedAt/);
});

test('负控③：@db.Timestamp(3)（无时区类型）显式声明 → 红（不得被当作合法 tsz）', () => {
  const src = [
    'model Sample {',
    '  id        String   @id',
    '  createdAt DateTime @db.Timestamp(3)',
    '}',
  ].join('\n');
  const { problems } = scanSchema(src);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Timestamp/);
});

test('负控④：@db.Timestamptz(6) 精度漂移 → 红（终态钉死 (3)）', () => {
  const src = [
    'model Sample {',
    '  id        String   @id',
    '  createdAt DateTime @db.Timestamptz(6)',
    '}',
  ].join('\n');
  assert.equal(scanSchema(src).problems.length, 1);
});

test('负控⑤：DateTime[] 数组形态——缺 Timestamptz → 红；带 @db.Timestamptz(3) → 绿', () => {
  const missing = scanSchema([
    'model Sample {',
    '  id     String     @id',
    '  stamps DateTime[]',
    '}',
  ].join('\n')).problems;
  assert.equal(missing.length, 1);
  assert.match(missing[0], /Sample\.stamps/);
  assert.deepEqual(scanSchema([
    'model Sample {',
    '  id     String     @id',
    '  stamps DateTime[] @db.Timestamptz(3)',
    '}',
  ].join('\n')).problems, []);
});

test('绿：DateTime? @db.Timestamptz(3) + 注释/属性行里的 DateTime 字样不误伤', () => {
  const src = [
    '// DateTime 全列 timestamptz(3)——注释不当字段',
    'model Sample {',
    '  /// DateTime 文档注释同样不当字段',
    '  id        String    @id',
    '  deletedAt DateTime? @db.Timestamptz(3)',
    '  createdAt DateTime  @default(now()) @db.Timestamptz(3)',
    '  @@index([createdAt])',
    '}',
  ].join('\n');
  assert.deepEqual(scanSchema(src).problems, []);
});

test('多 model：违规定位带 model 名（跨 model 不串上下文）', () => {
  const src = [
    'model A {',
    '  t DateTime @db.Timestamptz(3)',
    '}',
    'model B {',
    '  t DateTime',
    '}',
  ].join('\n');
  const { problems } = scanSchema(src);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /B\.t/);
});

test('M3：行尾注释不得充当豁免——`DateTime // @db.Timestamptz(3)` → 红', () => {
  const src = [
    'model Sample {',
    '  id        String   @id',
    '  createdAt DateTime // @db.Timestamptz(3)',
    '}',
  ].join('\n');
  const { problems } = scanSchema(src);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Sample\.createdAt/);
});

test('M3：剥行尾注释引号感知——字符串内 // 不误剥；尾注剥除后字段判定正确', () => {
  assert.equal(stripLineComment('  url String @default("http://x") // tail'), '  url String @default("http://x") ');
  const src = [
    'model Sample {',
    '  id        String   @id',
    '  createdAt DateTime @default(now()) @db.Timestamptz(3) // 禁改（行尾注释放行）',
    '}',
  ].join('\n');
  assert.deepEqual(scanSchema(src).problems, []);
});
