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
//   age-tier             绝对值年龄分档（C2-1 frozen_age P1@1h/P0@6h——tiers.value 绝对秒非容量百分比；
//                        取最高命中档不叠发，gauge-tier 同语义的年龄形态）
//   gauge-max            瞬时上界；rounds>1=持续 N 轮（awareness）
//   gauge-no-fall        非回落持续（zero_conn 候选池）
//   bytes-guard-pair     Y0c T20（Z92 改形）：guard gauge 越 resolve{limitEnv} 上限 ⇒ 必有
//                        guardCounter/evictCounter 累计（否则约束死键=假门禁——连续 2 轮才告，tick ≤15s
//                        滞后窗排除）；上限内 ⇒ guardCounter 增量稳定（连续 2 轮增量才告——样本间瞬态
//                        超限已恢复属机制工作不告）。两分支均可判（v5「≤上限」恒真失误的改形）。
//   gauge-max 小扩（Y0c T29-II/Z148④）：warnLevel 可选——rounds 持续判定未满窗时超限即发 warnLevel
//                        （WARN 首见/持续升 ERROR 双档面；无 warnLevel 的既有条目行为零变化）。

/** C2-1（生产就绪收尾批·OpsGate 主体）：worker 3002 OpsGate 族操作判定参数——check-collab-health
 *  evaluate OPS_GATE 段消费（独立于 THRESHOLDS 循环：source=worker 3002——api 3000 恒 0 死键，retention/
 *  C3 同款声明分工；THRESHOLDS 本指标条目 tiers 值派生自本参数——两级单源禁手抄）。
 *  gauge 维护面=compact poller（boot 扫行初始化+每 tick 聚合刷新）；族缺席=维护面破（worker 未装配/
 *  未注册）⇒ P1 unobservable（audit 族先例同判）。 */
export const OPS_GATE_CHECKS = {
  gauge: 'collab_ops_gate_frozen_age',
  p1Ms: 3_600_000,    // P1@1h——分诊+解冻 ack 处置窗
  p0Ms: 21_600_000,   // P0@6h——冻结悬置升级（SMS）
};
export const THRESHOLDS = {
  // ===== P0（exit 2——人工立即介入） =====
  collab_overload_state: {
    level: 'P1', kind: 'label-gauge-persistent', labels: { state: 'tripped' },
    note: 'Y0c T20 常驻重标（原 P0）：常驻集=预期态（Z126①）——tripped 期冷 doc 拒新物化+常驻集字节 LRU 驱逐=设计降级非静默故障；持续两样本（~5min+）=容量重标信号（分诊+观察；runbook 处置面不变）。双进程 TRIP 阈值重标归片 D 内存实测',
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
    note: 'Y0c T20 口径重标（Z73 读者②）：gauge 已改读「仅 WS 零且无 direct 持有」（常驻会话持有的 doc 不计——常驻噪声在读者侧消除，阈值形态维持不回落持续判定）——真零连接 doc 持续不回落=stuck 候选池；手工出口=drain→重启→观察回落',
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

  // ===== Y0c T20（Z122④）：A2 常驻化稳态合同——四稳态判据扩表（全部稳态 0） =====
  yjs_shutdown_direct_leak_total: {
    level: 'P1', kind: 'counter-delta', delta: 0,
    note: '四稳态①destroy_timeout=0：关停步骤 0 后 Σdirect 泄漏（Z81 硬失败口径——help 自陈「非零=destroy_timeout 必发前显式点名」；hangReason 面为日志非指标，本计数为其 /metrics 载体）——增量>0=关停链交接/预算拒绝留 hold 未收敛',
  },
  collab_doc_vacuum_total: {
    level: 'P1', kind: 'counter-delta', delta: 0, labels: { result: 'quiesce-timeout' },
    note: '四稳态②quiesce-timeout=0：vacuum 卸载等待 30s 超时中止（Z37——DB 零变更且状态自恢复，但非零=doc 排空链断信号：三态滞后度永不满足/常驻会话反复重 acquire）',
  },
  collab_vacuum_autotrigger_stacked_total: {
    level: 'P1', kind: 'counter-delta', delta: 0,
    note: '四稳态③stacked=0：同 doc 30s 窗内≥2 次自动 vacuum 触发（Z66——recheck 周期 30s==quiesce 上界 30s 的叠加面；触发判据 T20 已改零 WS∧零 direct，计数仍测重入叠加）',
  },
  yjs_release_with_pending_total: {
    level: 'P1', kind: 'counter-delta', delta: 0, rounds: 2,
    note: '四稳态④release_with_pending=0：三出口/带批档批中强释拒绝（Z141 前置+refCount 在用）。T17 评审观察项语境：refCount>0 瞬态 tick≠三出口病理——读数排除交织窗=连续 2 轮（10min）才告；单轮增量=交织窗内合法拒绝',
  },

  // ===== Y0c T20（Z92 改形——Z106⑤）：常驻字节主约束非恒真断言 =====
  yjs_resident_bytes: {
    level: 'P1', kind: 'bytes-guard-pair',
    guardCounter: 'yjs_resident_over_limit_total', evictCounter: 'yjs_doc_evicted_total', limitEnv: 'COLLAB_MAX_RESIDENT_BYTES',
    note: 'Z92 两分支：gauge>上限 ⇒ 必有 over_limit 或 evicted 累计（连续 2 轮——reaper tick ≤15s 滞后窗排除；两计数皆零=字节约束死键=假门禁）；上限内 ⇒ over_limit 增量稳定（连续 2 轮增量才告——样本间瞬态超限已驱逐恢复属机制工作）。「≤上限恒真」形态（env 无默认时 v5 失误）禁回潮',
  },

  // ===== Y0c T29-II（Z130/Z148②④）：worker 存活侦测→动作闭环（api 3000 端点面） =====
  collab_worker_absent_total: {
    level: 'P1', kind: 'counter-delta', delta: 0,
    note: 'Z148②：付费队列 enqueue fail-closed 拒绝（503 WORKER_ABSENT）增量>0——用户面已在拒收，分诊：pm2 worker 状态/3002 活性/ready workers 维度（唯一生产者=WorkerPresenceService.assertAdmittable）',
  },
  yjs_degraded_docs: {
    level: 'P0', kind: 'gauge-max', value: 0, rounds: 2, warnLevel: 'P1',
    note: 'Z148④：装载降级 doc 数 >0 即 WARN（P1 首见——gauge 存在无人读=温度计）；连续 2 轮（~10min）升 ERROR（P0）〔待校准——N 照 label-gauge-persistent 惯例=两样本；持续期查 pendingStructs/pendingDs 装载链〕',
  },
  yjs_updates_rows_total: {
    level: 'P1', kind: 'gauge-max', value: 100_000,
    note: 'Z125-5 预警（观测项非机制项——不强制 compact）：常驻后 store 频次结构性变高，canvasDocUpdate 行数突破 60s 稳态可预警；初始 10 万行〔待校准——行数门归 Y1c-3 再裁〕',
  },

  // ===== C1（生产就绪收尾批·retention worker——红② stuck/红⑤ backlog 观测面；source=worker 3002） =====
  retention_stuck_requests_total: {
    level: 'P1', kind: 'counter-delta', delta: 0, rounds: 2,
    note: 'C1 红②：stuck 请求增量（state=ADMITTED 过期未 claim/EXECUTING 过 GenerationIntent MIN(deadlineAt)——告警不删，资金在飞收口链滞留信号；连续 2 轮（10min）排除 claim 批内瞬态。stuck 口径=request 侧 expiresAt 15min/deadlineAt 非 input 侧 30d。第三档 EXECUTING_ORPHAN=EXECUTING∧无 RUNNING intent（intent 全终态后收口链中断的孤儿——C1-1 评审观测盲区补全档）。〔待校准〕',
  },
  retention_backlog_rows: {
    level: 'P1', kind: 'gauge-max', value: 5_000,
    note: 'C1 红⑤：request 面积压行数（过期未执行待 void——claim ≤50/tick 多 tick 排空；1000 行积压 ≈20 tick ≈20min 排空，持续 >5000=排空链异常量级或 void 路径失败。input/runtime_event 两 table 值=cap 出口残余（P0#1 每 tick 批数上界观测——每 tick 部分进度跨 tick 单调排空；持续高位同判排空链异常）。〔待校准〕）',
  },

  // ===== C3（生产就绪收尾批·doc-append-gap-alert——append 审计 worker 面；source=worker 3002：
  //        CollabAppendAuditWorker 仅 worker 进程装配〔api 3000 无此族=本表条目恒 0 死键，retention 同款
  //        声明面〕；3002 采集的操作判定路径=check-collab-health evaluate AUDIT_WORKER_CHECKS 段——两指标
  //        语义注记 runbook §6） =====
  doc_append_gap_total: {
    level: 'P0', kind: 'counter-delta', delta: 0,
    note: 'C3 红①：append 审计新 gap 边沿计数（(project,generation) false→true 才 inc——CollabJobCursor.lastGap 持久判重；持续 gap 不重发、worker 重启不重基线）——charter doc-append-gap-alert：increase(doc_append_gap_total[5m])>0（0 丢失口径）；增量>0=行集断链三断言违例且 CanvasDocCoalesced 无覆盖=装载尾静默丢数据前兆。source=worker 3002',
  },
  collab_doc_append_gap_current: {
    level: 'P1', kind: 'gauge-max', value: 0, rounds: 2,
    note: 'C3：当前在 gap (project,generation) 对数（每 tick 重算自 lastGap 持久态——跨批旋转全域计数）——0=全修复/无 gap；持续>0=悬而未决断链（新 gap 已由 doc_append_gap_total 边沿计过，本 gauge=修复进展观测面）。source=worker 3002',
  },
  collab_append_audit_purge_stale_total: {
    level: 'P1', kind: 'counter-delta', delta: 0,
    note: 'C3 红②：purge 义务年龄告警边沿计数（purgeBelowSeq 持续非空>30min——compact resumePurges 收敛链卡死的独立告警通道，不被审计三断言吞掉；衰减/修复即清不复发）。source=worker 3002',
  },

  // ===== C2-1（生产就绪收尾批·OpsGate 主体——frozen_age 分级 P1@1h/P0@6h；spec v5 §3 C2 承 v4） =====
  collab_ops_gate_frozen_age: {
    level: 'P1', kind: 'age-tier',
    tiers: [
      { value: OPS_GATE_CHECKS.p1Ms / 1000, level: 'P1', tag: '>=1h' },
      { value: OPS_GATE_CHECKS.p0Ms / 1000, level: 'P0', tag: '>=6h' },
    ],
    note: 'C2-1：OpsGate FROZEN 行最老冻结年龄秒（全局 max——MIN(frozenAt) 聚合无 projectId 标签）；P1@1h=分诊+解冻 ack 处置窗（runbook §14 归 C2-3）/P0@6h=canary 冻结悬置 6h 未 ack 升级。source=worker 3002（api 3000 恒 0 死键——retention/C3 同款声明面）；操作判定路径=evaluate OPS_GATE_CHECKS 段读 3002 同值单源（tiers 值派生自 OPS_GATE_CHECKS 禁手抄）',
  },

  // ===== C2-2a（生产就绪收尾批·replay-canary 捕获侧——plan「pin_retry_total 告警」；source=api 3000：
  //        CollabReplayCanaryPoller 仅 api 进程装配——捕获面与活 doc/withFrozenPrefix 同进程） =====
  collab_canary_pin_retry_total: {
    level: 'P1', kind: 'counter-delta', delta: 0,
    note: 'C2-2a：canary pin 建立失败计数（漂移守卫/pendingStructs 非空/落库异常——失败 pin 即删不残留，poller 下轮重捕）；增量>0=捕获链异常（冻结预算不足/布景漂移/CanaryPin 表异常）持续重试信号，分诊：collab_canary_poll_tick_total{result} 分布+pin_retry 关联样本。其余 canary 告警条目（skip_lag/doc_pg_lag/last_check_age）归 C2-2b。source=api 3000',
  },

  // ===== C2-2b（生产就绪收尾批·replay-canary 比对侧——红⑧ skip_lag 分层兜底+freeze 实弹+覆盖 SLO） =====
  collab_canary_poll_tick_total: {
    level: 'P0', kind: 'counter-delta', delta: 0, rounds: 3, labels: { result: 'skip-lag' },
    note: 'C2-2b 红⑧ skip_lag 分层兜底·持续档：spec §3 C2「skip_lag 连续 3→P0」——withFrozenPrefix flush-timeout（appliedSeq 未达 PG=canary 捕获盲区）连续 3 轮巡检命中⇒P0。载体=counter+rounds（worker tick 级连续性不可观测〔巡检每 5min 为观测粒度〕——轮级 rounds=3 承接「连续 3」；值与 CANARY_CHECKS.skipLagRounds 单源）；组合档（当轮 skip-lag ∧ yjs_oldest_unflushed_age_seconds>30s 即时 P0）=evaluate CANARY 段；spec §3 C2 承 v4「doc_pg_lag_seq 年龄 P0」由组合档承载（独立年龄卡死=T14 既有 P1@120s 兜底——30s 独立 P0 噪声考量不采）。source=api 3000',
  },
  wal_pending_bytes: {
    level: 'P1', kind: 'gauge-max', value: 16 * 1024 * 1024, rounds: 2,
    note: 'C2-2b 红⑧ skip_lag 分层兜底·wal 高位档：WAL own 段待落 PG 字节持续高位（连续 2 轮≈10min——机损 RPO=PG 批延迟的观测面；spool 磁盘总量另见 yjs_spool_depth_bytes 容量分档）。〔待校准——初始 16MiB〕source=api 3000',
  },
  collab_canary_last_check_age: {
    level: 'P1', kind: 'gauge-max', value: 86_400,
    note: 'C2-2b 覆盖 SLO：活跃项目最老检查年龄秒（全局 max）>24h=charter「全局每小时+每活跃项目 ≤24h」破（排程 N=ceil(active×1.25/24)+nextDueAt 轮转链异常/poller 停跑）。声明面（api 3000 恒 0 死键）——操作判定路径=evaluate CANARY 段读 worker 3002（CANARY_CHECKS 单源）。source=worker 3002',
  },
  collab_canary_freeze_total: {
    level: 'P0', kind: 'counter-delta', delta: 0,
    note: 'C2-2b freeze 实弹：canary mismatch→OpsGate FROZEN 落定（charter「不一致告警并冻结」——人工解冻 ack 处置序 runbook §14 归 C2-3；悬置年龄分级另由 collab_ops_gate_frozen_age P1@1h/P0@6h 承接）。声明面（api 3000 恒 0 死键）——操作判定路径=evaluate CANARY 段读 worker 3002（CANARY_CHECKS 单源）。source=worker 3002',
  },

  // ===== C4-c2（生产就绪收尾批·project-erasure——erasure poller worker 面；source=worker 3002：
  //        ProjectErasureRunPoller 仅 worker 进程装配〔api 3000 恒 0 死键，retention/C3 同款声明面〕；
  //        两键语义注记 runbook §13/§6） =====
  erasure_pending_age: {
    level: 'P0', kind: 'gauge-max', value: 3_600_000,
    note: 'C4：最老非终态 erasure run 年龄毫秒（max(now-requestedAt) over active 态∧非 dryRun——每 poller tick 重算）——PENDING>1h=P0：tombstone 后项目对用户已消失而介质残留（worker 停摆/毒丸卡死即撕开「用户视角已删」与「数据仍在」的缺口）；处置=查 worker 进程/run 行 state 分布/FAILED 面（spec §3 C4 P1-13）。source=worker 3002',
  },
  erasure_runs_total: {
    level: 'P1', kind: 'counter-delta', delta: 0, labels: { state: 'FAILED' },
    note: 'C4：run 状态转移计数（state=目标态闭集——DONE/FAILED+各活跃转移）——FAILED 增量=P1（毒丸上界 ERASURE_RUN_MAX_ATTEMPTS=5 兜底后的终态：attempts 已满，无自愈面——人工 re-drive 处置〔POST /api/admin/erasure/runs/:id/re-drive，runbook §13〕）。source=worker 3002',
  },
};

/** Y0c T29-II（Z130③/Z116/R6a）：worker 3002 端点族阈值——「巡检即采集面」（Z134 无 Prometheus
 *  server，3002 只被本巡检消费）。独立于 THRESHOLDS：端点不同（3002≠api 3000）+族源=
 *  collectDefaultMetrics/MetricsService（非 *.metrics.ts——THRESHOLDS it1 机器断言键域外）。
 *  Z116 分集：所读族每一样本必须带 role="worker"（缺 role/异值⇒红——漏调 setDefaultLabels 的
 *  运行时侦测面）；族缺席⇒红（MetricsCore 未装配面）。kind=gauge-max 同语义（瞬时上界）。 */
export const WORKER_METRIC_CHECKS = {
  nodejs_eventloop_lag_seconds: { level: 'P1', value: 1, note: '〔待校准〕worker 事件循环滞后 >1s（p95 归查询侧 Z117②——runbook §11 查询句）' },
  process_tree_rss_bytes: { level: 'P1', value: 480 * 1024 * 1024, note: '〔待校准——T30 worker 480M 口径〕worker 进程树 RSS 上界' },
};

/** Y0c T29-II（Z130①②/R6c）：/api/ready token 档 workers 维度阈值——三付费队列 registered≥1
 *  （任一 0/维度缺失/探测 null ⇒ P0）+waiting>5 ⇒ P1（消费滞后）。队列名单 api 侧单源=
 *  config/queue.constants.ts QUEUE_NAMES（脚本独立不引 api 代码——resolveSpoolCapacityBytes 同款
 *  惯例）。两侧手抄（无机器断言绑定）；漂移⇒ready-workers-missing/registered fail-loud P0 非静默。 */
export const WORKER_PRESENCE_CHECK = {
  queues: ['execution', 'ai-image-edit', 'ai-result-download'],
  minRegistered: 1,
  maxWaiting: 5,
};

/** spool 容量解析——与 CollabSpoolService 构造期同款（缺省/NaN/非正数回落 256MB；env 读不引 api 代码保持脚本独立）。 */
export function resolveSpoolCapacityBytes(env) {
  const n = Number(env.COLLAB_SPOOL_CAPACITY_BYTES);
  return n > 0 ? n : 256 * 1024 * 1024;
}

/** 常驻字节主约束解析（Y0c T20 Z92）——与 CollabResidencyService 构造期同款（residency 使用点默认
 *  384MiB=402653184，Number()|| 回落语义等价：0/NaN/非正数回落默认；env 读不引 api 代码保持脚本独立）。 */
export function resolveMaxResidentBytes(env) {
  const n = Number(env.COLLAB_MAX_RESIDENT_BYTES);
  return n > 0 ? n : 402_653_184;
}

/** C3-1（doc-append-gap-alert）：worker 3002 端点审计族检查参数——check-collab-health evaluate 消费
 *  （独立于 THRESHOLDS：端点=3002 非 3000、族源=*.metrics.ts〔collab-append-audit.metrics.ts〕非
 *  collectDefaultMetrics——THRESHOLDS it1 键域外；本表+THRESHOLDS 三键=charter 阈值单源声明面）。
 *  lastRunGauge：样本年龄判定（红⑥ worker 停跑——error tick 不推进 last_run 即升龄；进程死=
 *  worker-metrics-unreachable P0 既有承担，本判据=进程活而审计 tick 死的半死面）；stale 阈值=15min（3 tick 窗）。 */
export const AUDIT_WORKER_CHECKS = {
  lastRunGauge: 'collab_append_audit_last_run_unix_seconds',
  lastRunStaleMs: 15 * 60_000,
  gapCounter: 'doc_append_gap_total',
  currentGauge: 'collab_doc_append_gap_current',
  purgeStaleCounter: 'collab_append_audit_purge_stale_total',
};

/** C2-2b（生产就绪收尾批·replay-canary 比对侧）：canary 告警组合参数——check-collab-health evaluate
 *  CANARY 段消费（worker 3002 面=last_check_age/freeze_total〔api 3000 恒 0 死键，THRESHOLDS 同名
 *  条目=声明面，ops-gate/audit 同款分工〕；api 3000 面=skip_lag 组合档）。红⑧ spec §3 C2「skip_lag
 *  分层兜底」三件：①组合档（当轮 skip-lag 增量 ∧ yjs_oldest_unflushed_age_seconds>30s → 即时 P0
 *  ——flush 链卡死已可观测不待持续窗）；②持续档（skip-lag 连续 3 轮 → P0——THRESHOLDS counter-delta
 *  rounds:3 通用循环承载，载体=counter+rounds〔worker tick 级连续不可观测，巡检每 5min 轮级承接「连续 3」〕）；
 *  ③wal 高位档（wal_pending_bytes 持续 2 轮 → P1——THRESHOLDS 通用循环承载）。 */
export const CANARY_CHECKS = {
  lastCheckGauge: 'collab_canary_last_check_age',   // worker 3002（verify worker 每 tick 维护）
  lastCheckP1Sec: 86_400,    // >24h=覆盖 SLO 破 P1（charter「全局每小时+每活跃项目 ≤24h」）
  freezeCounter: 'collab_canary_freeze_total',      // worker 3002（freeze 实弹 P0——人工解冻 ack）
  skipLagCounter: 'collab_canary_poll_tick_total',  // api 3000（labels result=skip-lag）
  skipLagLabel: { result: 'skip-lag' },
  skipLagRounds: 3,          // spec §3 C2「skip_lag 连续 3→P0」（轮级——与 THRESHOLDS rounds 单源）
  unflushedGauge: 'yjs_oldest_unflushed_age_seconds', // api 3000（组合档第二判据——T14 既有 P1@120s 条目不动）
  unflushedP0Seconds: 30,    // skip_lag 在场时 >30s=flush 链卡死（正常链≈8s）即时升级
};

/* P2-a/b（spec 评审裁定）：spec §3 C2 承 v4「doc_pg_lag_seq 年龄 P0」由本组合档承载（更准的年龄
 * 口径——unflushed 窗口=doc_pg_lag_seq 的上游信号且直接观测「帧已 apply 未提交 PG」的滞留年龄）：
 * **doc_pg_lag_seq 年龄 P0 承接=本组合档**（skip-lag 并发时 unflushed>30s 即时 P0——canary 捕获
 * 盲区∧落定链卡死双证据在场）；独立年龄卡死=T14 既有 yjs_oldest_unflushed_age_seconds P1@120s
 * 兜底（30s 独立 P0 不采——正常链≈8s，独立 30s 阈=瞬态批延迟噪声面）；doc_pg_lag_seq 独立条目
 * 不另立（同源信号双计）。C2-4 requirement 文本修订时按组合读法写（归 C2-4）。 */

/** not-serving 持续>1min → P0（/api/ready reason 面——非指标驱动，同模块单源）。 */
export const NOT_SERVING_P0_MS = 60_000;

/** SMS per-check 节流窗（新 P0 不被旧 P0 吞——每 check 键独立计时）。 */
export const SMS_THROTTLE_MS = 15 * 60_000;

/** 心跳外层判据（runbook：heartbeat 文件停更>15min=P0——脚本无法自证自身/整机死亡）。 */
export const HEARTBEAT_STALE_MS = 15 * 60_000;
