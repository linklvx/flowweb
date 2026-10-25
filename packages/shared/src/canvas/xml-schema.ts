// packages/shared/src/canvas/xml-schema.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段——spec v5.4 §3.2 L1，偏离 38⑬）：XML_ELEMENTS/MARKS/ATTRS
// 单表——XmlFragment frame-local L1 结构白名单（元素名/format key 白名单、ContentString 字节上限、
// 字符串 URL allowlist 扫描、新子树深度上限；拒 XmlHook/嵌套 XmlFragment/未知 XmlElement——
// **本表与 PM schema 派生+setEqual**）。
// **Y1c T16（本卡）**：①模块自 collab/ 迁 canvas/ 同族（Controller 指令——XML 单表/白名单/L1
// 扫描器放非冻结区；collab/ 为 CONTRACT-FREEZE 契约区）；②表扩 textInput content 域元素
// （TextInputNode StarterKit heading{1,2,3} 全启用面）——**两域并表=全 XML 域统一白名单底表**
// （L1 gate 帧内不辨域，取并集；prompt 域 builder 与 text 域 builder 各为并集子集）；
// ③L1 扫描器（validateXmlL1）本文件落地——gate 准入链接线（apps/api actor drain ① P1 shape 后）。
// 派生真源=apps/web prompt-input/extensions.ts buildPromptInputSchemaExtensions（prompt 域）+
// apps/web nodes/textExtensions.ts buildTextContentSchemaExtensions（text 域）实测；执法锚=
// apps/web/src/collab/xmlSchemaParity.spec.ts（jsdom 同款 extensions 实例化双 builder——PM schema
// 节点/mark/属性名并集与本表双向 setEqual，schema 漂移即红）。消费方=T16（L1 激活）/
// T24（全类型矩阵扩+L2）。数字真源：32/128KiB 本文件即唯一真源（spec §3.2 冻结值）。
// 契约测试=xml-schema.spec.ts。URL allowlist 真源住调用方（gate 注入——shared 不造第二份表）。
import * as Y from 'yjs';
import { DOC_SCHEMA_V4 } from './doc-schema-v4';

/** L1 元素白名单（XmlElement nodeName 域——两域 PM 节点名并集）：
 *  prompt 域（StarterKit 禁用后存活集 paragraph/codeBlock/listItem + image/command/imageMention）；
 *  text 域（textInput content——T16 追加：heading/blockquote/bulletList/orderedList/horizontalRule/
 *  hardBreak）。未知 XmlElement→DENY（frame-local）。 */
export const XML_ELEMENTS = [
  // prompt 域（PromptInput——StarterKit 禁用集后存活+扩展）
  'paragraph',
  'codeBlock',
  'listItem',
  'image',
  'command',
  'imageMention',
  // text 域（TextInputNode 正文——StarterKit heading{1,2,3} 全启用追加集）
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'horizontalRule',
  'hardBreak',
] as const;
export type XmlElementName = typeof XML_ELEMENTS[number];

/** mark 白名单（Y.XmlText attributes/ContentFormat format key 域）：prompt 域 StarterKit mark
 *  全禁用=零贡献；text 域 StarterKit 默认四 mark（bold/italic/strike/code）。
 *  将来启用任何 mark=本表+parity spec 同批扩（单侧漂移即红）。 */
export const XML_MARKS = [
  'bold',
  'italic',
  'strike',
  'code',
] as const;
export type XmlMarkName = typeof XML_MARKS[number];

/** 根节点名（PM doc→Y.XmlFragment 根——**非元素**不进 XML_ELEMENTS；拒 XML 树内嵌套 XmlFragment）。 */
export const XML_ROOT_NODE_NAME = 'doc' as const;

/** 文本承载名（PM text→Y.XmlText——attributes=mark 域，文本体受 XML_TEXT_MAX_BYTES 限）。 */
export const XML_TEXT_NODE_NAME = 'text' as const;

/** 逐元素属性白名单（PM addAttributes 实测——属性名域冻结）：
 *  - codeBlock.language=lowlight 语言标注（默认 null）；
 *  - heading.level=标题层级（TextInputNode levels [1,2,3]）；
 *  - image.{src,alt,title}=媒体锚（**修正批#1（2026-10-24 用户批准）：src=mediaId**——渲染层解析
 *    受控 URL；URL allowlist 仅留给 link href 面——src 出现 http(s) URL 值须 allowlist 放行）；
 *  - command/imageMention.{id,label,mentionSuggestionChar}=mention 三键（id=command/mediaId 锚；
 *    mentionSuggestionChar=渲染提示键〔@tiptap/extension-mention schema 实测成员〕）。 */
export const XML_ATTRS: Readonly<Record<XmlElementName, readonly string[]>> = {
  paragraph: [],
  codeBlock: ['language'],
  listItem: [],
  image: ['src', 'alt', 'title'],
  command: ['id', 'label', 'mentionSuggestionChar'],
  imageMention: ['id', 'label', 'mentionSuggestionChar'],
  heading: ['level'],
  blockquote: [],
  bulletList: [],
  orderedList: ['start', 'type'],   // PM orderedList 实测（起始序号+标记类型——parity 派生）
  horizontalRule: [],
  hardBreak: [],
};

/** 新子树深度上限（§3.2：深度≤32——frame-local struct 扫描参数；全新数字本文件唯一真源）。 */
export const XML_MAX_DEPTH = 32 as const;

/** 单 ContentString 字节上限（§3.2：文本≤128KB——Y.XmlText 字节域；128KiB=131_072=128*1024
 *  字面量直书以配 as const——doc-protocol.ts:381 同款先例）。 */
export const XML_TEXT_MAX_BYTES = 131_072 as const;

/** URL allowlist 机制注记（真源住调用方——doc-codec toPublicReadModel PublicSnapshotPolicy
 *  .allowedUrlHosts 先例：shared 不造第二份表防漂移；L1 扫描面对 XmlFragment 属性字符串值
 *  〔image.src/link href 等〕按调用方注入的同一 allowlist 判域外）。 */
export const XML_URL_ALLOWLIST_CONTRACT = {
  mechanism: '字符串 URL allowlist 扫描（http(s) URL 且 host 不在列→DENY/剥除）',
  truthSource: '真源住调用方——T4 doc-codec toPublicReadModel policy 先例（PublicSnapshotPolicy.allowedUrlHosts）',
  noSecondTable: 'shared 不造第二份表（调用方传表——防两份 host 清单漂移）',
} as const;

/** mention·image=mediaId 锚（§3.2：媒体存在性检查**不入 gate**——归执行受理/ProjectDocIndex；
 *  L1 只管结构白名单与字节/深度/URL 域）。 */
export const XML_MEDIA_ANCHOR = {
  mentionElements: ['command', 'imageMention'] as const,
  mentionIdAttr: 'id',
  imageElement: 'image',
  imageAttr: 'src',
  existenceCheckOwner: 'mention id/image src 的 mediaId 存在性归执行受理/ProjectDocIndex——不入 gate（L1 只管结构）',
} as const;

/** 消费注记：T16=L1 frame-local struct 扫描激活（本表为白名单底表）；T24=扩全类型矩阵
 *  （DOC_SCHEMA_V4 全类型 DataKeySpec 与本表的 xml 域对齐+运行时 gate 同表）。 */
export const XML_L1_CONSUMERS = {
  t16: 'T16：L1 frame-local struct 扫描激活（元素名/format key 白名单+ContentString 上限+URL allowlist+深度上限；拒 XmlHook/嵌套 XmlFragment/未知 XmlElement）',
  t24: 'T24：扩全类型矩阵（DOC_SCHEMA_V4 xml 域与本表单源对齐——运行时 gate 同表执法）+L2 apply 后 changed-subtree walk',
  parity: 'web parity 锚=apps/web/src/collab/xmlSchemaParity.spec.ts（两域 builder 同款 extensions 实例化——并集双向 setEqual）',
} as const;

// ══════════════════════════════════════════════════════════════════════════
// Y1c T16：XML 域词表（DOC_SCHEMA_V4 单源派生——text-domains.ts 同族模式）
// ══════════════════════════════════════════════════════════════════════════

/** XmlFragment 结构性最小面（零 yjs instanceof——text-domains TextLike 同款纪律：结构性
 *  方法检防跨实例静默失败；Y.XmlFragment/Y.XmlElement/Y.XmlText 全满足）。 */
export interface XmlFragmentLike {
  insert(index: number, content: unknown[]): void;
}
export interface XmlElementLike {
  insert(index: number, content: unknown[]): void;
  setAttribute(key: string, value: unknown): void;
}
export interface XmlTextLike {
  insert(index: number, text: string): void;
  setAttribute(key: string, value: unknown): void;
}

/** XmlFragment 结构判定（方法属性 typeof 检——text-domains isTextLike 同款：wire 可达伪形态
 *  归结构性拒绝不误判）。 */
export function isXmlFragmentLike(v: unknown): v is XmlFragmentLike {
  return typeof v === 'object' && v !== null
    && typeof (v as { insert?: unknown }).insert === 'function';
}

/** PromptValue 三出口之 referencedImageIds 派生（spec §3.1：mention/image=PM 节点→
 *  PromptValue{text,html,referencedImageIds}）——image.src=mediaId（修正批#1）+
 *  mention.id（command id/imageMention mediaId）两锚并集，保序去重。
 *  输入=RichTextValue.json（doc-codec 读出口）；存在性检查归执行受理（XML_MEDIA_ANCHOR）。 */
export function referencedMediaIdsOf(json: ReadonlyArray<{ type: string; attrs?: Record<string, unknown>; content?: unknown[] }>): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v !== '' && !out.includes(v)) out.push(v);
  };
  const walk = (nodes: ReadonlyArray<{ type: string; attrs?: Record<string, unknown>; content?: unknown[] }>): void => {
    for (const n of nodes) {
      if (n.type === XML_MEDIA_ANCHOR.imageElement) {
        push(n.attrs?.[XML_MEDIA_ANCHOR.imageAttr]);
      } else if ((XML_MEDIA_ANCHOR.mentionElements as readonly string[]).includes(n.type)) {
        push(n.attrs?.[XML_MEDIA_ANCHOR.mentionIdAttr]);
      }
      if (Array.isArray(n.content)) walk(n.content as never);
    }
  };
  walk(json);
  return out;
}

/** XML 域词表（nodeType → dataKey 集）——DOC_SCHEMA_V4 yType==='xml' 派生，禁手抄：
 *  textInput{content}；imageGen/videoGen/imageExtGen{prompt}。 */
export function deriveXmlDomains(
  schema: Record<string, { data: Record<string, { yType: string }> }>,
): Record<string, ReadonlySet<string>> {
  const out: Record<string, Set<string>> = {};
  for (const [type, def] of Object.entries(schema)) {
    for (const [key, spec] of Object.entries(def.data)) {
      if (spec.yType === 'xml') (out[type] ??= new Set<string>()).add(key);
    }
  }
  return out;
}

/** XML 域词表运行时投影（spec §3.1 xml 域行——矩阵单源派生）。 */
export const XML_DOMAINS: Readonly<Record<string, ReadonlySet<string>>> =
  deriveXmlDomains(DOC_SCHEMA_V4);

/** 域键判定（nodeType×dataKey → 是否 XML 域——容器规则=T15：结构创建时一次性建 XmlFragment、
 *  唯一创建者=写 seam；updateNodeData 域键整串写=容器替换对抗面〔G17b〕拒）。 */
export function isXmlDomainKey(nodeType: unknown, key: string): boolean {
  return typeof nodeType === 'string' && (XML_DOMAINS[nodeType]?.has(key) ?? false);
}

/** XML 域空值规范形（RichTextValue 空载——ensure 缺省/ns 投影/执行读面三处同形）：
 *  fillDoc 物化空容器（json:[] 分支）；ns/store 侧与 toReadModel 解码形一致。 */
export const EMPTY_XML_VALUE: { text: string; html: string; json: never[] } = { text: '', html: '', json: [] };

/** 单值 canonical 化：''（空哨兵）/非空 string（纯文本语义——零 HTML 解析按字面文本收编）
 *  → RichTextValue；RichTextLike/其他形态原样（异形透传=结构错误暴露，text-domains 同哲学）。 */
export function canonicalizeXmlDomainValue(v: unknown): unknown {
  if (v === '') return EMPTY_XML_VALUE;
  if (typeof v === 'string') {
    const escaped = v.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
    return {
      text: v,
      html: `<p>${escaped}</p>`,
      json: [{ type: 'paragraph', content: [{ type: XML_TEXT_NODE_NAME, text: v }] }],
    };
  }
  return v;
}

/** 创建 seam 域键缺省补齐+canonical 收编（纯函数——不突变入参；text-domains
 *  ensureTextDomainDefaults 同族）：①缺省补 EMPTY_XML_VALUE（fillDoc 物化空容器+ns 投影
 *  同形）；②''/非空 string 值收编为 RichTextValue（doc 容器物化与 ns 投影同形——invariant
 *  双侧一致；纯文本语义非 HTML 解释）。RichTextValue/XmlFragment 实例/异形原样透传
 *  （异形=结构错误暴露——后续域键写 seam 拒，不静默吞值）。 */
export function ensureXmlDomainDefaults(nodeType: unknown, data: Record<string, unknown>): Record<string, unknown> {
  const domains = typeof nodeType === 'string' ? XML_DOMAINS[nodeType] : undefined;
  if (!domains) return data;
  let out: Record<string, unknown> | null = null;
  for (const key of domains) {
    const cur = data[key];
    if (cur === undefined) {
      (out ??= { ...data })[key] = EMPTY_XML_VALUE;
      continue;
    }
    const canon = canonicalizeXmlDomainValue(cur);
    if (canon !== cur) (out ??= { ...data })[key] = canon;
  }
  return out ?? data;
}

/** 创建 seam 物化工厂（宿主注入——零 yjs 依赖面；docShape.DocLike 扩三工厂）。 */
export interface XmlDomainFactories {
  createXmlFragment(): XmlFragmentLike;
  createXmlElement(name: string): XmlElementLike;
  createXmlText(): XmlTextLike;
}

/** PM JSON 子树构建（doc-codec pmToXmlNode 同语义的结构性版——attrs=字符串域/children 保序；
 *  纯 insert/setAttribute 调用〔detached 容器零读——T15 RM-1 同款零告警面〕）。 */
function buildXmlElementFromPm(n: { type: string; text?: string; attrs?: Record<string, string>; content?: unknown[] }, f: XmlDomainFactories): XmlElementLike | XmlTextLike {
  if (n.type === XML_TEXT_NODE_NAME) {
    const t = f.createXmlText();
    if (n.text) t.insert(0, n.text);
    for (const [k, v] of Object.entries(n.attrs ?? {})) t.setAttribute(k, v);
    return t;
  }
  const el = f.createXmlElement(n.type);
  for (const [k, v] of Object.entries(n.attrs ?? {})) el.setAttribute(k, v);
  const children = (n.content ?? []).map((c) => buildXmlElementFromPm(c as never, f));
  if (children.length > 0) el.insert(0, children);
  return el;
}

/** 创建 seam 物化（text-domains materializeTextDomainValue 同族两段式语义简化为单段——
 *  XML 子树构建纯 insert 零读，无 T15 的「集成后写初值」窗口需求）：
 *  - ''（哨兵）→ 空 XmlFragment（ensureXmlDomainDefaults 缺省/空正文创建面）；
 *  - RichTextValue 形 {json:PmNode[]} → 按 PM JSON 构建全新子树（duplicate/paste 复制面）；
 *  - XmlFragmentLike 实例 → 原样透传（rebuild/快照回灌路径——内容自带）；
 *  - 其他（非空 string/异形）→ 原样透传（**结构错误暴露不掩盖**——text-domains 同哲学：后续
 *    域键写在 seam 拒 container-type-mismatch，不静默吞值）。
 *  工厂注入：真实 Y.XmlFragment/Y.XmlElement/Y.XmlText 由宿主 DocLike 提供。 */
export function materializeXmlDomainValue(value: unknown, f: XmlDomainFactories): unknown {
  if (value === '') return f.createXmlFragment();
  if (isXmlFragmentLike(value)) return value;
  if (typeof value === 'string') {
    // 非空 string=纯文本语义（addChildNode 等构造面）——单段 paragraph/text 子树（零 HTML 解析：
    // 旧 string 载体按字面文本收编，非 HTML 解释——hard-reset 无 HTML 语义兼容）
    const frag = f.createXmlFragment();
    const p = f.createXmlElement('paragraph');
    const t = f.createXmlText();
    t.insert(0, value);
    p.insert(0, [t]);
    frag.insert(0, [p]);
    return frag;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const json = (value as { json?: unknown }).json;
    if (Array.isArray(json)) {
      const frag = f.createXmlFragment();
      const children = json.map((n) => buildXmlElementFromPm(n as never, f));
      if (children.length > 0) frag.insert(0, children);
      return frag;
    }
  }
  return value;
}

// ══════════════════════════════════════════════════════════════════════════
// Y1c T16：L1 frame-local struct 扫描器（gate 准入链消费——偏离 38⑫ 同卡激活）
// ══════════════════════════════════════════════════════════════════════════

export interface XmlL1Options {
  /** URL allowlist（真源住调用方——gate 注入；缺省=零 URL 执法〔PublicSnapshotPolicy 同款缺省〕）。 */
  allowedUrlHosts?: readonly string[];
}

export type XmlL1Verdict = { ok: true } | { ok: false; reason: string };

const ELEMENT_NAMES = new Set<string>(XML_ELEMENTS);
const MARK_NAMES = new Set<string>(XML_MARKS);

const textEncoder = new TextEncoder();

/** attr/格式字符串值 URL 域外判定（**执法档区分**：undefined=零 URL 执法〔扫描器缺省——调用方
 *  显式决策〕；提供（含空表）=执法开——空表 deny-all http(s)〔修正批#1 后 src=mediaId，绝对
 *  http(s) URL 属性值一律 off-spec〕；非空=host 白名单）。 */
function urlOutsideAllowlist(s: string, hosts: readonly string[] | undefined): boolean {
  if (hosts === undefined) return false;
  let u: URL;
  try { u = new URL(s); } catch { return false; }
  return (u.protocol === 'http:' || u.protocol === 'https:') && !hosts.includes(u.hostname);
}

/** 帧内 struct id 键（ID 字符串化——in-frame 父链解析用）。 */
const idKey = (id: Y.ID): string => `${id.client}:${id.clock}`;

/** struct 创建的 XML 类型归类（XmlElement/XmlText/XmlFragment/XmlHook；非 XML 容器/内容=undefined）。 */
function xmlKindOf(st: Y.Item): 'element' | 'text' | 'fragment' | 'hook' | undefined {
  const c = st.content as unknown;
  if (c instanceof Y.ContentType) {
    const t = c.type as unknown;
    if (t instanceof Y.XmlElement) return 'element';
    if (t instanceof Y.XmlText) return 'text';
    if (t instanceof Y.XmlFragment) return 'fragment';
    if (t instanceof Y.XmlHook) return 'hook';
  }
  return undefined;
}

/**
 * L1 frame-local struct 扫描（spec §3.2——T16 同卡激活；L2=apply 后 changed-subtree walk 归 T24）。
 *
 * 纯解码级检查（零 doc 扫描、零 ProjectDocIndex 依赖——既有节点深链语义归 L2/索引面）：
 * - 元素名白名单：ContentType(XmlElement) 的 nodeName ∈ XML_ELEMENTS；
 * - format key 白名单：ContentFormat.key（y-prosemirror mark 面）∈ XML_MARKS；
 * - attr key 白名单：帧内可解析 XML 父的 parentSub 键 ∈ XML_ATTRS[元素]（XmlText 父 ∈ XML_MARKS）；
 * - ContentString 字节上限：帧内可解析 XmlText 父的单文本项 ≤ XML_TEXT_MAX_BYTES；
 * - 字符串 URL allowlist：XML 树 attr/格式字符串值 http(s) 域外 host → DENY（正文 ContentString
 *   不扫——用户散文可含 URL；URL 承载面=属性值〔image.src/link href〕，修正批#1）；
 * - 新子树深度上限：帧内元素祖先链深度 ≤ XML_MAX_DEPTH；
 * - 拒 XmlHook/嵌套 XmlFragment（XML 树内 XmlFragment——域容器=Y.Map data 直挂合法）/未知元素。
 *
 * 帧（本 update 内）可解析父链：本帧新建节点从 decodeUpdate struct 局部构建候选（spec §3.2
 * gate-local 措辞）；父为本帧外既有 item 的深链语义检查归 L2（T24）——frame-local 边界如实登记。
 */
export function validateXmlL1(update: Uint8Array, opts: XmlL1Options = {}): XmlL1Verdict {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return { ok: false, reason: 'xml-decode-failed' };   // 通用格式面归 P1 shape 先行——兜底不重复报
  }
  const structs = decoded.structs as unknown as Y.Item[];

  // 帧内 id → struct 索引（父链解析：仅本帧新建子树可解析——「新子树」深度/attr 执法面）
  const inFrame = new Map<string, Y.Item>();
  for (const st of structs) {
    if (st instanceof Y.Item) inFrame.set(idKey(st.id), st);
  }

  /** 帧内向上解析：最近 XML 祖先（element/text/fragment；帧外父=undefined——L2 面；中途非 XML
   *  容器〔Map 等〕继续上溯——data Map→fragment 混合链形态）。 */
  const nearestXmlAncestor = (st: Y.Item):
    { kind: 'element' | 'text' | 'fragment'; name?: string; item: Y.Item } | undefined => {
    let cur: Y.Item | undefined = st;
    let hops = 0;
    while (cur !== undefined && hops <= XML_MAX_DEPTH + 2) {
      const p = cur.parent as unknown;
      if (p instanceof Y.ID) {
        const parentItem = inFrame.get(idKey(p));
        if (parentItem === undefined) return undefined;   // 父为本帧外既有 item——L2 面
        const kind = xmlKindOf(parentItem);
        if (kind === 'element') {
          const t = (parentItem.content as Y.ContentType).type;
          return { kind, name: t instanceof Y.XmlElement ? t.nodeName : undefined, item: parentItem };
        }
        if (kind === 'text') return { kind: 'text', item: parentItem };
        if (kind === 'fragment') return { kind: 'fragment', item: parentItem };
        cur = parentItem;   // 父为其他容器（Map/Array 等）——继续上溯
      } else {
        return undefined;   // 根 parent（string 名）——根级非 XML 树
      }
      hops += 1;
    }
    return undefined;
  };

  for (const st of structs) {
    if (!(st instanceof Y.Item)) continue;
    const kind = xmlKindOf(st);
    if (kind === 'hook') return { ok: false, reason: 'xml-hook-forbidden' };

    if (kind === 'element') {
      const t = (st.content as Y.ContentType).type;
      const name = t instanceof Y.XmlElement ? t.nodeName : '';
      if (!ELEMENT_NAMES.has(name)) return { ok: false, reason: `unknown-xml-element:${name}` };
      // 嵌套合法性：元素的最近 XML 祖先必须为 element/fragment（text 内禁挂元素）
      const anc = nearestXmlAncestor(st);
      if (anc?.kind === 'text') return { ok: false, reason: 'xml-child-type-forbidden:element-in-text' };
    }

    if (kind === 'fragment') {
      // 域容器=Y.Map data 直挂（fragment 的父=data map item——最近 XML 祖先=undefined 合法）；
      // XML 树内（element/text/fragment 祖先）嵌套 XmlFragment=拒
      const anc = nearestXmlAncestor(st);
      if (anc !== undefined) return { ok: false, reason: 'xml-nested-fragment' };
    }

    if (kind === 'text') {
      const anc = nearestXmlAncestor(st);
      if (anc?.kind === 'text') return { ok: false, reason: 'xml-child-type-forbidden:text-in-text' };
    }

    const content = st.content as unknown;

    // format key 白名单（y-prosemirror mark 面——ContentFormat 恒属 text 列表）
    if (content instanceof Y.ContentFormat) {
      if (!MARK_NAMES.has(content.key)) return { ok: false, reason: `xml-attr:format-key:${content.key}` };
      if (typeof content.value === 'string' && urlOutsideAllowlist(content.value, opts.allowedUrlHosts)) {
        return { ok: false, reason: `xml-url:${content.value.slice(0, 32)}` };
      }
    }

    // attr key 白名单+URL 扫描（parentSub 条目——帧内可解析 XML 父时执法）
    if (st.parentSub != null) {
      const anc = nearestXmlAncestor(st);
      if (anc?.kind === 'element') {
        const allowed = anc.name !== undefined ? XML_ATTRS[anc.name as XmlElementName] : undefined;
        if (allowed === undefined || !allowed.includes(st.parentSub)) {
          return { ok: false, reason: `xml-attr:${anc.name}.${st.parentSub}` };
        }
      } else if (anc?.kind === 'text') {
        if (!MARK_NAMES.has(st.parentSub)) return { ok: false, reason: `xml-attr:text.${st.parentSub}` };
      }
      if (content instanceof Y.ContentAny) {
        const vals: unknown[] = content.arr;   // ContentAny.arr=yjs 公开字段（getContent 同源）
        for (const x of vals) {
          if (typeof x === 'string' && urlOutsideAllowlist(x, opts.allowedUrlHosts)) {
            return { ok: false, reason: `xml-url:${x.slice(0, 32)}` };
          }
        }
      }
    }

    // ContentString 字节上限（帧内可解析 XmlText 父——「单 ContentString」字节域）
    if (content instanceof Y.ContentString) {
      const anc = nearestXmlAncestor(st);
      if (anc?.kind === 'text' && textEncoder.encode(content.str).byteLength > XML_TEXT_MAX_BYTES) {
        return { ok: false, reason: 'xml-text-bytes-exceeded' };
      }
    }
  }

  // 新子树深度上限：帧内元素链（element→element→…→容器根）深度 ≤ XML_MAX_DEPTH
  for (const st of structs) {
    if (!(st instanceof Y.Item) || xmlKindOf(st) !== 'element') continue;
    let depth = 1;
    let cur: Y.Item = st;
    const seen = new Set<string>([idKey(st.id)]);
    for (;;) {
      const p = cur.parent as unknown;
      if (!(p instanceof Y.ID)) break;
      const parentItem = inFrame.get(idKey(p));
      if (parentItem === undefined) { depth = 0; break; }   // 链出帧（既有子树）——深度面归 L2
      if (xmlKindOf(parentItem) !== 'element') break;   // 到达 fragment/map 等容器根——链止
      depth += 1;
      if (seen.has(idKey(parentItem.id))) break;   // 环防御（decode 结构上不应现——防御式）
      seen.add(idKey(parentItem.id));
      if (depth > XML_MAX_DEPTH) return { ok: false, reason: `xml-depth-exceeded:${depth}` };
      cur = parentItem;
    }
  }
  return { ok: true };
}
