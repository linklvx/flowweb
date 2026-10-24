// packages/shared/src/collab/doc-protocol.ts
// Y1c T5a（plan v1.7 Task 5 载体/协议段——spec v5.4 §3.2/§4.1-§4.4/§5/§8.1）：协议契约冻结。
// **CONTRACT-FREEZE**——类型+常量+纯函数；零生产行为变更（消费方=T8 WAL/T9 actor/T10 barrier/T13 恢复）。
// 单源纪律：数字一律自既有常量派生（QUOTA_DEFAULTS/FRAME_ALLOWANCE_BYTES/CollabCloseCode/
// CLIENT_PROTOCOL_VERSION/CANVAS_DOC_SCHEMA_VERSION——禁第二字面量真源）；全新数字（9MiB/800ms/5s/250ms/
// 24h/100k/20ms/1MiB）本文件即唯一真源。DDL 契约（walCheckpointSeq 列改名）在此以类型+注释冻结，
// 实际 migration 归 T7/T21。契约测试=doc-protocol.spec.ts（TDD 红先行）。
import * as Y from 'yjs';
import { QUOTA_DEFAULTS, FRAME_ALLOWANCE_BYTES } from '../constants/collab-quota';
import { CollabCloseCode } from '../constants/collab-close-code';
import { CLIENT_PROTOCOL_VERSION } from '../constants/collab-protocol';
import { CANVAS_DOC_SCHEMA_VERSION } from '../canvas/docShape';

// ═══ §1 水位拆义（偏离 38⑥）════════════════════════════════════════════════════════════

/** 内存水位三元（spec §5.1——walSeq=帧身份序号，另见 VERSION_DIMENSIONS）。
 *  不变量 0≤pgSeq≤appliedSeq≤spoolHeadSeq（**永不与持久列比较**）：
 *  - spoolHeadSeq：最后一个 fsync 成功帧的 walSeq（内存+WAL 段 manifest）
 *  - appliedSeq：最后 apply 成功且完全整合（无 pending）的 walSeq（内存/批级；重启由 WAL+pgSeq 前缀校验重建）
 *  - pgSeq：最后 PG 提交的 walSeq（CanvasDoc 持久列）——对外唯一「已保存」水位 */
export interface WatermarkTriple {
  pgSeq: bigint;
  appliedSeq: bigint;
  spoolHeadSeq: bigint;
}

/** 水位三元不变量断言（纯函数——违反即 throw；T9 actor/T10/T13 每次推进后调用）。 */
export function assertWatermarkInvariants(w: WatermarkTriple): void {
  if (w.pgSeq < 0n) throw new Error(`watermark: pgSeq(${w.pgSeq})<0`);
  if (w.pgSeq > w.appliedSeq) throw new Error(`watermark: pgSeq(${w.pgSeq})>appliedSeq(${w.appliedSeq})`);
  if (w.appliedSeq > w.spoolHeadSeq) throw new Error(`watermark: appliedSeq(${w.appliedSeq})>spoolHeadSeq(${w.spoolHeadSeq})`);
}

/** CanvasDoc 持久列改名（v5.4⑥ 拆义——DDL 契约，migration 归 T7/T21）：
 *  `walCheckpointSeq` = **批提交时刻 spoolHeadSeq 采样**（随 PG 批同批更新非每帧写）；
 *  同行 CHECK pgSeq≤walCheckpointSeq——**永不与 appliedSeq 比较**；恢复以 WAL 扫描为准、列只作快路径。
 *  跨表不变量 `Snapshot.stateSeq≤pgSeq` **非 CHECK**——由快照发布事务内行锁+条件更新保证（§4.5，偏离 26 v5.2）。 */
export const WAL_CHECKPOINT_COLUMN_NAME = 'walCheckpointSeq' as const;

// ═══ §2 apply 归属/准入链（偏离 37①+38③）═══════════════════════════════════════════════

/** CollabProjectActor（per-project 单例）准入链 ⓪-⑤——次序冻结（§3.2/§4.1；lib0 越界读/pending 私有面
 *  等背景见 spec §1.9）。⓪写权限态短路**最先**（库 readOnly 检查在 beforeSync 之后 esm:264-276，
 *  gate 先 apply 则 VIEWER 帧已入 doc——F-5）。 */
export const APPLY_ADMISSION_STAGES = [
  /** ⓪ readOnly/writeFreeze/quota——短路最先（VIEWER 发 Update→doc 不变） */
  'write-state-shortcircuit',
  /** ① 会话身份/项目权限/generation（每帧对照当前世代权威——DB 或同步失效缓存，非连接建立时缓存）/帧格式
   *  →解码+结构/字段权限/预算（maxStructs/maxDsRanges/maxFrameBytes——解压后大小限） */
  'frame-local-validation',
  /** ② pending 区间预检（analyzePendingIntervals——缺前驱/区间有洞→4412 零 WAL 零 apply 零 ACK） */
  'pending-interval-precheck',
  /** ③ 帧字节精确 copy 至独立 buffer（禁 subarray 共享）+SHA-256 去重（promise map——去重后才分配 walSeq；
   *  命中 inflight 须 await 原帧 fsync+apply 完成才放行；命中 applied=no-op 确认） */
  'dedupe-sha256',
  /** ④ 批量追加 WAL+一次 fsync（批窗三条件收批——F-S4-3；新段含目录 fsync） */
  'spool-fsync',
  /** ⑤ actor 内 pre-apply（origin=GateApplyOrigin）→appliedSeq=walSeq→Hocuspocus 幂等重放
   *  （yjs.cjs:3385-3390 零 update 事件）→恰一次 SyncStatus(true)；gate 抛错→close 4411 无 SyncStatus(true) */
  'apply',
] as const;
export type ApplyAdmissionStage = typeof APPLY_ADMISSION_STAGES[number];

/** gate pre-apply 的 apply origin（§4.1⑤——isTransactionOrigin 判过 {source:'connection'} 形）。
 *  connection=库 Connection 实例（shared 仅 @hocuspocus/common 依赖——结构占位 unknown，T9 侧窄化）。 */
export interface GateApplyOrigin {
  source: 'connection';
  connection: unknown;
  gate: true;
}

export function isGateApplyOrigin(o: unknown): o is GateApplyOrigin {
  return typeof o === 'object' && o !== null
    && (o as { source?: unknown }).source === 'connection'
    && 'connection' in o
    && (o as { gate?: unknown }).gate === true;
}

/** actor drain 批数字（§4.1/T0-S4 §1 装置）：≤20ms 批窗（**上界非 dwell**——自最老帧起算）∨ ≤1MiB ∨ 空闲 1ms 即收
 *  ——三条件任一满足即收批（F-S4-3：dwell 语义会使每帧时延恒 ≥20ms 违反预算 by construction）。 */
export const ACTOR_DRAIN_BATCH_MAX_MS = 20 as const;
export const ACTOR_DRAIN_BATCH_MAX_BYTES = 1_048_576 as const;   // 1MiB
export const ACTOR_DRAIN_IDLE_COLLECT_MS = 1 as const;

/** 毒帧协议（WAL fsync 成功+apply 失败——§4.3 状态机首行）：次序冻结。
 *  「同步关闭该项目全部连接须在 setImmediate 广播 flush 之前完成」（坏帧不漏给其他在线端）随 close-4411 档执行；
 *  截断后 spooled 未 applied 的帧随 4411 重同步恢复（Spooled≠Durable 诚实语义）。 */
export const POISON_FRAME_PROTOCOL = [
  'isolate-doc',              // 隔离当前文档、停止后续可见写入
  'stop-visible-writes',
  'truncate-wal-to-appliedSeq',  // WAL 截断至 appliedSeq——不得跳过毒帧继续提交后续序号
  'close-4411',               // close CollabCloseCode.FRAME_MALFORMED（码权威投递=webSocket.close 先行——F-2）
  'replay-from-pgSeq',        // 从 pgSeq 重放
] as const;

/** WAL fsync 失败分档（§4.3 v5.4⑱）：写前失败/ENOSPC=可恢复档（截断回 last-good offset+**复用已分配未落盘
 *  walSeq 不留洞**+fail-closed 停收；截断本身失败=quarantine 段+拒服务）；EIO=fail-stop 不可恢复
 *  （walHealthy=false/停收帧/close 全部连接 1011/标记隔离/要求进程重启+磁盘检查——不进截断复用路径；
 *  `wal_fsync_error_total{device}` 告警不自动重试）。 */
export type WalFsyncFailureTier = 'fsync-fail-pre' | 'ENOSPC' | 'EIO';

export interface WalFsyncTierSemantics {
  recoverable: boolean;
  action: 'truncate-reuse-seq' | 'fail-stop';
  /** EIO 档关全部连接的 close 码（WS 1011 internal error——同码异 reason，见 collab-close-code WAL_FSYNC_EIO） */
  closeCode?: number;
  detail: string;
}

export const WAL_FSYNC_TIER_SEMANTICS: Readonly<Record<WalFsyncFailureTier, WalFsyncTierSemantics>> = {
  'fsync-fail-pre': {
    recoverable: true, action: 'truncate-reuse-seq',
    detail: '写前失败：截断回 last-good offset+复用已分配未落盘 walSeq（不留洞）+fail-closed 停收；截断失败=quarantine 段+拒服务',
  },
  ENOSPC: {
    recoverable: true, action: 'truncate-reuse-seq',
    detail: '磁盘满：同写前失败档——截断复用 seq+fail-closed 停收（不自动清他人段）',
  },
  EIO: {
    recoverable: false, action: 'fail-stop', closeCode: CollabCloseCode.WAL_FSYNC_EIO,
    detail: 'EIO=fail-stop 不可恢复：walHealthy=false/停收帧/close 全部连接 1011/标记隔离/要求进程重启+磁盘检查——不进截断复用路径',
  },
};

/** doc 卸载纪律（§4.3 v5.4 修正钩子名）：钩子名=**beforeUnloadDocument**（throw=拒绝卸载；无 onUnloadDocument）。
 *  必须 drain applied→PG 或**拒绝卸载**（applied>pg 时不许静默卸载丢前缀；PG 不可用=doc 常驻/fail-closed）；
 *  LRU 触发卸载按此纪律；per-project 互斥/spool 队列/去重 hash 按 (projectId,generation) 随卸载清理。 */
export const BEFORE_UNLOAD_DRAIN_CONTRACT = {
  hook: 'beforeUnloadDocument',
  discipline: 'drain-applied-to-pg-or-refuse-unload',
  refuseWhen: 'appliedSeq>pgSeq || PG 不可用（doc 常驻 fail-closed）',
  cleanupKey: '(projectId,generation)',
} as const;

/** maxResidentDocBytes 全局驻留上界契约（§4.3 v5.4）：到顶后新项目 onLoad 503/4413 **fail-closed 不 OOM**
 *  +`doc_unload_blocked_total` 指标。数值真源=apps/api collab-residency.service.ts DEFAULT_MAX_RESIDENT_BYTES
 *  （env COLLAB_MAX_RESIDENT_BYTES 可覆写）——spec「如 2GB」为示例非冻结值；T10 将该消费点接本契约（禁双数值真源）。 */
export const MAX_RESIDENT_DOC_BYTES_CONTRACT = {
  onLimitExceeded: 'reject-new-loads-503-4413',
  metric: 'doc_unload_blocked_total',
  numericSource: 'apps/api/src/modules/collab/collab-residency.service.ts DEFAULT_MAX_RESIDENT_BYTES',
} as const;

// ═══ §3 pending 区间法（v5.4 检查前移 §3.2——apply 后断言无效：pending 已入私有 store 无公开移除）═════════

/** 单 client 连续时钟区间 [start,end)（半开——end=下一区间起点语义下的排他端）。 */
export interface ClientClockInterval { client: number; start: number; end: number }

/** pending 区间预检裁定（§3.2/§4.3）：
 *  - self-contained：各 client 区间起点 clock≤SV 且区间内部连续（覆盖自包含——SS2 合法放行
 *    **即使 max clock>SV**；**禁 max-clock 单值判断**）
 *  - missing-predecessor：起点 clock>SV（缺前驱）或区间内部有洞→4412 零 WAL 零 apply 零 ACK doc 不变；
 *    预检通过后 apply 仍现 pending（理论不应发生）=毒帧 4411 路径。
 *  intervals=各 client 合并排序后的连续区间（self-contained 时回传供审计）。 */
export type PendingIntervalAnalysis =
  | { kind: 'self-contained'; intervals: ClientClockInterval[] }
  | {
      kind: 'missing-predecessor';
      client: number;
      reason: 'start-after-sv' | 'hole';
      /** 帧内该 client 首区间起点（start-after-sv 档） */
      startClock: number;
      /** 接收端 SV 中该 client 的 clock（client 不在 SV 即 0——新 client 必须自 clock 0 起） */
      svClock: number;
      /** hole 档的洞区间（Skip struct 或合并后计算缺口——半开 [from,to)） */
      hole?: { from: number; to: number };
    };

/** pending 区间预检（纯函数——准入链 ② 消费；入参须已过 ① 解码验证，decode 异常由调用方归 4411 毒帧面）。
 *  算法：Y.decodeUpdate 取各 client struct（Item/GC 计入覆盖；Skip=显式洞标记——mergeUpdates 挖洞形态）
 *  →按 client 合并排序区间 →首区间 start>SV[c]（c 不在 SV 即 0）=缺前驱；区间间缺口或 Skip=区间有洞
 *  （**无条件拒**——预检先于 apply，fail-closed 方向）。双层校验：CRC 管损坏、hash 管身份（§4.4）——
 *  本函数只管区间覆盖，不做内容校验。 */
export function analyzePendingIntervals(update: Uint8Array, stateVector: Uint8Array): PendingIntervalAnalysis {
  const sv = Y.decodeStateVector(stateVector);                          // Map<client, clock>
  const { structs } = Y.decodeUpdate(update);                            // Array<Item|GC|Skip>
  const byClient = new Map<number, Array<{ start: number; end: number; isSkip: boolean }>>();
  for (const s of structs) {
    const list = byClient.get(s.id.client) ?? [];
    list.push({ start: s.id.clock, end: s.id.clock + s.length, isSkip: s instanceof Y.Skip });
    byClient.set(s.id.client, list);
  }
  const merged: ClientClockInterval[] = [];
  for (const [client, raw] of byClient) {
    raw.sort((a, b) => a.start - b.start);
    const svClock = sv.get(client) ?? 0;                                 // 不在 SV=接收端从未见过该 client——等效 clock 0
    const first = raw[0];
    if (first.start > svClock) {                                         // 缺前驱：帧起点晚于接收端已知前缀
      return { kind: 'missing-predecessor', client, reason: 'start-after-sv', startClock: first.start, svClock };
    }
    if (first.isSkip) {                                                  // 首 struct 即 Skip（洞在帧首）
      return { kind: 'missing-predecessor', client, reason: 'hole', startClock: first.start, svClock,
        hole: { from: first.start, to: first.end } };
    }
    let end = first.end;
    for (let i = 1; i < raw.length; i++) {                               // 区间连续性：Skip 标记或计算缺口=洞
      const cur = raw[i];
      if (cur.isSkip) {                                                  // Skip 前另有缺口时缺口并入洞区间
        return { kind: 'missing-predecessor', client, reason: 'hole', startClock: first.start, svClock,
          hole: { from: Math.min(end, cur.start), to: cur.end } };
      }
      if (cur.start > end) {
        return { kind: 'missing-predecessor', client, reason: 'hole', startClock: first.start, svClock,
          hole: { from: end, to: cur.start } };
      }
      end = Math.max(end, cur.end);
    }
    merged.push({ client, start: first.start, end });
  }
  return { kind: 'self-contained', intervals: merged };
}

// ═══ §4 save barrier（偏离 37⑦+38⑳——§4.2 v5.3 钉死+v5.4 节流）═════════════════════════

/** barrier 请求（onStateless 载体——wire payload）。clientSeq=客户端每次本地编辑自增、服务端原样回显；
 *  **配 tabId/sessionEpoch**（clientSeq 在 reload 后重置，回执按同 session 比较）；断线新 nonce；
 *  barrier 语义=**per-tab**（只覆盖本连接此前帧）。 */
export interface BarrierRequest {
  nonce: string;
  clientSeq: number;
  tabId: string;
  sessionEpoch: number;
}

/** barrier 成功回执（handler 内**显式 connection.sendStateless**——onStateless 返回值被库丢弃 esm:219-224）。
 *  committedSeq=pgSeq（BigInt 入 wire payload 显式 String()——§5.2）；UI 判 Durable=
 *  resp.clientSeq>=lastLocalEditSeq && resp.committedSeq。 */
export interface BarrierReceipt {
  nonce: string;
  clientSeq: number;
  committedSeq: string;
}

/** barrier 错误回执（handler **永不 throw**——catch 后回执；按 nonce 幂等：重试同结果；
 *  maintenance freeze 期回 maintenance 档不产生 Durable；拒帧连接屏障不可成功）。 */
export interface BarrierErrorReceipt {
  nonce: string;
  error: 'BARRIER_FAILED' | 'maintenance';
  committedSeq: string;
}

/** 触发数字冻结（§4.2）：最后编辑后 800ms idle / 持续 dirty 最长 5s 一次 / pagehide+visibilitychange:hidden
 *  立发 / 执行前 await ensureDurable / 重连同步完成后重发；失败退避 1s/2s/5s/10s；
 *  服务端项目级 flush 节流 ≤250ms；durable watermark 广播 ≤1 次/秒（仅辅助显示与观测，不替代 barrier）。 */
export const SAVE_BARRIER_IDLE_TRIGGER_MS = 800 as const;
export const SAVE_BARRIER_MAX_DIRTY_INTERVAL_MS = 5_000 as const;
export const SAVE_BARRIER_FLUSH_THROTTLE_MS = 250 as const;
export const DURABLE_WATERMARK_BROADCAST_MIN_INTERVAL_MS = 1_000 as const;
export const SAVE_BARRIER_BACKOFF_STEPS_MS = [1_000, 2_000, 5_000, 10_000] as const;

/** flushThrough(target) 契约（§4.2 v5.4）：幂等（同 target 重复调用同结果）/有界等待（≤250ms 节流合并——
 *  barrier 只承诺「目标前缀已提交」不承诺「立刻新建 PG 事务」）/不阻塞写入（drain 照常）/返回当前 pgSeq。
 *  target=handler 首语句**同步捕获的 appliedSeq**（任何 await 之前——捕 pgSeq 会少报已 apply 未落 PG 的帧，
 *  捕 walSeq 会误等他连接在飞帧）。T10 实现。 */
export interface FlushThroughResult {
  pgSeq: bigint;
  targetReached: boolean;
}

/** durable watermark 广播（PG 批提交后 per-project ≤1 次/秒 broadcastStateless——仅辅助显示与观测）。 */
export interface DurableWatermarkBroadcast {
  type: 'durable';
  pgSeq: string;   // BigInt 显式 String()
}

// ═══ §5 WAL 帧协议+段头（偏离 38④⑦——T0-S4 §5 格式决策复用，禁发明第二格式）═══════════════

/** 段头 8B magic："FlowWeb WAL Segment v1"（latin1——与 spike 原型逐字节一致）。 */
export const WAL_SEGMENT_MAGIC = 'FWWALS1\n' as const;
export const WAL_SEGMENT_VERSION = 1 as const;
/** 段头固定 164B（LE）——lastWriteAt 成对更新段头 CRC（F-S4-6：只 pwrite 时间戳不更新 CRC=自毁段头）。 */
export const WAL_SEGMENT_HEADER_SIZE = 164 as const;
/** projectId/historyId utf8 zero-pad 定长域（单读定界，超长拒绝）。 */
export const WAL_ID_FIELD_BYTES = 64 as const;

export const WAL_SEGMENT_HEADER_LAYOUT = {
  magic: { offset: 0, size: 8 },
  version: { offset: 8, size: 2 },          // u16
  headerSize: { offset: 10, size: 2 },      // u16=164
  generation: { offset: 12, size: 4 },      // u32
  projectId: { offset: 16, size: 64 },
  historyId: { offset: 80, size: 64 },      // SystemHistory String 值直存
  createdAtMs: { offset: 144, size: 8 },    // u64
  lastWriteAtMs: { offset: 152, size: 8 },  // u64 可变域——pwrite 须与 headerCrc32 成对
  headerCrc32: { offset: 160, size: 4 },    // crc32 覆盖 [0,160)
} as const;

/** 段头逻辑域（{magic,version,projectId,generation,historyId,lastWriteAt,createdAt}——字节布局见上）。
 *  historyId=SystemHistory 全局单行唯一权威（删 CanvasDoc.historyId 列——restore 恒整库恢复）；
 *  换代（含 vacuum）=WAL 段 namespace 切代+旧段 quarantine+水位重置（spoolHeadSeq/pgSeq/snapshotRev/purgeBelowSeq）。 */
export interface WalSegmentHeader {
  projectId: string;
  generation: number;
  historyId: string;
  createdAtMs: number;
  lastWriteAtMs: number;
}

/** 帧记录固定 52B 头+载荷：`payloadLen u32 | crc32 u32 | walSeq u64 | generation u32 | frameHash 32B(SHA-256) | payload`。
 *  CRC 覆盖域含帧头字段（walSeq‖generation‖frameHash‖payload）——帧头撕裂同样落 CRC 网；
 *  CRC 管损坏、hash 管身份（双层不混）。帧内**一律携带 generation**（换代混段检测）。 */
export const WAL_FRAME_FIXED_BYTES = 52 as const;
export const WAL_FRAME_LAYOUT = {
  payloadLen: { offset: 0, size: 4 },
  crc32: { offset: 4, size: 4 },
  walSeq: { offset: 8, size: 8 },           // u64——BigInt 语义
  generation: { offset: 16, size: 4 },
  frameHash: { offset: 20, size: 32 },      // SHA-256(payload)
  payload: { offset: 52 },                  // size=payloadLen
} as const;

/** 帧记录逻辑域（T8 编码器自 payload 计算 frameHash/crc32——此形状为解码后语义）。 */
export interface WalFrameRecord {
  walSeq: bigint;
  generation: number;
  frameHash: Uint8Array;
  payloadLen: number;
  crc32: number;
}

/** 坏段四档（T8 恢复扫描告警/处置分档）。帧级 granular 缺陷码→四档映射见 walDefectTier；
 *  段级 quarantine（bad-header/history-mismatch/timestamp-fence）独立于四档（整段 fail-closed 不重放）。 */
export type WalBadSegmentTier = 'bad-crc' | 'truncated' | 'missing-seq' | 'dup-hash';

/** 帧级 granular 缺陷码（T0-S4 §5「四档对齐+扩展」的扩展层——扫描器分类码全集）。 */
export type WalDefectKind =
  | 'truncated' | 'bad-crc' | 'hash-mismatch' | 'generation-mismatch'
  | 'gap' | 'dup-seq' | 'dup-hash';

/** granular 缺陷码→坏段四档（纯映射——T8 告警面消费；穷尽 switch 无 default：新增码未映射即编译红）。 */
export function walDefectTier(kind: WalDefectKind): WalBadSegmentTier {
  switch (kind) {
    case 'truncated': return 'truncated';
    case 'bad-crc': return 'bad-crc';            // CRC/校验类损坏（含骗过 CRC 网的 hash/generation 校验失败）
    case 'hash-mismatch': return 'bad-crc';
    case 'generation-mismatch': return 'bad-crc';
    case 'gap': return 'missing-seq';            // 缺号
    case 'dup-seq': return 'dup-hash';           // 旧 seq 同 hash 重放（良性去重）
    case 'dup-hash': return 'dup-hash';          // 新 seq 旧 hash（跳过并消费 seq）
  }
}

/** 段级 quarantine 原因（整段隔离零帧重放 fail-closed——§4.4）。 */
export type WalQuarantineReason = 'bad-header' | 'history-mismatch' | 'timestamp-fence';

/** SystemHistory 全局单行权威（v5.4⑦——删 CanvasDoc.historyId 列；bump=单事务更新 SystemHistory
 *  〔+trigger 同步缓存〕提交后才允许启动；启动任一不匹配 fail-closed 不自动修复）。 */
export interface SystemHistoryState {
  historyId: string;
  epochStartedAtMs: number;
}

/** 恢复扫描双 quarantine 栅栏（§4.4/T13 恢复顺序第一步）：
 *  - historyId≠SystemHistory → 整段 quarantine（防恢复后 WAL 回放复活已回滚内容——本仓备份=pg_dump 恢复实证）
 *  - lastWriteAt>epochStartedAt（忘 bump 形态——段比 epoch 新）→ 整段 quarantine+RESTORED_READONLY
 *    （同机时钟偏移可接受——fail-closed 方向正确）+备份工具 restore.lock marker 双保险
 *  **时间戳栅栏求值作用域（F-S4-5 契约级收窄——T8/T13 必须按此实现）**：仅在**恢复怀疑态**求值
 *  （restore.lock marker 在位 或 PG pgSeq 水位倒挂于 WAL 段）——长命 epoch 下全部在役段恒满足
 *  lastWriteAt>epochStartedAt，每次恢复都求值会把正常崩溃恢复隔离成空 WAL；historyId 栅栏每次恢复先查。
 *  `--adopt-wal` 窄窗：仅 historyId 已匹配+operator 显式确认+审计（三条件缺一不可——不自动修复）。 */
export type WalSegmentQuarantineResult =
  | { quarantined: false }
  | { quarantined: true; reason: 'history-mismatch' | 'timestamp-fence' };

export function shouldQuarantineSegment(
  header: Pick<WalSegmentHeader, 'historyId' | 'lastWriteAtMs'>,
  systemHistory: SystemHistoryState,
  opts?: { evaluateTimestampFence?: boolean },   // 缺省 true=谓词本身；调用方按 F-S4-5 作用域门控
): WalSegmentQuarantineResult {
  if (header.historyId !== systemHistory.historyId) {
    return { quarantined: true, reason: 'history-mismatch' };
  }
  if (opts?.evaluateTimestampFence !== false && header.lastWriteAtMs > systemHistory.epochStartedAtMs) {
    return { quarantined: true, reason: 'timestamp-fence' };
  }
  return { quarantined: false };
}

/** SHA-256 去重启动重建有界索引（偏离 38④——跨重启「零重复 walSeq」成立）：帧记录存 frameHash+
 *  启动重建有界索引（24h TTL/100k 条上界——时窗与条数双界防无界内存）。去重先于 walSeq 分配（§3.2）。 */
export const WAL_DEDUP_INDEX_TTL_MS = 86_400_000 as const;   // 24h=24*60*60*1000（字面量直书以配 as const——邻行同风格）
export const WAL_DEDUP_INDEX_MAX_ENTRIES = 100_000 as const;

// ═══ §6 ACK 三档+UI 四态+版本门拆分（偏离 38⑧）═════════════════════════════════════════

/** ACK 三档（§4.2——ACK 与承诺的持久等级**严格一致**；spool-first≠先 ACK 后验证——准入先于一切）。 */
export type AckTier = 'Applied' | 'Spooled' | 'Durable';

export const ACK_TIER_SEMANTICS: Readonly<Record<AckTier, string>> = {
  Spooled: '帧已在 WAL fsync（未 apply）——Spooled=客户端本地瞬态，无 wire 消息',
  Applied: '已 apply+已 fsync（SyncStatus(true)=applied+fsync 诚实档——重复帧命中去重表必须 await 原帧完成才放行）',
  Durable: 'PG 已提交（pgSeq 可验证回执——barrier/watermark；不因 WebSocket 连接或 SyncStatus 自动显示）',
};

/** UI 四态（§4.2）。Durable 必须对应可验证 pgSeq 回执——判据=resp.clientSeq>=lastLocalEditSeq && resp.committedSeq。 */
export type SaveUiState = 'local' | 'spooled' | 'applied' | 'durable';

export const SAVE_UI_STATE_LABELS: Readonly<Record<SaveUiState, string>> = {
  local: '编辑中',
  spooled: '已接收正在保存',
  applied: '已同步等待数据库提交',
  durable: '已保存',
};

export interface SaveUiStatusInput {
  /** 客户端观测同步面：local=有未发送编辑 / spooled=已发送未收 SyncStatus(true)（本地瞬态）/ applied=已收 SyncStatus(true) */
  syncPhase: 'local' | 'spooled' | 'applied';
  /** 本 tab 最后一次本地编辑的 clientSeq（clientSeq 在 reload 后重置——配 tabId/sessionEpoch 按 session 比较） */
  lastLocalEditSeq: number;
  /** 最近一次 barrier 回执（per-tab——只覆盖本连接此前帧；null=尚无回执，永不判 Durable） */
  receipt: BarrierReceipt | null;
}

/** UI 四态纯映射（T10 web 消费）：回执 clientSeq≥lastLocalEditSeq → durable（唯一路径——不因 WS/SyncStatus
 *  自动显示）；否则随 syncPhase（回执落后于新编辑即回退——新编辑推进 lastLocalEditSeq 使旧回执失效）。 */
export function resolveSaveUiState(i: SaveUiStatusInput): SaveUiState {
  if (i.receipt != null && i.receipt.clientSeq >= i.lastLocalEditSeq) return 'durable';
  return i.syncPhase;
}

/** 版本门硬三元（§3.2 v5.4⑧拆分）：protocolVersion+schemaVersion+historyId=**硬门**（缺失/不匹配
 *  =4406 client-outdated+客户端强刷）；**build hash 仅遥测/错误上报**（每次 hotfix 不强刷全员）。 */
export interface VersionGateHardTriple {
  protocolVersion: number;
  schemaVersion: number;
  historyId: string;
}

/** 服务端版本门基准（protocolVersion/schemaVersion 与既有单源常量对齐——historyId=运行时 SystemHistory 值，
 *  调用方补全）。注：4.6.0 onAuthenticatePayload.providerVersion 为库内部硬编码值——禁用（P6 勘误）。 */
export const VERSION_GATE_SERVER_BASE = {
  protocolVersion: CLIENT_PROTOCOL_VERSION,
  schemaVersion: CANVAS_DOC_SCHEMA_VERSION,
} as const;

export type VersionGateVerdict = 'allow' | 'client-outdated';

/** 版本门判定（纯函数——运行时=字面量精确比较，无区间协商）：三元任一缺失/不匹配（含高于服务端——
 *  reload 无效档）→ client-outdated。 */
export function resolveVersionGate(
  client: Partial<VersionGateHardTriple> | undefined,
  server: VersionGateHardTriple,
): VersionGateVerdict {
  if (client == null) return 'client-outdated';
  return client.protocolVersion === server.protocolVersion
    && client.schemaVersion === server.schemaVersion
    && client.historyId === server.historyId
    ? 'allow' : 'client-outdated';
}

/** Y1c 码 close 载荷（§8.1——码值自 collab-close-code 单源；reason 字面量常量同源文件）：
 *  - 4410 三分：doc-generation-stale（主动换代）/doc-vacuuming（换代通道+discardLocalCache:true）/
 *    server-restored（g_client>g_server 或 historyId 不匹配——不清缓存，只读 recovery+草稿导出+管理员裁定）
 *  - 4411=REJECTED/RESYNC（毒帧/apply 失败）；4412=resync-required（pending 区间拒绝）；
 *    4413=maintenance-freeze（Retry-After 可重试——载荷带 retryAfterMs）；
 *    4406=client-outdated（载荷带服务端硬门三元——客户端强刷后对齐）。 */
export type CollabY1cClosePayload =
  | { code: typeof CollabCloseCode.GENERATION_SUPERSEDED; reason: 'doc-generation-stale' | 'doc-vacuuming' | 'server-restored'; generation?: number; discardLocalCache?: boolean }
  | { code: typeof CollabCloseCode.FRAME_MALFORMED; reason: 'frame-malformed' }
  | { code: typeof CollabCloseCode.RESYNC_REQUIRED; reason: 'resync-required' }
  | { code: typeof CollabCloseCode.MAINTENANCE_FREEZE; reason: 'maintenance-freeze'; retryAfterMs: number }
  | { code: typeof CollabCloseCode.CLIENT_OUTDATED; reason: 'client-outdated'; gate: VersionGateHardTriple };

// ═══ §7 帧闸数字（单源派生——§3.2 v5.4⑱）═══════════════════════════════════════════════

/** 普通帧闸=2×maxTxBytes（collab-limits.ts deriveCollabLimits().updateFrameGate 同式——QUOTA_DEFAULTS
 *  单源；spec 旧文 1MiB 作废）。 */
export const NORMAL_FRAME_GATE_BYTES = 2 * QUOTA_DEFAULTS.maxTxBytes;   // 512KB

/** SS2 帧闸=maxDocBytes+FRAME_ALLOWANCE_BYTES（≈8.06MiB——api deriveCollabLimits().ss2FrameGate 同式同源；
 *  离线合并回灌合法帧≠DoS：本地持有 ≥8MB 服务端没有的内容经合并必然超配额=超限落 4404 非 1009）。 */
export const SS2_FRAME_GATE_BYTES = QUOTA_DEFAULTS.maxDocBytes + FRAME_ALLOWANCE_BYTES;   // 8_454_144

/** WS maxPayload 16→9MiB（T9 翻转 apps/api collab-limits.ts WS_MAX_PAYLOAD_BYTES 改引本常量）：
 *  >SS2 帧闸即恰容纳（8_454_144<9_437_184），16MiB 纯增攻击面（v5.4⑱）。全新数字——本文件唯一真源。 */
export const COLLAB_WS_MAX_PAYLOAD_BYTES = 9 * 1024 * 1024;   // 9_437_184

/** 认证后 per-connection 入站排队字节上限=2×SS2 帧闸；超限 close 1009（库 MessageTooBig 单源重导出）。 */
export const INBOUND_QUEUE_LIMIT_BYTES = 2 * SS2_FRAME_GATE_BYTES;   // 16_908_288
export const INBOUND_QUEUE_OVER_LIMIT_CLOSE_CODE = CollabCloseCode.LIB_MESSAGE_TOO_BIG;   // 1009

/** 入站速率桶注记（评审 Minor#4 显式化——**本文件无对应常量**）：bytes 桶容量=SS2 帧闸
 *  （闸与桶同源——只抬闸不同步桶=(闸,闸+余量] 帧恒拒→重连重发循环=裁定 24⑵）。
 *  数值真源=apps/api/src/modules/collab/collab-limits.ts:39 deriveCollabLimits().bytesBucketCapacity
 *  =ss2FrameGate 同式派生；T9 翻转时该处改引 shared 单源（届时方在本文件立常量）。 */

/** SS2 大帧并发信号量：per-project 1（plan 冻结）+全局内存预算（初始工程值=4×SS2 帧闸≈32MiB——
 *  plan 未钉全局数，T33 观测后调；信号量只约束并发解码内存面，不约束普通帧）。 */
export const SS2_SEMAPHORE_PER_PROJECT = 1 as const;
export const SS2_SEMAPHORE_GLOBAL_BUDGET_BYTES = 4 * SS2_FRAME_GATE_BYTES;

/** HTTP seed 端点废止的 T29 触发条件（数字化挂 gate——§3.2 v5.4⑱：client→server 大差量恢复走
 *  recovery import（DraftEnvelope REST ≤8MiB）而非 HTTP seed；cold p95>3s 或事件循环阻塞>50ms 才考虑
 *  重开——重开即新评审，不自动复活）。 */
export const HTTP_SEED_RETIRE_TRIGGERS = { coldP95Ms: 3_000, eventLoopBlockMs: 50 } as const;

// ═══ §8 版本维度表（§5.2——单名单义）════════════════════════════════════════════════════

/** 版本维度表（作用域/比较方式/持久化位置/重置规则——完整表见 spec §5.1/§5.2；BigInt 入 JSON/WS
 *  payload 显式 String()）。nodeVersion=**节点末次变更 feedSeq**（节点状态截至 feedSeq 水位——单名单义）；
 *  feedSeq **跨代不重置**（RuntimeEvent per-project 序）。 */
export const VERSION_DIMENSIONS = {
  generation: '文档身份/schema 代际——硬重置/schema 迁移/vacuum 换代（4410+新 docName(#g)+清整族缓存）',
  snapshotRev: '快照版本——compact 发布（不重连，最多 doc-status）',
  vacuumEpoch: '压缩操作代次（遥测——无行为分支）',
  walSeq: 'gate 去重后分配的帧序号（per project 连续——帧的身份序号）',
  spoolHeadSeq: '最后 fsync 成功帧序号（内存+WAL 段 manifest——v5.4⑥ 拆义新名）',
  appliedSeq: '最后 apply 成功且完全整合（无 pending）的 walSeq（内存/批级——actor 推进）',
  pgSeq: '最后 PG 提交的 walSeq（CanvasDoc 持久列）——对外唯一「已保存」水位',
  walCheckpointSeq: '批提交时刻 spoolHeadSeq 采样（持久列——随 PG 批更新；恢复以 WAL 扫描为准）',
  docSeq: '受理冻结的 pgSeq（ExecutionRequest 一致前缀读）',
  execSeq: '节点执行序（PG lifecycleSeq 数值 BigInt）',
  nodeVersion: '节点末次变更 feedSeq（节点状态截至 feedSeq 水位——单名单义，废止名单见 DEPRECATED_VERSION_DIMENSION_KEYS）',
  artifactRev: '产物槽位版本',
  feedSeq: 'RuntimeEvent per-project 序——跨代不重置',
} as const;
export type VersionDimensionKey = keyof typeof VERSION_DIMENSIONS;

/** 废止名单（§5.2 v5.4 单名单义——plan T5a 列 projectedEventVersion/projectedExecSeq，spec §5.2 同句
 *  连 eventVersion 一并废止；禁复活——census/static 门消费）。 */
export const DEPRECATED_VERSION_DIMENSION_KEYS = ['eventVersion', 'projectedEventVersion', 'projectedExecSeq'] as const;

// ═══ §9 客户端半链（§8.1 v5.4⑦——堵同代 PITR 客户端 SS2 复活）═══════════════════════════

/** providerVersion 版本通道 `h=<historyId>` 参数（与 csv=/cb= 同通道——URL query，非凭证）：
 *  首连无 historyId 由服务端 auth 回执下发并客户端持久化。
 *  percent-encoding 与 parse 对称（评审 Minor#2）：值经 encodeURIComponent——含保留字符（空格、%、&、=…）
 *  的 historyId 往返不失真；unreserved 字符输出逐字节不变（既有断言面零破坏）。 */
export function formatProviderHistoryParam(historyId: string): string {
  return `h=${encodeURIComponent(historyId)}`;
}

/** 自 URL search 串解析 h= 参数（无则 null——R-6：URL 由调用方构造，本函数只做键提取）。
 *  decodeURIComponent 与 format 对称（评审 Minor#2）：畸形 % 串（URIError）归 null 不抛——解析面防御。 */
export function parseProviderHistoryParam(search: string): string | null {
  const m = /(?:^|[?&])h=([^&]*)/.exec(search);
  if (m == null) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;   // 畸形 % 串——URIError 归 null
  }
}

/** 本地缓存键五元 (uid,pid,generation,schemaVersion,historyId)——per-tab 记录+boot mergeUpdates 并集；
 *  generation 变更（含 vacuum 换代）清整族（4410 discardLocalCache:true 显式清，不靠改键）。 */
export interface LocalCacheKeyFiveTuple {
  uid: string;
  pid: string;
  generation: number;
  schemaVersion: number;
  historyId: string;
}

export function formatLocalCacheKey(k: LocalCacheKeyFiveTuple): string {
  return `collab-cache:${k.uid}:${k.pid}:g${k.generation}:s${k.schemaVersion}:${k.historyId}`;
}

export type AuthHistoryVerdict = 'ok' | 'server-restored' | 'doc-generation-stale';

/** onAuthenticate 判序（§8.1——**先比 historyId 再比 generation**：g_client==g_server 时旧内容重灌
 *  是同代 PITR 恢复的 SS2 复活形态，generation 相等救不了 historyId 不匹配）：
 *  - historyId 不匹配 → server-restored（不清缓存，只读 recovery；恢复后=bump historyId+旧 WAL 整目录
 *    quarantine+换代一次再开放写，不自动把旧 WAL 灌回 PG）
 *  - g_client>g_server → server-restored（客户端新于服务端=PITR 回退形态）
 *  - g_client<g_server → doc-generation-stale（4410 换代通道）
 *  - client historyId 缺省=首连——服务端 auth 回执下发并客户端持久化，非 mismatch。 */
export function resolveAuthHistoryVerdict(
  client: { historyId?: string; generation: number },
  server: { historyId: string; generation: number },
): AuthHistoryVerdict {
  if (client.historyId !== undefined && client.historyId !== server.historyId) return 'server-restored';
  if (client.generation > server.generation) return 'server-restored';
  if (client.generation < server.generation) return 'doc-generation-stale';
  return 'ok';
}

/** ETag=`generation:pgSeq`（恢复后无 304 旧内容——同代 PITR 后 pgSeq 重放使旧 ETag 失配；
 *  docSeq/committedSeq/read model 新鲜度/公开快照水位一律 pgSeq）。 */
export function formatDocETag(g: { generation: number; pgSeq: bigint }): string {
  return `${g.generation}:${g.pgSeq}`;
}
