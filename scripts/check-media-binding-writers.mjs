#!/usr/bin/env node
// scripts/check-media-binding-writers.mjs —— C3a-7（plan v3 Task C3a-7——spec 2026-11-11-foundation-batch
// -design.md §3.2-4 单写者+命令面两改）：MediaBinding 静态单写者门禁。
// ① delegate 写操作集=DELEGATE_WRITE_OPS 九项（create/createMany/update/updateMany/upsert/
//    createAndReturn/updateAndReturn/createManyAndReturn/updateManyAndReturn——与 project-lock.ts
//    WRITE_GATE_MUTATION_OPS 防空漂移同集，自测解析源文本 deepEqual）+DELEGATE_DELETE_OPS 两项
//    （delete/deleteMany——project-lock 锁门禁不含删档，本门禁写面必须含）；可选链 `?.` 同拦。
//    上述操作仅允许白名单三文件；
// ② raw SQL 写：取 $queryRaw/$executeRaw/$executeRawUnsafe/$queryRawUnsafe 调用实参文本（支撑泛型
//    `$queryRaw<...>`、`(Prisma.sql`...`)` 包裹、直接模板字面量、Unsafe 字符串实参——平衡括号扫描，
//    模板/字符串内括号不计深），再判写形态 INSERT [INTO] [ONLY]/UPDATE [ONLY] ... SET/DELETE FROM/
//    TRUNCATE [TABLE] 的 "MediaBinding"（可带 schema 限定 `public.`/`"public".`——带引号 schema 同拦，
//    大小写不敏感）——SELECT 不拦（读面自由）；
// ③ 测试文件（*.spec.* / test-utils/）豁免（布景/fixtures 合法——spec §3.2-4 白名单 tests 面）。
// 【已知边界（静态门=回归绊线非对抗性沙箱）】变量间接（`const sql = '...'; $executeRaw(sql)`）、
// delegate 别名解构（`const { mediaBinding: b } = tx`）、动态拼接表名不覆盖——绕过需评审显式引入。
// 白名单（spec §3.2-4「白名单变更需评审」——C3a-8 评审裁定 4→3：binding-reconcile 已只读化、零
// MediaBinding 写，白名单收缩=正确方向）：
//   - media-binding-projector.ts：帧级投影权威写（appendBatch inTx SAVEPOINT 段）；
//   - binding-rebuild.service.ts：全量 rebuild 分页写+stale 尾清（唯一清 dirty 面）；
//   - project-erasure.stages.ts：erasure 批删（registry 动态 delegate 形态——del[delegateKey(model)]
//     .deleteMany，字面 mediaBinding 不出现，整文件白名单）。
// 退出码：0=PASS；1=FAIL（清单输出）。自测=scripts/check-media-binding-writers.test.mjs（负控红证）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WRITER_ALLOWLIST = [
  /apps\/api\/src\/modules\/collab\/media-binding-projector\.ts$/,
  /apps\/api\/src\/modules\/collab\/binding-rebuild\.service\.ts$/,
  /apps\/api\/src\/modules\/collab\/project-erasure\.stages\.ts$/,
];

/** Prisma 5.22 delegate 变更写操作（≡ project-lock.ts WRITE_GATE_MUTATION_OPS 九项——自测防空漂移；
 *  含 project-lock 前瞻词表措辞=同集单源）。 */
export const DELEGATE_WRITE_OPS = [
  'create', 'createMany', 'update', 'updateMany', 'upsert',
  'createAndReturn', 'updateAndReturn', 'createManyAndReturn', 'updateManyAndReturn',
];

/** delegate 删档操作（project-lock 锁门禁不含——本门禁写面必须含：删行同样是 MediaBinding 写）。 */
export const DELEGATE_DELETE_OPS = ['delete', 'deleteMany'];

const ALL_DELEGATE_WRITE_OPS = [...DELEGATE_WRITE_OPS, ...DELEGATE_DELETE_OPS]
  .sort((a, b) => b.length - a.length);

/** delegate 写调用（可选链 `?.` 同拦——长名先行减少回溯）。 */
const DELEGATE_WRITE_CALL = new RegExp(
  `mediaBinding\\s*\\??\\.\\s*(${ALL_DELEGATE_WRITE_OPS.join('|')})\\s*\\(`, 'g');

/** raw 调用头（方法名泛型 `<...>` 可选；标签模板/括号实参两形态——Unsafe 后缀名靠 \b 区分）。 */
const RAW_CALL = /\$(?:queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\b(?:<[^()]*>)?\s*(?=[(`])/g;

/** raw 实参内写形态（schema 限定 `public.`/`"public".`/CTE 长前文无关——在实参全文上判；
 *  C3a-8 硬化：带引号 schema 与 `INSERT INTO [ONLY]`/`UPDATE [ONLY]` 形态同拦）。 */
const RAW_WRITE_FORMS = [
  /INSERT\s+INTO\s+(?:ONLY\s+)?(?:"?\w+"?\.)?"MediaBinding"/i,
  /UPDATE\s+(?:ONLY\s+)?(?:"?\w+"?\.)?"MediaBinding"\s+SET/i,
  /DELETE\s+FROM\s+(?:"?\w+"?\.)?"MediaBinding"/i,
  /TRUNCATE(?:\s+TABLE)?\s+(?:"?\w+"?\.)?"MediaBinding"/i,
];

/** 跳过引号段（返回闭合引号下标；\x 转义跳过；未闭合=末尾）。 */
function skipQuoted(src, i, quote) {
  for (let j = i + 1; j < src.length; j += 1) {
    if (src[j] === '\\') { j += 1; continue; }
    if (src[j] === quote) return j;
  }
  return src.length;
}

/** 跳过模板字面量（返回闭合反引号下标；${} 插值内字符串/嵌套模板递归跳过）。 */
function skipTemplate(src, i) {
  for (let j = i + 1; j < src.length; j += 1) {
    const ch = src[j];
    if (ch === '\\') { j += 1; continue; }
    if (ch === '`') return j;
    if (ch === '$' && src[j + 1] === '{') {
      let depth = 1;
      for (j += 2; j < src.length && depth > 0; j += 1) {
        if (src[j] === '`') { j = skipTemplate(src, j); continue; }
        if (src[j] === "'" || src[j] === '"') { j = skipQuoted(src, j, src[j]); continue; }
        if (src[j] === '{') depth += 1;
        else if (src[j] === '}') depth -= 1;
      }
      j -= 1;
    }
  }
  return src.length;
}

/** raw 调用实参文本：从 `(` 起平衡括号扫描（模板/字符串内括号不计深——SQL 内括号安全）。 */
export function rawCallArgText(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '`') { i = skipTemplate(src, i); continue; }
    if (ch === "'" || ch === '"') { i = skipQuoted(src, i, ch); continue; }
    if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl === -1 ? src.length : nl; continue; }
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? src.length : end + 1; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return src.slice(openIdx + 1);
}

const isTestFile = (rel) => rel.includes('.spec.') || rel.includes('/test-utils/') || rel.endsWith('-spec.ts');

export function scanFiles(files) {
  const problems = [];
  for (const { rel, src } of files) {
    if (isTestFile(rel)) continue;
    const allowed = WRITER_ALLOWLIST.some((rx) => rx.test(rel));
    if (allowed) continue;
    // ① delegate 写操作集（无词边界顺带覆盖 tx./prisma. 两持有形态）
    DELEGATE_WRITE_CALL.lastIndex = 0;
    for (const m of src.matchAll(DELEGATE_WRITE_CALL)) {
      problems.push(`单写者违规：${rel} 含 mediaBinding.${m[1]} 写操作（C3a-7/C3a-8——MediaBinding 权威写仅白名单三文件：projector/rebuild/erasure 批删）`);
    }
    // ② raw SQL 写：取调用实参文本再判写形态（SELECT 不拦）
    RAW_CALL.lastIndex = 0;
    for (const m of src.matchAll(RAW_CALL)) {
      const argIdx = m.index + m[0].length;
      const argRaw = src[argIdx] === '`'
        ? src.slice(argIdx + 1, skipTemplate(src, argIdx))   // 标签模板实参
        : rawCallArgText(src, argIdx);                       // 括号实参（字符串/Prisma.sql 包裹）
      const arg = argRaw.replace(/\\(["'])/g, '$1');         // JS 字符串内转义引号还原（"public.\"X\""）
      if (RAW_WRITE_FORMS.some((rx) => rx.test(arg))) {
        problems.push(`raw SQL 写 MediaBinding（单写者违规——C3a-7）：${rel}（偏移 ${m.index}）`);
      }
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
  console.log(`check-media-binding-writers OK: ${files.length} 文件——MediaBinding 单写者（delegate+raw SQL 写面=projector/rebuild/erasure 白名单〔C3a-8：binding-reconcile 只读化移除〕+tests 豁免）`);
}
