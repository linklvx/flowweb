# 服务器前置实测档案（M0 扩采 + M1 pm2 基线）— 2026-10

- 采集时间：2026-10-08 11:36 +0800（服务器 date 实测 2026-10-08 11:36:48 +0800，与本地同 TZ）
- 采集基准 commit：`850b35cd`（master）
- 服务器：`ubuntu@101.42.94.107`（hostname VM-8-2-ubuntu，Ubuntu 24.04，Mem 1967MB + swap 1987MB，磁盘 /dev/vda2 50G 已用 9.2G）
- 性质：**只读实测，远端无任何变更**；唯一写操作为本档案 + commit
- 用途：ecosystem.config.cjs 数值定稿（max_memory_restart/old-space）、部署链设计（spool 账本迁移判据）、runbook 数值的实证依据
- **Y0c T39 更新（2026-10-16）**：M0/M1/判读行/附录=2026-10-08 单进程时代历史档案**原样保留不改写**；双进程时代以新增两节为准——「数值推导（双进程时代）」（Z44/Z85 口径+协居重实测回填）与「现状快照（Y0c T31-T38 终态）」（T39 出口 ssh 只读复核现值，代际 `1daca1a2`）。

## M0 六组原始输出（原样，未改写）

### [1] 内存画像

```text
=== [1] 内存画像 ===
               total        used        free      shared  buff/cache   available
Mem:            1967         844         149           6        1171        1122
Swap:           1987         377        1610
224620 minio
16980 postgres
16728 postgres
15800 postgres
15752 postgres
15184 postgres
10800 redis-server
 9320 postgres
 5572 postgres
 3760 postgres
 3224 postgres
 3076 postgres
 2620 postgres
```

注：`ps -C node,...` 在此机未匹配到任何 node 进程（postgres/redis/minio 正常匹配）——该机 procps 的 -C 选择对 node 不可靠；node 进程 RSS 以 F1 按 pid 精选值为准（142120KB）。

### [2] 进程 env 现值（TOKEN/SECRET/KEY 已由远端 sed 脱值；本组仅命中 NODE_ENV，无 token 类键）

```text
=== [2] 进程 env 现值（NODE_ENV/COLLAB_*/MINIO_*/token 存在性——脱值） ===
pid=3968727
NODE_ENV=production
```

### [2b] .env 的 MINIO_USE_SSL/MINIO_ENDPOINT 现值

```text
=== [2b] .env 的 MINIO_USE_SSL/MINIO_ENDPOINT 现值 ===
MINIO_ENDPOINT=http://<host>
MINIO_USE_SSL=false
```

### [3] pm2 全量+守护+日志+磁盘+swap

```text
=== [3] pm2 全量+守护+日志+磁盘+swap ===
┌────┬────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id │ name           │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
├────┼────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
│ 0  │ flowweb-api    │ default     │ 0.0.1   │ fork    │ 3968727  │ 51D    │ 312  │ online    │ 0%       │ 138.4mb  │ ubuntu   │ disabled │
└────┴────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘
host metrics | cpu: 1.8% | ram usage: 42.1% | lo: ⇓ 0.003mb/s ⇑ 0.003mb/s | eth0: ⇓ 0mb/s ⇑ 0.001mb/s | disk: ⇓ 0.599mb/s ⇑ 0.126mb/s |
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda2        50G  9.2G   38G  20% /
NAME      TYPE SIZE   USED PRIO
/swap.img file 1.9G 377.7M   -2
               total        used        free      shared  buff/cache   available
Mem:            1967         858         108           6        1199        1109
```

注：`pm2 conf pm2-logrotate 2>/dev/null | head -5` 无输出且未触发 `||`（管道退出码为 head 的 0）——存在性悬置由 F2 定论。

### [4] env 文件位置+spool 台账+nginx /collab 现状

```text
=== [4] env 文件位置+spool 台账+nginx /collab 现状 ===
ls: cannot access '/home/ubuntu/flowweb/.env': No such file or directory
-rw-r--r-- 1 ubuntu ubuntu 5670 Aug 17 13:19 /home/ubuntu/flowweb/apps/api/.env
process cwd: /home/ubuntu/flowweb/apps/api
/home/ubuntu/flowweb/.data/collab-spool: 目录不存在
/home/ubuntu/flowweb/apps/api/.data/collab-spool: 目录不存在
服务器 .env 无 export 前缀/行内注释
nginx -T 不可读或无 /collab
```

注：`nginx -T 不可读或无 /collab` 的 `||` 分支系 grep 零匹配触发（sudo 实际可用，见 F3），nginx -T 本身可读。

### [5] HTTPS/外部端口/开机自启/版本

```text
=== [5] HTTPS/外部端口/开机自启/版本 ===
200
LISTEN 0      511                *:3000            *:*    users:(("node /home/ubun",pid=3968727,fd=91))
```

### [6] 守护自启/工具版本/PG 容量/Redis 配置

```text
=== [6] 守护自启/工具版本/PG 容量/Redis 配置 ===
enabled
/usr/bin/pg_dump
pg_dump (PostgreSQL) 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
v20.20.2
9.0.0
/usr/bin/rsync
function
psql: error: connection to server at "localhost" (127.0.0.1), port 5432 failed: FATAL:  database "flowweb" does not exist
maxmemory
134217728
maxmemory-policy
noeviction
appendonly
no
-rw-r--r-- 1 ubuntu ubuntu 5670 Aug 17 13:19 /home/ubuntu/flowweb/apps/api/.env
```

注：①node fetch 检测按预案改用 `node -e "console.log(typeof fetch)"`（原 `\x27` 形态未采用），输出 function 即可用。②psql 直连失败原文如上，DSN 密码未落档；失败根因见 F8（CRLF 行尾污染库名），非 PG 侧故障。

## M1 pm2 jlist 基线（flowweb-api）

```json
{
  "exec_mode": "fork_mode",
  "instances": 1,
  "node_args": [
    "--max-old-space-size=384"
  ],
  "pm_cwd": "/home/ubuntu/flowweb/apps/api",
  "restart_time": 312,
  "unstable_restarts": 0,
  "status": "online"
}
```

注：jlist 中 `kill_timeout` 为 undefined（JSON.stringify 丢弃 undefined 键）——结合 F6（`pm2 env 0` 无 kill_timeout/max_memory_restart 行）定论：两值均未显式配置，kill_timeout 取 pm2 默认 1600ms，max_memory_restart 未启用。

## 补采 F1~F8 原始输出（只读；定论 [3]/[4]/[6] 悬置点）

```text
=== [F1] node 进程 RSS 精确+comm 现象复核+全系统 RSS TOP ===
    PID   RSS COMMAND             ELAPSED
3968727 142120 node /home/ubun 51-21:26:40
    PID   RSS COMMAND         COMMAND
USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
ubuntu     22521  0.0 11.1 1534780 224620 ?      Ssl  Jul11 112:55 /usr/local/bin/minio server /data/minio --console-address :9001
ubuntu   3968727  0.8  7.0 12355564 142120 ?     Ssl  Aug17 608:06 node /home/ubuntu/flowweb/apps/api/dist/main.js
root     1347890  0.7  5.1 1081136 103732 ?       Ssl  Sep03 377:36 /usr/local/qcloud/YunJing/YDEyes/YDService
ubuntu     29474  0.0  2.0 1301180 41364 ?       Ssl  Jul11  49:35 PM2 v7.0.3: God Daemon (/home/ubuntu/.pm2)
root         296  0.0  1.7  83288 34812 ?        S<s  Jul11   5:38 /usr/lib/systemd/systemd-journald
root      376800  0.0  1.5 735432 30256 ?        Ssl  Jul25  4:24 /usr/libexec/fwupd/fwupd
root         346  0.0  1.3 288952 27292 ?        SLsl Jul11   8:14 /sbin/multipathd -d -s
=== [F2] pm2-logrotate 存在性 ===
（ls ~/.pm2/modules/ 无输出且未触发 ||——目录存在且为空 ⇒ 无任何 pm2 模块）
=== [F3] nginx 现状 ===
/usr/sbin/nginx
nginx version: nginx/1.24.0 (Ubuntu)
0
nginx -T 无 /collab block
（sudo grep -rn "collab" /etc/nginx/ 零输出 ⇒ /etc/nginx 无 collab 引用）
=== [F4] PG 数据库清点+集群参数+活动连接 ===
postgres
flowweb
128MB
100
11
=== [F5] 防火墙对 3001 的公网暴露证据 ===
Status: inactive
=== [F6] kill_timeout/max_memory_restart 现值 ===
pm2 env 0 无 kill_timeout/max_memory_restart 输出
=== [F7] .env 键名清点（只列名不取值）+DSN 形态（脱密码） ===
.env 无 COLLAB_ 键
DATABASE_URL="postgresql://<redacted>@localhost:5432/flowweb"
=== [F8] PG 集群同一性+server 版本+flowweb 库活动连接+.env 行尾形态 ===
LISTEN 0      200        127.0.0.1:5432      0.0.0.0:*
Ver Cluster Port Status Owner    Data directory              Log file
16  main    5432 online postgres /var/lib/postgresql/16/main /var/log/postgresql/postgresql-16-main.log
16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
5
/home/ubuntu/flowweb/apps/api/.env: Unicode text, UTF-8 text, with very long lines (1757), with CRLF, LF line terminators
```

## 判读行

- **服务器 NODE_ENV 现值**：`production`（进程 environ 实证，[2]）——B8 八读点风险定级：生产读点现值正确；Y0.5 对照基线 = production。
- **COLLAB_ADMIN_TOKEN**：未设（进程 environ 无任何 COLLAB_*，[2]；.env 键名清点零命中，[F7]）——W23 前置缺失，部署时须新增注入。
- **旧实例有效 CWD 与旧 spool 计数**：CWD=`/home/ubuntu/flowweb/apps/api`；CWD 派生目录 `apps/api/.data/collab-spool` 与备选 `flowweb/.data/collab-spool` 均不存在（0 帧，[4]）。cutover ③.5 判据：目录≠`/home/ubuntu/flowweb-data/collab-spool` 成立，但"旧目录有帧"不成立 ⇒ **账本迁移不触发**（无账本可迁，纯新建）。
- **MINIO_USE_SSL 值形态**：`false`，严格布尔形态合规 ⇒ T12 前置断言无需先改 .env；`MINIO_ENDPOINT=http://<host>` 与 useSSL=false 组合自洽（[2b]）。
- **rsync / global fetch**：`/usr/bin/rsync` 存在；`typeof fetch === "function"` ⇒ deploy-guard 服务器侧两前置满足，不会在服务器必炸。
- **服务器 .env 读取器前提**：无 export 前缀、无行内注释（[4]）——readEnvFile 对拍前提成立；**但 .env 为 CRLF/LF 混合行尾（[F8]）**——任何远端 shell 直读 .env 的工具（grep/cut 拼 DSN 等）必须 strip `\r`，[6] 中 psql 报 `database "flowweb" does not exist` 即 `\r` 污染库名所致（应用侧 env 加载器会 strip，故应用正常）；readEnvFile 实现须容 CRLF。
- **pm2 startup / logrotate / swap**：`pm2-ubuntu` enabled（开机自启有）；pm2-logrotate **未安装**（`~/.pm2/modules` 为空，[F2]）；swap 有（/swap.img 1.9G，已用 377.7M——存在历史内存压力信号）。
- **3001 公网监听**：当前 3001 未监听，仅 `*:3000`（[5]）；主机防火墙 ufw **inactive**（[F5]）且 3000 绑 0.0.0.0 ⇒ collab 部署后新增 3001 监听若绑 0.0.0.0 即公网直达 ⇒ **COLLAB_BIND_ADDR=127.0.0.1 必要性成立**。
- **nginx /collab 现有 block 数**：**0**（nginx 1.24.0 已装且 sudo nginx -T 可读，无 /collab location、/etc/nginx 无 collab 引用，[F3]）⇒ 替换语义对象 = 纯新增 block，无既有配置需保留。
- **pg_dump**：`/usr/bin/pg_dump` 16.14 存在 ⇒ 备份前置满足。
- **PG 连接与内存实占**：server 16.14 单集群（16/main），监听 127.0.0.1:5432（不对公网，[F8]）；`shared_buffers=128MB`、`max_connections=100`、`pg_stat_activity` 全局 11 / flowweb 库 5（[F4][F8]）⇒ runbook connection_limit 据实：上限 100，现用 5，余量充足。
- **Redis maxmemory**：`134217728`（128MB，**有界**）、policy=`noeviction`、`appendonly=no`（仅 RDB 快照）——Redis 无 OOM 无界风险。

## 数值推导（单进程时代档案——2026-10-08 口径；Y0c 双进程起被下节取代，协居 514.6MB 系旧时代数字）

实测口径：协居进程 RSS = [1]+[F1] 之和——minio 224620KB（219.4MB）+ postgres 11 进程合计 108016KB（105.5MB）+ redis-server 10800KB（10.5MB）+ flowweb-api node 142120KB（138.8MB）+ PM2 God Daemon 41364KB（40.4MB）= **526920KB ≈ 514.6MB**。（非协居但常驻：腾讯云 YDService 101.3MB、journald 34MB、fwupd 29.5MB、multipathd 26.7MB——不计入算式，但解释整机 `used=844MB`。）

**算式 1**：`max_memory_restart ≥ old-space + 384MB`（Yjs ArrayBuffer 外部内存 + 代码段 + 栈余量）
- 取 old-space=512 ⇒ 下限 = 512 + 384 = **896MB** ⇒ max_memory_restart=**1G（1024MB）**满足。
- spec 原型 old-space=768 在此算式下自相矛盾（768+384=1152 > 1G）⇒ **实测推翻原型的 768，定 512**。

**算式 2**：`old-space + 384MB + 协居实测 RSS 总和 + 系统保留 300MB ≤ 1900MB`
- 512 + 384 + 514.6 + 300 = **1710.6MB ≤ 1900MB** ✓（余量 189.4MB）
- 协居 RSS 514.6MB < 600MB 阈值 ⇒ old-space 维持 512、**不降 384**。
- 边界核验：预算 1900MB vs 物理总内存 1967MB，仅余 67MB 物理余量，超限由 1.9G swap 兜底（当前已用 377MB）。若 Yjs 上线后协居实测 RSS 总和涨破 600MB，按规则回退 old-space=384（384+384+600+300=1668MB 仍 ≤1900）。

**定稿推荐**：`--max-old-space-size=512`、`max_memory_restart: 1024`（1G）。

现网对照（基线）：`--max-old-space-size=384`、max_memory_restart 未启用（堆失控时靠内核 OOM kill）、kill_timeout 默认 1600ms、fork/1 实例、uptime 51D 内重启 312 次（unstable=0，重启均为部署驱动）——ecosystem.config.cjs 切换后上述四项全部显式化。

## 数值推导（双进程时代——Y0c T32 实测/T39 回填，Z44/Z85 口径）

**稳态预算判据现值（runbook §9.2，2026-10-16 T32 出口轮实测）**：

> `p95(api) 230.5 + p95(worker 树) 197.4 + 协居 477.4 + 系统保留 300 = 1205.3 ≤ 1967` ⇒ **达标**（余量 761.7MB；三口径同判：closepage 轮 1199.9 / soak 轮 1205.5 / 合并保守 1205.3——降级出口 COLLAB_ROLE=all 不触发，维持登记不启用）。

**协居重实测 = 477.4MB（取代上节单进程时代旧值 514.6MB）**，四分量：minio 243.6 + postgres（11 进程合计）137.9 + redis-server 18.6 + **pm2-runtime 77.3**（unit 前台形态 god 实测——Z85 算式用 40.4 系旧 daemon 形态值，差 36.9MB 由余量 70 项吸收）。测量时点=2026-10-16 T32 出口轮；口径=本档 [F1] 同法（ps RSS 按进程族求和）但**不含 flowweb-api/worker node**（双进程各为判据独立 p95 项——旧 514.6 含当时 api 138.8MB，两值口径不同不可直接相减比较）；soak 客户端=瞬态 harness 不计入；非协居常驻（YDService 70.9/journald 42.6/fwupd 28.8/multipathd 26.7≈169MB）沿本档先例不入算式，由「系统保留 300」项覆盖（三点口径声明全文=runbook §9.2）。

**算式 1（per-process mmr，Z44）**：`max_memory_restart ≥ old-space + 384MB`——old-space=512 ⇒ 下限 896MB ⇒ **1G×2 维持**（api/worker 各一份；现制式 heap 算术自洽 750MiB+200MiB≤1G）。计划值 560/480 下调与 check-ecosystem 既有算术**冲突无解**（api：Z126③ TRIP≥549.8MB > 560M 制式 Z118 上限 377.5MB；worker：基线×4=555.2MB < RELEASE < TRIP ≤293.6MB）⇒ fail-safe 维持现状，**数字重设计归 Y7**（spec §0.6 偏离 50）。

**算式 2（机器兜底，Z85）**：unit `MemoryMax=1150M`（算式=560+480+god 40.4+余量 70——1G 制式下该闭合算式发散，数值闭合归 560/480 重设计同批）。**cgroup 先触发语义**：单进程趋近 mmr 1G 时 unit 内合计（1G+对侧 ~200MB+pm2-runtime 77.3MB≈1.3G）>1150M ⇒ 内核 cgroup **先于 pm2 mmr** 杀 RSS 最大者（=泄漏者），pm2 autorestart 拉起=设计行为非事故——Z85 分层分工（mmr 管单进程泄漏快重启/MemoryMax 管机器不炸）不因触发顺序倒挂而破坏。`MemorySwapMax=128M`=宁被杀不换页。

**判据形态更替声明**：单进程时代算式 2（`old-space+384+协居+300≤1900`）由上述「p95 三项+协居四分量」判据取代——api/worker 内存各为独立 p95 项（Z117② worker=进程树口径含 ffmpeg 子进程；ffmpeg 峰值保留登记+standalone 附注见 runbook §9.2）。

## 现状快照（Y0c T31-T38 终态——T39 出口复核 2026-10-16 23:38 ssh 只读采集，代际 `1daca1a2`）

| 面 | 终态 | 来源/证据 |
|---|---|---|
| 进程形态 | pm2 双 app：flowweb-api（role=api，3000/3001）+ flowweb-worker（role=worker，3002），fork×1 各，pm_cwd=`/home/ubuntu/flowweb`，online，restarts **4/4**（T33 档 3/3 + T36 部署窗 +1 一一对应，零异常重启） | T23-T33 双进程化；T39 pm2 jlist 复核 |
| systemd | `flowweb-pm2.service` active（pm2-runtime 前台，cgroup 包含性已验）：MemoryMax=**1150M**（systemctl show 实测 1205862400B）+TimeoutStopUSec=**2min 30s**+MemorySwapMax=128M+Restart=on-failure；旧 pm2-ubuntu 已 stop+disable（孤儿 daemon 已清场） | T31；runbook §1.1；T39 systemctl show 复核 |
| 内存数值 | old-space 512×2 + mmr 1G×2（ecosystem）；判据现值 1205.3≤1967 达标（余量 761.7MB） | T32；runbook §9.2；上节 |
| NODE_ENV | **production 单源=`.env` 生效层**（T31 unit 切换后 pm2 environ 无 NODE_ENV 行=换轨实证；T34 zod default production fail-closed+8 直读点归一 census ㉒ 清零+COLLAB_FAKE_AI∧production 拒启） | T34；runbook §8 |
| COOKIE_SECURE | `.env` 未设该键=resolver 按档位兜底（production 恒 Secure）；显式三态+production∧'false' 拒启；`resolveSecureTransport()` 单点驱动 auth.ts+update-profile.dto（禁第二处判断） | T35；spec §0.6 偏离 55 |
| 网络绑定面 | ss 实测：3000/3001（api pid 3376468）+3002（worker pid 3376681）全 **127.0.0.1**（全网监听退役；API_BIND_ADDR `.env` 未设=main.ts `?? '127.0.0.1'` 默认）；5432/6379 loopback 不变；MinIO 9000/9001 `*:` 全网监听（**批外既有状态**——ufw inactive，公网暴露面依赖腾讯云安全组，如实登记不动作） | T36；T39 ss 复核 |
| XFF/限流 | req.ip 单源（手写 getClientIp 已删）+api `trust proxy 'loopback'`+nginx `$proxy_add_x_forwarded_for` 追加语义⇒链首伪造不可键控；RN5 四点探测全 PASS（a1 恒不限对照/a2 XFF 键控被限/b 真源被限/c 伪造 127.0.0.1 仍被限）；COLLAB_TRUSTED_PROXY=1 在位（production∧未设拒启）+RATE_LIMIT_IP_WHITELIST 进 zod | T36；runbook §3.8 |
| nginx | sites-enabled 仅 `flowweb` 1 文件；`location /api/` 计数 **1**（RN6：.bak 重复块 flowweb.bak-1791457973 备份至 ~/backups 后删除+reload 复验）；cert/*.bak-expired-20260823 与 flowweb.pre-y0b2-nginx.bak 历史备份仍在**非加载路径**（nginx 不 include，无生效面——T39 复核如实记录） | T36 RN6；T39 复核 |
| Redis | AOF 三件：`aof_enabled:1 / aof_last_write_status:ok / loading:0`；CONFIG `appendonly yes / appendfsync everysec / maxmemory 134217728 / maxmemory-policy noeviction`；/etc/redis/redis.conf md5=`a7c8bf56e264563ba2d67736cfcb6431` ≡ 仓内副本头注登记值（T37 后零漂移）；仓内权威=`deploy/redis/server-redis.conf` | T37；runbook §12；T39 INFO/CONFIG/md5 复核 |
| 备份日常面 | crontab `17 3 * * *` pg-dump-daily.sh 在位（check-collab-health `*/5` 巡检旁）；手动全链首记录（cron 同款调用）done OK：`daily-20261016230621.dump` 154606B+pg_restore TOC 352 条；水位守护双形态演练绿（R4）；**自动首跑=2026-10-17 03:17**（核对 `.data/pg-dump-daily.log` 新增 done OK 行——归片 B 执行窗首日顺手项） | T38；runbook §13；T39 crontab/日志/备份目录复核 |
| 备份文档面 | `full-stack-backup.md`=备份/恢复单一权威（三轨合一表+保留分层表+恢复语义 Z16③④+MinIO 缺口 Y7 门槛项+PITR 六步执行清单）；`deploy/postgres/pitr-template.conf` 模板入仓（**服务器零动作**，PITR 挂 Y7） | T38 |
| 巡检 | `node scripts/check-collab-health.mjs` 服务器本地 **exit 0**（T39 复核现值；cron 日志尾三条全 OK） | T39 |
| 代际 | dist/build-info.json=`{"git":"1daca1a2","builtAt":"2026-10-16T13:54:07Z"}`（T36 绑定面收窄轮） | T39 复核 |

---

## 附录：Y0a-4 部署执行记录（2026-10-08）

**两次部署全链（run#1 8d5704b4 收据形态补落 / run#2 全链证据）**：

- run#2 drain pre pass（JSON 一行）：`{event:'deploy_drain_pre_pass', pending:{projects:0,batches:0,spoolFiles:0,spoolBytes:0}, totalPre:0, epochPre:1}`——pre 125ms；own 四零维持（SV11）
- run#2 drain post pass：`{event:'deploy_drain_post_pass', pending:{projects:0,batches:0,spoolFiles:0,spoolBytes:0}, totalPost:0, epoch:2}`——post 53ms（epoch 1→2 递增）
- ready barrier 5s→3001 listening→collab-smoke OK（双客户端互见+全新 Y.Doc 重放 PG）→部署完成
- **溯源**：dist/build-info.json=8d5704b4≡本地 HEAD（cutover ④ sha256 锚绑定）；pm2_env 口径实测不成立——pm2 8.0.0 剔除 GIT_* 前缀 shell env（显式 export+--update-env 后 pm2_env 与 /proc environ 均无 GIT_COMMIT_HASH）
- **绑定面**：`ss -tlnp` 仅 127.0.0.1:3001（无公网暴露）
- **NODE_ENV 两列制**：迁移前 /proc=production；startOrReload 后 /proc=production（无变化）
- **备份恢复验证**：restore 零错+projects=39/users=10 往返一致+scratch 库清理（CanvasDoc=0 属实——服务器本无 Yjs 文档）
- **公网面**：主页 200 / drain POST 403（deny 生效）/ ready 200
- **pm2 jlist 基线**：fork_mode / instances 1 / kill_timeout 45000 / status online / restart_time 314→315

**服务器环境变更**：

- Node 20.20.2→**22.23.3**（nodesource node_20.x→22.x——WebSocket 原生启用；T12 实测冒烟挂 `WebSocket is not defined` 根修；CI node-version=22 一致）
- 服务器 .env CRLF 混合行尾（29/52 行）→统一 LF（备份 `.env.bak-crlf-1791454889`）——bash 直读 DSN/MINIO 断言 \r 污染根除
- DB 迁移历史 baseline+重放：_prisma_migrations 原 1 条 0 步 failed 残留（db push 时代遗产，31 表无 teamId/role/Y0a 表）→init applied baseline+重放 23 迁移；9 轮迭代修复撞点（CanvasProject 37 行无主项目回填首个用户团队/teamId 预置/SubscriptionPlan storageLimitBytes 20GiB 默认/Folder 手工补建/Template status 占位列+TemplateStatus 占位 enum）+迁移链与 schema 固有 gap 24 行直接执行（squash 遗产——Template folderId 等）；每用户造个人团队（t-mig-*/OWNER）+全表 teamId 回填
- migrations 目录新旧混杂清理：tar 解包只覆盖不清理——44 个含 20 个已删老迁移→清除+全量重传镜像（**部署链缺陷登记 Y0.5：deploy_api 上传 prisma 前应清远端 migrations 目录**）
