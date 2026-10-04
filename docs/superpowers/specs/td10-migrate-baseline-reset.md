<!-- doc-status: historical | verified_at: n/a -->
# Spec: TD-10 Prisma migrate 基线重置（子批 3b）

日期：2026-08-21
状态：待确认
来源：tech-debt.md TD-10（上线阻塞项）；第三批分批方案子批 3b

## 侦查结论（2026-08-21 全部实测核实）

1. **权威漂移状态**（`prisma migrate status`）：分叉点 `20260603000002_optimize_material_indexes`；9 个迁移未应用（2026-07-01 video_trim 起）；1 条孤儿记录（库内 `20260515201623_add_template_and_project_userid`，目录无对应——与目录内 `20260515204226_add_template_and_project_userId` 时间戳/大小写均不一致）
2. **迁移链从起点即断裂（本批最关键发现）**：目录中**不存在创建基础 schema（User/CanvasProject/Media 等）的 init 迁移**。schema 沙箱按字典序重放全部 19 个迁移，第 1 个文件（20260515204226）即失败：「关系 CanvasProject 不存在」。**该链对全新数据库完全不适用**——任何 fresh 环境 `migrate deploy` 必然失败
3. **dev 库与 schema.prisma 零差异**（`migrate diff --from-schema-datasource --to-schema-datamodel` 确认）——db push 忠实同步，基线重置的核心前提成立
4. `_prisma_migrations` 现状脏乱：约 13 条有效 applied + 1 条孤儿名记录 + 2 条 rolled_back 残留重复行
5. **权限约束**：应用 DB 用户（flowweb）无 CREATEDB；postgres 超级用户凭据不可得（常见口令探测失败）→ 无法走 prisma 原生 shadow database。已验证替代：**schema 沙箱**（`CREATE SCHEMA shadow_check` + `SET search_path` 重放 + `--from-url "...?schema=shadow_check"` diff + `DROP SCHEMA`），全程应用用户权限内
6. repo 无部署文档（部署知识在记忆档案）；docs/superpowers/ 仅有 full-stack-backup.md
7. **api 测试与数据库零耦合（已核实）**：vitest.config.ts 无 globalSetup/setupFiles，31 个 spec 均以 `provide: PrismaService` mock 注入——删除/新增迁移目录对测试无任何影响，全量测试仅作回归确认
8. 记忆档案为 Claude 持久记忆目录文件（`C:\Users\link\.claude\projects\D--flowweb\memory\` 下的 prisma_migrate_history_broken.md / server_deployment_guide.md，均已确认存在），非 repo 文件；repo 内落盘物 = 部署文档

## 策略决策

### 方案 A：保留 19 目录 + `migrate resolve --apiled` → **否决**

resolve 只能修复本地 _prisma_migrations 记录状态，不能修复链条本身——链条起点即断（发现 2），fresh 环境部署仍必失败。修复本地状态而无部署价值 = 无意义。

### 方案 B：重新基线（squash 为单一 init 迁移）→ **推荐，唯一可行**

1. `prisma migrate diff --from-empty --to-schema-datamodel --script` 生成全量 DDL，作为唯一迁移 `20260821000000_init`（命名沿用目录时间戳风格）
2. 删除 19 个失效迁移目录（git 历史留档，考古可回溯）
3. 本地 dev 库基线标记：pg 直连 `DELETE FROM _prisma_migrations`（清孤儿+残留+旧记录；操作前 SELECT 全量导出留档）→ `prisma migrate resolve --applied 20260821000000_init`
4. 手写数据回填 SQL（folder_persistence 的 SAVED backfill 等）随旧目录退出链条：fresh DB 无需回填（数据从零起，schema 已含正确默认）；本地库已手工补过；**服务器库是否有存量数据缺回填 → 部署清单核查项**

## 修复设计

1. **生成与自证**：
   - `mkdir -p prisma/migrations/20260821000000_init` 后 `pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20260821000000_init/migration.sql`
   - 人工抽查 SQL 头部 20-30 行：应以 CREATE TYPE/CREATE TABLE 起始（含 User、CanvasProject、Media 等核心表），无 DROP 语句（from-empty 不产生 DROP）——防生成器异常输出的零成本安全网
   - schema 沙箱重放 init（`DROP SCHEMA IF EXISTS shadow_check CASCADE` 清理，CASCADE 必需——schema 内有表/索引/序列，普通 DROP 会因非空失败）→ diff vs schema.prisma 应零差异（生成物自证完整）
2. **本地基线标记**（发现 3 前提下安全，仅动 _prisma_migrations，不动业务表）
3. **三重验证**：`migrate status` 干净（仅 init、up to date）；dev 库 diff 保持零差异；init 沙箱重放 diff 零差异
4. **部署流程固化**：
   - repo 新增 `docs/superpowers/deployment-db-baseline.md`：fresh 环境 `migrate deploy` 流程；既有库（服务器）基线标记流程（先 `migrate diff` 核查 schema 一致 → 清 _prisma_migrations → `resolve --applied init`）；数据回填核查项（folder_persistence SAVED）；今后 schema 变更一律 `migrate dev --name` 禁用 db push
   - 更新记忆档案：prisma_migrate_history_broken（标记已修复，留权限约束）、server_deployment_guide（附 DB 基线清单）
5. **已知后续约束（文档化，非本批操作）**：本地 `migrate dev` 需要 shadow database 创建权限——需用户以 PG 超级用户一次性执行 `ALTER ROLE flowweb CREATEDB;`（无超管凭据，Claude 无法代做）；`migrate deploy`（部署用）不受影响

## 验证标准

1. `prisma migrate status`：仅 `20260821000000_init`，Database schema is up to date
2. `ls prisma/migrations/`：仅 `20260821000000_init/` + `migration_lock.toml`，19 个旧目录已删
3. `migrate diff` dev 库 vs schema.prisma：无差异（操作前后一致）
4. init 沙箱重放后 diff vs schema.prisma：无差异
5. `pnpm --filter @flowweb/api test` 照常全绿（零产品代码，回归确认；测试全 mock 不触库）
6. 部署文档落盘 + 两份记忆档案（记忆目录路径，见侦查结论 8）更新

## 不做什么

- 不操作服务器数据库（流程文档化，上线时执行）
- 不补写历史迁移（git 历史已留档，无意义）
- 不动 schema.prisma 与任何产品代码
- 不申请/猜测 PG 超管凭据（CREATEDB 授权作为用户一次性手动步骤写入文档）

## 风险（已消解或受控）

- ~~删除旧目录的破坏性~~：git 历史可回溯；基线标记后 prisma 不再读取旧名
- ~~_prisma_migrations 手工 DELETE~~：操作前 SELECT 全量导出留档于本批输出；该表仅 prisma 元数据，业务表不动
- 服务器库状态未知 → 不盲操作，清单先行核查（文档化）
- 回填 SQL 退出链条 → fresh DB 无需；存量库核查项已入部署清单（发现 4）
