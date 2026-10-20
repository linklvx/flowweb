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

// 21 文件实测标定（2026-10-10 本地全量 test:int，Y0b-2 T9 出口）：141 例。X16 纪律：新增 int 文件 ⇒ 同步上调本值。
// Y0b-5 T9 增补（write-frozen-chain 2 例）+存量漂移 1（group-idempotency 16>登记 15）→实测 144。
// Y0b-5 T16 增补（collab-pg-breaker 4 例）→148。
// Y0c T22 增补（collab-residency-durability 2 例——Z144 耐久双向）→150。
// Y0c T31 增补（worker-naming 3 例——§0.6 偏离 46 连接命名分裂根因红测）→153。
// Y0c T33 增补（group-idempotency ⑯ stalled 重投三联〔偏离 51〕+collab-write-endpoint Z125-4
// drain×write-batch 相遇——D 出口判据）→155。
// Y1a+Y1b S0.1 增补（media-fact-outbox 2 例——outbox factType 唯一键真 PG 实证）→实测全量落 166
//（155 基数此间漂移 +9 未随记——本次按实测口径校准，非拔高）。
// Y1a+Y1b T4 增补（media-registration 6+storage-upload 6=12 例——两新文件）→178；
// spec 收口 bindInTx current-state 分歧场景 +1 例（实测 179，闸门 ≥ 语义不随单例上调）。
// Y1a+Y1b T5 增补（media-content 7 例——新文件〔单门四例+删旁路两例+ready 真 S3 全链〕+
// storage-upload +1〔T5 写 ACL viewer presign 403〕）→187。
const MIN_TOTAL = Number(process.env.INT_MIN_TOTAL ?? 187);

// Y0b-1 资金门 6 文件逐文件下限（T7 标定——记录现状非拔高，初值为 plan 预估、实测全部 ≥ 初值故按实测落库：
// ledger-invariants 14/pricing-resolver 10/funds-four-way 3/credit-ledger 10/team-lifecycle-funds 4/di-smoke 2）。
// di-smoke.int.spec.ts 是第 6 个——位于 apps/api/src/ 根级，git glob（**/*.int.spec.ts）不匹配根级文件，
// 漏跑时判据①不红；真正兜底=下方 FILES_MIN 的 di-smoke 条目（漏跑必红）。
// Y0b-2 T9 增补九文件（T0-T8 新 int，下限=当日实测用例数——同"记录现状非拔高"口径）：
// monthly-used-derived 5/ledger-trigger 6/provider-adapters 5/deadline-reaper 7/deliver-refund 12/
// exec-partial-success 8/group-idempotency 15/sv-admission 6/admin-idempotency 5。
const FILES_MIN = {
  'ledger-invariants.int.spec.ts': 14,
  'pricing-resolver.int.spec.ts': 10,
  'funds-four-way.int.spec.ts': 3,
  'credit-ledger.int.spec.ts': 10,
  'team-lifecycle-funds.int.spec.ts': 4,
  'di-smoke.int.spec.ts': 2,
  'monthly-used-derived.int.spec.ts': 5,
  'ledger-trigger.int.spec.ts': 6,
  'provider-adapters.int.spec.ts': 5,
  'deadline-reaper.int.spec.ts': 7,
  'deliver-refund.int.spec.ts': 12,
  'exec-partial-success.int.spec.ts': 8,
  'group-idempotency.int.spec.ts': 18,   // Y0c T33：⑯ stalled 重投三联（偏离 51）；T34 微修③：16→18 实测对齐（MIN_TOTAL 155 维持）
  'sv-admission.int.spec.ts': 6,
  'admin-idempotency.int.spec.ts': 5,
  'write-frozen-chain.int.spec.ts': 2,   // Y0b-5 T9：write-frozen 断言链 int 等价用例
  'worker-naming.int.spec.ts': 3,        // Y0c T31：偏离 46 命名分裂机制/修复/生产结构三 case
  'collab-write-endpoint.int.spec.ts': 5,   // Y0c T33：T27 端到端四例+Z125-4 drain×write-batch 相遇
  'media-fact-outbox.int.spec.ts': 2,       // Y1a+Y1b S0.1：factType 入键（natural/state 共存+同类 P2002）
  'media-content.int.spec.ts': 7,           // Y1a+Y1b T5：单门四例+删旁路两例+ready 真 S3 全链（「CI 真 S3」出口判据本体）
  'storage-upload.int.spec.ts': 7,          // Y1a+Y1b T4 六例+T5 写 ACL viewer presign 403（真权限链）
};

const report = JSON.parse(readFileSync('apps/api/int.json', 'utf8'));
const perFile = new Map(report.testResults.map((t) => [basename(t.name), t.assertionResults.length]));
const ran = new Set(perFile.keys());
// Y0b-2 T8（Z118）：pathspec 补根级第二模式——di-smoke.int.spec.ts 在 apps/api/src/ 根，**/*.int.spec.ts
// 不匹配根级文件（漏跑时判据①不红，FILES_MIN 兜底是残缺形态——修门禁非绕）
const files = new Set(execSync('git ls-files "apps/api/src/**/*.int.spec.ts" "apps/api/src/*.int.spec.ts"').toString().trim().split('\n').filter(Boolean).map((s) => s.split('/').pop()));
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
