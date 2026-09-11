# Spec: 多轨道剪辑器 UI/交互层深度改造（对齐 opencut）v1.0-final

> 2026-09-11 定稿。经五轮设计评审收敛（三轮外部评审断言全部一手验证后采纳）。
> **2026-09-12 spec 审核冻结（v1.0-final）**：①antd 源码文件名勘误 useZOffset→`useZIndex.js` ②D4 补手势语义红线（FSA 句柄须在点击手势内获取，"后置"仅目的地分支决策——编码后调 picker 必抛 SecurityError）③批 3.2 回退取帧弃用播放 video-cache，改 sink 工厂一次性取帧（LRU 双帧窗口互斥静态海报）。审核者连带自纠：render-frame.test.ts:22-28 自建 tracks 不受单轨改动影响（夹具影响面收敛为 2 个文件）。
> 本 spec 是 [video-editor.md](video-editor.md)（v3.6）的增量改造文档；对 v3.6 的 7 处条款反转见「附录 A 勘误登记」。

## 背景与目标

现有剪辑器功能逻辑完备（store/scene/renderer/audio-engine/export 纯函数 + 测试覆盖），但 UI 交互壳简陋且存在两个阻塞级缺陷：

1. **P0-A 层级缺陷**：编辑器壳 `z-[100000]`（BaseFullscreenModal.tsx:70）不透明覆盖，而 antd 弹层 z-index = `zIndexPopupBase(11000) + 100 = 11100`（App.tsx:11 + antd `es/_util/hooks/useZIndex.js`，CONTAINER_OFFSET=100 于该文件 :9），且 Modal/message 静态方法 portal 到 body 不读调用方容器——**ExportModal、Modal.confirm（片段重拍）、全部 message.* 在编辑器内不可见**。用户症状即原始问题 12「点击导出没反应」的第一根因。
2. **P0-B 内存架构约束**：presign 通道仅有 POST 且 Conditions 锁 `content-length-range ±1024`（minio.service.ts），上传必须有磁盘背书的 File/Blob；15min 1080p ≈1.35GB，无磁盘中转（FSA StreamTarget，Plan 4 决策 4）必爆堆。**移除 FSA = 回退已拍板架构**。

同时按用户需求对齐 opencut-classic（`docs/vendor/opencut-classic/`，MIT vendor 快照）的交互质量：暗色扁平、resizable 布局、帧缩略图、缩放锚定、点击入轨、比例选择等 12 项（见「附录 B 覆盖矩阵」）。

### 用户拍板决策（2026-09-11）

| # | 决策 |
|---|---|
| D1 | 整合策略 = **深度移植交互层**（时间轴交互算法/resizable 布局/缩略图方案移植；store 数据模型保留不换——换了破坏画布 Yjs 协作/自动连线/产物节点集成） |
| D2 | 导出位置 = **画布（默认）/ 本地 二选一** |
| D3 | 分辨率 = **480P / 720P（默认）/ 1080P 三档** |
| D4 | 导出写盘 = **方案 A：磁盘中转保留（FSA 优先，OPFS 回退）+ 「画布/本地」分支决策后置到编码完成后**。**手势语义（实现红线）**：磁盘句柄获取（FSA picker）仍在点击手势内完成——`showSaveFilePicker` 需 transient user activation，编码数分钟后的 await 链再调必抛 SecurityError（现状 ExportModal.tsx:93 即手势内调用）；"后置"的仅是目的地**分支决策**，picker 退出的是「唯一写盘通道」地位而非用户手势 |
| D5 | 片段语义色 = **照搬 opencut 色表**（放弃 v3.6 亮色语义色，勘误②） |
| D6 | 画布比例 = **C 档全量**：canvasSize 字段 + 6 档 + 全部消费方 + 新建可选默认 + 记忆（显式标注来源，不静默） |
| D7 | 后端导出链缺陷（P1-D）= **纳入本次，独立批 7** |
| D8 | 初始轨道 = **1 条空视频轨**，其余轨道随素材添加动态创建（勘误③） |

### 三层划分

| 层 | 内容 |
|---|---|
| 保留（不动） | editorStore 数据模型、scene 纯函数、CanvasRenderer、audio-engine、导出 controller/Worker 管线、autosave、Yjs 影子、自动连线、执行白名单 |
| 移植（从 opencut 搬） | exp 缩放曲线常量（`Math.exp(-cappedDelta/300)`、按钮因子 1.7）、repeat-x 平铺缩略图方案（tile 尺寸改 `auto 100%`）、轨道色表、react-resizable-panels 布局模式、初始单空轨模型 |
| 重写（视觉） | 全部组件样式暗色化（复用 `--canvas-controls-*` token，不造第二套）、antd icons 图标化、导出 Modal → Popover |

> 评审证伪的"待移植"项（勿搬）：ResizeSession 状态机（仓内 beginTransient/endTransient 等价，editorStore.ts:431-447）；zoom-controller class（有 opencut 内部依赖，仓内 view-scale.ts:59 `anchorZoomScroll` 死代码更通用，接线即可）；resolveTrackPlacement（耦合 opencut 三轨模型，仓内 overlap.ts 已承担，点击入轨自写 ~15 行纯函数）；mediabunny VideoSampleSink 取帧 + 新 LRU（AssetPanel 已有 thumbnailUrl，回退复用 renderer/video-cache）。

---

## 批 1｜层级修复（P0-A）——最小证伪实验

**只做层级，不动 theme**——保留「浏览器点导出 → 弹层可见」作为对 z-index 诊断的纯证伪：失败即诊断错，回批重查；不与暗色/布局混批（否则失败时无法归因）。

- VideoEditorShell 内加 `<ConfigProvider getPopupContainer={() => shellRef.current ?? document.body}>` + `<AntdApp>`（ref 未挂载首帧兜底 body，不得返回 null）。
- 编辑器内 **10 处静态调用改 `App.useApp()` 上下文实例**：AssetPanel.tsx:45,46,58,59、ExportModal.tsx:89,108、PreviewPlayer.tsx:45(Modal.confirm→modal.confirm),55、VideoEditorShell.tsx:53,76。
- 机制依据（antd 5.22.5 源码一手验证）：静态 `message.*` 只读自身 getContainer（message/index.js:23），静态 `Modal.confirm` 自建 ConfigProvider 根（modal/confirm.js:31,86）——均不继承调用方容器与主题；组件态 Modal 自动继承 getContextPopupContainer。
- TDD：jsdom 断言弹层挂载容器在壳内（`closest('[data-testid="video-editor-shell"]')`）；jsdom 无层叠上下文，层叠正确性由浏览器验收承担。
- 验收：浏览器实测 ①点导出弹层可见 ②片段重拍 confirm 可见 ③上传成功/失败 toast 可见。

## 批 2｜暗色化 + 布局 + 图标化（问题 1/2/7/10）

- 批 1 的同一 ConfigProvider 加 `theme={{ algorithm: theme.darkAlgorithm }}`（编辑器作用域，不污染画布）——**message 必须已是上下文实例**（批 1 前置），否则静态 message 自建根弹白底 toast。
- 暗色 token：底 `#141414`、面板/边框/控件文字复用 index.css:17-24 既有 `--canvas-controls-*`（`rgb(38,38,38)` / `rgb(54,54,54)` / `rgb(247,247,247)`）、正文文字沿用全局 `#e2e8f0`（body 同值）、强调 `#6C5CE7`——**不新造第二套同值变量**。
- 布局：新依赖 `react-resizable-panels`（React18 兼容）。垂直组（主区 30–85% / 时间轴 15–70%，时间轴横向满屏）+ 水平组（素材 15–40% / 预览 min30% / 属性 15–40%）。尺寸持久化 localStorage **键名 `ve-panel-sizes`、版本 v1 现在定死**（下次改布局走 migrate，不裸改）。
- 已知契约：TimelineRuler `widthPx={viewportW - 140}`（TimelinePanel.tsx:232，140=轨道头宽）——面板 resize 测量走 ResizeObserver 但 onLayout 只写 localStorage，避免每帧 setState 重算风暴；标尺窗口化在批 3 兜底。
- 图标化：控制条撤销/重做/分割/删除 → `@ant-design/icons`（UndoOutlined/RedoOutlined/ScissorOutlined/DeleteOutlined）+ Tooltip（含快捷键提示，S 键需发现性）。**保留控制条位置，不加时间轴工具行**（避免双入口，勘误⑥）。

## 批 3｜时间轴交互（问题 3/4/5/6/11 + 色表）

### 3.1 初始单轨 + 动态建轨（问题 3）
- `createDefaultProjectData()` 改为仅 1 条空视频轨（packages/shared/src/types/video-project.ts:53-64）。
- 影响测试夹具以实测为准（已证实需改：PropertiesPanel.test.tsx:21-28 用 tracks[1]/[2]、TimelinePanel.render.test.tsx:12-18；render-frame.test.ts:25 自建不受影响）。
- **动态建轨策略纯函数**（与点击入轨/拖拽建轨共用）：按 mimeType 选首个可容纳的类型轨 → 无则 addTrack → 起点 = **该轨** `max(clip.start+clip.duration)`（空轨→0；勿用全局 totalDuration——轨短于全局时会插出空隙）。TDD 必含「轨尾 < 全局时长」用例。
- **拖拽落不兼容轨修复**：现状 TimelinePanel.tsx:184-185 静默 `return`（onDragOver 却 preventDefault 显示可放置）——改为走同一建轨策略：自动建兼容轨 + 按落点 x 放置。单视频轨后拖音频 100% 踩到，验收用例固化。
- **空轨常驻不自动消失**（拖拽会话中轨道行位移 = elementFromPoint 落点漂移）；清理走已有删轨 Popconfirm。

### 3.2 帧缩略图（问题 4）
- `MediaInfo` 加 `thumbnailUrl?` 字段——**setMediaInfo/mergeMediaInfo 三字段白名单同步加第四字段**（editorStore.ts:172-187，否则静默吞掉）。
- 平铺：ClipBlock `background-image: url(thumbnailUrl)` + `background-repeat: repeat-x` + `background-size: auto 100%`（**素材固有比例，不写死 16/9**——opencut 写死会让竖版拉伸）；tile 未就绪时见 `background-color` 深色兜底（CSS 天然层序：底色常驻、tile 作 image 叠加，**零 JS 就绪分支**）。
- 回退取帧按**常态分支**设计（画布「生成结果」素材无 thumbnailUrl——AssetPanel.tsx:138-139 只有文字占位——恰是最常见入轨素材）：**不走播放用 video-cache**（其为播放设计：媒体级 LRU 上限 + 播放头双帧窗口，给多片段取静态海报会互相淘汰反复重建 sink）——用同一 sink 工厂做**一次性**「t=0 首帧 → canvas → JPEG dataURL」写回 `MediaInfo.thumbnailUrl`（取一次即命中第四字段白名单；mediaInfo 不入 autosave——VideoEditorShell.tsx:58-59 只订阅 s.data——写回安全幂等）。导出产物有缩略图（generated-media.service.ts:58-59 排队生成）。

### 3.3 轨道色表（问题 1 关联，勘误②）
- 本项目 Track 仅 3 类，色表映射：video → `background-color: #1f1f1f`（兜底底，tile 覆盖）、subtitle → `#5DBAA0`、audio → `#8F5DBA`。opencut 的 graphic `#BA5D7A` / effect `#5d93ba` 弃用（无对应轨类型）。
- 音频波形色 `#43CC80`（ClipBlock.tsx:27 硬编码绿）→ `rgba(255,255,255,0.7)`（紫底绿波打架）。

### 3.4 缩放与标尺（问题 6/11）
- Ctrl+滚轮：`zoomFactor = Math.exp(-cappedDelta/300)`（delta 上限 ±30）+ **接线现有死代码 `anchorZoomScroll`**（view-scale.ts:59，鼠标点锚定）+ `preventDefault`（capture + passive:false 阻浏览器缩放）。
- **标尺窗口化前置**：现状 TimelineRuler 全量渲染 ticks（TimelinePanel 500px/s、900s 工程 = 3600 个 div）——先改只渲染视口内 ticks，**缩放上限（现 clamp 10–500，editorStore.ts:161）在窗口化后再评估放宽**，否则 exp 曲线在上限处夹平、窗口化前先爆 DOM。
- 分割补 `S` 快捷键（**排除 Ctrl/Cmd+S**——不劫持浏览器保存；用例：s 分割 ✓、Ctrl+s 不分割不拦截）。
- trim 拖动（问题 5）现有实现保留（beginTransient + 6px 命中 + 邻居 clamp + snapTime 三档吸附），增量仅补拖动中吸附指示线。

## 批 4+5｜渲染坐标系：contain 修复 + 画布比例 C 档（问题 8/9）

### 4.1 播放器 contain（问题 9）
- 去掉 PreviewPlayer.tsx:67 `style={{ width:'100%', aspectRatio }}`——canvas 替换元素靠 `max-w-full max-h-full` + 内在尺寸自动 contain 保比例。**不引入 ResizeObserver**。
- **applyCanvasSize(canvas, size) 单点函数**：canvas width/height 属性（PreviewPlayer.tsx:66）与 usePreviewPlayback.ts:46,58 守卫必须同源（赋 width 清空画布重置 2D 上下文，两处不一致 = 每帧重设 + 闪黑）。

### 5.1 canvasSize 数据模型
- `ProjectData` 加可选 `canvasSize?: { width: number; height: number }` + 单点访问器 `canvasSizeOf(data)`（缺失兜底 1920×1080）。
- 6 档 preset：16:9→1920×1080、9:16→1080×1920、21:9→2560×1080、3:4→1080×1440、4:3→1440×1080、1:1→1080×1080。
- 顶栏比例按钮 → Dropdown 六档；**新建工程可选默认比例 + localStorage 记忆 + 界面显式标注「上次使用 X」**（不静默竖屏）。
- 切换比例：片段按**中心点等比重映射纯函数，且覆盖 keyframes.value**（TransformKeyframe.value 是绝对值，只映射 clip.transform 会让打过关键帧的片段漂移）。TDD 必含带关键帧用例。

### 5.2 fontSize 语义
- `SubtitleClip.style.fontSize` 定义为**基准坐标系（1080 高）像素**，渲染时乘 `canvasH/1080`——既有工程 48 语义不变、新比例自动等比。subtitle-layout 的 bottomMargin:96/maxWidth:1664 同口径比例派生（canvas-renderer.ts:65 的 `CANVAS_H - 96` 硬编码一并消除）。

### 5.3 导出目标尺寸（单点）
- `computeExportSize(canvasSize, tier)` 纯函数：**档位 = 目标短边**，`scale = targetShort / min(canvasW, canvasH)`，**宽高取偶**（16:9 480p = 853.33 → 854×480；H.264 宏块对齐）。
- **单一来源**：worker 绘制 scale、estimateSizeBytes（precheck.ts:14-17）、配额预检口径、register metadata.width/height 全消费此函数（否则声明尺寸与实际输出分叉）。TDD：6 比例 × 3 档 = 18 组合全偶数且与 metadata 一致。
- 码率表按像素量重定（21:9 比 16:9 多 33% 像素，固定码率画质偏低）。

### 5.4 消费方清单
- canvas-renderer contain 基准（canvas-renderer.ts:42-51）、字幕规格（5.2）、导出 scale/码率（5.3）、VideoEditNode 迷你预览（**卡片宽 316 固定不变、预览区 letterbox**——高度剧变会影响画布布局与产物定位 product-node.ts:13-19）。
- ~~缩略图~~（时间轴 tile 是素材比例，与画布比例无关，移出清单）。

### 5.5 后端（部署顺序：先后端再前端——新前端 + 老 DTO = 400）
- video-project.dto.ts:23 `@IsIn` 加 `'480p'`；`durationSec` 补 `@Max(900)`（15min 上限目前仅前端 precheck）。
- 产物 metadata 补 `width/height`（现仅 resolution:'1080p' 无法表达 9:16 的 1080×1920）。

## 批 6｜导出改造（问题 12：P0-B 方案 A + P1-E + UI）

### 6.1 写盘通道（P0-B）
- 编码始终磁盘中转：Chromium FSA StreamTarget（**句柄获取在点击手势内**，见 D4 手势语义红线）；**非 Chromium/无手势场景 OPFS**（`navigator.storage.getDirectory()` 无需用户手势，Chrome/FF/Safari 16.4+）。
- **fastStart 判据改 `diskTarget != null`**（worker.ts:100 现为 `fsaWritable ? {fastStart:false} : auto`——漏改则 OPFS 走 auto → in-memory mux，P0-B 原样复活）。
- OPFS 生命周期：随机 key；成功/失败/取消三条路径均 `removeEntry`（防磁盘垃圾）；OPFS 失败（配额/隐私模式）回退 BufferTarget + **内存警告前置到 UI 明示**（非仅 precheck 一行）。
- **P1-E 三态**：`SaveTarget = {kind:'fsa', handle} | {kind:'opfs'} | {kind:'canceled'}`——canceled 必须中止（TDD：canceled → runExportJob 零调用）；现状三态压 null 后无条件继续 = 用户取消后白跑几分钟 CPU + 多出素材和节点（client.ts:15-23 + ExportModal.tsx:93）。canceled 给一行提示「已取消导出，未开始编码」。

### 6.2 目的地分流（编码完成后）
- 「导出到画布」（默认）：`handle.getFile()` 零内存读回 → uploadExportedProduct → createProductNode。
- 「下载到本地」：对同一磁盘 File `a[download]`——**revoke 延后（download 事件后或延时），不抄仓内同步 revoke 先例**（ImageGenNode.tsx:141-142 click 后立即 revoke，大文件截断风险）。

### 6.3 UI
- antd Popover（bottom-end 锚定导出按钮，**getPopupContainer 壳内**——批 1 前置）：标题「导出设置」+ 文件名 Input + 导出位置 Select（画布/本地）+ 分辨率 Select（480P/720P/1080P）+ 格式 MP4（disabled）+ 取消/确认。
- **受控 open + 导出中不可外部关闭**（对齐现 Modal maskClosable={false} + onCancel 守卫语义，ExportModal.tsx:126-127）；进度内嵌 Popover（Progress + 取消按钮）。
- **显式登记**：导出中收起编辑器 = Popover 随壳卸载、进度 UI 丢失、导出继续跑到 done 照常建产物节点（R2-N12 后台完成语义，**不加拦截不改中断**）。
- 保留 `startingRef` 重入锁 + `beforeunload` 模块级守卫（既有验收资产不回退）。

### 6.4 失败半途
- 上传成功但 createProductNode 抛错（product-node.ts:12 找不到节点 throw）→ 明确提示 + **重试仅补建节点**（不重复上传）；补建所需 `{mediaId, title}` 持久化进 store（组件 state 随弹层关闭丢失）。

## 批 7｜后端导出链加固（P1-D，独立批）

1. **终判**：GeneratedMediaService.confirm 接入 `assertOnConfirm` 语义（超限删对象删记录抛错）——现状导出链是字节量最大却唯一无终判的通道（两并发 presign 可同过、双双落库超限）。
2. **TTL 回收**：`type:'generated' && status:'pending'` 加 24h 量级 TTL（temp-cleanup.processor.ts 现只收 `type:'temp'`）；排除「正在上传中」；删除连带 MinIO 对象（复用 temp-cleanup.processor.ts:36-42 做法）。孤儿现状：不计入配额（getUsage 只统计 completed）= 不可见泄漏。
3. **幂等**：register 接受前端 `clientRequestId`(uuid)——同 id 返回同一条 Media（重试复用，不新增行/对象）。~~videoProjectId+exportSeq~~（需持久化 seq，刷新即丢）。
- 前端批 6 的 {mediaId,title} store 持久化与此呼应。

---

## 测试策略（贯穿）

- 纯函数 TDD 主战场：建轨策略（轨尾口径）、目标尺寸（18 组合取偶）、比例重映射（含关键帧）、exp 缩放锚定（接线 anchorZoomScroll 的前后视口不变量）、SaveTarget 三态、computeExportSize 全消费方一致性。
- 组件测试（Vitest + testing-library，沿用现有模式）：弹层挂载容器在壳内（jsdom 断言）、图标按钮禁用态 + Tooltip、Popover 选项联动与受控关闭、tile 平铺渲染（background 样式断言）。
- 浏览器验收（preview 工具）：批 1 首验弹层可见性（证伪实验）、面板拖拽、Ctrl+滚轮锚定、拖音频自动建轨、六比例切换 + 18 组合导出尺寸、15min（或降级模拟）导出期间堆不持整段 MP4。
- 每批登记勘误到 video-editor.md / 对应 plan（本仓惯例：spec + plan + 轮次修订记录，不改文档等于埋雷）。

## 风险与开放问题

- P0-A 诊断为代码级证明（z-index 算式 + portal 结构），沙箱无法起浏览器实测——批 1 首验即证伪步骤，失败回批重查。
- opencut vendor 快照只读不参与构建，移植均为"算法/方案级"复刻，无直接 import。
- soundtouchjs 精确锁等既有风险登记不变（v3.6 口径）。

---

## 附录 A：video-editor.md v3.6 勘误登记（7 处）

| # | v3.6 原条款 | 修订为 |
|---|---|---|
| ① | §四 :287 视觉：亮色 #F7F8FA/面板白 | 暗黑扁平：#141414 底/rgb(38,38,38) 面板（用户 2026-09-11 拍板，对齐项目全局暗色） |
| ② | §四 :287 字幕浅橙黄底、音频浅绿底 | opencut 色表：subtitle #5DBAA0 / audio #8F5DBA + 白波形 rgba(255,255,255,0.7)；video #1f1f1f 兜底+缩略图覆盖 |
| ③ | 默认工程 4 轨（1视频+1字幕+2音频） | 初始 1 条空视频轨，动态建轨（点击/拖拽共用策略） |
| ④ | §一 :49 合成坐标系固定 1920×1080；§四 :279 比例一期固定不可切；§十 一期不做多比例 | C 档多比例：canvasSize 字段 + 6 档 + 全消费方（renderer/字幕/导出/节点卡片）+ 新建可选默认 + 记忆（显式标注） |
| ⑤ | §七 :346 FSA StreamTarget 直写本地 | FSA/OPFS 磁盘中转，目的地（画布/本地）后置到编码完成后分流 |
| ⑥ | §四 :283 控制条文字按钮 | 图标化（antd icons）+ Tooltip 快捷键提示，控制条位置与四按钮结构不变 |
| ⑦ | §七 分辨率 720p/1080p 两档 | 480P/720P/1080P 三档（DTO @IsIn 同步 + @Max(900) 时长上限 + metadata 补 w/h） |

## 附录 B：原始 12 问题覆盖矩阵

| 问题 | 批次 |
|---|---|
| 1 暗黑扁平风格 | 批 2（色表在批 3） |
| 2 布局对齐 + 时间轴满屏 | 批 2 |
| 3 初始空视频轨 | 批 3.1 |
| 4 点击入轨 + 帧图显示 | 批 3.1/3.2 |
| 5 trim 拖动 | 已有（批 3.4 增吸附指示线） |
| 6 Ctrl+滚轮缩放 | 批 3.4 |
| 7 图标化 | 批 2 |
| 8 比例选择 | 批 4+5 |
| 9 播放器变形 | 批 4.1 |
| 10 面板可调整 | 批 2 |
| 11 分割等实用功能 | 批 3.4（S 快捷键）+ 已有 splitClip |
| 12 导出弹层 + 点击无反应 | 批 1（根因）+ 批 6（UI/架构） |

另覆盖评审新增：P0-A（批 1）、P0-B（批 6.1）、P1-D（批 7）、P1-E（批 6.1）、标尺性能（批 3.4）、拖拽静默丢弃（批 3.1）、失败半途（批 6.4）、revoke 时机（批 6.2）、导出中收起语义（批 6.3 登记）。
