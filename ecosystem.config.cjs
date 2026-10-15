// ecosystem.config.cjs —— FlowWeb 双进程定义唯一源（Y0a-4/spec §4.1+冻结契约 9；Y0c T30 双 app：
// §5.1 v5 预算表+Z10/Z84/Z103——api+worker 按 role 分档；结构锚=scripts/check-ecosystem.mjs）
// 口径纪律（Z10/Z85——写死本文件+runbook）：max_memory_restart 是**单进程重启触发项**（上限口径），
// 不是内存预算项——**两进程上限不可相加**进稳态预算判据（罩多进程的 systemd MemoryMax=各上限之和
// 是兜底设定的正确算术，与此不同事）。稳态预算判据=p95(api_RSS)+p95(worker 进程树 RSS 合计)+协居+300。
// 数值依据：docs/superpowers/deploy-server-profile-2026-10.md（RSS 口径算式）+spec §5.1 表〔待实测校准〕
// 生效方式：deploy.sh 统一 `pm2 startOrReload ecosystem.config.cjs --update-env`（B1′：restart 不读文件——改本文件必须 startOrReload）
// 迁移 runbook：docs/superpowers/collab-ops-runbook.md §1（startOrReload 幂等——首启/更新均同一条命令）
// NODE_ENV 不在此注入（B8 八读点审计归 Y0.5/E58 一体——现值见 server-profile）
module.exports = {
  apps: [{
    name: 'flowweb-api',
    script: 'apps/api/dist/main.js',
    cwd: '/home/ubuntu/flowweb',
    instances: 1,                     // 单实例钉死（E35）——多实例=移除租约+所有权注册表（Y7）
    exec_mode: 'fork',
    kill_timeout: 45000,              // E43⑤/SV6：HTTP dispose+关停链 ≤22s+垫 ≥23s
    kill_signal: 'SIGTERM',
    max_memory_restart: '1G',         // 〔待实测校准→T32：§5.1 设计 560M（384+176）；Z103① 实测前维持 1G 不下调；下调则 ecosystem+check-ecosystem+heap-pressure 三处同批再改（Z84③）〕
    node_args: '--max-old-space-size=512',   // 〔待实测校准→T32：§5.1 设计 384；现值 512=T0 实测定稿（1.9GB 协居机算式解）维持〕
    min_uptime: '30s',                // A7 守护三件套：防快崩溃重启风暴
    max_restarts: 10,
    restart_delay: 4000,
    autorestart: true,
    watch: false,
    env: {
      // env 白名单（check-ecosystem 断言）：禁密钥进本文件——其余 env 一律服务器 apps/api/.env 手工管理
      // COLLAB_ROLE=分叉键（Z89/㉑——两 app 显式异值，禁进 .env）：api 角色⇒processor 注册门
      // （manualRegistration，T30/Z98 四面之二）+WS listen+守护定时器装配；不消费队列
      COLLAB_ROLE: 'api',
      // P47：树外目录——部署树内的 .data 只靠 provision_tarball 的 --exclude 一条纪律保命；
      // 迁移机制本批已建（cutover ③.5），目标改树外一次性取消整类风险
      // Y0c T21/Z61：maxDebounce 禁调大——SIGKILL 丢数据窗 ≤3000ms（=debounce 2000×1.5 写死在 gateway，RPO 契约值 E43⑥，调大即放宽丢数据窗）
      COLLAB_SPOOL_DIR: '/home/ubuntu/flowweb-data/collab-spool',   // E37+P47：绝对路径且树外（CWD 漂移+部署覆盖双防护）
      COLLAB_BIND_ADDR: '127.0.0.1',   // P25：3001 不公网监听（nginx 同机反代唯一路径）
    },
    merge_logs: true,
    time: true,
  }, {
    name: 'flowweb-worker',
    script: 'apps/api/dist/main-worker.js',   // T26 引导：ready 门+3002 loopback 指标（Z102/Z139）
    cwd: '/home/ubuntu/flowweb',
    instances: 1,                     // E35 同款单实例（stalled 重投语义依赖单消费者组，Y7 前禁多实例）
    exec_mode: 'fork',
    nice: 10,                         // Z10：CPU 优先级=拆分真实收益（ffmpeg/sharp 重活让位 WS 事件循环）
    kill_timeout: 120000,             // Z10/§5.2：ffmpeg 转码/4K 合成排空上界（check-ecosystem 按 role 断 ≥120000）
    kill_signal: 'SIGTERM',
    max_memory_restart: '1G',         // 〔待实测校准→T32：§5.1 设计 480M（320+160）；Z103① 实测前维持 1G 不下调；下调则三处同批再改（Z84③）〕
    node_args: '--max-old-space-size=512',   // 〔待实测校准→T32：§5.1 设计 320；现值 512 与 api 同制式维持〕
    min_uptime: '30s',                // A7 守护三件套（worker 同款）
    max_restarts: 10,
    restart_delay: 4000,
    autorestart: true,
    watch: false,
    env: {
      // 分叉键显式（Z67④ 双向断言——check-ecosystem 钉死 ==='worker'）：worker 角色⇒processor
      // 全量注册（17 消费面）+写端点客户端+3002 指标；零 WS listen/零守护定时器（Z98 四面）
      COLLAB_ROLE: 'worker',
    },
    merge_logs: true,
    time: true,
  }],
};
