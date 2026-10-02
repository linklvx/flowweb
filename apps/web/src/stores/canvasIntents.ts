// apps/web/src/stores/canvasIntents.ts
// 批4b-1（门 C 裁决·意图漏斗）：写路径从"syncStoreToDoc 全量同步+删除扫描"迁移到
// "action→doc 意图直写+store 投影回填"——结构性反模式（投影非全量⇒误删）消失而非被对账兜住。
// 形态（spike __spike_canvasIntents.ts 正式化）：dispatchCanvasIntent = canEdit 前置门
// （VIEWER 硬门——拦截点从 bindBridge 订阅层前移到 dispatch 入口，判据②：doc+store 双零写）
// + applyIntentToDoc（doc 首写，单 transact 包序列）+ projectIntentToStore（store 投影回填）。
// 批4b-2（组 2 收口）：全量换芯完成——bindBridge/syncStoreToDoc 旧路径已删，dispatch 是
// store→doc 用户写唯一入口；复合信封写点经 captureStoreProjection/dispatchProjectionDiff
// （before/after 差分翻译，删除半边=显式成员差而非 doc 扫描）；S1 系统几何修复走
// dispatchSystemIntents（doc-only，门=collabReadOnly）。
// ⚠️ 循环依赖裁定（同 canvasStore.ts）：与 canvasStore/nodeStore/canvasCollabRuntime 互为顶层
// import 声明，各方顶层仅声明/定义（action/投影体运行时才执行）——ESM 本地绑定延迟求值安全。
import * as Y from 'yjs';
import isEqual from 'fast-deep-equal';
import type { CanvasNodeRecord } from '@flowweb/shared';
import { fillDoc, type PlainEdge } from '@/collab/ydocBuilder';
import { projectCanvasNodes, stripEphemeralDataKeys, EPHEMERAL_DATA_KEYS } from '@/utils/projectCanvasNodes';
import { useCanvasStore } from './canvasStore';
import { useNodeStore, toAppNode, applyDataPatchToStores } from './nodeStore';
import { canEdit } from './syncStatus';
// doc 句柄取 runtime getDoc()——action 层不持 doc 引用（会话生命周期归 runtime 单源）
import { getDoc } from './canvasCollabRuntime';

/** 信封 patch（updateNodeEnvelope 专域）：type/parentId/width/height 任意子集；
 *  值 undefined=删键（对齐 applyRecordToYMap 缺键→delete 语义——入组/出组/resize/convert 写点共用）。 */
export interface NodeEnvelopePatch {
  type?: string;
  parentId?: string;
  width?: number;
  height?: number;
}

export type CanvasIntent =
  | { type: 'addNode'; node: CanvasNodeRecord }
  | { type: 'updateNodeData'; id: string; patch: Record<string, unknown> }
  | { type: 'deleteNode'; id: string }
  | { type: 'moveNode'; id: string; position: { x: number; y: number } }
  | { type: 'updateNodeEnvelope'; id: string; patch: NodeEnvelopePatch }
  | { type: 'upsertEdge'; edge: PlainEdge }
  | { type: 'deleteEdge'; id: string };

/** 测试缝（只读注入）：spec 裸 doc 驱动纯漏斗路径（无 initCollab）。生产恒走 getDoc()。 */
let testDoc: Y.Doc | null = null;
export function _setIntentDocForTest(d: Y.Doc | null): void {
  testDoc = d;
}

function resolveDoc(): Y.Doc | null {
  return testDoc ?? getDoc();
}

/** doc 直写（fillDoc 复用新建路径；update/move 沿 ydocBuilder 的逐键 diff 守卫——同值 no-op
 *  防 doc 膨胀）。origin 由 dispatch 外层单 transact 统一（复合序列原子；本函数不开事务）。
 *  updateNodeData 的删键语义约定：patch 值 === undefined ⇒ delete 键（全量对账的"缺键删除"
 *  在意图形态的对应物）。 */
export function applyIntentToDoc(d: Y.Doc, intent: CanvasIntent): void {
  switch (intent.type) {
    case 'addNode':
      // 幂等守卫（批4b 评审 Minor）：doc 已有同 id 节点跳过重写——fillDoc 无条件 set 新
      // Y.Map=新 item，嵌套/重放 addNode 形态会 doc 膨胀（与 cs 投影侧同 id 跳过守卫对齐）。
      if (d.getMap('nodes').has(intent.node.id)) break;
      fillDoc(d, [{ ...intent.node, data: stripEphemeralDataKeys(intent.node.data) }], []);
      break;
    case 'updateNodeData': {
      const m = d.getMap('nodes').get(intent.id);
      if (!(m instanceof Y.Map)) return;
      let data = m.get('data');
      if (!(data instanceof Y.Map)) { data = new Y.Map(); m.set('data', data); }
      for (const [k, v] of Object.entries(intent.patch)) {
        if (EPHEMERAL_DATA_KEYS.has(k)) continue; // ephemeral 禁入 doc（Spec B editMode 口径 13）
        if (v === undefined) { if (data.has(k)) data.delete(k); continue; }
        if (!isEqual(data.get(k), v)) data.set(k, v);
      }
      break;
    }
    case 'deleteNode': {
      d.getMap('nodes').delete(intent.id);
      // 级联删引用边——复刻 canvasStore.deleteNode 的 edges.filter 语义
      //（spike 实测发现：不级联则 doc 残留孤儿边，不变量验收器抓双端分叉）
      const edges = d.getMap('edges');
      for (const id of [...edges.keys()]) {
        const m: unknown = edges.get(id);
        if (m instanceof Y.Map && (m.get('source') === intent.id || m.get('target') === intent.id)) {
          edges.delete(id);
        }
      }
      break;
    }
    case 'moveNode': {
      const m = d.getMap('nodes').get(intent.id);
      if (!(m instanceof Y.Map)) return;
      let pos = m.get('position');
      if (!(pos instanceof Y.Map)) { pos = new Y.Map(); m.set('position', pos); }
      if (pos.get('x') !== intent.position.x) pos.set('x', intent.position.x);
      if (pos.get('y') !== intent.position.y) pos.set('y', intent.position.y);
      break;
    }
    case 'updateNodeEnvelope': {
      const m = d.getMap('nodes').get(intent.id);
      if (!(m instanceof Y.Map)) return;
      for (const key of ['type', 'parentId', 'width', 'height'] as const) {
        if (!(key in intent.patch)) continue;
        const v = intent.patch[key];
        if (v === undefined) { if (m.get(key) !== undefined) m.delete(key); }
        else if (m.get(key) !== v) m.set(key, v);
      }
      break;
    }
    case 'upsertEdge': {
      const edges = d.getMap('edges');
      const existing: unknown = edges.get(intent.edge.id);
      const m: Y.Map<any> = existing instanceof Y.Map ? existing : new Y.Map();
      if (!(existing instanceof Y.Map)) edges.set(intent.edge.id, m);
      if (m.get('source') !== (intent.edge.source ?? '')) m.set('source', intent.edge.source ?? '');
      if (m.get('target') !== (intent.edge.target ?? '')) m.set('target', intent.edge.target ?? '');
      break;
    }
    case 'deleteEdge':
      d.getMap('edges').delete(intent.id);
      break;
  }
}

/** store 投影回填（doc 为真相、store 为投影；写形状对齐 storeProjection 读取面：
 *  结构+组 data 取 cs，普通节点 data 取 ns）。undefined=删键约定在此兑现（遍历原始 patch：
 *  清洗式滤除只防"新增 undefined 键"，不删已有键——删键语义必须显式 delete）。
 *  ⚠️ 只做直写、不反调换芯 store action——dispatch→action→dispatch 递归在此断链
 *  （action 层的写入体保留，与本投影双写同值幂等——组 2 删旧路径后本投影是唯一 store 写者）。 */
export function projectIntentToStore(intent: CanvasIntent): void {
  switch (intent.type) {
    case 'addNode': {
      const n = intent.node;
      useNodeStore.getState().addNode(toAppNode(n));
      // cs upsert：已存在（同 id 重放）跳过——防 append 叠重复
      if (!useCanvasStore.getState().nodes.some((x: any) => x.id === n.id)) {
        useCanvasStore.setState((s) => ({
          nodes: [...s.nodes, {
            id: n.id,
            type: n.type,
            position: { ...n.position },
            ...(n.parentId != null ? { parentId: n.parentId } : {}),
            ...(n.width != null ? { width: n.width } : {}),
            ...(n.height != null ? { height: n.height } : {}),
            data: stripEphemeralDataKeys(n.data ?? {}), // cs 持久面禁入 ephemeral（口径 13）
          } as any],
        }));
      }
      break;
    }
    case 'updateNodeData':
      // 复用 nodeStore 写入体（含删键约定 + CANVAS_BRIDGE_KEYS 桥——fileId/status 等同步 cs 镜像）
      applyDataPatchToStores(intent.id, intent.patch);
      break;
    case 'deleteNode': {
      useCanvasStore.setState((s) => ({
        nodes: s.nodes.filter((n: any) => n.id !== intent.id),
        edges: s.edges.filter((e: any) => e.source !== intent.id && e.target !== intent.id),
      }));
      useNodeStore.setState((s) => {
        const nodes = { ...s.nodes };
        delete nodes[intent.id];
        return { nodes };
      });
      break;
    }
    case 'moveNode':
      useCanvasStore.setState((s) => ({
        nodes: s.nodes.map((n: any) => (n.id === intent.id ? { ...n, position: { ...intent.position } } : n)),
      }));
      break;
    case 'updateNodeEnvelope': {
      useCanvasStore.setState((s) => ({
        nodes: s.nodes.map((n: any) => {
          if (n.id !== intent.id) return n;
          const next = { ...n };
          for (const [k, v] of Object.entries(intent.patch)) {
            if (v === undefined) delete next[k]; else (next as any)[k] = v;
          }
          return next;
        }),
      }));
      break;
    }
    case 'upsertEdge':
      useCanvasStore.setState((s) => {
        const exists = s.edges.some((e: any) => e.id === intent.edge.id);
        return {
          edges: exists
            ? s.edges.map((e: any) => (e.id === intent.edge.id
              ? { ...e, source: intent.edge.source, target: intent.edge.target }
              : e))
            : [...s.edges, { id: intent.edge.id, source: intent.edge.source, target: intent.edge.target }],
        };
      });
      break;
    case 'deleteEdge':
      useCanvasStore.setState((s) => ({ edges: s.edges.filter((e: any) => e.id !== intent.id) }));
      break;
  }
}

/** 漏斗 dispatch 入口（门 C 判据②）：VIEWER 硬门从 bindBridge 订阅层（写已进 store 才拦 doc）
 * 前移到 action 入口——canEdit 假（readOnly/terminal/非 ready）时 doc+store 双零写、
 * 无"先改后回弹"（单点同构；action 层 UX 面 toast 由各 action 自留）。
 * 复合=序列单 transact（对端一帧收齐+撤销栈单捕获窗）；origin 语义沿 Origin 枚举
 * （LocalUser 入撤销栈；拖拽高频路径 Geometry 不入——canvasUndo trackedOrigins 契约）。 */
export function dispatchCanvasIntent(intent: CanvasIntent | CanvasIntent[], origin: string): void {
  if (!canEdit(useCanvasStore.getState())) return;
  const d = resolveDoc();
  if (!d) return; // canEdit 真 ⇒ runtime 会话在（hydration ready）⇒ doc 非空；null 为异常态零写
  const seq = Array.isArray(intent) ? intent : [intent];
  d.transact(() => {
    for (const i of seq) applyIntentToDoc(d, i);
  }, origin);
  for (const i of seq) projectIntentToStore(i);
}

// ════════ 批4b-2（组 2 收口）：复合写点差分翻译 + S1 系统写入口 ════════

/** 投影快照（storeProjection 同形——写侧单源 projectCanvasNodes，data 分型 F42） */
export interface StoreProjectionSnapshot {
  nodes: CanvasNodeRecord[];
  edges: PlainEdge[];
}

/** 复合 action 起点捕获投影快照（dispatchProjectionDiff 的 before 侧）。 */
export function captureStoreProjection(): StoreProjectionSnapshot {
  const cs = useCanvasStore.getState();
  const ns = useNodeStore.getState();
  return {
    nodes: projectCanvasNodes(cs.nodes as any, ns.nodes as any),
    edges: cs.edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

/** before/after 差分 → intent 序列。删除半边=before 有 after 无的显式成员差
 *  （deleteNode/deleteEdge intent——非 doc 扫描；0b deletion baseline 的意图形态对应物）。 */
function diffProjectionToIntents(before: StoreProjectionSnapshot, after: StoreProjectionSnapshot): CanvasIntent[] {
  const intents: CanvasIntent[] = [];
  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
  for (const id of beforeNodes.keys()) {
    if (!afterNodes.has(id)) intents.push({ type: 'deleteNode', id });
  }
  for (const a of after.nodes) {
    const b = beforeNodes.get(a.id);
    if (!b) { intents.push({ type: 'addNode', node: a }); continue; }
    const patch: NodeEnvelopePatch = {};
    if (b.type !== a.type) patch.type = a.type;
    if (b.parentId !== a.parentId) patch.parentId = a.parentId ?? undefined;
    if (b.width !== a.width) patch.width = a.width ?? undefined;
    if (b.height !== a.height) patch.height = a.height ?? undefined;
    if (Object.keys(patch).length > 0) intents.push({ type: 'updateNodeEnvelope', id: a.id, patch });
    if (b.position.x !== a.position.x || b.position.y !== a.position.y) {
      intents.push({ type: 'moveNode', id: a.id, position: { x: a.position.x, y: a.position.y } });
    }
    const dataPatch: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(b.data ?? {}), ...Object.keys(a.data ?? {})]);
    let dataChanged = false;
    for (const k of keys) {
      const bv = (b.data ?? {})[k];
      const av = (a.data ?? {})[k];
      if (!isEqual(bv, av)) { dataPatch[k] = k in (a.data ?? {}) ? av : undefined; dataChanged = true; }
    }
    if (dataChanged) intents.push({ type: 'updateNodeData', id: a.id, patch: dataPatch });
  }
  const beforeEdges = new Map(before.edges.map((e) => [e.id, e]));
  const afterEdges = new Map(after.edges.map((e) => [e.id, e]));
  for (const id of beforeEdges.keys()) {
    if (!afterEdges.has(id)) intents.push({ type: 'deleteEdge', id });
  }
  for (const e of after.edges) {
    const b = beforeEdges.get(e.id);
    if (!b || b.source !== e.source || b.target !== e.target) {
      intents.push({ type: 'upsertEdge', edge: { id: e.id, source: e.source, target: e.target } });
    }
  }
  return intents;
}

/** 复合写点换芯（批4b-2）：action 起点捕获快照 → set 序列（含 ns 双写）完成后调本函数——
 *  before/after 差分翻译为 intent 序列经 dispatch 单 transact 落 doc（旧 bindBridge 全量同步
 *  的增量翻译形态）。canEdit 假（readOnly/回弹窗口）时 dispatch 门拦截=doc 零写（语义同旧）；
 *  嵌套 action 各自 dispatch 幂等（applyIntentToDoc 逐键同值 no-op）。 */
export function dispatchProjectionDiff(before: StoreProjectionSnapshot, origin: string): void {
  const intents = diffProjectionToIntents(before, captureStoreProjection());
  if (intents.length === 0) return;
  dispatchCanvasIntent(intents, origin);
}

/** 批4b-2：doc-only 意图写（S1 系统几何修复回写专用入口）——无 store 投影（store 已持值，
 *  投影会与 applyDocToStore 的重建窗口互踩）；门=collabReadOnly（S1 在水合窗口内执行，canEdit
 *  的 ready 分量结构性为假——批2-2 判据沿袭，用 canEdit 会误杀 rw 会话既有回写）。
 *  用户写路径唯一入口仍是 dispatchCanvasIntent；本入口是系统维护写（origin=Geometry，
 *  不入撤销栈、onRemote LOCAL_ORIGINS 跳过）。 */
export function dispatchSystemIntents(d: Y.Doc, intents: CanvasIntent[], origin: string): void {
  if (useCanvasStore.getState().collabReadOnly) return;
  if (intents.length === 0) return;
  d.transact(() => {
    for (const i of intents) applyIntentToDoc(d, i);
  }, origin);
}
