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
import { normalizeLoadedCanvas } from '@flowweb/shared';
import { fillDoc, readCanvasFromDoc, applyRecordToYMap } from '@/collab/ydocBuilder';
import { AwarenessBridge } from '@/collab/awareness';
import { hydrateNodes } from '@/utils/nodeOrder';
import { readViewport } from '@/utils/viewportPersistence';

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
let currentPid: string | null = null;
/** initCollab 调用代际（I-1 判活）：currentPid 同 pid 无法区分陈旧调用（退出重进/StrictMode 双挂载同 pid），
 *  单调 seq——超时 timer 恢复时 seq !== initSeq 即陈旧调用，不得走超时兜底销毁新会话 */
let initSeq = 0;

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
      if (!nodeIds.has(id)) nodesMap.delete(id);
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
      if (!edgeIds.has(id)) edgesMap.delete(id);
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

/**
 * 初始化协作连接（v11 方案 C：无本地 seed 无 reconcile——崩溃兜底=服务端 doc 持久化（onDisconnect flush））。
 * synced 后 server doc 应用到 store（初始加载路径，替代 GET /projects/:id 的 nodes/edges）。
 * 离线廉价兜底：10s 未 synced 不置 connected、不 apply 空 doc、不抬 hydrate 门——保持不可编辑，UI 层提示重试。
 */
export async function initCollab(projectId: string): Promise<void> {
  await destroyCollab();
  const seq = ++initSeq;
  currentPid = projectId;
  doc = new Y.Doc();
  attachUndoManager(doc);

  provider = new HocuspocusProvider({
    url: collabUrl(),
    name: `project:${projectId}`,
    document: doc,
    // 占位 token：触发 Auth 消息流（真鉴权走 WS 握手携带的 httpOnly cookie）
    token: 'cookie-auth',
  });

  provider.on('status', ({ status }: any) => {
    useCanvasStore.setState({
      connStatus: status === 'connected' ? 'connecting' : 'offline',
    });
  });

  // 双 resolve 区分 synced/超时：flag 判据天然覆盖 provider 在 await 前已 synced 的极快网络；
  // timer 存变量——成功路径 clearTimeout 收窄陈旧 resolve 窗口到零
  let synced = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await new Promise<void>((resolve) => {
    provider!.on('synced', () => { synced = true; resolve(); });
    timer = setTimeout(resolve, 10000);
  });
  // 判活（I-1）：seq 替代 currentPid——同 pid 退出重进时 currentPid 判据放行陈旧调用，
  // 其超时分支会销毁第二次 initCollab 的健康会话
  if (seq !== initSeq) return;

  // 离线廉价兜底：超时未 synced——不置 connected、不 apply 空 doc、不抬 hydrate 门（保持不可编辑），UI 层提示重试
  if (!synced) {
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

  useCanvasStore.setState({ connStatus: 'connected', syncFailed: false });
  useCanvasStore.getState().setHydrating(true);
  applyDocToStore(doc!);
  useCanvasStore.getState().setHydrating(false);

  const onRemote = (events: any[]) => {
    // fromLocal 判定含 Geometry（S1 回写事务——本端几何修复短路防全量重建乒乓，与 AutoEdge 同位）
    if (events.some((e) => LOCAL_ORIGINS.includes(e.transaction.origin))) return;
    if (events.some((e) => e.transaction.origin === Origin.AutoEdge)) return; // 本地自动边对账事务——doc 恰是 store 镜像，无需重建（origin 不过网，无远端误伤）
    if (isShadowOnlyEvents(events, doc!.getMap('nodes'))) return; // 影子 insert/remove/data 写回不触发全量重建（initCollab 内 doc 必非空）
    if (remoteApplyTimer) clearTimeout(remoteApplyTimer);
    remoteApplyTimer = setTimeout(() => {
      if (currentPid !== projectId) return;
      useCanvasStore.getState().setHydrating(true);
      applyDocToStore(doc!);
      useCanvasStore.getState().setHydrating(false);
    }, 50);
  };
  doc.getMap('nodes').observeDeep(onRemote as any);
  doc.getMap('edges').observeDeep(onRemote as any);

  awarenessBridge = new AwarenessBridge(provider);

  unbindStores = bindBridge();
}

export async function destroyCollab(): Promise<void> {
  if (remoteApplyTimer) { clearTimeout(remoteApplyTimer); remoteApplyTimer = null; }
  unbindStores?.();
  unbindStores = null;
  if (provider) {
    try { await provider.destroy(); } catch { /* 已销毁 */ }
    provider = null;
  }
  awarenessBridge = null;
  detachUndoManager();
  doc?.destroy();
  doc = null;
  currentPid = null;
}

/** P0-4：展开态普通组按子节点包围盒重算（加载回放共用） */
export function refitExpandedGroups() {
  for (const g of useCanvasStore.getState().nodes.filter(
    (n) => n.type === 'group' && (n.data as any).groupType === 'normal'
      && !(n.data as any).collapsed && !(n.data as any).manuallyResized,
  )) {
    useCanvasStore.getState().refitGroupBounds(g.id);
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
