#!/usr/bin/env node
// scripts/check-schema-timestamptz.mjs —— C1-4（plan v3 Task C1-4；spec 2026-11-11-foundation-batch-design.md
// §3.3-5「schema 门（DateTime 必带 Timestamptz）」）：Prisma schema 时间语义静态门。
// 规则：apps/api/prisma/schema.prisma 每个 DateTime 字段（含可空 `?`/数组 `[]`）必须显式
//   `@db.Timestamptz(3)`——缺省/`@db.Timestamp[...]`/精度漂移（`(6)` 等）一律红。
// 注释行（`//`/`///`）与 model 属性行（`@@index` 等）不参与字段判定（非空转由自测 DateTime 计数锚定）。
// 退出码：0=PASS；1=FAIL（清单输出）。自测=scripts/check-schema-timestamptz.test.mjs（负控红证）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SCHEMA_REL = 'apps/api/prisma/schema.prisma';

/** 字段行：`name DateTime?[] ...`（行首缩进后第一个词=字段名；`DateTime` 后接 `?`/`[]`/空白）。
 *  M3：字段判定前剥行尾注释（引号感知——Prisma 字符串内 `//` 不误剥，如 `@default("http://…")`）。 */
const FIELD = /^\s*([A-Za-z_]\w*)\s+DateTime(\?|\[\])?(\s|$)/;
const TSZ3 = '@db.Timestamptz(3)';

/** 剥 Prisma 行尾注释（`//`/`///`；双引号串内不剥；反斜杠转义跳过）。 */
export function stripLineComment(line) {
  let inString = false;
  for (let i = 0; i < line.length - 1; i += 1) {
    const ch = line[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString && ch === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/**
 * 扫描 schema 源文本。返回 { problems, dateTimeFields, models }——dateTimeFields 供自测防扫零。
 * 违规定位=`Model.field`（跨 model 不串上下文）。
 */
export function scanSchema(src) {
  const problems = [];
  let model = '(top-level)';
  let dateTimeFields = 0;
  let models = 0;
  for (const [i, rawLine] of src.split('\n').entries()) {
    const line = rawLine.trimEnd();
    if (/^\s*\/\//.test(line)) continue;                 // 文档/普通注释行
    if (/^\s*model\s+([A-Za-z_]\w*)\s*\{/.test(line)) {
      model = line.match(/^\s*model\s+([A-Za-z_]\w*)/)[1];
      models += 1;
      continue;
    }
    if (/^\s*\}/.test(line)) { model = '(top-level)'; continue; }
    if (/^\s*@@/.test(line)) continue;                   // model 属性行（@@index/@@unique…）
    const code = stripLineComment(line);                 // M3：行尾注释不参与字段判定（不可作豁免）
    const m = code.match(FIELD);
    if (!m) continue;
    dateTimeFields += 1;
    const field = `${model}.${m[1]}`;
    if (/@db\.Timestamp(?![A-Za-z])/.test(code)) {
      problems.push(`${field}（schema.prisma:${i + 1}）声明 @db.Timestamp（无时区）——终态要求 @db.Timestamptz(3)`);
      continue;
    }
    if (!code.includes(TSZ3)) {
      const what = /@db\.Timestamptz\(\d+\)/.test(code) ? '精度漂移（须恰为 (3)）' : '缺 @db.Timestamptz(3)';
      problems.push(`${field}（schema.prisma:${i + 1}）DateTime 字段${what}`);
    }
  }
  return { problems, dateTimeFields, models };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const rel = path.join(ROOT, SCHEMA_REL);
  if (!fs.existsSync(rel)) { console.error(`check-schema-timestamptz FAIL: schema 缺失 ${SCHEMA_REL}`); process.exit(1); }
  const { problems, dateTimeFields, models } = scanSchema(fs.readFileSync(rel, 'utf8'));
  if (problems.length) { console.error(`check-schema-timestamptz FAIL:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(`check-schema-timestamptz OK: ${models} model / ${dateTimeFields} DateTime 字段全带 @db.Timestamptz(3)（spec §3.3-5 schema 门）`);
}
