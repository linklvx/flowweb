# Plan: TD-10 Prisma migrate 基线重置（子批 3b）

日期：2026-08-21
Spec：docs/superpowers/specs/td10-migrate-baseline-reset.md（已确认）
总原则：先自证后删除、先留档后清表；DB 操作仅动 `_prisma_migrations`，业务表零接触。

## 任务 1：生成 init 迁移 + SQL 头部抽查

- `mkdir -p prisma/migrations/20260821000000_init`
- `pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20260821000000_init/migration.sql`
- 抽查头部 20-30 行：CREATE TYPE/CREATE TABLE 起始、含 User/CanvasProject/Media 核心表、无 DROP
- 失败即止（不进入任务 3）

## 任务 2：schema 沙箱重放自证

- 复用已验证的沙箱机制：`DROP SCHEMA IF EXISTS shadow_check CASCADE` → `CREATE SCHEMA shadow_check` → `SET search_path` 单会话重放 init SQL → `pnpm exec prisma migrate diff --from-url "<url>?schema=shadow_check" --to-schema-datamodel prisma/schema.prisma` 应零差异
- 完成后 `DROP SCHEMA IF EXISTS shadow_check CASCADE` 清理
- 非零差异即止

## 任务 3：删除 19 个旧迁移目录

- 删除 `prisma/migrations/` 下全部 19 个旧目录（保留 `migration_lock.toml` 与新 init 目录）
- git 历史留档，考古可回溯

## 任务 4：本地基线标记

1. 导出留档：`SELECT * FROM _prisma_migrations` 结果写入 repo 外临时文件（`$TEMP/td10_migrations_backup_20260821.txt`）并打印到会话输出（双记录，供回滚 re-insert）
2. `DELETE FROM _prisma_migrations`（清 13 有效 + 1 孤儿 + 2 rolled_back 残留）
3. `pnpm exec prisma migrate resolve --applied 20260821000000_init`

## 任务 5：三重验证

1. `pnpm exec prisma migrate status` → 仅 init、up to date
2. `ls prisma/migrations/` → 仅 `20260821000000_init/` + `migration_lock.toml`
3. `pnpm exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma` → 无差异（dev 库业务表未被波及的证明）

## 任务 6：api 全量测试回归

- `pnpm --filter @flowweb/api test` → 589/589 绿（测试全 mock 不触库，纯回归确认）

## 任务 7：commit 1（基线重置原子提交）

- 范围：新增 init 目录 + 删除 19 旧目录（任务 1-5 的 repo 变更 + DB 操作说明入 body）
- message：

```
chore(api): reset prisma migrate baseline to single init migration (TD-10)

- old chain broken from the start: no base-schema init migration existed
  (first migration ALTERs CanvasProject etc. that nothing created);
  sandbox replay of all 19 dirs failed at file #1
- dev DB verified zero-diff vs schema.prisma (faithful db push sync)
- baseline mark on dev DB: _prisma_migrations cleaned (13 applied + 1 orphan
  + 2 rolled-back rows, dump archived) + resolve --applied 20260821000000_init
- fresh envs now provisionable via `migrate deploy` (single generated init,
  sandbox-replayed to zero-diff vs schema)
```

## 任务 8：部署文档落盘 + 台账清账（commit 2）

- 新增 `docs/superpowers/deployment-db-baseline.md`：
  - fresh 环境：`migrate deploy` 流程
  - 既有库（服务器）基线标记：先 `migrate diff` 核查 schema 一致 → 备份导出 `_prisma_migrations` → DELETE → `resolve --applied` → status 验证
  - 数据回填核查项（folder_persistence 的 status='SAVED' backfill 等）
  - 沙箱验证方法附录（search_path 重放 + CASCADE 清理写法）
  - 一次性手动步骤：PG 超管执行 `ALTER ROLE flowweb CREATEDB;`（解锁本地 `migrate dev` 的 shadow 库；`migrate deploy` 不需要）
  - 今后约定：schema 变更一律 `migrate dev --name xxx`，禁用 db push 依赖
- tech-debt.md：TD-10 → 已清账（引用 commit 1）；批次建议 3b 标记完成；CREATEDB 手动步骤在清账行注明待用户执行
- commit 2：`docs: add deployment DB baseline guide, settle TD-10 (TD-10)`

## 回滚路径（基线重置后发现异常时）

1. repo：`git revert <commit 1>` → 恢复 19 个旧迁移目录、删除 init 目录（部署文档如需一并撤销再 revert commit 2）
2. `_prisma_migrations`：`DELETE FROM _prisma_migrations;` 后用任务 4 留档（$TEMP 文件 + 会话输出双记录）重建 INSERT 回灌全部 16 行
3. 业务表：全程未触碰，无需回滚
4. 验证：`pnpm exec prisma migrate status` 恢复操作前原状（13 applied + 1 孤儿 + 2 rolled_back，分叉于 20260603000002）

## 任务 9：记忆档案更新（repo 外，不 commit）

- `prisma_migrate_history_broken.md`：重写为「已基线重置（2026-08-21）」——保留历史教训、更新现状（单一 init、migrate dev 需 CREATEDB 授权待用户执行）、修正 MEMORY.md 索引行描述
- `server_deployment_guide.md`：追加 DB 基线部署清单段（指向 repo 部署文档）
