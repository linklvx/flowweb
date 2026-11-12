# ADR：C1-1 schema rebaseline 基线（schema-before-v2）

- 日期：2026-11-12（spec 评审收口 2026-11-13：Important-1 去 mediaId FK）
- 对象：地基修复批 plan v3 Task C1-1 Step 1（plan `docs/superpowers/plans/2026-11-12-foundation-batch.md:201`；spec `docs/superpowers/specs/2026-11-11-foundation-batch-design.md` §3.3 C1）
- 旧 commit：`ab622d60`（tag `pre-c1-rebaseline`）

## 基线来源

旧链（`apps/api/prisma/migrations/` 24 个目录，含 C2/C3a 全部 delta）在 scratch 库
`flowweb_prebatch_replay` **原样 `prisma migrate deploy` 重放**后取快照——不取开发库现态
（第六轮 P1-2：覆盖 C2/C3a/C1 全部 delta，避免环境漂移混入基线）。

- 重放机制：`DATABASE_URL=.../flowweb_prebatch_replay node apps/api/node_modules/prisma/build/index.js migrate deploy`（apps/api cwd）→ `All migrations have been successfully applied.`
- 快照命令：
  - `pg_dump --schema-only --no-owner --no-privileges --no-comments`（PostgreSQL 16.13 / pg_dump 16.13）
  - `node scripts/dump-schema-objects.mjs <scratch URL>`（columns/constraints/indexes/sequences/enums/collabLeaseRows 六组）

## 证据文件

| 文件 | sha256 |
| --- | --- |
| `gate-evidence/schema-before-v2.sql` | `9a5e1090fe1f5bd40f621aa9e532240df8c143a2a5d7afea57965e2129dd559e` |
| `gate-evidence/schema-before-v2.objects.json` | `3bebf8fc8209c7916c23896d01ec1f6e8576e566825b02adc1b32b4f617da258` |
| `gate-evidence/schema-after-v2.objects.json`（新 init 重放，评审收口后重生成） | `fc6f0873aa36d81535d5a9efd2f30d177f6da2d14f9bbb3cab00fb94a3aa730e` |

对象清单规模：columns 820 / constraints 151 / indexes 254 / sequences 2（`exec_seq`、`TeamCreditTransaction_seq_seq`）/ enums 25 / collabLeaseRows 1。

复现性注记（pg_dump `\restrict` token）：pg_dump 16.13 输出首尾含 `\restrict <随机 token>`/`\unrestrict <同 token>`（安全补丁，本文件 :5/:4188）——**同库重跑 sha256 不可复现**；上表 sql 哈希仅锚定本次落档字节。复算口径=用固定键 `pg_dump --restrict-key=<固定串>` 重跑，或剥除 `\restrict`/`\unrestrict` 两行后哈希（本版本无 `--no-restrict` 旗标）。

全量验证日志注记：C1-1 质量评审 Minor 收口后最终全量验证=`gate-evidence/c1-1-review-verify-full-r4.log`（`*.log` gitignored，尾部 `verify-chain: PASS（32 步，tier=full）` / `VERIFY_EXIT=0`）；上一轮收口=r2（同 PASS）。过程 flake=已登记环境面——上一轮首跑（`c1-1-review-verify-full.log`）命中 `collab.gateway.spec Y7 coalesce` 超时、本轮 r3 命中 `collab.gateway.auth-reason session-expired` 超时；两次均单独复跑绿后全链复跑绿。

## 覆盖范围

- 旧链全部 24 迁移（含 C2-1 `MediaFact`、C3a-2 binding 投影两列 + `ProjectionBackfillState`、C1-0/C2/C4 笔）。
- 全部 raw 对象（Prisma 不建模）：`ledger_guard()` + 两资金触发器、18 条 CHECK、partial 索引族、`exec_seq` 序列、种子行（NodeType/AIModel/ModelResolution/ModelDuration/PricingRule、SystemHistory 引导行、CollabLease 行、CollabOpsGate 全局哨兵行）。
- 旧链已删对象不在基线：`canvas_doc_update_seq` 序列（T10 删）、`MediaFactOutbox_mediaId_projectId_factVersion_key`（S0.1 改键）。

## 新 init 的预期 delta（C1-1 裁定期望，C1-2 三向 allowlist 消费）

- removed：`MediaFactOutbox` 表 + 其索引（`MediaFactOutbox_pkey`/`MediaFactOutbox_state_nextAttemptAt_idx`/`MediaFactOutbox_mediaId_idx`/`MediaFactOutbox_mediaId_projectId_factType_factVersion_key`）、`MediaFactState` enum、**`MediaBinding_mediaId_fkey`（spec v5.2/v5.3 终态去 FK——`mediaId` 标量与 `MediaBinding_mediaId_idx` 保留）**。
- added：`MediaBinding_projectId_fkey`（FK Cascade）——Prisma 反向关系 `CanvasProject.mediaBindings` 不入 pg_dump；`set_updated_at()` 函数 + 每 updatedAt 表触发器（pg_dump 对象清单六组不含函数/触发器，C1-2/C1-5 门单独消费）；`canvas_doc_binding_backfill_partial` 部分索引（C1-1 评估采纳——`projection-backfill.runner.ts` enumeratePage/countCandidates 谓词逐字对齐）。
- changed：**0**（类型转换归下方列类型 census 域、不计 changed；实测 FK onDelete/约束 body/函数/触发器 body 零变化）。
- 列类型 census：161 列 naive `timestamp(3)` → `timestamptz(3)`（列级 census 派生——存活 naive 列恰好全部转换，不 hardcode 数目；outbox 删除的 4 个 naive 列单列，不入转换集）。
- seed 行：schema-only 基线（`schema-before-v2.sql`）无法比对 seed 行（NodeType/AIModel/ModelResolution/ModelDuration/PricingRule/SystemHistory/CollabLease/CollabOpsGate 的计数与内容）——由 C1-6 reset 全链演练覆盖（或届时补 seed census 门），不入 C1-2 对象门。

## 实测 delta（`schema-after-v2.objects.json` vs 基线，2026-11-13 重生成）

constraints：old-only 2 = −`MediaFactOutbox_pkey` −`MediaBinding_mediaId_fkey`；new-only 1 = +`MediaBinding_projectId_fkey`；
indexes：−4 outbox 索引 / +`canvas_doc_binding_backfill_partial`（`MediaBinding_mediaId_idx` 两侧一致=保留）；
enums：−`MediaFactState`；sequences 完全一致；columns：−13 outbox 列 / 161 列 naive→timestamptz、零其他变化；collabLeaseRows 1≡1。函数/触发器另测：`ledger_guard`+2 触发器、`set_updated_at`+48 触发器（48/48 updatedAt 表覆盖，无遗漏）。
