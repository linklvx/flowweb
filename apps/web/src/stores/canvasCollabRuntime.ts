// apps/web/src/stores/canvasCollabRuntime.ts
// 画布 Yjs 实时协作桥（spec T6：store ↔ server doc 双向同步 + origin 防回环）。
// ⚠️ 循环依赖裁定（同 canvasStore.ts）：顶层仅 import 声明/函数定义/纯常量。
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import isEqual from 'fast-deep-equal';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { pickStructNodes, pickStructEdges } from './canvasHistory';
// 循环依赖裁定允许：canvasUndo 顶层仅 import yjs + 纯常量/函数定义
import { Origin, attachUndoManager, detachUndoManager } from './canvasUndo';
export { Origin } from './canvasUndo';
import { loadSnapshot, isEmptySnapshot } from '@/pages/canvas/hooks/canvasSnapshot';
import { fillDoc, readCanvasFromDoc } from '@/collab/ydocBuilder';
import { AwarenessBridge } from '@/collab/awareness';
import { hydrateNodes } from '@/utils/nodeOrder';

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

/** 当前协作会话的 awareness 桥（无连接时 null，视图层按需判空） */
export function getAwareness(): AwarenessBridge | null {
  return awarenessBridge;
}
let remoteApplyTimer: ReturnType<typeof setTimeout> | null = null;
let currentPid: string | null = null;

/** store 结构投影（canvasStore 为基准 + nodeStore data，与旧 buildSyncPayload 同形） */
function storeProjection() {
  const cs = useCanvasStore.getState();
  const ns = useNodeStore.getState();
  return {
    nodes: cs.nodes.map((nd: any) => ({
      id: nd.id,
      type: nd.type || 'videoGen',
      parentId: nd.parentId ?? null,
      position: nd.position,
      width: nd.width ?? null,
      height: nd.height ?? null,
      data: ns.nodes[nd.id]?.data ?? nd.data,
    })),
    edges: cs.edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

/** 差异转 ydoc 事务（细粒度：新增/删除按 id，更新逐键；position 独立子 Map；data 逐键） */
function syncStoreToDoc(origin: string) {
  const d = doc;
  if (!d) return;
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
      if (existing.get('type') !== n.type) existing.set('type', n.type);
      if ((existing.get('parentId') ?? null) !== (n.parentId ?? null)) {
        if (n.parentId == null) existing.delete('parentId'); else existing.set('parentId', n.parentId);
      }
      if ((existing.get('width') ?? null) !== (n.width ?? null)) {
        if (n.width == null) existing.delete('width'); else existing.set('width', n.width);
      }
      if ((existing.get('height') ?? null) !== (n.height ?? null)) {
        if (n.height == null) existing.delete('height'); else existing.set('height', n.height);
      }
      const pos = existing.get('position');
      if (pos instanceof Y.Map) {
        if (pos.get('x') !== n.position?.x) pos.set('x', n.position?.x ?? 0);
        if (pos.get('y') !== n.position?.y) pos.set('y', n.position?.y ?? 0);
      }
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
      if (!edgeIds.has(id)) edgesMap.delete(id);
    }
    for (const e of edges) {
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

/** server doc → store（hydrate 模式，远端变更不入 undo 栈） */
function applyDocToStore() {
  const d = doc;
  if (!d) return;
  const { nodes, edges } = readCanvasFromDoc(d);
  useCanvasStore.setState({
    nodes: hydrateNodes(nodes.map((n: any) => ({
      ...n, width: n.width ?? undefined, height: n.height ?? undefined,
    }))) as any,
    edges: edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target })),
  });
  useCanvasStore.getState().applyGroupDerivations();
  refitExpandedGroups();
  const content: Record<string, any> = {};
  for (const n of nodes) {
    content[n.id] = {
      id: n.id, type: n.type, position: n.position || { x: 0, y: 0 },
      data: n.data || {}, width: n.width ?? undefined, height: n.height ?? undefined,
    };
  }
  useNodeStore.setState({ nodes: content });
}

/** 订阅双 store → ydoc（origin 标记 local-user：Y.UndoManager trackedOrigins 唯一入栈者） */
function bindBridge(): () => void {
  const unsubCs = useCanvasStore.subscribe((state, prev) => {
    if (state.isHydrating || prev.isHydrating) return;
    if (state.projectId !== prev.projectId) return;
    const changed = !isEqual(pickStructNodes(state.nodes), pickStructNodes(prev.nodes))
      || !isEqual(pickStructEdges(state.edges), pickStructEdges(prev.edges));
    if (changed) syncStoreToDoc(Origin.LocalUser);
  });
  const unsubNs = useNodeStore.subscribe((state, prev) => {
    if (useCanvasStore.getState().isHydrating) return;
    if (state.nodes !== prev.nodes) syncStoreToDoc(Origin.LocalUser);
  });
  return () => { unsubCs(); unsubNs(); };
}

/**
 * 初始化协作连接（D2：localStorage 崩溃快照先 apply 到本地 doc，再连 Hocuspocus 走标准 sync 合并）。
 * synced 后 server doc 应用到 store（初始加载路径，替代 GET /projects/:id 的 nodes/edges）。
 */
export async function initCollab(projectId: string): Promise<void> {
  await destroyCollab();
  currentPid = projectId;
  doc = new Y.Doc();
  attachUndoManager(doc);

  const snap = loadSnapshot(projectId);
  if (snap && !isEmptySnapshot(snap)) {
    fillDoc(doc, Object.values(snap.nodes), snap.edges ?? []);
  }

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

  await new Promise<void>((resolve) => {
    provider!.on('synced', () => resolve());
    setTimeout(resolve, 10000);
  });
  if (currentPid !== projectId) return;

  useCanvasStore.setState({ connStatus: 'connected' });
  useCanvasStore.getState().setHydrating(true);
  applyDocToStore();
  useCanvasStore.getState().setHydrating(false);

  const onRemote = (events: any[]) => {
    const fromLocal = events.some((e) => e.transaction.origin === Origin.LocalUser);
    if (fromLocal) return;
    if (remoteApplyTimer) clearTimeout(remoteApplyTimer);
    remoteApplyTimer = setTimeout(() => {
      if (currentPid !== projectId) return;
      useCanvasStore.getState().setHydrating(true);
      applyDocToStore();
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
