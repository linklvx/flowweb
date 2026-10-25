// packages/shared/src/canvas/doc-codec.ts
// Y1c T4（plan v1.7）：DocCodec 双出口——真 Yjs 类型直用（zero-yjs 纪律废止——偏离 33；
// shared 直用 Y.Doc/Y.Map/Y.Text/Y.XmlFragment/Y.Array，DocLike fake 镜像不建）。
//
// 三出口 + 重建/等价（readCanvas 只返回 read model——禁止共享类型逃逸）：
//   - serializeCanvas(doc): CanvasDocument——canonical 类型化快照（备份/重建/semanticEqual）。
//     嵌套 Y 类型打标签编码（$yjs 判别：text=delta/xml=PM JSON/map=逐键/array=逐项）；
//     语义快照非字节快照（≠Y.encodeStateAsUpdate——墓碑/事务壳不随行）。
//   - toReadModel(doc): CanvasReadModel——plain JSON 读模型（REST/执行/导出唯一共享读类型）：
//     文本显式 string、富文本 {text,html,json}（PromptValue{text,html} 口径扩展）、
//     Y.Map/Y.Array 递归平面化；v3 纯 JSON 值逐位透传（≡readRecordsFromMaps——收编零行为变更锚）。
//   - toPublicReadModel(readModel, policy): 公开快照 sanitize——dropTypes/逐类型 data 键白名单/
//     RichTextValue 只余 text（红线 1：html/json 永不出公开面）/URL host allowlist。
//   - rebuildCanvasDoc(cd) / semanticEqual(a,b)——备份回灌配套（anti-aliasing：全量新实例重建，
//     F-S2-1 别名路径禁入——readRecordsFromMaps→fillDoc 直连的跨 doc 引用共享不适用本出口）。
//
// 收编（readRecordsFromMaps 唯一 import=本模块）：读基座沿用 docShape.readRecordsFromMaps
// （信封键/position 读/null 消除/E68 全函数——语义零改动），本层只做嵌套 Y 类型的编码/解码。
// fillDoc 同引（重建的信封+data 写单源——data.set 收全新 Y 实例=合法首集成，非别名）。
// 无 transformV3ToV4Draft（硬重置——spec v5-13：v3 值由 T15/T16/T17 写点改造迁移，codec/执行读面双载体〔面板/快照消费面已单载体——T15〕）。
import * as Y from 'yjs';
import { fillDoc, readRecordsFromMaps, type DocLike, type DocEdgeRecord } from './docShape';
import type { TextLike } from './text-domains';
import type { XmlFragmentLike, XmlElementLike, XmlTextLike } from './xml-schema';
import type { YArrayLike } from './array-domains';
import { type DocMapLike, type StoredNodeRecord } from './collab-doc-ops';

// ── 值域类型：PM JSON / 富文本 / canonical 打标签快照 ──

/** PM（ProseMirror）JSON 节点子集——XmlFragment 与 Tiptap 双端的交换形（attrs 值=字符串域）。
 *  mention/image 的 PM 形状：{type:'mention',attrs:{'data-id',label}} / {type:'image',attrs:{src,alt}}。 */
export interface PmNode {
  type: string;
  text?: string;
  attrs?: Record<string, string>;
  content?: PmNode[];
}

/** 富文本读出口（XmlFragment→{text,html,json}——PromptValue{text,html} 口径带结构面）。 */
export interface RichTextValue {
  /** 纯文本（mention→label/image→空——拼接净文本） */
  text: string;
  /** HTML 渲染（公开面永不携带——红线 1；toPublicReadModel 剥除） */
  html: string;
  /** PM JSON 结构（往返真值——重建/导出用） */
  json: PmNode[];
}

/** Y.Text delta 快照项（toDelta 净态=insert-only；attributes=PM marks 域——字符串值）。 */
export interface YTextDeltaItem {
  insert: string;
  attributes?: Record<string, string>;
}

// canonical 打标签形态（$yjs 判别键——保留字约定：data 键值域禁用该字面键形状；
// serializeYValue 执法：plain 值带已知标签字面量 ⇒ RESERVED_YJS_TAG fail-fast throw）
export interface YTextSnapshot { $yjs: 'text'; delta: YTextDeltaItem[] }
export interface YXmlSnapshot { $yjs: 'xml'; json: PmNode[] }
export interface YMapSnapshot { $yjs: 'map'; entries: Record<string, CanvasDocValue> }
export interface YArraySnapshot { $yjs: 'array'; items: CanvasDocValue[] }

/** canonical 值域：plain JSON（v3 现实载体）∪ 嵌套 Y 类型标签快照（v4 目标载体）。 */
export type CanvasDocValue =
  | null | boolean | number | string
  | CanvasDocValue[]
  | { [key: string]: CanvasDocValue }
  | YTextSnapshot | YXmlSnapshot | YMapSnapshot | YArraySnapshot;

/** canonical 节点快照（StoredNodeRecord 同形——data 值域换 canonical 标签形态）。 */
export interface CanvasNodeSnapshot {
  id: string;
  type: string;
  parentId?: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  data: Record<string, CanvasDocValue>;
}

/** canonical 边快照（单形状 source/target 可选——与 DocEdgeRecord 同形）。 */
export interface CanvasEdgeSnapshot {
  id: string;
  source?: string;
  target?: string;
}

/** doc canonical 类型化快照（备份/重建/semanticEqual 域）：nodes+edges+meta（meta=T18 起零活键
 *  ——旧档残留仅历史载荷，round-trip 保真透传不解释）。exec 根不在本面（Y1c T22/T32 删除项——
 *  codec 无 exec 读者）。 */
export interface CanvasDocument {
  nodes: CanvasNodeSnapshot[];
  edges: CanvasEdgeSnapshot[];
  meta: Record<string, unknown>;
}

/** 读模型节点（StoredNodeRecord 同形——data=纯 plain JSON，嵌套 Y 类型已解码）。 */
export interface CanvasReadModelNode extends StoredNodeRecord {}

/** 读模型边（DocEdgeRecord 同形）。 */
export interface CanvasReadModelEdge extends DocEdgeRecord {}

/** plain JSON 读模型（REST/执行/导出唯一共享读类型——禁止共享 Y 实例逃逸；
 *  v3 doc 出口 ≡ readRecordsFromMaps（收编零行为变更——键序恒等含 JSON.stringify 口径））。 */
export interface CanvasReadModel {
  nodes: CanvasReadModelNode[];
  edges: CanvasReadModelEdge[];
}

/** 公开快照策略（小类型化 policy——白名单真源住调用方：api snapshot-filter WHITELIST 表未上移，
 *  shared 不造第二份逐类型表防漂移；调用方传表+URL 域）。 */
export interface PublicSnapshotPolicy {
  /** 丢弃节点类型（连带引用它的边） */
  dropTypes?: readonly string[];
  /** 逐类型 data 键白名单（未列类型=data 全剥） */
  dataKeys: Record<string, readonly string[]>;
  /** URL host allowlist：data 字符串值为 http(s) URL 且 host 不在列 ⇒ 该键剥除；
   *  缺省=不做 URL 过滤（调用方显式决策）。 */
  allowedUrlHosts?: readonly string[];
}

// ── 内部装置 ──

/** Y.Doc→DocLike 结构适配（fillDoc/createMap 工厂注入——doc-like.util/ydocBuilder 同款手法；
 *  readRecordsFromMaps 只用 getMap 面。Y1c T15 增 createText——Y.Text 域容器物化工厂；
 *  Y1c T16 增三 XML 工厂——XmlFragment 域容器物化〔rebuildCanvasDoc 创建 seam〕；
 *  Y1c T17 增 createArray——媒体列表 Y.Array 域容器物化）。 */
const asDocLike = (doc: Y.Doc): DocLike => ({
  getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
  createMap: () => new Y.Map() as unknown as DocMapLike,
  createText: () => new Y.Text() as unknown as TextLike,
  createXmlFragment: () => new Y.XmlFragment() as unknown as XmlFragmentLike,
  createXmlElement: (name) => new Y.XmlElement(name) as unknown as XmlElementLike,
  createXmlText: () => new Y.XmlText() as unknown as XmlTextLike,
  createArray: () => new Y.Array() as unknown as YArrayLike,
});

/** plain JSON 值深拷贝（read model/canonical 双出口防 doc 内值引用逃逸——mutate 隔离）。
 *  非 clone-able 罕见形态（类实例）原样返回不崩（E68 读侧全函数口径）。 */
const clonePlain = (v: unknown): unknown => {
  if (v === null || typeof v !== 'object') return v;
  try { return structuredClone(v); } catch { return v; }
};

// ── PM JSON 编解码（XmlFragment ⇄ PmNode[]）──

/** XmlFragment 子节点 → PM JSON（YXmlHook=DOM 插槽占位——非 DOM 栈不产生；按惰性元素标记编码
 *  保 round-trip 稳定）。 */
type XmlChild = Y.XmlElement | Y.XmlText | Y.XmlHook;

function xmlNodeToPm(node: XmlChild): PmNode {
  if (node instanceof Y.XmlHook) return { type: node.hookName };
  if (node instanceof Y.XmlText) {
    const text = node.toString();   // Y.Text.toString=净文本
    const attrs = node.getAttributes() as Record<string, string>;
    return Object.keys(attrs).length > 0 ? { type: 'text', text, attrs } : { type: 'text', text };
  }
  const attrs = node.getAttributes() as Record<string, string>;
  const content = node.toArray().map(xmlNodeToPm);
  return {
    type: node.nodeName,
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(content.length > 0 ? { content } : {}),
  };
}

/** XmlFragment → PM JSON（paragraph/mention/image/text 节点树——attrs 保序键集）。 */
function xmlToPmJson(frag: Y.XmlFragment): PmNode[] {
  return frag.toArray().map(xmlNodeToPm);
}

function pmToXmlNode(n: PmNode): Y.XmlElement | Y.XmlText {
  if (n.type === 'text') {
    const t = new Y.XmlText();
    if (n.text) t.insert(0, n.text);
    for (const [k, v] of Object.entries(n.attrs ?? {})) t.setAttribute(k, v);
    return t;
  }
  const el = new Y.XmlElement(n.type);
  for (const [k, v] of Object.entries(n.attrs ?? {})) el.setAttribute(k, v);   // attrs=字符串域（PmNode 契约）
  const children = (n.content ?? []).map(pmToXmlNode);
  if (children.length > 0) el.insert(0, children);
  return el;
}

/** PM JSON → 全新 XmlFragment（重建域——新实例首集成，非别名）。 */
function pmToXmlFragment(json: readonly PmNode[]): Y.XmlFragment {
  const frag = new Y.XmlFragment();
  const children = json.map(pmToXmlNode);
  if (children.length > 0) frag.insert(0, children);
  return frag;
}

// ── PM JSON 派生渲染（text/html——读出口专用，公开面只余 text）──

const nodeTextOf = (n: PmNode): string => {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'mention') return n.attrs?.label ?? '';
  if (n.type === 'image') return '';   // 图片非文本承载（alt=展示元数据不进净文本）
  return (n.content ?? []).map(nodeTextOf).join('');
};

const pmJsonToText = (json: readonly PmNode[]): string => json.map(nodeTextOf).join('');

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
const attrsToHtml = (attrs: Record<string, string> | undefined): string =>
  Object.entries(attrs ?? {}).map(([k, v]) => ` ${k}="${escapeHtml(String(v ?? ''))}"`).join('');

const nodeHtmlOf = (n: PmNode): string => {
  if (n.type === 'text') return escapeHtml(n.text ?? '');
  if (n.type === 'mention') {
    const a = n.attrs ?? {};
    return `<span class="mention" data-id="${escapeHtml(a['data-id'] ?? '')}">${escapeHtml(a.label ?? '')}</span>`;
  }
  if (n.type === 'image') {
    const a = n.attrs ?? {};
    return `<img src="${escapeHtml(a.src ?? '')}" alt="${escapeHtml(a.alt ?? '')}">`;
  }
  if (n.type === 'paragraph') {
    return `<p${attrsToHtml(n.attrs)}>${(n.content ?? []).map(nodeHtmlOf).join('')}</p>`;   // PM 标准标签映射
  }
  return `<${n.type}${attrsToHtml(n.attrs)}>${(n.content ?? []).map(nodeHtmlOf).join('')}</${n.type}>`;
};

const pmJsonToHtml = (json: readonly PmNode[]): string => json.map(nodeHtmlOf).join('');

const richTextOf = (json: PmNode[]): RichTextValue => ({ text: pmJsonToText(json), html: pmJsonToHtml(json), json });

/** XmlFragment → RichTextValue 只读导出（Y1c T16：web 编辑器 getHTML 只读面/PromptValue 三出口
 *  基座——单源；禁 editor 状态派生第二实现）。 */
export function richTextOfFragment(frag: Y.XmlFragment): RichTextValue {
  return richTextOf(xmlToPmJson(frag));
}

// ── 序列化（doc 值 → canonical 标签快照）──

function serializeYValue(v: unknown): CanvasDocValue {
  if (v instanceof Y.Text) {
    // toDelta 净态=insert-only（删除/retain 已消化）——重建按序回放 insert 即复原
    return { $yjs: 'text', delta: v.toDelta() as unknown as YTextDeltaItem[] };
  }
  if (v instanceof Y.XmlFragment) return { $yjs: 'xml', json: xmlToPmJson(v) };
  if (v instanceof Y.XmlElement) return { $yjs: 'xml', json: [xmlNodeToPm(v)] };   // 裸元素值→单根数组（fragment 归一）
  if (v instanceof Y.Map) {
    const entries: Record<string, CanvasDocValue> = {};
    for (const [k, inner] of v.entries()) entries[k] = serializeYValue(inner);
    return { $yjs: 'map', entries };
  }
  if (v instanceof Y.Array) return { $yjs: 'array', items: v.toArray().map(serializeYValue) };
  // $yjs 保留字执法（唯一检查点=encode：serialize 拒发后，CanvasDocument 内已知标签形状只可能
  // 产自上方真 Y 分支——decode（read model 终端纯 JSON 无重解释面）/rebuild（标签形=合法 API 语义）
  // 无需同检）：plain JSON 值带已知标签字面量 ⇒ fail-fast throw——否则 rebuild 会把该对象静默
  // 重解释为 Y 类型（数据类型变异），与 UNDEFINED_PATCH_VALUE 同档进程内 bug 信号。
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const reserved = (v as { $yjs?: unknown }).$yjs;
    if (reserved === 'text' || reserved === 'xml' || reserved === 'map' || reserved === 'array') {
      throw new Error(`RESERVED_YJS_TAG: doc data 值带保留字标签形状 {$yjs:'${reserved}'}——canonical 判别键 \$yjs 禁用于 plain JSON 值（重建将静默重解释为 Y 类型，fail-fast 拒读）`);
    }
  }
  return clonePlain(v) as CanvasDocValue;
}

// ── 解码（doc 值 → plain JSON 读出口）──

const deltaToText = (delta: readonly { insert?: string }[]): string =>
  delta.map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('');

function decodeYValue(v: unknown): unknown {
  if (v instanceof Y.Text) return deltaToText(v.toDelta());   // 文本显式 string
  if (v instanceof Y.XmlFragment) return richTextOf(xmlToPmJson(v));
  if (v instanceof Y.XmlElement) return richTextOf([xmlNodeToPm(v)]);
  if (v instanceof Y.Map) {
    const out: Record<string, unknown> = {};
    for (const [k, inner] of v.entries()) out[k] = decodeYValue(inner);   // 键序保持（JSON.stringify 口径）
    return out;
  }
  if (v instanceof Y.Array) return v.toArray().map(decodeYValue);
  return clonePlain(v);
}

// ── 出口一：serializeCanvas（canonical 快照——备份/重建/semanticEqual）──

/** doc → canonical 类型化快照：nodes/edges（readRecordsFromMaps 基座+data 值标签化）+meta
 *  （历史载荷透传）。语义快照——非字节快照（update 编码的墓碑/事务壳不随行；重建走
 *  rebuildCanvasDoc 显式类型化重建，非 applyUpdate 复制）。 */
export function serializeCanvas(doc: Y.Doc): CanvasDocument {
  const base = readRecordsFromMaps(doc as unknown as DocLike);   // 收编读基座（信封/position/E68 全函数）
  const meta: Record<string, unknown> = {};
  for (const [k, v] of doc.getMap('meta').entries()) meta[k] = clonePlain(v);
  return {
    nodes: base.nodes.map((n) => {
      const data: Record<string, CanvasDocValue> = {};
      for (const [k, v] of Object.entries(n.data)) data[k] = serializeYValue(v);   // 键序保持
      return { ...n, data };
    }),
    edges: base.edges,
    meta,
  };
}

// ── 出口二：toReadModel（plain JSON 读模型——REST/执行/导出）──

/** doc → plain JSON 读模型：v3 纯 JSON 值逐位透传（≡readRecordsFromMaps——收编零行为变更，
 *  含键序）；v4 嵌套类型解码（Y.Text→string/Y.Map→对象/Y.Array→数组/XmlFragment→
 *  {text,html,json}）。全树零共享 Y 实例（plain 值深拷贝——mutate 隔离）。 */
export function toReadModel(doc: Y.Doc): CanvasReadModel {
  const base = readRecordsFromMaps(doc as unknown as DocLike);
  return {
    nodes: base.nodes.map((n) => {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n.data)) data[k] = decodeYValue(v);   // 键序保持（vacuum 等价 JSON 口径）
      return { ...n, data };
    }),
    edges: base.edges,
  };
}

// ── 重建（canonical 快照 → 全新 Y.Doc——anti-aliasing 全量新实例）──

function buildYValue(v: CanvasDocValue): unknown {
  const tag = (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as { $yjs?: unknown }).$yjs : undefined);
  if (tag === 'text') {
    const t = new Y.Text();
    for (const d of (v as YTextSnapshot).delta) {
      if (typeof d.insert === 'string') t.insert(t.length, d.insert, d.attributes);
    }
    return t;
  }
  if (tag === 'xml') return pmToXmlFragment((v as YXmlSnapshot).json);
  if (tag === 'map') {
    const m = new Y.Map();
    for (const [k, inner] of Object.entries((v as YMapSnapshot).entries)) m.set(k, buildYValue(inner));
    return m;
  }
  if (tag === 'array') {
    const a = new Y.Array();
    const items = (v as YArraySnapshot).items.map(buildYValue);
    if (items.length > 0) a.push(items);
    return a;
  }
  return clonePlain(v);   // plain JSON 值深拷贝（快照↔doc 双向 mutate 隔离）
}

/** canonical 快照 → 全新 Y.Doc（备份回灌）：fillDoc 单源写（信封/position/data.set——data 值=
 * 全新 Y 实例合法首集成；F-S2-1 别名路径结构性禁入：无任何源 doc 实例引用）+meta 透传。
 *  单事务原子；$yjs 标签不落 doc（还原为真 Y 类型）。 */
export function rebuildCanvasDoc(cd: CanvasDocument): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const records: StoredNodeRecord[] = cd.nodes.map((n) => {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n.data)) data[k] = buildYValue(v);
      return { ...n, data };
    });
    fillDoc(asDocLike(doc), records, cd.edges);
    const meta = doc.getMap('meta');
    for (const [k, v] of Object.entries(cd.meta ?? {})) meta.set(k, clonePlain(v));
  });
  return doc;
}

// ── 语义等价（备份/重建校验——深度结构相等非字节相等）──

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object'
    && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every((k) => k in (b as object) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

const sortById = <T extends { id: string }>(arr: readonly T[]): T[] =>
  [...arr].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

/** canonical 快照语义等价：nodes/edges 按 id 排序后深比（对象键序不敏感、数组序敏感——媒体
 *  序/内容序=语义）+meta 深比。Y.Map 遍历序≠插入保证序的并发形态下仍等价（语义非字节）。 */
export function semanticEqual(a: CanvasDocument, b: CanvasDocument): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  if (!deepEqual(sortById(a.nodes), sortById(b.nodes))) return false;
  if (!deepEqual(sortById(a.edges), sortById(b.edges))) return false;
  return deepEqual(a.meta, b.meta);
}

// ── 出口三：toPublicReadModel（公开快照 sanitize）──

const isRichTextValue = (v: unknown): v is RichTextValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
  && typeof (v as RichTextValue).text === 'string'
  && typeof (v as RichTextValue).html === 'string'
  && Array.isArray((v as RichTextValue).json);

/** URL 域外判定：http(s) URL 且 host 不在 allowlist ⇒ 剥键（非 URL 字符串/allowlist 缺省=不过滤）。 */
function isDisallowedUrl(s: string, hosts: readonly string[] | undefined): boolean {
  if (hosts === undefined || hosts.length === 0) return false;
  let u: URL;
  try { u = new URL(s); } catch { return false; }
  return (u.protocol === 'http:' || u.protocol === 'https:') && !hosts.includes(u.hostname);
}

function sanitizePublicData(type: string, data: Record<string, unknown>, policy: PublicSnapshotPolicy): Record<string, unknown> {
  const allowed = policy.dataKeys[type] ?? [];   // 未列类型=data 全剥（snapshot-filter 未知类型同口径）
  const out: Record<string, unknown> = {};
  for (const field of allowed) {
    if (!(field in data)) continue;
    const v = data[field];
    if (isRichTextValue(v)) { out[field] = { text: v.text }; continue; }   // 红线 1：html/json 永不出公开面
    if (typeof v === 'string' && isDisallowedUrl(v, policy.allowedUrlHosts)) continue;   // URL host 域外剥键
    out[field] = v;
  }
  return out;
}

/** 读模型 → 公开快照：dropTypes 节点剔除（连带触达边——悬空 parentId 不滤〔结构域归调用方〕）+
 *  逐类型 data 键白名单 + RichTextValue 只余 text + URL host allowlist。输出仍为纯 JSON
 *  read model 同形（sanitize 不引入共享类型）。 */
export function toPublicReadModel(readModel: CanvasReadModel, policy: PublicSnapshotPolicy): CanvasReadModel {
  const dropped = new Set(policy.dropTypes ?? []);
  const kept = readModel.nodes.filter((n) => !dropped.has(n.type));
  const keptIds = new Set(kept.map((n) => n.id));
  return {
    nodes: kept.map((n) => ({ ...n, data: sanitizePublicData(n.type, n.data ?? {}, policy) })),
    edges: readModel.edges.filter((e) => (e.source === undefined || keptIds.has(e.source))
      && (e.target === undefined || keptIds.has(e.target))),
  };
}
