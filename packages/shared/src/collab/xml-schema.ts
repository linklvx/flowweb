// packages/shared/src/collab/xml-schema.ts
// Y1c T5c（plan v1.7 Task 5 客户端/恢复段——spec v5.4 §3.2 L1，偏离 38⑬）：XML_ELEMENTS/MARKS/ATTRS
// 单表——XmlFragment frame-local L1 结构白名单（元素名/format key 白名单、ContentString 字节上限、
// 字符串 URL allowlist 扫描、新子树深度上限；拒 XmlHook/嵌套 XmlFragment/未知 XmlElement——
// **本表与 PM schema 派生+setEqual**）。
// 派生真源=apps/web/src/pages/canvas/components/nodes/prompt-input/PromptInput.tsx 的 Tiptap
// extensions 实测（2026-10-24 实例化探针：StarterKit disable 集{heading,bold,italic,strike,code,
// blockquote,orderedList,bulletList,horizontalRule,hardBreak}后余 paragraph/codeBlock/listItem/doc/text
// +Image.extend{inline}+Mention.extend{name:'command'}+Mention.extend{name:'imageMention'}）；
// 执法锚=apps/web/src/collab/xmlSchemaParity.spec.ts（jsdom 同款 extensions 实例化 editor——
// PM schema 节点/mark/属性名与本表双向 setEqual，schema 漂移即红）。
// 消费方=T16（L1 frame-local struct 扫描激活）/T24（全类型矩阵扩+运行时 gate）。
// 数字真源：32/128KiB 本文件即唯一真源（spec §3.2 冻结值）。契约测试=xml-schema.spec.ts。
// URL allowlist 真源住调用方（T4 doc-codec toPublicReadModel policy 先例——shared 不造第二份表）。

/** L1 元素白名单（XmlElement nodeName 域——PM 非根非文本节点名实测派生）：
 *  paragraph/listItem/codeBlock=StarterKit 禁用后存活集；image=扩展 inline 形态；
 *  command/imageMention=Mention 改名双实例。未知 XmlElement→DENY（frame-local）。 */
export const XML_ELEMENTS = [
  'paragraph',
  'codeBlock',
  'listItem',
  'image',
  'command',
  'imageMention',
] as const;
export type XmlElementName = typeof XML_ELEMENTS[number];

/** mark 白名单（Y.XmlText attributes 域）：**空集**——PromptInput 将 StarterKit 全部 mark 禁用
 *  （bold/italic/strike/code 均 false——2026-10-24 实测 PM schema marks 为空）。将来启用任何
 *  mark=本表+parity spec 同批扩（单侧漂移即红）。 */
export const XML_MARKS = [] as const;
export type XmlMarkName = typeof XML_MARKS[number];

/** 根节点名（PM doc→Y.XmlFragment 根——**非元素**不进 XML_ELEMENTS；拒嵌套 XmlFragment）。 */
export const XML_ROOT_NODE_NAME = 'doc' as const;

/** 文本承载名（PM text→Y.XmlText——attributes=mark 域，文本体受 XML_TEXT_MAX_BYTES 限）。 */
export const XML_TEXT_NODE_NAME = 'text' as const;

/** 逐元素属性白名单（PM addAttributes 实测——属性名域冻结）：
 *  - codeBlock.language=lowlight 语言标注（默认 null）；
 *  - image.{src,alt,title}=媒体 URL 锚（src 经 URL allowlist 扫描）；
 *  - command/imageMention.{id,label,mentionSuggestionChar}=mention 三键（id=mediaId 锚；
 *    mentionSuggestionChar=渲染提示键〔@tiptap/extension-mention schema 实测成员〕）。 */
export const XML_ATTRS: Readonly<Record<XmlElementName, readonly string[]>> = {
  paragraph: [],
  codeBlock: ['language'],
  listItem: [],
  image: ['src', 'alt', 'title'],
  command: ['id', 'label', 'mentionSuggestionChar'],
  imageMention: ['id', 'label', 'mentionSuggestionChar'],
};

/** 新子树深度上限（§3.2：深度≤32——frame-local struct 扫描参数；全新数字本文件唯一真源）。 */
export const XML_MAX_DEPTH = 32 as const;

/** 单 ContentString 字节上限（§3.2：文本≤128KB——Y.XmlText 字节域；128KiB=131_072=128*1024
 *  字面量直书以配 as const——doc-protocol.ts:381 同款先例）。 */
export const XML_TEXT_MAX_BYTES = 131_072 as const;

/** URL allowlist 机制注记（真源住调用方——doc-codec toPublicReadModel PublicSnapshotPolicy
 *  .allowedUrlHosts 先例：shared 不造第二份表防漂移；L1 扫描面对 XmlFragment 字符串值〔image.src
 *  等〕按调用方注入的同一 allowlist 判域外）。 */
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

/** 消费注记：T16=L1 frame-local struct 扫描激活（本表为白名单底表）；T24=全类型矩阵扩
 *  （DOC_SCHEMA_V4 全类型 DataKeySpec 与本表的 xml 域对齐+运行时 gate 同表）。 */
export const XML_L1_CONSUMERS = {
  t16: 'T16：L1 frame-local struct 扫描激活（元素名/format key 白名单+ContentString 上限+URL allowlist+深度上限；拒 XmlHook/嵌套 XmlFragment/未知 XmlElement）',
  t24: 'T24：扩全类型矩阵（DOC_SCHEMA_V4 xml 域与本表单源对齐——运行时 gate 同表执法）',
  parity: 'web parity 锚=apps/web/src/collab/xmlSchemaParity.spec.ts（PromptInput 同款 extensions 实例化——双向 setEqual）',
} as const;
