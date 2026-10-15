<!-- doc-status: active -->

# collab 部署运维手册（Y0a-4）

协作画布上线后的部署、迁移、回滚与告警操作手册。所有数值实证出处：`docs/superpowers/deploy-server-profile-2026-10.md`（下称 server-profile，采集基准 commit `850b35cd`）。部署脚本唯一源=`deploy.sh`（v4.2），进程定义唯一源=`ecosystem.config.cjs`（冻结契约 9）——本章不复刻全量命令，只解释语义与判定。

## §0 前置条件

部署链每个外部前置及其 T0 实测状态——任何一条不满足，对应环节 fail-closed 拒绝。

| 前置 | 判定方式 | T0 实测（server-profile） |
|------|---------|--------------------------|
| 服务器 Node ≥22（fetch+WebSocket 双门——deploy-guard 用 fetch；collab-smoke 的 provider 用原生 WebSocket，Node 20 无→冒烟必挂 `WebSocket is not defined`） | cutover ⓪ 内置断言（`typeof fetch==='function'` + `typeof WebSocket==='function'` 双查） | v22.23.3 ✓（Y0a-4 T12 由 20.20.2 升级——nodesource 20.x→22.x） |
| pg_dump 在位（cutover ② 迁移前备份） | cutover ② 直接执行，缺即失败 | /usr/bin/pg_dump 16.14 ✓（[6]） |
| rsync（cutover ③.5 账本迁移加速） | 可选——缺失回退 `cp -a` | /usr/bin/rsync ✓（[6]） |
| SSH 私钥 | 本地 `~/.ssh/flowweb_server` | deploy.sh 内置路径 |
| COLLAB_ADMIN_TOKEN（drain 唯一凭据，W23） | cutover ① guard pre 段检查存在性 | **未设**（[2]/[F7]）——**首次部署前必须新增** |
| 服务器 .env 可被 shell 工具直读 | grep/cut 拼 DSN 前须 strip `\r` | CRLF/LF 混合行尾（[F8]）——psql 直读曾报 `database "flowweb" does not exist`（库名被 `\r` 污染）；应用侧 dotenv 加载器会 strip，仅裸 shell 工具受影响 |

**首次部署前必须做**：向服务器 `apps/api/.env` 追加 `COLLAB_ADMIN_TOKEN=<openssl rand -hex 32 生成>`（chmod 600 已满足，[4]）。无令牌时 drain 403 fail-closed，guard pre 段必失败——这是 W23 有意设计（无凭据=不可 drain=不可部署），不是故障。

**本地跑 preflight 前必须停本地 dev API**：preflight 的 int 单源链会操作 `CollabLease` 单行，会把在跑的 dev 实例 fenced（deploy.sh preflight 内有同款提示）。

**Windows 本地调试 deploy.sh**：用 Git Bash 绝对路径（如 `"C:\Program Files\Git\bin\bash.exe" ./deploy.sh api`）——PATH 上的 `bash` 是 WSL stub，实测 `E_ACCESSDENIED`；`bash -n` 语法校验由 CI 承载。

## §1 pm2 迁移（现行实例 → ecosystem 唯一定义）

把现行裸参数 pm2 实例（`--max-old-space-size=384`、kill_timeout 默认 1600ms、无 max_memory_restart，M1 基线）切换到 `ecosystem.config.cjs` 唯一定义（fork/1 实例/kill_timeout 45000/max_memory_restart 1G/old-space 512/COLLAB env 白名单注入）。

**唯一命令（幂等，首启/更新均同一条）**：

```bash
cd /home/ubuntu/flowweb && pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save
```

- 该命令由 deploy.sh cutover ⑤ 自动执行，人工不需要单独跑；本文列出是为事故手工恢复时与脚本保持一字不差。
- **禁 `pm2 delete flowweb-api` 再 start**：绕过 drain 拒重启机制，且制造无守护窗口（ WS 断连无计划窗口可言）。重生进程一律走 startOrReload。
- **禁 `pm2 restart` 代替**：restart 不重读 ecosystem 文件（B1′）——改了 `ecosystem.config.cjs` 只有用 startOrReload 才生效。
- `--update-env` 会把当前 shell 全量 env 记入 pm2_env——**部署会话禁止 export 无关变量**（B25；cutover/rollback 体内仅白名单 `GIT_COMMIT_HASH`）。

**迁移自证（独立 ssh，不依赖部署会话）**：

```bash
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 \
  "pm2 jlist | node -e \"const a=JSON.parse(require('fs').readFileSync(0,'utf8'));const j=a.find(x=>x.name==='flowweb-api');console.log(JSON.stringify({mode:j.exec_mode,instances:j.instances,kill_timeout:j.pm2_env.kill_timeout,max_memory_restart:j.pm2_env.max_memory_restart,old_space:j.pm2_env.node_args,status:j.pm2_env.status,restart_time:j.pm2_env.restart_time,commit:j.pm2_env.GIT_COMMIT_HASH}))\""
```

期望：`mode=fork_mode`、`instances=1`（E35 单实例钉死）、`kill_timeout=45000`（≥关停链 22s+垫）、`max_memory_restart=1073741824`、`old_space` 含 `--max-old-space-size=512`、`status=online`。数值依据：server-profile 数值推导（算式 1/2：512+384=896≤1024；1710.6≤1900）。

**服务器 `apps/api/src` 目录**：零构建锚落地后服务器只作部署树（provision_tarball 不再上传 src……铺底 tar 含 src 但构建在本地），首次 full 部署后服务器 `apps/api/src` 即退役冗余，可删（不影响任何运行路径——运行只读 `apps/api/dist`）。

## §2 连接池量纲

连接池上限按"每进程 PrismaClient 客户端数 × connection_limit"显式预算，总额不得超过 `max_connections` 减协作头寸。

- **量纲算式**：`客户端数 × connection_limit × 实例数 ≤ max_connections − 头寸`。实例数=1（E35）。
- **客户端数现值 = 3/进程**：PrismaService（DI 主客户端）+ authPrisma（betterAuth 模块顶层自建）+ preload 临时客户端（其 catch 已收口 disconnect，B30——按短时峰值计）。
- **max_connections = 100**（server-profile [F4]）；flowweb 库现用连接 5（[F8]），余量充足。
- **connection_limit 现状 = 未显式设置**：Prisma 默认取 `CPU核数×2+1`（2 核机=5），隐式预算 3×5=15 ≪ 100。Y0.5 连接池治理时若显式调参，按上式重算并在此更新。
- **Prisma 事务 timeout ≠ URL 上的 pool_timeout**：前者是单事务时长上限（默认 5s），后者是等连接池出票的上限——池打满时报错的是 pool_timeout，调事务 timeout 无效。
- **单例收敛已三次驳回（E46）**：auth.ts 在 DI 容器外模块顶层执行，重构初始化序的爆炸面 > 三池预算收益——Y0.5 重评，本批只纳管显式预算，不改代码。

## §3 部署链语义

按 deploy.sh 执行序解释每个环节的语义、门禁与失败复原——**命令以 deploy.sh 为唯一源**。

### 3.1 模式与旗标

| 命令 | 语义 |
|------|------|
| `./deploy.sh full` | 首次铺底：tar 铺底源码树 → web → api（install/generate/migrate 由 api 链单点负责） |
| `./deploy.sh web` | 仅前端：本地 vite 构建 → 上传 → 原子切换（后端不重启） |
| `./deploy.sh api` | 仅后端：preflight → 本地构建 → 上传 → 条件 install → cutover 全链 |
| `./deploy.sh api --rollback` | 快回滚（§5），30s，跳过 preflight |

旗标：`--force-restart` 两类合法用法（drain 后未排空、目标机器不可达）——**每次使用留部署记录**；`--allow-legacy` 豁免 guard 的 legacy 进程形态检查；`--skip-smoke`/`--skip-preflight` = 本次部署**不构成判据**（强制留痕，禁用于常规发布）；`--rebuild-db` = 服务器库重建（DROP SCHEMA+重放 init，破坏性——回退锚=cutover ② pg_dump，唯一权威流程与执行时序清单=`deployment-db-baseline.md` §3，禁用于常规发布）。**unobservable 档不可 force**：ready 无 pending（token 视图缺失）/drain 401/403（凭据失配）均属无账可算——放行即 at-risk 语义谎言；遇 guard 403 的唯一出路是核对令牌（§0/§1），不是 force。

cutover ① 的**拒重启三步**（scripts/deploy-guard.mjs）：drain（20s 续期轮询 r.ok）→ own 四零核验（own spool/stranded 帧，预算 90s，P40）→ 放行（写 `.deploy-guard-state.json` 交接 epoch）。guard 拒绝时 dist 未动、旧构建继续跑。drain 后部署中止的冻结由 **60s 自动解除**（SV12）兜底，可安全重试。重启后 post 段预算另账 120s（P35：收养窗 60s+reconciler 30s+回灌余量）。

### 3.2 spool 账本目录（树外）与 ③.5 自动迁移

spool 账本目录在**部署树外** `/home/ubuntu/flowweb-data/collab-spool`（ecosystem env 注入，P47）——部署树内的 `.data` 被铺底 tar `--exclude` 纪律保护不再是唯一防线。

- **迁移在 cutover ③.5 内自动执行**（guard 之后、dist 切换之前的秒级窗口）——**勿提前手工迁移**（提前迁=guard 核验窗口内账本已被搬走，own 判据空转）。
- 改 `COLLAB_SPOOL_DIR` 必触发迁移，计数等式把关：迁移后 `old ≤ new`，不等即中止部署（人工核对）。
- T0 实测：两处旧候选目录均不存在（0 帧，[4]）⇒ 首次部署时 ③.5 判"无需迁移、仅建新目录"——属预期输出，不是跳过故障。

### 3.3 迁移 additive 纪律与 preflight 收据

- **additive 双检**：本地（preflight 内）+ 服务器（cutover ③）各跑一次 `check-migration-additive.mjs`；BASELINE='20261009140100_y0b2_init'（Y0b-2 T1 squash，2026-10-10 第三次重置）之后的迁移必须 additive（expand/contract）；收缩步骤（DROP 等）的豁免 = 同 commit 内抬高 BASELINE 常量并留注释。
- **migrate diff 棘轮（Y0b-2 T1）**：verify 链含 `check-migrate-diff.mjs`——prisma migrate diff（from-migrations vs schema datamodel）漂移行只许收窄禁新增，金标=`apps/api/prisma/migrate-diff-allowlist.txt`（逐字归一化行；唯一永久豁免=pricing_rule_natural_key——NULLS NOT DISTINCT 语义 Prisma 不可表达）。
- **服务器 rebuild（Y0b-2 squash）**：deploy.sh api --rebuild-db + 人工 tsx prisma/seed.ts + gate-seed + MinIO 孤儿清理 scripts/cleanup-orphaned-media.ts；数据=确认丢弃；服务器 .env 需人工补三枚 PROVIDER_MOONSHOT_API_KEY/PROVIDER_TENCENT_API_KEY/DASHSCOPE_API_KEY 密钥（deploy.sh 不传 .env——缺失=启动断言拒启）。
- **preflight 收据**：`.preflight-<SHA>.ok` 同 SHA 幂等复用（verify/int/migrate/additive 不重跑）；**gate-collab 不进收据**（有状态，每次部署都跑）。**收据的 CI 等价证据形态**（Y0a-4 run#1 实测登记）：本地全量 preflight 对偶 flaky（同 SHA 三轮各挂不同测试——persist-status/managed-redis/auth-reason，单跑全绿+CI 同 SHA 绿）时，收据可以"**CI 同 SHA 全绿**"为等价证据落（本例 CI run #25）——诚实登记，不复跑凑绿。
- **pm2 溯源口径（Y0a-4 T12 实测）**：pm2 8.0.0 剔除 GIT_* 前缀 shell env——显式 export+startOrReload --update-env 后 pm2_env 与 /proc environ 均无 GIT_COMMIT_HASH，P34 的 pm2_env 口径不成立；溯源以**产物口径**满足（dist/build-info.json≡本地 HEAD+cutover ④ sha256 锚绑定）；main.ts:68 Sentry release 保持 unknown（Sentry 未激活零实害；Y0.5 改名注入 FLOWWEB_GIT_SHA 或 ecosystem 承载）。
- **git 断言**：工作树不干净拒部署；HEAD 不在 origin/master 上（未经 CI）拒部署。
- **migrations 目录上传缺陷（Y0.5 登记）**：deploy_api tar 解包对远端 prisma/migrations **只覆盖不清理**——Y0a-4 T12 实测服务器残留 44 个目录含 20 个已删老迁移（已手工清理+全量重传镜像）。修复去向=Y0.5（deploy_api 上传 prisma 前清远端 migrations 目录）。**Y0b-2 squash 后首次部署必中此坑**（远端仍有 20261009031416_init/20261009040355_y0b1_funds_columns 两旧目录+_prisma_migrations 两行——migrate deploy 会判新 init 未应用而重放炸"类型已存在"）；rebuild-db 形态删库重建不受影响，普通部署前须先手工清远端旧目录。

### 3.4 失败复原（trap 三阶段）

`set -eo pipefail` 下任一环节失败即中止，trap 按 `SWITCH_BEGUN`/`SWITCHED` 分阶段给出指引：

| 阶段 | 状态 | 指引 |
|------|------|------|
| 切换前失败 | dist 未动，旧构建在跑 | 修复后重跑；若已 drain：60s 自动解除后重试 |
| 切换半途失败（SWITCH_BEGUN=1） | dist 可能已 mv 走、dist.next 未就位 | **勿重启 pm2**——跑 `./deploy.sh api --rollback` 或人工补 `mv dist.next dist` |
| 切换后 post/冒烟失败（SWITCHED=1） | 新构建已上线 | `./deploy.sh api --rollback`（30s）或修复后重新部署 |

### 3.5 nginx /collab block 替换

**替换语义（非追加）**：同 server 内双 `location /collab` = `nginx -t` duplicate 直接炸——配置片段在 `deploy/nginx/collab-location.replace.conf`，步骤：

```bash
# ① 备份站点文件（路径按服务器实际站点配置为准）
sudo cp /etc/nginx/sites-available/flowweb /etc/nginx/sites-available/flowweb.bak.$(date +%Y%m%d%H%M%S)
# ② 删除既有 /collab block 整段（T0 实测 /collab block 数=0（server-profile [F3]）——本次为纯新增，跳过）
# ③ 贴入 collab-location.replace.conf 全部内容（含 location = /api/drain { deny all; }）
# ④ 语法校验，失败即用备份回滚
sudo nginx -t || sudo cp /etc/nginx/sites-available/flowweb.bak.* /etc/nginx/sites-available/flowweb
# ⑤ 生效
sudo systemctl reload nginx
```

**检测式**（部署后核验，判据="存在且仅一个 location /collab"）：

```bash
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 "sudo nginx -T 2>/dev/null | grep -c 'location /collab'"   # 期望 1
curl -s -o /dev/null -w '%{http_code}\n' https://www.flow123.com/api/drain                                   # 期望 403（deny 生效）
curl -s -o /dev/null -w '%{http_code}\n' -H 'Connection: Upgrade' -H 'Upgrade: websocket' https://www.flow123.com/collab  # 非 4xx/5xx 拒绝即通（ws 握手由后端应答）
```

`access_log off`（E13）：WS query token 不落 nginx access log——Y0b cookie-only 根治前的止血。`/api/drain` deny（B11）：deploy-guard 走 127.0.0.1:3000 直连不经 nginx，零副作用；@SkipThrottle 覆盖的 drain 爆破面经此关闭。

### 3.6 Y0a 与 Y0b 必须同批部署（§9.7 约束）

Y0a 数据完整性设计与 Y0b 客户端感知必须同批上线（spec `2026-10-06-y0a-data-integrity-design.md` §9 第 7 项）：崩溃租约接管等待（TTL 10s）与加载超时自愈（≤8s）叠加预计超过客户端 10s 同步死线——只上 Y0a 不上 Y0b 时，用户在租约丢失窗口（≈11s，§9 第 14 项）内会看到同步中断且无语义提示。

### 3.7 Y0b-5 部署清单（2026-10-12 落档——七步可执行；plan=2026-10-12-y0b-5-terminal-and-observability.md T18 Step 3）

1. **前置核对**：Y0b-4 部署（api+web 同批 csv=2）已执行？否=先执行或与本批同窗（§3.6 同批纪律同源）。
2. **`.env` 新键**：`ALERT_SMS_TO`（可选——未设 SMS 跳过）、`SENTRY_DSN`（可选）、`PROMETHEUS_TOKEN`（★必设——/metrics 生产 fail-closed 403，巡检与外部抓取的消费前提）；零新必填键；web 零新依赖（离线副本=自研 IDB 适配器）。
3. **迁移**：T12 后常规 `migrate dev --create-only` 产物+`prisma migrate deploy`+fresh-replay 门禁绿+T12-0a「先清后传」生效（Y0b-4 偏离 52 pricing 索引 drift 残留形态由 dump-schema-objects 双向比对一并核对）。
4. **crontab 巡检**（§6 T15 节复制即用）：`*/5` 巡检+日志追加+心跳文件外层判据+第二机/uptime 外部探测行；★先于 crontab 装巡检启动自证——服务器本机 `curl -H "x-prometheus-token: $PROMETHEUS_TOKEN" http://localhost:3000/metrics` 期望 200、无 token 期望 403（fail-closed 生效双断言；token 缺失=巡检全 P1 insufficient）。⚠️ metrics 面不经公网暴露——nginx 无 /metrics 路由（公网该路径落前端 SPA 兜底页，2026-10-13 部署实测）；巡检/collab-ready token 视图（header 同名 `x-prometheus-token`，判定 `COLLAB_ADMIN_TOKEN ?? PROMETHEUS_TOKEN`）均走本机。
5. **deploy post**：exec-smoke 资金链冒烟进链（哨兵 moonshot+独立 NodeType `smoke:y0b5:text`——首跑观察）。
6. **部署后验证**：/api/ready token 视图 degraded 四键+/metrics 新指标族（带 PROMETHEUS_TOKEN 头——`yjs_doc_bytes` 直方图/`awareness_states`/`collab_pg_breaker_state`/`collab_telemetry_*`）+巡检 exit 0+浏览器手验：断网编辑→刷新→本地副本→恢复复合。
7. **回滚说明**：T8 回滚后浏览器残留 IDB 库**无害的前提=terminal 清副本已生效**（残留窗口=terminal 到达前；清库后无残留读者）；`maxDelay` pin=30_000（=库默认——声明与代码一致）。

**soak 两数（T15 正式档——4 docs×8 conns，soak 修复 fd8a5711 后绿）**：

- **并发容量上限**：本地 dev 单进程 4 docs×8 conns 无拐点（frameP99=6ms/maxRSS 219MB 稳定）；★服务器 2C1.9G 部署后复跑校准（`node apps/api/scripts/collab-soak.mjs`——命令行留档）。
- **spool 存活窗**：正常态零增长不构成约束（PG 故障窗语义归 T16 熔断——§6 巡检 P0 行）。
- **测量口径**：每 client 独立 user+错峰建连（同瞬并发 AUTH>4=semaphore 设计防线——部署窗由 1012 jitter 0-60s 缓解）。


## §4 部署窗口与用户可见影响

部署窗口内的用户可见影响以客户端实测消费行为为准（v4.1/J1 改正）——以下三条是当前真相，任何文档表述不得与之矛盾：

| 窗口事件 | 客户端现状 | 出处 |
|----------|-----------|------|
| WS 1012（计划内重启） | **已消费**：30s 计划内重启静默窗口 + 1~3s 短退避重连，窗口内不升红色 banner | canvasCollabRuntime.ts:107/:837-841（conn.spec:213-264 用例） |
| write-frozen 冻结通告 | **零消费**：gateway 已推送，客户端无处理（自注释"Y0b 消费"） | collab.gateway.ts:664 |
| drain 期画布写 503 | **走通用失败态**：红点+手动重试（Retry-After:2 + autosave 三次退避）——用户看不到"服务正在重启"语义 | main.ts 限流层 |

**Y0b 工作项 = 消费 write-frozen 通告 + 503 语义化提示**（pre-real-user 阻断项）——不是从零实现重启感知，**勿重做 1012 静默窗口**。

发布纪律：**发布应在无人编辑时进行**。单人项目同栈代价（J1/R6/R7）：部署者即用户，窗口内自己的画布也受影响；付费执行与克隆请求落在窗口内会吃 503（通用失败态可手动重试，不丢已提交数据）。

## §5 回滚

**快路径（默认，30 秒）**：`./deploy.sh api --rollback` = dist.prev 翻回 + startOrReload + post 段，跳过 preflight/verify/int（事故路径，runbook 与 deploy.sh 分派层一致）。

- **前置**：上次部署的状态文件 `.deploy-guard-state.json` 在且 SHA 一致（P39——post 段不删档）；无 `dist.prev` 时脚本报错退出，走完整路径。
- **回滚不重跑 preflight、不回滚 migrate**：migrate 在 dist 切换之前执行，回滚 dist 不回滚 schema——schema 层问题必须走"恢复备份 + git revert 重新部署"。
- **回滚后溯源 +3 语义（Y0a-4 口径更正）**：pm2 8.0 实测剔除 GIT_* 前缀 shell env——pm2_env.GIT_COMMIT_HASH 口径**失效**（P34/P46 的 pm2_env 读取路径不成立）；溯源以**产物口径**为准：`cat apps/api/dist/build-info.json`（cutover ④ sha256 锚绑定保证 ≡ 被提升 dist 的真实构建）——回滚后显示 ≠HEAD 的旧 SHA 是**正确状态**；dist.prev 无 build-info（早于 P46 的构建）时按 `unknown` 兜底。

**完整路径**（代码缺陷需撤销提交时）：`git revert <sha> && ./deploy.sh api`（走完整 preflight 链）。

**migrate 数据层回滚**：恢复 `~/backups/pre-migrate-*.dump`（cutover ② 每次迁移前自动 pg_dump，保留 5 份；server-profile [6] pg_dump 16.14）：

```bash
pg_restore --clean --if-exists -d "$DSN" ~/backups/pre-migrate-<时间戳>.dump
```

**同机 dump ≠ 备份**：pg_dump 与库同机，磁盘/主机级故障时同归于尽——离机备份与 PITR 归 Y0.5/E47，本批不含。

## §6 最小可用告警

上线后第一周手动巡检 + 以下四条最小配置——不建监控栈，只封已知的静默失败口：

```bash
# ① pm2 日志轮转（T0 实测未安装，[F2]——不装则 pino 日志无界增长）
pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 10M && pm2 set pm2-logrotate:retain 7
# ② 磁盘水位（deploy_api 前置 >85% 已拒部署——平时巡检同阈值）
df --output=pcent / | tail -1
# ③ swap 水位（T0：swap 1.9G 已用 377M——存在历史内存压力信号；OOM killer 首选杀协居 postgres，swap 持续增长=内存画像恶化先行指标）
free -m | grep Swap
# ④ 开机自启核验（T0 实测 enabled ✓，[6]——服务器重启后 pm2 应自动拉起）
systemctl is-enabled pm2-ubuntu
```

**max_memory_restart 触发的重启 = 崩溃路径**（区别于部署驱动的重启）：按 RPO 3s 窗口评估数据丢失面，并查日志中 `shutdown_undrained`/storeInFlight 记录确认关停链是否走完——`↺` 计数无部署对应增长时即此路径。

**RPO 契约钉死（Y0c T21/Z61）**：SIGKILL 窗口 ≤maxDebounce 3000ms（=debounce 2000×1.5 写死在 gateway `maxDebounce` 行；E43⑥ 正常腿契约值——常驻化把丢数据窗从 ~0 放宽到契约内，非回归）。**maxDebounce 禁调大**（RPO 契约值，调大即放宽丢数据窗——防为省内存放宽 RPO）；SIGTERM 路径不变（drainAllDocuments 兜底）。

**Y0b-2 执行链观测处置三行**（资金运行时批新增——指标见 /api/metrics）：

1. **`intent_deadline_exceeded_total` 持续非零**——按 phase 分布三诊：`phase="queue"`=调度积压（查 pm2 worker 进程存活/BullMQ 队列深度）；`phase="call"`=provider 变慢（按 p99.9 标定上调对应 `EXEC_DEADLINE_*`——同批必须走下方 nginx 联动行）；`phase="waiting"`=队列积压升级档（**本次升级不耗用户 attempts**——服务端调度行为非用户重试，只查积压根因）。
2. **504（nginx 网关超时）处置**——服务端仍在执行（同步链超窗=回执丢失非工作丢失）：**禁止重启/发版**（会丢组内尾部未执行节点）；用 `GET /api/execution/intents` + doc exec 投影确认实际进度；`intent_claim_result_total{result="busy"}` 非零=超时重发已被幂等吸收（非资损，预期行为）。
3. **nginx 联动纪律**——改任一 `EXEC_DEADLINE_*` 或 `EXEC_SYNC_HARD_CAP` 必须同批重算 `deploy/nginx/api-location.replace.conf`（推导式=HARD_CAP+60s）并 `nginx -T` 复核生效值；`scripts/check-nginx-budget.mjs` 只锚 env.ts 默认值——**运行时 env 上调不覆盖**，须人工同步。

**解冻三触发线**（任一命中即重新评估冻结决策、考虑回退）：

1. 并发 WS >50 或常驻 doc >100；
2. store 写 P95 >1s 或 eventloop lag >200ms；
3. pm2 非部署驱动重启 >1 次/周（崩溃路径频发）。

**Y0b-5 T15 巡检（`scripts/check-collab-health.mjs`——cron */5+SMS+心跳自证）**：

crontab 行（复制即用；禁提交 crontab 文件——日志与状态都在树外 `.data/` 不进 git）：

```bash
*/5 * * * * cd /home/ubuntu/flowweb && node scripts/check-collab-health.mjs >> .data/collab-health.log 2>&1
```

- 退出码：0=健康；1=P1（ready=false 任何 reason/stuck 增量连续 2 轮=10min/zero_conn 不回落〔Y0c T20 口径=仅 WS 零且无 direct 持有——常驻会话持有的 doc 不计〕/auth bucket 高增/doc 超阈增量/degraded 四键越阈/awareness>8 持续/ws_close 4410+4404 占比；**Y0c T20 常驻重标（Z73/Z126①）**：overload tripped 连续——常驻集=预期态，冷 doc 拒绝期 tripped=1 是设计降级非静默故障，原 P0 重标 P1；**四稳态（Z122④）**：`yjs_shutdown_direct_leak_total`〔destroy_timeout 面〕/`collab_doc_vacuum_total{result="quiesce-timeout"}`/`collab_vacuum_autotrigger_stacked_total` 增量、`yjs_release_with_pending_total` 连续 2 轮增量〔refCount>0 瞬态 tick≠三出口病理——交织窗排除〕；**Z92 配对**：`yjs_resident_bytes` 超限而 over_limit/evicted 皆零〔连续 2 轮=字节约束死键〕或上限内 over_limit 连续 2 轮增量）；2=P0（not-serving>1min/资金不变量增量/spool 容量熔断+满仓）。P0/P1 清单与阈值单源=`scripts/collab-health-thresholds.mjs`（THRESHOLDS 键=实际注册指标名——`check-collab-health.test.mjs` 机器断言禁手抄）。**首跑（无上次采样）恒 exit 1**（增量类全 insufficient-samples）——装 crontab 后第一个周期属预期，勿当故障；api 进程重启（部署）后同样一轮重基线。
- **心跳自证**：每次运行写 `.data/collab-health-heartbeat.txt`——外层停更 >15min 即 P0 判据（巡检自身/整机 cron 死亡面，脚本无法自证）：

```bash
find /home/ubuntu/flowweb/.data/collab-health-heartbeat.txt -mmin +15 2>/dev/null && echo "collab-health heartbeat 停更>15min——按 P0 处置"
```

- **外部整机可达性探测**（巡检与 api 同机同死——无法自证整机死亡）：第二机 `curl https://www.flow123.com/api/health`（或第三方 uptime 服务）——第二机也哑=整机级事故（云平台/网络层），仅巡检哑=进程级（pm2/cron 面）。
- **SMS**：腾讯云 SDK（`tencentcloud-sdk-nodejs-sms`，脚本经 createRequire 锚 apps/api 解析——独立于 api 部署树）；`ALERT_SMS_TO` 未设→SMS 跳过 exit 不变（最小可用降级）；只发 P0、per-check 节流 15min/条（`.data/collab-health-sms-throttle.json`——新 P0 不被旧 P0 吞）；模板单参短键（`[P0]<check>`），明细看日志。
- **stuck 手工出口行**（`yjs_doc_stuck_total` 增量连续 2 轮=10min 时）：分诊=查库卸载守卫为何不满足（pendingQueues 残留/连接计数非零——pm2 日志 grep `doc_stuck`），**禁用驱逐器掩盖**；出口=POST /api/drain → `pm2 startOrReload ecosystem.config.cjs --update-env` → 观察 `yjs_zero_conn_docs` 回落。
- **SLO 数据侧**（Y0b-5 T2 两条直方图——`collab_telemetry_hydration_ms`/`collab_telemetry_reconnect_ms`，p95=桶累计 0.95 分位）：hydration p95 ≤2s；重连〔事件触发〕p95 ≤2s。
- **1012 部署窗恢复时长 ≤60s**（30s 计划内重启静默窗+1~3s 短退避重连——超 60s 即部署窗异常，查 /api/ready 与 pm2 日志）。

## §7 容量三数初始值

| 指标 | 初始值 | 依据与去向 |
|------|--------|-----------|
| 并发 WS 连接上限 | 50 | Y1c-3 enforcement；现值经 `yjs_connection_count` 观测 |
| 常驻 doc 字节上限 | **D7 未定**（标注 Y1c-3 裁决） | 需先有 loadedDocs 字节口径实测 |
| eventloop lag 阈值 | 200ms | 解冻触发线 ② 的观测侧 |

**指标名（引用既有真名，禁止另造）**：`process_resident_memory_bytes`、`nodejs_eventloop_lag_p99_seconds` 已由 collectDefaultMetrics 默认提供（B21）；本批新增 `yjs_loaded_documents`、`yjs_connection_count`（Y0a-4 T4）。

**`yjs_loaded_documents` 口径（B26）**：= WS 活跃 doc + 在飞直连——REST 直连 disconnect 在 connectionsCount>0 时不卸载、零连接才 unload。因此"常驻 doc 字节上限"只在有 WS 连接时有意义：无连接直连残留会抬高计数，不构成常驻证据。

本批三数只观测不拦截（enforcement 归 Y1c-3）——超线的处置动作是人工评估 + §6 解冻线，不是自动拒绝。

## §8 部署姿态 NODE_ENV

Effective NODE_ENV 以进程 environ 实测为准，不认 .env 之外的任何转述。T0 实测：**production**（server-profile [2]，pid 3968727 environ）。

**J5 两列制记录**（迁移前后各记一次——`--update-env` 用部署会话 env 替换进程 env，迁移会抹除历史手工设置的进程级变量；dotenv 运行期加载 `.env` 为最终生效层）：

| 记录点 | 命令 | 结果 |
|--------|------|------|
| 迁移前（T0 已记） | `sudo cat /proc/$(pm2 pid flowweb-api)/environ \| tr '\0' '\n' \| grep NODE_ENV` | production（server-profile [2]） |
| 首次 startOrReload 后（Y0a-4 T12 已记） | 同上 | production（无变化——会话 env 替换+dotenv 终层合成结果=production） |

若首刷后 effective 值变化（会话 env 替换 + dotenv 终层的合成结果），=本批行为变更，按八读点逐条评估并记录：

| 读点 | production 语义 |
|------|----------------|
| auth.ts:43 | cookie `secure` 标志（HTTPS-only 传输） |
| api-caller:85 | FAKE_AI 防线开关 |
| prometheus-auth:7 | 令牌缺失 fail-closed（403） |
| spool 目录守卫 | Y0a-4 T4 起与 NODE_ENV 解耦——键在 `COLLAB_SPOOL_DIR`（绝对路径+树外断言） |
| admin-guard | dev fail-open / production fail-closed |
| debounce 双档 | dev 1000ms / 其余 2000ms |
| update-profile.dto | 字段校验档位 |
| main.ts | Sentry 环境标注 |

**升 production 的显式动作与八读点全量审计归 Y0.5/E58**——本批只落两列制基线与读点表，不改任何读点代码。

## §9 C0 基线三场景（A2 常驻化验收对照组——2026-10-14 落档）

**环境**：本地 dev（Windows 11；PG/Redis/MinIO 本地进程；api 单进程 127.0.0.1:3000 + WS 3001）；代码=master `6a07c109`（api dist 构建=`9533b306`——其后 commit 不触 api 运行时；C0 观测面完整、A1/A2 行为改造未开始）；`COLLAB_SESSION_IDLE_TTL_MS` 未设（.env 无键+启动 shell 无注入）→ 使用点默认 **120_000ms**（ttlSource=default）；closepage 作业间隔=clamp(TTL/10, 2s, TTL/2)=**12_000ms**（三作业全落 TTL 窗内）。

**装置**：`node apps/api/scripts/collab-soak.mjs --scenario single|closepage|group20 --json <file>`（T0.5；提取器 histPair 含全桶捕获——p50/p99 由窗口桶差计算，count/sum 只支撑 avg）。**分位数口径：p50/p99=窗口桶差累计首达 p×n 的桶上界（与装置 bucketP99 同算法、无插值）**——表内分位值恒为桶界（如 1ms/5ms），非桶内真实时延；A2 对照必须同口径计算，换执行者/换插值口径分位数即漂移。原始 JSON 三份为会话工作产物未入仓——下表数字即 A2 对照全集。

**复测形态**：A2 复测应同形态（本地 dev 单进程）跑，否则时延判据须重基线。

| 场景 | 作业数 | docLoad{direct} | docLoad{ws/reconciler} | store{debounce/soft/disconnect/retry/drain} | store p50/p99 | withdoc 次数 | withdoc p50/p99 | withdocOpen 次数 | withdocOpen p50/p99 |
|------|--------|-----------------|------------------------|---------------------------------------------|---------------|--------------|-----------------|------------------|---------------------|
| ①single 单节点执行链（WS 常驻） | 1 | **0** | 0/0 | +3/0/0/0/0 | 1ms/5ms | 5 | 1ms/5ms | 5 | 1ms/1ms |
| ②closepage 关页作业完成（零连接 REST） | 3 | **11**（≈3.7/作业） | 0/0 | +3/0/0/0/0 | 1ms/1ms | 11 | 5ms/5ms | **11** | 1ms/5ms |
| ③group20 20 节点组执行（WS 常驻） | 20 | **0** | 0/0 | +60/0/0/0/0 | 1ms/5ms | 62 | 1ms/5ms | 62 | 1ms/1ms |

**形态注记（A2 对照读法）**：

- **判据 A 锚（closepage docLoad{direct}）**：零连接下 withdoc=withdocOpen=direct 三者严格相等（11）——每次 withDoc 调用即一次 open=一次 PG 直连装载（调用点级装载，非作业级驻留）；PG 装载延迟量级以 withdocOpen（装载段）为准——p50=1ms、p99=5ms；withdoc 是全路径（open 后含 transact/store 段），其 p50=5ms 为全路径量级，非纯装载段。A2 后同场景应收敛：装载次数骤降（常驻命中）+ withdoc/withdocOpen p99 降至内存量级。closepage 末端 docs gauge=0（零连接卸载生效；①③末端=1 常驻）。
- **常驻对照（①③）**：WS 连接下 docLoad 全 0（装载发生在窗前播种，不入观测窗）、withdocOpen p50/p99=1ms/1ms（表内①③列同值——全落最低桶界，常驻 open 不付装载）；group20 withdoc 62≈3/节点+2 固定、store debounce 60=3/节点（与①单节点 +3 同构——store 计数随节点数线性、不随作业数）。
- store 五 trigger 中 soft/disconnect/retry/drain 三场景全 0（基线窗口内零非常规 store）；store p99≤5ms 为本地 dev 单进程小 doc 量级基线，非服务器容量数（容量三数归 §7）。


## §10 依赖版本契约（Y0c T5/Z123 登记，2026-10-14）

- **@hocuspocus/\* pin 4.6.0 + yjs 13.6.32 不升级**：collab 全部行为结论（库行为锚 A5-A14+Z80 四锚）源码实证绑定 4.6.0 实现细节；`node scripts/check-hocuspocus-pin.mjs` 门禁锁版本（CI test job 常跑），任何漂移（含 ≥4.7.1）必须先重跑脚本输出里的「版本漂移必重跑锚清单」+契约锁全量用例再评估。
- **禁止重新引入 `@hocuspocus/extension-redis`**：上游缺陷已验证——#1167（impact:critical：store 锁失败跳全链）/#1170（OPEN：卸载未存 doc=静默丢数据/装载永久损坏）。Y0a-3 的整删裁定自 Z123 起升级为「已验证的上游 critical 缺陷规避」——任何「加 Redis 缓存提性能」的提案先读这两个 issue。
