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

- deploy.sh cutover ⑤ 自 T31 起为**三步序**（`--only flowweb-api`→ready 绿→`--only flowweb-worker`→`pm2 save`——§3.1）；上方单命令=双 app 一并拉起，仍是**事故手工恢复**的合法形态（顺序正确性由 worker ready 门兜底，见 §3.1）。本文列出是为手工恢复时与脚本语义保持一字不差。
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

### §1.1 systemd 托管 unit（flowweb-pm2.service——Y0c T31/Z115 P3+Z85）

**形态唯一源=`deploy/flowweb-pm2.service`**（本节不复刻全文）：`pm2-runtime` 前台托管（`Type=simple`——无 PIDFile/forking 形态，日志直进 journal：`journalctl -u flowweb-pm2 -f`）+`User=ubuntu`+`Environment=PM2_HOME=/home/ubuntu/.pm2` 显式对齐**防第二 god**（root 的 pm2 daemon 与 ubuntu 的互不可见——systemctl/pm2 操作落空面）+`MemoryMax=1150M`+`MemorySwapMax=128M`+`Restart=on-failure`+`RestartSec=5`。

**分层防线（Z85 写死——各层各管各的，禁越权调参；关停时间轴层=T31 评审补）**：

| 层 | 机制 | 现值 | 语义 |
|----|------|------|------|
| 第一层 per-process | PM2 `max_memory_restart`（ecosystem） | **1G×2 维持**（T32 实测判据达标但 560/480 下调与 heap 算术冲突无解——§9.2/§0.6 偏离 50；重设计归 Y7） | 单进程超限→pm2 只重启该 app（另一进程无感） |
| 机器兜底 | cgroup `MemoryMax`（本 unit） | 1150M（算式=560+480+god 40.4+余量 70） | 双进程+god 总量超限→内核杀 RSS 最大者（=泄漏者），pm2 autorestart 拉起=**设计行为**非事故 |
| unit 级故障 | systemd `Restart=on-failure` | RestartSec=5 | god 崩溃（pm2 autorestart 管不了自己）→systemd 拉起整 unit |
| 关停时间轴层（T31 评审补） | systemd `TimeoutStopSec`（本 unit） | 150s | `systemctl stop`/服务器重启→罩 worker `kill_timeout=120s` 排空（ffmpeg/4K 上界，Z10）+余量——防 systemd 缺省 DefaultTimeoutStopSec=90s 在排空完成前 SIGKILL 腰斩 |

`MemorySwapMax=128M`：宁被杀不换页——换页拖垮协居 PG/Redis/MinIO（1.9GB 机 swap 增长=内存画像恶化先行指标，§6③）。**双 unit（api/worker 各自 cgroup）=可选探针登记（Z85），未采用**——单 unit 兜底+pm2 第一层的分工已覆盖设计动机。

**Z10 worker nice:10 CPU 优先收益运行面未兑现（§0.6 偏离 45），处置=降口径登记（T32）**：pm2 7.0.3 不应用 ecosystem `nice` 字段（unit 拉起后 worker NI 实测=0）；ecosystem `nice:10`+check-ecosystem 断言**保留为结构意图**（pm2 升级/替代后自动兑现，禁删）；unit 级 CPUWeight/Nice 与双 unit 均不采（unit 级会连 api 一起降优先级/双 unit +40MB god 开销）；Y7 pm2 替代评估面携带（与方案 B 同窗）。

**方案 B（删 PM2，systemd 模板单元直管双进程）登记 Y7 评估（Z115）**——pm2-runtime 是过渡托管层非终态。

**安装步骤（一次性手动——deploy.sh 不自动化 systemctl，RB5：一次性 sudo 高危操作简洁优先；2026-10-16 T31 演练实录修订版）**：

```bash
# ⓪ 预检：现有 pm2 开机机制与 pm2-runtime 路径（防第二 god；结果留部署记录）
systemctl list-unit-files | grep -i pm2      # 勘察形态：pm2-ubuntu.service（pm2 startup 产物）
systemctl is-active pm2-ubuntu               # ★可能 inactive 而 daemon 仍活（孤儿态——见②陷阱）
which pm2-runtime                            # 期望 /usr/bin/pm2-runtime（不同则同批改 unit ExecStart）
# ① 上传 unit 文件（不在 deploy 上传面——手动 scp；服务器 deploy/ 可能不存在，先建）
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 'mkdir -p ~/flowweb/deploy'
scp -i ~/.ssh/flowweb_server deploy/flowweb-pm2.service ubuntu@101.42.94.107:/home/ubuntu/flowweb/deploy/
#    LF 校验=0（.gitattributes *.service eol=lf 钉死——CRLF 上服务器 systemd 解析值带 \r 即无效）
# ② 停+禁旧开机机制。★孤儿 daemon 陷阱（T31 实录）：pm2-ubuntu 在 systemd 视角可能已 inactive
#    而 God Daemon 脱离 unit 独活（本机实测 Jul 11 起）——stop 不触发 ExecStop=pm2 kill ⇒ daemon 残留。
#    此时直接 start 新 unit，pm2-runtime 以 client 身份附着既有 daemon ⇒ apps 落 unit cgroup 之外
#    ⇒ MemoryMax 兜底失效（第二 god 变体，Z115 防范对象的实弹形态）。必须显式清场并确认死透：
sudo systemctl disable --now pm2-ubuntu
sudo systemctl stop flowweb-pm2 2>/dev/null || true   # 若已误 start（附着态）先停 client
pm2 kill                                              # SIGTERM apps（api 走关停链）+daemon 退出
pgrep -f "God Daemon" && echo "daemon 残留——sudo kill <pid> 后复核" || echo "daemon 已亡"
ls ~/.pm2/pm2.pid ~/.pm2/rpc.sock 2>/dev/null && echo "残留 sock/pid——复核" || echo "pm2 home 已清"
# ③ 安装+启用新 unit（无既有 daemon 时 pm2-runtime 自 spawn——apps=runtime 直子进程，全落 unit cgroup）
sudo cp /home/ubuntu/flowweb/deploy/flowweb-pm2.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now flowweb-pm2
# ④ 验证：双 app 拉起+ready 绿+★cgroup 包含性（MemoryMax 生效前提——②陷阱的直接判据）
systemctl status flowweb-pm2 --no-pager      # Tasks 含 main.js+main-worker.js；Memory=双 app 实量
pm2 ls                                       # flowweb-api+flowweb-worker 双 online
ps -o pid,ppid,cmd -p $(pm2 pid flowweb-api) $(pm2 pid flowweb-worker)   # ppid=unit Main PID
cat /proc/$(pm2 pid flowweb-api)/cgroup      # 期望 0::/system.slice/flowweb-pm2.service
curl -s http://127.0.0.1:3000/api/ready | grep '"ready":true'
systemctl show flowweb-pm2 -p MemoryMax -p MemorySwapMax   # 期望 1205862400/134217728（=1150M/128M）
pm2 jlist | node -e "JSON.parse(require('fs').readFileSync(0,'utf8')).forEach(a=>console.log(a.name,a.pm2_env.pm_cwd,a.pm2_env.COLLAB_ROLE))"
#    期望双 app pm_cwd=/home/ubuntu/flowweb+role 各自正确（全新条目从 ecosystem 建；遗留条目
#    cwd 不随 startOrReload 更新——§0.6 偏离 45 的 ⑥.b cwd 断言捕获面）
# ⑤ 日志面（journal 直收——pm2-logrotate 只管 pm2 文件日志，journal 面由 journald 自轮转）
journalctl -u flowweb-pm2 -n 50 --no-pager
```

**回退路径（unit 安装后双 app 拉不起且原因不明——按序执行勿反复试）**：`sudo systemctl stop flowweb-pm2 && sudo systemctl disable flowweb-pm2` → 恢复旧机制 `sudo systemctl enable --now pm2-ubuntu`（或直接 `pm2 resurrect` 恢复保存的 app 表）→ 报告。

**P10 探针结论（Z102③——`--only` 与 ecosystem per-app env 块注入组合语义，部署演练实证）＝采用（三步序成立，2026-10-16）**。判据三全过：①api 3000 `/metrics` `collab_role_info{role="api"} 1` ②worker 3002 `collab_role_info{role="worker"} 1`（带 token；无 token 3000/3002 双 403=production fail-closed 姿态实证）③`pm2 jlist` 两 app `COLLAB_ROLE` 各自正确+进程 environ 实测 `COLLAB_ROLE=api`/`=worker`。终轮部署（三步序全程）后复核仍全绿。伴生实证：`--update-env` 对既有 app 条目历史 env 键为 merge 语义（api 遗留 NODE_ENV=production 历经多次部署保持）；**新建条目无历史 env**——生效层完全依赖 dotenv `.env`（§8）。

**部署演练记录（T31 零 503 四判据，RB7）＝PASS（2026-10-16，终轮代际 d073d2da，unit 托管下全链 DEPLOY_EXIT=0）**。三轮全貌：首轮 fe8b95be 全链至 ⑥.b 被 cwd 断言拦（**断言价值实证**——捕获 pm2 遗留条目 cwd 不随 startOrReload 更新的失配态，§0.6 偏离 45）→unit 切换全新建条目归一；unit 切换后巡检 P0 暴露 worker 连接命名分裂（§0.6 偏离 46 根修 prefix:'bull'）；终轮 d073d2da 全绿。

| 判据 | 结果（终轮 d073d2da） |
|------|------|
| ① ready 绿 | ⑤三步序内 api ready 4s 绿→worker 起；⑥ ready barrier 1s；guard post verdict=pass epoch 递增 |
| ② 双冒烟 | collab-smoke OK（WS→auth→load→双端写→广播互见→store→PG→重放）+exec-smoke OK（ledgerRows=4，哨兵→ECONNREFUSED 零扣费→stub200 settle 全链→stub5xx 退款归零→清理残留 0＝worker 消费端到端无 503 烧 attempts） |
| ③ failed 零新增 | 三付费队列 ZCARD 前后=execution 0→0 / ai-image-edit 1→1（历史存量）/ ai-result-download 0→0 |
| ④ 日志噪声 | WORKER_ABSENT=0、503 零命中（pm2 日志+journal） |

同窗实测：⑥.b 双进程端口归属+cwd 一致断言 OK（3000/3001→api ∧ 3002→worker ∧ worker 名下无 3000/3001 ∧ 双 cwd=/home/ubuntu/flowweb）；unit cgroup 包含性=apps 为 pm2-runtime 直子进程（Memory max 1.1G/swap 128M 罩双 app）；命名修复服务器复验=Redis CLIENT LIST **17/17 `bull:` 零 `undefined:`**+巡检 check-collab-health **exit 0**（registered≥1 转绿）；双 app 无 token /metrics 403/403（production 姿态）；内存水位演练窗 available≈977MB。

## §2 连接池量纲

连接池上限按"每进程 PrismaClient 客户端数 × connection_limit"显式预算，总额不得超过 `max_connections` 减协作头寸。

- **量纲算式（T32 双进程实测口径）**：`(api 客户端数 3×8) + (worker 客户端数 2×4) + 协作头寸 ≤ max_connections 100` ⇒ 32+头寸≤100。实例数=1（E35）。plan 字面 `(8+4)` 系每进程单池假设、与 E46 三客户端现状不符——以实测客户端数口径勘正（§0.6 偏离 47）。
- **connection_limit = 显式设置（Y0c T32/Z11——显式预算替代继承默认 CPU×2+1=5）**：env.ts 单源 role 重写 `applyDatabaseUrlConnectionLimit`（api=8/worker=4/all=8——all 从 api 预算=降级瞬态；`DB_CONNECTION_LIMIT` 常量表单源），调用位=main.ts/main-worker.ts 引导层 dotenv 后**立即**（必须先于一切 PrismaClient 构造——authPrisma 在 auth/auth.ts:12 模块顶层自建随 app.module import 即构造；§0.6 偏离 47 时序实证）。URL 对象幂等替换既有 connection_limit 参数、其余参数保留；zod schema 零改动。
- **客户端数实测（T32 静态枚举生产面）**：**api=3**——PrismaService（DI 主客户端）+ authPrisma（betterAuth 模块顶层自建）+ preload 临时客户端（其 catch 已收口 disconnect，B30——按短时峰值计）；**worker=2**——PrismaService + authPrisma（worker.module→payment.gateway→auth.ts import 闭包实证；构造在位、消费面基本不用）+ 无 preload（main-worker 无 preloadDbConfig）。
- **协作头寸**：管理/迁移/备份连接（psql/pg_dump/prisma migrate deploy）+PG superuser 预留（默认 3）——预算按 ≤10 计。**实测对账（T32 观测面非门禁）**：`pg_stat_activity` usename=flowweb 计数（idle+active）——Prisma 池懒建，idle 数<上限是正常态（limit=上限非预分配）；实测值落 §9.2。
- **max_connections = 100**（server-profile [F4]）；flowweb 库现用连接 5（[F8]，T32 前旧值），余量充足。
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

**cutover ⑤ 三步序（Y0c T31/Z9②）**：`pm2 startOrReload ecosystem.config.cjs --only flowweb-api --update-env` → ready 短轮询绿（wait_api_ready，60s 上限）→ `--only flowweb-worker --update-env` → `pm2 save`。动机：worker 早于 api ready 时消费队列会撞 503 烧 attempts（付费队列 attempts:1=一次撞墙即用户作业失败）。**顺序是部署 UX，不是正确性承担者**——正确性兜底=worker ready 门（T26：main-worker 轮询 `/api/ready` 上限 60s 超限 exit(1) 交 pm2 autorestart，零成本退路，Z102①）。rollback 同法三步序（回滚窗不例外）。`--only` 与 per-app env 块注入的组合语义经 P10 探针部署演练实证（结论=§1.1）。⑥ post 段另有**双进程端口归属断言**（RB2/Z9③：`ss -tlnp` 判 3000/3001 listener=api 进程 ∧ 3002=worker 进程 ∧ worker 名下无 3000/3001——Z98 worker 零 HTTP/WS 面的运行态操作化）+两 app `/proc/<pid>/cwd` 一致断言（双进程同部署树）。

**⑤ 中断态如实描述（T31 评审补）**：wait_api_ready 60s 超时 ⇒ exit 1（trap SWITCHED=1 分支）时的真实状态=api dist 已切新代码（④ 已完成），而**旧 worker 进程仍持内存旧模块在消费队列**——Node 已加载代码不受 dist 切换影响，⑤ 的 worker startOrReload 未执行到。该 api 新/worker 旧**混跑窗无限期持续到人工干预**（无看门狗）；迁移 additive 锚只覆盖 DB 面，**不覆盖队列 payload 契约面**（新 api enqueue × 旧 worker consume——payload 契约不兼容时静默错处理）。处置=评估兼容性后速即 `./deploy.sh api --rollback` 或修复后重新部署，**勿过夜**。

**pre-cutover quiesce（Z114③）＝可选未采用（T31/RB4 评估结论）**：cutover ① guard 已承担「drain（POST /api/drain）+20s 续期+own 四零核验后才进重启」——「等 drain 完成再 SIGTERM」语义已在链上，独立 quiesce 步只剩缩短关停时间轴的一行脚本空间。**采用条件**＝部署窗实测关停超预算（api kill_timeout 45s 面撞线/`shutdown_undrained` 出现）时再落。

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

### 3.8 T36 网络面核验记录（2026-10-16 落档——XFF/req.ip 单源+API_BIND_ADDR 绑定面+nginx .bak 处置；§0.6 偏离 57）

**代际**：`1daca1a2`（dist/build-info.json `{"git":"1daca1a2","builtAt":"2026-10-16T13:54:07Z"}`）；`./deploy.sh api` 全链 DEPLOY_EXIT=0（⑤ api ready 9s→worker 三步序 / ⑥.b 归属断言 3000/3001→api ∧ 3002→worker ∧ cwd 一致 / guard post pass epoch 12→13 / collab-smoke+exec-smoke 双 OK）。

**① 绑定面实证（Z14①）**：服务器 `ss -tlnp` = `127.0.0.1:3000`（api pid 名下）——非 `0.0.0.0`；3001/3002 同 127.0.0.1。3000 不公网监听，唯一路径=nginx 同机反代。巡检 `check-collab-health.mjs` exit 0；pm2 双 app online、restarts 3→4 与本次部署对应。

**② nginx /api location 原文摘录**（2026-10-16 现网复核，`/etc/nginx/sites-enabled/flowweb`）：

```nginx
location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        # Y0b-2 T8 Z90 api 墙钟钉仓：1860s=EXEC_SYNC_HARD_CAP(1800s)+60s 核销余量（deploy/nginx/api-location.replace.conf 同值，改 EXEC_* 必须同批重算）
        proxy_read_timeout 1860s;
        proxy_send_timeout 1860s;
    }
```

头部三行语义（req.ip 单源链的 nginx 侧半边）：

- `X-Forwarded-For $proxy_add_x_forwarded_for` = **追加**语义——客户端伪造值居链首，真源（$remote_addr）追加在后；
- `X-Real-IP $remote_addr` = **替换**语义——nginx 无条件以直连对端真源覆写；
- api 侧 `trust proxy 'loopback'`（main.ts）= 只信 loopback 直连对端（nginx 同机），XFF **右起取首个非 loopback=真源**——链首伪造被结构性忽略（语义锚=xff-trust-proxy.spec）。

**仓内无 /api 完整模板**——`deploy/nginx/api-location.replace.conf` 仅为 timeout 两条指令的并入清单（其头注自证"不是完整 location block"）；头部配置唯一权威载体=服务器站点文件（运维面），**改配必须回写本节摘录**。

**③ RN5 四点探测数据**（端点=video-work recordView `POST /api/video-works/:id/view`，应用层限流 30/60s/IP、无鉴权；nginx 无 limit_req/limit_conn——429 只可能来自应用层；N=35/arm；操作化依据=§0.6 偏离 57）：

| 臂 | 入口 | 附加头 | 期望 | 实测 |
|---|---|---|---|---|
| a1 对照 | `http://127.0.0.1:3000` | 无 | 恒不限（127.0.0.1∈白名单） | non429=35 / 429=0 |
| a2 | `http://127.0.0.1:3000` | `X-Forwarded-For: 1.2.3.4` | 被限 | first429_at=31 / 429=5 |
| b | `https://www.flow123.com` | 无 | 被限（真源 IP 键控） | first429_at=31 / 429=5 |
| c | `https://www.flow123.com` | `X-Forwarded-For: 127.0.0.1`（伪造） | 仍被限 | first429_at=31 / 429=5 |

原始响应：非限=201 `{"code":0,"data":{"counted":false},"message":"ok"}`；限=429 `{"code":-1,"data":null,"message":"ThrottlerException: Too Many Requests"}`。判读：a1/a2 行为差=「req.ip 非恒 127.0.0.1」实证；b=真源键控非恒豁免（E58③ 假绿排除）；c 全新计数至 31 才限=b 桶键 60s TTL 自过期（零残留）+链首伪造被忽略。探测脚本一次性（服务器 /tmp 跑毕即删）；已知副作用=样品 work（gate-video-1）viewCount +1（a1 首次 counted:true，1h NX 去重窗内其余 counted:false）。

**④ RN6 nginx .bak 处置**：`sites-enabled/flowweb.bak-1791457973`（历史残留——含第二份被加载的 `location /api/`）：备份 `~/backups/flowweb.bak-1791457973`（1774B）→ 删除 → `nginx -t` 通过 → `systemctl reload nginx` → 复验 https=200/http=301、`location /api/` 2→**1**、server_name 实指令 4→**2**（`grep -c server_name` 6→4——差 2 行为 nginx.conf 自带注释行，非指令）、无 conflicting server name 告警。


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
# ④ 开机自启核验（T31 起=flowweb-pm2 unit §1.1——pm2-runtime 从 ecosystem 声明式拉起双 app，不依赖 dump；
#    旧 pm2-ubuntu 已 disable——T31 前形态为 systemctl is-enabled pm2-ubuntu）
systemctl is-enabled flowweb-pm2
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
| T31 unit 切换后（2026-10-16 实测） | 同上（environ 无 NODE_ENV 行）+无 token `curl 3000/3002 /metrics` | **production**（生效层换轨：pm2 app 条目全新建 ⇒ pm2_env/environ 均无 NODE_ENV ⇒ dotenv `.env` 成为生效层——`.env` 同窗根修 development→production〔§0.6 偏离 44，改前 environ 载体=pm2 遗留 app env 历史键〕；双端点无 token 403/403=production fail-closed 姿态实证） |

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

### §9.1 A2 常驻化实测对照（T22 出口轮——2026-10-15 落档）

**环境**：与 §9 同形态（本地 dev 单进程、TTL 未设→default 120_000、closepage 作业间隔 12s）；代码=master `e9c0ef07`（T15-T22 全落地）；装置同款+`--ttl-pin 120000` 受控链；closepage 补 jobs=12 稳态窗（总长 135s 超 TTL——判据 B 长窗分母）。原始 JSON 落 `apps/api/.data/soak-t22/`（会话产物未入仓，下表即对照全集）。

| 场景 | docLoad{direct} | store{debounce} | 会话命中率 | yjs_resident_bytes |
|------|-----------------|-----------------|-----------|--------------------|
| ①single | 0（播种窗前，同基线） | **1**（基线 +3） | — | 188B/1 doc |
| ②closepage j3 | **1**（基线 **11**） | **1**（基线 +3） | 短窗上界 0.667（首装恒占 1/N，N=3 结构不可达） | — |
| ②closepage j12（135s>TTL） | **仍 1**（12s 间隔滑动续期，doc 永不中途卸载） | **1** | **0.917**（1−1/12） | — |
| ③group20 | 0 | **1**（基线 **+60**——组事务单段） | — | — |

**五判据**（spec :530）：A=PASS（load==1 含 12 作业超 TTL 窗；必带 TTL=120_000 default）/B=PASS（0.917≥0.9，j12 窗）/C=PASS（四窗 store 实测 1 远低于 ⌈窗/3s⌉+2 上界；degradedDocs=0）/字节绝对=PASS（188B≪384MiB——本地哨兵 doc 极小，平凡通过；生产分布待服务器轮）/单节点写段+组执行=PASS（1≤2；60→1）。**withDoc 计数塌缩为 0=预期**（REST 主路径迁 withSession——count 塌缩非流量塌缩）。

**完整性巡检首轮（Z111）**：四轮 sampled=1/matched=1/**drifted=0**（PG 行集重放 SV≡内存 SV；liveSource 两档如实：scenario-provider/probe-resync）。

**关停落档**：Windows 无 SIGTERM 通路（kill=TerminateProcess 探针实证）→ drill-server IPC 载体（write-frozen-drill 先例）真实 AppModule 关停：`release-all(shutdown): 1/1 released in 1ms`（Nest 钩子 0/1+步骤 0 显式 1/1 双跑）+`shutdown_drain_complete` pending 全 0+`shutdown_complete elapsedMs=33`（两轮 33/104ms）；零 destroy_timeout/零 resident-session-open hangReason/零 direct leak/双拒绝计数全 0。**drain 两数等价证据**=日志（进程退出后 /metrics 不可直读——无 pushgateway；服务器轮可补 /metrics 直读）。

**三数回填裁决（Z107/Z142/Z114②）**：**三维持**——TTL 120_000（12s 间隔全落窗+超窗滑动续期 load 恒 1，无调整依据）/条目 64（实测 p95 落 64KiB 最低桶但样本=装置哨兵 ≈63B/doc 非生产分布——不足以推翻 384MiB÷300KB≈20 余量的原假设；64=病态护栏语义在，生产 /metrics 攒数后重校）/18s hardDeadline（健康后端轻材料 drain 瞬时 33-104ms 远未触达；「数十秒级」重材料形态〔多 doc 脏批+fsync 慢〕本地未构造——服务器轮补强前不下调）。

**装置局限登记**：①Windows 信号通路=drill IPC 替代（服务器轮 SIGTERM 直测）②drain gauge 进程退出后不可直读（等价证据=日志；服务器轮 pushgateway/终态前抓取可补）③withSession 无独立 open 计数序列（spec :625 规划未落——判据 B 分母用装置作业数，后续批可补 yjs_write_session_open_total）④重材料 drain 形态待服务器轮。

### §9.2 D 轮双进程服务器实测（T32 出口轮——2026-10-16 落档）

**环境**：服务器双进程（unit 托管 flowweb-pm2.service，MemoryMax=1150M 生效；代际 `3238c34b`——connection_limit 显式预算生效轮，dist 探针四档 api⇒8/worker⇒4/all⇒8/未设⇒8 实证）；2 核/1967MB；TTL=120_000（default，--ttl-pin 受控通过）；soak 双端点（`--worker-metrics-url http://127.0.0.1:3002`，x-prometheus-token 同源）。原始 JSON 落 `apps/api/.data/soak-t32/`（会话产物不入仓——下表即判定全集，§9.1 同款惯例）。

**装置能力贴档（元纪律⑤/RC2①）**：扩展前现装置服务器实跑一轮（scenario single——EXIT=0/integrityProbe MATCH 1/1/双端点 rss 237.7(api)/210.0(worker 树)MB）；closepage 逐作业采样扩展（§0.6 偏离 48）后预检（closepage j1——samples=3 含 worker 嵌套/EXIT=0）。起跑门：available 966MB ≥300MB（两轮全程 953-966MB 稳定）。

**两轮形态**：①`--scenario closepage --jobs 8`（逐作业采样 n=10，窗 90s，gap=12s——执行链真实作业负载：api enqueue→worker 消费→HTTP 写端点回写；integrityProbe MATCH）②缺省编辑压测 `--docs 2 --clients 2 --rate 1000 --duration 5`（30s 序列 n=12——WS 双客户端编辑稳态；edits=598/connErrors=0/storeP99=100ms 无拐点）。

**p95 口径（Z117②——查询侧离线求，装置只压不统计）**：`sorted[floor(0.95×(n−1))]`（无插值——装置 frameP99 同索引形态；小样本下 p95≈保守上界如实声明）；api 序列=`process_resident_memory_bytes{role="api"}`，worker 序列=`process_tree_rss_bytes{role="worker"}`（进程树合计——Z91①）。

| 轮 | n | p95(api) | p95(worker 树) | max(api/wkr) | 备注 |
|----|---|----------|----------------|--------------|------|
| ①closepage j8 | 10 | 226.6MB | 195.9MB | 226.6/196.2MB | api 序列 220.5→226.6 单调缓升（作业负载） |
| ②编辑 2×2×5min | 12 | 230.5MB | 197.5MB | 230.5/197.5MB | api 序列 228.4→230.5 平稳 |
| **合并保守（判定采用）** | 22 | **230.5MB** | **197.4MB** | 230.5/197.5MB | 两轮池化后取分位=口径最保守 |

**协居实测（Z68① 第三项）=477.4MB**：minio 243.6 + postgres 11 进程合计 137.9 + redis-server 18.6 + **pm2-runtime 77.3**（unit 前台形态 god 实测——Z85 算式用 40.4 系旧 daemon 形态值，差 36.9MB 由余量 70 项吸收；§0.6 偏离 50 伴生登记）。口径声明三点：①server-profile [F1] 同法（ps RSS 按进程族求和）但**不含 flowweb-api/worker node**（两者各为判据独立 p95 项——profile 514.6 旧值含当时 api 138.8MB，故两值口径不同不可直接相减）②soak 装置客户端=瞬态 harness（跑窗内 node 进程），**不计入判据项**——窗内 available 953-966MB 实证余量充足③非协居常驻（YDService 70.9/journald 42.6/fwupd 28.8/multipathd 26.7≈169MB）沿 profile 先例不入算式，由「系统保留 300」项覆盖。

**稳态预算判据（Z68①——显式结论）**：

> `p95(api) 230.5 + p95(worker 树) 197.4 + 协居 477.4 + 300 = 1205.3 ≤ 1967` ⇒ **达标**（余量 761.7MB）。三口径同判：closepage 轮 1199.9 / soak 轮 1205.5 / 合并 1205.3——全达标，降级出口不触发（COLLAB_ROLE=all 单进程预案维持登记不启用）。

**ffmpeg 口径处理（RC2⑥=保留登记+standalone 附注两形态都落）**：soak 不驱动媒体作业（scenario=stub 文本节点零媒体外呼）⇒ **worker 树 p95 不含 ffmpeg 子进程峰值——判据结论带此保留**。附注数字（服务器 /usr/bin/ffmpeg 6.1.1，libx264 preset medium，lavfi testsrc2 合成源，`/usr/bin/time -v` Maximum resident set size）：1080p 10s ⇒ 峰值 RSS **479MB**（墙钟 13.0s）；4K 5s ⇒ 峰值 RSS **1411MB**（墙钟 45.7s）。风险登记：4K x264 单 ffmpeg 子进程峰值 > mmr 1G ⇒ 真实 4K 媒体作业形态下 worker 进程树将由第一层 mmr 兜底重启（stalled 重投+api 最终一致链承接，Z85/Z41 语义）；**现无流量面**——服务器 .env FFMPEG_PATH/FFPROBE_PATH 为 Windows 路径残留（§0.6 偏离 44），媒体面不可用属既有登记不修项；媒体 preset/分辨率治理归 Y7 媒体面复活评估携带。

**校准决策（RC3/Z84③——§0.6 偏离 50）**：判据达标且余量 762MB **内存面支持下调**，但 §5.1 设计值 560/480 与 check-ecosystem 既有算术**冲突无解**（api：Z126③ 下限 TRIP≥549,841,792 > 560M 制式 Z118 上限 377,487,360；worker：基线×4=555,200,000 < RELEASE < TRIP ≤ 293,601,280——全算式见偏离 50）⇒ **维持 old-space 512/mmr 1G×2**（现制式算术自洽 750MiB+200MiB≤1G）；ecosystem/heap-pressure/check-ecosystem/unit 四处〔待实测校准→T32〕注兑现为实测结论注（数值零变更，同 commit）。560/480 数字重设计（resident_cap 384MiB 下调 ∨ 基线×4 规则重构=spec 级数字面）=**停下问项呈报**（归控制方裁决/Y7），不擅改。**MemoryMax=1150M 张力说明**：维持 1G 制式下单进程趋近 mmr 时 unit 内合计（1G+对侧~200MB+pm2-runtime 77.3MB≈1.3G）**cgroup 1150M 先于 pm2 mmr 触发=机器兜底语义**（Z85 分层分工：mmr 管单进程泄漏快重启/MemoryMax 管机器不炸——触发顺序倒挂不破坏防线；「1150=560+480+40.4+70」闭合算式在 1G 制式下发散，数值闭合归 560/480 重设计同批）。

**T31 基线留档（RC4③——「↺ 计数无部署对应增长」判据基线）**：T32 部署前 pm2 restarts **api=2/worker=2**（uptime since 03:19:35Z/03:19:40Z=d073d2da 终轮）+available 945MB；T32 部署（3238c34b，06:41Z）后 restarts **3/3**——增量与部署一一对应，零异常重启。unit 同窗同步（RC4①）：/etc/systemd/system/flowweb-pm2.service 补 TimeoutStopSec=150（原文备份 `~/flowweb-pm2.service.bak-t32-20261016131724`；scp+sudo cp+daemon-reload 不重启服务；`systemctl show -p TimeoutStopUSec`=**2min 30s** 生效实证）。

**pg_stat_activity 观测（RC5——观测面非门禁）**：部署后稳态 `usename=flowweb` 共 **4 条（全 idle）** ≪ 预算上限 `(3×8)+(2×4)=32`——Prisma 池懒建口径（idle<上限=正常态；connection_limit=上限非预分配）。max_connections=100 实证不变（§2 算式余量充足）。

**T33 D 出口复核轮（2026-10-16，同代际无新部署——本节数字即 RC⑤「deploy 复验五数字」T33 新档）**：①代际=build-info `{"git":"3238c34b","builtAt":"2026-10-16T06:40:46Z"}`，pm2 双 app online/restarts **3/3**（与 T32 基线一致=零新增重启）/uptime 06:41Z（unit cgroup 托管不变）②gate=本地 gate-collab 23 项绿（T33 轮，MinIO 本地拉起后首试即过——首跑红系本地 MinIO 未起 ECONNREFUSED 9000 环境项非代码项）③ready epoch=**12**（holder 在位+holderRenewedAgoMs 2.9s+workers 维度 registered=1×三队列 execution/ai-result-download/ai-image-edit 全 waiting=0——token 授权档实读）④双冒烟=collab-smoke **exit 0**（WS→auth→load→双端写→广播互见→store→PG→重放链 OK）+exec-smoke **exit 0**（哨兵零可见→环1 ECONNREFUSED 零扣费→环2a settle 全链→环2b 退款归零→负例零 intent→清理 0，ledgerRows=4）⑤巡检=`node scripts/check-collab-health.mjs` 服务器本地 **exit 0**（workers 维度+3002+Z148④ 全链真实双进程绿）。旁证：free -m available **1066MB**（判据余量口径同 §9.2 上表）+pg_stat_activity flowweb **idle=4**（≪32 懒建口径不变）。DEPLOY_EXIT=N/A（T33 零部署——测试/文档面 commit，代际复核数字①承担部署态验证）。


## §10 依赖版本契约（Y0c T5/Z123 登记，2026-10-14）

- **@hocuspocus/\* pin 4.6.0 + yjs 13.6.32 不升级**：collab 全部行为结论（库行为锚 A5-A14+Z80 四锚）源码实证绑定 4.6.0 实现细节；`node scripts/check-hocuspocus-pin.mjs` 门禁锁版本（CI test job 常跑），任何漂移（含 ≥4.7.1）必须先重跑脚本输出里的「版本漂移必重跑锚清单」+契约锁全量用例再评估。
- **禁止重新引入 `@hocuspocus/extension-redis`**：上游缺陷已验证——#1167（impact:critical：store 锁失败跳全链）/#1170（OPEN：卸载未存 doc=静默丢数据/装载永久损坏）。Y0a-3 的整删裁定自 Z123 起升级为「已验证的上游 critical 缺陷规避」——任何「加 Redis 缓存提性能」的提案先读这两个 issue。


## §11 worker 指标面与存活侦测（Y0c T29-II/Z130/Z134/Z148⑤）

**无 Prometheus server 是有意取舍（Z134）**：api `/metrics`（3000，PROMETHEUS_TOKEN）与 worker 3002 两个指标端点都只被 `check-collab-health.mjs`（§6 crontab */5）消费——「巡检即采集面」。无时序库、无面板属现状一致性，不是欠账遗漏；阈值/分位数判定全部在巡检脚本与查询侧。

**升级路径=加 scrape job 打 loopback，禁进 nginx**：将来引入 Prometheus server 时，scrape targets 直接打 `127.0.0.1:3000/metrics` 与 `127.0.0.1:3002/metrics`（server 本机 agent 或同机部署）。**禁止为外部监控在 nginx 加 /metrics location**（Z130③——3002 loopback-only 是契约：重新引入暴露面=把 token 防线推到公网边界）。

**health 巡检必须服务器本地 crontab**：3002 绑 127.0.0.1，任何非本机执行者都不可达（P0 worker-metrics-unreachable 恒真）。§6 crontab 行即唯一合法载体。降级出口：`COLLAB_HEALTH_SKIP_WORKER=1` 跳过全部 worker 端点检查——仅供 `COLLAB_ROLE=all` 单进程降级档（无独立 worker 进程，3002 无监听属预期）使用；双进程正常档禁设（设了=worker 死亡侦测整面失明）。worker URL 可经 `COLLAB_HEALTH_WORKER_URL` 覆写（缺省 `http://127.0.0.1:3002`；端口漂移时与 `WORKER_METRICS_PORT` 同步改）。

**role 标签变更记录+查询侧适配**：T0（api）/T26（worker）起全部指标族样本带 `role` 默认标签（引导层 `setDefaultLabels` 单点，Z138）——**这是序列身份变化**：同名指标旧序列（无 role）与新序列（role="api"/"worker"）在时序库视角是两条线。查询侧适配清单一行：所有既有查询/告警表达式按指标名裸匹配处补 `{role="api"}` 选择器（双进程同机时防跨进程族混算）。**升级路径按 pull 设计**：push 形态（remote_write/OTLP exporter）会把 role 标签写进时序库固化成永久序列维度——pull+scrape job 形态下 relabel 可随时改写，两者需求不同，禁按 push 思路预配（Z148⑤）。

**p95 查询句（Z117②——分位数由查询侧承担，巡检只判存在+瞬时阈值）**：

```promql
# api 进程内存 p95（5 分钟窗）
quantile_over_time(0.95, process_resident_memory_bytes{role="api"}[5m])
# worker 进程树内存 p95（5 分钟窗——T29 process_tree_rss_bytes 口径）
quantile_over_time(0.95, process_tree_rss_bytes{role="worker"}[5m])
```

**内存判定时点（Z91③）**：A2 出口后一次——已落 §9.1（三数回填裁决）；D 出口前一次——**已落 §9.2（T32 双进程服务器轮实测，2026-10-16：判据达标 1205.3≤1967；worker 480M 口径校准=维持 1G，下调算术冲突登记 §0.6 偏离 50）**。

**registered 活性语义（裁决②/偏离 39）**：ready workers 维度与 enqueue fail-closed 门共用 `queue.getWorkers()`（bullmq 5.75.1=Redis CLIENT LIST 形态）——**无 lastSeen 数据源，registered 即活性信号**：worker 进程死 ⇒ TCP 断 ⇒ CLIENT LIST 立即除名（秒级），registered=0 就是死亡判定，无需陈旧度维度。5s TTL 缓存窗（付费路径零额外 RTT）= 最坏 5s 内漏拒，属可接受窗（留队作业待 worker 恢复即被消费）。

**双端点交集实测（T33 偏离 37 回填——Z138 B 内容断言的真实端点形态，2026-10-16 服务器代际 3238c34b）**：采集=`curl -s -H "x-prometheus-token: $PROMETHEUS_TOKEN" http://127.0.0.1:3000/metrics`（api 1191 行）与同 token `http://127.0.0.1:3002/metrics`（worker 970 行）两文本；分析=一次性 node 脚本（服务器 tmp 目录 t33-role-intersect.mjs，不入仓——全文如下，解析族名→role 值集合+断言三件）：

```js
// 用法: node t33-role-intersect.mjs <api.txt> <worker.txt>；exit=断言结果
import { readFileSync } from 'node:fs';
const [apiFile, workerFile] = process.argv.slice(2);
function parse(text) {   // prom 文本 → Map<族名, Set<role>>（#行跳过；无 role 记 '(none)'）
  const families = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const brace = line.indexOf('{');
    const name = (brace === -1 ? line.slice(0, line.indexOf(' ')) : line.slice(0, brace)).trim();
    if (!name) continue;
    let role = '(none)';
    if (brace !== -1) { const m = /role="([^"]*)"/.exec(line.slice(brace)); if (m) role = m[1]; }
    if (!families.has(name)) families.set(name, new Set());
    families.get(name).add(role);
  }
  return families;
}
function familySum(text, family) {   // 族样本值求和（无样本=0）
  let sum = 0, n = 0;
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const brace = line.indexOf('{');
    const name = (brace === -1 ? line.slice(0, line.indexOf(' ')) : line.slice(0, brace)).trim();
    if (name !== family) continue;
    const v = Number((brace === -1 ? line.slice(name.length) : line.slice(line.indexOf('}', brace) + 1)).trim());
    if (Number.isFinite(v)) { sum += v; n += 1; }
  }
  return { sum, n };
}
const api = parse(readFileSync(apiFile, 'utf8')), worker = parse(readFileSync(workerFile, 'utf8'));
const intersection = [...api.keys()].filter((f) => worker.has(f)).sort();
const problems = [];
for (const [f, r] of api) if ([...r].some((x) => x !== 'api')) problems.push(`api 侧族 ${f} role 异常: ${[...r]}`);
for (const [f, r] of worker) if ([...r].some((x) => x !== 'worker')) problems.push(`worker 侧族 ${f} role 异常: ${[...r]}`);
for (const f of intersection) { const a = [...api.get(f)], w = [...worker.get(f)];
  if (a.some((x) => w.includes(x))) problems.push(`交集族 ${f} 两侧 role 相同`); }
const storeSum = familySum(readFileSync(workerFile, 'utf8'), 'yjs_store_total');
if (storeSum.sum !== 0) problems.push(`worker yjs_store_total 和=${storeSum.sum}`);
console.log(JSON.stringify({ apiFamilies: api.size, workerFamilies: worker.size,
  intersectionCount: intersection.length, yjsStoreTotalWorker: storeSum, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
```

输出（PASS，exit 0）：`apiFamilies=193 / workerFamilies=177 / intersectionCount=177`（worker⊆api，workerOnly=0，apiOnly=16=WS/gateway 专属族）；`problems=[]`——交集 177 族每族两侧 role 互异（api 侧全 role="api"∧worker 侧全 role="worker"）；`yjsStoreTotalWorker={sum:0,n:0}`=3002 无 yjs_store_total 样本行（无样本=0 口径，worker 不写 doc）。原始文本关键行摘录：`process_resident_memory_bytes{role="api"} 178278400` / `process_tree_rss_bytes{role="worker"} 140398592` / `nodejs_heap_size_used_bytes{role="api"} 100562904` vs `{role="worker"} 82153736`。结论=Z138 setDefaultLabels 引导层单点在真实双进程下的 B 内容断言成立（T29 进程内仿真〔偏离 37〕与真端点两面齐全，义务闭环）。

---

## §12 Redis 三件配置（Y0c T37/E58②——appendonly everysec+maxmemory 128mb+noeviction；2026-10-16 落地）

**仓内权威副本**=`deploy/redis/server-redis.conf`（服务器 /etc/redis/redis.conf 终态全文照抄+头注块+四条 [T37 旁注]——消灭「生产配置不在仓」）。

**三件终值与依据**（Redis 承载 BullMQ 付费队列+限流桶+会话缓存；服务器 2核/1.9GB）：

| 件 | 终值 | 依据 |
|---|---|---|
| appendonly + appendfsync | yes + everysec | AOF RPO≤1s=运行时持久化面（Y0b-5 RDB 备份=落盘面，两面互补） |
| maxmemory | 128mb | 实测 used_memory 3.11M/峰值 5.68M（2026-10-16，≪100MB 判定阈） |
| maxmemory-policy | noeviction | 队列数据不被逐出的安全底线（满限拒写不逐出） |

**变更流程**（三件任何一件变更必须全走，禁单改一面）：
1. 改仓内模板 `deploy/redis/server-redis.conf`（评审面=PR diff）
2. 服务器备份：`sudo cp /etc/redis/redis.conf ~/backups/redis.conf.bak-<任务>-<ts>`
3. 运行时生效（免重启优先）：`redis-cli CONFIG SET <k> <v>`
4. 持久化：`redis-cli CONFIG REWRITE` + `sudo grep` 文件面复核与运行时一致
5. 断言步骤（下方）重跑
6. 同批回写仓内模板（全文照抄口径）+本节登记变更行

**断言步骤**（触三件/部署验收必跑）：
```bash
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 \
  "redis-cli INFO persistence | grep -E 'aof_enabled|aof_last_write_status|loading'"
# 期望：aof_enabled:1 / aof_last_write_status:ok / loading:0
ssh -i ~/.ssh/flowweb_server ubuntu@101.42.94.107 \
  "redis-cli CONFIG GET appendonly; redis-cli CONFIG GET appendfsync; redis-cli CONFIG GET maxmemory; redis-cli CONFIG GET maxmemory-policy"
# 期望：yes / everysec / 134217728 / noeviction
```

**T37 落地实测**（2026-10-16，Redis 7.0.15，免重启路径，零键丢失）：
- 改前：appendonly no（aof_enabled:0=唯一缺口；conf :1378 与运行时一致为 no）/appendfsync everysec/maxmemory 134217728/noeviction 三件已达标零动作；used_memory 3.11M、db0 355 keys、rdb_last_bgsave_status:ok、uptime 97 天
- 操作：备份 `~/backups/redis.conf.bak-t37-20261016T223647`（改前 md5=a51803903c93b57b9f78a317cb5decb8）→ `CONFIG SET appendonly yes`（7.0 自动建 multipart AOF 基线：appendonlydir/appendonly.aof.1.base.rdb 230857B+incr.aof+manifest；日志「Background AOF rewrite finished successfully」）→ `CONFIG REWRITE`
- 改后：aof_enabled:1/aof_last_write_status:ok/loading:0；db0 358 keys（自然增长无丢失）；conf 终态 md5=a7c8bf56e264563ba2d67736cfcb6431
- CONFIG REWRITE 伴生归一（良性，均为运行时真值回写）：`daemonize no`（unit 命令行 `--daemonize no` 真相固化）/`supervised systemd`/`save 3600 1|300 100|60 10000` 三行显式化（原文件未写=内置默认在跑）/`user default on nopass ~* &* +@all`（ACL 真相；bind 127.0.0.1+protected-mode yes 防线不变）/引号与 `stream-node-max-bytes 4kb` 等价写法
- conf 形态核查：单文件无 include（「仓内全量副本」口径成立）；unit ExecStart=/usr/bin/redis-server /etc/redis/redis.conf --supervised systemd，User=redis
