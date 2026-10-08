# 服务器前置实测档案（M0 扩采 + M1 pm2 基线）— 2026-10

- 采集时间：2026-10-08 11:36 +0800（服务器 date 实测 2026-10-08 11:36:48 +0800，与本地同 TZ）
- 采集基准 commit：`850b35cd`（master）
- 服务器：`ubuntu@101.42.94.107`（hostname VM-8-2-ubuntu，Ubuntu 24.04，Mem 1967MB + swap 1987MB，磁盘 /dev/vda2 50G 已用 9.2G）
- 性质：**只读实测，远端无任何变更**；唯一写操作为本档案 + commit
- 用途：ecosystem.config.cjs 数值定稿（max_memory_restart/old-space）、部署链设计（spool 账本迁移判据）、runbook 数值的实证依据

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

## 数值推导（算式与结论写死）

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
