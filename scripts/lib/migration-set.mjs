// scripts/lib/migration-set.mjs —— Y0b-5 T12-0a：post-restart 迁移集合断言纯判据（deploy-guard 消费；
// 零副作用可测——gate-decision.mjs 同款分层）。「仓内」独立源=scripts/migration-checksums.json 基线键
// （T12-0b 棘轮基线，经 scripts tar 上传服务器——与远端树物理同源但产生于本地仓库，先于传输落定）。
export function diffMigrationDirs(remoteDirs, baselineDirs) {
  const remote = new Set(remoteDirs), baseline = new Set(baselineDirs);
  const extraOnRemote = [...remote].filter((d) => !baseline.has(d)).sort();
  const missingOnRemote = [...baseline].filter((d) => !remote.has(d)).sort();
  return { ok: extraOnRemote.length === 0 && missingOnRemote.length === 0, extraOnRemote, missingOnRemote };
}

// _prisma_migrations applied 行（finished_at IS NOT NULL）name 集合 ⊆ 仓内基线键。
// 「仓有库无」不是本断言对象（部署中点=待 migrate deploy 补齐）。
export function diffAppliedMigrations(appliedNames, baselineDirs) {
  const baseline = new Set(baselineDirs);
  const dbHasRepoLacks = [...new Set(appliedNames)].filter((n) => !baseline.has(n)).sort();
  return { ok: dbHasRepoLacks.length === 0, dbHasRepoLacks };
}
