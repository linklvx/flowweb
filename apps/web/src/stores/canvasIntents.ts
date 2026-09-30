// apps/web/src/stores/canvasIntents.ts
// 批4b-1（门 C 裁决·意图漏斗）：写路径从"syncStoreToDoc 全量同步+删除扫描"迁移到
// "action→doc 意图直写+store 投影回填"——结构性反模式（投影非全量⇒误删）消失而非被对账兜住。
// 形态（spike __spike_canvasIntents.ts 正式化）：dispatchCanvasIntent = canEdit 前置门
// （VIEWER 硬门——拦截点从 bindBridge 订阅层前移到 dispatch 入口，判据②：doc+store 双零写）
// + applyIntentToDoc（doc 首写，单 transact 包序列）+ projectIntentToStore（store 投影回填）。
// 组 1（本批）：基建+首批高频写点换芯（store action 内 setState→dispatch）；未换 action 仍走
// bindBridge 旧路径兜底——双路径并存是组 1 合法形态，组 2 全量换芯+删旧路径。
// ⚠️ 循环依赖裁定（同 canvasStore.ts）：与 canvasStore/nodeStore/canvasCollabRuntime 互为顶层
// import 声明，各方顶层仅声明/定义（action/投影体运行时才执行）——ESM 本地绑定延迟求值安全。
import * as Y from 'yjs';
import isEqual from 'fast-deep-equal';
import type { CanvasNodeRecord } from '@flowweb/shared';
import { fillDoc, type PlainEdge } from '@/collab/ydocBuilder';
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

/** doc 直写（fillDoc 复用新建路径；update/move 沿 syncStoreToDoc 的逐键 diff 守卫——同值 no-op
 *  防 doc 膨胀）。origin 由 dispatch 外层单 transact 统一（复合序列原子；本函数不开事务）。
 *  updateNodeData 的删键语义约定：patch 值 === undefined ⇒ delete 键（全量对账的"缺键删除"
 *  在意图形态的对应物）。 */
export function applyIntentToDoc(d: Y.Doc, intent: CanvasIntent): void {
  switch (intent.type) {
    case 'addNode':
      fillDoc(d, [intent.node], []);
      break;
    case 'updateNodeData': {
      const m = d.getMap('nodes').get(intent.id);
      if (!(m instanceof Y.Map)) return;
      let data = m.get('data');
      if (!(data instanceof Y.Map)) { data = new Y.Map(); m.set('data', data); }
      for (const [k, v] of Object.entries(intent.patch)) {
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
            data: n.data,
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
