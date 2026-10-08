/** Y0a-3（spec v2.5 §3.3）：/api/ready 响应契约——reason 字面量封闭枚举（tsc 即门，禁通配）；
 *  由 collabState 主导派生（SV7）；holder/epoch/pending 为并列取证字段禁入 reason；epoch=string
 *  （JSON.stringify(bigint) 抛 TypeError）；redis 仅报不 gating。forceTakeover 已随 FORCE env 删除（SV2）。 */
export const COLLAB_READY_REASONS = [
  'pg-down', 'draining', 'lease-error', 'lease-lost', 'not-serving',
  'lease-held', 'lease-not-acquired', 'spool-unwritable',
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
}
