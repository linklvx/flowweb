// apps/web/src/stores/canvasIntents.ts
// 批4b-1（门 C 裁决·意图漏斗）：写路径从"syncStoreToDoc 全量同步+删除扫描"迁移到
// "action→doc 意图直写+store 投影回填"——结构性反模式（投影非全量⇒误删）消失而非被对账兜住。
// 形态（spike __spike_canvasIntents.ts 正式化）：dispatchCanvasIntent = canEdit 前置门
// （VIEWER 硬门——拦截点从 bindBridge 订阅层前移到 dispatch 入口，判据②：doc+store 双零写）
// + applyIntentToDoc（doc 首写，单 transact 包序列）+ projectIntentToStore（store 投影回填）。
// 批4b-2（组 2 收口）：全量换芯完成——bindBridge/syncStoreToDoc 旧路径已删，dispatch 是
// store→doc 用户写唯一入口；复合信封写点经 captureStoreProjection/dispatchProjectionDiff
// （before/after 差分翻译，删除半边=显式成员差而非 doc 扫描）；S1 系统修复回写通道已随
// O0b-0 停写、doc-only 系统写入口随 O0b-4 模块清理删除（恢复链结构性零回写）。
// ⚠️ 循环依赖裁定（同 canvasStore.ts）：与 canvasStore/nodeStore/canvasCollabRuntime 互为顶层
// import 声明，各方顶层仅声明/定义（action/投影体运行时才执行）——ESM 本地绑定延迟求值安全。
import * as Y from 'yjs';
import isEqual from 'fast-deep-equal';
import type { CanvasNodeRecord, DocMapLike, DocNodeRecord, FrameMode } from '@flowweb/shared';
import { setDocPosition, stripDerivedKeys, readRecordsFromMaps, normalizeSize,
  assertStoryboardChildNoPosition, assertNoCsDerivedKeysInData, assertNoDunderKeysInGroupData } from '@flowweb/shared';
import { fillDoc, toDocLike, type PlainEdge } from '@/collab/ydocBuilder';
import { projectCanvasNodes, stripEphemeralDataKeys, EPHEMERAL_DATA_KEYS } from '@/utils/projectCanvasNodes';
import { useCanvasStore } from './canvasStore';
import { useNodeStore, toAppNode, applyDataPatchToStores } from './nodeStore';
import { canEdit } from './syncStatus';
import { Origin } from './canvasUndo';
// doc 句柄取 runtime getDoc()——action 层不持 doc 引用（会话生命周期归 runtime 单源）；
// O0b-1 挂点：漏斗尾 reconcile（source:'doc'）+dispatchProjectionDiff 首行 reconcile（source:'cs'
// ——全仓唯一）同源导入（循环依赖裁定同 getDoc——顶层 import 声明，调用体运行时才执行）。
import { getDoc, reconcileGroupGeometry, readGroupFrameModes } from './canvasCollabRuntime';

/** 信封 patch（updateNodeEnvelope 专域）：type/parentId/position/width/height 任意子集；
 *  值 undefined=删键（对齐 applyRecordToYMap 缺键→delete 语义——入组/出组/resize/convert 写点共用）。
 *  O0b-5（终裁 50）：position 入域——组 resize 提交=单 updateNodeEnvelope{三键}（position+width+height
 *  单 intent 单 transact，不带 data 标记——markManuallyResized 整链删除）；position 写原语走 setDocPosition 单源。 */
export interface NodeEnvelopePatch {
  type?: string;
  parentId?: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
}

export type CanvasIntent =
  | { type: 'addNode'; node: DocNodeRecord }
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

/** 会话 doc 单源解析（testDoc 缝 ?? runtime getDoc）——B4'-1 endGesture 收尾链消费
 *  （reconcile 第 4 挂点同源；禁第二处解析实现）。 */
export function resolveDoc(): Y.Doc | null {
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
      // O0a-1 键集表：目标父=分镜组 ⇒ 分镜子坐标无意义（纯 DOM 宫格）——move 语义=剥 position 键
      //（membership 变更点=剥键写者：convertGroup/addToGroup/dropImageIntoStoryboard 的 doc 面
      // move intent 在此落"分镜子无 position"；cs 面归零 {0,0} 构造默认由 projectIntentToStore 保留）。
      // doc 侧有父上下文（addNode 逐 intent 没有而 moveNode 有——目标节点已在 doc）。
      const parentId = m.get('parentId');
      if (parentId != null) {
        const parent: unknown = d.getMap('nodes').get(parentId as string);
        const parentData = parent instanceof Y.Map ? parent.get('data') : undefined;
        if (parentData instanceof Y.Map && parentData.get('groupType') === 'storyboard') {
          if (m.has('position')) m.delete('position');
          break;
        }
      }
      // position 写原语单源（O0a-3 setDocPosition——子 Map 缺失建/在则复用+逐键 diff no-op）
      setDocPosition(m as unknown as DocMapLike, intent.position, () => new Y.Map() as unknown as DocMapLike);
      break;
    }
    case 'updateNodeEnvelope': {
      const m = d.getMap('nodes').get(intent.id);
      if (!(m instanceof Y.Map)) return;
      // O0b-5：position 经 setDocPosition 单源（子 Map 构造唯一原语——envelope-serialization 门禁口径；
      // 逐键 diff no-op 同 moveNode）
      if ('position' in intent.patch) {
        const p = intent.patch.position;
        if (p === undefined) { if (m.has('position')) m.delete('position'); }
        else setDocPosition(m as unknown as DocMapLike, p, () => new Y.Map() as unknown as DocMapLike);
      }
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

/** O0b-2 (ii) 内容事件写者统一入口（允许覆盖——终裁 59①[ii]）：图片 load/换图比例/替换/拼接完成/
 *  视频元数据/multiImage 组件上报 经本函数提交 updateNodeEnvelope{width,height}（Origin.Geometry——
 *  不入撤销栈）。同值去重（终裁 83⑥）：写前比对 cs 现值同值⇒零 intent（收敛锚"上报后一致⇒不再上报，
 *  收敛步数=1"）；doc 面另有 applyIntentToEnvelope 逐键同值 no-op 双保险。触发禁令（终裁 76）由
 *  调用方结构保证：仅 DOM/回调事件调用本函数——禁测量触发/禁 cs.wh 变更触发/禁 data 变更触发。 */
export function reportNodeSize(id: string, width: number, height: number): void {
  const cur = useCanvasStore.getState().nodes.find((n: any) => n.id === id);
  if (cur && cur.width === width && cur.height === height) return; // 同值去重——零 intent
  dispatchCanvasIntent(
    { type: 'updateNodeEnvelope', id, patch: { width, height } },
    Origin.Geometry,
  );
}

/** store 投影回填（doc 为真相、store 为投影；写形状对齐 storeProjection 读取面：
 *  结构+组 data 取 cs，普通节点 data 取 ns）。undefined=删键约定在此兑现（遍历原始 patch：
 *  清洗式滤除只防"新增 undefined 键"，不删已有键——删键语义必须显式 delete）。
 *  ⚠️ 只做直写、不反调换芯 store action——dispatch→action→dispatch 递归在此断链
 *  （action 层的写入体保留，与本投影双写同值幂等——组 2 删旧路径后本投影是唯一 store 写者）。
 *  O0b-2 投影层几何键全删（plan Step 3/4）：①addNode 只写 id/type/parentId/data——position 恒
 *  {0,0} 结构默认（RF 必需——reconcile 写域② 同 tick 从 doc.abs 直拷补齐）、wh 删（写域③ 补齐；
 *  doc 侧仍写——applyIntentToDoc addNode 经 fillDoc 落 position/wh）；②moveNode case 整删（投影域 0
 *  ——moveNode 构造点=提交/差分域，卡二）；③updateNodeEnvelope 只投影 type/parentId（几何键=
 *  reconcile 写域③ 单写者）；absToCsPosition 过渡换算随删（O0b-0 前瞻注释兑现）。 */
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
            position: { x: 0, y: 0 },   // 结构默认（O0b-2——几何由漏斗尾 reconcile 同 tick 补齐）
            ...(n.parentId != null ? { parentId: n.parentId } : {}),
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
    case 'updateNodeEnvelope': {
      useCanvasStore.setState((s) => ({
        nodes: s.nodes.map((n: any) => {
          if (n.id !== intent.id) return n;
          const next = { ...n };
          for (const [k, v] of Object.entries(intent.patch)) {
            if (k !== 'type' && k !== 'parentId') continue;  // O0b-2：几何键不投影（reconcile 写域③）
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
 * （LocalUser 入撤销栈；拖拽高频路径 Geometry 不入——canvasUndo trackedOrigins 契约）。
 * O0b-1 挂点①（漏斗尾）：投影循环后 doc 已更新=权威，reconcile（source:'doc'）同 tick 收口 cs。
 * 两早退分支（canEdit 拦截/无 doc）不挂——早退也跑 reconcile=语义错误；禁 finally 包裹。 */
export function dispatchCanvasIntent(intent: CanvasIntent | CanvasIntent[], origin: string): void {
  if (!canEdit(useCanvasStore.getState())) return;
  const d = resolveDoc();
  if (!d) return; // canEdit 真 ⇒ runtime 会话在（hydration ready）⇒ doc 非空；null 为异常态零写
  const seq = Array.isArray(intent) ? intent : [intent];
  d.transact(() => {
    for (const i of seq) applyIntentToDoc(d, i);
  }, origin);
  for (const i of seq) projectIntentToStore(i);
  reconcileGroupGeometry(d, 'doc');
}

/** O0a-1 键集表 DEV 校验（三层防线②挂载点=复合批尾 dispatchProjectionDiff——非每个原子
 *  dispatch：convertGroup 等复合命令的中间 dispatch（patchGroupData 落组 data）与子 move
 *  未同批时是合法中间态，批尾校验才语义完整）。stripDerivedKeys 只读断言——分镜子无
 *  position（全量预扫对构造序免疫）。违例 DEV 抛（人为构造序当场暴露而非被静默修好）；prod
 *  只读零动作（谓词本体纯只读可复用，组帧键校验留 O0b 扩）。
 *  父先子后序检查不设（现状锚注明——2026-10-02 实测）：doc Y.Map 插入序=混合序（既有子 set
 *  原位+新组 append，groupNodes 打组场景子恒先于组入 doc=合法形态），序断言会误报；漏斗层
 *  不变量（新父组 addNode intent 先于其子 intent）由 dispatchProjectionDiff 遍历序结构保证。 */
function assertDocKeySetInvariants(d: Y.Doc): void {
  const { nodes } = readRecordsFromMaps(toDocLike(d));
  const violations = stripDerivedKeys(nodes);
  if (violations.length > 0) {
    throw new Error(`[O0a-1 键集校验] ${violations.join('; ')}`);
  }
}

// ════════ 批4b-2（组 2 收口）：复合写点差分翻译 + S1 系统写入口 ════════

/** 投影快照（storeProjection 同形——写侧单源 projectCanvasNodes，data 分型 F42） */
export interface StoreProjectionSnapshot {
  nodes: CanvasNodeRecord[];
  edges: PlainEdge[];
}

/** O0b-2 (iii) 首测固化兜底（降兜底档——终裁 59①[iii]+83①/91）：dimensions 批（非 setAttributes。
 *  注：dimensions change 类型面无 dragging 字段（RF NodeDimensionChange 只有 resizing/
 *  setAttributes）——手势期隔离由 setAttributes 分支上游分流承担（resizer 调整中恒 setAttributes
 *  truthy）；拖动期 dimensions 不产生（RF 拖动只发 position change））∧doc 无 wh∧**仅 textInput 类**（imageGen/videoGen/multiImage 内容型退出
 *  ——首写者胜仅本类）⇒同 tick 批量合并**单 transact** 恰一次 updateNodeEnvelope{width,height}
 *  （Origin.Geometry 不入撤销栈；值 normalizeSize=Math.ceil 单源）。doc 有 wh（或部分键在）⇒零固化
 *  intent（后续测量≠doc 不写）；固化独立 Geometry transact——不与 LocalUser 提交合批（终裁 59⑥，
 *  防首次 Ctrl+Z 把固化吃进撤销项）。 */
export function dispatchFixtureSizeIntents(
  candidates: { id: string; width: number; height: number }[],
): void {
  if (candidates.length === 0) return;
  const d = resolveDoc();
  if (!d) return;
  const nodesMap = d.getMap('nodes');
  const csById = new Map(useCanvasStore.getState().nodes.map((n: any) => [n.id, n]));
  const intents: CanvasIntent[] = [];
  for (const c of candidates) {
    if (csById.get(c.id)?.type !== 'textInput') continue;  // 仅 textInput 类（内容型退出/被删节点 skip）
    const m: unknown = nodesMap.get(c.id);
    if (m instanceof Y.Map && (m.get('width') != null || m.get('height') != null)) continue; // 首写者胜
    intents.push({
      type: 'updateNodeEnvelope', id: c.id,
      patch: { width: normalizeSize(c.width), height: normalizeSize(c.height) },
    });
  }
  if (intents.length > 0) dispatchCanvasIntent(intents, Origin.Geometry);
}

/** 键集判定 doc-oracle 表（O0b-2 台账 a——applyKeySetTable doc-oracle 化的 web 取数点）：
 *  薄委托 canvasCollabRuntime.readGroupFrameModes（差分/invariant 两侧共一源——禁双实现）。
 *  无 doc（会话外/测试裸 store）⇒undefined=applyKeySetTable 回落 record 形态判定。 */
function readGroupFrameModesFromDoc(): ReadonlyMap<string, FrameMode> | undefined {
  const d = resolveDoc();
  return d ? readGroupFrameModes(d) : undefined;
}

/** O0b-5 命令面 auto 组谓词取数：组 doc 侧帧键（isContentDerivedFrame 的 storedFrame 入参——
 *  终裁 44 oracle=doc 侧记录键，禁 cs 派生帧当 storedFrame）。无 doc/组未注册 ⇒ undefined
 *  =调用方回落空帧形态（auto——裸 store 与旧 shouldAutoRefit 的 data 形态判据同构）。 */
export function readGroupStoredFrameFromDoc(groupId: string): {
  position?: { x: number; y: number };
  width?: number;
  height?: number;
} | undefined {
  const d = resolveDoc();
  if (!d) return undefined;
  const rec = readRecordsFromMaps(toDocLike(d)).nodes.find((n) => n.id === groupId);
  if (!rec) return undefined;
  return { position: rec.position, width: rec.width, height: rec.height };
}

/** 复合 action 起点捕获投影快照（dispatchProjectionDiff 的 before 侧）。 */
export function captureStoreProjection(): StoreProjectionSnapshot {
  const cs = useCanvasStore.getState();
  const ns = useNodeStore.getState();
  return {
    // O0b-2 台账 a：差分快照出口键集判定吃 doc-oracle——cs auto 组携派生帧三键（reconcile 写域①
    // 接管后恒有）不再被 record 形态误判 manual，auto 帧键零泄漏进 doc（帧 cs 写面已归
    //  reconcile 写域① 派生——deriveGroupFrame 单源，O0b-5 收口）
    nodes: projectCanvasNodes(cs.nodes as any, ns.nodes as any, readGroupFrameModesFromDoc()),
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
    if (!b) {
      // O0a-1 键集表剥键（上游构造纪律=唯一剥键写者——v3.17 终裁 64②）：分镜子 intent.node 不带
      // position（纯 DOM 宫格坐标无意义——copyPlan 分镜子 rel 归零 {0,0} 同源；cs 层 {0,0} 构造默认
      // 保留=三层表第三层，doc 层剥=键集表"分镜子无 position"）。本处有 afterNodes 全员父上下文
      //（applyIntentToDoc addNode 逐 intent 无父上下文——剥键只能在此漏斗总口）。
      // O0b-0：a.position=toDocRecords 出口（doc abs 语义/键集剥形态——projectCanvasNodes 不再
      // 回填）——auto 组天然无 position（键集表已在 shared 出口剥），intent 侧只判空防 undefined 残键。
      const parent = a.parentId != null ? afterNodes.get(a.parentId) : undefined;
      const isStoryboardChild =
        parent?.type === 'group' &&
        (parent.data as Record<string, unknown> | undefined)?.groupType === 'storyboard';
      intents.push({
        type: 'addNode',
        node: {
          id: a.id,
          type: a.type,
          ...(a.parentId != null ? { parentId: a.parentId } : {}),
          ...(a.position != null && !isStoryboardChild ? { position: a.position } : {}),
          ...(a.width != null ? { width: a.width } : {}),
          ...(a.height != null ? { height: a.height } : {}),
          data: a.data,
        },
      });
      continue;
    }
    const patch: NodeEnvelopePatch = {};
    if (b.type !== a.type) patch.type = a.type;
    if (b.parentId !== a.parentId) patch.parentId = a.parentId ?? undefined;
    if (b.width !== a.width) patch.width = a.width ?? undefined;
    if (b.height !== a.height) patch.height = a.height ?? undefined;
    if (Object.keys(patch).length > 0) intents.push({ type: 'updateNodeEnvelope', id: a.id, patch });
    if (b.position?.x !== a.position?.x || b.position?.y !== a.position?.y) {
      intents.push({ type: 'moveNode', id: a.id, position: { x: a.position?.x ?? 0, y: a.position?.y ?? 0 } });
    } else {
      // I-1 角点（O0a-1 质评）：既有子入分镜组（convertGroup）后 rel 恰 {0,0}=零位移——不补发
      // 则 doc 旧 position 键无写者可剥（剥键唯一载体=applyIntentToDoc moveNode 分支），批尾
      // stripDerivedKeys 误捕合法操作。补发 moveNode（after 位置=当前 cs 位置——doc 面剥键、
      // store 面同值 no-op；父上下文取 afterNodes，同上方 addNode 分支口径）。
      const parent = a.parentId != null ? afterNodes.get(a.parentId) : undefined;
      const isStoryboardChild =
        parent?.type === 'group' &&
        (parent.data as Record<string, unknown> | undefined)?.groupType === 'storyboard';
      if (isStoryboardChild) {
        // O0b-0：a.position=toDocRecords 出口（分镜子剥键→undefined）——补发 moveNode 语义位={0,0}
        intents.push({ type: 'moveNode', id: a.id, position: a.position ?? { x: 0, y: 0 } });
      }
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
 *  嵌套 action 各自 dispatch 幂等（applyIntentToDoc 逐键同值 no-op）。
 *  O0b-1 挂点②（diff 首行——全仓唯一 source:'cs'）：命令几何已落 cs、doc 未更新——cs 活值反推
 *  abs 归一（auto 组帧从 cs 子 abs 重派生/manual/storyboard 用 cs 活值帧；写域②③④直拷跳过防吞
 *  命令写），此后差分快照才不丢命令几何。无 doc（会话外）跳过——oracle 缺席无从判定帧模式。 */
export function dispatchProjectionDiff(before: StoreProjectionSnapshot, origin: string): void {
  const rd = resolveDoc();
  if (rd) reconcileGroupGeometry(rd, 'cs');
  const intents = diffProjectionToIntents(before, captureStoreProjection());
  if (intents.length === 0) return;
  dispatchCanvasIntent(intents, origin);
  // M-1（O0a-1 质评）挂点覆盖面注：直发路径（dispatchCanvasIntent）靠
  // applyIntentToDoc 分支自剥、无批尾断言——挂点选 dispatchProjectionDiff 因单原子 dispatch
  // 会误抓 convertGroup patchGroupData 中间态。
  if (import.meta.env.DEV) {
    const d = resolveDoc();
    if (d) {
      assertDocKeySetInvariants(d);
      // O0b-3 接线（it.todo 转实）：批尾同读 doc 记录挂三断言——分镜子无 position④/
      // cs-only 派生键禁入 data⑤/组 data 禁 __ 键⑥（违例 DEV 抛——prod 只读零动作同 stripDerivedKeys 口径）
      const { nodes: tailRecords } = readRecordsFromMaps(toDocLike(d));
      assertStoryboardChildNoPosition(tailRecords);
      assertNoCsDerivedKeysInData(tailRecords);
      assertNoDunderKeysInGroupData(tailRecords);
    }
  }
}
