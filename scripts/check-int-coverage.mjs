#!/usr/bin/env node
// Y0a-3（V27/X16）：int 完整性单源。四判据：①git ls-files 文件集 ≡ int.json 执行集（basename
// 归一——vitest name 是绝对路径）；②numFailedTests===0；③numPendingTests===0（DATABASE_URL 缺失
// 时 describe.skip 全跳=覆盖为零仍绿——必须挡）；④numTotalTests ≥ MIN。退出码=判据结果。
// 配套：apps/api package.json test:int:ci（JSON 报告落 apps/api/int.json，已 gitignore）。
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// 6 文件实测标定（2026-10-08 本地 test:int）：append 2+compact 4+hydration 9+spool 1+fence 5+
// generation-intent 5=26。X16 纪律：新增 int 文件 ⇒ 同步上调本值。
const MIN_TOTAL = Number(process.env.INT_MIN_TOTAL ?? 26);
const report = JSON.parse(readFileSync('apps/api/int.json', 'utf8'));
const ran = new Set(report.testResults.map((t) => t.name.replace(/\\/g, '/').split('/').pop()));
const files = new Set(execSync('git ls-files "apps/api/src/**/*.int.spec.ts"').toString().trim().split('\n').filter(Boolean).map((s) => s.split('/').pop()));
const missing = [...files].filter((f) => !ran.has(f));
const problems = [];
if (missing.length) problems.push(`int 静默漏跑：${missing.join(',')}`);
if ((report.numFailedTests ?? 0) > 0) problems.push(`numFailedTests=${report.numFailedTests}`);
if ((report.numPendingTests ?? 0) > 0) problems.push(`numPendingTests=${report.numPendingTests}（describe.skip?=DATABASE_URL 缺失）`);
if ((report.numTotalTests ?? 0) < MIN_TOTAL) problems.push(`numTotalTests=${report.numTotalTests} < ${MIN_TOTAL}`);
if (problems.length) { console.error('int 覆盖异常：\n' + problems.join('\n')); process.exit(1); }
console.log(`int 覆盖 ✓ ${files.size} 文件 ${report.numTotalTests} 例`);
