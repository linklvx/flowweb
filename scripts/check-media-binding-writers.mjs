#!/usr/bin/env node
// scripts/check-media-binding-writers.mjs —— C3a-7（plan v3 Task C3a-7——spec 2026-11-11-foundation-batch
// -design.md §3.2-4 单写者+命令面两改）：MediaBinding 静态单写者门禁。
// ① delegate 写操作集（create/createMany/update/updateMany/upsert/delete/deleteMany）仅允许白名单四文件；
// ② raw SQL 写（$queryRaw/$executeRaw 窗口内 INSERT INTO/UPDATE/DELETE FROM "MediaBinding"）同白名单
//    （SELECT 不拦——读面自由）；
// ③ 测试文件（*.spec.* / test-utils/）豁免（布景/fixtures 合法——spec §3.2-4 白名单 tests 面）。
// 白名单（spec §3.2-4「白名单变更需评审」）：
//   - media-binding-projector.ts：帧级投影权威写（appendBatch inTx SAVEPOINT 段）；
//   - binding-rebuild.service.ts：全量 rebuild 分页写+stale 尾清（唯一清 dirty 面）；
//   - project-erasure.stages.ts：erasure 批删（registry 动态 delegate 形态——del[delegateKey(model)]
//     .deleteMany，字面 mediaBinding 不出现，整文件白名单）；
//   - binding-reconcile.service.ts：orphan/stale 惰性清扫（grep 现名——本批残面的兜底收敛者；
//     C3a-8 只读漂移检测化后本条目移除需评审）。
// 退出码：0=PASS；1=FAIL（清单输出）。自测=scripts/check-media-binding-writers.test.mjs（负控红证）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WRITER_ALLOWLIST = [
  /apps\/api\/src\/modules\/collab\/media-binding-projector\.ts$/,
  /apps\/api\/src\/modules\/collab\/binding-rebuild\.service\.ts$/,
  /apps\/api\/src\/modules\/collab\/project-erasure\.stages\.ts$/,
  /apps\/api\/src\/modules\/media-delivery\/binding-reconcile\.service\.ts$/,
];

const isTestFile = (rel) => rel.includes('.spec.') || rel.includes('/test-utils/') || rel.endsWith('-spec.ts');

export function scanFiles(files) {
  const problems = [];
  for (const { rel, src } of files) {
    if (isTestFile(rel)) continue;
    const allowed = WRITER_ALLOWLIST.some((rx) => rx.test(rel));
    if (allowed) continue;
    // ① delegate 写操作集（无词边界顺带覆盖 tx./prisma. 两持有形态）
    const delegateWrite = /(mediaBinding\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\()/g;
    for (const m of src.matchAll(delegateWrite)) {
      problems.push(`单写者违规：${rel} 含 mediaBinding.${m[1]} 写操作（C3a-7——MediaBinding 权威写仅白名单四文件：projector/rebuild/erasure 批删/orphan-cleanup）`);
    }
    // ② raw SQL 写文本（$executeRaw/$queryRaw 模板后 800 字符窗；SELECT 不拦）
    for (const m of src.matchAll(/\$(?:queryRaw|executeRaw)[\s\S]{0,800}?(INSERT\s+INTO\s+"MediaBinding"|UPDATE\s+"MediaBinding"\s+SET|DELETE\s+FROM\s+"MediaBinding")/gi)) {
      problems.push(`raw SQL 写 MediaBinding（单写者违规——C3a-7）：${rel}（偏移 ${m.index}）`);
    }
  }
  return problems;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const SRC = path.join(ROOT, 'apps/api/src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
  const files = walk(SRC).map((f) => ({
    rel: path.relative(ROOT, f).split(path.sep).join('/'),
    src: fs.readFileSync(f, 'utf8'),
  }));
  const problems = scanFiles(files);
  if (problems.length) { console.error(`check-media-binding-writers FAIL:\n  ${[...new Set(problems)].join('\n  ')}`); process.exit(1); }
  console.log(`check-media-binding-writers OK: ${files.length} 文件——MediaBinding 单写者（delegate+raw SQL 写面=projector/rebuild/erasure/orphan-cleanup 白名单+tests 豁免）`);
}
