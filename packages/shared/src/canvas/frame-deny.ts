// packages/shared/src/canvas/frame-deny.ts
// Y1c T24（plan v1.7 Task 24——spec v5.4 §3.2 偏离 37①/38⑫）：**P2 最终矩阵运行时激活**——
// DENY 面 frame-local 结构执法（纯解码级）+L2 apply 后 changed-subtree 语义执法（事件级）。
//
// 分层（§3.2 验证分层——无候选验证/无 patch）：
//  - DENY 面（本文件 validateFrameDeny，准入链 ① 接线——帧可解析部分）：root 白名单（exec 根删除/
//    未知根）、meta 白名单（空集=全拒）、未知节点类型/未知键/值类型错/容器替换（G17b 对抗面——
//    整串覆盖/裸值塞容器键）、结构预算（structs/DS 区间数——**区间数修正：Σ per-client range 数
//    非 clients.size**〔T24 登记项「ds 预算=client 数非区间数」根修〕）。XML 域结构归 L1
//    （xml-schema validateXmlL1 单源——本文件不重复执法）；帧外父深链（既有节点/既有子树挂接）
//    frame-local 不可判定 → 归 L2（plan T24 卡文：「无法判定归后验」——spec M1 勘误：出处为卡文
//    非 spec 行本体；对既有节点的矩阵校验经 L2 事件路径 O(1) 查〔path[0]=nodeId 直达〕——经索引
//    反查构造性不可实现：解码态 item 无 nodeId 反查面、yjs 公开 API 无 ID→实例解析）。
//  - L2 面（本文件 validateAppliedL2，actor apply 后临界区接线）：afterTransaction 事件 changed-
//    subtree 语义 walk——对既有节点经事件路径（path[0]=nodeId）取节点类型执法矩阵；XML 触达子树
//    整树 walk（validateXmlSubtree——xml-schema 单表单源，禁双表）；违规=毒帧 4411（actor 毒帧
//    协议承接）+per-connection 毒帧速率限制（actor 绑定表面——防重复重建 DoS）。
//  - NORMALIZE 面（graph-normalize.ts——引用类语义全后移读侧，不入 gate）。
//
// 键集单源：DOC_SCHEMA_V4（T3 冻结矩阵）+NODE_ENVELOPE_KEYS+DOC_EDGE_RECORD_KEYS+META_WHITELIST
// ——禁第二份键清单。预算常量承接 T9 P1 工程值（FRAME_MAX_STRUCTS=8×maxNodesPerTx 防DoS级上界、
// FRAME_MAX_DS_RANGES=4096——T24 矩阵激活维持工程值：per-key 矩阵执法已在帧内逐 struct 收紧，
// struct 总数界维持 DoS 级上界语义不变）。
import * as Y from 'yjs';
import { DOC_SCHEMA_V4, META_WHITELIST, type DataKeySpec } from './doc-schema-v4';
import { NODE_ENVELOPE_KEYS } from './nodeEnvelope';
import { DOC_EDGE_RECORD_KEYS } from './canvas-doc-manifest';
import { CollabCloseCode } from '../constants/collab-close-code';
import { QUOTA_DEFAULTS } from '../constants/collab-quota';
import { validateXmlSubtree, XML_TEXT_MAX_BYTES } from './xml-schema';
import { isValidOrderKey } from './order-key';
import { checkTimelineEntryValue, checkTimelineClipMap } from './timeline-frame-predicate';

/** 片段四型键矩阵（L2 事件面消费——timeline-frame-predicate CLIP_KEYS 同源；本文件谓词闭包
 *  直用 ReadonlySet 形态）。 */
const CLIP_KEY_SETS: Record<string, ReadonlySet<string>> = {
  video: new Set(['type', 'span', 'transform', 'mediaId', 'sourceNodeId', 'playbackSpeed', 'transitionIn', 'transitionOut', 'keyframes']),
  image: new Set(['type', 'span', 'transform', 'mediaId', 'sourceNodeId', 'transitionIn', 'transitionOut', 'keyframes']),
  audio: new Set(['type', 'span', 'mediaId', 'sourceNodeId', 'volume', 'fade', 'playbackSpeed', 'keyframes']),
  subtitle: new Set(['type', 'span', 'text', 'visible', 'style']),
};

/** root 白名单（exec 根删除——spec §3.1 顶层根集；写 exec 根=DENY）。
 *  Y4a T2（spec §3.2 表）：+timelines——L1 只收根准入（本帧插入即可达）；timelines 帧谓词
 *  详细执法（封闭键集/四类片段/三轨/字面量）在 T3 timeline-frame-predicate，非本白名单。 */
export const FRAME_DENY_ROOTS = new Set(['nodes', 'edges', 'meta', 'timelines']);

/** 结构预算工程值（T9 P1 承接——structs ≤8×maxNodesPerTx）。
 *  Y1c T24 收口 I-6：DS 区间 cap 与 structs 同值单源派生（原独立 4096 误拒合法交错删史——
 *  依据：①SS2 全量载体 ranges ≤ 被删 structs ≤ FRAME_MAX_STRUCTS ⇒ 同值使 ds 面在 SS2 形态
 *  结构性不先于 structs 触发（合法 SS2 由 structs/字节闸单一约束）；②增量纯删帧（0 structs）的
 *  合法面=批量删（maxNodesPerTx=2000/tx 配额既有界），16,000=8×2000 与 structs 预算同源留 8 批
 *  余量；③评审实证交错删 ~8000 ranges 极值下 2× headroom。spec 偏离 40 同批登记。 */
export const FRAME_MAX_STRUCTS = 8 * QUOTA_DEFAULTS.maxNodesPerTx;
export const FRAME_MAX_DS_RANGES = FRAME_MAX_STRUCTS;

/** position 容器逐键域（spec §3.1 通用键：Y.Map{x,y} 逐键——信封面 children 无矩阵条目，此单源）。 */
const POSITION_KEYS = new Set(['x', 'y']);

export type FrameDenyVerdict = { ok: true } | { ok: false; code: number; reason: string };

/** 帧内 struct id 键（父链解析——L1 同款）。 */
const idKey = (id: Y.ID): string => `${id.client}:${id.clock}`;

/** DS 区间计数（T24 修正：Σ per-client range 数——原 clients.size 只数 client 数非区间数）。 */
export function countDsRanges(ds: { clients: Map<number, unknown[]> }): number {
  let n = 0;
  for (const ranges of ds.clients.values()) n += Array.isArray(ranges) ? ranges.length : 1;
  return n;
}

/** struct 内容归类（map/array/text/xml 容器经 contentTypeOf 细分）。 */
function contentKindOf(st: Y.Item): 'any' | 'string' | 'format' | 'deleted' | 'binary' | 'type' | undefined {
  const c = st.content as unknown;
  if (c instanceof Y.ContentAny) return 'any';
  if (c instanceof Y.ContentString) return 'string';
  if (c instanceof Y.ContentFormat) return 'format';
  if (c instanceof Y.ContentType) return 'type';
  if (c instanceof Y.ContentDeleted) return 'deleted';
  if (c instanceof Y.ContentBinary) return 'binary';
  return undefined;
}

/** ContentType 内层 Yjs 容器归类。 */
function contentTypeOf(st: Y.Item): 'map' | 'array' | 'text' | 'xml-fragment' | 'xml-element' | 'xml-text' | undefined {
  const c = st.content as unknown;
  if (!(c instanceof Y.ContentType)) return undefined;
  const t = c.type as unknown;
  if (t instanceof Y.Map) return 'map';
  if (t instanceof Y.Array) return 'array';
  if (t instanceof Y.Text) return 'text';
  if (t instanceof Y.XmlFragment) return 'xml-fragment';
  if (t instanceof Y.XmlElement) return 'xml-element';
  if (t instanceof Y.XmlText) return 'xml-text';
  return undefined;
}

const isPrimitive = (v: unknown): boolean =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** lww/lww-array 值域（JS typeof 域——Z108 ValueTypeName 同族：lww=标量；lww-array=标量数组）。 */
function lwwValueOk(spec: DataKeySpec, st: Y.Item): boolean {
  const c = st.content as unknown;
  if (!(c instanceof Y.ContentAny)) return false;
  const vals = c.arr as unknown[];
  if (spec.yType === 'lww-array') {
    if (vals.length !== 1 || !Array.isArray(vals[0])) return false;
    return (vals[0] as unknown[]).every(isPrimitive);
  }
  return vals.length === 1 && isPrimitive(vals[0]);
}

/** yType ↔ ContentType 容器形状匹配（容器替换对抗面——G17b）。 */
function containerKindMatches(yType: DataKeySpec['yType'], kind: ReturnType<typeof contentTypeOf>): boolean {
  switch (yType) {
    case 'map': return kind === 'map';
    case 'array': return kind === 'array';
    case 'text': return kind === 'text';
    case 'xml': return kind === 'xml-fragment';
    default: return false;
  }
}

/**
 * DENY 矩阵 frame-local 执法（准入链 ①——T24 激活；P1 shape 升格：root/预算面保留+全类型矩阵）。
 * 纯解码级；帧外父深链（既有节点/子树挂接）不判定（归 L2）；XML 域结构不判定（归 L1/L2 单源）。
 */
export function validateFrameDeny(update: Uint8Array): FrameDenyVerdict {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: 'frame-malformed' };
  }
  const structs = decoded.structs as unknown as Y.Item[];
  if (structs.length > FRAME_MAX_STRUCTS || countDsRanges(decoded.ds as unknown as { clients: Map<number, unknown[]> }) > FRAME_MAX_DS_RANGES) {
    return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: 'frame-budget-exceeded' };
  }
  const inFrame = new Map<string, Y.Item>();
  for (const st of structs) if (st instanceof Y.Item) inFrame.set(idKey(st.id), st);

  // 帧内 item 的「根→…→item」键路径解析（全帧内可解析才返回；出帧=undefined→L2 面）。
  // 逐 item push parentSub（**含终点根条目**——其 parentSub=nodeId/edgeId；列表型插入 parentSub=
  // null 不占位——XML/text 内容链与 map 键链天然区分）
  const framePathOf = (st: Y.Item): { root: string; keys: string[] } | undefined => {
    const keys: string[] = [];
    let cur: Y.Item | undefined = st;
    let hops = 0;
    while (cur !== undefined && hops <= 64) {
      if (cur.parentSub != null) keys.push(cur.parentSub);
      const p = cur.parent as unknown;
      if (typeof p === 'string') return { root: p, keys: keys.reverse() };
      if (p instanceof Y.ID) {
        const pi = inFrame.get(idKey(p));
        if (pi === undefined) return undefined;   // 父出帧——不可判定归 L2
        cur = pi;
      } else return undefined;
      hops += 1;
    }
    return undefined;
  };

  for (const st of structs) {
    if (!(st instanceof Y.Item)) continue;
    const parent = st.parent as unknown;
    if (typeof parent === 'string') {
      if (parent === 'exec') return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: 'exec-root' };
      if (!FRAME_DENY_ROOTS.has(parent)) return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `unknown-root:${parent}` };
      if (parent === 'meta' && st.parentSub != null && !(META_WHITELIST as readonly string[]).includes(st.parentSub)) {
        return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `meta-key:${st.parentSub}` };
      }
      // Y4a T3（spec §0 条 8——L1 只查插入）：timelines 根直接子项档——根的直接子项必须是
      // Y.Map（timelines.<nodeId>=工程入口 Map；标量毒值拒）；容器创建本身合法（防把工程 Map
      // 当「标量槽里的 Map」拒掉）。**解码态内层 Y.Map 不可读键**（yjs Invalid access——_map 仅
      // integrate 时填充；inFrameTypeOf 同族结论）——字段执法=同帧全部子 struct 经 framePathOf
      // 走深链档逐值（本帧可解析路径全覆盖）；键完整性（版本/轨/片段的缺席）归 L2 事件面与
      // T4 写前自检。**删除集只有 client/clock、帧内读不出键名——删除三级不进 L1**（恢复导入
      // recovery-import 只跑本面：导入整棵新树=纯插入、天然不触删除档）。
      if (parent === 'timelines' && st.parentSub != null) {
        if (contentTypeOf(st) !== 'map') {
          return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `timeline-entry-not-map:${st.parentSub}` };
        }
      }
      continue;
    }
    if (!(parent instanceof Y.ID)) continue;
    const path = framePathOf(st);
    if (path === undefined) continue;   // 帧外父深链——L2 面（本帧不可判定）
    const { root, keys } = path;
    if (root === 'meta') {
      if (!(META_WHITELIST as readonly string[]).includes(keys[0] ?? '')) {
        return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `meta-key:${keys[0]}` };
      }
      continue;
    }
    if (root === 'edges') {
      // keys[0]=edgeId（根级条目）、keys[1]=边记录键
      if (keys.length >= 2 && !(DOC_EDGE_RECORD_KEYS as readonly string[]).includes(keys[1] ?? '')) {
        return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `edge-key:${keys[1]}` };
      }
      continue;
    }
    if (root === 'timelines') {
      // Y4a T3（spec §0 条 8）：timelines 帧内深链档——帧内可解析路径的 timelines struct 逐路径
      // 跑字段谓词（纯字段检查单源 timeline-frame-predicate）。keys=[nodeId, ...下钻]；本帧插入
      // 的值形态：标量槽（version/fps/canvasSize/span/transform/…）ContentAny 可直读；容器创建
      // （tracks/clips/keyframes/片段 Map/轨 Map）ContentType 匹配即放行、条目键完整性归 L2。
      // 删除集不执法（L1 只查插入——纯删帧 0 structs+DS 本档天然跳过）。
      const tErr = timelineStructErr(keys, st);
      if (tErr !== undefined) return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: tErr };
      continue;
    }
    if (root !== 'nodes') continue;
    // nodes 根：keys[0]=nodeId、keys[1]=信封键、keys[2+]=data 内下钻
    const envelopeKey = keys[1];
    if (envelopeKey === undefined) continue;
    if (!(NODE_ENVELOPE_KEYS as readonly string[]).includes(envelopeKey)) {
      return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `node-key:${envelopeKey}` };
    }
    if (keys.length === 2) {
      // 信封键直写：position/data=Map 容器创建（节点创建同帧形态）；其余=标量（id/type/parentId/
      // width/height）；data/position 裸值/异形容器=container-replacement（G17b）
      const kind = contentTypeOf(st);
      if (envelopeKey === 'position' || envelopeKey === 'data') {
        if (kind !== 'map') return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `container-replacement:${envelopeKey}` };
        continue;
      }
      if (contentKindOf(st) !== 'any' || !lwwValueOk({ yType: 'lww' } as DataKeySpec, st)) {
        return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `value-type:${envelopeKey}` };
      }
      continue;
    }
    if (envelopeKey === 'position') {
      // position 容器逐键：x/y 标量
      const k = keys[2] ?? '';
      if (!POSITION_KEYS.has(k) || contentKindOf(st) !== 'any' || !lwwValueOk({ yType: 'lww' } as DataKeySpec, st)) {
        return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `value-type:position.${k}` };
      }
      continue;
    }
    if (envelopeKey !== 'data') continue;
    // data 下钻：解析节点类型（帧内创建链：keys[0]=nodeId → 其信封 item 的 'type' 子项）
    const nodeId = keys[0] ?? '';
    const type = inFrameTypeOf(inFrame, nodeId);
    const typeDef = type !== undefined ? DOC_SCHEMA_V4[type] : undefined;
    if (typeDef === undefined) continue;   // 类型帧内不可解析（既有节点 data 写——L2 面）
    let spec: DataKeySpec | undefined = typeDef.data[keys[2] ?? ''];
    for (let i = 3; i < keys.length && spec !== undefined; i++) {
      spec = spec.children?.[keys[i]];
    }
    if (spec === undefined) {
      return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `unknown-data-key:${type}.${keys[keys.length - 1]}` };
    }
    // server-forbidden 键（fileId×4/status×4/trimTaskStatus/trimmedFileId/nodeStatus——doc-schema-v4
    // 共 11 个 forbidden 条目）：**Y2 C1 翻禁执法**——D9「登记≠现役执法」过渡态收口（第②步客户端
    // 固化写消除+写者改 mediaId 已同批落地；本步五处 continue→拒）——键被矩阵收编且写入即拒
    // （forbidden-data-key=翻禁后唯一执法面，旧键帧 4411）。
    if (spec.yType === 'server-forbidden') {
      return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `forbidden-data-key:${type}.${keys[2] ?? ''}` };
    }
    switch (spec.yType) {
      case 'lww':
      case 'lww-array':
        if (contentKindOf(st) !== 'any' || !lwwValueOk(spec, st)) {
          return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `value-type:${type}.${keys[2]}` };
        }
        break;
      case 'map':
      case 'array':
      case 'text':
      case 'xml': {
        // 容器键两形态：st=容器创建（parentSub=键名——ContentType 匹配）或容器内容写（parentSub=
        // null 列表插入——text=ContentString splice 面/xml=struct 内容面归 L1、array=ContentAny 条目）。
        // 任意深度成立（data 一级键 keys.length===3 与 children 下钻容器同形判别）。
        if (st.parentSub === keys[keys.length - 1]) {
          if (contentKindOf(st) !== 'type' || !containerKindMatches(spec.yType, contentTypeOf(st))) {
            return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `container-replacement:${type}.${keys[2]}` };
          }
        } else if (spec.yType === 'text') {
          const ck = contentKindOf(st);
          if (ck !== undefined && ck !== 'string' && ck !== 'format' && ck !== 'deleted') {
            return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `value-type:${type}.${keys[2]}` };
          }
        } else if (spec.yType === 'array') {
          const ck = contentKindOf(st);
          if (st.parentSub == null && ck !== undefined && ck !== 'any' && ck !== 'deleted' && ck !== 'type') {
            return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `value-type:${type}.${keys[2]}` };
          }
        } else if (spec.yType === 'map') {
          // map children 键写：children 键域（children spec 下钻——外层循环按每 struct 路径命中）
          const child = spec.children?.[keys[keys.length - 1]];
          if (child === undefined) {
            return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `unknown-data-key:${type}.${keys[keys.length - 1]}` };
          }
        }
        // xml 深链内容：归 L1/L2 单源（禁双表）
        break;
      }
    }
  }
  // 帧内节点创建的类型值域（NODE_CREATED type∉DOC_SCHEMA_V4=未知类型拒——exec 根「不在 schema 写入
  // 即 DENY」同族；帧内 type 子项可解析时前置拒，不可解析〔类型键未在本帧〕归 L2 后验）
  for (const st of inFrame.values()) {
    if ((st.parent as unknown) === 'nodes' && st.content instanceof Y.ContentType) {
      const t = inFrameTypeOf(inFrame, st.parentSub ?? '');
      if (t !== undefined && DOC_SCHEMA_V4[t] === undefined) {
        return { ok: false, code: CollabCloseCode.FRAME_MALFORMED, reason: `unknown-node-type:${t}` };
      }
    }
  }
  return { ok: true };
}
function inFrameTypeOf(inFrame: Map<string, Y.Item>, nodeId: string): string | undefined {
  // 解码态 Y.Map 实例读键=yjs Invalid access（未集成态）——改读帧内 'type' 子项 struct 的 ContentAny
  // 值（parent=根条目 item ID、parentSub='type'）。
  let nodeItemId: string | undefined;
  for (const st of inFrame.values()) {
    if ((st.parent as unknown) === 'nodes' && st.parentSub === nodeId && st.content instanceof Y.ContentType) {
      nodeItemId = idKey(st.id);
      break;
    }
  }
  if (nodeItemId === undefined) return undefined;
  for (const st of inFrame.values()) {
    const p = st.parent as unknown;
    if (st.parentSub === 'type' && p instanceof Y.ID && idKey(p) === nodeItemId && st.content instanceof Y.ContentAny) {
      const v = (st.content.arr as unknown[])[0];
      if (typeof v === 'string') return v;
    }
  }
  return undefined;
}

/** Y4a T3（spec §0 条 8）：timelines 帧内深链档逐 struct 字段执法（L1——纯解码级）。
 *  keys=[nodeId, ...下钻]；按末段键语义分流：
 *   - keys.length===1（入口键本体=容器创建）与 keys[1]=tracks/clips（容器创建/其条目容器）：
 *     容器创建本身合法、条目 Map 键集由同帧更深 struct 逐段执法（本档只拦「非 Map 容器替换」
 *     形态——ContentType 与末段键匹配即放行）；
 *   - keys[1]=version/fps/canvasSize：入口标量——ContentAny 可直读值，交纯字段谓词闭包执法；
 *   - keys[1]=tracks 下钻 keys[2]=trackId（轨 Map 容器创建/轨五键标量）：ContentAny 直读值执法；
 *   - keys[1]=clips 下钻 keys[2]=clipId（片段 Map 容器创建）与 keys[3]=片段标量键
 *     （span/transform/mediaId/type/…）：ContentAny 直读值执法；
 *   - keyframes 下钻（keys[3]='keyframes' 容器 / keys[4]=kfId 标量）：同族。
 *  解码态 Y.Map 不可读键（yjs Invalid access）——本档只执法「本帧插入的值」（ContentAny/ContentType
 *  可读面），键集完整性归 L2 事件面与 T4 写前自检。 */
function timelineStructErr(keys: readonly string[], st: Y.Item): string | undefined {
  const nodeId = keys[0] ?? '';
  if (nodeId === '') return `timeline-entry-not-map:${nodeId}`;
  if (keys.length === 1) {
    // 入口键本体：容器创建（ContentType=Y.Map）合法；标量=根直接子项非 Map 毒值（直接子项档
    // 已拦同形态——深链档同判防绕行）。
    return contentTypeOf(st) === 'map' ? undefined : `timeline-entry-not-map:${nodeId}`;
  }
  const seg1 = keys[1] ?? '';
  if (seg1 === 'tracks' || seg1 === 'clips') {
    if (keys.length === 2) return contentTypeOf(st) === 'map' ? undefined : `timeline-${seg1}:${nodeId}`;
    // 条目 Map 容器创建（keys[2]=trackId/clipId）合法；条目内键标量由更深 struct 执法。
    if (keys.length === 3) return contentTypeOf(st) === 'map' ? undefined : `timeline-${seg1}-entry:${keys[2]}`;
    const key = keys[3] ?? '';
    if (seg1 === 'tracks') {
      // 轨标量键（五键域+值域——ContentAny 直读）
      const v = anyValueOf(st);
      if (v === NOT_ANY) return `timeline-track:${keys[2]}.${key}`;
      return timelineScalarErr('track', keys[2] ?? '', key, v);
    }
    // clips 条目内：keys[3]=片段标量键（type/span/transform/…/keyframes）
    if (key === 'keyframes') {
      if (keys.length === 4) return contentTypeOf(st) === 'map' ? undefined : `timeline-keyframes:${keys[2]}`;
      // keys[4]=kfId 标量：ContentAny 直读执法
      const kv = anyValueOf(st);
      if (kv === NOT_ANY) return `timeline-keyframe:${keys[4] ?? ''}`;
      return timelineScalarErr('keyframe', keys[4] ?? '', 'keyframe', kv);
    }
    const v = anyValueOf(st);
    if (v === NOT_ANY) return `timeline-clip:${keys[2]}.${key}`;
    return timelineScalarErr('clip', keys[2] ?? '', key, v);
  }
  if (seg1 === 'version' || seg1 === 'fps' || seg1 === 'canvasSize') {
    const v = anyValueOf(st);
    if (v === NOT_ANY) return `timeline-entry:${nodeId}.${seg1}`;
    return timelineScalarErr('entry', nodeId, seg1, v);
  }
  return `timeline-entry-key:${nodeId}.${seg1}`;
}

/** ContentAny 单值直读（解码态——标量槽执法输入）。NOT_ANY=非 ContentAny 形态。 */
const NOT_ANY = Symbol('not-any');
function anyValueOf(st: Y.Item): unknown {
  if (!(st.content instanceof Y.ContentAny)) return NOT_ANY;
  const arr = st.content.arr as unknown[];
  return arr[0];
}

/** 入口/轨/片段标量槽值域（纯字段——timeline-frame-predicate 同族键矩阵按槽名分流）。
 *  调用方显式传 kind（'entry'|'track'|'clip'|'keyframe'——同帧路径形态可辨、禁按段数猜）。 */
function timelineScalarErr(kind: 'entry' | 'track' | 'clip' | 'keyframe', id: string, slot: string, v: unknown): string | undefined {
  if (kind === 'entry') {
    if (slot === 'version') return v === 1 ? undefined : `timeline-version:${id}`;
    if (slot === 'fps') return v === 30 ? undefined : `timeline-fps:${id}`;
    if (slot === 'canvasSize') {
      if (typeof v !== 'object' || v === null) return `timeline-canvas-size:${id}`;
      const cs = v as Record<string, unknown>;
      if (typeof cs.width !== 'number' || !Number.isFinite(cs.width) || cs.width <= 0) return `timeline-canvas-size:${id}.width`;
      if (typeof cs.height !== 'number' || !Number.isFinite(cs.height) || cs.height <= 0) return `timeline-canvas-size:${id}.height`;
      return undefined;
    }
    return undefined;
  }
  if (kind === 'track') {
    if (slot === 'type') return (v === 'video' || v === 'subtitle' || v === 'audio') ? undefined : `timeline-track-type:${id}`;
    if (slot === 'name') return typeof v === 'string' ? undefined : `timeline-track-name:${id}`;
    if (slot === 'muted' || slot === 'hidden') return typeof v === 'boolean' ? undefined : `timeline-track-${slot}:${id}`;
    if (slot === 'order') return isValidOrderKey(v) ? undefined : `timeline-track-order:${id}`;
    return undefined;   // 未知轨键：L2 键集执法（本帧不可判定面）
  }
  if (kind === 'clip') {
    if (slot === 'type') return (v === 'video' || v === 'image' || v === 'audio' || v === 'subtitle') ? undefined : `timeline-clip-type:${id}`;
    if (slot === 'span') return clipSpanErr(id, v);
    if (slot === 'transform') return clipTransformErr(id, v);
    if (slot === 'style') return clipStyleErr(id, v);
    if (slot === 'fade') return clipFadeErr(id, v);
    if (slot === 'volume') return typeof v === 'number' && Number.isFinite(v) ? undefined : `timeline-volume:${id}`;
    if (slot === 'playbackSpeed') return (v === 0.5 || v === 1 || v === 2) ? undefined : `timeline-playback-speed:${id}`;
    if (slot === 'transitionIn' || slot === 'transitionOut') return clipTransitionErr(id, slot, v);
    if (slot === 'mediaId') return typeof v === 'string' && v !== '' ? undefined : `timeline-media-id:${id}`;
    if (slot === 'sourceNodeId') return typeof v === 'string' ? undefined : `timeline-source-node:${id}`;
    if (slot === 'text') return typeof v === 'string' ? undefined : `timeline-text:${id}`;
    if (slot === 'visible') return typeof v === 'boolean' ? undefined : `timeline-visible:${id}`;
    return undefined;   // 未知片段键：L2 键集执法（本帧类型不可解析——值域归 L2）
  }
  // keyframe（keys[4]=kfId 标量）
  if (id === '') return 'timeline-keyframe-empty-id';
  if (typeof v !== 'object' || v === null) return `timeline-keyframe:${id}`;
  const kf = v as Record<string, unknown>;
  if (kf.id !== id) return `timeline-keyframe-id:${id}`;
  if (typeof kf.t !== 'number' || !Number.isFinite(kf.t)) return `timeline-keyframe-t:${id}`;
  if (kf.easing !== 'linear') return `timeline-keyframe-easing:${id}`;
  if (typeof kf.value !== 'number' || !Number.isFinite(kf.value)) return `timeline-keyframe-value:${id}`;
  return undefined;
}

/** span 标量槽（整值 JSON）字段执法（帧内类型不可解析=宽松档：sourceStart 负值仍拒〔类型
 *  两可皆有此键〕；image/subtitle 专属「禁 sourceStart」归 L2 键集面）。 */
function clipSpanErr(clipId: string, v: unknown): string | undefined {
  if (typeof v !== 'object' || v === null) return `timeline-span:${clipId}`;
  const s = v as Record<string, unknown>;
  if (typeof s.trackId !== 'string' || s.trackId === '') return `timeline-span:${clipId}.trackId`;
  if (typeof s.start !== 'number' || !Number.isFinite(s.start) || s.start < 0) return `timeline-span:${clipId}.start`;
  if (typeof s.duration !== 'number' || !Number.isFinite(s.duration) || s.duration <= 0) return `timeline-span:${clipId}.duration`;
  if (s.sourceStart !== undefined && (typeof s.sourceStart !== 'number' || !Number.isFinite(s.sourceStart) || s.sourceStart < 0)) return `timeline-span:${clipId}.sourceStart`;
  return undefined;
}

function clipTransformErr(clipId: string, v: unknown): string | undefined {
  if (typeof v !== 'object' || v === null) return `timeline-transform:${clipId}`;
  const t = v as Record<string, unknown>;
  for (const k of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) {
    if (typeof t[k] !== 'number' || !Number.isFinite(t[k])) return `timeline-transform:${clipId}.${k}`;
  }
  return undefined;
}

function clipStyleErr(clipId: string, v: unknown): string | undefined {
  if (typeof v !== 'object' || v === null) return `timeline-style:${clipId}`;
  const s = v as Record<string, unknown>;
  if (typeof s.fontSize !== 'number' || !Number.isFinite(s.fontSize) || s.fontSize <= 0) return `timeline-style:${clipId}.fontSize`;
  if (typeof s.letterSpacing !== 'number' || !Number.isFinite(s.letterSpacing)) return `timeline-style:${clipId}.letterSpacing`;
  if (typeof s.color !== 'string') return `timeline-style:${clipId}.color`;
  return undefined;
}

function clipFadeErr(clipId: string, v: unknown): string | undefined {
  if (typeof v !== 'object' || v === null) return `timeline-fade:${clipId}`;
  const f = v as Record<string, unknown>;
  if (typeof f.in !== 'number' || !Number.isFinite(f.in) || f.in < 0) return `timeline-fade:${clipId}.in`;
  if (typeof f.out !== 'number' || !Number.isFinite(f.out) || f.out < 0) return `timeline-fade:${clipId}.out`;
  return undefined;
}

function clipTransitionErr(clipId: string, slot: string, v: unknown): string | undefined {
  if (typeof v !== 'object' || v === null) return `timeline-${slot}:${clipId}`;
  const t = v as Record<string, unknown>;
  if (t.type !== 'fadeIn' && t.type !== 'fadeOut' && t.type !== 'crossfade' && t.type !== 'toBlack' && t.type !== 'toWhite') return `timeline-${slot}:${clipId}.type`;
  if (typeof t.duration !== 'number' || !Number.isFinite(t.duration) || t.duration <= 0) return `timeline-${slot}:${clipId}.duration`;
  return undefined;
}

// ═══════════════════ L2：apply 后 changed-subtree 语义执法（§3.2——事件级）═══════════════════

export interface L2Options { allowedUrlHosts?: readonly string[] }
export type L2Verdict = { ok: true } | { ok: false; reason: string };

/** 节点 live 类型读取（事件路径 nodeId → doc nodes map——apply 后临界区内存读）。 */
function liveNodeType(doc: Y.Doc, nodeId: string): string | undefined {
  const raw = doc.getMap('nodes').get(nodeId);
  if (!(raw instanceof Y.Map)) return undefined;
  const t = raw.get('type');
  return typeof t === 'string' ? t : undefined;
}

const XML_SPEC = new Set(['xml']);

/**
 * L2 apply 后 changed-subtree walk（afterTransaction 事件面——actor apply 成功后、appliedSeq 推进前）：
 *  - 事件路径（path[0]=nodeId）取 live 节点类型 → 矩阵执法：未知类型/未知键/server 键/容器替换/
 *    值类型错/type 不可变（G17b 对既有节点的 raw update 全覆盖面——frame-local 不可判定的后验）；
 *  - XML 触达子树整树 walk（validateXmlSubtree——xml-schema 单表单源）：帧外父挂接的未知元素属性/
 *    嵌套 fragment/超深链/超长文本/域外 URL/伪造 mention 锚（URL 形态）——L1 帧内不可解析面的兜底；
 *  - meta 根任意键写（META_WHITELIST 空）。
 * 返回 violation → 调用方走毒帧协议（4411+截断+全连接 close）+绑定表毒帧计数。
 */
export function validateAppliedL2(doc: Y.Doc, events: readonly Y.YEvent<never>[], opts: L2Options = {}): L2Verdict {
  const nodesRoot = doc.getMap('nodes');
  const edgesRoot = doc.getMap('edges');
  const metaRoot = doc.getMap('meta');
  // Y4a T3（spec §0 条 8——currentTarget 公开面）：timelines 根身份=安装观察者时拿到的那棵根
  // （本函数入口 getMap 一次——同名根就是同一对象〔spec §0 条 7〕；**身份比较约定**：谓词内部
  // 不再 getMap）。装载重扫 SERVER_TRANSACT_ORIGIN 在 applyGate 之外、下一帧 begin() 清
  // eventBuffer——不进本函数、不为重扫再开一路 L2。
  const timelinesRoot = doc.getMap('timelines');
  for (const ev of events) {
    // timelines 身份分支——**循环第一行、path.length===0 那个总会 continue 的块之前**（插到
    // 节点启发式之前不够：path 空事件已 continue、根上整棵新工程不检查=漏检面）。path 空与非空
    // 同一条：根事件（键增删）与子 Map 事件（path=[nodeId]/path=[nodeId,clips,clipId]…）都先比
    // currentTarget===timelinesRoot，命中即走时间轴谓词并结束这条事件（不进节点信封/边键启发式
    // ——entry Map 直接键事件曾会撞 :383 node-key:* 毒帧误杀）。
    if ((ev.currentTarget as unknown) === timelinesRoot) {
      const tErr = timelineEventErr(ev, timelinesRoot);
      if (tErr !== undefined) return { ok: false, reason: tErr };
      continue;
    }
    const path = ev.path as readonly string[];
    if (path.length === 0) {
      // 根级：nodes=节点增改（全信封校验）/edges=边记录键/meta=白名单——yjs 13.6.32 无 rootName
      // 公开面，三根按**身份比对**分类（path [] 的 target 恒为三根之一）
      const mapName = ev.target === metaRoot ? 'meta' : ev.target === edgesRoot ? 'edges' : ev.target === nodesRoot ? 'nodes' : undefined;
      if (mapName === 'meta') {
        // spec M4（收口择一=死码注记保留）：meta 写在 L1 帧内已全拒（META_WHITELIST 空）——本分支
        // 生产不可达（meta 根事件唯一来源=帧内 meta 写）；防御性保留（L2 面兜底+未来 META_WHITELIST
        // 扩键时即刻生效——删则扩键卡需重建本面）。
        for (const [k, ch] of ev.changes.keys) {
          if (ch.action !== 'delete' && !(META_WHITELIST as readonly string[]).includes(k)) {
            return { ok: false, reason: `meta-key:${k}` };
          }
        }
        continue;
      }
      if (mapName === 'edges') {
        for (const [eid, ch] of ev.changes.keys) {
          if (ch.action === 'delete') continue;
          const v = (ev.target as unknown as { get?: (k: string) => unknown })?.get?.(eid);
          if (!(v instanceof Y.Map)) return { ok: false, reason: `edge-not-map:${eid}` };
          for (const k of v.keys()) {
            if (!(DOC_EDGE_RECORD_KEYS as readonly string[]).includes(k)) return { ok: false, reason: `edge-key:${k}` };
          }
        }
        continue;
      }
      if (mapName === 'nodes') {
        for (const [nid, ch] of ev.changes.keys) {
          if (ch.action === 'delete') continue;
          const v = (ev.target as unknown as { get?: (k: string) => unknown })?.get?.(nid);
          const vErr = validateNodeShape(nid, v);
          if (vErr !== undefined) return { ok: false, reason: vErr };
        }
      }
      continue;
    }
    const nodeId = path[0] ?? '';
    // path[0] 归属判定（nodeId vs edgeId——两根子 map 事件同形）：edges 子事件=边记录键域
    if (!nodesRoot.has(nodeId)) {
      if (edgesRoot.has(nodeId)) {
        for (const [k, ch] of ev.changes.keys) {
          if (ch.action !== 'delete' && !(DOC_EDGE_RECORD_KEYS as readonly string[]).includes(k)) {
            return { ok: false, reason: `edge-key:${k}` };
          }
        }
      }
      continue;   // 同事务已删节点/未知归属——挂起面归根级事件
    }
    if (path.length === 1) {
      // 节点信封 map 事件：键域+type 不可变+data/position 容器形状+核心四键整删违规（I-3：删
      // type/id/data/position=节点成无类型/无数据残骸且 L2 liveNodeType 恒 undefined 跳过执法；
      // parentId/width/height=可选键〔null→真删键归一语义〕删除合法）
      const ENVELOPE_NON_DELETABLE = new Set(['type', 'id', 'data', 'position']);
      for (const [k, ch] of ev.changes.keys) {
        if (!(NODE_ENVELOPE_KEYS as readonly string[]).includes(k)) return { ok: false, reason: `node-key:${k}` };
        if (ch.action === 'delete' && ENVELOPE_NON_DELETABLE.has(k)) return { ok: false, reason: `envelope-key-deleted:${k}` };
        if (k === 'type' && ch.action === 'update') return { ok: false, reason: 'type-immutable' };
        if ((k === 'data' || k === 'position') && ch.action !== 'delete') {
          // 终验 I-7：信封容器整键 update=同型替换（「删了换新」等效绕过 canDelete=false 禁令——
          // 孤儿化整棵内容子树）；add=节点创建初始化（creation 路径）放行，形状不符照旧拒
          if (ch.action === 'update') return { ok: false, reason: `container-replacement:${nodeId}.${k}` };
          const cur = (ev.target as unknown as { get?: (kk: string) => unknown })?.get?.(k);
          if (!(cur instanceof Y.Map)) return { ok: false, reason: `container-replacement:${nodeId}.${k}` };
        }
      }
      continue;
    }
    const seg1 = path[1] ?? '';
    if (seg1 === 'position') continue;   // position 逐键（x/y）——信封通用域，无异常面
    if (seg1 !== 'data') continue;
    const nodeVal = nodesRoot.get(nodeId);
    const dataMap = nodeVal instanceof Y.Map ? nodeVal.get('data') : undefined;
    if (!(dataMap instanceof Y.Map)) continue;
    const type = liveNodeType(doc, nodeId);
    if (type === undefined) continue;
    const typeDef = DOC_SCHEMA_V4[type];
    if (typeDef === undefined) return { ok: false, reason: `unknown-node-type:${type}` };
    if (path.length === 2) {
      // data map 事件：逐变更键 k=data 键（lww 值域/容器形状/xml 子树 walk——对既有节点的 raw update 面）
      for (const [k, ch] of ev.changes.keys) {
        if (ch.action === 'delete') {
          if (!typeDef.data[k]?.canDelete) return { ok: false, reason: `key-not-deletable:${type}.${k}` };
          continue;
        }
        const spec = typeDef.data[k];
        if (spec === undefined) return { ok: false, reason: `unknown-data-key:${type}.${k}` };
        // 终验 I-7：同型容器整键覆盖（ch.action==='update' 且值为全新容器实例）——canDelete=false
        // 容器的「删了换新」等效绕过（T17「禁整串 LWW 覆盖」纪律 gate 面执法）；合法面区分：
        // 容器初始化=add（节点创建/缺失补建）；内容写=child/delta 事件（path≠键本身）——均非本档。
        if (ch.action === 'update' && (spec.yType === 'map' || spec.yType === 'array' || spec.yType === 'text' || spec.yType === 'xml')) {
          return { ok: false, reason: `container-replacement:${type}.${k}` };
        }
        const cur = dataMap.get(k);
        const vErr = dataValueShapeOk(type, k, spec, cur);
        if (vErr !== undefined) return { ok: false, reason: vErr };
        if (spec.yType === 'xml') {
          const r = xmlL2Touched(cur, ev, opts);
          if (!r.ok) return { ok: false, reason: `xml-l2:${r.reason}` };
        }
      }
      continue;
    }
    // path.length>=3：data 键容器内容事件（map children/text splice/xml 内容/array items）
    const spec: DataKeySpec | undefined = typeDef.data[path[2] ?? ''];
    if (spec === undefined) return { ok: false, reason: `unknown-data-key:${type}.${path[2]}` };
    if (spec.yType === 'xml') {
      const r = xmlL2Touched(dataMap.get(path[2] ?? ''), ev, opts);
      if (!r.ok) return { ok: false, reason: `xml-l2:${r.reason}` };
      continue;
    }
    if (spec.yType === 'map') {
      // children 键域（mapSpec——extConfig/prompt/textInput storyboard 等）
      for (const [k, ch] of ev.changes.keys) {
        if (ch.action === 'delete') continue;
        const child = spec.children?.[k];
        if (child === undefined) return { ok: false, reason: `unknown-data-key:${type}.${path[2]}.${k}` };
        if (child.yType === 'server-forbidden') return { ok: false, reason: `forbidden-data-key:${type}.${path[2]}.${k}` };   // Y2 C1 翻禁：现行矩阵死分支（全 forbidden 条目均为顶层 data 键、无 map children 条目）——同批一致翻转+防漂移（矩阵扩 forbidden children 条目即执法）
        const cur = (ev.target as unknown as { get?: (kk: string) => unknown })?.get?.(k);
        const cErr = dataValueShapeOk(type, k, child, cur);
        if (cErr !== undefined) return { ok: false, reason: cErr };
      }
    }
    // text/array 内容面：键级无操作（text splice=array 结构操作——L1/预算管辖）
  }
  return { ok: true };
}

/** Y4a T3（spec §0 条 8）：timelines 事件执法（L2 currentTarget 身份分支的谓词体）。
 *  - **根事件**（path 空）：action='add' 新值 Y.Map→**按路径递归这棵值**（同事务 new Y.Map 子树
 *    不发独立事件——只查「这是个 Map」漏掉整棵新工程）；action='delete'=三级删除规则（删
 *    version/fps/tracks/clips 容器键非法；删整棵 timelines.<nodeId> 合法）；action='update'=
 *    已存在键 set 新值——新值 Y.Map 且先前是 Map=结构拒绝（已存在键 set 新 Map）。
 *  - **子 Map 事件**（path=[nodeId,…]）：target=入口/轨/片段/keyframes Map——逐变更键走纯字段
 *    谓词（delete 档：入口容器键非法、轨/片段/关键帧条目键合法；add/update 档：标量整值+容器
 *    形状执法）。
 *  ev.changes 由 actor 观察者回调内物化（timelines-observer 同笔接线——不物化=事务后读抛
 *  errorComputeChanges→l2-internal 毒帧 4411 关全部连接）。 */
function timelineEventErr(ev: Y.YEvent<never>, timelinesRoot: Y.Map<unknown>): string | undefined {
  const path = ev.path as readonly string[];
  const changes = ev.changes;   // 物化面（观察者回调内已读——本函数在事务外消费）
  if (path.length === 0) {
    // 根事件：keys=timelines.<nodeId>
    for (const [nodeId, ch] of changes.keys) {
      if (ch.action === 'delete') continue;   // 删整棵 timelines.<nodeId>=三级合法
      const cur = (ev.target as unknown as { get?: (k: string) => unknown })?.get?.(nodeId);
      const prev = ch.action === 'add' ? undefined : ch.oldValue;
      const err = checkTimelineEntryValue(nodeId, cur, prev);
      if (err !== undefined) return err;
    }
    return undefined;
  }
  const nodeId = path[0] ?? '';
  if (path.length === 1) {
    // 入口 Map 直接键事件（canvasSize 增改/容器键换新/容器键删除）——不进节点启发式（:383
    // node-key:* 曾毒帧误杀合法改）：逐键执法。
    for (const [k, ch] of changes.keys) {
      if (ch.action === 'delete') {
        if (k === 'version' || k === 'fps' || k === 'tracks' || k === 'clips') {
          return `timeline-${k}-deleted:${nodeId}`;   // 三级删除规则——删容器键非法
        }
        continue;   // canvasSize 删除=合法
      }
      const cur = (ev.target as unknown as { get?: (k: string) => unknown })?.get?.(k);
      if (k === 'tracks' || k === 'clips') {
        if (!(cur instanceof Y.Map)) return `timeline-${k}:${nodeId}`;   // 容器键标量毒值
        if (ch.action === 'update') return `timeline-${k}-replaced:${nodeId}`;   // 已存在键 set 新 Map
        continue;   // add=缺失补建（creation 路径）——键完整性归根级/深链档
      }
      // 入口标量：version/fps 字面量+canvasSize 有限正（纯字段谓词闭包）
      if (k === 'version' || k === 'fps') {
        if (cur !== (k === 'version' ? 1 : 30)) return `timeline-${k}:${nodeId}`;
        continue;
      }
      if (k === 'canvasSize') {
        if (typeof cur !== 'object' || cur === null) return `timeline-canvas-size:${nodeId}`;
        const cs = cur as Record<string, unknown>;
        if (typeof cs.width !== 'number' || !Number.isFinite(cs.width) || cs.width <= 0) return `timeline-canvas-size:${nodeId}.width`;
        if (typeof cs.height !== 'number' || !Number.isFinite(cs.height) || cs.height <= 0) return `timeline-canvas-size:${nodeId}.height`;
        continue;
      }
      return `timeline-entry-key:${nodeId}.${k}`;   // 入口键封闭集
    }
    return undefined;
  }
  const seg1 = path[1] ?? '';
  if (seg1 === 'tracks') {
    // 轨容器：keys=trackId（条目增删/换新）或 path[2]=trackId 直键事件（五键标量）
    if (path.length === 2) {
      for (const [tid, ch] of changes.keys) {
        if (ch.action === 'delete') continue;   // 删轨条目=三级合法
        const cur = (ev.target as unknown as { get?: (k: string) => unknown })?.get?.(tid);
        if (!(cur instanceof Y.Map)) return `timeline-track:${tid}`;
        if (ch.action === 'update') return `timeline-track-replaced:${tid}`;   // 已存在轨键 set 新 Map
      }
      return undefined;
    }
    const tid = path[2] ?? '';
    for (const [k, ch] of changes.keys) {
      if (ch.action === 'delete') continue;
      const cur = (ev.target as unknown as { get?: (k: string) => unknown })?.get?.(k);
      if (k === 'type') return (cur === 'video' || cur === 'subtitle' || cur === 'audio') ? undefined : `timeline-track-type:${tid}`;
      if (k === 'name') return typeof cur === 'string' ? undefined : `timeline-track-name:${tid}`;
      if (k === 'muted' || k === 'hidden') return typeof cur === 'boolean' ? undefined : `timeline-track-${k}:${tid}`;
      if (k === 'order') return isValidOrderKey(cur) ? undefined : `timeline-track-order:${tid}`;
      return `timeline-track-key:${tid}.${k}`;
    }
    return undefined;
  }
  if (seg1 === 'clips') {
    // 片段容器：keys=clipId（条目增删/换新）或更深 path[2]=clipId…（片段键标量/keyframes 键级）
    if (path.length === 2) {
      for (const [cid, ch] of changes.keys) {
        if (ch.action === 'delete') continue;   // 删片段条目=三级合法
        const cur = (ev.target as unknown as { get?: (k: string) => unknown })?.get?.(cid);
        if (!(cur instanceof Y.Map)) return `timeline-clip:${cid}`;
        if (ch.action === 'update') return `timeline-clip-replaced:${cid}`;   // 已存在片段键 set 新 Map
        const err = checkTimelineClipMapOfEvent(cid, cur);
        if (err !== undefined) return err;
      }
      return undefined;
    }
    const cid = path[2] ?? '';
    if (path.length === 3) {
      // 片段 Map 直接键事件：标量整值/容器形状/键封闭集（type 键矩阵执法）
      const clipMap = ev.target as unknown as Y.Map<unknown>;
      const type = clipMap.get('type');
      for (const [k, ch] of changes.keys) {
        if (ch.action === 'delete') continue;
        const cur = (clipMap as unknown as { get?: (k: string) => unknown })?.get?.(k);
        if (k === 'keyframes') {
          if (type === 'subtitle') return `timeline-clip-key:${cid}.keyframes`;   // 字幕无此键
          if (!(cur instanceof Y.Map)) return `timeline-keyframes:${cid}`;
          if (ch.action === 'update') return `timeline-keyframes-replaced:${cid}`;   // 已存在键 set 新 Map
          continue;   // add=随片段出生（同笔事务）
        }
        if (typeof type !== 'string') return `timeline-clip-type:${cid}`;
        const err = timelineClipScalarErr(cid, type, k, cur, ch.action === 'add');
        if (err !== undefined) return err;
      }
      return undefined;
    }
    if (path[3] === 'keyframes') {
      // keyframes 容器：keys=kfId 条目（t/id/easing/property 值域——Volume/Transform 两档按
      // 片段类型分流；类型=live doc 经 timelinesRoot 沿 path 读 clips.<clipId> 的 'type' 键）。
      // T3-fix I#2（评审回包）：条目 action='update'=codec 的合法整值替换路径（kf.set(k.id,
      // {...k})——timeline-codec.ts keyframes 键级 update 同族）——走新值校验、值非法才拒
      // （修前无条件拒 timeline-keyframe-replaced=合法关键帧移动被 L2 毒帧）。
      const kfClipType = kfClipTypeOf(ev, timelinesRoot);
      if (path.length === 4) {
        for (const [kId, ch] of changes.keys) {
          if (ch.action === 'delete') continue;   // 删关键帧条目=三级合法
          const cur = (ev.target as unknown as { get?: (k: string) => unknown })?.get?.(kId);
          const err = timelineKeyframeErr(kId, cur, kfClipType);
          if (err !== undefined) return err;
        }
        return undefined;
      }
      // path.length>=5：关键帧 Map 直接键事件（同事务建好不发独立事件——防御性同款执法）
      const kId = path[4] ?? '';
      for (const [k, ch] of changes.keys) {
        if (ch.action === 'delete') continue;
        void k;
        const cur = (ev.target as unknown as { get?: (kk: string) => unknown })?.get?.(kId);
        const err = timelineKeyframeErr(kId, cur, kfClipType);
        if (err !== undefined) return err;
        break;
      }
      return undefined;
    }
    return undefined;   // 片段容器其他深链（未知形态）——容器形状档已在 length===3 执法
  }
  return undefined;
}

/** 新片段 Map 键级执法（根/容器 add 事件面——checkTimelineClipMap 的 L2 事件包装）。 */
function checkTimelineClipMapOfEvent(cid: string, clipMap: Y.Map<unknown>): string | undefined {
  const err = checkTimelineClipMap(cid, clipMap);
  return err;
}

/** 片段标量键值域（L2 事件面——timeline-frame-predicate 键矩阵同源闭包；add/update 同档）。 */
function timelineClipScalarErr(cid: string, type: string, k: string, cur: unknown, isAdd: boolean): string | undefined {
  const allowed = CLIP_KEY_SETS[type];
  if (allowed === undefined) return `timeline-clip-type:${cid}`;
  if (!allowed.has(k)) return `timeline-clip-key:${cid}.${k}`;
  if (k === 'type') return (cur === 'video' || cur === 'image' || cur === 'audio' || cur === 'subtitle') ? undefined : `timeline-clip-type:${cid}`;
  if (k === 'span') {
    if (typeof cur !== 'object' || cur === null) return `timeline-span:${cid}`;
    const s = cur as Record<string, unknown>;
    if (typeof s.trackId !== 'string' || s.trackId === '') return `timeline-span:${cid}.trackId`;
    if (typeof s.start !== 'number' || !Number.isFinite(s.start) || s.start < 0) return `timeline-span:${cid}.start`;
    if (typeof s.duration !== 'number' || !Number.isFinite(s.duration) || s.duration <= 0) return `timeline-span:${cid}.duration`;
    if (s.sourceStart !== undefined && (typeof s.sourceStart !== 'number' || !Number.isFinite(s.sourceStart) || s.sourceStart < 0)) return `timeline-span:${cid}.sourceStart`;
    if ((type === 'image' || type === 'subtitle') && s.sourceStart !== undefined) return `timeline-span:${cid}.sourceStart-forbidden`;
    return undefined;
  }
  if (k === 'transform') {
    if (typeof cur !== 'object' || cur === null) return `timeline-transform:${cid}`;
    const t = cur as Record<string, unknown>;
    for (const f of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) {
      if (typeof t[f] !== 'number' || !Number.isFinite(t[f])) return `timeline-transform:${cid}.${f}`;
    }
    return undefined;
  }
  if (k === 'style') {
    if (typeof cur !== 'object' || cur === null) return `timeline-style:${cid}`;
    const s = cur as Record<string, unknown>;
    if (typeof s.fontSize !== 'number' || !Number.isFinite(s.fontSize) || s.fontSize <= 0) return `timeline-style:${cid}.fontSize`;
    if (typeof s.letterSpacing !== 'number' || !Number.isFinite(s.letterSpacing)) return `timeline-style:${cid}.letterSpacing`;
    if (typeof s.color !== 'string') return `timeline-style:${cid}.color`;
    return undefined;
  }
  if (k === 'fade') {
    if (typeof cur !== 'object' || cur === null) return `timeline-fade:${cid}`;
    const f = cur as Record<string, unknown>;
    if (typeof f.in !== 'number' || !Number.isFinite(f.in) || f.in < 0) return `timeline-fade:${cid}.in`;
    if (typeof f.out !== 'number' || !Number.isFinite(f.out) || f.out < 0) return `timeline-fade:${cid}.out`;
    return undefined;
  }
  if (k === 'volume') return typeof cur === 'number' && Number.isFinite(cur) ? undefined : `timeline-volume:${cid}`;
  if (k === 'playbackSpeed') return (cur === 0.5 || cur === 1 || cur === 2) ? undefined : `timeline-playback-speed:${cid}`;
  if (k === 'transitionIn' || k === 'transitionOut') {
    if (cur === undefined) return `timeline-${k}:${cid}`;
    if (typeof cur !== 'object' || cur === null) return `timeline-${k}:${cid}`;
    const t = cur as Record<string, unknown>;
    if (t.type !== 'fadeIn' && t.type !== 'fadeOut' && t.type !== 'crossfade' && t.type !== 'toBlack' && t.type !== 'toWhite') return `timeline-${k}:${cid}.type`;
    if (typeof t.duration !== 'number' || !Number.isFinite(t.duration) || t.duration <= 0) return `timeline-${k}:${cid}.duration`;
    return undefined;
  }
  if (k === 'mediaId') return typeof cur === 'string' && cur !== '' ? undefined : `timeline-media-id:${cid}`;
  if (k === 'sourceNodeId') return typeof cur === 'string' ? undefined : `timeline-source-node:${cid}`;
  if (k === 'text') return typeof cur === 'string' ? undefined : `timeline-text:${cid}`;
  if (k === 'visible') return typeof cur === 'boolean' ? undefined : `timeline-visible:${cid}`;
  void isAdd;
  return undefined;
}

/** keyframes 事件所在片段的类型读取（live doc 经 timelinesRoot 沿 path——nodeId/clips/clipId；
 *  类型不可解析（片段已删/毒值）=Transform 档宽松）。 */
function kfClipTypeOf(ev: Y.YEvent<never>, timelinesRoot: Y.Map<unknown>): string | undefined {
  const path = ev.path as readonly string[];
  const nodeId = path[0] ?? '';
  const clipId = path[2] ?? '';
  const entry = timelinesRoot.get(nodeId);
  if (!(entry instanceof Y.Map)) return undefined;
  const clips = entry.get('clips');
  if (!(clips instanceof Y.Map)) return undefined;
  const clip = clips.get(clipId);
  if (!(clip instanceof Y.Map)) return undefined;
  const type = clip.get('type');
  return typeof type === 'string' ? type : undefined;
}

/** 关键帧标量执法（L2 事件面——Volume/Transform 两档按片段类型分流：audio 档**禁 property**
 *  〔音量关键帧无 property——切比例不改，spec §3.1 v7 修订③〕+Transform 档 property∈五键；
 *  类型不可解析=Transform 档宽松）。 */
function timelineKeyframeErr(kId: string, cur: unknown, clipType: string | undefined): string | undefined {
  if (kId === '') return 'timeline-keyframe-empty-id';
  if (typeof cur !== 'object' || cur === null) return `timeline-keyframe:${kId}`;
  const v = cur as Record<string, unknown>;
  if (v.id !== kId) return `timeline-keyframe-id:${kId}`;
  if (typeof v.t !== 'number' || !Number.isFinite(v.t)) return `timeline-keyframe-t:${kId}`;
  if (v.easing !== 'linear') return `timeline-keyframe-easing:${kId}`;
  if (typeof v.value !== 'number' || !Number.isFinite(v.value)) return `timeline-keyframe-value:${kId}`;
  if (clipType === 'audio') {
    if ('property' in v) return `timeline-keyframe-property:${kId}`;   // VolumeKeyframe 无 property
    return undefined;
  }
  // TransformKeyframe：property 必在且 ∈ 五键（x/y/scale/rotation/opacity）。
  if (v.property !== 'x' && v.property !== 'y' && v.property !== 'scale' && v.property !== 'rotation' && v.property !== 'opacity') {
    return `timeline-keyframe-property:${kId}`;
  }
  return undefined;
}

/** XML 触达子树 L2 检查（C-2 语义对齐）：整树 walk（名/属性/mark/URL/深度/嵌套）+**事件增量
 *  字节面**（YTextEvent.delta 的 insert 串逐段 ≤XML_TEXT_MAX_BYTES——spec 词面「单 ContentString」；
 *  整树累计语义废止：两段各 100KB 合法续写不得毒帧循环——节点累计增长由帧 struct 预算+doc 常驻
 *  字节闸既有面界承担，禁自造更严的无契约上限）。 */
function xmlL2Touched(container: unknown, ev: Y.YEvent<never>, opts: L2Options): L2Verdict {
  // 事件增量面先行：本事务新增 insert 串逐段判定（delta=事务局部变更——非与既有内容合并）
  const delta = (ev as unknown as { delta?: ReadonlyArray<{ insert?: unknown }> }).delta;
  if (Array.isArray(delta)) {
    for (const d of delta) {
      if (typeof d.insert === 'string' && new TextEncoder().encode(d.insert).byteLength > XML_TEXT_MAX_BYTES) {
        return { ok: false, reason: 'xml-text-bytes-exceeded' };
      }
    }
  }
  return validateXmlSubtree(container, opts);
}

/** data 键值形状（L2 键级——lww 标量/lww-array 标量数组/容器 instanceof 匹配〔G17b〕）。 */
function dataValueShapeOk(type: string, key: string, spec: DataKeySpec, cur: unknown): string | undefined {
  if (spec.yType === 'server-forbidden') return `forbidden-data-key:${type}.${key}`;   // Y2 C1 翻禁：登记≠执法收口（写者已随第②步消除——禁键写入即毒帧）
  switch (spec.yType) {
    case 'map': return cur instanceof Y.Map ? undefined : `container-replacement:${type}.${key}`;
    case 'array': return cur instanceof Y.Array ? undefined : `container-replacement:${type}.${key}`;
    case 'text': return cur instanceof Y.Text ? undefined : `container-replacement:${type}.${key}`;
    case 'xml': return cur instanceof Y.XmlFragment ? undefined : `container-replacement:${type}.${key}`;
    case 'lww': return isPrimitive(cur) ? undefined : `value-type:${type}.${key}`;
    case 'lww-array': return Array.isArray(cur) && (cur as unknown[]).every(isPrimitive) ? undefined : `value-type:${type}.${key}`;
    default: return undefined;
  }
}

/** 节点整体形状校验（NODE_CREATED/根级 update——信封键域+类型+data 键域+容器形状）。 */
function validateNodeShape(nodeId: string, v: unknown): string | undefined {
  if (!(v instanceof Y.Map)) return `node-not-map:${nodeId}`;
  const type = v.get('type');
  if (typeof type !== 'string' || DOC_SCHEMA_V4[type] === undefined) return `unknown-node-type:${String(type)}`;
  for (const k of v.keys()) {
    if (!(NODE_ENVELOPE_KEYS as readonly string[]).includes(k)) return `node-key:${k}`;
  }
  const data = v.get('data');
  if (data === undefined) return undefined;
  if (!(data instanceof Y.Map)) return `container-replacement:${nodeId}.data`;
  const def = DOC_SCHEMA_V4[type]!;
  for (const k of data.keys()) {
    const spec = def.data[k];
    if (spec === undefined) return `unknown-data-key:${type}.${k}`;
    if (spec.yType === 'server-forbidden') return `forbidden-data-key:${type}.${k}`;   // Y2 C1 翻禁：登记≠执法收口（写者已随第②步消除——禁键写入即毒帧）
    const cur = data.get(k);
    switch (spec.yType) {
      case 'map': if (!(cur instanceof Y.Map)) return `container-replacement:${type}.${k}`; break;
      case 'array': if (!(cur instanceof Y.Array)) return `container-replacement:${type}.${k}`; break;
      case 'text': if (!(cur instanceof Y.Text)) return `container-replacement:${type}.${k}`; break;
      case 'xml': if (!(cur instanceof Y.XmlFragment)) return `container-replacement:${type}.${k}`; break;
      case 'lww': if (!isPrimitive(cur)) return `value-type:${type}.${k}`; break;
      case 'lww-array': if (!(Array.isArray(cur) && (cur as unknown[]).every(isPrimitive))) return `value-type:${type}.${k}`; break;
    }
    if (spec.yType === 'map' && spec.children) {
      for (const [ck, cval] of (cur as Y.Map<unknown>).entries()) {
        const child = spec.children[ck];
        if (child === undefined) return `unknown-data-key:${type}.${k}.${ck}`;
        if (child.yType === 'server-forbidden') return `forbidden-data-key:${type}.${k}.${ck}`;   // Y2 C1 翻禁：现行矩阵死分支（全 forbidden 条目均为顶层 data 键、无 map children 条目）——同批一致翻转+防漂移
        if ((child.yType === 'lww') && !isPrimitive(cval)) return `value-type:${type}.${k}.${ck}`;
      }
    }
  }
  return undefined;
}
