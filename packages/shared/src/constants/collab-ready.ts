/** Y0a-3（spec v2.5 §3.3）：/api/ready 响应契约——reason 字面量封闭枚举（tsc 即门，禁通配）；
 *  由 collabState 主导派生（SV7）；holder/epoch/pending 为并列取证字段禁入 reason；epoch=string
 *  （JSON.stringify(bigint) 抛 TypeError）；redis 仅报不 gating。forceTakeover 已随 FORCE env 删除（SV2）。
 *  Y0b-5 T16：追加 db-unavailable（PG 熔断 open 档——SELECT 1 可达但熔断窗内准入拒；
 *  文案≡auth 面瞬态档词表，冷却 10s+半开探测自愈，误开窗口有界）。 */
export const COLLAB_READY_REASONS = [
  'pg-down', 'draining', 'lease-error', 'lease-lost', 'not-serving',
  'lease-held', 'lease-not-acquired', 'spool-unwritable',
  'db-unavailable',
] as const;
export type CollabReadyReason = (typeof COLLAB_READY_REASONS)[number];

export interface CollabReadyPending {
  projects: number;     // pending 队列非空项目数（Y5 键名——gateway.computePending 同源）
  batches: number;      // update 条数（非合并后批数——与 storeInFlight 不同量纲）
  spoolFiles: number;   // own 口径（drainable——部署门判据，P16）
  spoolBytes: number;
  storeInFlight: number;   // W10：部署门"四零"假绿消除（X2 集合 size）
  strandedFiles: number;   // 外来段（磁盘真值部分——只 WARNING 不阻塞，SV4）
  strandedBytes: number;
}

export interface CollabReadyResponse {
  ready: boolean;
  reason?: CollabReadyReason;
  holder?: string;
  epoch?: string;
  holderRenewedAgoMs?: number;   // 值班判"它还活着吗"（Z19 renewedAt 派生）
  redis: 'up' | 'down';
  pending: CollabReadyPending;
  spoolQuarantined?: number;
  loadedDocs?: number;     // Y0a-4/N16：容量观测（在飞 Y.Doc 数）——pending 的兄弟字段，禁进 pending 对象
  connections?: number;    // Y0a-4/N16：collab 连接数（server.getConnectionsCount() 口径）——同上
  /** Y0b-5 T14（E54⑤）：degraded 块——token 档独有（公开五键档裁剪）；观测非门禁（ready 布尔
   *  不因此翻转）。四键与指标面同源，T15 巡检按此设阈值。 */
  degraded?: CollabReadyDegraded;
  /** Y0b-3 T5（P-C）：服务端线路协议版本——客户端版本终态（schema-outdated）时单次探测拿它作
   *  loop 键（authenticationFailed payload 仅 {reason} 无版本通道）。恒带：base 对象单点——
   *  200 与 503（pg-down/reason）三分支同发。 */
  collabProtocolVersion: number;
}

/** Y0b-5 T14（E54⑤）：/api/ready token 档 degraded 四键——与指标面同源：
 *  dirtyDocs=yjs_pending_projects（computePending().projects）；
 *  oldestUnflushedAt/oldestUnflushedAgeSeconds=yjs_oldest_unflushed_age_seconds（at ISO+age 秒
 *  双给——T15 巡检阈值消费形态；无未 flush 时 null/0）；
 *  spoolDepthBytes=yjs_spool_depth_bytes（total=own+stranded 容量核算口径）；
 *  stuckDocs=yjs_doc_stuck_total（同增点进程寿命累计——巡检用增量语义）。 */
export interface CollabReadyDegraded {
  dirtyDocs: number;
  oldestUnflushedAt: string | null;
  oldestUnflushedAgeSeconds: number;
  spoolDepthBytes: number;
  stuckDocs: number;
}
