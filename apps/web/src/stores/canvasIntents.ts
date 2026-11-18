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
import type { CanvasNodeRecord, DocMapLike, StoredNodeRecord, FrameMode, QuotaRejectReason } from '@flowweb/shared';
import { setDocPosition, stripDerivedKeys, toReadModel, normalizeSize,
  assertStoryboardChildNoPosition, assertNoCsDerivedKeysInData, assertNoDunderKeysInGroupData,
  QUOTA_DEFAULTS, utf8Bytes, EPHEMERAL_DATA_KEYS, CLIENT_FORBIDDEN_ON_UPDATE, EDIT_COMMAND_DENY_THROTTLE_MS,
  ensureTextDomainDefaults, textDomainOf, writeTextDomainValue,
  ensureXmlDomainDefaults, isXmlDomainKey,
  ensureArrayDomainDefaults, isMediaListDomainKey, writeArrayDomainValue } from '@flowweb/shared';
import { fillDoc, type PlainEdge } from '@/collab/ydocBuilder';
import { projectCanvasNodes, stripEphemeralDataKeys } from '@/utils/projectCanvasNodes';
import { useCanvasStore } from './canvasStore';
import { useNodeStore, NODE_TYPES } from './nodeStore';
import { canEdit, canEditCommand, type EditableCommandName } from './syncStatus';
import { Origin } from './canvasUndo';
// doc 句柄取 runtime getDoc()——action 层不持 doc 引用（会话生命周期归 runtime 单源）。
// Y2 A3 退役：reconcile 挂点（漏斗尾 'doc'/diff 首行 'cs'）+withGeometryWriter/
// assertReconcileSingleWriterWindow 随 reconcile 仲裁体系整删；projectCanvasNodes 翻转消费面
// 随差分桥恒 abs 直出归零（stripEphemeralDataKeys 仍为漏斗入口共用剥键单源）。
import { getDoc, measureLocalDocNow, recomputeRenderNodes, applyUnifiedDocSnapshot, readGroupFrameModes } from './canvasCollabRuntime';
import { recordCollabDiag } from '@/utils/collabDiagnostics';

/** Y1a T11（spec Z11''①）：客户端更新路径禁写键集（Set 包装 shared 单源——禁手抄键表）：{fileId,result}
 *  =服务端权威域（SERVER_WRITABLE_DATA_KEYS=deliverArtifact/replaceMedia/clearMedia 三 op 专写）。
 *  strip=检测/诊断层（doc 零写），安全边界=读侧 ACL 团队级；ns 本地面照写（本地 UI 乐观态）。 */
const CLIENT_FORBIDDEN_ON_UPDATE_SET = new Set<string>(CLIENT_FORBIDDEN_ON_UPDATE);

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
  | { type: 'addNode'; node: StoredNodeRecord }
  | { type: 'updateNodeData'; id: string; patch: Record<string, unknown> }
  | { type: 'deleteNode'; id: string }
  | { type: 'moveNode'; id: string; position: { x: number; y: number } }
  | { type: 'updateNodeEnvelope'; id: string; patch: NodeEnvelopePatch }
  | { type: 'upsertEdge'; edge: PlainEdge }
  | { type: 'deleteEdge'; id: string };

/** Y0b-4 T9a Step 3（4a 出口 D-14）：意图字符串值迭代——递归遍历对象/数组的全部字符串叶子
 *  （CanvasIntent 浅层键+嵌套 node.data/patch/edge/position 全达——递归泛化"浅层+data 一层"）。 */
function* iterStringValues(v: unknown): Generator<string> {
  if (typeof v === 'string') yield v;
  else if (Array.isArray(v)) for (const x of v) yield* iterStringValues(x);
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) yield* iterStringValues(x);
}

/** 判定意图序列可否应用（Q-I 四判据——web 侧最小声明，与 T4 服务端执法同尺不代执法）：
 *  ①单字符串值 utf8 字节 > maxKeyBytes → key-too-large（先判：超 maxTxBytes 的单串必超
 *    maxKeyBytes——QUOTA_DEFAULTS 锁定 maxKeyBytes ≤ maxTxBytes ⇒ ①⊆②，更具体文案先报）；
 *  ②Σ utf8Bytes(JSON.stringify(intent)) > maxTxBytes → tx-too-large；
 *  ③addNode 数 > maxNodesPerTx → too-many-nodes；
 *  ④（T10）：快照+delta 插值+软限判定（客户端可用上限=软阈——文案与拦截点一致）。 */
export type ApplyIntentVerdict =
  | { ok: true }
  | { ok: false; reason: QuotaRejectReason };

// Y0b-5 T0：QuotaRejectReason 上移 shared 单源（客户端产出与服务端 telemetry sanitize 同类型）——保留 re-export，使用面零变动。
export type { QuotaRejectReason };

/** 有效软阈单源（T10 微修复 Minor 3——canApplyIntent 判据④/redoCanvas precheck/toastQuotaReject
 *  文案三处同尺）：quotaSoftLimitBytes>0 用服务端下发值，否则回退 QUOTA_DEFAULTS 软阈
 *  （禁回退硬限：恒 0/undefined ⇒ NaN 比较恒 false=gate 失效）。 */
export function effectiveSoftLimit(st: { quotaSoftLimitBytes: number }): number {
  return st.quotaSoftLimitBytes > 0
    ? st.quotaSoftLimitBytes
    : Math.floor(QUOTA_DEFAULTS.maxDocBytes * QUOTA_DEFAULTS.softEnterRatio);
}

export function canApplyIntent(intents: CanvasIntent[]): ApplyIntentVerdict {
  for (const i of intents) {
    for (const v of iterStringValues(i)) {
      if (utf8Bytes(v) > QUOTA_DEFAULTS.maxKeyBytes) return { ok: false, reason: 'key-too-large' }; // ①先判（②的子集）
    }
  }
  const txBytes = intents.reduce((n, i) => n + utf8Bytes(JSON.stringify(i)), 0);
  if (txBytes > QUOTA_DEFAULTS.maxTxBytes) return { ok: false, reason: 'tx-too-large' }; // ②
  if (intents.filter((i) => i.type === 'addNode').length > QUOTA_DEFAULTS.maxNodesPerTx) {
    return { ok: false, reason: 'too-many-nodes' }; // ③
  }
  // ④快照+delta 插值（T10）：localDocBytes=doc-status 快照权威值（T5 reducer），localDelta=两次
  // 校准间 doc.on(update) 全 origin 累计（插值器——远端写入 B 不知情也计入）。软阈单源
  //  effectiveSoftLimit（缺省回退=6.7MB 软阈；禁回退硬限：恒 0/undefined ⇒ NaN 比较恒 false=gate 失效）。
  const st = useCanvasStore.getState();
  const softLimit = effectiveSoftLimit(st);
  const maxTx = st.quotaTxBytes > 0 ? st.quotaTxBytes : QUOTA_DEFAULTS.maxTxBytes;
  if (st.localDelta > 4 * maxTx) {
    // 超大漂移（>4×maxTx）：插值失真已超容差——同步实测一次按真值判定（v4 pending-measure 拒绝
    // 形态退役：拒绝=静默丢用户粘贴动作；8MB doc ~23ms 一次性用户路径可接受。pending-measure
    // 枚举仅保留给 idle 在途窗——本路径恒真值返回，枚举不发射）。
    const measured = measureLocalDocNow();
    if (measured + txBytes > softLimit) return { ok: false, reason: 'doc-over-budget' };
    return { ok: true };
  }
  if (st.localDocBytes + st.localDelta + txBytes > softLimit) {
    return { ok: false, reason: 'doc-over-budget' };
  }
  return { ok: true };
}

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

/** applyIntentToDoc 结果（T15 收口 A〔Q-I-1〕——doc 拒/补半落根修）：dispatch 投影与调用方
 *  直写面（applyNodeDataPatch/canvasStore 构造点）消费，使 doc 与 store **同拒同落**
 *  （checkProjectionInvariant 口径）；常态零拒时 rejectedKeys=空集、node=补缺省后记录（G 纯函数
 *  副本——入参 intent.node.data 不突变）。 */
export interface IntentApplyOutcome {
  /** updateNodeData：被拒域键集（doc 未落——store 投影/直写面同剥，reload 不静默消失）。 */
  readonly rejectedKeys: ReadonlySet<string>;
  /** addNode：域键缺省补齐后的节点记录（副本——fillDoc 物化与 store 投影同源）。 */
  readonly node?: StoredNodeRecord;
}
const OUTCOME_OK: IntentApplyOutcome = { rejectedKeys: new Set<string>() };

/** doc 直写（fillDoc 复用新建路径；update/move 沿 ydocBuilder 的逐键 diff 守卫——同值 no-op
 *  防 doc 膨胀）。origin 由 dispatch 外层单 transact 统一（复合序列原子；本函数不开事务）。
 *  updateNodeData 的删键语义约定：patch 值 === undefined ⇒ delete 键（全量对账的"缺键删除"
 *  在意图形态的对应物）。此为客户端本地语义、永不上线（JSON wire 传不了 undefined——服务端
 *  收不到该形态）；服务端对应物=deleteNodeDataKeys 显式删键 op（Y0c T9——writeBatch 词汇）。 */
export function applyIntentToDoc(d: Y.Doc, intent: CanvasIntent): IntentApplyOutcome {
  switch (intent.type) {
    case 'addNode':
      // 幂等守卫（批4b 评审 Minor）：doc 已有同 id 节点跳过重写——fillDoc 无条件 set 新
      // Y.Map=新 item，嵌套/重放 addNode 形态会 doc 膨胀（与 cs 投影侧同 id 跳过守卫对齐）。
      if (d.getMap('nodes').has(intent.node.id)) break;
      // Y1c T15 容器规则——创建 seam 单点：Y.Text 域键缺省补齐（audioGen/multiImageGen.prompt=''、
      // textInput.prompt={text:''}；G 纯函数副本——入参不突变）。Y1c T16：XmlFragment 域键缺省
      // 补齐+string canonical 收编同缝（textInput.content/三域 prompt——fillDoc 物化容器与
      // ns 投影同形）。Y1c T17：媒体列表 Y.Array 域键缺省补齐同缝（imageGen/imageExtGen/
      // videoGen.allImages=[]、multiImageGen.images=[]）。补缺记录经 outcome 上浮：fillDoc 物化
      // doc 容器与 projectIntentToStore 投影同读一源（doc ≡ store 不变量口径）。
      const effectiveNode: StoredNodeRecord = {
        ...intent.node,
        data: ensureXmlDomainDefaults(
          intent.node.type,
          ensureTextDomainDefaults(intent.node.type, ensureArrayDomainDefaults(intent.node.type, intent.node.data)),
        ),
      };
      fillDoc(d, [{ ...effectiveNode, data: stripEphemeralDataKeys(effectiveNode.data) }], []);
      return { rejectedKeys: OUTCOME_OK.rejectedKeys, node: effectiveNode };
    case 'updateNodeData': {
      // 微收口 RI-1：两结构缺早退=**整 patch 全键拒**（doc 零落 ⇒ 投影/直写面同剥成 no-op——
      // 返回空 rejectedKeys 会让 ns 全量落，doc ≡ store 双面同尺在此两档破）
      const rejectAllKeys = (): IntentApplyOutcome => ({ rejectedKeys: new Set(Object.keys(intent.patch)) });
      const m = d.getMap('nodes').get(intent.id);
      if (!(m instanceof Y.Map)) return rejectAllKeys();
      // Y1c T15 容器规则：缺 data Y.Map=结构错误——拒绝不懒建（懒建掩盖结构错误，§3.5）
      const data = m.get('data');
      if (!(data instanceof Y.Map)) {
        recordCollabDiag('write_reject', { reason: 'data-map-missing', via: 'text-domain' });
        return rejectAllKeys();
      }
      const nodeType = m.get('type');
      let rejectedKeys: Set<string> | null = null;   // 收口 A：被拒域键上浮（投影/直写面同剥）
      for (const [k, v] of Object.entries(intent.patch)) {
        if (EPHEMERAL_DATA_KEYS.has(k)) continue; // ephemeral 禁入 doc（Spec B editMode 口径 13）
        // T11（spec Z11''①）：服务端权威域禁写键 strip——doc 零写（删键语义同拦：fileId 清空走
        // clearMedia 命令，投影 poller 写 data.fileId=null〔T15 钉 null 写语义〕）；ns 本地面不在此层（projectIntentToStore 照写）
        if (CLIENT_FORBIDDEN_ON_UPDATE_SET.has(k)) continue;
        // Y1c T15：Y.Text 域键走 splice 单一 seam（整串 diff→最小 splice；缺容器/形状错/值形态错
        // =拒绝——命中域键永不 data.set 整串覆盖，G17b 容器替换对抗面）
        const domainShape = textDomainOf(nodeType, k);
        if (domainShape) {
          const r = writeTextDomainValue(data, domainShape, k, v);
          if (!r.ok) {
            recordCollabDiag('write_reject', { reason: r.reason, via: 'text-domain' });
            (rejectedKeys ??= new Set<string>()).add(k);
          }
          continue;
        }
        // Y1c T16：XmlFragment 域键（textInput.content/三域 prompt）=Tiptap 双端编辑器直绑
        // （ySyncPlugin 直写容器，origin=ySyncPluginKey）——updateNodeData 域键写（getHTML 整串/
        // PromptValue JSON 形态）一律拒（容器替换对抗面 G17b；写入面=编辑器绑定/创建 seam 唯二）。
        if (isXmlDomainKey(nodeType, k)) {
          recordCollabDiag('write_reject', { reason: 'xml-fragment-domain-editor-bound', via: 'xml-domain' });
          (rejectedKeys ??= new Set<string>()).add(k);
          continue;
        }
        // Y1c T17：媒体列表域键（imageGen/imageExtGen/videoGen.allImages、multiImageGen.images）
        // =Y.Array 容器稳定 id 结构操作 seam（add/remove/reorder=delete+insert——并发合并不丢
        // 一方；面板全量 ImageItem[] 形态 diff 落最小 op）。缺容器/形状错/值形态错=拒绝——命中
        // 域键永不 data.set（整串数组替换=旧载体 LWW 丢一方反例的载体，G17b 同族对抗面）。
        if (isMediaListDomainKey(nodeType, k)) {
          const r = writeArrayDomainValue(data, k, v);
          if (!r.ok) {
            recordCollabDiag('write_reject', { reason: r.reason, via: 'array-domain' });
            (rejectedKeys ??= new Set<string>()).add(k);
          }
          continue;
        }
        if (v === undefined) { if (data.has(k)) data.delete(k); continue; }
        if (!isEqual(data.get(k), v)) data.set(k, v);
      }
      return rejectedKeys ? { rejectedKeys } : OUTCOME_OK;
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
      if (!(m instanceof Y.Map)) return OUTCOME_OK;
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
      if (!(m instanceof Y.Map)) return OUTCOME_OK;
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
  return OUTCOME_OK;
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

// Y2 A3 退役注记：projectIntentToStore（per-intent store 投影回填——addNode 结构默认/桥键 cs 镜像/
// deleteNode 预删/edges 直写）随漏斗尾统一快照（applyUnifiedDocSnapshot——cs+renderNodes 同 set）
// 退役：doc=权威，快照单点写鲜两份数据+ns；rejectedKeys 剥除面收敛进 doc 同拒同落语义（applyIntentToDoc）。
/** 漏斗 dispatch 入口（门 C 判据②）：VIEWER 硬门从 bindBridge 订阅层（写已进 store 才拦 doc）
 * 前移到 action 入口——canEdit 假（readOnly/terminal/非 ready）时 doc+store 双零写、
 * 无"先改后回弹"（单点同构；action 层 UX 面 toast 由各 action 自留）。
 * 复合=序列单 transact（对端一帧收齐+撤销栈单捕获窗）；origin 语义沿 Origin 枚举
 * （LocalUser 入撤销栈；拖拽高频路径 Geometry 不入——canvasUndo trackedOrigins 契约）。
 * O0b-1 挂点①（漏斗尾）：投影循环后 doc 已更新=权威，reconcile（source:'doc'）同 tick 收口 cs。
 * 两早退分支（canEdit 拦截/无 doc）不挂——早退也跑 reconcile=语义错误；禁 finally 包裹。 */
/** T17（G34）：只读命令拒写诊断节流（write-rejected 节流——同一命令 5s 窗一次；B1-B2 节流
 *  形态对齐）：viewer 七命令拒写留痕 write_reject{via:'canEditCommand'}。 */
const denyDiagAt = new Map<EditableCommandName, number>();
function denyEditCommandDiag(command: EditableCommandName): void {
  const now = Date.now();
  const last = denyDiagAt.get(command) ?? 0;
  if (now - last < EDIT_COMMAND_DENY_THROTTLE_MS) return;
  denyDiagAt.set(command, now);
  recordCollabDiag('write_reject', { via: 'canEditCommand', command });
}

/** patch 剥除被拒域键（applyNodeDataPatch 直写面消费——与投影同尺；全拒=空 patch no-op）。 */
export function stripRejectedPatchKeys(patch: Record<string, unknown>, outcome: IntentApplyOutcome | undefined): Record<string, unknown> {
  if (!outcome || outcome.rejectedKeys.size === 0) return patch;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (!outcome.rejectedKeys.has(k)) out[k] = v;
  return out;
}

/** dispatch 返回=逐 intent 对齐的 outcome 数组（收口 A：调用方直写面消费 rejectedKeys/node；
 *  早退分支=空数组——doc+store 双零写，无拒绝/补缺语义）。 */
export function dispatchCanvasIntent(intent: CanvasIntent | CanvasIntent[], origin: string): IntentApplyOutcome[] {
  // T17（G34 七命令只读裁决单源）：canEditCommand 挂 dispatch 七命令总口（viewer 拒写+
  // 节流诊断）——canEdit（会话/水合/终态）维持 doc 面第二道
  const gateState = useCanvasStore.getState();
  const seq0 = Array.isArray(intent) ? intent : [intent];
  for (const i of seq0) {
    if (!canEditCommand(i.type, gateState)) {
      denyEditCommandDiag(i.type);
      return [];
    }
  }
  if (!canEdit(gateState)) return [];
  const d = resolveDoc();
  if (!d) return []; // canEdit 真 ⇒ runtime 会话在（hydration ready）⇒ doc 非空；null 为异常态零写
  const seq = Array.isArray(intent) ? intent : [intent];
  // T10 兜底断言（Q-I v3 seam 前置配套）：写路径应经 runCommand precheck/粘贴逐块/redo precheck
  // 前置判定——dispatch 收到拒判 intent 序列=前置设计漏洞（非常规路径），diag 留痕+静默零写。
  const v = canApplyIntent(seq);
  if (!v.ok) {
    recordCollabDiag('write_reject', { reason: v.reason, via: 'dispatch-fallback' });
    return [];
  }
  const outcomes: IntentApplyOutcome[] = [];
  d.transact(() => {
    for (const i of seq) outcomes.push(applyIntentToDoc(d, i));
  }, origin);
  // Y2 A3（裁决 3 v4+坐标域终裁）：per-intent 投影回填（projectIntentToStore 循环）退役——漏斗尾
  // 统一快照同一次 setState 写鲜作者缓存+渲染列表（D3「两份数据同 set」——本地作者事务 cs
  // setState 恰 1）；ns 由同一同步函数用 doc 快照更新（不计入 cs 写计数——v2.11 口径）。复合暂存
  // 窗内统一快照同样暂缓（命令中间态 cs 写不被清——convertGroup 暂存面同族缺口），窗尾统一刷新。
  // reconcile 尾挂/单写者窗口断言随 reconcile 仲裁体系退役（census 归零锚=geometry.test）。
  if (compositeStagingDepth === 0) applyUnifiedDocSnapshot(d);
  return outcomes;
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
  const { nodes } = toReadModel(d);
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
  // B4'-2 非手势期门（终裁 59①[iii]"session 期不固化"——Y2 A4：resizePending 随叶子会话化退役）：手势会话（drag/resize）
  // 或叶子 resize 标记期间零固化——RF 尾批/测量批不产 envelope（组目标另由类型限定排除）。
  const st = useCanvasStore.getState();
  if (st.dragSession != null) return;
  const d = resolveDoc();
  if (!d) return;
  const nodesMap = d.getMap('nodes');
  const csById = new Map(useCanvasStore.getState().nodes.map((n: any) => [n.id, n]));
  const intents: CanvasIntent[] = [];
  for (const c of candidates) {
    if (csById.get(c.id)?.type !== NODE_TYPES.TEXT) continue;  // 仅 textInput 类（内容型退出/被删节点 skip）
    const m: unknown = nodesMap.get(c.id);
    if (m instanceof Y.Map && (m.get('width') != null || m.get('height') != null)) continue; // 首写者胜
    intents.push({
      type: 'updateNodeEnvelope', id: c.id,
      patch: { width: normalizeSize(c.width), height: normalizeSize(c.height) },
    });
  }
  if (intents.length > 0) dispatchCanvasIntent(intents, Origin.Geometry);
}

/** 键集判定 doc-oracle 表（O0b-2 台账 a——Y2 A3 复位：翻转退役后消费面=差分快照键集剥键）。 */
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
  const rec = toReadModel(d).nodes.find((n) => n.id === groupId);
  if (!rec) return undefined;
  return { position: rec.position, width: rec.width, height: rec.height };
}

/** 复合 action 起点捕获投影快照（dispatchProjectionDiff 的 before 侧）。 */
/** Y2 A2b（裁决 3 v4 配套——复合暂存窗）：captureStoreProjection→dispatchProjectionDiff 括号内
 *  ns 是差分暂存面（convertGroup/resizeStoryboardGrid 等先暂存 slot 写、命令尾差分翻译落 doc）。
 *  窗内漏斗尾统一快照暂缓（快照=doc 真值会清未落 doc 的暂存写=分镜格位丢失——Y2 A3 起 cs 同窗
 *  暂缓：命令中间态 cs 写同样会被清）；复合尾（depth 归零）统一刷新（cs+renderNodes+ns）。 */
let compositeStagingDepth = 0;
/** 泄漏窗自动收口：复合命令恒同步（capture→diff 同 tick）——微任务边界窗必已闭合；早退路径
 *  （canEdit 拒后 return 不经 diff）在此归零+补刷新，泄漏不可能跨 tick 存活。 */
let stagingResetQueued = false;
function scheduleStagingReset(): void {
  if (stagingResetQueued) return;
  stagingResetQueued = true;
  queueMicrotask(() => {
    stagingResetQueued = false;
    if (compositeStagingDepth > 0) {
      compositeStagingDepth = 0;
      const rd = resolveDoc();
      if (rd) applyUnifiedDocSnapshot(rd);
    }
  });
}

/** 快照本体（零窗计——after 侧专用：diff 的 after 取数不得续窗，否则复合尾 finally 永不归零、
 *  统一刷新滞留微任务〔Y2 A3 勘误：spec D2「立刻重填渲染列表」=同步收口〕）。 */
function storeProjectionSnapshot(): StoreProjectionSnapshot {
  const cs = useCanvasStore.getState();
  const ns = useNodeStore.getState();
  // Y2 A3（坐标域终裁）：cs=作者缓存恒 abs——projectCanvasNodes 复位消费（F42 data 分型+键集表
  // 剥键+doc-oracle 帧模式三职能原样；toDocRecords 翻转体已退役——恒 abs 透传）。
  return {
    nodes: projectCanvasNodes(cs.nodes as any, ns.nodes as any, readGroupFrameModesFromDoc()),
    edges: cs.edges.map((e: any) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

export function captureStoreProjection(): StoreProjectionSnapshot {
  compositeStagingDepth += 1;
  scheduleStagingReset();
  return storeProjectionSnapshot();
}

/** before/after 差分 → intent 序列。删除半边=before 有 after 无的显式成员差
 *  （deleteNode/deleteEdge intent——非 doc 扫描；0b deletion baseline 的意图形态对应物）。 */
function diffProjectionToIntents(before: StoreProjectionSnapshot, after: StoreProjectionSnapshot): CanvasIntent[] {
  const intents: CanvasIntent[] = [];
  const beforeNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(after.nodes.map((n) => [n.id, n]));
  // 分镜子判定单源（B7-1 质评 Minor-4——addNode/B7-1 修/I-1 角点三处同构收口）：after 侧全员
  // 父上下文可查（applyIntentToDoc 逐 intent 无父上下文——剥键只能在此漏斗总口判）。
  const sbChildIds = new Set(
    after.nodes.filter((n) => {
      if (n.parentId == null) return false;
      const p = afterNodes.get(n.parentId);
      return p?.type === NODE_TYPES.GROUP && (p.data as Record<string, unknown> | undefined)?.groupType === 'storyboard';
    }).map((n) => n.id),
  );
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
      intents.push({
        type: 'addNode',
        node: {
          id: a.id,
          type: a.type,
          ...(a.parentId != null ? { parentId: a.parentId } : {}),
          ...(a.position != null && !sbChildIds.has(a.id) ? { position: a.position } : {}),
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
      // B7-1 修（键集表①收口）：after 无 position 且非分镜子（auto 组 sb→normal 往返=auto 档
      // 0 帧键）——moveNode {x:0,y:0} 载体只对分镜子合法（applyIntentToDoc moveNode 分支按父组
      // 剥键；组无父上下文 ⇒ {0,0} 垃圾写入 doc=frameMode auto 违例形态）。改走 envelope 删键
      // 语义（applyIntentToEnvelope position undefined → delete——键集表剥键的差分域载体）。
      if (a.position == null && !sbChildIds.has(a.id)) {
        intents.push({ type: 'updateNodeEnvelope', id: a.id, patch: { position: undefined } });
      } else {
        intents.push({ type: 'moveNode', id: a.id, position: { x: a.position?.x ?? 0, y: a.position?.y ?? 0 } });
      }
    } else {
      // I-1 角点（O0a-1 质评）：既有子入分镜组（convertGroup）后 rel 恰 {0,0}=零位移——不补发
      // 则 doc 旧 position 键无写者可剥（剥键唯一载体=applyIntentToDoc moveNode 分支），批尾
      // stripDerivedKeys 误捕合法操作。补发 moveNode（after 位置=当前 cs 位置——doc 面剥键、
      // store 面同值 no-op；分镜子判定同 sbChildIds 单源）。
      if (sbChildIds.has(a.id)) {
        // O0b-0：a.position=toDocRecords 出口（分镜子剥键→undefined）——补发 moveNode 语义位={0,0}
        intents.push({ type: 'moveNode', id: a.id, position: a.position ?? { x: 0, y: 0 } });
      }
    }
    const dataPatch: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(b.data ?? {}), ...Object.keys(a.data ?? {})]);
    let dataChanged = false;
    for (const k of keys) {
      // T11（spec Z11''①）：diff 生成侧同剥禁写键——ns 本地 fileId/result 变更（setFileResult 本地 UI/
      //   AI 回填本地态）不生成 dataPatch（applyIntentToDoc strip 是第二道防线，两入口禁漂移）
      if (CLIENT_FORBIDDEN_ON_UPDATE_SET.has(k)) continue;
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
 *  Y2 A3：diff 首行 reconcile('cs')（cs 活值反推 abs 归一）随坐标域终裁退役——cs=作者缓存恒
 *  abs，命令体直接写 abs（clamp 等 rel 域数学先算 rel 再翻回），差分双侧同域直比零归一需求。 */
export function dispatchProjectionDiff(before: StoreProjectionSnapshot, origin: string): void {
  try {
  const rd = resolveDoc();
  // Y2 A2b（D2）：cs 域几何回流即时反映进渲染列表——零 intent 早退路径（diff 空批 return）
  // 也覆盖；intents 非空时漏斗尾会再重算一次（身份复用下第二次为幂等低成本）。
  if (rd) useCanvasStore.setState({ renderNodes: recomputeRenderNodes(rd) });
  const intents = diffProjectionToIntents(before, storeProjectionSnapshot());   // after 侧零窗计——复合尾同步归零收口
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
      const { nodes: tailRecords } = toReadModel(d);
      assertStoryboardChildNoPosition(tailRecords);
      assertNoCsDerivedKeysInData(tailRecords);
      assertNoDunderKeysInGroupData(tailRecords);
    }
  }
  } finally {
    compositeStagingDepth = Math.max(0, compositeStagingDepth - 1);
    if (compositeStagingDepth === 0) {
      const rd2 = resolveDoc();
      // Y2 A3：复合尾统一刷新=cs+renderNodes+ns 全量（窗内暂缓的漏斗尾快照在此补——命令中间
      // 态 cs 写已被差分翻译落 doc，快照=doc 真值收口）
      if (rd2) applyUnifiedDocSnapshot(rd2);
    }
  }
}
