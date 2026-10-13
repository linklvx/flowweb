// scripts/collab-health-thresholds.mjs —— Y0b-5 T15 阈值单源（plan：与 T10/T14 指标清单同源派生禁手抄）。
// 单源约束（check-collab-health.test.mjs it1 机器断言）：
//   ① THRESHOLDS 键 ⊆ *.metrics.ts 实际注册指标名（check-spec-consistency collectMetricFiles+extractMetricNames 提取）；
//   ② T14 四键注解（t14Key）恰齐 dirtyDocs/oldestUnflushed/spoolDepth/stuckDocs——与 /api/ready token 档
//     degraded 四键同源（collab-ready.service 注释口径：dirtyDocs≡yjs_pending_projects/
//     oldestUnflushed≡yjs_oldest_unflushed_age_seconds/spoolDepth≡yjs_spool_depth_bytes/stuckDocs≡yjs_doc_stuck_total）。
// 评估 kind 词表（check-collab-health.mjs evaluate 消费）：
//   counter-delta        两样本差（进程重启回落=重基线不误报）；rounds>1=连续 N 轮命中才告（stuck 10min 口径）
//   counter-share        匹配 label 集增量 / 全量增量 占比（ws_close 4410+4404）
//   label-gauge-persistent 指定 label 序列值连续两样本成立（overload tripped）
//   gauge-tier           容量分档（spool 深度 50%/80% 预阈值+满仓——取最高命中档不叠发）
//   gauge-max            瞬时上界；rounds>1=持续 N 轮（awareness）
//   gauge-no-fall        非回落持续（zero_conn 候选池）
export const THRESHOLDS = {
  // ===== P0（exit 2——人工立即介入） =====
  collab_overload_state: {
    level: 'P0', kind: 'label-gauge-persistent', labels: { state: 'tripped' },
    note: 'heap 闸 tripped 连续两样本（巡检 5min 周期=持续 ~5min）——安全阀静默降级=全站少服务而无人知',
  },
  intent_frozen_stranded_total: {
    level: 'P0', kind: 'counter-delta', delta: 0,
    note: '资金不变量：终态冻结悬留增量>0（settle 闭环失效——资损级信号）',
  },
  intent_reconcile_mismatch_total: {
    level: 'P0', kind: 'counter-delta', delta: 0,
    note: '资金不变量：每日对账不一致增量>0（资损前兆）',
  },
  ai_artifact_discarded_total: {
    level: 'P0', kind: 'counter-delta', delta: 0,
    note: '资金不变量面（plan 字面全 cause P0）——已知误报：cause=node-deleted 在飞窗口真实计量属正常，命中先查 cause 分布再升级',
  },
  yjs_spool_capacity_total: {
    level: 'P0', kind: 'counter-delta', delta: 0,
    note: '★全系统唯一「用户再也存不了东西」硬停面（overCapacity 熔断拒新编辑——人工处置=collab-spool-quarantine）',
  },
  yjs_spool_depth_bytes: {
    level: 'P0', kind: 'gauge-tier', t14Key: 'spoolDepth',
    tiers: [
      { pct: 0.5, level: 'P1', tag: '>=50%' },
      { pct: 0.8, level: 'P1', tag: '>=80%' },
      { pct: 1.0, level: 'P0', tag: 'full' },
    ],
    note: 'spool 深度容量分档（容量=COLLAB_SPOOL_CAPACITY_BYTES 默认 256MB 同款解析）——PG 长故障经 T16 熔断短路全部落 spool，50%/80% 预阈值给人工介入窗（v2.2 只在满仓后告警太晚）',
  },

  // ===== P1（exit 1——分诊+观察） =====
  yjs_doc_stuck_total: {
    level: 'P1', kind: 'counter-delta', delta: 0, rounds: 2, t14Key: 'stuckDocs',
    note: 'stuck 增量连续 2 轮（10min）——runbook 分诊：查库卸载守卫为何不满足（pendingQueues 残留/连接计数非零），禁用驱逐器掩盖',
  },
  yjs_zero_conn_docs: {
    level: 'P1', kind: 'gauge-no-fall', rounds: 2,
    note: '零连接常驻 doc 持续不回落（stuck 候选池规模）——手工出口=drain→重启→观察回落',
  },
  collab_auth_reject_total: {
    level: 'P1', kind: 'counter-delta', delta: 10, labels: { source: 'bucket' },
    note: '限流桶拒绝高增（>10/轮）——collab_auth_attempt_blocked_total 仓内零代码命中（spec :674 改名未落地），改挂既有 bucket 序列+偏离表登记',
  },
  yjs_doc_bytes_over_threshold_total: {
    level: 'P1', kind: 'counter-delta', delta: 0,
    note: 'doc 编码 >16MiB 观测增量（病态 doc 信号——三锚观测非执法）',
  },
  yjs_pending_projects: {
    level: 'P1', kind: 'gauge-max', value: 20, t14Key: 'dirtyDocs',
    note: 'T14 dirtyDocs：pending 队列非空项目数>20（活跃编辑常态 1~5——20=排空链异常量级）',
  },
  yjs_oldest_unflushed_age_seconds: {
    level: 'P1', kind: 'gauge-max', value: 120, t14Key: 'oldestUnflushed',
    note: 'T14 oldestUnflushed：最老未 flush 窗口>120s（正常链=debounce 2s+maxDebounce 3s+append 5s≈8s——120s=落定链断）',
  },
  awareness_states: {
    level: 'P1', kind: 'gauge-max', value: 8, rounds: 2,
    note: 'Σ在飞 awareness 条目>8 持续 2 轮（T13 over-8 distinct user 判定的观测面）',
  },
  collab_ws_close_total: {
    level: 'P1', kind: 'counter-share', share: 0.2, minDelta: 5,
    matchLabels: [{ code: '4410' }, { code: '4404' }],
    note: '应用侧主动 close 中 4410（terminal/世代失效）+4404（配额强推升级）占比≥20% 且样本≥5——客户端被服务端主动断的比例面',
  },
};

/** spool 容量解析——与 CollabSpoolService 构造期同款（缺省/NaN/非正数回落 256MB；env 读不引 api 代码保持脚本独立）。 */
export function resolveSpoolCapacityBytes(env) {
  const n = Number(env.COLLAB_SPOOL_CAPACITY_BYTES);
  return n > 0 ? n : 256 * 1024 * 1024;
}

/** not-serving 持续>1min → P0（/api/ready reason 面——非指标驱动，同模块单源）。 */
export const NOT_SERVING_P0_MS = 60_000;

/** SMS per-check 节流窗（新 P0 不被旧 P0 吞——每 check 键独立计时）。 */
export const SMS_THROTTLE_MS = 15 * 60_000;

/** 心跳外层判据（runbook：heartbeat 文件停更>15min=P0——脚本无法自证自身/整机死亡）。 */
export const HEARTBEAT_STALE_MS = 15 * 60_000;
