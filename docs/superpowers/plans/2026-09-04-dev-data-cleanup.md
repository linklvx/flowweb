# 开发测试环境数据清理 — 实施计划

日期：2026-09-04
依据：spec v4（docs/superpowers/specs/2026-09-04-dev-data-cleanup-design.md，已批准）
执行环境：本机 dev（PG localhost:5432/flowweb、Redis localhost:6379、MinIO 127.0.0.1:9000/flowai、API preview server、Web 可不停）
执行 shell：**Git Bash**（grep/rm/ls 可用；若换 PowerShell 则 `grep`→`Select-String`、`rm`→`Remove-Item`）

## 0. 验证策略说明

- seed.ts 无既有单测；不为一次性 seed 脚本新增 mock 测试（mock PrismaClient 断言 upsert 调用无业务价值，违反简洁优先）。其正确性由 **T1 类型检查 + T4 实跑幂等（V3）+ T2 既有测试全绿（V5）** 兜底
- 临时清理脚本 `__tmp-cleanup.ts` 同理：以 **dry-run 输出人工核对（B3）** 为主要验证手段，不写单测、跑完即删

## 任务分解

### Phase A：代码修改（时序①②）

**T1. seed.ts 四处修改**（apps/api/prisma/seed.ts）

| # | 修改 | 位置 | 内容 |
| --- | --- | --- | --- |
| a | 顶部加 `import 'dotenv/config';`（N4） | :1 之前 | 显式加载 env，消除隐式时序 |
| b | 删 ContentCard seed 段落 | :19-37 | 注释 + cards 数组 + upsert 循环整体删除 |
| c | teamMember.upsert（B2 根因修复） | :205 defaultTeam 之后、teamBalance 之前 | `where: { teamId_userId: { teamId: 'default-team', userId: 'default-user' } }, update: { role: 'OWNER' }, create: { teamId: 'default-team', userId: 'default-user', role: 'OWNER' }` |
| d | apiKey env 化（R4） | :82 | `apiKey: process.env.HY_IMAGE_API_KEY` |
| e | 完成日志去 "Phase 1 cards" | :245 | `'Seed complete: Phase 3 models + Phase 4 user balance + Phase 5 video models'` |

- verify: `cd apps/api && npx tsc -p tsconfig.json --noEmit` 无错误——**注意：tsc 的 include 为 `["src"]`，不覆盖 prisma/seed.ts（P1）**，seed 改动正确性以 T8 首跑 + T11/V3 重跑幂等为准；另 grep 确认 seed.ts 无 `contentCard` 残留、无 `sk-` 明文

**T2. .env 补 HY_IMAGE_API_KEY**（apps/api/.env，已被 .gitignore:3 忽略不入库）

- 值 = 现 seed.ts:82 的 key（用户后续在腾讯云控制台轮换，轮换后仅改 .env；**旧 key 已入 git 历史，轮换才是根治**）
- verify: `grep HY_IMAGE_API_KEY apps/api/.env` 有输出；T1 改完后 `git diff apps/api/prisma/seed.ts` 确认无 `sk-` 明文残留

**T3. 跑既有测试（V5）**

- `cd apps/api && pnpm test`（含 tsc --noEmit，覆盖 src/）；`cd apps/web && pnpm test` → 全绿
- 失败处理：修复至绿，不得带病进入 Phase B

### Phase B：停服 + 临时脚本 + dry-run（时序③④）

**T4. 停 API**

- `preview_stop`（serverId: api；仅停 API，PG/Redis/MinIO 保持运行——清 Redis 键需 Redis 在跑）
- verify: `netstat -an | grep ":3000"` 无 LISTENING

**T5. 编写临时脚本 `apps/api/scripts/__tmp-cleanup.ts`**

结构（单文件、顺序执行、两档模式）：

```
1. 环境守卫（N3）：解析 DATABASE_URL（host ∈ {localhost,127.0.0.1} 且 db=flowweb）、
   MINIO endpoint=127.0.0.1:9000、bucket=flowai；Redis host 同校验；任一不匹配 → 打印并 exit(1)
2. 留痕快照（R2+N1）→ backups/2026-09-04-cleanup/{pre,post}/（S1：清理前 pre/、
   二次 dry-run 时 post/，前后对照）——路径用 path.resolve(__dirname,'../../../backups/2026-09-04-cleanup')
   显式锚定仓库根（S2：脚本 cwd 是 apps/api，相对路径会误落 apps/api/backups/）：
   a. minio-manifest.json   ListObjectsV2 全量 key+size
   b. db-snapshot.json      Session/ContentCard/TeamMember 三表导出
   c. failed-jobs.json      动态 SCAN MATCH bull:*:failed 发现全部失败队列（P3：
      zset 只存 jobId，原因须逐个 HGET bull:<q>:<jobId> 的 failedReason/name/finishedOn）
   d. substring-scan.json   N1 全库子串兜底扫描结果
   e. redis-keys-census.json  bull:* 按 队列名:后缀 聚合计数（勾稽 195）
3. 计算保留集（B3）：
   - DB 反查 4 字段（HomeBanner.imageKey / Media.key[未软删] / Media.thumbnailKey[未软删] / subscription_banner.backgroundImageKey）去空并集
   - 叠加 N1 兜底（S5 简写法）：5 类内嵌载体列（LightingTask.originalImageUrl/resultImageUrl、
     CanvasDoc.state、CanvasDocUpdate.update、Template.templateData、Media.metadata）
     一次性拉回 Node，内存里对每个待删 key 做 includes——bytea 列（Yjs 二进制）
     用 Buffer.toString('latin1') 逐字节解码（等价 SQL_ASCII，天然规避 P5 的
     UTF8 invalid byte sequence）；Text/Json 列正常 toString。完整 key 子串对
     「存 key / 存签名 URL」两种形式都能命中；命中移入保留集并告警
   - 双向断言 vs 硬编码基准（3 个 Banner key）：⊇ 且 ⊆，失败 exit(1)
4. dry-run（默认）：输出保留集清单 / 断言结果 / 兜底命中 / 将删对象数+大小 / 将删 Redis 键数 / 将删 DB 行数
5. --execute：按序执行
   ⑤ Redis：SCAN bull:* 分批 DEL
   ⑥ MinIO：排除保留集 → DeleteObjects ≤500/批
   ⑦ PG：DELETE Session；DELETE ContentCard
```

- Redis 连接（P2）：**.env 无 REDIS_URL，仅 REDIS_HOST=localhost/REDIS_PORT=6379**（API 经 env.ts 默认值 redis://localhost:6379/0 连 db0）——脚本用 `new Redis({ host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379), db: 0 })`
- 依赖：`@aws-sdk/client-s3`、`@prisma/client`、`ioredis`、`dotenv`（apps/api dependencies，可解析）
- 运行：`cd apps/api && npx tsx scripts/__tmp-cleanup.ts`（dry-run）/ `npx tsx scripts/__tmp-cleanup.ts --execute`

**T6. dry-run 并人工核对**

预期输出（与审计基线一致，任一不符即停）：
- 保留集 = 3 个 Banner key（双向断言 PASS）
- N1 兜底 0 命中
- 将删 MinIO 对象 = 383 个 / ≈2.51 GB
- 将删 Redis bull:* = 195 个（勾稽：53 repeat + 42 failed + 41 job 键 + 59 结构键）
- 将删 DB = Session 12 + ContentCard 8

### Phase C：执行清理（时序⑥⑦⑧）

**T7. `--execute` 执行** → verify: 脚本输出各步完成计数、无错误

**T8. 跑 seed 补 default-team member**

- 前置：T2 已完成（HY_IMAGE_API_KEY 在 .env）；先 `cd apps/api && npx prisma generate`（P1：tsc 不覆盖 prisma/，generate 确保 Client 与 schema 一致，teamMember delegate / teamId_userId 复合键拼错在此步即暴露）
- `cd apps/api && npx prisma db seed`（跑整个 main()，其余为幂等 upsert/update:{} 不改既有数据；admin 已存在仅校验 role 不重建；**末尾 `process.exit(0)` 为 seed.ts:255 有意为之（auth 顶层 ioredis 会挂起进程），非异常**）
- **失败隔离（S4）**：T7 已清完的状态不受 seed 报错影响、也不产生新脏数据——修好（多半是忘了 generate 或 .env）后单独重跑 seed 即可，不必重跑清理。补 member 的 upsert 在 seed 后半段；:82 对已存在记录走 `update:{}` 不写 apiKey，即便漏配 HY_IMAGE_API_KEY 也不阻断补 member
- verify: DB 查询 default-team 成员数 = 1（OWNER=default-user）

### Phase D：验收 → 重启 → 收尾（S1 修正版时序）

> S1 修正说明：评审原案"T10 启动 → T11 dry-run"存在矛盾——启动后 `onModuleInit` 立即注册 repeat 键，"将删 bull:*=0"必然不成立。故**二次 dry-run 提前到启动前**，启动后只做 V4②/③/④。

**执行纪律（P7）**：API 停机窗口内**不操作 Web 页面**（5173 的 Hocuspocus/socket 重连失败属正常；API 恢复瞬间若在未登录态点执行/图编辑/故事板，会触发 default-user fallback 写入新数据，污染 V1 观察基线）。V4③④ 等 API 完全起来后再做。

**T9. 二次 dry-run 当验收（API 仍停机；留痕落 post/ 目录）**

- `npx tsx scripts/__tmp-cleanup.ts`（不带 --execute）
- 通过标准（一次性客观覆盖 V1/V2/V3）：
  - 保留集 = 3 个 Banner key、双向断言 PASS
  - 将删 MinIO 对象 = **0**（= 剩余恰为保留集 3 个）
  - N1 兜底命中 = 0
  - 将删 bull:* = **0**
  - 将删 Session = 0、ContentCard = 0
  - post/ 与 pre/ 留痕对照归档

**T10. 启动 API**（`preview_start "api"`）→ verify: 日志出现 `Nest application successfully started`、无错误（该日志在所有 onModuleInit await 完成后才打印，看到它时 repeat 已注册，V4② 无时序竞争）

**T11. V4 验收**

| 验收 | 命令/方式 | 通过标准 |
| --- | --- | --- |
| V4① | preview_logs api | 无错误日志 |
| V4② | S3 内联命令（见下） | 两队列各打印 1 |
| V4③ | preview 打开 http://localhost:5173 | 登录页正常渲染 |
| V4④ | 浏览器登录 admin@flowweb.local 后访问首页/admin Banner | 图片正常显示（3 个保留对象在用）；密码默认 `admin12345`（seed.ts:234，.env ADMIN_PASSWORD 可覆盖） |

V4② 内联命令（Git Bash，bullmq CJS 构建；`q.close()` + `process.exit(0)` 防连接挂起）：

```bash
cd D:/flowweb/apps/api && node -e "const {Queue}=require('bullmq');(async()=>{for(const n of ['subscription-grant-credit','subscription-expire']){const q=new Queue(n,{connection:{host:process.env.REDIS_HOST||'localhost',port:+(process.env.REDIS_PORT||6379)}});console.log(n,(await q.getRepeatableJobs()).length);await q.close();}process.exit(0);})()"
```

**T12. 收尾：删除临时脚本 + git 提交**

- `rm apps/api/scripts/__tmp-cleanup.ts` → verify: `ls apps/api/scripts/` 仅剩 backfill-team.ts
- git 提交：seed.ts + spec/plan 文档（.env、backups/、临时脚本不入库）
- 观察项登记（N5）：`uploads/default-user/`、`results/default-user/` 前缀对象数 = 0；`Media WHERE userId='default-user' AND createdAt >= 清理时刻` = 0（手动查询留档，不自动化）

**T12. 观察项登记（N5，手动查询留档不自动化）**

- 查询记入验收记录：`uploads/default-user/`、`results/default-user/` 前缀对象数（基线 0）+ `Media WHERE userId='default-user' AND createdAt >= 清理时刻` 计数（基线 0）

## 失败处理

- 任一断言/dry-run 核对不符 → 停止、不执行删除、报告用户；API 可先行重启恢复服务
- --execute 中途失败 → 脚本输出已完成步骤计数；MinIO/Redis/PG 删除均为幂等操作，排查后可重跑（保留集断言会重新计算）
- 全部完成后 git 提交：seed.ts 修改 + spec/plan 文档（.env、backups/、临时脚本不入库）

## 明确不做（对照 spec §6）

- 不添加任何自动清理/定期清理/软删回收机制
- 不删 admin 等测试账号体系
- 不动 default-user 回退残留代码（另行三阶段）
