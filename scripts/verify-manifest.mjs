// scripts/verify-manifest.mjs —— T-prep（plan 2026-10-12-y0b-5）：verify 链 23 步单源 manifest。
// 命令与顺序一字不改照抄原 package.json "verify" && 链（HEAD=71fa57f3 基线）；仅两处同批授权修：
//   ① check-no-testutils-in-dist 追加 --require-dist（fail-open 修复——dist 缺失即 exit 1；
//     nest build 与本步同档硬约束，拆开即空转门禁）；
//   ② node --test 改列举式（Windows 空 glob 展开为字面量→无匹配 exit 0=假绿；元测试⑥断言列举≡磁盘集合）。
// db:true = 无 DATABASE_URL 即非零退出的 DB 硬依赖（步骤 2/4/5——exit code 口径"非零"：verify-indexes 是 throw exit 1）。
// FAST_PREFIX_LEN=13：fast=纯前缀切片（裁定 24⑶ 前缀轴）；nest build(14) 与 check-no-testutils(15)
//   同在 fast 外（同档约束满足；pre-commit 静态档不跑 nest build 保 commit 可用速度）。
//   pre-commit 静态档=--tier=fast --static-only（fast∩skip-db）；出口判据只认 `pnpm verify` 全量——verify:fast 非出口判据。
export const VERIFY_STEPS = [
  { id: 'doc-gate', cmd: 'node scripts/doc-gate.mjs', db: false },
  { id: 'verify-indexes', cmd: 'node scripts/verify-indexes.mjs', db: true },
  { id: 'check-migration-additive', cmd: 'node scripts/check-migration-additive.mjs', db: false },
  { id: 'check-migrate-diff', cmd: 'node scripts/check-migrate-diff.mjs', db: true },
  { id: 'check-pricing-coverage', cmd: 'node scripts/check-pricing-coverage.mjs', db: true },
  { id: 'check-ledger-single-writer', cmd: 'node scripts/check-ledger-single-writer.mjs', db: false },
  { id: 'check-nginx-budget', cmd: 'node scripts/check-nginx-budget.mjs', db: false },
  { id: 'shared-build', cmd: 'pnpm --filter @flowweb/shared build', db: false },
  { id: 'shared-typecheck', cmd: 'pnpm --filter @flowweb/shared run typecheck', db: false },
  { id: 'shared-test', cmd: 'pnpm --filter @flowweb/shared test -- --run', db: false },
  { id: 'web-tsc', cmd: 'pnpm --filter @flowweb/web exec tsc --noEmit', db: false },
  { id: 'api-tsc', cmd: 'pnpm --filter @flowweb/api exec tsc --noEmit', db: false },
  { id: 'api-tsc-scripts', cmd: 'pnpm --filter @flowweb/api exec tsc -p tsconfig.scripts.json --noEmit', db: false },
  { id: 'api-nest-build', cmd: 'pnpm --filter @flowweb/api exec nest build', db: false },
  { id: 'check-no-testutils-in-dist', cmd: 'node scripts/check-no-testutils-in-dist.mjs --require-dist', db: false },
  { id: 'web-test', cmd: 'pnpm --filter @flowweb/web test -- --run', db: false },
  { id: 'api-test', cmd: 'pnpm --filter @flowweb/api test -- --run', db: false },
  { id: 'web-lint', cmd: 'pnpm --filter @flowweb/web lint', db: false },
  { id: 'check-ecosystem', cmd: 'node scripts/check-ecosystem.mjs', db: false },
  { id: 'check-spec-consistency', cmd: 'node scripts/check-spec-consistency.mjs', db: false },
  { id: 'check-collab-census', cmd: 'node scripts/check-collab-census.mjs', db: false },
  { id: 'scripts-node-test', cmd: 'node --test scripts/check-collab-census.test.mjs scripts/check-ecosystem.test.mjs scripts/check-ledger-single-writer.test.mjs scripts/check-plan-anchors.test.mjs scripts/check-spec-consistency.test.mjs scripts/deploy-guard.test.mjs scripts/env-file.test.mjs scripts/verify-chain.test.mjs', db: false },
  { id: 'api-eslint', cmd: 'pnpm --filter @flowweb/api exec eslint "{src,test}/**/*.ts"', db: false },
];

export const FAST_PREFIX_LEN = 13;

// 三正交轴（裁定 24⑶）：tier=前缀长度 ⊥ skipDb=db:true 过滤（--static-only 是 CLI 层 fast∩skip-db 组合快捷）。
export function selectSteps({ tier = 'full', skipDb = false } = {}) {
  let steps = VERIFY_STEPS;
  if (tier === 'fast') steps = steps.slice(0, FAST_PREFIX_LEN);
  else if (tier !== 'full') throw new Error(`未知 tier: ${tier}`);
  return skipDb ? steps.filter((s) => !s.db) : steps;
}
