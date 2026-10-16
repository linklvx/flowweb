<!-- doc-status: active | verified_at: 2026-10-16 -->
# 备份与恢复单一权威（Full-Stack Backup）

> **单一权威声明（Y0c T38/Z16 起）**：本文档=全仓备份/恢复唯一入口。三轨（部署面 deploy.sh pre-migrate／日常面 daily pg_dump crontab／大版本面手动全栈快照）合一于此；runbook（collab-ops-runbook.md §13）只留指针不复刻内容，避免双源。服务器=Ubuntu 24.04（101.42.94.107），PostgreSQL 16.14，备份目录 `~/backups/`。

## 1 现状三轨

| 轨 | 载体 | 触发 | 保留 | 用途 |
|---|---|---|---|---|
| ① 部署面 pre-migrate | `deploy.sh` ② `pg_dump -Fc ~/backups/pre-migrate-<ts>.dump` | 每次部署 migrate 前自动 | 5 份滚动（`ls -t \| tail -n +6 \| xargs rm`） | 迁移回滚锚（migrate=链上唯一不可逆操作；REBUILD_DB 回退锚） |
| ② 日常面 daily | `scripts/pg-dump-daily.sh`（crontab `17 3 * * *`，日志 `.data/pg-dump-daily.log`） | 每日 03:17 自动 | 14 份滚动 + 水位守护（>85% 删最旧） | 日常恢复面（RPO≤24h；atomic 命名+失败不删旧） |
| ③ 大版本面手动全栈快照 | 本文档 §6 方法论（v3.10 起） `backups/vX.X/` | 大版本节点人工仪式 | 永久（Git tag+backup 分支双锚） | 代码+DB+MinIO+Redis 全栈恢复 |

轨②脚本要点（详见脚本头注）：DSN 提取=deploy.sh ② 同款（剥 Prisma 参数走 libpq）；atomic=`.daily-<ts>.dump.tmp` 先写→exit 0 且非空才 `mv` 转正；**失败不删旧**=任何失败路径零删除动作+exit 非零+ERROR 日志；`BACKUP_DIR`/`WATERMARK_PCT` 两 env=演练/测试面非配置灵活性（生产 crontab 恒默认值）。

## 2 保留分层表

| 族 | 份数 | 删除条件 | 删除者（唯一所有权） | 恢复语义 |
|---|---|---|---|---|
| `pre-migrate-*.dump` | 5 | 新备份成功后删第 6 份起（mtime 最旧） | `deploy.sh` ② | §3.4 pg_restore |
| `daily-*.dump` | 14 | (a) 滚动：dump 成功后删超 14 份最旧（文件名字节序=时序，`LC_ALL=C sort`）(b) 水位：文件系统 >85%（df 口径对齐 deploy.sh 拒部署门）删最旧直到达标；**族耗尽仍 >85%⇒ERROR+exit 非零=守护失败可见须人工介入** | `scripts/pg-dump-daily.sh` | §3.4 pg_restore |
| `redis.conf.bak-*` | 不滚动 | 人工 | 人工 | runbook §12 回滚分支 |
| `backups/vX.X/`（手动快照） | 永久 | 不删 | — | §6 恢复步骤 |

**跨所有权红线（§0.6 偏离 60）**：pg-dump-daily.sh 水位守护只删 `daily-*` 族——`pre-migrate-*` 是部署回滚锚，跨所有者删除=越权（守护脚本删掉回滚锚的爆炸半径>磁盘水位本身）。

## 3 恢复语义（Z16③④）

### 3.1 Redis 全丢恢复一句话

**看到队列空了别慌、禁手工重投**：api 启动 `verifyActive` 扫描按 jobId 查 BullMQ→查不到→三查（DB 意图行/账本/投影）→`rollbackRunning`+`settleStranded` 自动收敛——手工重投=与 reconcile 双写竞争，禁止。

### 3.2 PG 恢复对象（collab 三表点名）

恢复必须完整覆盖 **`CanvasDoc` / `CanvasDocUpdate` / `CollabLease`** 三表（画布文档态+增量账本+租约）——只恢复业务表漏掉 collab 三表=文档状态与租约/账本漂移，协作面结构性损坏。整库 `pg_restore -c --if-exists`（§3.4）天然覆盖；**禁按表挑拣恢复**。

### 3.3 恢复后 bump generation（两行）

1. PG 恢复到旧时间点后，对受影响 project bump `CanvasDoc.generation`（n+1）——客户端 IDB 缓存四维键 `uid:pid:g<generation>:s<schemaVersion>`（apps/web/src/collab/local-cache-key.ts:25）随 generation 变化**结构性隔离**旧本地快照=恢复安全载体（旧快照不再回放污染恢复后文档）。
2. 既有承载=`POST /api/collab/doc/:projectId/vacuum`（Y0b-4 T9a：`vacuumReplace` 单事务 generation n+1，collab-doc.controller.ts:43）——注意 vacuum 同时重建画布历史（重操作），恢复后按需对受影响 project 逐个调用；无 bump-only 专用工具（不新造，spec Z16④ 最小承接口径）。

### 3.4 恢复命令

```bash
# 服务器（ubuntu@101.42.94.107）：daily/pre-migrate dump 恢复（整库，-c 先清后建）
DSN=$(grep -m1 "^DATABASE_URL=" /home/ubuntu/flowweb/apps/api/.env | cut -d= -f2- | tr -d '"' | sed "s/?.*$//")
pg_restore -d "$DSN" -c --if-exists ~/backups/daily-<ts>.dump
# 恢复后：重启双进程（pm2）→ verifyActive 自动收敛（§3.1）→ 受影响 project bump generation（§3.3）
```

## 4 MinIO 无备份缺口=Y7 上线前门槛项（Z16②）

服务器侧 MinIO **无任何备份**：产物 URL 直指 MinIO 对象（图片/视频/音频素材），数据丢失=画布图全裂。当前无生产环境可接受——**登记为 Y7 上线前门槛项，不留白**（Y7 上线评审必须给出处置：对象级备份/异地复制/接受风险显式签字，三选一）。

## 5 PITR（模板未启用——挂 Y7）

### 5.1 模板指针

`deploy/postgres/pitr-template.conf`（仓内模板，**服务器零动作**）：wal_level=replica+archive_mode=on+archive_command（WAL 归档至 /home/ubuntu/wal-archive）。当前恢复面=daily dump（RPO≤24h）；PITR（RPO≈WAL 段粒度）为 Y7 上线前升级项。

### 5.2 上线前执行清单（Y7 携带）

1. 核查服务器 PG 大版本（2026-10-16 实测 16.14，配置目录 `/etc/postgresql/16/main/`——以届时实际为准）。
2. 预建归档目录：`sudo mkdir -p /home/ubuntu/wal-archive && sudo chown postgres:postgres /home/ubuntu/wal-archive`。
3. 模板三参合入 `/etc/postgresql/16/main/postgresql.conf`（合入前 `sudo cp` 备份至 ~/backups/，runbook §12 步骤 2 同款纪律）。
4. `sudo systemctl restart postgresql` → 断言 `psql -c 'SHOW archive_mode'`=on、`SELECT pg_current_wal_lsn()` 后 `pg_switch_wal()` → 归档目录出现 WAL 段。
5. 空间守护：WAL 归档目录纳入 >85% 水位巡检口径（deploy.sh 门/runbook §6 ② 同源）+归档滚动策略届时定。
6. 恢复演练一次（restore_command 指向归档目录恢复到临时库）后方可宣布 PITR 可用。

## 6 手动全栈快照（轨三——大版本节点仪式，v3.10 方法论）

版本节点（核心功能稳定后）执行完整备份，覆盖应用层、数据层、存储层、缓存层。每层独立备份独立恢复，不依赖任何单一工具。**开发机（Windows）本地面**——与服务器 daily 轨互补（快照含 MinIO/Redis/代码，daily 只含 PG）。

### 备份结构

```
backups/vX.X/
├── BACKUP.md              # 版本信息、凭证、恢复步骤
├── code/
│   ├── flowweb-vX.X-source.zip   # git archive 源码包
│   └── config-files/
│       ├── api.env                # 环境变量（密钥/连接串）
│       ├── .gitignore / package.json / turbo.json 等 # 项目元配置
│       ├── claude/                # .claude 配置（launch.json 等）
│       ├── superpowers/           # .superpowers 配置（brainstorm 等）
│       └── services/redis/        # Redis 服务配置
├── db/
│   ├── flowweb.dump        # pg_dump -Fc 自定义格式
│   └── flowweb_plain.sql   # pg_dump 纯文本 SQL
├── minio/
│   ├── main_data/          # .data/minio 完整复制
│   └── shadow_data/        # flowweb.data/minio 完整复制
└── redis/
    └── dump.rdb            # Redis RDB 快照
```

### 执行步骤

1. **锁定版本**：`git tag vX.X -m "vX.X: 描述"` + `git branch backup/vX.X`
2. **备份源码**：

```bash
git archive --format=zip HEAD -o backups/vX.X/code/flowweb-vX.X-source.zip
# 手动复制 .gitignore 排除的配置文件
cp apps/api/.env backups/vX.X/code/config-files/api.env
cp -r .claude backups/vX.X/code/config-files/claude
cp -r .superpowers backups/vX.X/code/config-files/superpowers
cp services/redis/redis.windows.conf backups/vX.X/code/config-files/services/redis/
cp .gitignore package.json turbo.json tsconfig.base.json pnpm-workspace.yaml pnpm-lock.yaml \
   backups/vX.X/code/config-files/
```

3. **备份数据库**：

```bash
# 自定义格式（推荐用于恢复）
pg_dump -h localhost -U flowweb -d flowweb -Fc --no-owner --no-acl \
  -f backups/vX.X/db/flowweb.dump
# 纯文本 SQL（兼容性备选）
pg_dump -h localhost -U flowweb -d flowweb --no-owner --no-acl \
  -f backups/vX.X/db/flowweb_plain.sql
```

4. **备份 MinIO**：`cp -r .data/minio/* backups/vX.X/minio/main_data/` + `cp -r flowweb.data/minio/* backups/vX.X/minio/shadow_data/`
5. **备份 Redis**：`cp "C:\Program Files\Redis\dump.rdb" backups/vX.X/redis/dump.rdb`

### 恢复步骤

- **数据库**：方式 A `pg_restore -h localhost -U flowweb -d flowweb -c --if-exists backups/vX.X/db/flowweb.dump`（推荐）；方式 B `psql -h localhost -U flowweb -d flowweb -f backups/vX.X/db/flowweb_plain.sql`。恢复后走 §3 恢复语义（collab 三表覆盖+bump generation）。
- **MinIO**：`cp -r backups/vX.X/minio/main_data/* .data/minio/` + `cp -r backups/vX.X/minio/shadow_data/* flowweb.data/minio/`
- **Redis**：`cp backups/vX.X/redis/dump.rdb "C:\Program Files\Redis\dump.rdb"`（Redis 恢复语义见 §3.1——禁手工重投）
- **代码**：`git checkout vX.X`（或 unzip 源码包）+ `cp backups/vX.X/code/config-files/api.env apps/api/.env` + `pnpm install`

### 设计原则

- **每层独立**：即使 Git 仓库损坏也能从 code/ 目录完整还原
- **双格式数据库**：`-Fc` 高效恢复 + 纯文本 SQL 兼容备选
- **完整存储层**：对象存储（MinIO）数据直接文件复制，不依赖工具导出
- **双重锚定**：Git tag + backup 分支防止误删
- **自文档化**：BACKUP.md 记录恢复步骤，无需外部知识
