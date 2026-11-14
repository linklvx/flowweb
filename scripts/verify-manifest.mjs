// scripts/verify-manifest.mjs —— T-prep（plan 2026-10-12-y0b-5）：verify 链 25 步单源 manifest。
// 命令与顺序一字不改照抄原 package.json "verify" && 链（HEAD=71fa57f3 基线）；授权修：
//   ① check-no-testutils-in-dist 追加 --require-dist（fail-open 修复——dist 缺失即 exit 1；
//     nest build 与本步同档硬约束，拆开即空转门禁）；
//   ② node --test 改列举式（Windows 空 glob 展开为字面量→无匹配 exit 0=假绿；元测试⑥断言列举≡磁盘集合）；
//   ③ Y0b-5 T12 新增两步（改 manifest=改基线常量=有意识动作——元测试③同步）：
//     check-migration-immutability（迁移 sha256 棘轮静态步）+ check-fresh-replay（scratch 重放双向比对 DB 步）。
// db:true = 无 DATABASE_URL 即非零退出的 DB 硬依赖（verify-indexes/check-migrate-diff/check-fresh-replay/
//   check-pricing-coverage——exit code 口径"非零"：verify-indexes 是 throw exit 1）。
// FAST_PREFIX_LEN=16：fast=纯前缀切片（裁定 24⑶ 前缀轴）；nest build(17) 与 check-no-testutils(18)
//   同在 fast 外（同档约束满足；pre-commit 静态档不跑 nest build 保 commit 可用速度）。
//   Y1c T5c 授权移位：check-collab-census 自静态门组（原 check-spec-consistency 邻位）前移至
//   api-tsc-scripts 后（fast 尾）——census 静态门进 verify fast（plan T5c 配套节：六组新检查
//   ㉘㉙㉚㉛㉜㉝ 未分类字段/读者清单/裸构造/doc.exec 零增长/applyUpdate 白名单/DirectConnection）；
//   步骤总数不变（30），fast 15→16。shared dist 依赖不变（shared-build(10) 在前恒新）。
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
  // Y1c T5c 授权移位：check-collab-census 前移至 fast 尾（原 check-spec-consistency 邻位——
  // census 静态门进 verify fast；30 步总数不变，FAST_PREFIX_LEN 15→16；移位理由见文件头注）。
  { id: 'check-collab-census', cmd: 'node scripts/check-collab-census.mjs', db: false },
  { id: 'api-nest-build', cmd: 'pnpm --filter @flowweb/api exec nest build', db: false },
  { id: 'check-no-testutils-in-dist', cmd: 'node scripts/check-no-testutils-in-dist.mjs --require-dist', db: false },
  { id: 'web-test', cmd: 'pnpm --filter @flowweb/web test -- --run', db: false },
  { id: 'api-test', cmd: 'pnpm --filter @flowweb/api test -- --run', db: false },
  // CI 修复（R4a'）授权插一步：api-test-heavy 紧随 api-test（heavy 串行套件——rate-gate 8MB
  // 分配与 idle-anchor 90s 实时等待移出主套件并行池，B10 根因；fast 外=插位索引 19 ≥ FAST_PREFIX_LEN
  // 15——plan T8）=28 步。
  { id: 'api-test-heavy', cmd: 'pnpm --filter @flowweb/api run test:heavy', db: false },
  // Y1c T33 授权插一步：bench-load-smoke 紧随 api-test-heavy（负载基准 PR smoke 档——spec §9.4「PR 只跑
  // smoke，nightly/release 跑硬门」两档接线；fast 外=快跑位；db:true 真 PG 依赖；dist 由 api-nest-build
  // 步产出恒新；full 硬门档=独立跑批不进 verify 链——固定 runner 口径 runbook §17）=31 步。
  { id: 'bench-load-smoke', cmd: 'node scripts/bench-load.mjs --profile smoke --confirm --skip-build', db: true },
  { id: 'web-lint', cmd: 'pnpm --filter @flowweb/web lint', db: false },
  { id: 'check-ecosystem', cmd: 'node scripts/check-ecosystem.mjs', db: false },
  { id: 'check-spec-consistency', cmd: 'node scripts/check-spec-consistency.mjs', db: false },
  { id: 'check-collab-test-facade', cmd: 'node scripts/check-collab-test-facade.mjs', db: false },
  // Y0c T42（B3）授权插一步：check-collab-module-size 紧随 check-collab-test-facade（行数防倒退锚
  // 进 verify 链——plan T42「B3 步门」，fast 外惯例=T39b façade 同款邻位）=27 步。
  { id: 'check-collab-module-size', cmd: 'node scripts/check-collab-module-size.mjs', db: false },
  // Y1a T0 授权插一步：check-exact-pins（yjs/sharp/fast-deep-equal/file-type exact 门禁——
  // check-hocuspocus-pin 只锁 lockfile 面，本步锁 spec/overrides 面；fast 外惯例同款邻位）。
  { id: 'check-exact-pins', cmd: 'node scripts/check-exact-pins.mjs', db: false },
  // Y1a T3 授权插一步：check-plan-census（plan 契约 census——键集单源四处一致/DocNodeRecord 零残留/
  // execSeq 裸比较禁令/compareExecSeq 定义唯一；依赖 shared dist——shared-build 步在前恒新）=30 步。
  { id: 'check-plan-census', cmd: 'node scripts/check-plan-census.mjs', db: false },
  // C3a-7 授权插一步：check-media-binding-writers（MediaBinding 静态单写者门禁——spec 2026-11-11
  // foundation-batch §3.2-4/§4「单写者静态门（delegate+raw SQL）入 verify 链」；白名单四文件
  // =projector/rebuild/erasure 批删/orphan-cleanup（binding-reconcile），fast 外惯例同款邻位）=32 步。
  { id: 'check-media-binding-writers', cmd: 'node scripts/check-media-binding-writers.mjs', db: false },
  // C1-4 授权插两步（M6：静态门前移到 db 门之前）：schema 门（DateTime 必带 @db.Timestamptz(3)）+
  // raw SQL 时间语义门（无时区 timestamp/补偿式时区转换〔AT TIME ZONE/timezone()〕/无显式时区日历函数；
  // extract(epoch)/三参 date_trunc(tz) 放行）——spec 2026-11-11 foundation-batch §3.3-5/§4「三门禁」中的
  // 两个静态门，纯文本扫描（无 DB 依赖），fast 外惯例同款邻位（第三门=双时区 int spec，随 test:int 池）。
  { id: 'check-schema-timestamptz', cmd: 'node scripts/check-schema-timestamptz.mjs', db: false },
  { id: 'check-raw-sql-time', cmd: 'node scripts/check-raw-sql-time.mjs', db: false },
  // C1-2 授权插一步：check-rebaseline-delta（三向 allowlist 对象门——spec 2026-11-11 foundation-batch
  // §3.3-3/§4「三向 allowlist 对象门（C1 一次性）」；每次真实重放 schema-before-v2.sql 与新 init 两临时库，
  // 八组对象 delta 与入库 allowlist 双向闭合；db:true 真 PG 重放依赖，fast 外惯例同款邻位）。
  { id: 'check-rebaseline-delta', cmd: 'node scripts/check-rebaseline-delta.mjs', db: true },
  // C1-5 授权插一步：check-updated-at-triggers（updatedAt 触发器 coverage 门——spec 2026-11-11
  // foundation-batch §3.3-2「每个 updatedAt 表必挂，新增表漏挂即红」/§4 新门禁入 verify 链；DB
  // introspection〔information_schema.columns+pg_trigger/pg_get_triggerdef〕实测目标库已挂且启用——
  // schema 文本无法证「已挂」；db:true 真库目录依赖，fast 外惯例同款邻位）=36 步。
  { id: 'check-updated-at-triggers', cmd: 'node scripts/check-updated-at-triggers.mjs', db: true },
  // 登记（C1-5 质量评审 M8，不修）：本步 db:false 但列举集含 DB 用例（check-updated-at-triggers.test.mjs
  //   的真实 DB/CLI scratch/exit 2 面）——既有形态：full verify 恒带 DB（前方 db:true 门先失败），fast 前缀
  //   不含本步（FAST_PREFIX_LEN=16）；无 DB 时用例按 skip 自跳且 coverage 门本体在 [34] 步独立执行，无假绿面。
  { id: 'scripts-node-test', cmd: 'node --test scripts/check-collab-census.test.mjs scripts/check-collab-health.test.mjs scripts/check-collab-module-size.test.mjs scripts/check-collab-test-facade.test.mjs scripts/check-ecosystem.test.mjs scripts/check-exact-pins.test.mjs scripts/check-gate-evidence.test.mjs scripts/check-ledger-single-writer.test.mjs scripts/check-media-binding-writers.test.mjs scripts/check-migration-additive.test.mjs scripts/check-migration-immutability.test.mjs scripts/check-plan-anchors.test.mjs scripts/check-plan-census.test.mjs scripts/check-raw-sql-time.test.mjs scripts/check-rebaseline-delta.test.mjs scripts/check-schema-timestamptz.test.mjs scripts/check-spec-consistency.test.mjs scripts/check-updated-at-triggers.test.mjs scripts/collab-renumber-layer.test.mjs scripts/collab-rebuild-gen.test.mjs scripts/deploy-sh-pgrestore.test.mjs scripts/dev-reset-canvas.test.mjs scripts/deploy-guard.test.mjs scripts/drill-fault.test.mjs scripts/env-file.test.mjs scripts/load-bench.test.mjs scripts/verify-chain.test.mjs apps/api/scripts/collab-soak-metrics.test.mjs apps/api/scripts/hocuspocus-destroy-contract.test.mjs', db: false },
  // Y1c T20 出口前置根修：glob 对齐实际布局 "{src,test}/**/*.ts"→"src/**/*.ts"——apps/api 无 test/
  // 目录（api 测试=src/**/*.spec.ts 同仓共置），原 glob 模式不匹配即步红（ESLint fatal——任何环境
  // 必红=门自身预置缺陷，非代码回归）。同批同修 apps/api package.json lint 脚本同款 glob。
  { id: 'api-eslint', cmd: 'pnpm --filter @flowweb/api exec eslint "src/**/*.ts"', db: false },
];

export const FAST_PREFIX_LEN = 16;

// 三正交轴（裁定 24⑶）：tier=前缀长度 ⊥ skipDb=db:true 过滤（--static-only 是 CLI 层 fast∩skip-db 组合快捷）。
export function selectSteps({ tier = 'full', skipDb = false } = {}) {
  let steps = VERIFY_STEPS;
  if (tier === 'fast') steps = steps.slice(0, FAST_PREFIX_LEN);
  else if (tier !== 'full') throw new Error(`未知 tier: ${tier}`);
  return skipDb ? steps.filter((s) => !s.db) : steps;
}
