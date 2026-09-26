# Canvas 参考选择模式与风格库 — 设计 Spec

日期：2026-09-26
状态：v4（第四轮审核修订——甲方案补 elementsSelectable/Tab 键 gate/D14 非事务三步/索引拆两条/admin 路由与筛选修正；事实断言均标「已核实」+行号；2026-09-27 plan 第八/九轮审核补登 §3.1 发起范围/常量口径（C2/C3）、§3.2 提示时长对齐 2200ms、§3.3 D25 兜底降级为纯记录——RF 源码已证 onNodeClick 不受 elementsSelectable 门控）
关联：`2026-09-26-image-node-panel-redesign.md`（工具行 风格/参考 按钮为本次落地的入口；其 §7-4「风格按钮仅外观」与 §8 验收 5/6「参考按钮=上传」自本文起**失效**）

---

## 0. 背景与目标

图片节点工具行（ImageThumbnailBar）的 风格 / 参考 两按钮此前仅占位或承担文件上传。本次：

1. **参考按钮** → 进入「从画布选择参考」模式：画布顶部弹出横幅，点击画布上其他图片节点即把该节点主图加为参考图（带序号角标，hover 变 X 删除）。**本轮只做 UI**——参考图对生成的接通为存量断链，登记为独立后续任务（D11/B15）。
2. **风格按钮** → 弹出风格库（自绘 overlay）：全部/我的收藏/最近使用 三 tab + 分类 + 搜索 + 仅看可商用 + 5 列卡片网格；选中风格记录到节点并**拼入生成 prompt**（图片两类节点 + 视频节点全生效；顺手接通面板 prompt 存量断链 D12）。
3. **管理后台**新增风格分类管理、风格内容管理（数据由 admin 录入）。

## 1. 需求与拍板记录

### 第一轮（用户澄清）

| # | 需求/分叉 | 拍板 |
|---|---|---|
| D1 | spec 组织 | 单 spec + 单 plan，plan 内分 A（参考选择）/B（风格库全链路）两组任务 |
| D2 | 参考按钮与上传入口冲突 | 点参考**直接进画布选择模式**；文件上传 input 移除，拖拽/粘贴上传路径保留（已核实：拖拽 ImageThumbnailBar.tsx:103-104、粘贴 PromptInput.tsx:373-407 由 VideoConfigPanel.tsx:261 接线） |
| D3 | 风格对生成的影响 | 风格带 `promptText`，生成时后端拼入 prompt；**视频节点同样生效** |
| D4 | 弹窗 MVP 范围 | 三 tab + 卡片详情预览；**不做**最小化按钮、**不做**模型选择器 |
| D5 | 横幅按钮语义 | 「返回节点」=退出模式+视口滚动并选中发起节点（面板不收起）；「退出」/Esc=纯退出 |
| D6 | 视频节点 | 风格与参考选择对视频节点全生效（风格 prompt 拼入视频生成） |
| D7 | 弹窗技术形态 | 自绘 overlay（复用 BaseFullscreenModal 外壳，见 D15），非 antd Modal、非独立路由页 |
| D8 | 序号角标范围 | **全部参考图统一显示**序号（上传+画布选择），hover 变 X 删除 |
| D9 | 使用风格后的弹窗行为 | 使用即关闭弹窗；换风格直接覆盖不弹确认；「取消使用」在当前使用卡片 hover 时出现 |

### 第二轮（审核裁定，2026-09-26）

| # | 分叉 | 拍板 |
|---|---|---|
| D10 | 「推荐」chips | 改名**「全部」**（原语义等价于不筛分类，名不副实）；排序 `sortOrder asc, usageCount desc, id asc` |
| D11 | 参考图→生成断链 | **只做 UI+登记**。已核实：apps/api 全仓无 allImages 读取（仅 video-work 快照过滤剥离它）；生成参考图只来自上游 resultUrl（topology.service.ts:75-76）；且 HY-Image submit body 不接受任何参考图参数（api-caller.service.ts:243-286 无 imageUrl）——图片参考在第三方 API 层无入口，接通需先选型支持参考图的模型通道，留独立 spec（B15） |
| D12 | 面板 prompt 存量断链 | **顺手接通**。已核实：execution.service.ts:75 `prompt = upstream.textContents.join(' ') || data?.content || ''`，全模块 grep 不到 `data.prompt.text`——独立图片/视频节点面板输入的 prompt 从不进生成。修法见 §7.2 |
| D13 | 卡片点击语义 | **维持点卡=使用+关窗**（liblib 同行为）；三个 hover 按钮 stopPropagation；测试承保「点收藏/详情不触发使用」 |
| D14 | usageCount 口径 | 仅当 StyleRecentUsage upsert **新建**记录（该用户首次使用）时 `increment: 1`——计数=使用人数，免疫重复点击与取消使用导致的计数/排序自我污染 |
| D15 | 弹窗外壳与滚动 | 外壳复用 **BaseFullscreenModal**（已核实 BaseFullscreenModal.tsx:25-80：body portal、z-[100000]、bg-black/60 背板、背板点击关闭、滚动锁、焦点恢复、Esc 全齐，4 个既有消费方）；滚动加载用**「加载更多」按钮**——与仓内分页先例一致（WorkspaceDimension.tsx:181,251 按钮式）+ 简洁优先（IntersectionObserver 全仓零先例且 test-setup.ts:3 未 shim，属次要附加因素非决定性理由） |
| D16 | 取消使用的写值 | 写 **`null`**（`styleId?: string \| null`），弃 undefined（mergeNodeData 无删键语义，nodeStore.ts:269-271 已核实仅 `merged[key]=value`；null 可过 JSON 往返，undefined 会丢键） |
| D17 | 封面存储 | `coverKey`（MinIO key）+ 读时 presign（已核实：admin-home-banner.controller.ts:65 返回 `{imageKey}`、home-banner.service.ts:35 `generatePresignedGetUrl(key, 3600)`，桶非公开读，存直链 1h 全裂）；上传先例=**admin-video-work.controller.ts:30-42 uploadCover**（banner 方法名是 upload） |
| D18 | 命名对齐仓内 | `enabled`→**`active`**（VideoCategory schema.prisma:903 先例）+ `@@index([active, sortOrder])`（:908 先例）；join 表补 `id @id @default(cuid())` + `@@unique` 并存（TeamMember :709/:717 先例，全仓 42/42 模型有 @id）；种子进 **seed.ts upsert**（17 个 migration 零 INSERT，已核实）而非 migration SQL |
| D19 | 模式期交互 | 参考选择期新开独立标志**只喂 `nodesDraggable={false}`**（不复用 isLocked——CanvasView.tsx:431-436 已核实它同时关 pan/zoom/focusable，参考选择时必须能平移缩放）；点击/拖拽区分靠 React Flow 默认 `nodeClickDistance=0`（拖动即吞 click，CanvasView 从未设置该值，已核实），**不写自造位移阈值**；满 9 张时参考按钮**恒显**（脱离 showUploadButton 门控，语义已从上传变为模式入口） |

### 第三轮（审核裁定，2026-09-26）

| # | 分叉 | 拍板 |
|---|---|---|
| D20 | 嵌套浮层 Esc 属主 | **状态驱动 onClose**：详情浮层不做独立 Esc 监听、不挂 body portal（渲染在风格库内部、库内 absolute 居中层 z 更高），关闭统一走风格库 `onClose = detail ? setDetail(null) : closeStyleLibrary()`——第一次 Esc/背板点击关详情、第二次关库。依据已核实：BaseFullscreenModal.tsx:51-64 Esc 为 document 冒泡监听 + `stopImmediatePropagation()`（:57），先注册者（库）先吃事件，详情若独立监听则永不触发；共享组件零改动（4 个既有消费方无嵌套模态先例），顺带避免双层 bg-black/60 背板叠加变暗 |
| D21 | 弹窗卡片显式宽度 | `w-[min(1600px,calc(100vw-64px))]` 显式宽度。依据已核实：BaseFullscreenModal 的 dialog 包装 div（:75）**无任何尺寸类**，父级 flex 居中，auto 宽 flex item 内 5 列 1fr 网格会循环依赖塌宽（VideoPlayerModal.tsx:63 注释先例：消费方子层自带 fixed/显式尺寸） |
| D22 | 有上游文本时面板 prompt 被忽略 | `||` 回退链语义=**上游优先、面板弃用**（现状），有意保持，本轮不做合并（B21）——经典「文本节点→图片节点」流程中用户手输的面板 prompt 不进生成 |
| D23 | promptText 随列表返回 | 保留（详情浮层与卡片同源免二次请求）；**视为公开素材**——风格 prompt 本就是面向用户的生成素材，对齐 liblib 详情公开口径 |
| D24 | usageCount 展示文案 | 「N 人使用」——D14 口径=使用人数，「用 100 次只涨 1」按人数语义自洽，防误报 bug |

### 第四轮（审核裁定，2026-09-26）

| # | 分叉 | 拍板 |
|---|---|---|
| D25 | 甲方案补 `elementsSelectable` | 模式期**两个 prop**：`nodesDraggable={referenceSelect ? false : !isLocked}` **且** `elementsSelectable={referenceSelect ? false : !isLocked}`。已核实：`isSingleSelected` 读 React Flow 的 selected（src/hooks/useIsSingleSelected.ts:14-21，非 canvasStore.selectNode），RF NodeWrapper 点击选中不经我们代码——只关 nodesDraggable 时点击目标节点仍会 RF 内部选中目标→发起节点失选→面板卸载，「面板与序号实时可见」失效。elementsSelectable=false 四点已验证：RF 选中被抑制、onNodeClick 照常触发、空白点击不取消选中（resetSelectedElements 早退）、退出恢复不清既有选中 |
| D26 | D14 实现机制 | **非交互式事务三步**（不用 $transaction）：① findUnique 校验 active（停用/不存在→404）② `create` StyleRecentUsage，捕获 P2002 退化 `update lastUsedAt`（每语句各自 autocommit）判 isFirstUse ③ 仅首次 `style.updateMany({ where: { id, active: true }, data: { usageCount: { increment: 1 } } })`。依据：PostgreSQL 显式事务内语句报错即 aborted（25P02），Prisma $transaction 不加 savepoint——事务内 catch P2002 后再 tx.update 必抛 25P02，等于换个 500。updateMany 免 P2025（并发删风格返回 count:0 不抛）且 active 校验折进同条语句。favorite 同理简化：`createMany({ skipDuplicates: true })` / `deleteMany` 双向天然幂等，P2002 分支整段消失 |
| D27 | admin 路由与筛选 | 子页 **`/admin/styles/content`** + `/admin/styles/categories`（组 path `/admin/styles` 不得等于任何子页 path——antd Menu key 重复致选中态错乱；仓内既有组全部「组路径≠子路径」，已核实 AdminLayout.tsx:12-35）；router 子路由用相对路径对齐仓内（'styles/content'）。内容页筛选**不启用 ProTable search 表单**（全仓 8 处 ProTable 均 search={false} 零先例，已核实）——页顶自定义 antd Select（分类）+ Input（名称）过滤，request 接参 |
| D28 | 视频 prompt 回退删除 | §7.1 视频 `vData?.prompt?.text` 回退**删除**（与 §7.2 `data?.prompt?.text` 同源同值，纯冗余），直接传组装后的 prompt；「空 prompt 对象不序列化进请求体」用例保留承保 §7.2 修法（两审核分歧裁定：采删除方——同源冗余代码违背精准修改；防 :75 未来漂移由用例承保） |

## 2. 架构总览

```
┌─ web 前端 ────────────────────────────────────────────────┐
│ ImageThumbnailBar（入口改造：参考=模式入口恒显，风格=开库） │
│   ├ 参考按钮 → nodeStore.referenceSelect（画布选择模式）    │
│   └ 风格按钮 → menuStore.styleLibrary（风格库，三切片互斥） │
│ CanvasReferenceSelectBanner（新，CanvasView 内横幅）        │
│ StyleLibraryModal（新，BaseFullscreenModal 外壳+居中卡片） │
│ StyleDetailPreview（新，库内详情层——D20 状态驱动关闭）    │
│ SortableImageItem（序号/X 角标两态，prompt-input/ 那份）    │
│ stylesApi.ts（新，用户侧接口封装+信封拆包）                │
├─ api 后端 ────────────────────────────────────────────────┤
│ modules/styles（新：styles.controller + admin-style*.controller）│
│ modules/execution（改：prompt 断链接通+风格拼接两处注入）  │
│ video-work snapshot-filter（改：白名单补 styleId/styleName）│
├─ admin 前端 ──────────────────────────────────────────────┐
│ /admin/styles/categories（分类管理页）                     │
│ /admin/styles（内容管理页，ProTable+ModalForm）            │
└─ DB：StyleCategory / Style / StyleFavorite /              │
      StyleRecentUsage（4 新表+User 反向关系+seed.ts 分类种子）─┘
```

数据流关键约束：节点 data 只存 `styleId: string | null + styleName?`（展示用），`promptText` 每次生成时后端按 styleId 现查（admin 改风格下次生成即生效，节点 data 不膨胀）。

## 3. 功能块 A：画布参考选择模式

### 3.1 状态与入口

- `nodeStore` 新增：
  ```ts
  referenceSelect: { sourceNodeId: string } | null;
  startReferenceSelect(nodeId: string): void;  // 互斥：closeStyleLibrary
  exitReferenceSelect(): void;
  ```
- `ImageThumbnailBar`：
  - 参考按钮 `onClick` → `startReferenceSelect(nodeId)`；**删除**隐藏 file input 与 `handleUploadClick`；参考按钮脱离 `showUploadButton` 门控**恒显**（D19，与风格按钮对齐；满 9 张仍可进入模式，点目标节点走 §3.2 提示）；按钮图标由 + 号换成与横幅同款「卡片选择」图标（语义已变，+号误导）；
  - 拖拽（handleDrop）与粘贴上传路径保留不动（已核实存在）。
- **发起节点范围（第八轮登记，C2）**：ImageThumbnailBar 三面板共享（Image/ImageExt/Video）——视频节点作为**发起**节点同样在范围（D6 全生效；已核实 VideoNodeData.allImages 存在 nodeStore.ts:138、updatePromptImages 对 video 非 noop）；点击**目标**仍限图片两类节点（§3.3）。满员上限经 `MAX_REFERENCE_IMAGES = 9` 常量（prompt-input/types.ts——**本功能新增三处共用**：工具行默认参数/拾取守卫/横幅文案；既有 PromptEditor.tsx:24 粘贴路径硬编码 9 按精准修改不动，登记已知不一致，C3）。
- 模式退出挂点（store 层，已核实归属）：`nodeStore.setActiveEditNodeId / setActiveTransformNodeId`（:360-372 互相 guard-return）开头调用 `exitReferenceSelect()`——进入节点编辑/变换模式自动退出选择模式；不用组件 effect 轮询。
- 快捷键 gate（已核实现状，**两处挂点**）：
  1. `useGroupKeyboard.ts:5-22 isGroupEditContext` 早退补 `referenceSelect` 非空（覆盖 Ctrl+G/Z/Y 与 RF Delete）；`CanvasView deleteKeyCode`（:425）参考模式下置 `[]`；
  2. **page.tsx CanvasKeyboardHandler 的 Tab 分支内补 referenceSelect gate**（已核实 :341-346 Tab → `menuStore.open(lastMousePos)` 直接弹 AddNodeMenu，正撞互斥矩阵；:337 已有「视频编辑器打开期间快捷键全禁」同型先例。实现收窄为 **Tab 专属 gate**——Ctrl+0/Alt+Shift+F fitView 为下述接受边界、保持生效，勿做成顶部全量早退）。
  **边界（已核实，接受）**：Ctrl+0 / Alt+Shift+F（fitView，:348-357）纯视口操作无 doc 变更，接受其生效。
- **反向互斥落点（已核实 v3 缺失）**：menuStore 三个 open（`open`/`openHandleMenu`/`openStyleLibrary`）内跨 store 直调 `useNodeStore.getState().exitReferenceSelect()`（zustand 跨 store 直调先例）——否则 menuStore 触及不到 nodeStore.referenceSelect，「两两互斥」一半无承保。

### 3.2 顶部横幅（CanvasReferenceSelectBanner，新组件）

- 渲染于 CanvasView 内、ReactFlow 直接子级（CanvasToolbar 模式：absolute 顶部居中、z-10~50 档、不随 viewport 变换——已核实 CanvasToolbar.tsx:51 同款）。
- 结构对标参考 DOM：`[图标盒(卡片选择自绘 SVG)] [文案] [返回节点] [退出]`；**`role="status"` 放在文案 span 上**（满员提示需播报；整条含按钮的容器不做 live region）。
- 样式：`--canvas-controls-bg` 底 + `--canvas-controls-border` 边 + `--canvas-shadow-dropdown`（已核实 index.css 仅 menu/dropdown 两个 shadow token，L52-53/L96-97 深浅双档）；不写 `backdrop-filter`（controls-bg 为不透明单值，blur 无视觉效果——ProjectTitle.tsx:64 同款接受）；两个按钮 ghost 文本按钮（hover `bg-overlay-2`）。
- 满员提示：达 9 张后再点节点，文案 span 短暂显示「最多 9 张参考图」（约 2s 还原——实现 2200ms）。

### 3.3 选择行为与约束

- 模式期 CanvasView（D25 甲方案完整版）：`nodesDraggable={referenceSelect ? false : !isLocked}` **且** `elementsSelectable={referenceSelect ? false : !isLocked}`（两 prop 同件；已核实 CanvasView:434-436 现状 elementsSelectable 亦由 !isLocked 控制、isSingleSelected 读 RF selected——只关 nodesDraggable 面板会被 RF 内部点击选中卸载）；点击入口=现有 `onNodeClick`（CanvasView.tsx:200-209，注册 :420，已核实内为 activeEditNodeId 分支先例）新增 referenceSelect 分支——**不调用 selectNode**（elementsSelectable=false 已保发起节点选中态，面板与序号实时可见）。
- 分支逻辑（点击 imageGen/imageExtGen 时）：
  - 主图 fileId = `data.fileId ?? data.referenceImage`（已核实 ImageGenNode.tsx:82-87/110 同款解析；只判 fileId 会把「仅上传过参考图未生成」的节点误判为无图）；
  - 两者皆无 → 忽略；发起节点自身 → 忽略；非图片类节点（videoGen/group/text 等）→ 忽略；
  - fileId 已在参考图（`images.some(i => i.id === fileId)`）→ 跳过；
  - 满 9 张 → §3.2 提示；
  - URL 为 **presign 异步获取**（复用 useImageUpload 的 getMediaUrl 通道先例；点击处理器 async，presign 失败该次忽略——已核实 ImageItem.url 本就是 presign 结果，语义一致）；
  - 构造 `ImageItem { id: fileId, url, name: 源节点 mediaName || '参考图', status: 'success' }`，追加进发起节点 `allImages`（走既有 `updatePromptImages`，nodeStore.ts:595-613，自动获得撤销/协作——canvasCollabRuntime.ts:220-223 syncStoreToDoc(LocalUser) 已核实）。
- 写 allImages 沿用 useImageUpload.ts:174-179 惯用法：**读 store 最新值 → 改 → 写回**，防闭包旧数组。
- 横幅常驻可连续多选；画布空白点击（onPaneClick）**不退出**模式（防误触）；「返回节点」= `exitReferenceSelect()` + 视口滚动到发起节点并置选中（setCenter 先例 ImageGenNode.tsx:194）；「退出」/Esc = 纯退出。
- **画布选图不插入 Tiptap prompt chip**（与上传路径 onImageUploaded→insertImage 的行为差异是有意的：chip=引用素材进 prompt 语义，画布选择只进参考图条；登记 B14）。
- 参考图对生成零影响（存量断链，登记 B15，D11 拍板本轮不接）。
- **执行期兜底（第八轮登记，第九轮降级为纯记录）**：若浏览器实测 `elementsSelectable={false}` 下 `onNodeClick` 不派发（D25 四点验证之一失守），退路=拾取成功回写后补 `selectNode(sourceNodeId)`（CanvasView 既有通道）——修「面板与序号实时可见」的伴生症状，不放弃甲方案双 prop。**第九轮已实读 @xyflow/react dist 源码定论**：`handleNodeClick` 的用户回调分支在 `isSelectable` 判块之外（index.mjs:2156-2169）、节点 pointer-events 由 onNodeClick 存在性保住（:2140/:2282）——回调**不受 elementsSelectable 门控**，甲方案源码级成立，兜底仅为记录。

### 3.4 序号/X 角标（SortableImageItem 改造——指名 `prompt-input/SortableImageItem.tsx`；MultiImageConfigPanel.tsx:44 有同名局部组件**不动**，已核实）

- 组件新增 `index?: number` prop（序号由 ImageThumbnailBar 按 allImages 顺序传入，拖拽排序后自动跟随；组件自身无位置信息，已核实 props 仅 image/onDelete/onClick）。
- 角标：圆形小徽章，定位在缩略图容器右上角、一半悬外（`absolute` 角点 + 横向 50% 外移）。**防裁切需两层**（第三轮审核裁决，已核实 CSS 规范：`overflow-x:auto` 与 `overflow-y:visible` 并存时 overflow-y 计算值变为 auto——外层工具行 ImageThumbnailBar.tsx:101 必然两轴裁切）：
  1. 内层：把 `overflow-hidden` 从角标所在外层容器**下移到内层图片裁切容器**（保留圆角裁切），角标挂外层 relative 容器（dnd-kit ref 留外层，transform 语义不变）；
  2. 外层：工具行加**顶部内边距 `pt-3`**（12px——现有 X 按钮为 w-[18px]（:44-46 已核实），半悬 9px，pt-2.5=10px 仅 1px 余量太紧，pt-3 留抗锯齿/缩放余量），条高 +12px 影响 Image/ImageExt/Video 三面板布局——列为 **plan 首个 spike**（连带验证与 风格/参考 56px 按钮的垂直对齐）；`overflow-x-auto` 横向滚动能力保留不动（9 张×50px≈700px 依赖它）。
- 角标若带边框走 token（如 `border-overlay-3`）——white/black 边框命中九族且该文件白名单 allow 只有 `['bg','text']`（已核实 no-theme-utility.js:52）。
- hover 预览 portal（z-[9999]，:144-168）与角标同处右上——验收确认二者不视觉打架（§11-3）。
- 两态：常态显示序号；hover 显示 X。**hover 状态源复用组件既有本地 `hovered`**（:67/:88-103 原生 mouseover/out——刻意绕过 dnd-kit 事件干扰，已核实），不用 group-hover 新开一套。
- uploading/error 态（进度/错误蒙层 absolute inset-0，:26-40）时角标**仍显示**，z 序高于蒙层（B18）。
- 点击 X = 现有删除逻辑（handleDeleteImage → deleteImage 仅删引用不删服务端，useImageUpload.ts:174-179 已核实）。
- 白名单零成本：该文件已在 no-theme-utility.js:52 白名单（allow:['bg','text']），同文件同属性族改两态角标无需动白名单（已核实）。

## 4. 功能块 B：风格库弹窗

### 4.1 打开/关闭与互斥

- `menuStore` 新增第三切片 `styleLibrary: { nodeId: string } | null` + `openStyleLibrary(nodeId)` / `closeStyleLibrary()`；**三切片互斥**：`open` / `openHandleMenu` / `openStyleLibrary` 各自打开时清其余两个；顺手修既有缺陷 `toggle()`（:38，现不清 handleMenu——已核实）：修法与 `open` 对齐（清 handleMenu **和 styleLibrary**）。
- **不需要** AddNodeMenu 状态提升（已核实并反驳审核断言：page.tsx:218 AddNodeMenu 的 `isOpen` 本就来自 `useMenuStore(s => s.isOpen)`，右键菜单/+按钮菜单与它共享该切片——NodePalette.tsx:17 的 + 按钮也消费同一 isOpen，已核实）；groupContextMenu（CanvasView 本地态）不纳入本轮——风格库背板天然阻断，互斥范围= menuStore 三切片 + referenceSelect（nodeStore，进入任一清对方）。已排除：CanvasView:186-193 的 isOpen 关闭订阅属 useMaterialLibraryStore，清 menuStore.isOpen 无副作用（已核实）。
- 风格按钮（Image/ImageExt/Video 三面板共享）onClick → `openStyleLibrary(nodeId)`。
- 关闭：背板点击 / 右上关闭按钮 / Esc（Esc 由 BaseFullscreenModal 内建）。
- 挂载点：page.tsx:308-309 AddNodeMenu/HandleAddNodeMenu 旁并列挂 `<StyleLibraryModal />`。

### 4.2 布局

```
BaseFullscreenModal 外壳（body portal、z-[100000]、bg-black/60 背板、Esc/滚动锁/焦点恢复全内建，:68-80）
└─ 居中卡片（显式宽度，D21）：w-[min(1600px,calc(100vw-64px))]，高 min(calc(100vh−160px), 1200px)，圆角 12px，
   bg var(--canvas-controls-bg) + 0.5px border var(--canvas-controls-border) + var(--canvas-shadow-dropdown)
   ├─ 行1（h-10）：[全部|我的收藏|最近使用]（分段控件） [搜索框 336px] …… [关闭×]
   ├─ 分隔线（var(--canvas-controls-border)）
   ├─ 行2：分类 chips 横向滚动 + 右缘渐隐（不做下拉箭头，简洁优先） … [仅看可商用]
   ├─ 主体：5 列网格（column-gap 12px，纵向滚动，左右 padding 16px）+ 底部「加载更多」按钮（20 条/页）
   └─ StyleDetailPreview：库内部 absolute 居中层（z 高于库内容；非 body portal、无独立 Esc/背板——D20）
```

- tab：选中 `bg-overlay-2` + `text-text`；未选 `text-text-dim-2` + hover `bg-overlay-2`。
- 搜索框：`bg-overlay-2` 底，focus 边框品牌色 token；防抖 300ms，匹配名称+作者名。
- 「仅看可商用」默认不勾选；收藏/最近 tab 下分类行与商用筛选隐藏（切 tab 时清商用勾选防残留静默过滤）；**搜索框三 tab 均生效**（后端 relation filter 折入，plan 第七轮 P1-6——搜索框头部恒显，不留假交互）。
- 「全部」chips = 默认视图：全部 active 风格，`sortOrder asc, usageCount desc, id asc`；收藏/最近 tab 同样补 id tiebreaker（createdAt desc/lastUsedAt desc + id desc——与 join 行时间倒序同向、批量插入或同毫秒场景偏移分页同样漂移，与 D10 同理由）。
- 竞态防护（D3-审核）：切 tab/切分类/搜索时重置 page=1，请求带序号守卫，过期响应丢弃。

### 4.3 卡片

- 封面：`aspect-ratio 3/4`、object-cover、圆角 lg、`loading="lazy"`（src=列表返回的 presign coverUrl）；hover 顶部浅渐变 + 底部深渐变（bg-black 族，见 §4.6）。
- hover 浮层按钮（均在封面上，**全部 stopPropagation**，D13）：
  - 左上「使用」（图标钮，hover 展开文字）；若该卡为当前使用风格 → 变「取消使用」；
  - 右上收藏星标（已收藏常显；toggle 调 §6 接口，请求体显式带目标态）；
  - 右下「详情」。
- **当前使用**风格卡：白边框 + `bg-black/50` 遮罩 + 左下白底黑字「当前使用」徽章（对标参考代码；white/black 工具类按 §4.6 白名单登记）。
- 点击当前使用卡片主体 = 无操作（取消只走 hover「取消使用」按钮）。
- 信息区（封面下方）：
  - 行1：标题（truncate，14px medium）+「商用」徽章（isCommercial 时）；
  - 行2：作者（占位圆点头像+作者名）+「N 人使用」（dim 色，D24）。

### 4.4 交互语义

- **使用**：`POST /api/styles/:id/use` 成功后 `updateConfig(nodeId, { styleId, styleName })` → **关闭弹窗**；**失败弹窗不关**，列表顶部内联错误文案（不引入 toast 通道）。
- **取消使用**：`updateConfig(nodeId, { styleId: null, styleName: null })`——**写 null 不写 undefined**（D16：mergeNodeData 无删键语义已核实 nodeStore.ts:269-271，null 可过 JSON/Yjs 往返且真值判断消费方全部兼容；契约=「键存在、值 null」，测试钉死）；弹窗不关。
- **收藏 toggle**：请求体显式 `{ favorited: boolean }`；实现 `createMany({ data: [{userId, styleId}], skipDuplicates: true })` / `deleteMany({ where: { userId, styleId } })`——双向天然幂等（不抛 P2002、0 行不抛），无 catch 分支（D26）。
- **usageCount 口径与机制**（D14/D24/D26）：仅该用户**首次使用**时 `increment: 1`（=使用人数）。**非交互式事务三步**（不用 $transaction——PostgreSQL 事务内语句报错即 aborted 25P02、Prisma 无 savepoint，事务内 catch P2002 再操作必抛）：① `style.findUnique` 校验（停用/不存在→404）② `create` StyleRecentUsage，捕获 P2002 退化 `update lastUsedAt`（各自 autocommit）判 isFirstUse ③ 仅首次 `style.updateMany({ where: { id, active: true }, data: { usageCount: { increment: 1 } } })`（updateMany 免 P2025 且 active 校验折进同条）。
- **详情预览**（StyleDetailPreview，新组件）：**挂卡片根（与滚动网格区同级——挂滚动区内会随内容滚动且被裁）的 absolute 居中层**（z 高于库内容；非 body portal、无独立 Esc——D20）：大封面（3:4）+ 名称 + 作者 + 可商用徽章 + promptText 全文（可滚）+「使用」按钮；关闭路径：Esc/外层背板走风格库 onClose 状态驱动（第一次关详情、第二次关库）+ **详情自带 scrim onClick → setDetail(null)**（BaseFullscreenModal:71-73 背板有 `e.target === e.currentTarget` 守卫，点 dialog 内部不触发它）。a11y：详情用 `role="group"` + aria-label（**不用 aria-modal 也不用祖先 aria-hidden**——aria-hidden 祖先会把详情自身一起对 AT 隐藏且焦点落隐藏子树是 axe 违规，B23）。
- **空态**：收藏空「暂无收藏的风格」/ 最近空「暂无使用记录」/ 搜索或筛选无结果「未找到匹配风格」。
- 已收藏但被 admin 停用的风格：收藏/最近 tab 查询过滤 active，不显示。

### 4.5 工具行风格按钮选中态

- 节点 data 有 `styleId` 时：按钮上部显示风格封面小圆图、下部显示 `styleName`（truncate）。
- 刷新后圆图来源：`GET /api/styles/:id` + **模块级 `Map<styleId, { styleName, coverUrl, fetchedAt }>` 去重缓存，55min TTL**（< presign 3600s，过期重取——plan 第六轮审核 B1 修正：直接用接口已 presign 的 coverUrl；勿按 MinIO coverKey 喂 `getMediaUrl`——该接口按 Media 行 id 取 URL，喂 key 会 404）。404 缓存 null 防反复打；onError 回退默认按钮态。**404 语义钉死**：停用/不存在一律 404，stylesApi 把 404 映射为「无风格」回退默认按钮态（非错误提示）。
- 点击行为不变（打开风格库）。

### 4.6 token 与门禁（定稿）

- **不新增任何 token、不走 b0/contrast/registry 变更登记管道**——所依赖 token 全部现成（已核实 index.css 深浅双档齐备）：`--canvas-controls-bg`（:38/:82）、`--canvas-controls-border`（:39/:83）、`--canvas-shadow-dropdown`（:53/:97）、`--fw-overlay-2/3`（:32-33/:76-77）、text 族 `text-text/text-text-dim-1/2/3`（**无裸 `text-text-dim`**，tailwind.config.ts:35-39 已核实，写错=静默零输出）。
- 参考代码硬编码色换算：`#F7F7F7→text-text`、`#919191/#A8A8A8→text-text-dim-2/dim-1`、`bg-canvas-controls-hover→bg-overlay-2`、`hover:bg-btn-ghost-hover→hover:bg-overlay-3`。
- **白名单登记（2 条新条目——glob 按文件匹配，StyleLibraryModal 与 StyleDetailPreview 是两个文件，已核实）**：风格库两新组件的封面遮罩/渐变/「当前使用」白底黑字徽章（bg-black/50、bg-white、text-black、border-white、from-black/to-black）命中 no-theme-utility（无 baseline、命中即违例，已核实）；归因族=**反白 CTA/恒定面**（先例 :67 TopActionBar 登录钮 bg-white/text-black、:68 CanvasTopBar 黑字随底、:74 SaveAsTemplateDialog 白卡——已核实；非 VideoCard 压媒体族），按同款 `{glob, allow:[...]}` 登记（allow 按 grep 出的实际属性族定）并**镜像进 canvas-migration-registry.json whitelistKeeps**（注释即归因）。BaseFullscreenModal 的 bg-black/60 已在白名单（:92，已核实）。序号角标零成本（§3.4）。
- **硬约束（plan 标红）**：斜杠透明度对 var() 色 token **零输出**（tailwind.config.ts:29-31 斜杠键全关 + `scripts/__tests__/tailwind-colors.test.ts:26-34` 配置侧 + `css-audit.mjs --slash-gate` 使用侧双钉死，已核实）——禁止写 `bg-overlay-2/50` 之类；半透明遮罩只能走 bg-black/N（黑不在 var 族）。
- 新增 overlay 不引入新 hex（no-color-hex 增量门禁，lint-gate.mjs）。

## 5. 数据模型（Prisma）

```prisma
model StyleCategory {
  id        String   @id @default(cuid())
  name      String   @unique
  sortOrder Int      @default(0)
  active    Boolean  @default(true)   // 仓内词汇：VideoCategory.active 先例
  createdAt DateTime @default(now())
  styles    Style[]
  @@index([active, sortOrder])        // VideoCategory:908 先例；全部 tab 按这两列排
}

model Style {
  id           String   @id @default(cuid())
  name         String
  category     StyleCategory @relation(fields: [categoryId], references: [id])
  categoryId   String
  coverKey     String                    // MinIO key；URL 读时 presign（D17）
  authorName   String?
  isCommercial Boolean  @default(false)
  promptText   String
  sortOrder    Int      @default(0)
  active       Boolean  @default(true)
  usageCount   Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  favorites    StyleFavorite[]
  recents      StyleRecentUsage[]
  // 拆两条（对齐先例 schema.prisma:896/:897 的分工）——单条 categoryId 打头时，默认「全部」tab（无 categoryId 等值）
  // 前导列无约束、索引无法满足 ORDER BY，最热查询反而不被覆盖：
  @@index([active, sortOrder, usageCount(sort: Desc), id])   // 默认视图排序（方向与 ORDER BY 逐列一致）
  @@index([categoryId, active])                              // 分类筛选（Prisma 不为 FK 自动建索引）
}

model StyleFavorite {
  id        String   @id @default(cuid())   // TeamMember:709 @id+@@unique 并存先例（42/42 模型有 @id）
  userId    String
  styleId   String
  createdAt DateTime @default(now())
  user      User   @relation(fields: [userId], references: [id])
  style     Style  @relation(fields: [styleId], references: [id], onDelete: Cascade)
  @@unique([userId, styleId])
  @@index([userId, createdAt])              // 收藏 tab 按收藏时间倒序
}

model StyleRecentUsage {
  id         String   @id @default(cuid())
  userId     String
  styleId    String
  lastUsedAt DateTime @default(now())
  user       User   @relation(fields: [userId], references: [id])
  style      Style  @relation(fields: [styleId], references: [id], onDelete: Cascade)
  @@unique([userId, styleId])
  @@index([userId, lastUsedAt])             // 最近 tab 按 lastUsedAt 倒序
}
```

- **User 补反向关系**（否则 prisma validate 直接失败——仓内教训 2026-08-29-default-team-personal-project-backend.md:60，且 42/42 模型双向零例外，已核实）：`styleFavorites StyleFavorite[]` + `styleRecentUsages StyleRecentUsage[]`。
- **onDelete: Cascade**（A2）：两个子表对 Style 为必需关系，Prisma 默认 Restrict——有人收藏/使用过则 DELETE 风格直接 FK 500；Cascade 使删除风格连带清收藏/最近记录（节点残留 styleId 由 B1 裁定忽略）。
- Migration：本地时间戳目录 + `migrate dev --name add-style-tables`（纯 DDL）；**分类种子进 `apps/api/prisma/seed.ts`**（upsert 幂等，prisma.seed 钩子已配，package.json:53-55 已核实；17 个 migration 零 INSERT 惯例）：9 个初始分类——摄影写真/电商营销/动漫游戏/风格插画/平面设计/建筑及室内设计/创意玩法/文创周边/小说推文（sortOrder 1..9，固定 id）。风格内容初始为空。

## 6. API 设计

全局契约（已核实）：TransformInterceptor 包 `{code, data, message}`（transform.interceptor.ts:23-27），前端 stylesApi 拆包；下表描述均为 **data 内**形状。分页惯例 `{items, total, page, pageSize}`（admin-video-work.controller.ts:58-59 clamp 先例）。

### 6.1 用户侧（modules/styles/styles.controller.ts，登录态自动生效——/api/styles 不在 AuthGuard PUBLIC_PREFIXES，已核实 auth.guard.ts:3-16）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/styles/categories` | active 分类，sortOrder asc |
| GET | `/api/styles?tab=all\|favorites\|recent&categoryId=&search=&commercialOnly=&page=1&pageSize=20` | all：active+筛选，`sortOrder asc, usageCount desc, id asc`（索引方向见 §5）；favorites：join 收藏、active 过滤，`createdAt desc, id desc`；recent：join 最近使用、active 过滤，`lastUsedAt desc, id desc`；search 匹配 name/authorName（contains, insensitive）。items 含 id/name/coverUrl(presign)/authorName/isCommercial/usageCount/favorited/promptText（**promptText 视为公开素材**，D23——详情与卡片同源免二次请求） |
| GET | `/api/styles/:id` | 单个（含 promptText+coverKey/coverUrl）；工具行圆图来源；**停用/不存在一律 404**（stylesApi 映射为「无风格」而非错误，§4.5） |
| POST | `/api/styles/:id/favorite` | body `{ favorited: boolean }` 显式目标态；`createMany skipDuplicates` / `deleteMany` 双幂等（D26）→ `{ favorited }` |
| POST | `/api/styles/:id/use` | **非事务三步**（D26 机制见 §4.4）：① findUnique 校验 active（否则 404）② create StyleRecentUsage（P2002→退化 update lastUsedAt）判 isFirstUse ③ 仅首次 `updateMany({ where: { id, active: true }, usageCount increment })` → **扁平 StyleListItem**（plan 审核口径统一：测试/实现/前端三方一致，非 `{ style }` 包装） |

- favorited 批量：列表查询后按当页 styleIds 一次 `findMany({ where: { styleId: { in: ids }, userId } })`，**禁止逐条 N+1**。

### 6.2 Admin 侧（modules/styles/admin-style-category.controller.ts + admin-style.controller.ts——功能域管理端长在功能模块内，home-banner/content/video-work 先例，已核实；`api/admin/` 前缀由全局 AdminGuard 自动守卫（admin.guard.ts:14-18），**无需 @Roles**；无全局 ValidationPipe，两个控制器类级挂 `@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))`——admin-home-banner.controller.ts:12 先例；取用户 `@Req() req: any → req.user.id`，仓内无 @CurrentUser 装饰器，已核实）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/style-categories` | 列表（含 inactive）/ 新建（name 唯一校验） |
| PUT/DELETE | `/api/admin/style-categories/:id` | 编辑；**删除时下有风格（含 inactive）→ 400 阻止**（裸 BadRequestException+中文 message，先例 **`modules/material-library/services/folder.service.ts:93-94`**「文件夹或其子文件夹中存在文件，请先清空后再删除」——已实读核实为删除保护真先例且有 spec 断言承保（folder.service.spec.ts:309/:324）；**写全路径防呆：仓内另有一个同名 `modules/folder/folder.service.ts`，其 :93-94 是序数消解非删除保护，第四轮审核误读即源于此**；同类 video-work deleteCategory 走 SetNull 不拦属刻意偏离——本表有 promptText 业务载荷，孤儿风格不可接受）。前端 Popconfirm 需展示后端 400 中文文案（错误信封 `{code:-1,data:null,message}`，http-exception.filter.ts:12-16） |
| GET | `/api/admin/styles?categoryId=&search=&page=` | 分页列表（全字段） |
| POST | `/api/admin/styles` | 新建；coverKey 由 `POST /api/admin/styles/upload-cover` 先传后提交（**admin-video-work.controller.ts:30-42 uploadCover 先例**：multer `@UploadedFile`→storage→返回 key，magic-number 校验在 service） |
| PUT/DELETE | `/api/admin/styles/:id` | 编辑 / 删除（Cascade 清收藏/最近，见 §5） |

## 7. 生成集成与快照（execution.service.ts + snapshot-filter）

### 7.1 注入点（两处，已核实不存在"三处分支"）

execution.service 只有一个共享 prompt 组装点 :75（textInput 亦用，**不动它**)；图片两类节点走 :164-174 兜底分支（imageExtGen 无独立分支）、视频走 :110-124 分支。风格注入两处：

```
// 兜底分支 callImageGen 前（:167）与 videoGen 分支（:112）：
const style = data.styleId ? await this.prisma.style.findUnique({ where: { id: data.styleId } }) : null;
const styleText = style?.active ? style.promptText : '';
const finalPrompt = [prompt, styleText].filter(Boolean).join(', ');   // 分隔符对齐 combinePrompt（api-caller.service.ts:86 现值）
```

- `finalPrompt` 分别替换两处的 prompt 入参；查不到/inactive → 忽略不阻塞（B1）。
- **批量查法直接采纳**（B19 升级）：收集本批节点 data.styleId → 一次 `findMany({ where: { id: { in: ids } } })` → Map 查表（validation.service.ts:29 同款先例），成本与逐节点 findUnique 相同量级。
- **视频分支顺手修**（触及即修，D28）：`callVideoGen({ prompt: prompt || vData?.prompt || '' })` 的 `vData?.prompt` 是 PromptValue 对象——面板 prompt 被清空后（data.prompt 仍为 `{text:'',html:''}` 对象）`'' || vData.prompt` 会把嵌套对象塞进请求体（api-caller :296,305 已核实直接 JSON.stringify）。修法：**删除该回退、直接传组装后的 finalPrompt**（§7.2 修法已在 :75 fallback 同源覆盖 `data?.prompt?.text`，此处回退是同值冗余）；「data.prompt 为空对象时不得序列化对象进请求体」用例保留承保 §7.2。原 B13 登记**删除**。
- **类型清单**：`ImageNodeData` **与** `VideoNodeData` 都加 `styleId?: string | null; styleName?: string`——真实理由是**读取侧**：VideoConfigPanel 渲染工具行选中态要读 `data.styleId`，字段必须在 VideoNodeData 上（联合 Partial 的 excess property check 并不拦跨成员属性，旧理由不成立已更正）。
- api-caller 不改；其既有 `style` 入参为**死参数**（callImageGen :237-286 从不读，已核实），保持原样并声明废弃（B10）。

### 7.2 面板 prompt 断链顺手接通（D12）

:75 fallback 链补 `data?.prompt?.text`：

```
const prompt = upstream.textContents.join(' ') || data?.prompt?.text || data?.content || '';
```

- 已核实全模块无 `data.prompt.text` 读取；ImageNodeData 无 content 字段、VideoNodeData.prompt 是 PromptValue 对象——此修只影响「无上游文本」的图片/视频节点（正是断链对象），textInput（prompt 为 string，`.text` 取值为 undefined）与 audioGen 不受影响。imageExt 的 prompt 也在根级（ImageExtConfigPanel.tsx:47/:168 经 updateConfig 写根级，已核实），三类节点全覆盖。
- **语义边界（D22/B21）**：`||` 回退链=上游文本优先——「有上游文本节点 + 面板也填了 prompt」时面板文本仍被忽略，**有意保持**，本轮不做合并（登记 B21，防后续误报 bug）。

### 7.3 快照/克隆白名单（snapshot-filter.util.ts:33-42，已核实会剥掉 styleId/styleName）

- `WHITELIST` 的 `imageGen / imageExtGen / videoGen` 三行补 `styleId, styleName`——否则发布作品/克隆项目后风格无声消失，且现有测试只做 **type 级**覆盖断言（snapshot-filter.util.spec.ts:154），漏字段全绿，须补 **field 级**全覆盖断言（新字段必须出现在白名单或显式登记为有意剥离）。
- 存量事实登记：`allImages` 本就不在白名单（上传参考图同样不存活于快照/克隆），本轮不修（B9）。

## 8. 管理后台

### 8.1 后端

`modules/styles/` 内两个 admin controller（§6.2；守卫/pipes/取用户约定见该节）+ styles.module 注册进 app.module。

### 8.2 前端

- AdminLayout 菜单新增「风格库」组（path `/admin/styles`）：**风格分类**（`/admin/styles/categories`）、**风格内容**（`/admin/styles/content`）两项——组 path 不得等于任何子页 path（antd Menu key 重复致选中态错乱；仓内既有组全部「组路径≠子路径」，已核实 AdminLayout.tsx:12-35，D27）；router.tsx admin 段子路由用相对路径（'styles/categories'、'styles/content'，对齐仓内 'subscription/plans' 惯例）。AdminLayout.test.tsx:19-20 为存在性循环、无组数断言——在循环数组补「风格库」+ 顺手改 :12 标题「4 组」文案（见 §9.2）。
- 风格分类页（ProTable + ModalForm，ModelsPage 模式）：列 名称/排序/启用/创建时间/操作（编辑、删除-Popconfirm）；表单 名称（必填唯一）、排序 InputNumber、启用 Switch。
- 风格内容页：列 封面缩略（presign）/名称/分类/作者/可商用/promptText 摘要（truncate+tooltip）/使用量/排序/启用/操作；表单 名称（必填）、分类 Select（必填）、**封面上传（必填）——admin 前端无通用上传组件，为页内 inline input（HomeBannersPage/VideoWorksPage 模式，已核实），先传 `/api/admin/styles/upload-cover` 拿 coverKey 再提交**、作者名（可选）、可商用 Switch、promptText TextArea（必填）、排序 InputNumber、启用 Switch。使用量只读。
- **筛选（D27）**：页顶自定义 antd Select（分类）+ Input（名称，防抖）过滤接进 ProTable request——**不启用 ProTable search 表单**（全仓 8 处 ProTable 均 `search={false}` 零先例，已核实；做 search 表单即开仓内首例，工作量与维护面不成比例）。

## 9. 测试策略（TDD，红-绿-重构）

### 9.1 门禁命令（已核实仓根无 vitest/tsc 脚本）

- 全量单测：`pnpm test`（turbo→web vitest run + api tsc+vitest）
- lint：`pnpm lint`（→web lint-gate.mjs：no-color-hex 增量 + **no-theme-utility（无 baseline 命中即违例，本次唯一会拦风格库卡片的规则）**）
- 斜杠门禁：`node scripts/css-audit.mjs --slash-gate`（cwd=apps/web）
- 类型/构建：`pnpm --filter @flowweb/web build`（含 tsc -b）；api 侧 `pnpm --filter @flowweb/api build`（包名为 @flowweb/* 全称，已核实 apps/*/package.json:2）
- 不涉及新增 token → 不跑 b0/contrast-table

### 9.2 既有测试改造清单（先红对象）

| 文件 | 改造 |
|---|---|
| ImageThumbnailBar.test.tsx | #2/#3 满 9 张隐藏语义（参考按钮恒显后改断言）；#7 file-input 存在性（删除）；#8/#10 顺序；#12 点击参考触发 startReferenceSelect（原：触发 input click）；#14 + 号 SVG 断言（换卡片选择图标） |
| SortableImageItem.test.tsx | `getByText('×')`（:65/:117）改角标两态断言（常态序号/hover 变 X） |
| AdminLayout.test.tsx | :19-20 是对四组文案的**存在性循环**（已核实，无组数断言——加组不会红）→ 在循环数组中补「风格库」新增断言；:12 标题「渲染 4 组…」顺手改文案（防标题变假话） |
| router.admin.test.tsx | :27-29 叶子路径按前缀白名单过滤（已核实）→ 过滤条件补 `startsWith('styles')` 且期望集合补 styles/categories、styles/content 两叶子——否则新子树静默失覆盖；**:5-13 逐页 vi.mock 补两条新页面**（import router 静态加载全部真实页面，新页顶层副作用会炸测试）；:24 标题「8 叶子路径」顺手改「10」 |
| execution.service.spec.ts | 手写 prisma mock（:27-30 仅 canvasProject/pricingRule，已核实）补 `style: { findMany: vi.fn() }`（批量查法，B19）——**为新用例铺路**（现有 fixture 无 styleId 短路不发查询、不会因缺键而红，因果已核实） |
| execution.service.nodeIds.spec.ts | :26-27 同款手写 mock（已核实），新用例落入这份 spec 时同补 style 键 |
| ~~HandleAddNodeMenu.test.tsx / menuStore.test.ts~~ | **移出先红清单、归入新增断言**（第四轮更正：既有断言不含 styleLibrary，扩展 store 不会红——与 execution.service.spec 同因果）——HandleAddNodeMenu.test.tsx:80 互斥用例补 openStyleLibrary 清两切片断言；menuStore.test.ts:5-7 beforeEach setState 补 `styleLibrary: null` 初值 |
| 旧 spec image-node-panel-redesign | §8 验收 5/6（参考=上传）声明失效（头部已注明） |

### 9.3 新增测试

- **前端 vitest**：
  - CanvasReferenceSelectBanner：渲染/两按钮/Esc/满员提示文案（role=status 在文案 span）；
  - 可选判定纯函数（类型守卫/fileId ?? referenceImage/自身排除/去重/满员/无图）+ nodeStore 模式状态、setActiveEditNodeId 联动退出、menuStore 三切片互斥 + toggle() 修复；
  - CanvasView 接线：referenceSelect 时 **nodesDraggable=false 且 elementsSelectable=false（D25 双 prop）**、onNodeClick 分支不调 selectNode、deleteKeyCode 置空、page.tsx CanvasKeyboardHandler 早退（Tab 不弹 AddNodeMenu，mock 层断言）；
  - SortableImageItem：index prop 序号、hovered 两态、X 点击删除回调、uploading 态角标可见；
  - StyleLibraryModal：tab 切换、分类/商用/搜索（防抖+竞态守卫）、卡片渲染（收藏态/当前使用态/商用徽章/使用量）、点卡=使用（updateConfig 调用+关窗）、**点收藏/详情不触发使用（stopPropagation）**、取消使用写 null、use 失败不关窗、加载更多、空态；
  - StyleDetailPreview：内容渲染 + 使用按钮 + 关闭走风格库 onClose 状态驱动（Esc/背板第一次关详情、第二次关库，D20）；
  - ImageThumbnailBar：风格按钮开弹窗、选中态按钮（封面+风格名，mock GET :id）；
  - stylesApi：信封拆包/参数/响应映射。
- **后端 vitest**：styles service（all/favorites/recent 查询口径与排序+id tiebreaker/favorited 批量/favorite 显式目标态幂等/use 事务+findUnique→create(P2002 转 update) 仅新建计数/inactive 过滤/404）；admin CRUD（分类删除阻止/名称唯一/upload-cover key 返回）；execution 风格拼接（有/无 styleId/inactive/空 prompt+风格文本/**批量 findMany 查表**）；execution prompt 断链接通（独立节点 data.prompt.text 进 prompt；**视频面板清空后 `vData?.prompt?.text` 不再传对象**——§7.1 顺手修用例）；snapshot-filter 三行白名单 + field 级全覆盖断言。

## 10. 边界与裁定登记

| # | 事项 | 裁定 |
|---|---|---|
| B1 | 删除/停用风格后节点残留 styleId | 生成时忽略；「当前使用」按 styleId 匹配（不在列表则无标记）；不做清理任务 |
| B2 | admin 修改 promptText | 下次生成即生效（后端现查，节点 data 只存 id+name） |
| B3 | 协作/撤销 | allImages 走 updatePromptImages、styleId/styleName 走 updateConfig——均经 syncStoreToDoc(LocalUser)（canvasCollabRuntime.ts:220-223）+ UndoManager trackedOrigins=local-user（canvasUndo.ts:15-18），已核实；UI 状态（referenceSelect/styleLibrary）为本地态不协作（storeProjection 只映射结构字段） |
| B4 | 点击 vs 拖拽 | React Flow `nodeClickDistance` 默认 0（拖动即吞 click，已核实 CanvasView 未设置该值）+ 模式期 nodesDraggable=false——不写自造阈值 |
| B5 | 上传可发现性下降 | D2 拍板接受：拖拽/粘贴保留；后续如需恢复入口另起需求 |
| B6 | white/black 工具类 | 角标零成本（同文件已白名单）；风格库两新组件按**反白 CTA/恒定面族**先例登记 2 条（§4.6 定稿，glob 按文件匹配）+ registry whitelistKeeps 镜像；不新增 token 不走 b0 |
| B7 | 浮层互斥范围 | menuStore 三切片（open/openHandleMenu/openStyleLibrary 各清其余）+ toggle() 顺手修；AddNodeMenu 无需提升（page.tsx:218 已消费 menuStore.isOpen——**已核实并反驳审核"需状态提升"断言**）；groupContextMenu 本地态不纳入 |
| B8 | 视频节点风格 | promptText 拼入视频生成 prompt（D6/D3） |
| B9 | 快照/克隆白名单 | imageGen/imageExtGen/videoGen 三行补 styleId/styleName + field 级全覆盖断言（§7.3）；allImages 存量被剥，登记不修 |
| B10 | `data.style` 死字段三概念并存 | 已核实：nodeStore.ts:259 默认注入 '写实'、execution:170 透传、api-caller 从不读（死参）、快照白名单却收录。**声明废弃**：永不参与生成，读取方一律只看 styleId；UI 不读它；不做迁移 |
| B11 | updateConfig 无删键语义 | 契约=「键存在、值 null」（D16）；补断言钉死 `data.styleId === null` 且执行侧/UI 真值判断兼容；mergeNodeData 删键语义不做（精准修改） |
| B12 | 并发写 allImages 丢更新 | updatePromptImages 整体替换数组，两人同加参考图后写覆盖前写——上传路径存量问题，选择模式放大；登记已知限制，本轮不修 |
| B14 | 画布选图不插 prompt chip | 与上传路径（onImageUploaded→insertImage）有意差异：chip=引用素材进 prompt 语义；登记 |
| B15 | 参考图对生成零影响 | 存量断链（D11）：allImages 全仓无读取 + HY-Image 无参考图入口；接通（含选型支持参考图的模型通道）留独立 spec |
| B16 | 无主图节点无工具行 | 面板门槛含**选中态+无主图**：ImageGenNode.tsx:1242 `isSingleSelected && … && !fileId && !referenceImage`；VideoGenNode.tsx:792 `!trimMode && selected && !fileId && !referenceVideo && !hdPanelOpen`（已核实勘误：视频用 referenceVideo）——验收前置=该节点**单选、配置面板可见、无主图**（已出图节点先「替换/重新生成」清空） |
| B17 | execution prisma 手写 mock | execution.service.spec.ts 与 execution.service.nodeIds.spec.ts 两份同款 mock 补 style 键（§9.2） |
| B18 | uploading/error 态角标 | 序号角标仍显示，z 高于进度/错误蒙层；与 hover 预览 portal（z-[9999]）同处右上，验收确认不打架 |
| B19 | 批量执行的 style 查询 | **已采纳批量查法**（§7.1）：收集 styleIds → findMany in → Map 查表（validation.service.ts:29 先例） |
| B20 | doc 写入先于执行 | 节点 data 新字段逐键镜像进 Yjs doc（canvasCollabRuntime.ts:111-120，已核实）；「用风格后立刻生成」依赖 doc 写入先于 sv 计算——同步事务，plan 确认一句即可 |
| B21 | 有上游文本时面板 prompt 被忽略 | `\|\|` 回退链=上游优先、面板弃用（D22）——有意保持，本轮不做合并；防后续误报 bug |
| B22 | 工具行顶部内边距布局影响 | 角标防裁切第二层=工具行 `pt-3`（12px，X 按钮 18px/半悬 9px 留余量；+12px 条高），影响 Image/ImageExt/Video 三面板布局——plan 首个 spike（连带 风格/参考 按钮垂直对齐，§3.4） |
| B23 | 嵌套浮层 a11y | 详情浮层 `role="group"`+aria-label，**不用 Modal role 也不加祖先 aria-hidden**（aria-hidden 祖先会把详情自身对 AT 隐藏、焦点落隐藏子树属 axe 违规——第四轮修正）；详情自带 scrim onClick（外层背板守卫不为它触发）+ 挂卡片根非滚动区；BaseFullscreenModal 只有初始聚焦+归还无焦点陷阱（与仓内其他模态一致，接受，勿读成 trap） |

## 11. 浏览器人工验收清单

前置：图片节点**单选、配置面板可见、无主图**（B16）；风格数据由 admin 预先录入（§8）。

1. 参考按钮（恒显，含满 9 张）→ 横幅出现（顶部居中、controls-bg/shadow、无 backdrop-filter）；点击其他图片节点 → 参考图追加+序号角标一半悬外（**不被工具行/缩略图容器裁切——pt 前提，B22 spike 通过**）；连续多选；仅上传过参考图的源节点（无 fileId）也可选中；
2. 模式期节点不可拖动、**点击目标节点后发起节点面板与序号仍可见（D25 elementsSelectable 生效——点一下就消失=失败）**、画布可平移缩放、Delete/Backspace/Ctrl+Z/**Tab（不弹 AddNodeMenu）** 不生效（Ctrl+0/Alt+Shift+F fitView 仍生效=已接受边界）；点发起节点自身/无图节点/视频节点无效；重复选同图去重；满 9 张横幅提示；空白点击不退出且不取消发起节点选中；
3. hover 参考图角标变 X → 点击删除；拖拽排序后序号跟随；uploading 态角标仍可见且与 hover 大图预览 portal 不视觉打架（B18）；
4. 「返回节点」滚动并选中发起节点、面板与序号可见（甲方案）；「退出」/Esc 纯退出；进入节点编辑/变换模式自动退出；
5. 拖拽/粘贴图片到工具行仍可上传（D2 保留路径）；
6. 风格按钮 → 风格库弹出（BaseFullscreenModal 背板/Esc/滚动锁/焦点恢复；**卡片宽度显式 w-[min(1600px,calc(100vw-64px))] 不塌宽**，D21）；全部/收藏/最近 三 tab、分类 chips、搜索（防抖、切条件结果即换无串台）、仅看可商用、「加载更多」翻页；卡片 hover 三按钮且点收藏/详情不触发使用；当前使用卡片白边+遮罩+徽章；
7. 使用风格 → 弹窗关闭、工具行按钮显示封面+风格名（刷新后仍在，GET :id+模块级缓存）；换风格覆盖；取消使用还原默认态；use 接口失败弹窗不关+错误文案；
8. **生成验证（D12 接通后）**：独立图片节点（无上游文本）只填面板 prompt → 生成日志/产物含面板文本；选风格后 → prompt 含「面板文本+风格 promptText」；视频节点同验（含面板清空场景不传对象）；无风格时 prompt 不多拼；**有上游文本节点时面板文本不参与（B21 有意）**；
9. 收藏 toggle 星标与「我的收藏」tab 同步；「最近使用」出现刚用风格（倒序）；admin 停用某风格后从各 tab 消失且使用报错；
10. 详情浮层展示大图+promptText，使用按钮可用；**Esc/背板第一次关详情、第二次关库（D20 状态驱动）**；无双层背板叠加变暗；
11. admin：分类增删改（删除保护 Popconfirm 展示 400 中文文案）、风格内容增删改（封面上传/必填校验）、删除有收藏的风格成功（Cascade）、前台即时可见；
12. 互斥矩阵：右键菜单/handle 菜单/风格库/参考选择两两互开互斥；Esc 优先级=详情>风格库>handle 菜单>右键菜单>参考横幅；协作另一端能看到参考图/风格名变更。

## 12. 审核裁定记录（摘要）

### 第二轮

- **采纳**：三份审核的全部事实性断言中，经逐条核实为真的均并入正文（Prisma 双向关系/@id/active/Cascade、coverKey+presign、prompt 组装点与断链、快照白名单、墓碑改 null、no-theme-utility 白名单定稿、斜杠硬约束、加载更多按钮、BaseFullscreenModal、usageCount 口径、竞态/失败分支、门禁命令勘误、既有测试清单、z-index/a11y 定值等）。
- **反驳**（1 条）：「AddNodeMenu 不在 menuStore、需状态提升」——page.tsx:218 其 isOpen 即 menuStore.isOpen，互斥只需三切片扩展。
- **修正细节**：onNodeClick 内为 activeEditNodeId 分支（非 isLocked 字面量，语义同源）；MultiImageConfigPanel 同名组件与 PromptEditor 路径归属勘误。
- **拍板**（D11-D19）：见 §1 第二轮表。

### 第三轮

- **采纳**（13 条批量断言核实 12 真 1 部分真）：Esc 状态驱动 onClose（D20）、卡片显式宽度（D21）、索引方向+categoryId 前缀（§5）、D14 机制（findUnique→create/P2002 转 update）+「N 人使用」文案（D24）、D15 理由改写（先例+简洁优先，非测试环境绑架）、视频 `vData?.prompt?.text` 同表达式顺手修（原 B13 删除）、工具行裁切第二层 pt+spike（B22）、§9.2 五项勘误/扩充（AdminLayout 存在性循环非组数、router.admin.test 白名单补 styles*、nodeIds.spec 同补 mock、补 mock 因果改正、HandleAddNodeMenu/menuStore.test 同步）、B19 升级为直接采纳、404 语义钉死、模块级 Map 缓存、类型清单双接口、白名单 2 条+反白 CTA 族归因（:67/:68/:74 先例）、角标边框走 token、--filter @flowweb/* 全称、fitView 快捷键接受边界、B16 勘误（:792/referenceVideo/选中态）、promptText 公开素材（D23）、B21/D22 上游优先登记、B23 嵌套 a11y。
- **驳回 1 条错误勘误**：第三份审核称「folder.service.ts:93-94 是重名去重循环、删除保护先例不存在、本 spec 属开先例」——**实读反驳**：:86-94 的 `remove()` 中 :93-94 恰为 `hasFiles → BadRequestException('文件夹或其子文件夹中存在文件，请先清空后再删除')`，即"删除前有子项 400 阻止"的真先例，v2 引用无误（重命名去重循环在 :98 之后，审核看串行）；"仓内无此先例"断言随之不成立。其附带建议（Popconfirm 展示 400 中文文案）仍采纳。第四轮根因确认：**仓内有两个同名 folder.service.ts**（modules/folder/ 那份 :93-94 才是序数消解），审核误读了另一份——引用已写全路径防呆（§6.2）。
- **矛盾裁决 1 条**：工具行外层裁切——第一份审核判"防裁切方案可行"，第二份以 CSS 规范论证 `overflow-x:auto` 使 `overflow-y:visible` 计算值变 auto、外层工具行必然两轴裁切。**采第二份**（第一份只核了 dnd-kit ref 语义，不完整）：补工具行顶部内边距 + plan 首个 spike（B22）。

### 第四轮

- **采纳（全部经核实）**：① D25 甲方案补 `elementsSelectable`（isSingleSelected 读 RF selected 已核实 useIsSingleSelected.ts:14-21，CanvasView:436 elementsSelectable={!isLocked} 现状——只关 nodesDraggable 面板会被 RF 内部点击选中卸载）；② Tab 键 gate（page.tsx:341-346 Tab→menuStore.open 已实读核实，:337 视频编辑器全禁先例）+ 反向互斥落点（menuStore 三 open 跨 store 调 exitReferenceSelect）；③ D26 D14 非事务三步（PG aborted 25P02 无 savepoint，事务内 catch P2002 必炸）+ favorite createMany skipDuplicates/deleteMany 双幂等；④ 索引拆两条（categoryId 打头覆盖不了默认视图 ORDER BY，对齐 :896/:897 分工先例）；⑤ admin 路由 `/admin/styles/content`（组 path≠子页 path，AdminLayout.tsx:12-35 惯例已核实）+ 筛选改页顶自定义控件（ProTable search 全仓 8 处 search={false} 零先例已核实）；⑥ 收藏/最近补 id tiebreaker；⑦ 缓存 {styleName, coverKey} 不缓存 presign URL；⑧ router.admin.test 补 2 条 vi.mock + 两处测试标题顺手改；⑨ HandleAddNodeMenu/menuStore.test 移出先红归新增断言（因果更正）；⑩ 类型理由改写（读取侧）；⑪ B23 去 aria-hidden 改 role="group"（aria-hidden 祖先会把详情自身对 AT 隐藏+axe 违规）；⑫ 详情层自带 scrim onClick（:71-73 e.target 守卫已核实）+ 挂卡片根非滚动区；⑬ pt-3（X 按钮 18px 实核，pt-2.5 仅 1px 余量）。
- **两审核分歧裁决 1 条**（D28）：视频 `vData?.prompt?.text` 回退——一方称保留+补用例、一方称同源冗余当删。**采删除**：§7.2 已在 :75 同源覆盖 data?.prompt?.text，回退永不会命中非冗余值；「空对象不序列化进请求体」用例保留承保 §7.2 修法。
- 各方对 v3 驳回（folder.service）与裁切矛盾裁决均确认成立。


