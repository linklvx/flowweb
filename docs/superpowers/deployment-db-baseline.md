<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: 2026-10-09 | verified_at_commit: T1a -->
# 数据库部署与基线指南（Y0b-1 T1a 第二次基线重置后）

> 基线沿革：
> - 第一次 squash（2026-08-21，commit d2cae05）：19 个断裂旧目录 → 单一 `20260821000000_init`。
> - 第二次 squash（2026-10-09，Y0b-1 T1a）：24 个目录 → 单一 `20261009031416_init`（字典序 > 全部旧目录；含 schema 终态：enum 删 `consumption` 加 `release`、假唯一删、两处 `teamId` 去 FK NOT NULL、`PricingRule.modelId` 可空）。
> 本文是所有环境（fresh / 既有）数据库初始化与升级的唯一权威流程。

## 一、fresh 环境（全新数据库）

```bash
# 在 apps/api 目录下（.env 中 DATABASE_URL 指向目标库）
pnpm exec prisma migrate deploy
pnpm exec prisma migrate status   # 应显示：1 migration found, up to date
pnpm exec tsx prisma/seed.ts      # 开发数据（定价真源进迁移后此步口径再收敛）
```

- `migrate deploy` 不需要 shadow database 权限，应用 DB 用户即可执行
- fresh 库无存量数据，无需任何数据回填（schema 已含正确默认值）

## 二、本地库重建（destructive——仅开发环境）

```bash
cd apps/api
npx prisma migrate reset --force --skip-seed   # drop & recreate + 新 init 重放一步到位
npx prisma migrate status
pnpm exec tsx prisma/seed.ts
```

- 前提：迁移目录仅含唯一 init + `migration_lock.toml`（残留旧目录=字典序先跑旧链，必炸）
- `flowweb` 用户需 CREATEDB（见第四节一次性授权）

## 三、服务器库重建（T8 人工执行——REBUILD_DB 分支）

**重建而非基线标记**：drop & recreate（`DROP SCHEMA public CASCADE; CREATE SCHEMA public`）后 `migrate deploy` 重放 init。不做 `_prisma_migrations` re-mark——旧链目录已从仓内消失，re-mark 无对象可标。

```bash
./deploy.sh --rebuild-db
```

- **回退锚**：deploy.sh cutover ② 的 pg_dump（REBUILD 执行前必须已落）
- **前置清理**：tar 解包无删除语义，REBUILD_DB 分支先 `rm -rf` 远端旧迁移目录并断言清空（否则旧 24 目录字典序先跑，新 init 的 CREATE TYPE already exists 必炸）
- **owner 前置核查**：rebuild-db.mjs 只读核查 `public` schema owner=`flowweb` 后才 DROP（DROP 需 schema owner）；DROP 前 GenerationIntent 计数仅日志留档（应用在线窗口断言无意义——pm2 不停）
- 数据回填：重建后业务数据来自 seed + 人工导入（无用户数据负担，见 spec 裁定）

### 执行时序人工操作清单（四步顺序固定；判据不满足即停，勿跳步）

| # | 操作 | 判据 |
|---|------|------|
| 1 | 本地 `./deploy.sh api --rebuild-db`（脚本内自动：清远端旧迁移目录→owner 核查→DROP SCHEMA→migrate deploy 重放 init→cutover 全链含 pg_dump 备份） | 脚本零失败退出；`cat apps/api/dist/build-info.json` SHA≡HEAD |
| 2 | ssh 进服务器跑 seed：`cd /home/ubuntu/flowweb/apps/api && pnpm exec tsx prisma/seed.ts` | seed 零报错退出 |
| 3 | 服务器 `pnpm exec prisma migrate status` | 输出 `1 migration found, up to date` |
| 4 | 冒烟复核：post 段 ready 轮询+collab-smoke 已随脚本跑过；人工再验 `/api/ready` 返回 200 且 reason 全绿 | ready 200；collab-smoke 零失败（post 段输出） |

## 四、migrate dev 的 shadow database / CREATEDB（一次性手动步骤）

`prisma migrate dev` 与 census 临时库创建需要 CREATEDB，应用 DB 用户（flowweb）默认无。**需 PG 超级用户一次性执行**：

```sql
ALTER ROLE flowweb CREATEDB;
```

- 执行后：`migrate dev --name xxx` 正常工作；`migrate deploy`（部署用）不需要此权限

## 五、第二次 squash 自证（census 方法论——squash 的唯一可信验收）

Prisma migrate diff 不建模序列/partial WHERE/约束形态（"diff 零差异"是假绿）。自证=对象级双向比对：

```bash
# 旧侧=现 dev 库（reset 前跑），新侧=临时库重放新 init
node scripts/dump-schema-objects.mjs "$DATABASE_URL" > /tmp/census-old.json
node scripts/dump-schema-objects.mjs "$DATABASE_URL" --replay-new apps/api/prisma/migrations/<TS>_init/migration.sql > /tmp/census-new.json
diff /tmp/census-old.json /tmp/census-new.json
```

白名单四类语义差异（2026-10-09 实测，零白名单外差异）：

| # | 对象 | 差异 |
|---|---|---|
| 1 | `enums.TeamCreditTransactionType` | old 多 `consumption` / new 多 `release` |
| 2 | `indexes` | old 多 `PricingRule_nodeTypeId_modelId_resolutionId_durationId_key`（假唯一删） |
| 3 | `constraints` | old 多 `TeamCreditTransaction_teamId_fkey` + `TeamRechargeOrder_teamId_fkey`（去 FK） |
| 4 | `columns` | `TeamCreditTransaction.teamId`/`TeamRechargeOrder.teamId` YES→NO；`PricingRule.modelId` NO→YES |

**12 类 raw 对象清单**（Prisma 表达不了、必须从旧迁移原文搬运进 init 的对象——本次全部搬运且 census 逐字一致）：

- 9 条 partial unique 索引：`team_owner_default_unique`、`folder_team_root_name_unique`、`folder_team_parent_name_unique`、`material_folder_team_root_name_unique`、`material_folder_team_parent_name_unique`、`user_subscription_one_active`、`team_subscription_one_active`、`announcement_single_active`、`generation_intent_active_node_unique`（claim P2002 分义直依赖）
- 1 条 append 序列：`canvas_doc_update_seq`（协作写命脉——丢=每次 nextval 抛错）
- 1 个约束形态唯一：`CanvasDocUpdate_projectId_seq_key`（pg_constraint 口径——勿改建索引形态；schema `@@unique` 对应的 diff 裸索引行需删除，否则同名冲突）
- 1 行种子：`CollabLease('primary')`（`ON CONFLICT DO NOTHING` 幂等）

**永久门禁**：`apps/api/prisma/verify-indexes.sql` 文末 Y0b-1 块（22 块全 ≥1 行——runner `scripts/verify-indexes.mjs`，已进根 verify 链）。

## 六、今后约定

- **schema 变更一律 `pnpm exec prisma migrate dev --name xxx`**（在 apps/api 下），产出正常迁移目录随代码提交
- **禁用 `prisma db push`**（除本地探索性实验，且实验后必须以迁移文件对齐）
- **新迁移必须过 additive 门禁**（`scripts/check-migration-additive.mjs`，BASELINE=`20261009031416_init`——T1b 起首批真实受检对象；硬拦 DROP COLUMN/TABLE/CONSTRAINT/TYPE、SET/DROP NOT NULL、TRUNCATE、RENAME、ALTER COLUMN TYPE）
- 迁移目录中只允许 prisma 生成物 + raw 对象搬运段 + 必要的手写数据回填（须在注释中说明来源）

## 附录：schema 沙箱验证方法（无 CREATEDB 时）

```sql
-- 单会话内执行（psql stdin，保证 SET search_path 生效）
DROP SCHEMA IF EXISTS shadow_check CASCADE;
CREATE SCHEMA shadow_check;
SET search_path TO shadow_check;
-- 然后重放待验证的 migration.sql
```

注意：Windows（Git Bash）下 psql.exe 的 `-c "带空格SQL"` 参数引号会被 MSYS 破坏，改用 stdin 管道传入 SQL。
