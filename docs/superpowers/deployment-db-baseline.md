<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: 2026-10-05 | verified_at_commit: 95f32cb9 -->
# 数据库部署与基线指南（TD-10 基线重置后）

> 背景：2026-08-21 基线重置（commit d2cae05）——旧迁移链 19 个目录自起点断裂（无基础 schema init 迁移，任何 fresh 环境 `migrate deploy` 必失败），已 squash 为单一 `20260821000000_init` 并在本地 dev 库完成基线标记。
> 本文是所有环境（fresh / 既有）数据库初始化与升级的唯一权威流程。

## 一、fresh 环境（全新数据库）

```bash
# 在 apps/api 目录下（.env 中 DATABASE_URL 指向目标库）
pnpm exec prisma migrate deploy
pnpm exec prisma migrate status   # 应显示：1 migration found, up to date
```

- `migrate deploy` 不需要 shadow database 权限，应用 DB 用户即可执行
- init 迁移已通过 schema 沙箱重放自证（重放后与 schema.prisma 零差异）
- fresh 库无存量数据，无需任何数据回填（schema 已含正确默认值）

## 二、既有库基线标记（服务器等已靠 db push 同步的库）

**前提核查**：先确认库内 schema 与 schema.prisma 一致，否则先对齐再标记：

```bash
# 无输出（No difference detected）才可继续
pnpm exec prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --exit-code
```

**基线标记**（仅动 `_prisma_migrations` 元数据表，业务表零接触）：

```bash
# 1. 全量导出留档（回滚依据，必须先做）
psql "$DATABASE_URL" -c "SELECT * FROM _prisma_migrations;" | tee migrations_backup_$(date +%Y%m%d).txt

# 2. 清空旧记录
psql "$DATABASE_URL" -c "DELETE FROM _prisma_migrations;"

# 3. 标记 init 已应用
pnpm exec prisma migrate resolve --applied 20260821000000_init

# 4. 验证：应显示 1 migration found, Database schema is up to date!
pnpm exec prisma migrate status
```

## 三、既有库数据回填核查项

旧链中的手写数据回填 SQL 已随旧目录退出迁移链。fresh 库无需回填；**既有库需逐项核查**：

| 核查项 | 来源迁移 | SQL 要义 |
|---|---|---|
| Template.status 存量置 SAVED | 20260819_folder_persistence | `UPDATE "Template" SET "status" = 'SAVED';` |
| Template.projectId 无效引用清理 | 同上 | projectId 指向不存在 CanvasProject 的置 NULL |
| Template.projectId 去重（每 project 仅最新一Template） | 同上 | 按 createdAt DESC 保留一条，其余置 NULL |

核查方式：若服务器库在 folder_persistence 功能上线前已有 Template 数据且从未执行过上述修复，需手工补跑（完整 SQL 见 git 历史：`git show d2cae05~1:apps/api/prisma/migrations/20260819_folder_persistence/migration.sql` 步骤 7-9）。

## 四、本地 migrate dev 的 shadow database（一次性手动步骤）

`prisma migrate dev` 需要 shadow database 创建权限，而应用 DB 用户（flowweb）默认无 CREATEDB。**需 PG 超级用户一次性执行**：

```sql
ALTER ROLE flowweb CREATEDB;
```

- 未执行此授权前：本地改 schema 只能用本文流程外的 `db push`（已废止）或直接手写迁移——不建议
- 执行后：`migrate dev --name xxx` 正常工作
- `migrate deploy`（部署用）不需要此权限，不受影响

## 五、今后约定

- **schema 变更一律 `pnpm exec prisma migrate dev --name xxx`**（在 apps/api 下），产出正常迁移目录随代码提交
- **禁用 `prisma db push`**（除本地探索性实验，且实验后必须以迁移文件对齐）
- 迁移目录中只允许 prisma 生成物 + 必要的手写数据回填（须在注释中说明）

## 附录：schema 沙箱验证方法

无 CREATEDB 权限时的迁移链/单迁移验证法（全程应用用户权限内，曾用于本基线的自证）：

```sql
-- 单会话内执行（psql stdin 或多个 -c，保证 SET search_path 生效）
DROP SCHEMA IF EXISTS shadow_check CASCADE;   -- CASCADE 必需：schema 内有表/索引/序列
CREATE SCHEMA shadow_check;
SET search_path TO shadow_check;
-- 然后重放待验证的 migration.sql（\i 或 -f）
```

```bash
# 重放后与 schema.prisma 比对应零差异
pnpm exec prisma migrate diff --from-url "<DATABASE_URL去query>?schema=shadow_check" \
  --to-schema-datamodel prisma/schema.prisma --exit-code
# 清理
psql "$DATABASE_URL" -c "DROP SCHEMA IF EXISTS shadow_check CASCADE;"
```

注意：Windows（Git Bash）下 psql.exe 的 `-c "带空格SQL"` 参数引号会被 MSYS 破坏，改用 stdin 管道传入 SQL。
