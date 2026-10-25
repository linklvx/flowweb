// packages/shared/src/canvas/doc-schema-v4.ts
// Y1c T3（plan v1.7）：doc 模型 v4 全类型树形矩阵——spec §3.1（v5.4）矩阵冻结为唯一基准。
//
// 定位（P0 契约冻结，零运行时消费——运行时准入 T24 激活、容器写 seam T15/T16 落地）：
//   - 键集=census ②（docs/superpowers/census/y1c-t0-census.md）实测现键集**精确冻结**（双向零漂移：
//     矩阵不发明键、不漏真实键——T24「未分类字段默认拒绝」的执法底表）；
//   - yType=各键的 **v4 目标语义**（spec §3.1：textInput{content:xml, prompt:map{text}}；
//     imageGen/videoGen/imageExtGen{prompt:xml}；audioGen/multiImageGen{prompt:text}；
//     allImages/images=array）——Y1c T15 已落三域（audioGen/multiImageGen prompt=text、
//     textInput prompt=map{text}——text-domains 单源词表自本矩阵派生）；其余 string/JSON
//     载体（content:xml 三域/allImages:array）由 T16/T17 同卡迁移后与矩阵一致；
//   - writer 二元（'user'|'server'）——**v4 矩阵内不得出现 writer:'server' 条目**（spec §3.1：
//     writer:'server' 字段一律禁入 doc；服务端派生数据只住 PG+Feed，v3 现存服务端域键
//     〔status/fileId/result 族〕以 yType:'server-forbidden' 登记其「禁入」语义而非给写权）。
//
// 键集锚定来源（禁第二真源漂移）：信封=NODE_ENVELOPE_KEYS；服务端键集=canvas-doc-manifest
// （SERVER_NODE_DATA_KEYS 等）；类型全集=census ① 8 类型（CanvasView nodeTypes 注册表真值）。

import { NODE_ENVELOPE_KEYS } from './nodeEnvelope';

/** v4 字段 yType 词汇（spec §3.1）：text=Y.Text / xml=XmlFragment（Tiptap 双端）/
 *  map=Y.Map（children 逐键）/ array=Y.Array（items 条目）/ lww-array=标量数组整体 LWW 替换 /
 *  lww=标量 LWW（string|number|boolean|null）/ server-forbidden=v3 服务端派生键——v4 禁入 doc
 *  （真值住 PG+Feed；RuntimeProjection 读径——§6.4）。 */
export type YFieldType = 'text' | 'xml' | 'map' | 'array' | 'lww-array' | 'lww' | 'server-forbidden';

/** 读者词汇（reader: string[]——分类面非权限面；权限=permission+writer）：
 *  'web'=客户端渲染/编辑消费｜'server'=api 执行链消费｜'public'=公开快照面携带｜
 *  'runtime-projection'=v4 投影面（server-forbidden 键的唯一读者——doc 内无读者）。 */
export interface DataKeySpec {
  yType: YFieldType;
  /** 谁可写（二元权限矩阵——v5.3 删 valueSource/authority）。矩阵内全量 writer:'user'
   *  （writer:'server' 禁入矩阵——服务端派生键用 yType:'server-forbidden' 登记）。 */
  writer: 'user' | 'server';
  reader: string[];
  /** 'free'=普通用户域；'protected'=敏感域（gate 加严面——现无实例，v4 预留词汇）。 */
  permission: 'free' | 'protected';
  undo: boolean;
  /** 是否媒体引用键（mediaId/fileId 族——NORMALIZE 面引用存在性检查输入，T24）。 */
  mediaRef: boolean;
  importExport: boolean;
  maxBytes?: number;
  /** array/lww-array 条目规格（媒体条目字段集未冻结——T17 单卡改道时细化）。 */
  items?: DataKeySpec;
  /** map 容器逐键规格。 */
  children?: Record<string, DataKeySpec>;
  /** 三操作矩阵（canCreate=可建键/容器；canWrite=可改值；canDelete=可删键）。 */
  canCreate: boolean;
  canWrite: boolean;
  canDelete: boolean;
  /** 是否参与执行计划冻结（v5.2——偏离 36 注记：prompt 族/model 族=true）。 */
  inExecutionPlan: boolean;
}

// ── 构造器（默认单源——全键共享基线，差异经覆盖面表达；禁散落字面量重复 20 字段）──
// 用户域五形态（lww/text/xml/map/array）+禁入态（forbidden）共六工厂覆盖矩阵全部条目。

/** 标量 LWW 用户域键（order/slot/model/style 族——创建可建、可改、可删、可撤销、可导入导出）。 */
const lww = (overrides?: Partial<DataKeySpec>): DataKeySpec => ({
  yType: 'lww', writer: 'user', reader: ['web'], permission: 'free',
  undo: true, mediaRef: false, importExport: true,
  canCreate: true, canWrite: true, canDelete: true, inExecutionPlan: false,
  ...overrides,
});

/** Y.Text 用户域（正文/prompt 词域——执行计划冻结面；容器随节点建、禁整删〔G17〕）。 */
const textSpec = (overrides?: Partial<DataKeySpec>): DataKeySpec => lww({
  yType: 'text', reader: ['web', 'server'], canDelete: false, inExecutionPlan: true,
  ...overrides,
});

/** XmlFragment 用户域（Tiptap 正文/富文本 prompt——T16 双端；canDelete=false=容器替换 DENY 面）。 */
const xmlSpec = (overrides?: Partial<DataKeySpec>): DataKeySpec => lww({
  yType: 'xml', reader: ['web', 'server'], canDelete: false, inExecutionPlan: true,
  ...overrides,
});

/** Y.Map 容器（children 逐键；canDelete=false=容器随节点建禁整删）。 */
const mapSpec = (children: Record<string, DataKeySpec>, overrides?: Partial<DataKeySpec>): DataKeySpec => lww({
  yType: 'map', reader: ['web', 'server'], canDelete: false, children,
  ...overrides,
});

/** Y.Array 媒体列表（T17 单卡改道——items 条目集届时细化）。 */
const arraySpec = (overrides?: Partial<DataKeySpec>): DataKeySpec => lww({
  yType: 'array', reader: ['web'], mediaRef: true, canDelete: false,
  items: lww({ mediaRef: true }),
  ...overrides,
});

/** v3 服务端派生键——v4 禁入 doc（yType 即语义；无写者入 doc，读径=RuntimeProjection）。
 *  inExecutionPlan=false（执行态冻结走 PG ExecutionRequest，非 doc 键）。 */
const forbidden = (overrides?: Partial<DataKeySpec>): DataKeySpec => lww({
  yType: 'server-forbidden', reader: ['runtime-projection'], permission: 'protected',
  undo: false, importExport: false,
  canCreate: false, canWrite: false, canDelete: false,
  ...overrides,
});

/** 媒体引用键（mediaId/fileId 语义面——NORMALIZE 引用存在性检查输入）。 */
const mediaLww = (overrides?: Partial<DataKeySpec>): DataKeySpec =>
  lww({ mediaRef: true, ...overrides });

/** v4 全类型矩阵（8 类型——census ① 全集：CanvasView nodeTypes 注册表真值；
 *  envelope=NODE_ENVELOPE_KEYS 单源派生，8 类型同构）。未知类型=显式 schema 错误
 *  （写拒+读侧只读保真——T24 运行时执法；exec 根不在本表——写入即 DENY）。 */
export const DOC_SCHEMA_V4: Record<
  string /* nodeType 全集含 group/videoEdit */,
  { envelope: readonly string[]; data: Record<string, DataKeySpec> }
> = {
  textInput: {
    envelope: NODE_ENVELOPE_KEYS,
    data: {
      // v4 目标：content=XmlFragment（Tiptap 正文——T16 迁移；现状 string HTML 载体）
      content: xmlSpec({ reader: ['web', 'server', 'public'] }),
      // Y1c T15 已迁：Y.Map{text:Y.Text}（T2 的 data.prompt:string 同卡迁移——容器随结构创建
      // 一次建，写走 splice 单一 seam；执行读点=resolvePromptText 单源读 {text} 形态）
      prompt: mapSpec({ text: textSpec() }, { inExecutionPlan: true }),
      model: lww({ inExecutionPlan: true }),
      order: lww(), // Y1a 序域（order-key.ts 分数索引——addNodeInner 通用分配）
      // 注：census ② textInput 行含 slot 字样，但快照白名单 textInput 行（:38）无 slot 且无生产
      // 写点——按「真实写点为准」不登记（分镜子格位现状=imageGen/imageExtGen 域，见下）。
    },
  },
  imageGen: {
    envelope: NODE_ENVELOPE_KEYS,
    data: {
      fileId: forbidden(), // v3 服务端产物域——v4 禁入（真值=NodeArtifact PG+投影）
      referenceImage: mediaLww(),
      mediaName: lww(),
      slot: lww(), // Y1b 分镜子格位（快照白名单 :41 证实）
      status: forbidden(), // 执行态投影——v4 禁入（Feed exec.status）
      imageRotation: lww(),
      flipH: lww(),
      flipV: lww(),
      aspectRatio: lww(),
      allImages: arraySpec(), // T17 Y.Array 单卡改道（条目字段集届时细化）
      style: lww(),
      styleId: lww(), // D16 契约：键存在值 null=已取消
      styleName: lww(),
      model: lww({ inExecutionPlan: true }),
      quality: lww({ inExecutionPlan: true }),
      ratio: lww({ inExecutionPlan: true }),
      resolution: lww({ inExecutionPlan: true }),
      // v4 目标：XmlFragment（mention/image PM 节点→PromptValue 三出口——T16 迁移；现状 PromptValue JSON）
      prompt: xmlSpec(),
      order: lww(),
    },
  },
  imageExtGen: {
    envelope: NODE_ENVELOPE_KEYS,
    // imageGen 全量 + 扩展配置域（census ②）
    data: {
      fileId: forbidden(),
      referenceImage: mediaLww(),
      mediaName: lww(),
      slot: lww(),
      status: forbidden(),
      imageRotation: lww(),
      flipH: lww(),
      flipV: lww(),
      aspectRatio: lww(),
      allImages: arraySpec(),
      style: lww(),
      styleId: lww(),
      styleName: lww(),
      model: lww({ inExecutionPlan: true }),
      quality: lww({ inExecutionPlan: true }),
      ratio: lww({ inExecutionPlan: true }),
      resolution: lww({ inExecutionPlan: true }),
      prompt: xmlSpec(),
      extConfig: mapSpec({ // 扩展工具配置容器（ImageExtConfig——T15 容器规则先行）
        ratio: lww({ inExecutionPlan: true }),
        resolution: lww({ inExecutionPlan: true }),
        quality: lww({ inExecutionPlan: true }),
        generateCount: lww({ inExecutionPlan: true }),
        prompt: lww({ inExecutionPlan: true }), // census ② extConfig{...prompt?}——扩展域提示词配置串
      }, { inExecutionPlan: true }),
      aiTool: lww({ inExecutionPlan: true }),
      order: lww(),
    },
  },
  videoGen: {
    envelope: NODE_ENVELOPE_KEYS,
    data: {
      model: lww({ inExecutionPlan: true }),
      status: forbidden(),
      fileId: forbidden(),
      aspectRatio: lww(),
      referenceVideo: mediaLww(),
      ratio: lww({ inExecutionPlan: true }),
      prompt: xmlSpec(),
      styleId: lww(),
      styleName: lww(),
      allImages: arraySpec(),
      trimStart: lww(),
      trimEnd: lww(),
      trimTaskStatus: forbidden(), // 剪辑任务态——服务端进度域（v4 禁入）
      trimmedFileId: forbidden(), // 剪辑产物——服务端产物域（v4 禁入）
      order: lww(),
      // 以下三键=video-edit 导出产物节点写点（product-node.ts:23 addNode dataOverride——
      // census ② 接口真源之外的实测真实 doc 键，按「真实键必登记」收编）：
      origin: lww(), // 创建来源标记（'video-edit'）
      videoProjectId: lww(), // VideoProject PG 身份引用（非 mediaId/fileId 媒体族——mediaRef 不标）
      label: lww(),
    },
  },
  audioGen: {
    envelope: NODE_ENVELOPE_KEYS,
    data: {
      model: lww({ inExecutionPlan: true }),
      // Y1c T15 已迁：prompt=Y.Text（content:string 同卡迁——AudioConfigPanel textarea 写读同改；
      // 容器随结构创建一次建/写走 splice 单一 seam——text-domains 单源词表）
      prompt: textSpec({ reader: ['web', 'server', 'public'] }),
      status: forbidden(),
      fileId: forbidden(),
      referenceAudio: mediaLww(),
      order: lww(),
    },
  },
  multiImageGen: {
    envelope: NODE_ENVELOPE_KEYS,
    data: {
      label: lww(),
      images: arraySpec(), // T17 Y.Array 单卡改道
      mainImageIndex: lww(),
      expanded: lww(),
      nodeStatus: forbidden(), // 生成批次执行态——服务端进度域（v4 禁入）
      generationBatchId: lww(), // census ② 接口声明键（现状零生产写点——保留登记防未分类拒）
      // Y1c T15 已赋形：Y.Text 容器随结构创建（现状零面板写点死字段——写点落位即走 splice seam）
      prompt: textSpec(),
      order: lww(),
    },
  },
  videoEdit: {
    envelope: NODE_ENVELOPE_KEYS,
    // census ②：无独立 data 接口、快照面 data 全剥——doc 侧现键=通用 order 仅此一项；
    // spec §3.1 目标「videoEdit{videoProjectId 等}」——VideoProject 绑定键落位时随卡登记
    data: {
      order: lww(),
    },
  },
  group: {
    envelope: NODE_ENVELOPE_KEYS,
    data: {
      groupType: lww(),
      name: lww(),
      storyboard: mapSpec({ // 分镜配置容器（GroupNodeDataShape 的 storyboard 键——键集单源锚 GROUP_NODE_DATA_KEYS；措辞避开 storyboard 裸解引用字面量——web storyboard-dereref-guard 门禁扫描面含本目录）
        aspectRatio: lww(),
        gridRows: lww(),
        gridCols: lww(),
        showIndex: lww(),
        stitchResolution: lww(),
      }, { reader: ['web', 'public'], inExecutionPlan: false }),
      collapsed: lww(),
      nameCustom: lww(),
      color: lww(), // R2c 前向键（克隆/公开过滤契约预置——group.ts:3 注）
      order: lww(), // 组创建写点（canvasStore:2210 allocateOrderAfter）
    },
  },
};

/** meta 根用户可编辑配置白名单（spec §3.1 顶层三根：meta 白名单）。
 *  T18 起 meta 零生产写者零活键（版本承载=CanvasDoc.schemaVersion PG 列——manifest meta 条目），
 *  v4 冻结=空集；后续用户可编辑 meta 键落此单源（schema-contract.spec 锚 ⊆ 现活键=空）。 */
export const META_WHITELIST: readonly string[] = [];

/** 菜单短名→生产节点类型名翻译表（Y1c T3 遗留——T15 收口转登记 T16 吸收：自 canvasStore.ts
 *  :159-170 归 schema 模块单源；web canvasStore/nodeStore 消费本表，禁第二副本）。
 *  派生不变量（schema-contract.spec 锚）：①值集 ⊆ DOC_SCHEMA_V4 键集（矩阵全集=创建链
 *  CANVAS_NODE_TYPES 断言源）；②alias=全名剥已知后缀 {Gen,Input} 的正则象——videoEdit/video
 *  与 videoGen/video 短名撞车故为**显式冻结表**非盲剥后缀派生（撞车排除面=本注记，新增类型
 *  撞车=表+锚同批改）；③group/videoEdit 无菜单短名（组=交互创建/剪辑产物节点——不在表）。 */
export const NODE_TYPE_ALIASES: Readonly<Record<string, string>> = {
  text: 'textInput',
  image: 'imageGen',
  imageExt: 'imageExtGen',
  video: 'videoGen',
  audio: 'audioGen',
  multiImage: 'multiImageGen',
};
