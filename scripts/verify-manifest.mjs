// scripts/verify-manifest.mjs —— T-prep（plan 2026-10-12-y0b-5）：verify 链 25 步单源 manifest。
// 命令与顺序一字不改照抄原 package.json "verify" && 链（HEAD=71fa57f3 基线）；授权修：
//   ① check-no-testutils-in-dist 追加 --require-dist（fail-open 修复——dist 缺失即 exit 1；
//     nest build 与本步同档硬约束，拆开即空转门禁）；
//   ② node --test 改列举式（Windows 空 glob 展开为字面量→无匹配 exit 0=假绿；元测试⑥断言列举≡磁盘集合）；
//   ③ Y0b-5 T12 新增两步（改 manifest=改基线常量=有意识动作——元测试③同步）：
//     check-migration-immutability（迁移 sha256 棘轮静态步）+ check-fresh-replay（scratch 重放双向比对 DB 步）。
// db:true = 无 DATABASE_URL 即非零退出的 DB 硬依赖（verify-indexes/check-migrate-diff/check-fresh-replay/
//   check-pricing-coverage——exit code 口径"非零"：verify-indexes 是 throw exit 1）。
// FAST_PREFIX_LEN=15：fast=纯前缀切片（裁定 24⑶ 前缀轴）；nest build(16) 与 check-no-testutils(17)
//   同在 fast 外（同档约束满足；pre-commit 静态档不跑 nest build 保 commit 可用速度）。
//   pre-commit 静态档=--tier=fast --static-only（fast∩skip-db）；出口判据只认 `pnpm verify` 全量——verify:fast 非出口判据。
export const VERIFY_STEPS = [
  { id: 'doc-gate', cmd: 'node scripts/doc-gate.mjs', db: false },
  { id: 'verify-indexes', cmd: 'node scripts/verify-indexes.mjs', db: true },
  { id: 'check-migration-additive', cmd: 'node scripts/check-migration-additive.mjs', db: false },
  { id: 'check-migration-immutability', cmd: 'node scripts/check-migration-immutability.mjs', db: false },
  { id: 'check-migrate-diff', cmd: 'node scripts/check-migrate-diff.mjs', db: true },
  { id: 'check-fresh-replay', cmd: 'node scripts/check-fresh-replay.mjs', db: true },
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
  // CI 修复（R4a'）授权插一步：api-test-heavy 紧随 api-test（heavy 串行套件——rate-gate 8MB
  // 分配与 idle-anchor 90s 实时等待移出主套件并行池，B10 根因；fast 外=插位索引 19 ≥ FAST_PREFIX_LEN
  // 15——plan T8）=28 步。
  { id: 'api-test-heavy', cmd: 'pnpm --filter @flowweb/api run test:heavy', db: false },
  { id: 'web-lint', cmd: 'pnpm --filter @flowweb/web lint', db: false },
  { id: 'check-ecosystem', cmd: 'node scripts/check-ecosystem.mjs', db: false },
  { id: 'check-spec-consistency', cmd: 'node scripts/check-spec-consistency.mjs', db: false },
  { id: 'check-collab-census', cmd: 'node scripts/check-collab-census.mjs', db: false },
  { id: 'check-collab-test-facade', cmd: 'node scripts/check-collab-test-facade.mjs', db: false },
  // Y0c T42（B3）授权插一步：check-collab-module-size 紧随 check-collab-test-facade（行数防倒退锚
  // 进 verify 链——plan T42「B3 步门」，fast 外惯例=T39b façade 同款邻位）=27 步。
  { id: 'check-collab-module-size', cmd: 'node scripts/check-collab-module-size.mjs', db: false },
  // Y1a T0 授权插一步：check-exact-pins（yjs/sharp/fast-deep-equal/file-type exact 门禁——
  // check-hocuspocus-pin 只锁 lockfile 面，本步锁 spec/overrides 面；fast 外惯例同款邻位）=29 步。
  { id: 'check-exact-pins', cmd: 'node scripts/check-exact-pins.mjs', db: false },
  { id: 'scripts-node-test', cmd: 'node --test scripts/check-collab-census.test.mjs scripts/check-collab-health.test.mjs scripts/check-collab-module-size.test.mjs scripts/check-collab-test-facade.test.mjs scripts/check-ecosystem.test.mjs scripts/check-exact-pins.test.mjs scripts/check-ledger-single-writer.test.mjs scripts/check-migration-additive.test.mjs scripts/check-migration-immutability.test.mjs scripts/check-plan-anchors.test.mjs scripts/check-spec-consistency.test.mjs scripts/deploy-guard.test.mjs scripts/env-file.test.mjs scripts/verify-chain.test.mjs apps/api/scripts/collab-soak-metrics.test.mjs apps/api/scripts/provider-late-reconnect-guard.test.mjs', db: false },
  { id: 'api-eslint', cmd: 'pnpm --filter @flowweb/api exec eslint "{src,test}/**/*.ts"', db: false },
];

export const FAST_PREFIX_LEN = 15;

// 三正交轴（裁定 24⑶）：tier=前缀长度 ⊥ skipDb=db:true 过滤（--static-only 是 CLI 层 fast∩skip-db 组合快捷）。
export function selectSteps({ tier = 'full', skipDb = false } = {}) {
  let steps = VERIFY_STEPS;
  if (tier === 'fast') steps = steps.slice(0, FAST_PREFIX_LEN);
  else if (tier !== 'full') throw new Error(`未知 tier: ${tier}`);
  return skipDb ? steps.filter((s) => !s.db) : steps;
}
