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

/** root 白名单（exec 根删除——spec §3.1 顶层三根 meta/nodes/edges；写 exec 根=DENY）。 */
export const FRAME_DENY_ROOTS = new Set(['nodes', 'edges', 'meta']);

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
    // server-forbidden 键（fileId/result/status 族）：**登记≠现役执法**——D9 顺序：写者/读者保留至
    // T32（客户端 copy/新建保留 fileId=v11 裁决③；writeExecStatus 族 until=T32）——键被矩阵收编
    // （非 unknown-key 拒）但写入不禁；T32 删写者同批翻禁（plan T24 登记项）。
    if (spec.yType === 'server-forbidden') continue;
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
  for (const ev of events) {
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
        if (child.yType === 'server-forbidden') continue;   // D9：登记≠执法（T32 翻禁）
        const cur = (ev.target as unknown as { get?: (kk: string) => unknown })?.get?.(k);
        const cErr = dataValueShapeOk(type, k, child, cur);
        if (cErr !== undefined) return { ok: false, reason: cErr };
      }
    }
    // text/array 内容面：键级无操作（text splice=array 结构操作——L1/预算管辖）
  }
  return { ok: true };
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
  if (spec.yType === 'server-forbidden') return undefined;   // D9：登记≠执法（T32 翻禁）
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
    if (spec.yType === 'server-forbidden') continue;   // D9：登记≠执法（写者至 T32——copy/新建 fileId 面）
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
        if (child.yType === 'server-forbidden') continue;   // D9：登记≠执法（T32 翻禁）
        if ((child.yType === 'lww') && !isPrimitive(cval)) return `value-type:${type}.${k}.${ck}`;
      }
    }
  }
  return undefined;
}
