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
//   ④processing watcher（F3 用户裁定③）：会话级退避补拉——「doc 活引用集（lastDoc 现扫描——P2-1
//     根修：本地 origin 引用写不回环②驱动，快照对其盲窗→欠拉/过拉）∩ store processing 态」非空时
//     周期补拉（4s×2 增长帽 30s；集合变化重置回首档），终态退出/引用消失即停；不重连不换引用的
//     processing 视频也能自然切成品/终态失败。会话边界（initCollab 起点+teardownSession 清理链均
//     resetMediaFacts）纪元自增——在飞轮次响应丢弃（不 ingest 不续调度，lastDoc 释已 destroy doc）。
//     ①②③驱动 ingest 语义不变（watcher 仅在 ingest 落 store 后+②③尾部追加调度点）。
//     ※F4c P2-2 收口：epoch 守卫自④扩至①②③全驱动（fullPull/lazy/定向补拉的 pullIds 均传 stale）
//     ——F3 卡「①②语义不变」是当卡范围约束非永久契约：F4c 告知把「先存静默缺口」变成用户可见
//     toast，在飞响应跨 resetMediaFacts 迟到弹旧项目提示=用户可见副作用，故收口。
// factVersion 单调忽略旧/等值重放（mediaFacts.ts 纯模块——mergeFactRows/stagePendingFact/
// consumePendingFacts 单源；红测在 stores/mediaFacts.test.ts+F3 watcher 在 mediaFactsRuntime.test.ts）。
// F4c（用户裁定④）：超限降尺度用户告知——natural fact payload 携 downscaledFrom（api probe resize
// 分支写入，形态单源=shared MediaNaturalFactPayload）⇒ doc 已引用（direct 分支）即 message.info
// 「图片超过尺寸上限，已自动缩小至支持尺寸（原 w×h）」；每 mediaId 每会话恰一次（模块级 Set，
// resetMediaFacts 清空）；pending 暂存路径记录原尺寸、fileId 到达消费窗（consumePendingFacts 调用后）
// 同 Set 去重告知。告知与 store 条目正交（纯 natural 行不建条目——不因此吞告知）。上传者本人
// 会话链锚=scheduleUploadFactPull（P0：②lazy 被本地 origin 过滤+④watcher 结构性不适用→上传
// confirm 后双档延时定向补拉——组件侧挂点）。
import * as Y from 'yjs';
import { message } from 'antd';
import { collectMediaIds, type MediaNaturalFactPayload } from '@flowweb/shared';
import { toDocLike } from '@/collab/ydocBuilder';
import { fetchMediaFacts } from '@/api/mediaApi';
import { useNodeStore } from './nodeStore';
import { useTeamStore } from './teamStore';
import {
  mergeFactRows, stagePendingFactRows, consumePendingFacts,
  type MediaFactsResponseRow, type MediaFactEntry, type PendingFact,
} from './mediaFacts';

/** lazy 补拉去抖窗（fileId 到达→拉取批合并窗——投影 poller 3s tick 的次轮即覆盖）。 */
const LAZY_PULL_DEBOUNCE_MS = 2_000;
/** 单批 mediaId 上界（服务端 MEDIA_FACTS_MAX_IDS=200——分批拉取）。 */
const FACTS_BATCH = 200;
/** ④watcher 首档退避：视频 materialize 典型秒级~分钟级——4s≈投影 poller 3s tick 的次轮稍余量
 *  （新交付 processing 尽快进入轮询节奏，不与 tick 抖动重合）。 */
const PROCESSING_WATCH_BASE_MS = 4_000;
/** ④watcher 退避帽：长时间 processing 的稳态拉取上界——facts 查询轻量但会话级轮询须收敛
 *  （闲置画布常驻请求频率封顶 30s 一档）。 */
const PROCESSING_WATCH_MAX_MS = 30_000;

/** 模块态（会话生命周期——resetMediaFacts 清空）。 */
let pendingFacts = new Map<string, PendingFact>();
let lazyQueue = new Set<string>();
let lazyTimer: ReturnType<typeof setTimeout> | null = null;
let knownMediaIds = new Set<string>();
let fullPullInFlight = false;
// ④watcher 模块态（与 pendingFacts/lazyQueue 同层——useNodeStore 不加字段）：
let lastDoc: Y.Doc | null = null;        // 最近 doc（活引用集源——①②驱动点更新；本地 origin 写同 doc 实例即见）
let watchTimer: ReturnType<typeof setTimeout> | null = null;
let watchIds = new Set<string>();        // 上次调度的拉取集（集合变化=新 processing 加入/终态退出→退避重置）
let watchBackoffMs: number | null = null;
let watchInFlight = false;
/** 会话纪元：resetMediaFacts 自增——watcher 在飞轮次按 seq 判废（项目切换/teardown 丢弃旧响应，裁定原文）。 */
let sessionSeq = 0;
// F4c 降尺度告知态（会话生命周期——与 pendingFacts/lazyQueue 同层，resetMediaFacts 清空）：
// notifiedFactVersion=已告知 (mediaId,factVersion) 集（T22 键升级）；pendingDownscaledDims=暂存路径的原尺寸
// 记录（pending 条目不携 payload 面——consume 时按 mediaId 回查告知）。驻留上界=pendingFacts
// 60s TTL 窗（P2-1 收口）：消费窗顺带 prune「不在 pendingFacts 中的 id」——记录不越过其暂存
// 条目存活（TTL 丢弃后下次重连全量拉/lazy 补拉重 ingest 会重记录，自愈非缓存承诺）。
let pendingDownscaledDims = new Map<string, { width: number; height: number; factVersion: string }>();

function teamIdOf(): string | undefined {
  return useTeamStore.getState().currentTeamId ?? undefined;
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ═══ ④F3 processing watcher（会话级退避补拉——仅当前引用中 processing 媒体） ═══

/** 拉取集=「doc 活引用集（lastDoc 现扫描）∩ store processing 态」——仅当前引用中的 processing
 *  媒体（doc 已不引用的 processing fact 不拉；completed/failed 终态退出）。P2-1 根修：活扫描对
 *  本地 origin 引用写零盲窗（快照只在①②驱动点更新——欠拉新引用/过拉已删引用）。 */
function computeProcessingIds(): Set<string> {
  const ids = new Set<string>();
  if (!lastDoc) return ids;
  const facts = useNodeStore.getState().mediaFacts;
  for (const id of collectMediaIds(toDocLike(lastDoc))) {
    if (facts.get(id)?.state === 'processing') ids.add(id);
  }
  return ids;
}

function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function stopProcessingWatch(): void {
  if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
  watchIds = new Set();
  watchBackoffMs = null;
}

/** 单定时器不变量：任何（重）排必先清旧——全模块至多一个在途 watch 定时器。 */
function armProcessingWatch(ms: number): void {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = setTimeout(() => { void onProcessingWatchTick(); }, ms);
}

/** 调度点统一收敛（ingest 落 store 后+②③尾部调用）。调度不变量（P2-2/P2-3 收口）：
 *  单定时器+单在飞轮次+档位=「下一次 arm 应用的延迟」：
 *   - 拉取集空→停（清定时器+档位复位；在飞轮次轮尾复核同一判据自然停）；
 *   - 集合变化且无在飞轮→**即时生效**：重置首档+重排（换掉既有定时器）；
 *   - 集合变化但在飞→**轮尾生效**：仅记录集合+重置档位，零 arm（在飞期 arm=到点开第二轮→双轮
 *     并发重复拉取；在飞轮轮尾续排必带集合现值——新集合同轮即达）；
 *   - 集合不变→不干预在途节奏（退避翻倍只发生在轮尾续排——外部调度点不翻倍不跳档）。 */
function scheduleProcessingWatch(): void {
  const ids = computeProcessingIds();
  if (ids.size === 0) { stopProcessingWatch(); return; }
  if (!sameIdSet(ids, watchIds)) {
    watchIds = ids;
    watchBackoffMs = PROCESSING_WATCH_BASE_MS;
    if (!watchInFlight) armProcessingWatch(PROCESSING_WATCH_BASE_MS);   // 即时生效；在飞=轮尾生效
    return;
  }
  if (watchTimer === null && !watchInFlight) {
    armProcessingWatch(watchBackoffMs ?? PROCESSING_WATCH_BASE_MS);     // 冷启动兜底（停后重启/竞态余口）
  }
}

/** watcher 轮次：现取拉取集→pullIds（失败静默下轮重试；会话换代响应弃）。轮尾续排翻倍判据=
 * 「本轮起点集合 vs 轮尾现值」同集=本节奏续档翻倍（帽 30s）；变集（外部引用变化或本轮响应推移）
 * =新节奏回首档——不对已被外部在飞重置的档位再翻倍（P2-2：4s→16s 跳档根修）。seq 失配=项目
 * 切换/teardown——响应已弃且不再调度（新会话由①②驱动自启）。 */
async function onProcessingWatchTick(): Promise<void> {
  watchTimer = null;
  const seq = sessionSeq;
  const ids = computeProcessingIds();
  if (ids.size === 0) { stopProcessingWatch(); return; }
  watchInFlight = true;
  try {
    await pullIds([...ids], () => (lastDoc ? collectMediaIds(toDocLike(lastDoc)) : new Set<string>()), () => seq !== sessionSeq);
  } finally {
    if (seq === sessionSeq) watchInFlight = false;   // 旧会话轮次不清新会话的在飞标志
  }
  if (seq !== sessionSeq) return;
  const next = computeProcessingIds();
  if (next.size === 0) { stopProcessingWatch(); return; }
  if (sameIdSet(next, ids)) {
    watchBackoffMs = Math.min((watchBackoffMs ?? PROCESSING_WATCH_BASE_MS) * 2, PROCESSING_WATCH_MAX_MS);
  } else {
    watchIds = next;
    watchBackoffMs = PROCESSING_WATCH_BASE_MS;   // 轮尾集合已变——回首档（外部在飞重置同值幂等）
  }
  armProcessingWatch(watchBackoffMs);
}

// ═══ F4c 超限降尺度用户告知（用户裁定④「超限时明确告知已缩小至支持尺寸」） ═══

/** 响应行内 natural fact 的 downscaledFrom 结构校验（wire payload 无 schema——防坏数据炸渲染，
 *  与 parseFactRow 同哲学：非法形态视同未降尺度）。 */
function downscaledFromOf(row: MediaFactsResponseRow): { width: number; height: number; factVersion: string } | null {
  for (const f of row.facts) {
    if (f.factType !== 'natural') continue;
    const d = (f.payload as Partial<MediaNaturalFactPayload>).downscaledFrom;
    if (typeof d?.width === 'number' && typeof d?.height === 'number'
      && Number.isFinite(d.width) && Number.isFinite(d.height) && d.width > 0 && d.height > 0) {
      return { width: d.width, height: d.height, factVersion: latestFactVersionOf(row) };
    }
  }
  return null;
}

/** 告知恰一次（T22 键升级=(mediaId,factVersion)——shouldNotifyDownscaled 单源；antd 现有形态
 *  同 canvasCollabRuntime message 用法）。文案不携「40MP」字面（P2-4）——与 api MAX_IMAGE_PIXELS
 *  解耦，免双源漂移。 */
function notifyDownscaled(mediaId: string, factVersion: string, dims: { width: number; height: number }): void {
  if (!shouldNotifyDownscaled(mediaId, factVersion)) return;
  message.info(`图片超过尺寸上限，已自动缩小至支持尺寸（原 ${dims.width}×${dims.height}）`);
}

/** 行内最新 natural factVersion（downscaledFrom 告知版本键——取该 mediaId 事实行最大版本）。 */
function latestFactVersionOf(row: MediaFactsResponseRow): string {
  let max = '0';
  for (const f of row.facts) if (BigInt(f.factVersion) > BigInt(max)) max = f.factVersion;
  return max;
}

/** 暂存路径消费点收口（consumePendingFacts 调用后）：被消费 mediaId 有原尺寸记录即告知+移除；
 *  顺带 prune 不在新 pending 集中的记录（P2-1——TTL 清扫/消费移除的 id 同步移除，驻留上界=pending
 *  60s TTL 窗，静止会话不滞留膨胀；重建过滤非迭代删除——no-delete-scan 形态规避）。 */
function settlePendingDownscaled(
  pending: ReadonlyMap<string, PendingFact>,
  consumed: Map<string, MediaFactEntry> | null,
): void {
  for (const id of consumed?.keys() ?? []) {
    const dims = pendingDownscaledDims.get(id);
    if (dims) {
      pendingDownscaledDims.delete(id);
      notifyDownscaled(id, dims.factVersion, dims);
    }
  }
  if (pendingDownscaledDims.size > 0) {
    pendingDownscaledDims = new Map([...pendingDownscaledDims].filter(([id]) => pending.has(id)));
  }
}

/** 响应消费：**到达时** doc 已引用的 mediaId 直接并入；未引用暂存 pendingFacts（fact 先于 fileId
 *  到达窗——判定基准=响应到达时的 doc 现值〔getDocIds 闭包现取〕，非请求时快照：拉取在飞窗 doc
 *  失引用/换引用的竞态下，事实按到达时刻归档——这正是「先到暂存、fileId 再到达即消费」的语义面）。 */
function ingestRows(rows: readonly MediaFactsResponseRow[], getDocIds: () => ReadonlySet<string>): void {
  const docIds = getDocIds();
  const current = useNodeStore.getState().mediaFacts;
  const direct: MediaFactsResponseRow[] = [];
  for (const row of rows) {
    if (docIds.has(row.mediaId)) {
      direct.push(row);
      // F4c：doc 已引用即到即告知（与 store 条目正交——纯 natural 行不建条目仍告知）。
      const dims = downscaledFromOf(row);
      if (dims) notifyDownscaled(row.mediaId, latestFactVersionOf(row), dims);
    } else {
      // fact 先于 fileId 到达——暂存短 TTL Map（fileId 到达即消费；TTL 过期丢到下次重连全量拉）。
      // T17 登记收口：state/natural 两类行 union 暂存（stagePendingFactRows——容量帽在其内）。
      pendingFacts = stagePendingFactRows(pendingFacts, row.mediaId, row.facts, Date.now());
      // F4c：暂存路径不即时告知（画布未引用防噪音）——记录原尺寸，fileId 到达消费窗告知。
      const dims = downscaledFromOf(row);
      if (dims) pendingDownscaledDims.set(row.mediaId, dims);
    }
  }
  if (direct.length > 0) {
    useNodeStore.setState({ mediaFacts: mergeFactRows(current, direct) });
    scheduleProcessingWatch();   // ④调度点：ingest 落 store 后——processing 入集/终态退出即重算（含 watcher 自身响应）
  }
}

/** 按 mediaId 集拉取（分批 ≤FACTS_BATCH；失败静默——重连全量拉自愈，非缓存承诺）。
 *  getDocIds=到达时 doc 引用集现取（ingestRows 头注——禁请求时快照冻结）。
 *  stale（F4c P2-2 收口：①②③④全驱动传入）：会话换代→在飞响应丢弃不 ingest（旧项目事实/
 *  降尺度 toast 不跨会话弹）。 */
async function pullIds(ids: readonly string[], getDocIds: () => ReadonlySet<string>, stale?: () => boolean): Promise<void> {
  const teamId = teamIdOf();
  for (const batch of chunk(ids, FACTS_BATCH)) {
    try {
      const rows = await fetchMediaFacts([...batch], teamId);
      if (stale?.()) return;   // 项目切换——旧会话响应丢弃（watcher epoch 守卫）
      ingestRows(rows, getDocIds);
    } catch { /* 拉取失败静默——下轮重连/lazy/watcher 自愈 */ }
  }
}

/** ③会话清空（initCollab 会话起点+teardownSession 清理链——消费 Map+pending+lazy 队列全清；
 *  ④会话纪元自增：watcher 在飞轮次响应丢弃+调度停——旧项目事实/轮询不跨会话、不跨画布驻留）。 */
export function resetMediaFacts(): void {
  sessionSeq += 1;
  stopProcessingWatch();
  watchInFlight = false;
  lastDoc = null;
  pendingFacts = new Map();
  lazyQueue = new Set();
  knownMediaIds = new Set();
  notifiedFactVersion = new Set();          // T22：(mediaId,factVersion) 告知集清空（新会话再告知）
  pendingDownscaledDims = new Map();
  // T22 收口批 M-18：feed artifact sink 解绑行随 mediaFactsRuntime 侧死码删除（唯一 sink 面=
  // runtimeStore.artifactSink——armSession 每会话重注入，闭包消费 pullMediaFactsForIds 本身
  // 受 sessionSeq 纪元守卫，跨会话驻留无害）
  if (lazyTimer) { clearTimeout(lazyTimer); lazyTimer = null; }
  useNodeStore.setState({ mediaFacts: new Map() });
}

/** ①重连全量拉（connected 边沿）：doc 全量 mediaId 集 POST；同时消费 pending 中已可达的
 *  fileId（对账窗——上次会话遗留 pending 在新 doc 引用到位时补消费）。 */
export function pullMediaFactsFull(doc: Y.Doc): void {
  if (fullPullInFlight || !doc) return;
  fullPullInFlight = true;
  const seq = sessionSeq;              // P2-2：在飞响应按会话纪元判废（拉取窗切项目→丢弃）
  void (async () => {
    try {
      const docIds = collectMediaIds(toDocLike(doc));
      knownMediaIds = new Set(docIds);
      lastDoc = doc;                 // ④活引用集源（拉取集/到达时引用判定共用）
      // pending 对账：fileId 已达的暂存 fact 补消费
      const { pending, consumed } = consumePendingFacts(pendingFacts, docIds, useNodeStore.getState().mediaFacts, Date.now());
      pendingFacts = pending;
      if (consumed) useNodeStore.setState({ mediaFacts: consumed });
      settlePendingDownscaled(pending, consumed);   // F4c：重连对账消费窗告知+prune（同 Set 去重）
      // 到达时引用集现取（getDocIds——拉取在飞窗 doc 变更竞态按到达时刻归档）
      await pullIds([...docIds], () => collectMediaIds(toDocLike(doc)), () => seq !== sessionSeq);
      scheduleProcessingWatch();      // ④尾部调度点（consume 迁入的 processing 条目入轮询集）
    } finally {
      fullPullInFlight = false;
    }
  })();
}

/** 单 mediaId 定向补拉（failed UI 重试面——VideoGenNode「刷新状态」按钮直调；F4c P0 上传延时
 *  补拉同入口）。到达时引用集现取（消费判据单源=ingestRows；定向拉取的 mediaId 多为 doc 已
 *  引用——未引用档自然入 pending）。P2-2：同受会话纪元守卫（在飞跨 reset 迟到→丢弃）。 */
export function pullMediaFactsForIds(ids: readonly string[], getDocIds?: () => ReadonlySet<string>): void {
  if (ids.length === 0) return;
  const resolve = getDocIds ?? (() => new Set(ids));
  const seq = sessionSeq;              // P2-2：定向拉取同受 epoch 守卫
  void pullIds(ids, resolve, () => seq !== sessionSeq);
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
  lastDoc = doc;                     // ④活引用集源（拉取集/到达时引用判定共用）
  // 两分支统一应用 consumed（T16 质评#3：无新引用时 pending 内可消费条目不得丢弃——
  // fact 晚于 fileId 到达的既有引用同样要在本投影批次入 store，而非等下次重连自愈）
  const { pending, consumed } = consumePendingFacts(pendingFacts, docIds, useNodeStore.getState().mediaFacts, Date.now());
  pendingFacts = pending;
  if (consumed) useNodeStore.setState({ mediaFacts: consumed });
  settlePendingDownscaled(pending, consumed);   // F4c：fileId 到达消费窗告知+prune（同 Set 去重）
  scheduleProcessingWatch();      // ④尾部调度点（pending 消费入 store 的 processing 进轮询集）
  if (fresh.length === 0) return;
  for (const id of fresh) lazyQueue.add(id);
  if (lazyTimer) clearTimeout(lazyTimer);
  lazyTimer = setTimeout(() => {
    lazyTimer = null;
    const ids = [...lazyQueue];
    lazyQueue = new Set();
    if (ids.length > 0) {
      const seq = sessionSeq;      // P2-2：lazy 补拉同受 epoch 守卫（在飞跨 reset 迟到→丢弃）
      void pullIds(ids, () => collectMediaIds(toDocLike(doc)), () => seq !== sessionSeq);
    }
  }, LAZY_PULL_DEBOUNCE_MS);
}

// ═══ Y1c T22：尺寸回写链删除（feed 事件只带 {nodeId,mediaId}→客户端查既有 media-facts 通道；
//  Y1b 上传点 12s/30s 定向补拉定时器同卡删——spec §6.7 删除清单）═════════════════════════
// 产物 media 的 facts 拉取触发面=runtime feed exec.artifact 事件（runtimeStore artifactSink 注入
// ——deliverArtifact 后 feed-hint 追平即拉，无需上传点延时定时器兜底）；上传未引用媒体的 natural
// fact（downscaledFrom 告知）随引用到达（②lazy/重连全量拉）或 feed 事件触发，重连自愈非缓存承诺。
// downscaledFrom 告知恰一次键升级=(mediaId,factVersion)（本地 notifiedFactVersion——同 media 新
// fact 版本再降尺度再告知；会话生命周期与投影同步清）。

/** F4c→T22 键升级：已告知 (mediaId,factVersion) 集（spec §6.7「downscaledFrom 按
 *  (mediaId,factVersion) 恰一次=本地 notifiedFactVersion」——旧 per-mediaId Set 作废）。 */
let notifiedFactVersion = new Set<string>();

/** 告知判据+登记（true=本次应告知——恰一次键登记）。 */
export function shouldNotifyDownscaled(mediaId: string, factVersion: string): boolean {
  const key = `${mediaId}:${factVersion}`;
  if (notifiedFactVersion.has(key)) return false;
  notifiedFactVersion.add(key);
  return true;
}

// T22 收口批 M-18：本处曾有 setRuntimeArtifactSink/dispatchRuntimeArtifacts sink 注册面（死码——
// 零生产调用方；主体批 commit message 误述「mediaFactsRuntime dispatchRuntimeArtifacts 注入」，
// 实际注入径=runtimeStore.setRuntimeArtifactSinkDirect ← canvasCollabRuntime armSession
// →pullMediaFactsForIds）。死码删除勘正——唯一 sink 面在 runtimeStore。
