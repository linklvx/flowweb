// scripts/check-media-binding-writers.test.mjs —— C3a-7 单写者门禁自测（node --test scripts/ 消费——import 零副作用）。
// 负控红证（plan Task C3a-7 Step 1 ②）：非白名单文件 mediaBinding 写操作/raw SQL 写=红；白名单四文件
// （projector/rebuild/erasure 批删/orphan-cleanup）=绿；tests=绿；media-registration bindInTx 残留形态=红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scanFiles, WRITER_ALLOWLIST, DELEGATE_WRITE_OPS } from './check-media-binding-writers.mjs';

const mk = (entries) => entries.map(([rel, src]) => ({ rel, src }));

const RELS = {
  projector: 'apps/api/src/modules/collab/media-binding-projector.ts',
  rebuild: 'apps/api/src/modules/collab/binding-rebuild.service.ts',
  erasure: 'apps/api/src/modules/collab/project-erasure.stages.ts',
  orphan: 'apps/api/src/modules/media-delivery/binding-reconcile.service.ts',
  registration: 'apps/api/src/modules/artifact-core/media-registration.service.ts',
  other: 'apps/api/src/modules/collab/some-other.service.ts',
  spec: 'apps/api/src/modules/collab/x.int.spec.ts',
};

test('正样本零误报：白名单四文件全操作集（delegate upsert/deleteMany+raw INSERT/DELETE+erasure 动态 delegate 形态）=绿', () => {
  const projectorSrc = [
    'await tx.$executeRaw`DELETE FROM "MediaBinding" WHERE id = ANY(${ids}::text[])`;',
    'await tx.$executeRaw`INSERT INTO "MediaBinding" (id, "mediaId") SELECT ... ON CONFLICT DO UPDATE`;',
    'const existing = await tx.$queryRaw`SELECT id FROM "MediaBinding" WHERE "projectId" = ${pid}::text`;',
  ].join('\n');
  const rebuildSrc = 'await this.prisma.$executeRaw`DELETE FROM "MediaBinding" WHERE "projectId" = ${pid}::text AND "nodeId" = ANY(${stale}::text[])`;';
  const orphanSrc = [
    'await tx.mediaBinding.upsert({ where: { projectId_nodeId_role_targetField_targetItemId: k }, create: row, update: { mediaId } });',
    'await tx.mediaBinding.deleteMany({ where: { id: { in: staleIds } } });',
  ].join('\n');
  // erasure 批删形态=registry 动态 delegate（del[delegateKey(model)].deleteMany——字面 mediaBinding 不出现）
  const erasureSrc = [
    'const del = tx as unknown as Record<string, DeleteManyDelegate>;',
    "for (const model of PROJECT_COLUMN_MODELS) { await del[delegateKey(model)]!.deleteMany({ where: { projectId: pid } }); }",
  ].join('\n');
  assert.deepEqual(scanFiles(mk([
    [RELS.projector, projectorSrc],
    [RELS.rebuild, rebuildSrc],
    [RELS.orphan, orphanSrc],
    [RELS.erasure, erasureSrc],
  ])), []);
});

test('① delegate 写操作集：非白名单文件 create/upsert/update/delete/deleteMany 各档=红', () => {
  for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
    const src = `await tx.mediaBinding.${op}({ where: { projectId: pid } });`;
    assert.ok(scanFiles(mk([[RELS.other, src]]))
      .some((p) => p.includes('单写者违规')), op);
  }
});

test('① 负控（质评 I-1）：Prisma 5.22 *AndReturn 四档+可选链 mediaBinding?.create=红', () => {
  for (const src of [
    'await tx.mediaBinding.createAndReturn({ data: row });',
    'await tx.mediaBinding.updateAndReturn({ where: k, data: row });',
    'await tx.mediaBinding.createManyAndReturn({ data: rows });',
    'await tx.mediaBinding.updateManyAndReturn({ where: k, data: row });',
    'await tx.mediaBinding?.create({ data: row });',
    'await tx.mediaBinding\n  ?.createMany({ data: rows });',
  ]) {
    assert.ok(scanFiles(mk([[RELS.other, src]]))
      .some((p) => p.includes('单写者违规')), src);
  }
});

test('① 防空漂移（质评 I-1）：DELEGATE_WRITE_OPS 排序后 ≡ project-lock.ts WRITE_GATE_MUTATION_OPS 源文本解析集', () => {
  const lockSrc = fs.readFileSync(
    new URL('../apps/api/src/modules/collab/project-lock.ts', import.meta.url), 'utf8');
  const block = lockSrc.match(/WRITE_GATE_MUTATION_OPS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'project-lock.ts WRITE_GATE_MUTATION_OPS Set 字面量解析失败');
  const lockOps = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(lockOps.length > 0, 'WRITE_GATE_MUTATION_OPS 解析为空');
  assert.deepEqual([...DELEGATE_WRITE_OPS].sort(), lockOps.sort());
});

test('① 负控（plan C3a-7 Step 1 ②）：media-registration 残留 bindInTx 形态（mediaBinding.upsert）=红（白名单不含本文件）', () => {
  const src = 'return tx.mediaBinding.upsert({ where: { projectId_nodeId_role_targetField_targetItemId: k }, create: data, update: { mediaId: data.mediaId } });';
  assert.ok(scanFiles(mk([[RELS.registration, src]]))
    .some((p) => p.includes('单写者违规')));
});

test('② raw SQL 写：非白名单文件 INSERT INTO/UPDATE/DELETE FROM "MediaBinding"=红；SELECT 不误伤=绿', () => {
  for (const stmt of [
    'INSERT INTO "MediaBinding" (id) VALUES (1)',
    'UPDATE "MediaBinding" SET "mediaId" = 2',
    'DELETE FROM "MediaBinding" WHERE "projectId" = 1',
  ]) {
    const src = 'await prisma.$executeRaw`' + stmt + '`;';
    assert.ok(scanFiles(mk([[RELS.other, src]]))
      .some((p) => p.includes('raw SQL 写 MediaBinding')), stmt);
  }
  const sel = 'const r = await prisma.$queryRaw`SELECT id FROM "MediaBinding" WHERE "projectId" = 1`;';
  assert.deepEqual(scanFiles(mk([[RELS.other, sel]])), []);
});

test('② 负控（质评 I-2）：schema 限定三形态/TRUNCATE/Unsafe 字符串/大小写混写/换行/长 CTE 模板=红；泛型+Prisma.sql 的 SELECT=绿', () => {
  const longCte = 'await prisma.$executeRaw`WITH c AS (SELECT ' + 'x'.repeat(900) + ' AS pad)\n'
    + 'INSERT INTO "MediaBinding" (id) SELECT pad FROM c`;';
  const cases = [
    'await prisma.$executeRaw`UPDATE public."MediaBinding" SET "mediaId" = 2`;',
    'await prisma.$executeRaw`INSERT INTO public."MediaBinding" (id) VALUES (1)`;',
    'await prisma.$executeRaw`DELETE FROM public."MediaBinding" WHERE "projectId" = 1`;',
    'await prisma.$executeRaw`TRUNCATE TABLE "MediaBinding"`;',
    "await prisma.$executeRawUnsafe('DELETE FROM public.\"MediaBinding\" WHERE 1=1');",
    'await prisma.$executeRawUnsafe("update public.\\"MediaBinding\\" set \\"mediaId\\" = 2");',
    'await prisma.$executeRaw`\nDELETE FROM\n  public."MediaBinding"\nWHERE 1=1`;',
    "await prisma.$executeRaw(Prisma.sql`DELETE FROM public.\"MediaBinding\"`);",
    'const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`INSERT INTO "MediaBinding" (id) VALUES (${id})`);',
    longCte,
  ];
  for (const src of cases) {
    assert.ok(scanFiles(mk([[RELS.other, src]]))
      .some((p) => p.includes('raw SQL 写 MediaBinding')), src);
  }
  const sel = 'const r = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM public."MediaBinding" WHERE "projectId" = ${pid}::text`);';
  assert.deepEqual(scanFiles(mk([[RELS.other, sel]])), []);
});

test('③ 测试文件豁免：spec/test-utils 的 delegate 写+raw 写=绿（白名单 tests 面——spec/fixtures 布景合法）', () => {
  const src = [
    'await prisma.mediaBinding.deleteMany({ where: { projectId: PID } });',
    'await prisma.mediaBinding.create({ data: row });',
    'await prisma.$executeRaw`DELETE FROM "MediaBinding" WHERE "projectId" = ${pid}::text`;',
  ].join('\n');
  assert.deepEqual(scanFiles(mk([[RELS.spec, src]])), []);
  assert.deepEqual(scanFiles(mk([['apps/api/src/test-utils/db-fixtures.ts', src]])), []);
});

test('④ 白名单登记面：恰四文件（projector/rebuild/erasure/orphan-cleanup=binding-reconcile——C3a-8 只读化后移除 orphan 条目需评审）', () => {
  assert.equal(WRITER_ALLOWLIST.length, 4);
  assert.ok(WRITER_ALLOWLIST.every((rx) => rx instanceof RegExp));
});
