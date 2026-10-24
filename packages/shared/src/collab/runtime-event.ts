// packages/shared/src/collab/runtime-event.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段——spec v5.4 §7 Runtime Feed 平面，D5 per-project feedSeq+偏离 30 v5.2）：
// RuntimeEvent taxonomy+RuntimeFeedCursor+锁序契约冻结。**CONTRACT-FREEZE**——类型+常量+纯函数；
// 消费方=T22（feed 投递/taxonomy 落地）/T26（义务观察器同事务写事件）/T31（故障演练）。
// RuntimeProjection 类型本身+客户端 merge/cursor 半链归 T5c。DDL 迁移归 T7/T21。
// 契约测试=runtime-event.spec.ts（TDD 红先行）。

// ═══ §1 EVENT_KINDS registry+payload envelope（v5.4⑭——exact taxonomy）══════════════════════

/** 事件种类 registry（closed——**exact taxonomy** 五值；服务端维护常量+upcaster，客户端未知 kind
 *  忽略+`unknown_event_total` 不崩；新增种类=spec 修订非随手加 string） */
export const EVENT_KINDS = ['exec.status', 'exec.artifact', 'media.fact', 'node.deleted', 'doc.vacuumed'] as const;
export type RuntimeEventKind = typeof EVENT_KINDS[number];

/** payload envelope 版本（v5.4⑭——payload 带 `v:1`；升版=新 kind of 契约修订走 upcaster） */
export const RUNTIME_EVENT_PAYLOAD_VERSION = 1 as const;
export type RuntimeEventPayloadVersion = typeof RUNTIME_EVENT_PAYLOAD_VERSION;

/** payload 判别 union（spec §7 v5.4⑭ 逐 kind 键集——exact）：
 *  - nodeVersion=该节点最后一次变更事件的 feedSeq（**单名单义**——§5.2；wire/JSON 一律 string）
 *  - node.deleted=FEED_TOMBSTONE（lifecycleSeq 与 NodeLifecycle 同源）
 *  - media.fact 带服务端 natural 尺寸+downscaledFrom（媒体事实通道键 (mediaId,factVersion)——事件只带引用）
 *  - doc.vacuumed 只带 generation（换代通知——客户端清投影整族） */
export type RuntimeEventPayload =
  | {
      v: RuntimeEventPayloadVersion;
      kind: 'exec.status';
      nodeId: string;
      status: string;
      attempts: number;
      errorCode?: string;
      artifactRev?: number;
      nodeVersion: string;
    }
  | {
      v: RuntimeEventPayloadVersion;
      kind: 'exec.artifact';
      nodeId: string;
      mediaId?: string;
      resultRef?: string;
      artifactRev: number;
      nodeVersion: string;
    }
  | {
      v: RuntimeEventPayloadVersion;
      kind: 'media.fact';
      mediaId: string;
      naturalWidth: number;
      naturalHeight: number;
      downscaledFrom?: { width: number; height: number };
      factVersion: number;
      nodeVersion: string;
    }
  | {
      v: RuntimeEventPayloadVersion;
      kind: 'node.deleted';
      nodeId: string;
      lifecycleSeq: string;
      nodeVersion: string;
    }
  | {
      v: RuntimeEventPayloadVersion;
      kind: 'doc.vacuumed';
      generation: number;
    };

/** RuntimeEvent 行（spec §7 DDL——`@@unique([projectId, feedSeq])`+`@@index([projectId, generation, feedSeq])`）：
 *  - feedSeq=per-project 连续（**跨代不重置**——generation 仅作过滤）；BigInt wire 一律 String()
 *  - docSeq=事件对应的 pgSeq 下界（应用规则：事件 docSeq≤客户端已同步 pgSeq 才应用否则 buffer；
 *    节点已删则忽略；旧 generation 隔离）
 *  - **事件与业务事务原子提交**（执行状态变更与 RuntimeEvent 同一 PG 事务） */
export interface RuntimeEventRow {
  id: string;
  projectId: string;
  generation: number;
  feedSeq: bigint;
  kind: RuntimeEventKind;
  payload: RuntimeEventPayload;
  docSeq?: bigint;
  createdAtMs: number;
}

/** payload 上限 64KB（超限**拒绝写入**——业务 bug 非截断；resultText 大文本放 NodeArtifact 事件只带引用） */
export const RUNTIME_EVENT_PAYLOAD_MAX_BYTES = 64 * 1024;

// ═══ §2 PII 扫描（事件写入前——禁 prompt/正文/URL 原文）══════════════════════════════════════

/** 违例键模式（大小写不敏感子串——prompt/正文/URL/HTML 家族；合法 taxonomy 键零误伤由测试锁定） */
export const RUNTIME_EVENT_PII_FORBIDDEN_KEY_RE = /prompt|body|content|html|url|text/i;

/** PII 扫描纯函数（返回违例键清单——空=通过）：事件写入前服务端调用（T22）；日志禁整 payload
 *  （Sentry 只带 requestId/contentHash/bytes——ExecutionInput 同款纪律）。 */
export function runtimeEventPayloadPiiViolations(payload: object): string[] {
  const hits: string[] = [];
  for (const key of Object.keys(payload)) {
    if (RUNTIME_EVENT_PII_FORBIDDEN_KEY_RE.test(key)) hits.push(key);
  }
  return hits;
}

// ═══ §3 RuntimeFeedCursor（v5.3⑫ 定形+v5.4⑮ 锁序简化）══════════════════════════════════════

/** 专用计数行（spec §7 DDL——`projectId String @id`+lastSeq+minRetainedSeq；genesis 建项目**同事务插行**） */
export interface RuntimeFeedCursorRow {
  projectId: string;
  lastSeq: bigint;
  minRetainedSeq: bigint;
}

/** feedSeq 分配 upsert SQL 契约（**upsert——空项目首事件 0 行问题修**；分配序=提交序，游标推进
 *  不会漏未提交事件——行锁持有至提交；genesis 同事务插 cursor 行后本语句为唯一取号路径。
 *  T22 落地=$1=projectId；RETURNING lastSeq 即该事件 feedSeq（首事件=1）。 */
export const RUNTIME_FEED_CURSOR_UPSERT_SQL =
  'INSERT INTO "RuntimeFeedCursor" ("projectId", "lastSeq", "minRetainedSeq") VALUES ($1, 1, 0) '
  + 'ON CONFLICT ("projectId") DO UPDATE SET "lastSeq" = "RuntimeFeedCursor"."lastSeq" + 1 '
  + 'RETURNING "lastSeq"';

/** 锁序冻结（v5.4⑮——spec §7「锁序简化」）：feed 事务只锁**业务行→counter**（counter 恒最后拿）；
 *  CanvasDoc 用普通 SELECT/FOR SHARE 读 generation/docSeq——**不与维护/快照互斥**。
 *  负控=静态锁序 lint+正常序压力（N 次无 40P01）+「去 counter」负控（期望重复/缺口）；
 *  受控死锁用例（反向锁序）标 heavy 不进 PR——见 testing/y1c-feed-fault-corpus。 */
export const RUNTIME_FEED_LOCK_ORDER = ['business-rows', 'runtime-feed-cursor'] as const;
export type RuntimeFeedLockOrderStep = typeof RUNTIME_FEED_LOCK_ORDER[number];

/** 事件保留期（spec §7——7 天或 100k 条/项目**先到为准**；清理 worker 更新 minRetainedSeq+
 *  `runtime_feed_bytes` 指标；游标<minRetainedSeq 或保留期已过→客户端全量快照） */
export const RUNTIME_EVENT_RETENTION_DAYS = 7 as const;
export const RUNTIME_EVENT_RETENTION_MAX_PER_PROJECT = 100_000 as const;

/** 交付契约注记（spec §7「唯一交付=HTTP 游标」——客户端 reducer/cursor 三元归 T5c/T22）：
 *  stateless 通知与心跳都**不携带事件体**只带 {type:'feed-hint',latestFeedSeq}；两通道无「到达序」问题
 *  （都不交付数据只有 cursor 有序）；通知在业务事务**提交后**发（事务内发客户端可能查不到——重试即可）。 */
export const RUNTIME_FEED_DELIVERY_CONTRACT = {
  uniqueChannel: 'HTTP 游标（GET /runtime/events?after=cursor&limit<=200 按 feedSeq 升序）',
  notificationBody: 'stateless/心跳只带 latestFeedSeq 不带事件体（心跳 15-30s 防通知丢）',
  atomic: '事件与业务事务原子提交（执行状态变更与 RuntimeEvent 同一 PG 事务）',
} as const;
