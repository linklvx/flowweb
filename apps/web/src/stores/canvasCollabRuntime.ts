// apps/web/src/stores/canvasCollabRuntime.ts
// 画布 Yjs 实时协作桥（spec T6：store ↔ server doc 双向同步 + origin 防回环）。
// ⚠️ 循环依赖裁定（同 canvasStore.ts）：顶层仅 import 声明/函数定义/纯常量。
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import isEqual from 'fast-deep-equal';
import { useCanvasStore } from './canvasStore';
import { useNodeStore, toAppNode } from './nodeStore';
import { pickStructNodes, pickStructEdges } from './canvasHistory';
// 循环依赖裁定允许：canvasUndo 顶层仅 import yjs + 纯常量/函数定义
import { Origin, attachUndoManager, detachUndoManager } from './canvasUndo';
export { Origin } from './canvasUndo';
import { projectCanvasNodes } from '@/utils/projectCanvasNodes';
import { isAutoEdgeId } from './autoEdgeIds';
import { normalizeLoadedCanvas, shouldAutoRefit } from '@flowweb/shared';
import { fillDoc, readCanvasFromDoc, applyRecordToYMap } from '@/collab/ydocBuilder';
import { AwarenessBridge } from '@/collab/awareness';
// 批1-6（B2 ③）：恢复对齐查表（循环依赖同裁定：executionApi 的 getStateVector 与本模块互为顶层
// import 声明，双方均函数体内使用——ESM 本地绑定延迟求值安全）
import { fetchNodeIntents } from '@/api/executionApi';
import type { ExecStatusEntry } from './execStatusView';
// 批1-0 transport 薄层（门 B 裁决）：自持传输——瞬态恢复=reconnect()，kick 方案 ㉕/㉝ 约束已删
import { createReconnectingWebSocket, type ReconnectHandle } from '@/collab/reconnectTransport';
import { hydrateNodes } from '@/utils/nodeOrder';
import { readViewport } from '@/utils/viewportPersistence';
// 批1-1：连接状态机纯函数（零 Math.random——jitter 阈值生成后入参传入）
import { reduce, TICK_MS, STALE_INBOUND_MS, FAST_LANE_MS, RECOVER_BACKOFF_MS, type MachineInputs, type MachineOutput } from './connectionMachine';
// 批1-5：诊断环形缓冲 + kill switch（零依赖纯模块）
import { recordCollabDiag, isAutoRecoverDisabled } from '@/utils/collabDiagnostics';

function collabUrl(): string {
  // 开发环境直连 collab 端口（vite ws proxy 对 hocuspocus 消息路由不透明）；
  // 生产走 Nginx /collab WS upgrade（完整 headers 转发）
  // DEV 态 ?collab=<port> 覆盖默认端口——双实例验收时浏览器 B 连实例 B 的 collab 端口；
  // 用 location.hostname 保持同站（127.0.0.1 验收 iframe 与跨站 cookie 限制）
  if (import.meta.env.DEV) {
    const port = new URLSearchParams(location.search).get('collab');
    return `ws://${location.hostname}:${port ?? '3001'}`;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/collab`;
}

let doc: Y.Doc | null = null;
let provider: HocuspocusProvider | null = null;
let awarenessBridge: AwarenessBridge | null = null;
let unbindStores: (() => void) | null = null;

/** 测试缝（只读）：读 doc 断言用。勿用于业务逻辑——业务走订阅。 */
export function getDoc(): Y.Doc | null {
  return doc;
}

/** 当前协作会话的 awareness 桥（无连接时 null，视图层按需判空） */
export function getAwareness(): AwarenessBridge | null {
  return awarenessBridge;
}

/** 批0d beforeunload 谓词半边（provider 公开 API）；批1-3 并入 rebuildPending
 *  （终态重建窗口旧实例 hasUnsyncedChanges 不可读——标记武装兜住 beforeunload） */
export function hasUnsyncedCanvasChanges(): boolean {
  return rebuildPending || (provider?.hasUnsyncedChanges ?? false);
}

/** A1 影子产物读取（决策 2：spec"必须读 doc"——前端内存 ydoc 直读，零网络）。
 *  返回 null = doc 无该节点或尚无 fileId（ai-download 异步回写未完成）。
 *  R4-10：doc 形状已实证——fillDoc（ydocBuilder.ts）/后端 writeNodeData（collab-document.service.ts）
 *  均为 nodes→Y.Map、data→Y.Map、键名 fileId；instanceof 守卫替代 as 强转（结构异常返回 null 不抛）。 */
export function readNodeFileIdFromDoc(nodeId: string): string | null {
  if (!doc) return null;
  const node = doc.getMap('nodes').get(nodeId);
  if (!(node instanceof Y.Map)) return null;
  const data = node.get('data');
  if (!(data instanceof Y.Map)) return null;
  const fid = data.get('fileId');
  return typeof fid === 'string' ? fid : null;
}
let remoteApplyTimer: ReturnType<typeof setTimeout> | null = null;
/** 批1-5 会话对象（currentPid/initSeq 归并）：pid=当前项目、startedAt=会话起点、epoch=单调会话代数。
 *  epoch 判活（I-1）：同 pid 无法区分陈旧调用（退出重进/StrictMode 双挂载同 pid）——
 *  超时 timer 恢复时 epoch 不匹配即陈旧调用，不得走超时兜底销毁新会话。
 *  sessionEpoch 独立于 session 生命周期（session 置空后仍递增——防同代数复用） */
interface CollabSession { pid: string; startedAt: number; epoch: number }
let session: CollabSession | null = null;
let sessionEpoch = 0;

// 批0a：connStatus 派生（缺陷 A 根修）——唯一写点 recomputeConnStatus + 代际制。
// 载体按决策门 A 裁决=候选 1（inboundAttemptId===attemptId，'message' 驱动）——
// 真协议实测 resolve 与 message 同帧同栈，两候选行为等价；候选 1 仅依赖公开事件。
// lastWsStatus 用事件缓存值（provider 无 status 字段——库契约，判据不得读 ws.connectionAttempt）。
// 纯派生纪律：代际跃迁（attemptId++/入站重置）是事件处理器的事——
// recomputeConnStatus 只读不写模块状态，"唯一写点=connStatus" 的声明才成立。
let lastWsStatus: 'connecting' | 'connected' | 'disconnected' = 'connecting';
let attemptId = 0;
let inboundAttemptId = -1;

// 批1-1：watchdog 心跳 timer（会话清理链——destroyCollab 统一 clearInterval；浏览器无 unref）
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// 批1-1 watchdog 会话变量（批1-3 上移模块级：bindProviderListeners 与心跳共享——
// 终态重建后新监听闭包写同一份活状态；initCollab 会话起点复位，旧会话计时/退避不携带）
let lastConnectedAt = 0;             // connected 到达边沿（快线计时起点）
let lastInboundAt = 0;               // 入站新鲜度（'message' 驱动刷新）
let unhealthySince: number | null = null; // 从未健康也从 t0 计时（startedAt 语义——首帧黑洞/挂起握手）
let recoveryAttempts = 0;
let lastRecoveryAt = 0;

// 批1-2：1012 计划内重启窗口（close code 1012 起 30s 内 UI 不升 banner——钳 hint）
let plannedRestartUntil = 0;

// 批1-3：transport 薄层句柄（createProvider 每次注入新 transport；瞬态恢复消费）
let transportHandle: ReconnectHandle | null = null;
// 批1-3：终态重建窗口标记（旧实例 hasUnsyncedChanges 不可读——标记武装；
// 清除=unsyncedChanges number===0（实例绑定）+ 3s tick 兜底——批1-4）
let rebuildPending = false;

/** 批1-3 两级恢复原语（瞬态传输级 / 终态会话级重建）。
 *  级别按结构状态选（G1）：!isAttached || !ws.shouldConnect ⇒ 终态——瞬态 reconnect 在此是空操作；
 *  对象命名空间=watchdog 间接调用层：vi.spyOn(recovery, 'recoverConnection') 对模块内
 *  直连函数调用不可达（ESM 本地绑定），命名空间属性查找使测试缝可达（装置可达性裁定）。 */
let recovering = false; // 单飞：并发两调只执行一次（terminal 路径 await destroy 打开真实互斥窗口）
export const recovery = {
  async recoverConnection(): Promise<void> {
    if (recovering) return;                     // 单飞
    const p = provider; if (!p) return;
    // 守卫：hidden/offline 不下手——回前台/上线由 visibilitychange/online 复评（模块级一次挂）
    // +watchdog 下轮自然复评；terminal（wsAuthNotice 批2 接入）
    if (typeof document !== 'undefined' && document.hidden) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const ws: any = (p as any).configuration?.websocketProvider;
    const terminal = !p.isAttached || !ws?.shouldConnect; // 级别按结构状态选（G1）
    try {
      recovering = true;
      recordCollabDiag('recover_triggered', { level: terminal ? 'terminal' : 'transient' }); // 批1-5
      if (terminal) {
        // —— 终态：会话级重建 ——
        const d = doc!;
        const clientId = p.awareness?.clientID ?? 0;
        // destroy 与 destroyCollab 同款防御式 await——同步函数（契约锁㉔）但 await 打开
        // 单飞互斥窗口；destroy 序列推 clock 至 N+2（㉖）
        try { await p.destroy(); } catch { /* 已销毁 */ }
        // clock 播种读值时点=destroy 之后（契约锁㉖——N+2 恒安全：>服务端/对端门槛上界）
        const clockSeed = p.awareness?.meta?.get(clientId)?.clock ?? 0;
        createProvider(d);                        // 工厂：新 provider 同 doc+监听重挂+transport 注入
        const np = provider!;
        np.awareness?.meta.set(np.awareness.clientID, { clock: clockSeed, lastUpdated: Date.now() });
        awarenessBridge?.attach(np);              // bridge 稳定对象迁移（消费方零改动）
        awarenessBridge?.replayLocalUser();       // 重放完整态（禁 {}——R24；null 则 no-op）
        rebuildPending = true;                    // 旧实例 hasUnsyncedChanges 不可读——标记武装（1-4 清除）
      } else {
        // —— 瞬态：传输级 reconnect（门 B 裁决——kick 方案/㉕㉝ 约束已删）——
        // needKick=false（OPEN socket）：close(1000) 即触发库 onClose 分支自持重连
        // （真协议实测 ws-polyfill.gate：created+1+重新 synced，调用方零库句柄操作）；
        // needKick=true（无实例/CONNECTING/CLOSED）：ws.connect() 确定性取消在飞 attempt 重建
        const needKick = transportHandle?.reconnect() ?? true;
        if (needKick) void ws?.connect?.();
      }
    } finally { recovering = false; }
  },
};

/** 批1-1：恢复 UI 分级落位（canvasStore.connUi；hint 非阻断、banner 批1-5 SyncBanner 消费）。
 *  批1-2 钳制：计划内重启窗口（plannedRestartUntil）内 banner 降 hint——服务端已知重启不吓用户 */
function updateConnectionUi(ui: MachineOutput['ui']) {
  const clamped = ui === 'banner' && Date.now() < plannedRestartUntil ? 'hint' : ui;
  const s = useCanvasStore.getState();
  if (clamped !== s.connUi) useCanvasStore.setState({ connUi: clamped });
}

/** 批1-6（B2/F2）：doc exec map → nodeStore.execStatus 展示投影（exec map 服务端唯一写者——本端零写）。
 *  浅 Map 重建（节点量级 ~百，简单够用）：条目删除（GC）随重建自然回落 data.status；
 *  observeDeep 覆盖条目内层键变更；会话清理无需 unobserve——doc.destroy 连带。 */
function projectExecToStore(d: Y.Doc): void {
  const m = new Map<string, ExecStatusEntry>();
  for (const [id, v] of d.getMap('exec').entries()) {
    if (!(v instanceof Y.Map)) continue;
    const status = v.get('status');
    if (status !== 'loading' && status !== 'done' && status !== 'error') continue;
    const str = (k: string) => (typeof v.get(k) === 'string' ? (v.get(k) as string) : undefined);
    m.set(id, { status, jobId: str('jobId'), intentId: str('intentId'), error: str('error'), fileId: str('fileId') });
  }
  useNodeStore.setState({ execStatus: m });
}

/** 批1-6（B2 ③）：断连/刷新后执行态恢复对齐——只读对齐（不写回 doc exec map，F2 客户端零 exec 写）。
 *  候选= data.status==='loading' 且 exec 投影无条目（服务端已写 exec=已接管该节点状态，不重复对齐；
 *  投影仅收录合法 status 值——非法值条目不在 Map，归入"无条目"）。
 *  查表语义=最新意图行定夺（createdAt desc 首行）：SUCCEEDED→done / FAILED→error / RUNNING/VOIDED→不写
 *  （不回退不误置，保持 loading）。触发点= status connected 边沿 + visibilitychange 回前台。
 *  去抖语义=单飞（in-flight 互斥）：并发触发只跑一轮；完成后再次触发重跑（幂等——同一终态重复写收敛）。 */
let alignInFlight = false;
async function alignExecFromIntents(): Promise<void> {
  if (alignInFlight || !session) return;
  const pid = session.pid;
  const ns = useNodeStore.getState();
  const candidates = Object.values(ns.nodes).filter(
    (n) => (n.data as { status?: string } | undefined)?.status === 'loading' && !ns.execStatus.has(n.id),
  );
  if (candidates.length === 0) return;
  alignInFlight = true;
  try {
    for (const node of candidates) {
      const rows = await fetchNodeIntents(pid, node.id).catch(() => null); // 单节点失败不阻断其余
      const latest = rows?.[0];
      if (latest?.status !== 'SUCCEEDED' && latest?.status !== 'FAILED') continue;
      const entry: ExecStatusEntry = latest.status === 'SUCCEEDED'
        ? { status: 'done', intentId: latest.intentId, fileId: latest.resultRef ?? undefined }
        : { status: 'error', intentId: latest.intentId, error: latest.error ?? undefined };
      useNodeStore.setState((s) => ({ execAligned: new Map(s.execAligned).set(node.id, entry) }));
    }
  } finally {
    alignInFlight = false;
  }
}

/** 批0b deletion baseline：只删"上次投影内、本次消失"的 key——doc 独有（影子/对端刚写）不删。
 *  它就是 delta 写的删除半边（批4b 同规则）；initCollab 每会话重置 null（首同步 doc 为源不删）。 */
let prevNodeIds: Set<string> | null = null;
let prevEdgeIds: Set<string> | null = null;

/** 测试缝（只读复位）：baseline.spec 防用例顺序依赖——getDoc 先例 */
export function _resetBaselineForTest() {
  prevNodeIds = null;
  prevEdgeIds = null;
}

/** connStatus 唯一写点：healthy = ws connected 事件 + isAuthenticated/isSynced 公开布尔
 *  + 本 attempt 已有真入站（message——4408 形态下布尔陈旧 true，唯代际判据挡得住早宣）。
 *  唯一豁免：initCollab 超时分支直写 'offline'——destroyCollab 已断事件通道且 provider=null，
 *  recompute 无法表达该终态（批 0e lint-gate 白名单已含此例外）。 */
export function recomputeConnStatus() {
  const p = provider;
  const healthy = !!p
    && lastWsStatus === 'connected'
    && p.isAuthenticated === true
    && p.isSynced === true
    && inboundAttemptId === attemptId;
  const s = useCanvasStore.getState();
  const next = healthy ? 'connected' : (lastWsStatus === 'disconnected' ? 'offline' : 'connecting');
  if (next !== s.connStatus) useCanvasStore.setState({ connStatus: next });
}

/** store 结构投影（canvasStore 为基准 + nodeStore data，与旧 buildSyncPayload 同形）。
 *  data 按所有权分型（F42）委托 projectCanvasNodes 单源——组取 cs/普通节点取 ns+回落。
 *  断言说明：NodeData interface 无隐式索引签名，不结构兼容 Record<string, unknown>——
 *  运行时 data 就是普通对象，消费侧（fillDoc/applyRecordToYMap 只做 Object.entries）安全 */
function storeProjection() {
  const cs = useCanvasStore.getState();
  const ns = useNodeStore.getState();
  return {
    nodes: projectCanvasNodes(cs.nodes as any, ns.nodes as any),
    edges: cs.edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

/** 差异转 ydoc 事务（细粒度：新增/删除按 id，更新逐键；position 独立子 Map；data 逐键）。
 *  差异转 ydoc 事务——doc 显式形参化（syncAutoEdgesToDoc 同款先例）：bindBridge 内传模块 doc，
 *  测试直接 new Y.Doc() 驱动（G3/W7 红转绿门槛的装置基础）。 */
export function syncStoreToDoc(d: Y.Doc, origin: string) {
  const { nodes, edges } = storeProjection();
  const nodesMap = d.getMap('nodes');
  const edgesMap = d.getMap('edges');
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeIds = new Set(edges.map((e) => e.id));

  d.transact(() => {
    for (const id of [...nodesMap.keys()]) {
      if (nodeIds.has(id)) continue;
      if (prevNodeIds !== null && prevNodeIds.has(id)) nodesMap.delete(id);
    }
    for (const n of nodes) {
      const existing = nodesMap.get(n.id);
      if (!(existing instanceof Y.Map)) {
        fillDoc(d, [n], []);
        continue;
      }
      // 信封键（type/parentId/width/height/position）增量收敛到 applyRecordToYMap（全键 diff 守卫——
      // 同值 no-op 防 doc 膨胀）；data 逐键 diff 是业务域，留本函数原有逻辑
      applyRecordToYMap(existing, n);
      const data = existing.get('data');
      if (data instanceof Y.Map) {
        const incoming = n.data ?? {};
        for (const k of [...data.keys()]) {
          if (!(k in incoming)) data.delete(k);
        }
        for (const [k, v] of Object.entries(incoming)) {
          if (!isEqual(data.get(k), v)) data.set(k, v);
        }
      }
    }
    for (const id of [...edgesMap.keys()]) {
      if (isAutoEdgeId(id)) continue; // auto 边删除只归 syncAutoEdgesToDoc（防订阅误删）
      if (!edgeIds.has(id) && prevEdgeIds !== null && prevEdgeIds.has(id)) edgesMap.delete(id);
    }
    for (const e of edges) {
      if (isAutoEdgeId(e.id)) continue; // auto 边新增/更新只归 syncAutoEdgesToDoc
      const existing = edgesMap.get(e.id);
      if (!(existing instanceof Y.Map)) {
        fillDoc(d, [], [e]);
        continue;
      }
      if (existing.get('source') !== e.source) existing.set('source', e.source ?? '');
      if (existing.get('target') !== e.target) existing.set('target', e.target ?? '');
    }
  }, origin);
  prevNodeIds = new Set(nodeIds);
  prevEdgeIds = new Set(edgeIds);
}

/** 自动边全量对账（无业务参数——id 自编码 editNodeId）：store 侧 auto 边为期望态，doc 补齐增删。
 *  独立 transact origin=AutoEdge（不入画布撤销栈）。幂等——覆盖删节点级联/手删 auto 边/编辑器 reconcile 全场景。 */
export function syncAutoEdgesToDoc(d: Y.Doc) {
  const expected = useCanvasStore.getState().edges
    .filter((e) => isAutoEdgeId(e.id))
    .map((e) => ({ id: e.id, source: e.source, target: e.target }));
  const edgesMap = d.getMap('edges');
  const expectedIds = new Set(expected.map((e) => e.id));
  const docAutoIds = [...edgesMap.keys()].filter(isAutoEdgeId);
  const toAdd = expected.filter((e) => !edgesMap.get(e.id));
  const toRemove = docAutoIds.filter((id) => !expectedIds.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) return;
  d.transact(() => {
    for (const e of toAdd) {
      const m = new Y.Map();
      m.set('source', e.source);
      m.set('target', e.target);
      edgesMap.set(e.id, m);
    }
    for (const id of toRemove) edgesMap.delete(id);
  }, Origin.AutoEdge);
}

/** A1 影子事务短路判定（Plan 1 Task 9 固化：origin 不过网，跨网判据必须用 id 前缀）：
 *  本次 events 全部仅涉及 nodes map 上 shadow- 前缀节点（含深层 data 写回）→ 跳过 applyDocToStore 全量重建（防闪烁，spec 验收 22） */
export function isShadowOnlyEvents(events: Y.YEvent<any>[], nodesMap: Y.Map<any>): boolean {
  for (const ev of events) {
    let root: any = ev.target;
    while (root?.parent != null) root = root.parent;
    if (root !== nodesMap) return false; // edges/其他结构事件不短路
    if (ev.path.length > 0) {
      const nodeKey = ev.path[0];
      if (typeof nodeKey !== 'string' || !nodeKey.startsWith('shadow-')) return false;
    } else {
      // nodes map 顶层 set/delete：所有变更 key 须为 shadow- 前缀
      let hasKey = false;
      for (const k of ev.keys.keys()) {
        hasKey = true;
        if (!k.startsWith('shadow-')) return false;
      }
      if (!hasKey) return false;
    }
  }
  return true;
}

/** server doc → store——同款形参化（undo/乒乓断言的读回驱动） */
export function applyDocToStore(d: Y.Doc) {
  const { nodes, edges } = readCanvasFromDoc(d);
  // R1b Task 17：加载几何兜底（守恒归位，幂等早退）——hydrate 与 content 构造都吃 seeded
  const seeded = normalizeLoadedCanvas(nodes);
  useCanvasStore.setState({
    nodes: hydrateNodes(seeded.map((n: any) => ({
      ...n, width: n.width ?? undefined, height: n.height ?? undefined,
    }))) as any,
    edges: edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target })),
  });
  // S1（v5）：hydrate 后（derivations+refit 前）捕获结构投影——几何维护者 refitExpandedGroups 改了
  // 组框才有 diff 才回写 doc（Origin.Geometry 不入撤销栈；normalizeLoadedCanvas 的缺几何补缺是
  // 确定性纯函数、每轮内存重建一致，无需写 doc）。节点比较即可：edges 在本管线只加非结构 hidden 键
  const before = pickStructNodes(useCanvasStore.getState().nodes);
  useCanvasStore.getState().applyGroupDerivations();
  refitExpandedGroups();
  // C1（Task 17 审查）：ns 刷新必须在 S1 回写之前——storeProjection→projectCanvasNodes 对普通节点
  // data 是 ns 优先，回写时 ns 还是旧值会把协作者刚提交的编辑从 doc 回退（doc=旧/本端=新的分裂脑）。
  // pickStructNodes 只读 cs.nodes，重排对 diff 语义零影响。
  useNodeStore.setState({ nodes: Object.fromEntries(seeded.map((n) => [n.id, toAppNode(n)])) });
  if (!isEqual(before, pickStructNodes(useCanvasStore.getState().nodes))) {
    syncStoreToDoc(d, Origin.Geometry);
  }
}

/** 订阅双 store → ydoc（origin 标记 local-user：Y.UndoManager trackedOrigins 唯一入栈者） */
function bindBridge(): () => void {
  const unsubCs = useCanvasStore.subscribe((state, prev) => {
    if (state.isHydrating || prev.isHydrating) return;
    if (state.projectId !== prev.projectId) return;
    // diff 输入只有 nodes/edges——引用未变早退（严格等价：同引用 ⇒ pickStruct 投影输出相同
    // ⇒ isEqual 恒真 ⇒ 原逻辑本就 no-op），防 UI 态翻转白跑 O(n) 投影+深比较
    if (state.nodes === prev.nodes && state.edges === prev.edges) return;
    const changed = !isEqual(pickStructNodes(state.nodes), pickStructNodes(prev.nodes))
      || !isEqual(pickStructEdges(state.edges), pickStructEdges(prev.edges));
    if (changed) {
      syncAutoEdgesToDoc(doc!); // 先 auto 边对账（覆盖删节点级联留孤儿场景），再常规同步（其内部已跳过 auto 前缀）
      syncStoreToDoc(doc!, Origin.LocalUser);
    }
  });
  const unsubNs = useNodeStore.subscribe((state, prev) => {
    if (useCanvasStore.getState().isHydrating) return;
    if (state.nodes !== prev.nodes) syncStoreToDoc(doc!, Origin.LocalUser);
  });
  return () => { unsubCs(); unsubNs(); };
}

/** onRemote fromLocal 判定用（M4：每事件字面量数组分配的模块级提升） */
const LOCAL_ORIGINS = [Origin.LocalUser, Origin.Geometry];

/** 批1-3：七监听单函数（契约锁㉔——provider.destroy 是 removeAllListeners+awareness.destroy，
 *  终态重建后必须重挂；initCollab 与终态重建共用同一函数）。七事件：status/authenticated/
 *  synced/message/close/unsyncedChanges（1-4：number===0 清 rebuildPending）。
 *  事件接线（批0a）：代际跃迁在此——离开 connected ⇒ 旧 attempt 的入站不再计入新 attempt
 *  （防 4408 形态首帧早宣：库自发强关不发 close，provider 布尔陈旧 true，唯代际判据挡得住）；
 *  'connecting' 边沿重置关死"旧 socket 迟到帧写入新代际"竞态。connStatus 一律走唯一写点。 */
function bindProviderListeners(p: HocuspocusProvider): void {
  p.on('status', ({ status }: any) => {
    if (status !== lastWsStatus && lastWsStatus === 'connected') attemptId++;
    if (status === 'connected' && lastWsStatus !== 'connected') {
      lastConnectedAt = Date.now(); // 批1：快线计时起点（connected 到达边沿）
      void alignExecFromIntents(); // 批1-6（B2 ③）：connect 边沿恢复对齐（connected 双发仅第一发是边沿）
    }
    if (status === 'connecting') inboundAttemptId = -1;
    if (status !== lastWsStatus) recordCollabDiag('ws_status', { from: lastWsStatus, to: status }); // 批1-5：迁移记录（双发 connected 不重复）
    lastWsStatus = status;
    recomputeConnStatus();
  });
  p.on('authenticated', () => recomputeConnStatus());
  p.on('synced', () => recomputeConnStatus());
  p.on('message', () => { inboundAttemptId = attemptId; lastInboundAt = Date.now(); recomputeConnStatus(); });
  p.on('close', ({ event }: any) => {
    recomputeConnStatus();
    // 批1-2：1012=服务端计划内重启 close code（批3 服务端落地前不会真出现——客户端分支先在）。
    // 判定走 close 事件 event.code（status 事件无 code；4408 强关不 emit close——不混用）。
    if (event?.code === 1012) {
      plannedRestartUntil = Date.now() + 30_000;
      // 1~3s 短退避首连。1012 时 socket 已 CLOSED——transport.reconnect() 只会返回 needKick=true
      // 再回到 ws.connect()（批1-0 落地时裁定：此处直连库句柄等价且更短）
      setTimeout(() => void (provider?.configuration?.websocketProvider as any)?.connect?.(),
        1000 + Math.random() * 2000);
    }
  });
  // 批1-4：rebuildPending 清除主判据——unsyncedChanges number===0（decrement 归零无条件 emit，
  // HP:333-335）。实例绑定（p === provider）：终态重建竞态窗口内旧实例迟到事件不得清新实例标记。
  p.on('unsyncedChanges', ({ number }: any) => {
    if (number === 0 && p === provider) rebuildPending = false;
  });
}

/** 批1-3：provider 工厂（initCollab 会话起点与终态重建共用）——批1-0 transport 薄层注入
 *  （门 B 四点验证形态：库每次重连经注入类新建 socket，handle 跟踪 current）+ 七监听挂载。 */
function createProvider(d: Y.Doc): HocuspocusProvider {
  const { WebSocketClass, handle } = createReconnectingWebSocket(collabUrl());
  transportHandle = handle;
  provider = new HocuspocusProvider({
    url: collabUrl(),
    name: `project:${session?.pid}`,
    document: d,
    // 占位 token：触发 Auth 消息流（真鉴权走 WS 握手携带的 httpOnly cookie）
    token: 'cookie-auth',
    WebSocketPolyfill: WebSocketClass,
  } as any);
  bindProviderListeners(provider);
  // 批1-5 awareness 即刻播种：构造即 setLocalState({})（占位——续期照跑，远端 30s 不超时下线；
  // authUser 完整态由 CanvasView setLocalUser 覆盖，终态重建后 replayLocalUser 重放）。runtime 不持有
  // auth 依赖，完整态播种归消费侧（spec：有 authUser 时完整态）。
  provider.awareness?.setLocalState({});
  return provider;
}

/** 批1-3：hidden/offline 守卫的复评钩子——回前台/上线即重算 connStatus（恢复门由 watchdog
 *  下轮心跳自然复评）。模块级一次挂（initCollab 首次挂+复用）。 */
let reevaluateBound = false;
function bindReevaluateOnce(): void {
  if (reevaluateBound) return;
  reevaluateBound = true;
  document.addEventListener('visibilitychange', () => {
    recomputeConnStatus();
    // 批1-6（B2 ③）：回前台恢复对齐（隐藏态不查——查询无意义）；去抖=单飞（alignExecFromIntents）
    if (!document.hidden) void alignExecFromIntents();
  });
  window.addEventListener('online', () => recomputeConnStatus());
}

/**
 * 初始化协作连接（v11 方案 C：无本地 seed 无 reconcile——崩溃兜底=服务端 doc 持久化（onDisconnect flush））。
 * synced 后 server doc 应用到 store（初始加载路径，替代 GET /projects/:id 的 nodes/edges）。
 * 离线廉价兜底：10s 未 synced 不置 connected、不 apply 空 doc、不抬 hydrate 门——保持不可编辑，UI 层提示重试。
 */
export async function initCollab(projectId: string): Promise<void> {
  await destroyCollab();
  // 批1-5 会话对象（epoch 判活——I-1）：sessionEpoch 单调递增不随 session 置空回卷
  const epoch = ++sessionEpoch;
  session = { pid: projectId, startedAt: Date.now(), epoch };
  // 会话起点复位（批0a 代际制）：新会话从零代开始——上一会话的入站计数不得带过来
  lastWsStatus = 'connecting';
  attemptId = 0;
  inboundAttemptId = -1;
  plannedRestartUntil = 0; // 批1-2：计划内重启窗口会话起点复位（旧会话窗口不跨会话）
  // 批0b deletion baseline 会话起点复位：null=首同步 doc 为源不删（旧会话基线携带过来会误删新会话 doc 独有 key）
  prevNodeIds = null;
  prevEdgeIds = null;
  // 批1-6：intents 对齐投影会话起点复位（execStatus 由 sync 后投影整替；execAligned 无 doc 源——
  // 显式清，防同项目快速重进时陈旧对齐终态参与合并视图）
  useNodeStore.setState({ execAligned: new Map() });
  // 批1-1 watchdog 会话变量复位（模块级共享——见声明处注释）：每会话自然复位，旧会话计时/退避不携带
  lastConnectedAt = 0;
  lastInboundAt = Date.now();
  unhealthySince = Date.now(); // 从未健康也从 t0 计时（startedAt 语义——首帧黑洞/挂起握手）
  recoveryAttempts = 0;
  lastRecoveryAt = 0;
  rebuildPending = false; // 批1-3：重建窗口标记会话起点复位
  doc = new Y.Doc();
  attachUndoManager(doc);

  createProvider(doc);
  bindReevaluateOnce();

  // 批1-1 watchdog 心跳（3s）：恢复门三门电平析取（快线/unhealthy 门/级别选择——spec 红2 恢复组）。
  // 电平输入禁读派生 connStatus（黑洞下恒 connecting）；jitter 阈值（gateMs/cooldownMs）在此
  // 生成后入参传入——connectionMachine 零 Math.random；tick-gap 天然 clamp：hidden 期间 timers
  // 冻结，恢复后首 tick 的 now-unhealthySince 直接判。恢复单飞去重归批1-3 recovering 标志（本组门只管判）。
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    const healthyNow = !!provider
      && lastWsStatus === 'connected'
      && provider.isAuthenticated === true
      && provider.isSynced === true
      && inboundAttemptId === attemptId
      && now - lastInboundAt <= STALE_INBOUND_MS; // 入站新鲜度（'message' 驱动）
    const inputs: MachineInputs = {
      now,
      healthy: healthyNow,
      fastLaneEligible: lastWsStatus === 'connected' && provider !== null && !provider.isAuthenticated && now - lastConnectedAt > FAST_LANE_MS,
      gateMs: STALE_INBOUND_MS + Math.random() * 15_000, // 45~60s jitter（惊群防护）
      cooldownMs: RECOVER_BACKOFF_MS[Math.min(recoveryAttempts, RECOVER_BACKOFF_MS.length - 1)] + Math.random() * 5_000,
      hydrationPending: !!useCanvasStore.getState().isHydrating,
      unhealthySince,
      recoveryAttempts,
      lastRecoveryAt,
      terminal: false, // TODO 批2：wsAuthNotice 终态接入（canvasStore 现无此字段）
      hidden: document.hidden,
      offline: typeof navigator !== 'undefined' && !navigator.onLine,
    };
    const out = reduce(inputs);
    if (healthyNow) { unhealthySince = null; recoveryAttempts = 0; }
    else if (out.unhealthySince != null) unhealthySince = out.unhealthySince;
    if (out.action === 'recover') {
      // 批1-5 kill switch：VITE_COLLAB_AUTO_RECOVER=off ⇒ 只记录不 recover（恢复门退化为纯观测）
      const disabled = isAutoRecoverDisabled();
      recordCollabDiag('watchdog_fire', { executed: !disabled });
      if (!disabled) {
        recoveryAttempts++;
        lastRecoveryAt = Date.now();
        void recovery.recoverConnection(); // 批1-3 两级原语（级别选择+单飞在彼处）
      }
    }
    updateConnectionUi(out.ui);
    // 批1-5 awareness tick 自愈：pagehide 置 null 形态 + 连接健康 ⇒ 重放 lastLocalUser 完整态
    // （禁 {}——R24；lastLocalUser 未设时 replay no-op 不打 clock）
    if (healthyNow) {
      const aw = provider?.awareness;
      if (aw && aw.getLocalState() == null) awarenessBridge?.replayLocalUser();
    }
    // 批1-4：3s tick 兜底——ack 事件丢失形态（电平可读：isSynced && !hasUnsyncedChanges ⇒ 清）
    if (rebuildPending && provider?.isSynced === true && provider.hasUnsyncedChanges === false) {
      rebuildPending = false;
    }
  }, TICK_MS);

  // 双 resolve 区分 synced/超时：flag 判据天然覆盖 provider 在 await 前已 synced 的极快网络；
  // timer 存变量——成功路径 clearTimeout 收窄陈旧 resolve 窗口到零
  let synced = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await new Promise<void>((resolve) => {
    provider!.on('synced', () => { synced = true; resolve(); });
    timer = setTimeout(resolve, 10000);
  });
  // 判活（I-1）：epoch 替代 pid——同 pid 退出重进时 pid 判据放行陈旧调用，
  // 其超时分支会销毁第二次 initCollab 的健康会话（session 置空后 epoch 不匹配亦拦）
  if (session?.epoch !== epoch) return;

  // 离线廉价兜底：超时未 synced——不置 connected、不 apply 空 doc、不抬 hydrate 门（保持不可编辑），UI 层提示重试
  if (!synced) {
    recordCollabDiag('hydration_fail'); // 批1-5：首同步超时记录
    // 廉价兜底（用户拍板）：超时=服务端不可用——销毁连接防"晚重连蒙层消失但 store 未水合"
    // 的脏编辑窗口（编辑仅存 store 刷新即丢）；蒙层引导刷新重走 initCollab。
    // syncFailed 蒙层独占条件（I-2）：仅超时置位，断连不置（断连走自动重连，指示器非阻断告知）
    await destroyCollab();
    useCanvasStore.setState({ connStatus: 'offline', syncFailed: true });
    return;
  }
  clearTimeout(timer);

  // viewport 恢复（本地偏好非协作数据——契约 5）：放 hydrate 门之前，恢复不算编辑
  const vp = readViewport(projectId);
  if (vp) useCanvasStore.setState({ viewport: vp });

  // 批0a：connStatus 'connected' 直写已删——synced 完成只是候选条件之一，
  // 真入站（message 代际确认）到位前保持 connecting（recomputeConnStatus 唯一写点）
  useCanvasStore.setState({ syncFailed: false });
  recomputeConnStatus();
  useCanvasStore.getState().setHydrating(true);
  applyDocToStore(doc!);
  useCanvasStore.getState().setHydrating(false);
  // 批0b：hydration 即 committed 基线（spec"committed 雏形/prev 投影"）——首次本地同步的删除判据
  // 有源（首编辑=删除场景不丢删除）；影子经 readCanvasFromDoc 过滤于投影外 → 永不进基线
  // （影子生命周期归服务端批0b-2，本地删除扫描永不触及）
  const seeded = storeProjection();
  prevNodeIds = new Set(seeded.nodes.map((n) => n.id));
  prevEdgeIds = new Set(seeded.edges.map((e) => e.id));

  const onRemote = (events: any[]) => {
    // fromLocal 判定含 Geometry（S1 回写事务——本端几何修复短路防全量重建乒乓，与 AutoEdge 同位）
    if (events.some((e) => LOCAL_ORIGINS.includes(e.transaction.origin))) return;
    if (events.some((e) => e.transaction.origin === Origin.AutoEdge)) return; // 本地自动边对账事务——doc 恰是 store 镜像，无需重建（origin 不过网，无远端误伤）
    if (isShadowOnlyEvents(events, doc!.getMap('nodes'))) return; // 影子 insert/remove/data 写回不触发全量重建（initCollab 内 doc 必非空）
    if (remoteApplyTimer) clearTimeout(remoteApplyTimer);
    remoteApplyTimer = setTimeout(() => {
      if (session?.epoch !== epoch) return; // 批1-5：epoch 判活（同 pid 重进亦拦——比 pid 判据严）
      useCanvasStore.getState().setHydrating(true);
      applyDocToStore(doc!);
      useCanvasStore.getState().setHydrating(false);
    }, 50);
  };
  doc.getMap('nodes').observeDeep(onRemote as any);
  doc.getMap('edges').observeDeep(onRemote as any);
  // 批1-6（B2）：exec map 展示投影——初始一次（覆盖 synced 前已抵达的条目）+ observeDeep 监听。
  // getMap 门（批0e-4）runtime 在白名单；本端对 exec map 只读（写侧零命中=静态锚，execView.spec）
  projectExecToStore(doc!);
  doc.getMap('exec').observeDeep(() => projectExecToStore(doc!));

  awarenessBridge = new AwarenessBridge(provider!); // 非空：本函数流内 createProvider 刚赋值（seq 守卫已过）

  unbindStores = bindBridge();
}

export async function destroyCollab(): Promise<void> {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } // 批1-1 watchdog（会话清理链）
  if (remoteApplyTimer) { clearTimeout(remoteApplyTimer); remoteApplyTimer = null; }
  unbindStores?.();
  unbindStores = null;
  // R23 实例守卫：await 恢复后仅当模块引用仍是"当时那个实例"才置空——
  // 旧 destroy 的 await 间隙并发 initCollab 建立的新会话不被波及（交错置空）
  const p = provider;
  const d = doc;
  if (p) {
    try { await p.destroy(); } catch { /* 已销毁 */ }
    if (provider === p) provider = null;
  }
  if (awarenessBridge && provider === null) awarenessBridge = null;
  if (d) d.destroy();
  if (doc === d) {
    detachUndoManager();
    doc = null;
    session = null; // 批1-5 会话对象随 doc 实例守卫置空（sessionEpoch 不回卷）
  }
}

/** P0-4：展开态普通组按子节点包围盒重算（加载回放共用） */
export function refitExpandedGroups() {
  for (const g of useCanvasStore.getState().nodes.filter((n) => shouldAutoRefit(n))) {
    useCanvasStore.getState().applyGroupFrame(g.id);   // 守卫内建——分镜/折叠/手动 no-op；epsilon 防桥乒乓
  }
}

/** 执行请求附带的本端状态向量（spec 3.1，base64） */
export function getStateVector(): string | undefined {
  if (!doc) return undefined;
  const sv = Y.encodeStateVector(doc);
  let bin = '';
  for (const b of sv) bin += String.fromCharCode(b);
  return btoa(bin);
}
