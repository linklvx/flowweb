// apps/web/src/stores/mediaFactsRuntime.ts —— Y1a+Y1b T16（spec :45 P1/:50/:91：pendingFacts 客户端
// 消费保留）：媒体事实拉取/暂存/消费的会话编排模块（nodeStore.mediaFacts 唯一写者——execStatus
// 的 projectExecToStore 同形态；canvasCollabRuntime 仅在三挂点调用本模块，自身零逻辑）。
//
// 三驱动（spec Z18''④「mark 后 lazy 补拉」+Z14''/P1 时序）：
//   ①重连全量拉：ws connected 边沿——doc 全量 mediaId 集（collectMediaIds 七键扫描）分批 POST，
//     响应直接并入消费 Map + 非 doc 引用 mediaId 的 fact 暂存 pendingFacts（fact 先于 fileId 到达）；
//   ②fileId 到达即消费：doc nodes 变更后（applyDocToStore 尾挂）——新见 mediaId 集：pending 命中即
//     消费迁入；未命中入 lazy 拉取队列（2s 去抖批拉——delivery/mark 后 lazy 补拉）；
//   ③切项目清空：initCollab 会话起点——消费 Map+pending+lazy 队列全清（旧项目事实不跨会话）。
// factVersion 单调忽略旧/等值重放（mediaFacts.ts 纯模块——mergeFactRows/stagePendingFact/
// consumePendingFacts 单源；红测在 stores/mediaFacts.test.ts）。
import * as Y from 'yjs';
import { collectMediaIds } from '@flowweb/shared';
import { toDocLike } from '@/collab/ydocBuilder';
import { fetchMediaFacts } from '@/api/mediaApi';
import { useNodeStore } from './nodeStore';
import { useTeamStore } from './teamStore';
import {
  mergeFactRows, stagePendingFact, consumePendingFacts, parseFactRow,
  type MediaFactsResponseRow, type PendingFact,
} from './mediaFacts';

/** lazy 补拉去抖窗（fileId 到达→拉取批合并窗——投影 poller 3s tick 的次轮即覆盖）。 */
const LAZY_PULL_DEBOUNCE_MS = 2_000;
/** 单批 mediaId 上界（服务端 MEDIA_FACTS_MAX_IDS=200——分批拉取）。 */
const FACTS_BATCH = 200;

/** 模块态（会话生命周期——resetMediaFacts 清空）。 */
let pendingFacts = new Map<string, PendingFact>();
let lazyQueue = new Set<string>();
let lazyTimer: ReturnType<typeof setTimeout> | null = null;
let knownMediaIds = new Set<string>();
let fullPullInFlight = false;

function teamIdOf(): string | undefined {
  return useTeamStore.getState().currentTeamId ?? undefined;
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 响应消费：doc 已引用 mediaId 直接并入；未引用暂存 pendingFacts（fact 先于 fileId 到达窗）。 */
function ingestRows(rows: readonly MediaFactsResponseRow[], docIds: ReadonlySet<string>): void {
  const current = useNodeStore.getState().mediaFacts;
  const direct: MediaFactsResponseRow[] = [];
  for (const row of rows) {
    if (docIds.has(row.mediaId)) direct.push(row);
    else {
      // fact 先于 fileId 到达——暂存短 TTL Map（fileId 到达即消费；TTL 过期丢到下次重连全量拉）
      for (const f of row.facts) {
        const entry = parseFactRow(f);
        if (entry) pendingFacts = stagePendingFact(pendingFacts, row.mediaId, entry, Date.now());
      }
    }
  }
  if (direct.length > 0) {
    useNodeStore.setState({ mediaFacts: mergeFactRows(current, direct) });
  }
}

/** 按 mediaId 集拉取（分批 ≤FACTS_BATCH；失败静默——重连全量拉自愈，非缓存承诺）。 */
async function pullIds(ids: readonly string[], docIds: ReadonlySet<string>): Promise<void> {
  const teamId = teamIdOf();
  for (const batch of chunk(ids, FACTS_BATCH)) {
    try {
      const rows = await fetchMediaFacts([...batch], teamId);
      ingestRows(rows, docIds);
    } catch { /* 拉取失败静默——下轮重连/lazy 自愈 */ }
  }
}

/** ③切项目清空（initCollab 会话起点——消费 Map+pending+lazy 队列全清）。 */
export function resetMediaFacts(): void {
  pendingFacts = new Map();
  lazyQueue = new Set();
  knownMediaIds = new Set();
  if (lazyTimer) { clearTimeout(lazyTimer); lazyTimer = null; }
  useNodeStore.setState({ mediaFacts: new Map() });
}

/** ①重连全量拉（connected 边沿）：doc 全量 mediaId 集 POST；同时消费 pending 中已可达的
 *  fileId（对账窗——上次会话遗留 pending 在新 doc 引用到位时补消费）。 */
export function pullMediaFactsFull(doc: Y.Doc): void {
  if (fullPullInFlight || !doc) return;
  fullPullInFlight = true;
  void (async () => {
    try {
      const docIds = collectMediaIds(toDocLike(doc));
      knownMediaIds = new Set(docIds);
      // pending 对账：fileId 已达的暂存 fact 补消费
      const { pending, consumed } = consumePendingFacts(pendingFacts, docIds, useNodeStore.getState().mediaFacts, Date.now());
      pendingFacts = pending;
      if (consumed) useNodeStore.setState({ mediaFacts: consumed });
      await pullIds([...docIds], docIds);
    } finally {
      fullPullInFlight = false;
    }
  })();
}

/** 单 mediaId 定向补拉（failed UI 重试面——VideoGenNode「刷新状态」按钮直调）。 */
export function pullMediaFactsForIds(ids: readonly string[]): void {
  if (ids.length === 0) return;
  void pullIds(ids, new Set(ids));
}

/** ②fileId 到达判定（doc nodes 变更后——applyDocToStore 尾挂/armSession 首投影）：新见 mediaId
 *  消费 pending+入 lazy 队列去抖批拉。 */
export function onDocRefsChanged(doc: Y.Doc): void {
  if (!doc) return;
  const docIds = collectMediaIds(toDocLike(doc));
  const fresh: string[] = [];
  for (const id of docIds) {
    if (!knownMediaIds.has(id)) fresh.push(id);
  }
  knownMediaIds = new Set(docIds);
  if (fresh.length === 0) {
    // 无新引用仍跑 pending TTL 清扫（过期丢弃——零成本对账）
    const { pending } = consumePendingFacts(pendingFacts, docIds, useNodeStore.getState().mediaFacts, Date.now());
    pendingFacts = pending;
    return;
  }
  const { pending, consumed } = consumePendingFacts(pendingFacts, docIds, useNodeStore.getState().mediaFacts, Date.now());
  pendingFacts = pending;
  if (consumed) useNodeStore.setState({ mediaFacts: consumed });
  for (const id of fresh) lazyQueue.add(id);
  if (lazyTimer) clearTimeout(lazyTimer);
  lazyTimer = setTimeout(() => {
    lazyTimer = null;
    const ids = [...lazyQueue];
    lazyQueue = new Set();
    if (ids.length > 0) void pullIds(ids, collectMediaIds(toDocLike(doc)));
  }, LAZY_PULL_DEBOUNCE_MS);
}
