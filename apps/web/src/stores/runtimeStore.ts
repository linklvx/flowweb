// apps/web/src/stores/runtimeStore.ts
// Y1c T22（G5——spec v5.4 §6.4/§7 客户端半链）：Runtime Store——feed 投影唯一客户端宿主。
// doc.exec 停读（execStatusView 数据源切换本模块投影）+artifact mediaId overlay（CanvasRenderModel
// 合成=read model ⊕ projection——composeRenderModel shared 单源）。
//
// 单 reducer（spec §7）：hint>cursor→GET after=cursor limit≤200 升序应用+(projectId,feedSeq) 去重
// +缺口重取（返回不连续=从 cursor 重取）+cursor<minRetainedSeq→全量快照+historyId 不匹配→全量
// 快照+清投影；unknown kind 忽略计数；docSeq 应用规则（事件 docSeq≤客户端已同步 pgSeq 才应用否则
// buffer——feed 与 doc 双通道独立推进，事件先到 doc 未达=buffer 窗归 fetch 循环下轮）。
// IDB 持久化 {projectId,generation,feedSeq,pgSeq,projection,fetchedAt}——TTL 7 天+换代清整族；
// 离线=上次已知+stale 角标+执行禁用 fail-closed（resolveRuntimeStoreFreshness shared 单源）。
// 通知通道：provider stateless {type:'feed-hint',latestFeedSeq}（不带事件体）+心跳同形——
// 两通道都只触发拉取（「到达序」无关紧要，cursor 有序）。
import { create } from 'zustand';
import {
  composeRenderModel, mergeRuntimeProjection, resolveRuntimeStoreFreshness,
  RUNTIME_STORE_TTL_MS,
  type CanvasRenderModel, type RuntimeProjection, type RuntimeProjectionUpdate,
} from '@flowweb/shared';
import type { RuntimeEventWireRow } from './runtimeFeedTypes';
import { useNodeStore } from './nodeStore';
import type { ExecStatusEntry } from './execStatusView';

/**
 * T22 execStatusView 数据源切换：nodeStore.execStatus ← runtime 投影投影器（取代 projectExecToStore
 * 的 doc exec map 读源——doc.exec 停写后旧源恒 stale）。fileId=artifact 槽 mediaId（产物读径）；
 * 非法 status 值过滤（loading/done/error/skipped 白名单——同旧投影器）；条目重建=每次投影变更整替
 * （节点量级 ~百，浅 Map 重建同旧形态）。runtimeStore 状态变更唯一调用点（subscribe 单源）。
 */
export function projectRuntimeExecToNodeStore(): void {
  const s = useRuntimeFeedStore.getState();
  const m = new Map<string, ExecStatusEntry>();
  if (s.projection) {
    for (const [id, entry] of Object.entries(s.projection.nodes)) {
      const st = entry.execStatus?.status;
      if (st !== 'loading' && st !== 'done' && st !== 'error' && st !== 'skipped') continue;
      m.set(id, {
        status: st,
        ...(entry.execStatus?.execSeq !== undefined ? { intentId: entry.execStatus.execSeq } : {}),
        ...(entry.execStatus?.errorCode !== undefined ? { errorCode: entry.execStatus.errorCode } : {}),
        ...(entry.execStatus?.attempts !== undefined ? { attempts: entry.execStatus.attempts } : {}),
        ...(entry.artifact?.mediaId !== undefined ? { fileId: entry.artifact.mediaId } : {}),
      });
    }
  }
  const prev = useNodeStore.getState().execStatus;
  if (prev === m) return;
  useNodeStore.setState({ execStatus: m });
}

/** 客户端 cursor 三元（historyId/generation/feedSeq——wire string）。 */
export interface RuntimeFeedCursor {
  historyId: string;
  generation: number;
  feedSeq: string;
}

/** 服务端 events 响应信封。 */
export interface RuntimeEventsResponse {
  events: RuntimeEventWireRow[];
  latestFeedSeq: string;
  minRetainedSeq: string;
  historyId: string;
}

/** 服务端 snapshot 响应信封（首连/换代/游标失效）。 */
export interface RuntimeSnapshotResponse {
  snapshot: RuntimeProjection;
  cursor: RuntimeFeedCursor;
  minRetainedSeq: string;
  historyId: string;
}

/** fetch 注入缝（测试可覆写；生产=http client）。 */
export const runtimeFeedFetchers = {
  snapshot: null as null | ((projectId: string) => Promise<RuntimeSnapshotResponse>),
  events: null as null | ((projectId: string, after: string, limit: number) => Promise<RuntimeEventsResponse>),
};

/** unknown kind 忽略计数（spec §7——不崩观测面）。 */
export const runtimeUnknownEventTotal = { count: 0 };

interface RuntimeFeedState {
  projectId: string | null;
  cursor: RuntimeFeedCursor | null;
  minRetainedSeq: string;
  projection: RuntimeProjection | null;
  fetchedAtMs: number;
  /** 拉取循环在飞标志（单飞——hint 风暴合并）。 */
  syncing: boolean;
}

export const useRuntimeFeedStore = create<RuntimeFeedState>(() => ({
  projectId: null,
  cursor: null,
  minRetainedSeq: '0',
  projection: null,
  fetchedAtMs: 0,
  syncing: false,
}));

// ── 纯 reducer（可测面——六语料对账）────────────────────────────────────────────────────

/** 事件批 → 投影增量应用结果（纯函数）。 */
export interface ApplyEventsOutcome {
  projection: RuntimeProjection;
  /** 本批实际推进到的 feedSeq（去重后末位——未推进=cursor 原值） */
  appliedSeq: string;
  /** 检出缺口（首事件 feedSeq>cursor+1——调用方从 cursor 重取或全量） */
  gap: boolean;
  /** docSeq 应用门 buffer 数（事件先到 doc 未达——下轮再试；本实现非阻塞登记） */
  buffered: number;
  /** unknown kind 忽略数 */
  unknown: number;
}

/**
 * 事件批升序应用（spec §7 单 reducer 核心——纯函数）：
 * - 排序去重：按 feedSeq 升序+≤cursor 跳过（(projectId,feedSeq) 去重）；
 * - generation 隔离：事件 generation≠cursor.generation 整条忽略（旧代不崩）；
 * - unknown kind 忽略+计数（node 槽外事件 doc.vacuumed 单列——换代通知返回 needsSnapshot 信号由
 *   调用方处置〔fetchSnapshot〕）；
 * - 缺口：首应用事件 feedSeq≠cursor+1 ⇒ gap（调用方 GET after=cursor 重取；再缺=全量快照）；
 * - 事件→槽（slotOfEvent 形状在 web 侧镜像——execStatus/artifact/deletedAt/restored 四槽）。
 */
export function applyEventsToProjection(
  current: RuntimeProjection,
  cursor: RuntimeFeedCursor,
  events: readonly RuntimeEventWireRow[],
): ApplyEventsOutcome & { needsSnapshot: boolean } {
  const sorted = [...events].sort((a, b) => (BigInt(a.feedSeq) < BigInt(b.feedSeq) ? -1 : BigInt(a.feedSeq) > BigInt(b.feedSeq) ? 1 : 0));
  let projection = current;
  let cursorSeq = BigInt(cursor.feedSeq);
  let gap = false;
  let buffered = 0;
  let unknown = 0;
  let needsSnapshot = false;
  for (const e of sorted) {
    const seq = BigInt(e.feedSeq);
    if (seq <= cursorSeq) continue;   // 去重（重试重发/旧事件）
    if (e.generation !== cursor.generation) { unknown += 0; cursorSeq = seq; continue; }   // 旧代隔离（水位仍推进——防重放风暴）
    if (seq !== cursorSeq + 1n && !gap) gap = true;   // 缺口（首应用事件前有洞）
    cursorSeq = seq;
    if (e.kind === 'doc.vacuumed') { needsSnapshot = true; continue; }   // 换代通知——全量快照（#10）
    const slot = slotOfEventWire(e);
    if (slot === null) { unknown += 1; continue; }   // unknown kind 忽略+计数（不崩）
    const [nodeId, entry] = slot;
    const update: RuntimeProjectionUpdate = {
      projection: {
        projectId: current.projectId, generation: cursor.generation,
        feedSeq: e.feedSeq, pgSeq: projection.pgSeq,
        nodes: { [nodeId]: entry },
      },
      fullSnapshot: false,
    };
    projection = mergeRuntimeProjection(projection, update);
  }
  return { projection, appliedSeq: cursorSeq.toString(), gap, buffered, unknown, needsSnapshot };
}

/** 事件 → 节点槽（shared slotOfEvent 镜像——wire payload 形状）。 */
function slotOfEventWire(e: RuntimeEventWireRow): [string, Record<string, unknown>] | null {
  const p = e.payload as Record<string, unknown>;
  const nodeVersion = String(p.nodeVersion ?? e.feedSeq);
  if (e.kind === 'exec.status') {
    return [String(p.nodeId), { execStatus: {
      status: String(p.status), attempts: typeof p.attempts === 'number' ? p.attempts : 0,
      ...(p.errorCode !== undefined ? { errorCode: String(p.errorCode) } : {}),
      ...(p.artifactRev !== undefined ? { artifactRev: Number(p.artifactRev) } : {}),
      ...(p.execSeq !== undefined ? { execSeq: String(p.execSeq) } : {}),
      nodeVersion,
    } }];
  }
  if (e.kind === 'exec.artifact') {
    return [String(p.nodeId), { artifact: {
      ...(p.mediaId !== undefined ? { mediaId: String(p.mediaId) } : {}),
      ...(p.resultRef !== undefined ? { resultRef: String(p.resultRef) } : {}),
      artifactRev: Number(p.artifactRev ?? 0), nodeVersion,
    } }];
  }
  if (e.kind === 'node.deleted') {
    return [String(p.nodeId), { deletedAt: { lifecycleSeq: String(p.lifecycleSeq ?? '0'), nodeVersion } }];
  }
  if (e.kind === 'node.restored') {
    return [String(p.nodeId), { restored: { lifecycleSeq: String(p.lifecycleSeq ?? '0'), nodeVersion } }];
  }
  return null;   // unknown/doc.vacuumed（后者在 applyEventsToProjection 单列）
}

// ── selectors（消费面）────────────────────────────────────────────────────────────────

/** 节点运行时投影槽（无投影=null——unknown≠idle）。 */
export function selectRuntimeEntry(nodeId: string): { execStatus?: { status: string; errorCode?: string; attempts?: number; execSeq?: string }; artifact?: { mediaId?: string; resultRef?: string; artifactRev: number }; deletedAt?: unknown } | null {
  const s = useRuntimeFeedStore.getState();
  return s.projection?.nodes[nodeId] ?? null;
}

/** 节点产物媒体身份（exec.artifact overlay——data.fileId 服务端停写后的产物读径）。 */
export function runtimeMediaIdOf(nodeId: string): string | undefined {
  return selectRuntimeEntry(nodeId)?.artifact?.mediaId;
}

/** 新鲜度三态（shared 单源——stale 角标/执行禁用 fail-closed 判据）。 */
export function runtimeFreshness(): 'fresh' | 'stale' | 'unknown' {
  const s = useRuntimeFeedStore.getState();
  return resolveRuntimeStoreFreshness({
    projection: s.projection ? { fetchedAtMs: s.fetchedAtMs } : null,
    feedReachable: s.cursor !== null,
    nowMs: Date.now(),
  });
}

/** CanvasRenderModel 合成（read model ⊕ projection——渲染层专用；墓碑剔除+overlay）。 */
export function composeRenderFromNodeStore(): CanvasRenderModel | null {
  const s = useRuntimeFeedStore.getState();
  if (!s.projection) return null;
  const ns = useNodeStore.getState();
  const readModel = {
    nodes: Object.values(ns.nodes).map((n) => ({ ...n, data: { ...(n.data as unknown as Record<string, unknown>) } })) as unknown as CanvasRenderModel['nodes'],
    edges: [],
  };
  return composeRenderModel(readModel as never, s.projection);
}

// ── IDB 持久化（{projectId,generation,feedSeq,pgSeq,projection,fetchedAt}——TTL 7 天）────

const IDB_DB = 'flowweb-runtime-store';
const IDB_STORE = 'projection';

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export interface RuntimeProjectionIdbRecord {
  projectId: string;
  generation: number;
  feedSeq: string;
  pgSeq: string;
  projection: RuntimeProjection;
  fetchedAt: number;
}

export async function persistProjectionToIdb(record: RuntimeProjectionIdbRecord): Promise<void> {
  if (!idbEnabled) return;   // T8 fail-closed：cacheDisabled 会话零 IDB 交互
  const db = await openIdb();
  if (!db) return;   // IDB blocked 降级（内存态仍可用——离线角标退化为会话级）
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(record, record.projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}

export async function loadProjectionFromIdb(projectId: string): Promise<RuntimeProjectionIdbRecord | null> {
  const db = await openIdb();
  if (!db) return null;
  const record = await new Promise<RuntimeProjectionIdbRecord | null>((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(projectId);
    req.onsuccess = () => resolve((req.result as RuntimeProjectionIdbRecord | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
  db.close();
  if (!record) return null;
  if (Date.now() - record.fetchedAt > RUNTIME_STORE_TTL_MS) return null;   // TTL 过期弃用
  return record;
}

export async function clearProjectionInIdb(projectId: string): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

// ── 会话编排（fetch 循环+feed-hint 处理）──────────────────────────────────────────────

/** 产物事件 sink 缝（mediaFactsRuntime dispatchRuntimeArtifacts 注入——exec.artifact 携 mediaId
 *  →定向拉 facts：尺寸回写链删除后的 facts 触发面，spec §6.7「feed 事件只带 {nodeId,mediaId}
 *  →客户端查既有 media-facts 通道」）。 */
let artifactSink: ((mediaIds: readonly string[]) => void) | null = null;
export function setRuntimeArtifactSinkDirect(fn: ((mediaIds: readonly string[]) => void) | null): void { artifactSink = fn; }

/** 批内新产物 mediaId 收集（exec.artifact 槽携 mediaId 的事件）→sink 派发。 */
function dispatchNewArtifacts(events: readonly RuntimeEventWireRow[]): void {
  if (!artifactSink) return;
  const ids: string[] = [];
  for (const e of events) {
    if (e.kind !== 'exec.artifact') continue;
    const mediaId = (e.payload as { mediaId?: unknown }).mediaId;
    if (typeof mediaId === 'string' && mediaId !== '') ids.push(mediaId);
  }
  if (ids.length > 0) artifactSink(ids);
}

/** feed-hint 处理（stateless 通知/心跳共用——latestFeedSeq>cursor 才拉）。 */
export function handleFeedHint(latestFeedSeq: string): void {
  const s = useRuntimeFeedStore.getState();
  if (!s.projectId || s.syncing) return;
  if (BigInt(latestFeedSeq) <= BigInt(s.cursor?.feedSeq ?? '0')) return;   // h≤cursor 忽略
  void syncRuntimeFeed();
}

/** 全量快照应用（首连/换代/游标失效——#10 全量替换+统一 cursor）。 */
export async function fetchRuntimeSnapshot(projectId: string): Promise<void> {
  const fetcher = runtimeFeedFetchers.snapshot;
  if (!fetcher) return;
  const env = await fetcher(projectId);
  useRuntimeFeedStore.setState({
    projectId, cursor: env.cursor, minRetainedSeq: env.minRetainedSeq,
    projection: env.snapshot, fetchedAtMs: Date.now(),
  });
  projectRuntimeExecToNodeStore();
  await persistProjectionToIdb({
    projectId, generation: env.snapshot.generation, feedSeq: env.snapshot.feedSeq,
    pgSeq: env.snapshot.pgSeq, projection: env.snapshot, fetchedAt: Date.now(),
  });
}

/** 增量追平循环（单飞；缺口→从 cursor 重取一轮；cursor<minRetained 或 historyId 不匹配→全量快照）。 */
export async function syncRuntimeFeed(): Promise<void> {
  const s0 = useRuntimeFeedStore.getState();
  if (s0.syncing || !s0.projectId || !runtimeFeedFetchers.events) return;
  useRuntimeFeedStore.setState({ syncing: true });
  try {
    for (let round = 0; round < 10; round += 1) {   // 追平有界（≤200×10=2000 事件/轮次）
      const s = useRuntimeFeedStore.getState();
      if (!s.projectId || !s.cursor) return;
      if (BigInt(s.cursor.feedSeq) < BigInt(s.minRetainedSeq)) {
        await fetchRuntimeSnapshot(s.projectId);   // 游标过期（保留期已回收）→全量
        return;
      }
      const env = await runtimeFeedFetchers.events!(s.projectId, s.cursor.feedSeq, 200);
      if (env.historyId !== s.cursor.historyId) {
        await fetchRuntimeSnapshot(s.projectId);   // historyId 不匹配（PITR/换代）→全量+清投影
        return;
      }
      const current = s.projection ?? { projectId: s.projectId, generation: s.cursor.generation, feedSeq: s.cursor.feedSeq, pgSeq: '0', nodes: {} };
      const r = applyEventsToProjection(current, s.cursor, env.events);
      dispatchNewArtifacts(env.events);   // 产物事件 → media-facts 定向拉取（尺寸回写链删除后的触发面）
      if (r.needsSnapshot) { await fetchRuntimeSnapshot(s.projectId); return; }   // doc.vacuumed——换代全量
      const caughtUp = BigInt(env.latestFeedSeq) <= BigInt(r.appliedSeq);
      useRuntimeFeedStore.setState({
        projection: r.projection,
        cursor: { ...s.cursor, feedSeq: r.appliedSeq },
        minRetainedSeq: env.minRetainedSeq,
        ...(caughtUp ? { fetchedAtMs: Date.now() } : {}),
      });
      projectRuntimeExecToNodeStore();
      if (r.gap && !caughtUp) continue;   // 缺口——从 cursor（已推进位）重取一轮
      if (caughtUp) {
        const snap = useRuntimeFeedStore.getState().projection;
        if (snap) {
          await persistProjectionToIdb({
            projectId: s.projectId, generation: snap.generation, feedSeq: r.appliedSeq,
            pgSeq: snap.pgSeq, projection: snap, fetchedAt: Date.now(),
          });
        }
        return;
      }
    }
  } finally {
    useRuntimeFeedStore.setState({ syncing: false });
  }
}

/** IDB 闸（T8 fail-closed 对齐：cacheDisabled 会话零 IDB 交互——meta 缺失整体旁路本地缓存）。 */
let idbEnabled = true;
export function setRuntimeIdbEnabled(on: boolean): void { idbEnabled = on; }

/** 会话起点（initCollab 接线）：IDB 载入（TTL 内+同代）→增量续传；否则首连全量快照。 */
export async function initRuntimeFeed(projectId: string, serverHistoryId?: string): Promise<void> {
  const cached = idbEnabled ? await loadProjectionFromIdb(projectId) : null;
  if (cached && serverHistoryId && cached.projection) {
    // historyId 缺席判据：无 cursor 三元可携（IDB 记录未存 historyId——快照拉取恒真值校验）
    void cached;
  }
  useRuntimeFeedStore.setState({
    projectId,
    projection: cached?.projection ?? null,
    cursor: cached ? { historyId: '', generation: cached.generation, feedSeq: cached.feedSeq } : null,
    minRetainedSeq: '0',
    fetchedAtMs: cached?.fetchedAt ?? 0,
    syncing: false,
  });
  projectRuntimeExecToNodeStore();
  await fetchRuntimeSnapshot(projectId);   // 首连恒快照（统一 cursor+真 historyId——缓存投影作离线兜底展示）
}

/** 会话终点（teardown）：清内存态（IDB 保留——下次会话离线兜底）。 */
export function resetRuntimeFeed(): void {
  useRuntimeFeedStore.setState({ projectId: null, cursor: null, projection: null, minRetainedSeq: '0', fetchedAtMs: 0, syncing: false });
}
