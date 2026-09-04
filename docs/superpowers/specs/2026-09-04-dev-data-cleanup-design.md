# 开发测试环境数据清理（孤岛/脏数据）— 设计文档

日期：2026-09-04（v4：v3 终审批准执行，补入执行闸 N1-N5——全库子串兜底扫描、临时脚本落点、环境守卫+dry-run、seed env 显式化、V1 观察可执行化）
状态：已批准（终审"无阻断项"+N1/N2/N3 执行前补齐，N4/N5 顺带）

## 1. 背景与审计结论

项目处于开发测试阶段，历经多次 DB 重置/迁移 squash 与浏览器验收，累积了跨存储层的孤岛数据与脏数据。2026-09-04 全量审计（DB 35 表 + MinIO 386 对象 + Redis 195 键）发现：

| # | 问题 | 规模 | 根因 |
| --- | --- | --- | --- |
| 1 | MinIO 孤岛对象 | **383 个 / 2.51 GB**，当前 DB 零引用 | DB 重置后用户 ID 全部更换（当前 7 用户名下 0 对象），历史 uploads/results/thumbnails 全部无主；`uploads/system/` 下 21 个为被替换的旧 Banner 图 |
| 2 | Redis BullMQ 残留 | repeat 配置副本堆积 53 个（grant-credit 29 + expire 24）+ 幽灵失败任务 42 个（video-trim 38 / thumbnail 3 / ai-image-edit 1）+ 无主 job 键 41 个 | DB 任务表已清空但 Redis job 数据未随动；repeatable job 副本未清理 |
| 3 | Session 死会话 | 12 条 | 备份恢复拷贝的旧 token（userAgent 空、同一过期日） |
| 4 | default-team 成员缺失 | 1 条 | seed.ts:195-210 只 upsert user/team/teamBalance，唯独无 teamMember，违反「团队 owner 必在成员表」不变量（其余 5 团队均有 OWNER 成员） |
| 5 | ContentCard 死表 | 8 条 | 前后端零消费（5 月 Phase 1 遗留），封面 `/card-covers/*.jpg` 指向不存在的 web/public 目录 |

## 2. 清理决策总表

| 清理项 | 结论 | 用户确认 |
| --- | --- | --- |
| MinIO 383 个孤岛对象 | **全部删除**；保留集由 **DB 反查 4 个对象键字段**实时驱动（非手写白名单），删除前断言保留集恰等于当前 3 个 Banner key | ✅ 2026-09-04 |
| Redis `bull:*` 键 | **全部删除**（195 个）；**停服清理**，启动后由 `onModuleInit` 重建 repeat 调度（B1） | ✅ 2026-09-04 |
| Session | **全表清空**（12 条），浏览器重新登录即可 | ✅ 2026-09-04 |
| default-team | **修复根因**：seed.ts 增加 `teamMember.upsert`（幂等），本次跑一次 seed 补数据，不做裸 SQL INSERT（B2） | ✅ 2026-09-04 |
| ContentCard | **清空 8 条数据 + 删除 seed.ts ContentCard 段落（:19-37）+ 同步修正 :245 完成日志文案**（R5） | ✅ 2026-09-04 |
| seed.ts 硬编码 API key | :82 腾讯混元 sk- key 移到 env 读取；**key 轮换为用户手动操作项**（R4，已入 git 历史视为泄露） | 评审新增 |
| 清理代码留存（用户约束） | **一次性清理**：清理逻辑以临时脚本执行、用后不入库；**不添加任何自动清理/后续清理/定期清理代码或机制** | ✅ 2026-09-04 |
| 正式环境数据完整性（用户约束） | 所有删除均限定「DB 零引用对象 + 死表死数据 + 失效会话」，保留集双向断言 + 全量留痕，不触碰任何活跃业务数据 | ✅ 2026-09-04 |
| 测试账号体系 | **保留**：admin / accept-user / accept-evil / diag-test / ddd 及各自团队、MaterialFolder 默认文件夹、「画布1」项目与模板（登录验收设施） | 审计判定 |

## 3. 执行总时序（B1：停服清理）

```
① 改代码（seed.ts 四处，含 dotenv 显式化）+ 确认 .env 已填 HY_IMAGE_API_KEY
→ ② 跑测试 → ③ 停 API（仅停 API，PG/Redis/MinIO 保持运行）
→ ④ 留痕快照（R2+N1，dry-run 输出并核对：保留集/双向断言/兜底扫描/将删清单）
→ ⑤ 清 Redis bull:* → ⑥ 清 MinIO（--execute：保留集驱动 + 分批删）
→ ⑦ PG 清 Session/ContentCard → ⑧ 跑 prisma db seed（补 default-team member；
   知会：seed 跑整个 main()，其余均为幂等 upsert/update:{}，不改既有数据）
→ ⑨ 删除临时脚本 → ⑩ 启动 API → ⑪ V1-V5 验收
```

理由（代码核验）：repeat 调度仅在 `subscription-scheduler.service.ts:12-30 onModuleInit` 注册（先 removeRepeatableByKey 清旧、再以固定 jobId add）；普通队列结构键惰性重建，repeat 不会。停服一次性消除 worker 运行中删键、清理期间产生新 job/对象等边界争议。开发测试环境停 API 零成本。

## 4. 各项清理规格

### 4.1 MinIO（bucket: flowai，未开版本控制=物理删除不可逆）

**保留集 = DB 反查（4 个对象键字段，实时）**：

```sql
SELECT "imageKey" FROM "HomeBanner";
SELECT "key" FROM "Media" WHERE "deletedAt" IS NULL;
SELECT "thumbnailKey" FROM "Media" WHERE "deletedAt" IS NULL AND "thumbnailKey" IS NOT NULL;
SELECT "backgroundImageKey" FROM subscription_banner WHERE "backgroundImageKey" IS NOT NULL;
```

四者去空取并集 = 保留集（Media 排除软删记录——软删对象本就该清）。

**全库子串兜底扫描（N1，正式环境零引用的硬证据）**：5 类内嵌载体列转文本后对每个待删 key 做 `POSITION(key IN col)` 匹配，命中即移入保留集并告警；当前 dev 数据（CanvasDoc 1 行、Template.templateData 2 行、LightingTask/Media/CanvasDocUpdate 均 0 行）预期 **0 命中**，该结果随留痕落盘：

```sql
-- LightingTask.originalImageUrl / resultImageUrl（varchar 直接扫）
-- CanvasDoc.state / CanvasDocUpdate.update（Bytes → convert_from(col,'UTF8')）
-- Template.templateData（Json → col::text）
-- Media.metadata（Json → col::text）
```

**双向断言（任一失败立即中止）**：
- 保留集 ⊇ 硬编码基准（当前 3 个 Banner key：`uploads/system/2026-09-04/d9f073af…png`、`749aa09c…png`、`4c954a56…png`）→ 不满足说明有遗漏引用字段或新增引用，中止排查
- 保留集 ⊆ 硬编码基准 → 不满足说明 Banner key 已漂移，中止排查

以保留集驱动删除：ListObjectsV2 全量 → 排除保留集 → DeleteObjects 分批（≤500/批）。

**边界说明**：`Template.coverUrl/dataUrl` 存 URL 非对象 key（当前均为 NULL），排除但脚本 log 出来人工复核。

**执行载体与安全闸**（N2/N3）：
- 临时脚本 `apps/api/scripts/__tmp-cleanup.ts`——置于 apps/api 下保证 `@aws-sdk/client-s3`/`@prisma/client`/`dotenv` 依赖可解析，用 `tsx` 运行（项目 `prisma db seed` 已有 tsx 先例）；**跑完即删，不永久留存**（用户约束："不在 apps/api/scripts 留存"= 跑完删除）
- 留痕产物写入 `backups/2026-09-04-cleanup/`（.gitignore:14 已忽略 backups/，可长期留档）
- **环境守卫**：脚本启动即解析 `DATABASE_URL`（host 必须 localhost/127.0.0.1、db 名匹配本地 dev 库）与 MinIO endpoint/bucket（127.0.0.1:9000 / flowai），任一命中非 dev 目标**立即退出**——防止 .env 切到生产时误删
- **默认 dry-run**：只输出保留集/双向断言结果/N1 兜底命中/将删数量与大小，不真删；人工核对后显式 `--execute` 才执行删除

### 4.2 Redis

- 删除范围：`bull:*` 全部键（SCAN + 分批 DEL，不用 KEYS/FLUSHDB——同 db0 混有 auth/sms 客户端）
- 时点：**停 API 后**执行；清空后 `bull:*` 计数 = 0 为**启动前瞬时值**（V2）
- 启动后重建范围区分（R6）：
  - BullMQ 结构键（wait/id/meta/events 等）惰性重建
  - repeat 调度由 `onModuleInit` 重建
  - `video-separate.cron.ts:14`、`team-subscription-expire.processor.ts:11` 为 `@nestjs/schedule @Cron` **进程内调度，不落 Redis**，与本次清理无关
- 删前将全部 `bull:*` 键按「队列名:后缀类型」聚合计数落盘，勾稽 195 = 53 repeat + 42 failed + 41 job 键 + 59 结构键（R1）

### 4.3 PostgreSQL

1. `DELETE FROM "Session"`（预期 12 行）
2. `DELETE FROM "ContentCard"`（预期 8 行）
3. default-team 成员：**跑 `prisma db seed`**（seed.ts 已含新 upsert，见 4.4）——幂等可重跑，不用裸 INSERT（TeamMember 有 `@@unique([teamId,userId])`，裸 INSERT 不可重跑且 seed 重置库后会复活缺失）

### 4.4 代码修改（seed.ts 四处，防复活 + 根因修复 + 安全）

0. **顶部显式 `import 'dotenv/config'`**（N4）：消除"PrismaClient 先加载 .env、:82 才读 env"的隐式时序依赖；dotenv 已是 apps/api 依赖（^17.4.2）
1. **删除 ContentCard seed 段落**：:19-37（注释 + cards 数组 + upsert 循环），并同步修改 :245 完成日志（去掉 "Phase 1 cards"）
2. **default-team 后补 teamMember**（:205 defaultTeam 之后）：
   ```ts
   await prisma.teamMember.upsert({
     where: { teamId_userId: { teamId: 'default-team', userId: 'default-user' } },
     update: { role: 'OWNER' },
     create: { teamId: 'default-team', userId: 'default-user', role: 'OWNER' },
   });
   ```
   id/joinedAt/monthlyQuota/monthlyUsed 走 schema 默认值
3. **:82 apiKey 移 env**：`apiKey: process.env.HY_IMAGE_API_KEY`（.env 补充该变量——执行时序⑧跑 seed 前确认已填；**用户手动轮换腾讯云 key**）

### 4.5 留痕快照（R2+N1，删除前落盘到 `backups/2026-09-04-cleanup/`）

1. MinIO 全量 key+size 清单（JSON）
2. Session / ContentCard / TeamMember 三表数据导出（JSON，经 node+Prisma——psql/pg_dump 不在 PATH）
3. 42 个 failed job（video-trim 38 / thumbnail 3 / ai-image-edit 1）的 jobId+failedReason 归档（质量问题线索）
4. N1 全库子串兜底扫描结果（预期 0 命中，作为「全库零引用」硬证据）
5. Redis bull:* 键按「队列名:后缀类型」聚合计数（R1 勾稽 195）

## 5. 验收标准

| # | 验证点 | 通过标准 |
| --- | --- | --- |
| V1 | MinIO | 剩余对象 = DB 反查保留集，且恰为 3 个 Banner key；**观察项（N5，手动查询非自动机制）：`uploads/default-user/`、`results/default-user/` 前缀对象数 = 0，且 `SELECT count(*) FROM "Media" WHERE "userId"='default-user' AND "createdAt" >= '<清理时刻>'` 基线为 0 不增长**（R3，见非目标回退残留） |
| V2 | Redis | 停服清空后 `bull:*` = 0（启动前瞬时值）；键聚合计数留痕文件勾稽 195 |
| V3 | DB | Session=0、ContentCard=0、default-team 成员数=1（OWNER=default-user）；重跑 seed 结果不变（幂等） |
| V4 | 功能回归 | ① 启动后 API 日志无错误；② `subscription-grant-credit` / `subscription-expire` 两队列 `getRepeatableJobs().length === 1`（其余队列不查——@Cron 机制不落 Redis）；③ Web 登录页可访问；④ 首页/admin Banner 图正常显示 |
| V5 | 单测 | `pnpm test`（apps/api + apps/web）全绿（seed.ts 三处改动不破坏既有测试） |

## 6. 非目标（本次不做）

- **任何自动清理/后续清理机制**（用户明令禁止）：Session 过期清理 job、MinIO 孤岛定期扫描、Media 软删对象回收调度等一律**不做**——本次为一次性人工清理，不向代码库添加任何清理类运行时代码或常驻脚本
- **生产代码 `default-user` 回退残留**：execution.gateway.ts:17,28 / ai-image-edit.service.ts:15 / **storyboard.controller.ts:16,23**（R3 补充，核验属实）——BetterAuth 改造漏网之鱼，须另行走 spec→plan→TDD；修复前未登录态触发执行/图编辑/故事板仍会以 default-user 名义写新对象（故 V1 设观察项）
- **腾讯云 key 轮换**：用户在腾讯云控制台手动操作（代码侧 env 化本次完成）
- **ContentCard 删表 + Prisma 迁移**：独立流程处理
- TeamCreditTransaction 54 条 register_grant 流水、MaterialFolder 25 个默认文件夹：合法结构数据，不动

## 7. 风险、不可逆性与正式环境数据完整性保障

- MinIO 删除**不可逆**（bucket 未开版本控制，物理删除）：2.51 GB 历史生成物/上传永久丢失，已按 §4.5 留痕 key 清单与 failed job 归档。开发测试阶段无用户数据、当前 DB 零引用，用户已确认全删
- Redis bull 键删除：停服后执行，无进行中 job 可丢
- Session 删除：所有已登录浏览器会话失效，重新登录即恢复
- seed 修改风险：三处均为幂等 upsert/删除死代码/env 化，V5 测试兜底

**正式环境长期稳定保障**（用户约束）：
- 删除范围硬边界：仅「DB 零引用的 MinIO 对象 + 前后端零消费的死表数据 + 备份恢复的失效会话」，不触碰任何有引用、有消费、有业务语义的数据
- 保留集实时反查 + 双向断言：任何断言失败立即中止，宁可不清也不误删
- 全量留痕（key 清单 + 三表 JSON + failed 归档）：事后可审计"删了什么"
- 生产代码净变更仅 seed.ts 四处（dotenv 显式化 / 删死 seed / 补幂等 upsert / key env 化），零新增运行时清理逻辑、零新增定时任务——清理完毕后代码库不存在任何随时间自动删除数据的路径
- 队列/调度恢复靠既有 `onModuleInit` 逻辑，无需人工介入
