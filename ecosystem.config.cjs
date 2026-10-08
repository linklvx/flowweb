// ecosystem.config.cjs —— FlowWeb api 进程定义唯一源（Y0a-4/spec §4.1+冻结契约 9）
// 数值依据：docs/superpowers/deploy-server-profile-2026-10.md（RSS 口径算式：512+384=896≤1024；协居 514.6MB，总 1710.6≤1900）；结构锚=scripts/check-ecosystem.mjs
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
    max_memory_restart: '1G',         // T0 实测定稿（RSS 口径；check-ecosystem 断言 ≥ old-space+384MB）
    node_args: '--max-old-space-size=512',   // T0 实测定稿（1.9GB 协居机算式解；spec 原型 768 过不了算术）
    min_uptime: '30s',                // A7 守护三件套：防快崩溃重启风暴
    max_restarts: 10,
    restart_delay: 4000,
    autorestart: true,
    watch: false,
    env: {
      // env 白名单（check-ecosystem 断言）：禁密钥进本文件——其余 env 一律服务器 apps/api/.env 手工管理
      // P47：树外目录——部署树内的 .data 只靠 provision_tarball 的 --exclude 一条纪律保命；
      // 迁移机制本批已建（cutover ③.5），目标改树外一次性取消整类风险
      COLLAB_SPOOL_DIR: '/home/ubuntu/flowweb-data/collab-spool',   // E37+P47：绝对路径且树外（CWD 漂移+部署覆盖双防护）
      COLLAB_BIND_ADDR: '127.0.0.1',   // P25：3001 不公网监听（nginx 同机反代唯一路径）
    },
    merge_logs: true,
    time: true,
  }],
};
