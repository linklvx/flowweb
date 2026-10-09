#!/usr/bin/env node
// Y0a-3（V27/X16）：int 完整性单源。五判据：①git ls-files 文件集 ≡ int.json 执行集（basename
// 归一——vitest name 是绝对路径）；②numFailedTests===0；③numPendingTests===0（DATABASE_URL 缺失
// 时 describe.skip 全跳=覆盖为零仍绿——必须挡）；④numTotalTests ≥ MIN；⑤资金门 6 文件逐文件
// 下限（FILES_MIN——Y0b-1 T7）。退出码=判据结果。
// 配套：apps/api package.json test:int:ci（JSON 报告落 apps/api/int.json，已 gitignore）。
// **必须在仓根运行**（相对路径 apps/api/int.json 与 git ls-files 的 glob 均按根 CWD——CI 步骤即根 CWD）。
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename } from 'node:path';

// 12 文件实测标定（2026-10-09 本地全量 test:int）：70 例。X16 纪律：新增 int 文件 ⇒ 同步上调本值。
const MIN_TOTAL = Number(process.env.INT_MIN_TOTAL ?? 70);

// Y0b-1 资金门 6 文件逐文件下限（T7 标定——记录现状非拔高，初值为 plan 预估、实测全部 ≥ 初值故按实测落库：
// ledger-invariants 14/pricing-resolver 10/funds-four-way 3/credit-ledger 10/team-lifecycle-funds 4/di-smoke 2）。
// di-smoke.int.spec.ts 是第 6 个——漏跑=判据①执行集合≡git 集合必红。
const FILES_MIN = {
  'ledger-invariants.int.spec.ts': 14,
  'pricing-resolver.int.spec.ts': 10,
  'funds-four-way.int.spec.ts': 3,
  'credit-ledger.int.spec.ts': 10,
  'team-lifecycle-funds.int.spec.ts': 4,
  'di-smoke.int.spec.ts': 2,
};

const report = JSON.parse(readFileSync('apps/api/int.json', 'utf8'));
const perFile = new Map(report.testResults.map((t) => [basename(t.name), t.assertionResults.length]));
const ran = new Set(perFile.keys());
const files = new Set(execSync('git ls-files "apps/api/src/**/*.int.spec.ts"').toString().trim().split('\n').filter(Boolean).map((s) => s.split('/').pop()));
const missing = [...files].filter((f) => !ran.has(f));
const problems = [];
if (missing.length) problems.push(`int 静默漏跑：${missing.join(',')}`);
if ((report.numFailedTests ?? 0) > 0) problems.push(`numFailedTests=${report.numFailedTests}`);
if ((report.numPendingTests ?? 0) > 0) problems.push(`numPendingTests=${report.numPendingTests}（describe.skip?=DATABASE_URL 缺失）`);
if ((report.numTotalTests ?? 0) < MIN_TOTAL) problems.push(`numTotalTests=${report.numTotalTests} < ${MIN_TOTAL}`);
for (const [f, min] of Object.entries(FILES_MIN)) {
  const n = perFile.get(f) ?? 0;
  if (n < min) problems.push(`${f}：${n} 例 < FILES_MIN ${min}`);
}
if (problems.length) { console.error('int 覆盖异常：\n' + problems.join('\n')); process.exit(1); }
console.log(`int 覆盖 ✓ ${files.size} 文件 ${report.numTotalTests} 例`);
