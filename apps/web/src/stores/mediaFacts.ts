// apps/web/src/stores/mediaFacts.ts —— Y1a+Y1b T16（spec :45 P1/:50 Z18''④「pendingFacts 客户端消费
// 保留——fact 先于 fileId 到达暂存」）：媒体事实消费纯模块——零 store 运行时依赖（execStatusView
// 同形态），nodeStore.mediaFacts 状态的写者=canvasCollabRuntime（唯一写者纪律同 execStatus）。
//
// 消费语义（v9 P1 承接）：
//   factVersion 单调（BigInt wire string——shared compareExecSeq 同源解析形态）忽略旧/等值重放；
//   factType='state' 携 {status: processing|completed|failed, errorCode?, error?} 驱动 UI
//   （processing=可播 seek 占位/failed=错误+重试）。
//   factType='natural' 携 {naturalWidth, naturalHeight, naturalRotation?}——T17 登记收口（T19）：
//   natural 类事实进消费面（此前 T16 注释自注「本卡不消费」）——VideoGenNode 尺寸决策数据源
//   （applyIntrinsicFit natural 源，DOM 未加载也可定尺寸）；两类正交合并进同一条目（union——
//   state 缺席的纯 natural 行不建条目〔UI 消费面 state 必需——丢弃等 state 行到达，与 unknown
//   忽略同哲学〕，natural 缺席保持既有行为）。
//   pendingFacts=短 TTL Map（fact 先于 fileId 到达暂存——fileId 到达即消费；TTL 过期丢弃：
//   「忽略未知 mediaId」=丢到下次重连全量拉，非缓存承诺）+容量帽（T16 登记收口·T19：静止会话
//   无消费触发点时防滞留膨胀——stage 时顺带 prune 过期+超帽逐出最早到期条目）。
/** 媒体事实条目（nodeStore.mediaFacts 值——UI 消费面单形状）。 */
export interface MediaFactEntry {
  /** 单调事实版本（wire=string——BigInt JSON 纪律；比较经 factVersionGte）。 */
  factVersion: string;
  state: 'processing' | 'completed' | 'failed';
  errorCode?: string;
  error?: string;
  /** 固有尺寸（factType='natural'——ffprobe/probe 服务端事实；T17 登记收口进消费面）。 */
  natural?: { width: number; height: number; rotation: number | null };
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
/** 容量帽（T16 登记收口·T19）：静止会话（无 doc 变更/无重连——consumePendingFacts 零触发）下
 *  pending 滞留上界；stage 时超帽先 prune 过期，仍超逐出最早到期（非 LRU——TTL 语义优先）。 */
export const PENDING_FACTS_CAP = 500;

function parseFactVersion(v: string): bigint {
  try {
    return BigInt(v);
  } catch {
    return -1n;   // 非法版本=最老（必被单调门忽略——fail-safe 不 throw：UI 消费面禁坏数据炸渲染）
  }
}

/** 单调门：candidate 是否**严格更新**于 stored（忽略旧/等值重放——at-least-once 幂等去重）。 */
export function factVersionNewer(candidate: string, stored: string | undefined): boolean {
  if (stored === undefined) return parseFactVersion(candidate) >= 0n;
  return parseFactVersion(candidate) > parseFactVersion(stored);
}

/** wire 事实行 → UI 条目（T17 登记收口：state/natural 两类；纯 natural 行返回 natural-only 部分
 *  条目——合并层 union，state 缺席不独立入 store）。 */
export function parseFactRow(f: MediaFactWireRow): Partial<MediaFactEntry> & { factVersion: string } | null {
  if (f.factType === 'natural') {
    const w = f.payload?.naturalWidth;
    const h = f.payload?.naturalHeight;
    if (typeof w !== 'number' || typeof h !== 'number' || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    const r = f.payload?.naturalRotation;
    return { factVersion: f.factVersion, natural: { width: w, height: h, rotation: typeof r === 'number' ? r : null } };
  }
  if (f.factType !== 'state') return null;
  const status = f.payload?.status;
  if (status !== 'processing' && status !== 'completed' && status !== 'failed') return null;
  const e = f.payload as { errorCode?: unknown; error?: unknown };
  return {
    factVersion: f.factVersion,
    state: status,
    ...(typeof e.errorCode === 'string' ? { errorCode: e.errorCode } : {}),
    ...(typeof e.error === 'string' ? { error: e.error } : {}),
  };
}

/** 部分条目 union 进完整条目（factVersion 取更新侧；state/natural 各自保留——正交合并）。
 *  base 缺 state（natural-only 先到）→ 返回 base 原样（不建完整条目——state 必需）。
 *  正交补充豁免（质评 Minor#3 收紧+终审复审阻塞修）：**等值版本**下两类行互补充缺席/差异面
 *  （服务端 completeMaterialized 同事务同 factVersion 双写 state+natural——拉取行序无 factType
 *  tie-break 保证，合并必须**完全序无关**）：
 *   - naturalFill：natural 补入 base 缺席面；
 *   - stateFill：state 行与 base 现值面不等（state/errorCode/error 任一差异）即并入——否则
 *     wire 序 [state v1, natural v2, state v2] 中 natural v2 先抬版本后 state v2 等值被单调门
 *     吞没→completed 永久滞留 processing（每个完成视频都触发——终审复审阻塞项）；
 *   - 等值且对应面全等=纯重放忽略（幂等）；**旧版本**行不豁免（重放可能过时——禁旧版本写新代）。 */
function unionFact(base: MediaFactEntry | undefined, part: Partial<MediaFactEntry> & { factVersion: string }): MediaFactEntry | undefined {
  if (base === undefined) {
    if (part.state === undefined) return undefined;   // 纯 natural 无 state 基线——丢弃（state 行到达后 union）
    return { ...(part as MediaFactEntry), receivedAt: Date.now() };
  }
  const newer = factVersionNewer(part.factVersion, base.factVersion);
  const equalVersion = !newer && factVersionNewer(base.factVersion, part.factVersion) === false;   // 双向皆非更新=等值
  const naturalFill = equalVersion && part.natural !== undefined && base.natural === undefined;
  const stateFill = equalVersion && part.state !== undefined
    && (part.state !== base.state || part.errorCode !== base.errorCode || part.error !== base.error);
  if (!newer && !naturalFill && !stateFill) return base;   // 旧版本/等值纯重放/无对应面——忽略
  return {
    ...base,
    ...(part.state !== undefined
      ? { state: part.state, errorCode: part.errorCode, error: part.error }
      : {}),
    ...(part.natural !== undefined ? { natural: part.natural } : {}),
    factVersion: newer ? part.factVersion : base.factVersion,
    receivedAt: Date.now(),
  };
}

/** 响应批合并（at-least-once 幂等）：批内升序末者胜+旧批次忽略。
 *  T17 登记收口：多类行 union 进同 mediaId 条目（state+natural 正交）。 */
export function mergeFactRows(
  current: ReadonlyMap<string, MediaFactEntry>,
  rows: readonly MediaFactsResponseRow[],
): Map<string, MediaFactEntry> {
  let next: Map<string, MediaFactEntry> | null = null;
  for (const row of rows) {
    let entry = (next ?? current).get(row.mediaId);
    for (const f of row.facts) {
      const part = parseFactRow(f);
      if (!part) continue;
      const merged = unionFact(entry, part);
      if (merged === entry) continue;
      entry = merged;
      if (entry === undefined) continue;
      next = next ?? new Map(current);
      next.set(row.mediaId, entry);
    }
  }
  return next ?? new Map(current);
}

/** 暂存（fact 先于 fileId 到达窗）：单调门+TTL；容量帽（T16 登记收口·T19）——超帽先 prune 过期
 *  条目，仍超逐出最早到期（TTL 语义优先于重放新旧：被逐条目=丢到下次重连全量拉，同过期语义）。 */
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
  let next = new Map(pending);
  next.set(mediaId, { entry, expiresAt: now + PENDING_FACTS_TTL_MS });
  if (next.size > PENDING_FACTS_CAP) {
    // 先清过期（TTL 语义优先）
    for (const [id, p] of next) {
      if (next.size <= PENDING_FACTS_CAP) break;
      if (now >= p.expiresAt) next.delete(id);
    }
    // 仍超：逐出最早到期（insertion 后 TTL 窗内近似 FIFO——防静止会话滞留膨胀）
    while (next.size > PENDING_FACTS_CAP) {
      let oldest: string | null = null;
      let oldestAt = Infinity;
      for (const [id, p] of next) {
        if (p.expiresAt < oldestAt) { oldestAt = p.expiresAt; oldest = id; }
      }
      if (oldest === null) break;
      next.delete(oldest);
    }
  }
  return next;
}

/** 暂存行批（T17 登记收口：state/natural 两类行 union 成完整条目后 stage——mediaFactsRuntime
 *  ingestRows 消费；纯 natural 行〔state 未到〕不建暂存，等 state 行到达后整批重放）。 */
export function stagePendingFactRows(
  pending: ReadonlyMap<string, PendingFact>,
  mediaId: string,
  facts: readonly MediaFactWireRow[],
  now: number,
): Map<string, PendingFact> {
  const base = pending.get(mediaId)?.entry;
  let entry: MediaFactEntry | undefined = base;
  for (const f of facts) {
    const part = parseFactRow(f);
    if (!part) continue;
    const merged = unionFact(entry, part);
    if (merged === undefined) continue;
    entry = merged;
  }
  if (entry === undefined || entry === base) return new Map(pending);   // 无可暂存面（纯 natural/全忽略）
  return stagePendingFact(pending, mediaId, entry, now);
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
