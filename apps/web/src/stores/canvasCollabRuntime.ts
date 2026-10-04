// apps/web/src/stores/canvasCollabRuntime.ts
// 画布 Yjs 实时协作桥（spec T6 + 批4b-2 写路径收口）：
//   读方向 doc→store = applyDocToStore（onRemote 50ms 去抖 + 水合窗口）+ 尾挂 reconcileGroupGeometry
//   （O0b-1 单内核——写域四类+单遍单 origin+零差异短路，source:'doc'）；
//   写方向 store→doc = canvasIntents dispatchCanvasIntent（action 层唯一入口；漏斗尾挂 reconcile
//   source:'doc'、dispatchProjectionDiff 首行挂 source:'cs'——全仓唯一）——S1 系统几何修复
//   回写已随 O0b-0 格式批停写（O0b-4 模块清理完毕：恢复链结构性零回写）。
// ⚠️ 循环依赖裁定（同 canvasStore.ts）：顶层仅 import 声明/函数定义/纯常量。
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import isEqual from 'fast-deep-equal';
import { useCanvasStore } from './canvasStore';
import { useNodeStore, toAppNode } from './nodeStore';
// 循环依赖裁定允许：canvasUndo 顶层仅 import yjs + 纯常量/函数定义
import { Origin, attachUndoManager, detachUndoManager } from './canvasUndo';
export { Origin } from './canvasUndo';
import { projectCanvasNodes } from '@/utils/projectCanvasNodes';
import {
  ensureSchemaVersion, DEFAULT_CHILD_SIZE,
  deriveGroupFrame, hasStoryboardConfig, frameMode, type Rect, type FrameMode,
  type DragSession,
  assertDocAbsMatchesCsRel, assertStoryboardMembership, reportShapeViolation,
  assertAllPositionsFinite, GeometryWriteLedger, type GeometryField,
} from '@flowweb/shared';
import { readCanvasFromDoc, toDocLike } from '@/collab/ydocBuilder';
import { deriveHiddenMap, edgeHidden } from '@/utils/groupDerive';
import { AwarenessBridge } from '@/collab/awareness';
// 批1-6（B2 ③）：恢复对齐查表（循环依赖同裁定：executionApi 的 getStateVector 与本模块互为顶层
// import 声明，双方均函数体内使用——ESM 本地绑定延迟求值安全）
import { fetchNodeIntents } from '@/api/executionApi';
import type { ExecStatusEntry } from './execStatusView';
// 批1-0 transport 薄层（门 B 裁决）：自持传输——瞬态恢复=reconnect()，kick 方案 ㉕/㉝ 约束已删
import { createReconnectingWebSocket, type ReconnectHandle } from '@/collab/reconnectTransport';
import { ensureParentOrder } from '@/utils/nodeOrder';
import { readViewport } from '@/utils/viewportPersistence';
// B7-1（O0b-7 接线）：投影/手势/reconcile 写体 geometryTrap 写者上下文。循环依赖裁定同上：
// geometryTrap 顶层仅 import 声明+纯函数定义，调用体运行时才执行——安全。
import { withGeometryWriter } from './geometryTrap';
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

/** connStatus 唯一写点：healthy = ws connected 事件 + isAuthenticated/isSynced 公开布尔
 *  + 本 attempt 已有真入站（message——4408 形态下布尔陈旧 true，唯代际判据挡得住早宣）。
 *  批2-1 修D：超时分支不再 destroyCollab/直写 'offline'——provider 存活，事件通道未断，
 *  本函数可表达全部状态（原"超时直写豁免"随之废除）。 */
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
function storeProjection(d?: Y.Doc) {
  const cs = useCanvasStore.getState();
  const ns = useNodeStore.getState();
  return {
    // O0b-2 台账 a：投影出口键集判定吃 doc-oracle（cs auto 组携派生帧三键不再被 record 形态
    // 误判 manual——invariant 双侧同变换的关键：doc 侧 0 帧键⇄records 侧 0 键）
    nodes: projectCanvasNodes(cs.nodes as any, ns.nodes as any, d ? readGroupFrameModes(d) : undefined),
    edges: cs.edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

/** O0b-2 台账 a：键集判定 doc-oracle 表（每组 frameMode——oracle=doc 侧键，终裁 44；
 *  captureStoreProjection/storeProjection 差分与 invariant 两侧共此一源，禁双实现）。 */
export function readGroupFrameModes(d: Y.Doc): ReadonlyMap<string, FrameMode> {
  const modes = new Map<string, FrameMode>();
  for (const rec of readCanvasFromDoc(d).nodes) {
    if (rec.type !== 'group') continue;
    modes.set(rec.id, frameMode({
      data: rec.data,
      storedFrame: { position: rec.position, width: rec.width, height: rec.height },
    }));
  }
  return modes;
}

/** 批4a：doc⇄store 投影不变量（红1-不变量安全网）——projectionFromDoc(doc) ≡ storeProjection()。
 *  O0b-0 格式批改写：doc=abs 空间（toDocRecords 翻转后），两侧同空间直接深等——读侧
 *  readCanvasFromDoc 直出 abs（docShape readRecordsFromMaps）、写侧 projectCanvasNodes 经
 *  toDocRecords 同变换出 abs（共同变换两侧各跑一遍自然相等）；normalizeLoadedCanvas 双侧包裹
 *  随模块整删（补缺层退役——无设计内分叉源）。withStoryboardChildDefault 保留（分镜子
 *  doc 无键⇄cs {0,0} 构造默认——三层表仍需双侧同变换）。
 *  O0b-4 拖动期豁免=让位集合同一函数（resolveGestureYield——与 reconcile 单源）：手势保护期
 *  让位节点 cs=手势活值≠doc 旧值是设计内分叉（不豁免则每帧 DEV 假报）；豁免面=几何字段按
 *  手势分型（drag⇒position/resize⇒三字段），data/结构字段仍如实比较（哨兵双侧同值即视为相等）。
 *  批5 删信箱：shadow- 双侧过滤条款随信箱移除——doc 出现 /^shadow-/ 改由 applyDocToStore 的
 *  DEV 巡检抛出（判据⑥），不变量对 doc/store 分叉如实报告。
 *  只读不写——测试缝直驱做非恒真式变异实验。
 *  批4b-2：比较按 id 排序——doc 侧是 Y.Map 插入序、store 侧是 ensureParentOrder 父前子后渲染序，
 *  两域顺序契约不同（消费侧 hydrate/ensureParentOrder 各自归一），序敏感比较会把"子先建组后建"
 *  的合法形态误报成违例（groupNodes 直觉序=子在前）。排序后内容等价语义不变、误报面消除。 */
export function checkProjectionInvariant(d: Y.Doc): boolean {
  const { nodes, edges } = readCanvasFromDoc(d);
  // B7-1（O0b-5 接线）：assertAllPositionsFinite 挂 invariant 收口点——非有限坐标（NaN/Infinity，
  // 除零/脏数据传播终点）=不变量破坏，如实报 false（谓词 boolean 契约保持；DEV 调用点照常抛/console）。
  try {
    assertAllPositionsFinite(nodes);
  } catch {
    return false;
  }
  const byId = (ns: typeof nodes) => [...ns].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // O0b-4 让位豁免（在 withStoryboardChildDefault 之后剥——防 {0,0} 构造默认回补干扰哨兵）
  const st = useCanvasStore.getState();
  const guard = resolveGestureYield(st.dragSession, st.nodes as any[]);
  const GUARDED = '__yield-guarded__' as any;
  // B5'-1 spec 评 P1-B：折叠组 wh 豁免——cs 帧=COLLAPSED_SIZE 派生档 vs doc 三键=展开态密封源
  // 是终裁 82 设计内分叉（O0b-5 起存在、挂上提交主路径后暴露）；哨兵双侧同值（与让位豁免同型），
  // position 仍如实比较（密封 origin 两域一致）。守卫按 collapsed===true 判（storyboard 不可折叠
  // ⇒域内天然不达；即便脏 data 达亦豁免 wh 无害——storyboard 组 wh 两域同为派生值或空）。
  const collapsedWhGuarded = (n: any) => {
    if (n.type !== 'group' || (n.data as Record<string, unknown> | undefined)?.collapsed !== true) return n;
    return { ...n, width: GUARDED, height: GUARDED };
  };
  const stripGuarded = (n: any) => {
    const gg = guard.get(n.id);
    if (!gg) return collapsedWhGuarded(n);
    const out = { ...collapsedWhGuarded(n) };
    if (gg.position) out.position = GUARDED;
    if (gg.wh) { out.width = GUARDED; out.height = GUARDED; }
    return out;
  };
  const fromDoc = {
    nodes: byId(withStoryboardChildDefault(nodes)).map(stripGuarded),
    edges,
  };
  const sp = storeProjection(d);
  return isEqual(fromDoc, {
    nodes: byId(withStoryboardChildDefault(sp.nodes as any)).map(stripGuarded),
    edges: sp.edges,
  });
}

/** 分叉源双侧同变换：分镜子（父=storyboard 组）无 position 键 → 补 cs 构造默认 {0,0}
 *  （store 侧恒有 position——本函数对其幂等）。 */
function withStoryboardChildDefault(nodes: ReturnType<typeof readCanvasFromDoc>['nodes']) {
  const sbGroups = new Set(
    nodes
      .filter((n) => n.type === 'group' && (n.data as Record<string, unknown> | undefined)?.groupType === 'storyboard')
      .map((n) => n.id),
  );
  return nodes.map((n) =>
    n.parentId != null && sbGroups.has(n.parentId) && n.position == null
      ? { ...n, position: { x: 0, y: 0 } }
      : n,
  );
}

// 批4b-2（组 2 收口）退役：全量同步函数（store 投影 diff+doc 扫描删除——结构性反模式，写路径
// 已收口 dispatchCanvasIntent）与 auto 边全量对账器（auto 边增删已由 addEdge/removeEdge 的
// AutoEdge origin intent 承接，删节点级联由 deleteNode intent 内建）。零删除扫描静态断言
// （flowweb/no-delete-scan）防回归。
// 批5 删信箱退役：isShadowOnlyEvents（影子事务短路判定）与 readNodeFileIdFromDoc（影子产物轮询）
// 随信箱整体消失——shadow- 字面量零回流由 lint-gate flowweb/no-shadow-literal 兜。
// O0b-0 S1 停写退役：恢复链 diff 回写通道摘除（几何修复职责移交 reconcile 写 cs 面）。
// O0b-4 模块清理：canvasHistory 整模块/dispatchSystemIntents 定义/refitExpandedGroups 随本批删除
// （O0b-0 已摘全部调用点——符号级 census 断言在 canvasO0b4.derivation.test.ts）。

/** O0b-1 reconcile 单内核（cs 几何唯一写者——写域四类+单遍单 origin+零差异短路；源矩阵见下）。
 *  doc 读取=readRecordsFromMaps（readCanvasFromDoc 薄委托——docShape 单源，禁从 nsNodes/csNodes
 *  反推=直拷回灌）；帧派生=deriveGroupFrame 单源（帧装配算术实现点=1 calcGroupBounds）。
 *  源矩阵（卡一）：'doc'=doc 权威直拷（漏斗尾/applyDocToStore 尾）；'cs'=cs 活值反推 abs
 * （dispatchProjectionDiff 首行——命令几何已落 cs、doc 未更新：manual/storyboard 组帧值取 cs 活值、
 * auto 组帧从 cs 子 abs 重派生、写域②③④直拷跳过防吞命令写）。全仓 source:'cs' 恰 1 处（census）。
 *  写域四类：①组帧三字段=deriveGroupFrame 派生（含折叠档——collapsed 非 storyboard⇒COLLAPSED_SIZE
 *  覆写、优先级最高，doc 三键保持展开态值不动[终裁 82]）②非组非分镜子 position（顶层=doc.abs 直拷/
 *  子=abs−本 tick 新 origin，rel 不量化）③非组 wh doc→cs 直拷（缺键保留 cs 现值禁 undefined）
 *  ④分镜子 position=构造默认 {0,0} 停住。
 *  O0b-2 写域① 全档写三字段（O0b-1 分档退役——台账 a/b 收口）：auto 展开档 wh=deriveGroupFrame
 *  派生值接管（现状链 applyGroupFrame 的 cs 写面由 reconcile 单写者承接）；泄漏面根修=差分出口
 *  键集判定 doc-oracle 化（toDocRecords 第三参 groupFrameModes——captureStoreProjection 从 doc 读，
 *  cs auto 组携派生帧三键不再被 record 形态误判 manual，auto 帧键零泄漏进 doc=终裁 44 死锁根除）。
 *  一写者通则：doc 无该键⇒唯一写者=派生①，直拷②③跳过；写前 Number.isFinite 守卫；
 *  零差异短路（EPS=1e-6——量化后应严格相等，EPS 只防浮点噪声）：同值 return 原 nd 保对象引用
 * （RF 全量重渲染消解），全表零差异⇒零 setState。
 *  单遍单 origin：帧集合 Pass 1 一步产出（子 abs 用旧 origin 反推），之后 Pass 2 才写子 rel
 * （本 tick 新 origin）——组因成员移动整体位移时子 abs 逐位不变。
 *  O0b-3 让位豁免（卡一让位硬规则——终裁 66③）：canvasStore.dragSession 非空时让位两层
 * （freeze=frozenFrames.keys()/live=dragProtectedIds∪{resizeTargetId}∪children(resizeTargetId)）
 * 跳过派生与直拷——字段面 drag⇒{position}/resize⇒帧三字段/freeze⇒三字段（resolveGestureYield）。
 *  O0b-4 hidden 派生并入（写域⑤——终裁 54④）：deriveHiddenMap 单源推导（组 data 依据=cs 活值
 *  ——'cs' 源命令已写 cs/'doc' 源 hydrate 已装 doc 最新）；数据域非几何保护域——不受让位影响、
 *  每调用必跑（豁免零差异短路——终裁 88⑨）；同值保引用+undefined≡false 免写（零 setState 锚不破）。
 *  纯 cs 写零 doc 写（恢复链零回写锚的结构性保证——本函数不持有任何 doc 写原语，census 锚在
 *  canvasCollabRuntime.geometry.test.ts）。 */
export type ReconcileSource = 'cs' | 'doc';

/** 零差异短路 EPS（量化契约表冻结值） */
/** 量化契约表冻结 EPS（B5'-1 起导出——commitIntents 零净变更剔除同值单源）。 */
export const RECONCILE_EPS = 1e-6;

/** B7-1（O0b-4 接线）：reconcile 内建计数账本——字段级一写者断言窗口（漏斗尾=transact 边界
 *  assert+reset，见 canvasIntents.dispatchCanvasIntent 尾）。辖域=三键全覆盖（data.{width,height}
 *  豁免废止——AI 键已随终裁 49④ 删，GeometryField 无豁免面）。只记 reconcile 实际写：跨写者
 *  （结构命令 placement 写+reconcile('cs') rebase 链/addNode 结构默认+同 tick 写域②补齐）在
 *  同窗口按设计即双写者——本账本不捕（越权写者的运行时牙齿=geometryTrap 写者上下文，两机制分立）。
 *  **牙齿状态如实标注（B7-1 质评 Important-1）**：当前唯一登记 writer 恒 'reconcile'——
 *  assertExactlyOneWriter 对单名恒过=框架态零牙齿（待第二登记者[如手势内核直写]落地才有判别力）；
 *  现值=断言窗口+reset 纪律先行，防后续接入者误以为已有强制。 */
export const reconcileWriteLedger = new GeometryWriteLedger();

/** O0b-4：漏斗尾（transact 边界）字段级一写者断言+窗口 reset（DEV；prod 零成本跳过——计数面
 *  归 geometryTrap 违例计数）。导出供 dispatchCanvasIntent 尾消费。 */
export function assertReconcileSingleWriterWindow(): void {
  if (!import.meta.env.DEV) { reconcileWriteLedger.reset(); return; }
  try {
    reconcileWriteLedger.assertExactlyOneWriter('position');
    reconcileWriteLedger.assertExactlyOneWriter('width');
    reconcileWriteLedger.assertExactlyOneWriter('height');
  } finally {
    reconcileWriteLedger.reset();
  }
}

/** reconcile 实际写登记（Pass 2 各写点消费——writer 恒 'reconcile'；DEV 门=prod 零成本
 *  [B7-1 质评 Minor-2]；窗口 reset 归漏斗尾 assert 的 finally）。 */
const recordReconcileWrite = (id: string, fields: GeometryField[]): void => {
  if (!import.meta.env.DEV) return;
  for (const f of fields) reconcileWriteLedger.record('reconcile', f, id);
};

const near = (a: number | null | undefined, b: number | null | undefined): boolean =>
  a == null && b == null ? true : a != null && b != null && Math.abs(a - b) <= RECONCILE_EPS;

export function reconcileGroupGeometry(d: Y.Doc, source: ReconcileSource = 'doc'): void {
  const { nodes: docNodes } = readCanvasFromDoc(d);
  const csNodes = useCanvasStore.getState().nodes as any[];
  // O0b-3 让位两层解析（卡一——session 活跃期豁免面；null session⇒空 Map=零让位=现状行为）
  const gestureGuard = resolveGestureYield(useCanvasStore.getState().dragSession, csNodes);
  // M-5（O0b-0 质评）：预建 Map 消内层 find/filter（O(N²)→O(N)）
  const docById = new Map(docNodes.map((r) => [r.id, r]));
  const childrenByParent = new Map<string, any[]>();
  for (const nd of csNodes) {
    if (nd.parentId != null) {
      const key = nd.parentId as string;
      const list = childrenByParent.get(key);
      if (list) list.push(nd); else childrenByParent.set(key, [nd]);
    }
  }
  const sbGroups = new Set(
    docNodes
      .filter((n) => n.type === 'group' && (n.data as Record<string, unknown>).groupType === 'storyboard')
      .map((n) => n.id),
  );

  // —— Pass 1：单遍单 origin——帧集合一步产出（写域①；之后才写子 rel——本 tick 新 origin）——
  const frames = new Map<string, Rect>();
  const writeWH = new Map<string, boolean>();
  const oldOrigins = new Map<string, { x: number; y: number }>();
  for (const nd of csNodes) {
    if (nd.type !== 'group') continue;
    oldOrigins.set(nd.id, nd.position);
    // O0b-3 让位硬规则（终裁 66③）：position 让位的组跳过派生——
    // 帧原样=cs 当前值（手势内核写者面/冻结帧），仅作子代 rebase 的 origin 源。
    // 组帧=写域① 单写者语义（position/wh 同源同写）——让位按组帧整体豁免，不做半帧态。
    const gg = gestureGuard.get(nd.id);
    if (gg?.position) {
      frames.set(nd.id, {
        x: nd.position?.x ?? 0, y: nd.position?.y ?? 0,
        width: nd.width ?? 0, height: nd.height ?? 0,
      });
      continue;
    }
    const rec = docById.get(nd.id);
    const data = (rec?.data ?? nd.data ?? {}) as Record<string, unknown>;
    // mode oracle 恒=doc 侧记录键（终裁 44——禁 cs 派生帧当 storedFrame，auto 组防 manual 死锁）
    const storedFrame = { position: rec?.position, width: rec?.width, height: rec?.height };
    // 写域①（O0b-2 接管——台账 a/b）：全档写三字段。auto wh=deriveGroupFrame 派生值（现状链
    // applyGroupFrame 的 cs 写面由本写者承接；doc 面零泄漏由差分出口 oracle 化保证——见函数头）
    writeWH.set(nd.id, true);
    if (import.meta.env.DEV && data.groupType === 'storyboard' && !hasStoryboardConfig(data)) {
      throw new Error(`[O0b-1] 分镜组 ${nd.id} 缺 storyboard config（建组/转换命令体必写完整 config——gate-seed 一次到位）`);
    }
    // 子 abs：'doc' 源=doc.abs 直读；'cs' 源=cs.rel+旧 origin（cs 组 position 活值——命令几何已落 cs）。
    // 尺寸链=doc wh 第一/measured(cs) 第二/常量最后（O0b-2 定档——C0-3 三档链）。
    const oldOrigin = source === 'cs' && nd.position ? nd.position : undefined;
    const childrenAbs = (childrenByParent.get(nd.id) ?? []).flatMap((c) => {
      const crec = docById.get(c.id);
      // O0b-2 台账(c) 结构修法（O0b-1 注释声明的不可达路径收口）：source='doc' 时 cs 有子而 doc
      // 无记录⇒排除该子（缺键排除——cs rel 不再被 fallbackAbs 当 abs 掺进帧算术的维度混用）。
      if (source === 'doc' && !crec) return [];
      const fallbackAbs = oldOrigin
        ? { x: c.position.x + oldOrigin.x, y: c.position.y + oldOrigin.y }
        : c.position;
      const abs = source === 'doc' ? (crec!.position ?? fallbackAbs) : fallbackAbs;
      return [{
        x: abs.x,
        y: abs.y,
        width: crec?.width ?? c.width ?? DEFAULT_CHILD_SIZE.width,
        height: crec?.height ?? c.height ?? DEFAULT_CHILD_SIZE.height,
      }];
    });
    // 'cs' 源：manual/storyboard 组帧值取 cs 活值（命令中间态——auto 恒派生，liveFrame 不参与模式判定）
    const liveFrame = source === 'cs'
      ? { position: nd.position, width: nd.width ?? undefined, height: nd.height ?? undefined }
      : undefined;
    frames.set(nd.id, deriveGroupFrame({ data, storedFrame, liveFrame, childrenAbs, fallbackOrigin: nd.position }));
  }

  // —— Pass 2：写域①②③④——零差异短路（同值保对象引用）+isFinite 守卫；全表零差异⇒零 setState ——
  // O0b-3 让位硬规则（终裁 66③）：让位集合成员跳过直拷与派生写（锚：session 活跃期任意命令尾
  // reconcile⇒让位集合节点 cs 几何零变化，含 doc 有键）。
  let mutated = false;
  const nextNodes = csNodes.map((nd: any) => {
    const gg = gestureGuard.get(nd.id);
    if (nd.type === 'group') {
      // 写域①：组帧=deriveGroupFrame 派生——组 position 唯一写者（wh 写入面分档见函数头）；
      // position 让位 ⇒ 帧整体让位（组帧单写者语义，见 Pass 1 注）
      if (gg?.position) return nd;
      const f = frames.get(nd.id);
      if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.y)) return nd;
      const withWH = writeWH.get(nd.id) === true;
      if (withWH && (!Number.isFinite(f.width) || !Number.isFinite(f.height))) return nd;
      const posSame = near(nd.position?.x, f.x) && near(nd.position?.y, f.y);
      const whSame = !withWH || (near(nd.width, f.width) && near(nd.height, f.height));
      if (posSame && whSame) return nd;
      mutated = true;
      recordReconcileWrite(nd.id, withWH ? ['position', 'width', 'height'] : ['position']);
      return withWH
        ? { ...nd, position: { x: f.x, y: f.y }, width: f.width, height: f.height }
        : { ...nd, position: { x: f.x, y: f.y } };
    }
    const rec = docById.get(nd.id);
    let position = nd.position;
    let width = nd.width;
    let height = nd.height;
    let changed = false;
    if (nd.parentId == null) {
      // 写域②顶层：doc.abs 直拷（缺键/非有限保留现值——禁 undefined）；'cs' 源跳过（doc 落后，防吞命令写）
      const dp = source === 'doc' ? rec?.position : undefined;
      if (dp != null && Number.isFinite(dp.x) && Number.isFinite(dp.y) && !gg?.position
        && !(near(position?.x, dp.x) && near(position?.y, dp.y))) {
        position = { x: dp.x, y: dp.y };
        changed = true;
      }
    } else if (sbGroups.has(nd.parentId)) {
      // 写域④：分镜子 position=构造默认 {0,0} 停住（'cs' 源跳过——命令中间态为更新值）
      if (source === 'doc' && !gg?.position && !(near(position?.x, 0) && near(position?.y, 0))) {
        position = { x: 0, y: 0 };
        changed = true;
      }
    } else {
      // 写域②组子：rel=abs−本 tick 新 origin（Pass 1 帧集合已产出）
      //（'doc' 源 abs=doc.abs；'cs' 源 abs=cs.rel+旧 origin——保命令几何再按新 origin 重基）
      const f = frames.get(nd.parentId);
      if (f && Number.isFinite(f.x) && Number.isFinite(f.y) && !gg?.position) {
        const abs = source === 'doc'
          ? rec?.position
          : (() => {
            const o = oldOrigins.get(nd.parentId);
            return o ? { x: nd.position.x + o.x, y: nd.position.y + o.y } : undefined;
          })();
        if (abs != null && Number.isFinite(abs.x) && Number.isFinite(abs.y)) {
          const rel = { x: abs.x - f.x, y: abs.y - f.y };
          if (!(near(position?.x, rel.x) && near(position?.y, rel.y))) {
            position = rel;
            changed = true;
          }
        }
      }
    }
    // 写域③：非组 wh doc→cs 直拷（缺键/非有限保留现值）；'cs' 源跳过（doc 落后）；
    // wh 让位（resize 档/freeze 相交）跳过
    if (source === 'doc' && !gg?.wh) {
      if (typeof rec?.width === 'number' && Number.isFinite(rec.width) && !near(width, rec.width)) { width = rec.width; changed = true; }
      if (typeof rec?.height === 'number' && Number.isFinite(rec.height) && !near(height, rec.height)) { height = rec.height; changed = true; }
    }
    if (!changed) return nd;
    mutated = true;
    recordReconcileWrite(nd.id, [
      ...(position !== nd.position ? ['position' as const] : []),
      ...(width !== nd.width ? ['width' as const] : []),
      ...(height !== nd.height ? ['height' as const] : []),
    ]);
    return { ...nd, position, width, height };
  });

  // —— 写域⑤（O0b-4 hidden 派生——终裁 54④ 并入单内核）——数据域非几何保护域：不受让位影响、
  // 每调用必跑（豁免零差异短路——终裁 88⑨）；同值保引用+undefined≡false 免写（全表零差异
  // （含 hidden）⇒零 setState——O0b-1 锚维持）。组 data 依据=cs 活值（见函数头）。
  const hiddenMap = deriveHiddenMap(nextNodes);
  let hiddenMutated = false;
  const withHidden = nextNodes.map((nd: any) => {
    const h = hiddenMap.get(nd.id) ?? false;
    if (nd.hidden === h || (nd.hidden == null && !h)) return nd;
    hiddenMutated = true;
    return { ...nd, hidden: h };
  });
  const prevEdges = useCanvasStore.getState().edges as any[];
  const nextEdges = prevEdges.map((e) => {
    const h = edgeHidden(e, hiddenMap);
    if (e.hidden === h || (e.hidden == null && !h)) return e;
    hiddenMutated = true;
    return { ...e, hidden: h };
  });
  if (mutated || hiddenMutated) {
    // O0b-7：reconcile 写体写者上下文（registry reconcileGroupGeometry 条目——cs 几何唯一写者）
    withGeometryWriter('reconcile', () => {
      useCanvasStore.setState(
        hiddenMutated ? { nodes: withHidden, edges: nextEdges } : { nodes: nextNodes },
      );
    });
  }
}

// ══════════ O0b-3 保护序 v2：手势保护面（三层一函数——捕获/hydrate/回写） ══════════
// 让位两层（卡一）：freeze=frozenFrames.keys()（让位即冻结）；live=dragProtectedIds∪
// {resizeTargetId}∪children(resizeTargetId)。字段级分型写死（v3.18 终裁 71）：
// drag⇒{position}/resize⇒{position,width,height}[帧三字段]/freeze⇒三字段。
// 硬规则"让位只保护几何，不保护数据"：回写仅覆盖捕获的几何字段——data/type/parentId/hidden/
// selected 一律取 doc 最新值（防整节点对象回写吃掉远端 data 并发写）。
// 会话宿主=canvasStore.dragSession（C0-1 DragSession 类型——生命周期管理已随 B4'-1 落
// canvasStore beginDragGesture/beginResize/endGesture；本族只落保护序结构+解析入口）。

/** 单节点让位字段面：position/wh 各自是否被手势保护（字段级——drag 只保 position）。 */
export interface GestureGeoGuard {
  position: boolean;
  wh: boolean;
}

/** 捕获的几何活值（缺键字段不回写——hydrate 后该节点无该键时 writeback 也跳过）。 */
export interface GestureGeo {
  position?: { x: number; y: number };
  width?: number;
  height?: number;
}

/** 保护面快照（capture 层产物——reapply 层输入；跨 hydrate setState 传递）。 */
export interface GestureProtectionSnapshot {
  readonly nodes: ReadonlyMap<string, GestureGeo>;
}

/** 让位两层解析（卡一）：返回 nodeId→字段保护面。纯函数——children(draggedGroupIds)与
 *  children(resizeTargetId) 从 csNodes 现取。session 缺省/空集 ⇒ 空 Map=零让位（reconcile/apply
 *  现状行为）。freeze 层与 live 层同 id 相交时字段面取并。
 *  B4'-2：live 层补 children(draggedGroupIds)（手势三行表"拖组 live=draggedGroupIds∪组内子代"——
 *  RF 拖组不发子批[getDragItems isParentSelected 排除]但 reconcile 会按活 origin rebase 子 rel，
 *  不让位则远端 apply 夹档下子代按 doc.abs−活origin 被反向推移=视觉跳变；同因
 *  assertDocAbsMatchesCsRel 的让位豁免也依赖本扩展）。 */
export function resolveGestureYield(
  session: DragSession | null | undefined,
  csNodes: ReadonlyArray<{ id: string; parentId?: string | null }>,
): ReadonlyMap<string, GestureGeoGuard> {
  const out = new Map<string, GestureGeoGuard>();
  if (!session) return out;
  // freeze 层：frozenFrames.keys()——帧三字段（让位即冻结，终裁 66③）
  for (const id of session.frozenFrames.keys()) out.set(id, { position: true, wh: true });
  // live 层：dragProtectedIds∪children(draggedGroupIds)∪{resizeTargetId}∪children(resizeTargetId)
  const liveIds = new Set(session.dragProtectedIds);
  for (const gid of session.draggedGroupIds) {
    for (const n of csNodes) {
      if (n.parentId === gid) liveIds.add(n.id);
    }
  }
  if (session.resizeTargetId != null) {
    liveIds.add(session.resizeTargetId);
    for (const n of csNodes) {
      if (n.parentId === session.resizeTargetId) liveIds.add(n.id);
    }
  }
  // 字段分型（终裁 71）：drag⇒仅 position；resize⇒帧三字段（子代 rel 逐帧不变+wh 手势面）
  const protectWh = session.gestureKind === 'resize';
  for (const id of liveIds) {
    const prev = out.get(id);
    out.set(id, { position: true, wh: protectWh || (prev?.wh ?? false) });
  }
  return out;
}

/** 保护捕获（applyDocToStore hydrate setState 前一层）：live 活值 rel（手势内核末帧/预览——
 *  cs 当前值即真值）+freeze 冻结帧三字段（frozenFrames 值=手势起点捕获，权威于 cs）。
 *  session 缺席/让位集合空 ⇒ null（零保护=现状行为）。
 *  B4'-2（plan 拖动锚）：docRecords 传入时，远端已改 parentId 的保护节点放弃保护（对端 undo
 *  删组——旧父空间 rel 回写=rel 被当 abs 跳组原点；放弃后 hydrate+reconcile 按 doc 基准重算）。 */
export function captureGestureProtection(
  docRecords?: ReadonlyArray<{ id: string; parentId?: string | null }>,
): GestureProtectionSnapshot | null {
  const s = useCanvasStore.getState();
  const guard = resolveGestureYield(s.dragSession, s.nodes as ReadonlyArray<{ id: string }>);
  if (guard.size === 0) return null;
  const byId = new Map(s.nodes.map((n: any) => [n.id, n]));
  const docParent = docRecords
    ? new Map(docRecords.map((r) => [r.id, (r.parentId ?? null) as string | null]))
    : null;
  const nodes = new Map<string, GestureGeo>();
  // freeze 层先落（帧三字段 ⊇ live 字段——同 id 相交时 freeze 值权威）
  for (const [id, f] of s.dragSession!.frozenFrames) {
    nodes.set(id, { position: { x: f.x, y: f.y }, width: f.width, height: f.height });
  }
  for (const [id, g] of guard) {
    if (nodes.has(id)) continue;
    const n = byId.get(id) as any;
    if (!n) continue; // cs 无该节点（远端新增未 hydrate/已删）——无保护对象
    if (docParent && docParent.get(id) !== ((n.parentId ?? null) as string | null)) continue; // 远端改 parentId——放弃保护
    nodes.set(id, g.wh
      ? { position: n.position == null ? undefined : { ...n.position }, width: n.width, height: n.height }
      : { position: n.position == null ? undefined : { ...n.position } });
  }
  return { nodes };
}

/** 保护回写（applyDocToStore hydrate setState 后一层）：仅覆盖捕获的几何字段——
 *  data/type/parentId/hidden/selected 一律保留 hydrate 的 doc 最新值（硬规则，终裁 71）。 */
export function reapplyGestureProtection(snap: GestureProtectionSnapshot): void {
  if (snap.nodes.size === 0) return;
  // O0b-7：保护回写=手势写者面（registry reapplyGestureProtection 条目 gesture）
  withGeometryWriter('gesture', () => {
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n: any) => {
        const geo = snap.nodes.get(n.id);
        if (!geo) return n;
        const next = { ...n };
        if (geo.position) next.position = geo.position;
        if (geo.width !== undefined) next.width = geo.width;
        if (geo.height !== undefined) next.height = geo.height;
        return next;
      }),
    }));
  });
}

/** draggingIds=onNodeDragStart 第三参 nodes 的 id 集（OnNodeDrag=(event,node,nodes)——
 *  @xyflow/react types/nodes.d.ts:36；v3.15 勘误"第二参"——照字面写第二参会退化单节点）。
 *  三选一拖三节点⇒保护集合含 3 个 id；单节点拖动={node.id}。纯解析——session 装配与
 *  UI 接线（onNodeDragStart={begin}）归 B4'-1。 */
export function resolveDraggingIdsFromGesture(nodes: ReadonlyArray<{ id: string }>): ReadonlySet<string> {
  return new Set(nodes.map((n) => n.id));
}

/** server doc → store——同款形参化（undo/乒乓断言的读回驱动）。
 *  O0b-0：S1 停写（捕获/refit/diff 回写段整删——恢复链零回写）+读侧版本门 DEV 断言+
 *  尾挂 reconcileGroupGeometry（写域②直拷）。
 *  O0b-3 保护序 v2（卡一/hydrate 过渡态例外窗口——寿命=同一同步块）：
 *  read→assert→保护捕获→hydrate setState[abs 过渡态]→保护回写→ns→reconcile(doc，含 hidden
 *  派生——O0b-4 并入单内核，独立派生步骤核销)→尾挂断言。全程同步无 await/渲染分隔；
 *  session 缺席⇒捕获 null=零保护=现状行为。 */
export function applyDocToStore(d: Y.Doc) {
  const { nodes, edges } = readCanvasFromDoc(d);
  // 批5 判据⑥ dev 巡检：影子信箱已删——nodes 出现 /^shadow-/ 即结构性违例（存量数据须 truncate
  // CanvasDoc/CanvasDocUpdate），DEV 抛出而非静默吸收（prod 只禁生成——lint-gate no-shadow-literal）。
  // 正则形态是该断言的法定载体（string 字面量形态被静态断言拦截）。
  if (import.meta.env.DEV && nodes.some((n: any) => /^shadow-/.test(n.id))) {
    throw new Error('[collab批5] doc nodes 出现 /^shadow-/ 前缀节点——影子信箱已删（判据⑥），存量 doc 须 truncate');
  }
  // O0b-0 web 读侧版本门（DEV）：收到的版本四档同条件（ensureSchemaVersion——戳≠2 拒/
  // 无戳∧有节点拒/无戳∧零节点放行；真会话由 WS loadDocument 自愈戳兜底）。
  if (import.meta.env.DEV) {
    ensureSchemaVersion(toDocLike(d));
  }
  // 保护捕获（hydrate setState 前）：live 活值 rel+freeze 冻结帧三字段（手势活值只存在于此——
  // hydrate 全量重建后即丢失）；B4'-2：传入 doc 记录——远端改被拖节点 parentId 者放弃保护
  const protection = captureGestureProtection(nodes);
  // hydrate 直吃作者态记录（O0b-0：normalizeLoadedCanvas 补缺层整删——doc=abs 空间过渡态直拷，
  // 子节点 rel 语义由尾挂 reconcile 同 tick 修正）
  // O0b-7：水合投影写体写者上下文（registry applyDocToStore 条目 projection-default）
  withGeometryWriter('projection-default', () => {
    useCanvasStore.setState({
      nodes: ensureParentOrder(nodes.map((n: any) => ({
        ...n,
        // O0a-1 cs 构造默认 {0,0}（三层表第三层——doc 无键分镜子 hydrate 落 {0,0}；RF Node position 必需）
        position: n.position ?? { x: 0, y: 0 },
        width: n.width ?? undefined, height: n.height ?? undefined,
      }))) as any,
      edges: edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target })),
    });
  });
  // 保护回写：仅几何字段覆盖（data/type/parentId/hidden/selected 取 doc 最新值——硬规则终裁 71）
  if (protection) reapplyGestureProtection(protection);
  // B4'-1 remove 谓词+B4'-2 扩展（质评结转缺口）：远端删被拖节点∨resize 目标 ⇒ 手势中止
  // "事后回滚"（三分支之一经 endGesture 单收尾——幸存被拖成员回 baseline；被删成员已不在 cs，
  // 回写自然跳过）。置于 hydrate 后：cs 与 doc 已对齐删除事实，endGesture 内 invariant 不因
  // "cs 残留待删节点"假红。
  {
    const sess = useCanvasStore.getState().dragSession;
    if (sess && (sess.draggingIds.size > 0 || sess.resizeTargetId != null)) {
      const docIds = new Set(nodes.map((n: any) => n.id));
      let draggedRemoved = false;
      for (const id of sess.draggingIds) {
        if (!docIds.has(id)) { draggedRemoved = true; break; }
      }
      if (!draggedRemoved && sess.resizeTargetId != null && !docIds.has(sess.resizeTargetId)) {
        draggedRemoved = true;   // resize 档：目标被远端删（draggingIds 空集守卫不覆盖——B4'-2 补）
      }
      if (draggedRemoved) useCanvasStore.getState().endGesture('removed');
    }
  }
  // C1（Task 17 审查沿革）：ns 刷新在投影读点之前——storeProjection→projectCanvasNodes 对普通节点
  // data 是 ns 优先，陈旧 ns 会把协作者刚提交的编辑投影丢（S1 停写后无回写通道，此处保序仍成立）
  useNodeStore.setState({ nodes: Object.fromEntries(nodes.map((n) => [n.id, toAppNode(n)])) });
  // O0b-1 挂点③=applyDocToStore 尾（source:'doc'——doc 权威直拷；漏斗尾/diff 首行随 O0b-1 同批落，
  // abs 过渡态在函数出前修正为 cs 语义：顶层 abs 直拷/子 rel/组帧 origin+wh 同 tick）
  reconcileGroupGeometry(d, 'doc');
  // O0b-2 it.todo 转实：尾挂 assertDocAbsMatchesCsRel + assertStoryboardMembership（写侧 membership）。
  // DEV 直抛；prod 转 reportShapeViolation（O0d 收编——计数+采样日志单源）。
  // 帧表=reconcile 写域①产物（cs 组 position 即本 tick 新帧 origin；wh 消费面=origin 对照无关——置 0）。
  // B4'-2 让位豁免（手势期零 doc 写后该窗收口）：让位节点 cs=手势活值≠doc 旧值=设计内分叉
  //（被拖子 rel 已动而 doc.abs 未写/拖组子代 rel 未随活 origin rebase）——豁免集合与 reconcile
  // 让位同源（resolveGestureYield 同函数，checkProjectionInvariant 同式）。
  if (nodes.length > 0) {
    const csAfter = useCanvasStore.getState().nodes;
    const frames = new Map(
      (csAfter as any[]).filter((n) => n.type === 'group')
        .map((n) => [n.id, { x: n.position.x, y: n.position.y, width: n.width ?? 0, height: n.height ?? 0 }]),
    );
    const gestureGuard = resolveGestureYield(useCanvasStore.getState().dragSession, csAfter as never[]);
    const unguardedRecords = nodes.filter((r) => !gestureGuard.get(r.id)?.position);
    try {
      assertDocAbsMatchesCsRel({ docRecords: unguardedRecords, csNodes: csAfter as never, frames });
      assertStoryboardMembership(nodes);
    } catch (e) {
      // O0d 收编：DEV 直抛 / prod 转 shared reportShapeViolation（计数+采样日志——变更 id 去重单源，
      // 断言路径禁 console 直喷）
      if (import.meta.env.DEV) throw e;
      reportShapeViolation(e);
    }
  }
}

// 批4b-2（组 2 收口）退役：store→doc 订阅翻译桥（写路径唯一入口已收口
// dispatchCanvasIntent，"store 变更→doc"翻译层整体消失；R17 切项目防线由"store 直写不再有
// doc 翻译路径"+会话 teardown 的 doc 销毁结构性承接，远端应用窗口 latch 职责对象随之消失）。

/** onRemote fromLocal 判定用（M4：每事件字面量数组分配的模块级提升） */
const LOCAL_ORIGINS = [Origin.LocalUser, Origin.Geometry];

/** 批1-3：六监听单函数（契约锁㉔——provider.destroy 是 removeAllListeners+awareness.destroy，
 *  终态重建后必须重挂；initCollab 与终态重建共用同一函数）。六事件：status/authenticated/
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
  p.on('authenticated', ({ scope }: any) => {
    // 批2-1 粘滞权威覆盖（v5.4）：authenticated 是 collabReadOnly 唯一授权写点——
    // read-write 解除只读；readonly/未知 scope 置回（fail-closed）。onClose 不清（断连窗口
    // 编辑经 messageQueue 合并——回收会造成重连后 NACK 静默回退）
    useCanvasStore.setState({ collabReadOnly: scope !== 'read-write' });
    recomputeConnStatus();
  });
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
 *  （门 B 四点验证形态：库每次重连经注入类新建 socket，handle 跟踪 current）+ 六监听挂载。 */
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
  // 批2-1：入口走清理体（teardownSession）而非 destroyCollab——后者复位 hydration='idle'，
  // 会把 openSession 刚置的 pending 打成 idle 闪烁；清理体不做状态复位
  await teardownSession();
  // 批1-5 会话对象（epoch 判活——I-1）：sessionEpoch 单调递增不随 session 置空回卷
  const epoch = ++sessionEpoch;
  session = { pid: projectId, startedAt: Date.now(), epoch };
  // 批2-1 会话起点：hydration=pending（openSession 已先置——此处覆盖入口清理期）+
  // collabReadOnly 复位 true（v5.4 openSession 清→初值 true——上一会话授权不跨会话）；
  // localCollapsed（viewer 折叠 UI 瞬态）同点复位——上一会话视图态不跨会话/跨用户
  useCanvasStore.getState().setHydration('pending');
  useCanvasStore.setState({ collabReadOnly: true, localCollapsed: {} });
  // 会话起点复位（批0a 代际制）：新会话从零代开始——上一会话的入站计数不得带过来
  lastWsStatus = 'connecting';
  attemptId = 0;
  inboundAttemptId = -1;
  plannedRestartUntil = 0; // 批1-2：计划内重启窗口会话起点复位（旧会话窗口不跨会话）
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
      hydrationPending: useCanvasStore.getState().hydration === 'pending',
      unhealthySince,
      recoveryAttempts,
      lastRecoveryAt,
      terminal: useCanvasStore.getState().wsAuthNotice?.terminal === true, // 批2-1 接入（原 TODO 批2）
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
    // 修D（v5.3，批2-1）：超时不再 destroyCollab——保留 provider/doc（恢复门对象仍在、
    // "断连期编辑仍在 doc"在 failed 态成立，且销毁会与恢复门互踩出"10s 超时↔15s 快线"重建循环）。
    // hydration='failed' 驱动蒙层分型（重试连接/刷新行动）；迟到 synced 的水合自愈
    // （completeHydration 单驱动）不属本批——蒙层钉死引导用户重试
    useCanvasStore.getState().setHydration('failed');
    return;
  }
  clearTimeout(timer);

  // viewport 恢复（本地偏好非协作数据——契约 5）：放 hydrate 门之前，恢复不算编辑
  const vp = readViewport(projectId);
  if (vp) useCanvasStore.setState({ viewport: vp });

  // 批0a：connStatus 'connected' 直写已删——synced 完成只是候选条件之一，
  // 真入站（message 代际确认）到位前保持 connecting（recomputeConnStatus 唯一写点）
  recomputeConnStatus();
  // 批4b-2：水合窗口远端应用 latch 已退役——store 重建无订阅翻译层（批4b-2 删桥），
  // 重建写不再有回译路径；ready 于水合完成后单写（批2-1 语义不变）
  applyDocToStore(doc!);
  useCanvasStore.getState().setHydration('ready');

  const onRemote = (events: any[]) => {
    // fromLocal 判定含 Geometry（S1 回写事务——本端几何修复短路防全量重建乒乓，与 AutoEdge 同位）
    if (events.some((e) => LOCAL_ORIGINS.includes(e.transaction.origin))) return;
    if (events.some((e) => e.transaction.origin === Origin.AutoEdge)) return; // 本地自动边 intent 事务——doc 恰是 store 镜像，无需重建（origin 不过网，无远端误伤）
    if (remoteApplyTimer) clearTimeout(remoteApplyTimer);
    remoteApplyTimer = setTimeout(() => {
      if (session?.epoch !== epoch) return; // 批1-5：epoch 判活（同 pid 重进亦拦——比 pid 判据严）
      applyDocToStore(doc!);
      // 批4a：applyRemote 周期末尾不变量（含 S1 补跑——applyDocToStore 内收尾）。readOnly 会话
      // 不测（S1 几何止步 store 层是设计内分叉）；不等→计数+DEV console.error，不抛（安全网非熔断）
      if (!useCanvasStore.getState().collabReadOnly && !checkProjectionInvariant(doc!)) {
        recordCollabDiag('invariant_violation', { where: 'applyRemote' });
        if (import.meta.env.DEV) {
          console.error('[collab批4a] projection invariant violated: projectionFromDoc(doc) ≢ storeProjection()');
        } else {
          console.log('[collab批4a] projection invariant violated: projectionFromDoc(doc) ≢ storeProjection()');
        }
      }
    }, 50);
  };
  doc.getMap('nodes').observeDeep(onRemote as any);
  doc.getMap('edges').observeDeep(onRemote as any);
  // 批1-6（B2）：exec map 展示投影——初始一次（覆盖 synced 前已抵达的条目）+ observeDeep 监听。
  // getMap 门（批0e-4）runtime 在白名单；本端对 exec map 只读（写侧零命中=静态锚，execView.spec）
  projectExecToStore(doc!);
  doc.getMap('exec').observeDeep(() => projectExecToStore(doc!));

  awarenessBridge = new AwarenessBridge(provider!); // 非空：本函数流内 createProvider 刚赋值（seq 守卫已过）
}

/** 批2-1 会话清理体：destroyCollab（真卸载）与 initCollab 入口（旧会话摘除）共用。
 *  不做 hydration/collabReadOnly 复位——那是 destroyCollab 的职责（idle 单写点），
 *  入口若经 destroyCollab 会把 openSession 刚置的 pending 打成 idle 闪烁。 */
async function teardownSession(): Promise<void> {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } // 批1-1 watchdog（会话清理链）
  if (remoteApplyTimer) { clearTimeout(remoteApplyTimer); remoteApplyTimer = null; }
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

export async function destroyCollab(): Promise<void> {
  await teardownSession();
  // R23 同款守卫：await 间隙并发 initCollab 已立新会话（session 非空）时，
  // 陈旧 destroy 不得复位新会话的 hydration/collabReadOnly（交错写防线）
  if (session !== null) return;
  useCanvasStore.getState().setHydration('idle'); // 批2-1：idle 单写点（teardownSession 唯一调用方=本函数）
  useCanvasStore.setState({ collabReadOnly: true, localCollapsed: {} }); // G27：登出/切用户经页面卸载路径显式复位（viewer 折叠 UI 瞬态同点清）
}

/** 执行请求附带的本端状态向量（spec 3.1，base64） */
export function getStateVector(): string | undefined {
  if (!doc) return undefined;
  const sv = Y.encodeStateVector(doc);
  let bin = '';
  for (const b of sv) bin += String.fromCharCode(b);
  return btoa(bin);
}
