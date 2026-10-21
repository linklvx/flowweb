// apps/web/src/stores/mediaFacts.ts —— Y1a+Y1b T16（spec :45 P1/:50 Z18''④「pendingFacts 客户端消费
// 保留——fact 先于 fileId 到达暂存」）：媒体事实消费纯模块——零 store 运行时依赖（execStatusView
// 同形态），nodeStore.mediaFacts 状态的写者=canvasCollabRuntime（唯一写者纪律同 execStatus）。
//
// 消费语义（v9 P1 承接）：
//   factVersion 单调（BigInt wire string——shared compareExecSeq 同源解析形态）忽略旧/等值重放；
//   factType='state' 携 {status: processing|completed|failed, errorCode?, error?} 驱动 UI
//   （processing=可播 seek 占位/failed=错误+重试）；natural 类事实本卡不消费（透传忽略）。
//   pendingFacts=短 TTL Map（fact 先于 fileId 到达暂存——fileId 到达即消费；TTL 过期丢弃：
//   「忽略未知 mediaId」=丢到下次重连全量拉，非缓存承诺）。
/** 媒体事实条目（nodeStore.mediaFacts 值——UI 消费面单形状）。 */
export interface MediaFactEntry {
  /** 单调事实版本（wire=string——BigInt JSON 纪律；比较经 factVersionGte）。 */
  factVersion: string;
  state: 'processing' | 'completed' | 'failed';
  errorCode?: string;
  error?: string;
  receivedAt: number;
}

/** REST 响应事实行（POST /api/media/facts——media-facts.controller wire 契约）。 */
export interface MediaFactWireRow {
  factVersion: string;
  factType: string;
  payload: Record<string, unknown>;
}

export interface MediaFactsResponseRow {
  mediaId: string;
  facts: MediaFactWireRow[];
}

/** pendingFacts 条目（TTL 包装——暂存 fact 先于 fileId 到达的窗）。 */
export interface PendingFact {
  entry: MediaFactEntry;
  expiresAt: number;
}

/** 短 TTL：fileId 到达窗（投影 poller 3s tick+flush 去抖——60s 覆盖多轮投影；过期即弃非缓存承诺）。 */
export const PENDING_FACTS_TTL_MS = 60_000;

function parseFactVersion(v: string): bigint {
  try {
    return BigInt(v);
  } catch {
    return -1n;   // 非法版本=最老（必被单调门忽略——fail-safe 不 throw：UI 消费面禁坏数据炸渲染）
  }
}

/** 单调门：candidate 是否**严格更新**于 stored（忽略旧/等值重放——at-lease-once 幂等去重）。 */
export function factVersionNewer(candidate: string, stored: string | undefined): boolean {
  if (stored === undefined) return parseFactVersion(candidate) >= 0n;
  return parseFactVersion(candidate) > parseFactVersion(stored);
}

/** wire 事实行 → UI 条目（factType='state' 之外透传忽略——natural 等非本卡消费面）。 */
export function parseFactRow(f: MediaFactWireRow): MediaFactEntry | null {
  if (f.factType !== 'state') return null;
  const status = f.payload?.status;
  if (status !== 'processing' && status !== 'completed' && status !== 'failed') return null;
  const str = (k: string) => (typeof f.payload?.[k] === 'string' ? (f.payload[k] as string) : undefined);
  return {
    factVersion: f.factVersion,
    state: status,
    errorCode: str('errorCode'),
    error: str('error'),
    receivedAt: Date.now(),
  };
}

/** 合并一批响应行到既有 Map（返回新 Map——zustand setState 引用变更触发重渲；旧/等值忽略）。
 *  同批内多 fact 按 wire 升序（服务端 ORDER BY factVersion asc）逐条过单调门=末者胜。 */
export function mergeFactRows(
  current: ReadonlyMap<string, MediaFactEntry>,
  rows: readonly MediaFactsResponseRow[],
): Map<string, MediaFactEntry> {
  const next = new Map(current);
  for (const row of rows) {
    for (const f of row.facts) {
      const entry = parseFactRow(f);
      if (!entry) continue;
      const stored = next.get(row.mediaId);
      if (!factVersionNewer(entry.factVersion, stored?.factVersion)) continue;
      next.set(row.mediaId, entry);
    }
  }
  return next;
}

/** 暂存 fact（fact 先于 fileId 到达——doc 尚未引用该 mediaId 的窗）。同 mediaId 重复到达按单调门取新。 */
export function stagePendingFact(
  pending: ReadonlyMap<string, PendingFact>,
  mediaId: string,
  entry: MediaFactEntry,
  now: number,
): Map<string, PendingFact> {
  const existing = pending.get(mediaId);
  if (existing && !factVersionNewer(entry.factVersion, existing.entry.factVersion)) {
    return new Map(pending);   // 旧/等值重放——不更新（TTL 也不续期：原 expiresAt 保持）
  }
  const next = new Map(pending);
  next.set(mediaId, { entry, expiresAt: now + PENDING_FACTS_TTL_MS });
  return next;
}

/** fileId 到达即消费：doc 已引用的 mediaId 的暂存 fact 迁入消费 Map（并自 pending 移除）；
 *  过期条目顺带清扫（TTL 丢弃语义）。返回 {consumed, pruned}——consumed 合并序在后（同 mediaId
 *  既在 pending 又在 current：单调门保证恰新者胜）。 */
export function consumePendingFacts(
  pending: ReadonlyMap<string, PendingFact>,
  docMediaIds: ReadonlySet<string>,
  current: ReadonlyMap<string, MediaFactEntry>,
  now: number,
): { pending: Map<string, PendingFact>; consumed: Map<string, MediaFactEntry> | null } {
  let nextPending: Map<string, PendingFact> | null = null;
  let consumed: Map<string, MediaFactEntry> | null = null;
  for (const [mediaId, p] of pending) {
    if (now >= p.expiresAt) {
      // TTL 过期丢弃（「忽略未知 mediaId」=丢到下次重连全量拉）
      nextPending = nextPending ?? new Map(pending);
      nextPending.delete(mediaId);
      continue;
    }
    if (docMediaIds.has(mediaId)) {
      nextPending = nextPending ?? new Map(pending);
      nextPending.delete(mediaId);
      if (factVersionNewer(p.entry.factVersion, current.get(mediaId)?.factVersion)) {
        consumed = consumed ?? new Map(current);
        consumed.set(mediaId, p.entry);
      }
    }
  }
  return { pending: nextPending ?? new Map(pending), consumed };
}

/** 会话切项目清空（initCollab 会话起点——旧项目 facts/pending 不跨会话携带）。 */
export function emptyMediaFacts(): Map<string, MediaFactEntry> {
  return new Map();
}
