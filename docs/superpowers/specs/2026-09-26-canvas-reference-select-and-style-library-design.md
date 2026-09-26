# Canvas 参考选择模式与风格库 — 设计 Spec

日期：2026-09-26
状态：v2（第二轮审核修订——三份外部审核意见逐条核实后改写；事实断言均标「已核实」+行号）
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
| D15 | 弹窗外壳与滚动 | 外壳复用 **BaseFullscreenModal**（已核实 BaseFullscreenModal.tsx:28-64：body portal、z-[100000]、bg-black/60 背板、背板点击关闭、滚动锁、焦点恢复、Esc 全齐，4 个既有消费方）；滚动加载用**「加载更多」按钮**（IntersectionObserver 全仓零先例且 test-setup.ts:3 未 mock，jsdom 直接崩——已核实仓内加载更多先例为按钮式） |
| D16 | 取消使用的写值 | 写 **`null`**（`styleId?: string \| null`），弃 undefined（mergeNodeData 无删键语义，nodeStore.ts:269-271 已核实仅 `merged[key]=value`；null 可过 JSON 往返，undefined 会丢键） |
| D17 | 封面存储 | `coverKey`（MinIO key）+ 读时 presign（已核实：admin-home-banner.controller.ts:65 返回 `{imageKey}`、home-banner.service.ts:35 `generatePresignedGetUrl(key, 3600)`，桶非公开读，存直链 1h 全裂）；上传先例=**admin-video-work.controller.ts:30-42 uploadCover**（banner 方法名是 upload） |
| D18 | 命名对齐仓内 | `enabled`→**`active`**（VideoCategory schema.prisma:903 先例）+ `@@index([active, sortOrder])`（:908 先例）；join 表补 `id @id @default(cuid())` + `@@unique` 并存（TeamMember :709/:717 先例，全仓 42/42 模型有 @id）；种子进 **seed.ts upsert**（17 个 migration 零 INSERT，已核实）而非 migration SQL |
| D19 | 模式期交互 | 参考选择期新开独立标志**只喂 `nodesDraggable={false}`**（不复用 isLocked——CanvasView.tsx:431-436 已核实它同时关 pan/zoom/focusable，参考选择时必须能平移缩放）；点击/拖拽区分靠 React Flow 默认 `nodeClickDistance=0`（拖动即吞 click，CanvasView 从未设置该值，已核实），**不写自造位移阈值**；满 9 张时参考按钮**恒显**（脱离 showUploadButton 门控，语义已从上传变为模式入口） |

## 2. 架构总览

```
┌─ web 前端 ────────────────────────────────────────────────┐
│ ImageThumbnailBar（入口改造：参考=模式入口恒显，风格=开库） │
│   ├ 参考按钮 → nodeStore.referenceSelect（画布选择模式）    │
│   └ 风格按钮 → menuStore.styleLibrary（风格库，三切片互斥） │
│ CanvasReferenceSelectBanner（新，CanvasView 内横幅）        │
│ StyleLibraryModal（新，BaseFullscreenModal 外壳+居中卡片） │
│ StyleDetailPreview（新，详情浮层 z-[100001]）              │
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
- 模式退出挂点（store 层，已核实归属）：`nodeStore.setActiveEditNodeId / setActiveTransformNodeId`（:360-372 互相 guard-return）开头调用 `exitReferenceSelect()`——进入节点编辑/变换模式自动退出选择模式；不用组件 effect 轮询。
- 快捷键 gate（已核实现状）：`referenceSelect` 非空时并入 `useGroupKeyboard.ts:5-22 isGroupEditContext` 早退条件；`CanvasView deleteKeyCode`（:425 `editorOpen ? [] : ['Backspace','Delete']`）在参考模式下同样置 `[]`——模式期间 Delete/Backspace/Ctrl+Z 等画布快捷键不生效。

### 3.2 顶部横幅（CanvasReferenceSelectBanner，新组件）

- 渲染于 CanvasView 内、ReactFlow 直接子级（CanvasToolbar 模式：absolute 顶部居中、z-10~50 档、不随 viewport 变换——已核实 CanvasToolbar.tsx:51 同款）。
- 结构对标参考 DOM：`[图标盒(卡片选择自绘 SVG)] [文案] [返回节点] [退出]`；**`role="status"` 放在文案 span 上**（满员提示需播报；整条含按钮的容器不做 live region）。
- 样式：`--canvas-controls-bg` 底 + `--canvas-controls-border` 边 + `--canvas-shadow-dropdown`（已核实 index.css 仅 menu/dropdown 两个 shadow token，L52-53/L96-97 深浅双档）；不写 `backdrop-filter`（controls-bg 为不透明单值，blur 无视觉效果——ProjectTitle.tsx:64 同款接受）；两个按钮 ghost 文本按钮（hover `bg-overlay-2`）。
- 满员提示：达 9 张后再点节点，文案 span 短暂显示「最多 9 张参考图」（2s 还原）。

### 3.3 选择行为与约束

- 模式期 CanvasView：`nodesDraggable={referenceSelect ? false : !isLocked}`（独立条件，不动 isLocked 其他用途）；点击入口=现有 `onNodeClick`（CanvasView.tsx:200-209，注册 :420，已核实内为 activeEditNodeId 分支先例）新增 referenceSelect 分支——**不调用 selectNode**（保持发起节点选中态，面板与序号实时可见；甲方案）。
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

### 3.4 序号/X 角标（SortableImageItem 改造——指名 `prompt-input/SortableImageItem.tsx`；MultiImageConfigPanel.tsx:44 有同名局部组件**不动**，已核实）

- 组件新增 `index?: number` prop（序号由 ImageThumbnailBar 按 allImages 顺序传入，拖拽排序后自动跟随；组件自身无位置信息，已核实 props 仅 image/onDelete/onClick）。
- 角标：圆形小徽章，定位在缩略图容器右上角、一半悬外（`absolute` 角点 + 横向 50% 外移）。**防裁切**（已核实容器 w-[50px] h-[50px] overflow-hidden + 工具行 overflow-x-auto 双重裁切）：把 `overflow-hidden` 从角标所在的外层容器**下移到内层图片裁切容器**（保留圆角裁切），角标挂在外层 relative 容器上；不破坏 9999 层预览 portal（已核实走 createPortal 不受影响）。
- 两态：常态显示序号；hover 显示 X。**hover 状态源复用组件既有本地 `hovered`**（:67/:88-103 原生 mouseover/out——刻意绕过 dnd-kit 事件干扰，已核实），不用 group-hover 新开一套。
- uploading/error 态（进度/错误蒙层 absolute inset-0，:26-40）时角标**仍显示**，z 序高于蒙层（B18）。
- 点击 X = 现有删除逻辑（handleDeleteImage → deleteImage 仅删引用不删服务端，useImageUpload.ts:174-179 已核实）。
- 白名单零成本：该文件已在 no-theme-utility.js:52 白名单（allow:['bg','text']），同文件同属性族改两态角标无需动白名单（已核实）。

## 4. 功能块 B：风格库弹窗

### 4.1 打开/关闭与互斥

- `menuStore` 新增第三切片 `styleLibrary: { nodeId: string } | null` + `openStyleLibrary(nodeId)` / `closeStyleLibrary()`；**三切片互斥**：`open` / `openHandleMenu` / `openStyleLibrary` 各自打开时清其余两个；顺手修既有缺陷 `toggle()`（:38，现不清 handleMenu——已核实）。
- **不需要** AddNodeMenu 状态提升（已核实并反驳审核断言：page.tsx:218 AddNodeMenu 的 `isOpen` 本就来自 `useMenuStore(s => s.isOpen)`，右键菜单与它共享该切片）；groupContextMenu（CanvasView 本地态）不纳入本轮——风格库背板天然阻断，互斥范围= menuStore 三切片 + referenceSelect（nodeStore，进入任一清对方）。
- 风格按钮（Image/ImageExt/Video 三面板共享）onClick → `openStyleLibrary(nodeId)`。
- 关闭：背板点击 / 右上关闭按钮 / Esc（Esc 由 BaseFullscreenModal 内建）。
- 挂载点：page.tsx:308-309 AddNodeMenu/HandleAddNodeMenu 旁并列挂 `<StyleLibraryModal />`。

### 4.2 布局

```
BaseFullscreenModal 外壳（body portal、z-[100000]、bg-black/60 背板、Esc/滚动锁/焦点恢复全内建）
└─ 居中卡片：max-w-[1600px]，高 min(calc(100vh−160px), 1200px)，圆角 12px，
   bg var(--canvas-controls-bg) + 0.5px border var(--canvas-controls-border) + var(--canvas-shadow-dropdown)
   ├─ 行1（h-10）：[全部|我的收藏|最近使用]（分段控件） [搜索框 336px] …… [关闭×]
   ├─ 分隔线（var(--canvas-controls-border)）
   ├─ 行2：分类 chips 横向滚动 + 右缘渐隐（不做下拉箭头，简洁优先） … [仅看可商用]
   └─ 主体：5 列网格（column-gap 12px，纵向滚动，左右 padding 16px）+ 底部「加载更多」按钮（20 条/页）
```

- tab：选中 `bg-overlay-2` + `text-text`；未选 `text-text-dim-2` + hover `bg-overlay-2`。
- 搜索框：`bg-overlay-2` 底，focus 边框品牌色 token；防抖 300ms，匹配名称+作者名。
- 「仅看可商用」默认不勾选；收藏/最近 tab 下分类行与商用筛选隐藏（无意义维度）。
- 「全部」chips = 默认视图：全部 active 风格，`sortOrder asc, usageCount desc, id asc`（id 兜底 tiebreaker——usageCount 会变，偏移分页需稳定序防重复/漏项，D10）。
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
  - 行2：作者（占位圆点头像+作者名）+ 使用量（dim 色）。

### 4.4 交互语义

- **使用**：`POST /api/styles/:id/use` 成功后 `updateConfig(nodeId, { styleId, styleName })` → **关闭弹窗**；**失败弹窗不关**，列表顶部内联错误文案（不引入 toast 通道）。
- **取消使用**：`updateConfig(nodeId, { styleId: null, styleName: null })`——**写 null 不写 undefined**（D16：mergeNodeData 无删键语义已核实 nodeStore.ts:269-271，null 可过 JSON/Yjs 往返且真值判断消费方全部兼容；契约=「键存在、值 null」，测试钉死）；弹窗不关。
- **收藏 toggle**：请求体显式 `{ favorited: boolean }`（客户端已知当前态，幂等，免疫连点 P2002）。
- **usageCount 口径**：仅 StyleRecentUsage upsert 新建时 `increment: 1`（D14，=使用人数）。
- **详情预览**（StyleDetailPreview，新组件）：挂 body `z-[100001]` 居中小浮层（同 token 自绘）：大封面（3:4）+ 名称 + 作者 + 可商用徽章 + promptText 全文（可滚）+「使用」按钮；背板点击/Esc 关闭回到风格库（风格库不关）。
- **空态**：收藏空「暂无收藏的风格」/ 最近空「暂无使用记录」/ 搜索或筛选无结果「未找到匹配风格」。
- 已收藏但被 admin 停用的风格：收藏/最近 tab 查询过滤 active，不显示。

### 4.5 工具行风格按钮选中态

- 节点 data 有 `styleId` 时：按钮上部显示风格封面小圆图、下部显示 `styleName`（truncate）。
- 刷新后圆图来源：`GET /api/styles/:id` 惰性拉取（组件内按 styleId 请求一次并缓存于组件态；404/停用则回退默认「风格」样式）。
- 点击行为不变（打开风格库）。

### 4.6 token 与门禁（定稿）

- **不新增任何 token、不走 b0/contrast/registry 变更登记管道**——所依赖 token 全部现成（已核实 index.css 深浅双档齐备）：`--canvas-controls-bg`（:38/:82）、`--canvas-controls-border`（:39/:83）、`--canvas-shadow-dropdown`（:53/:97）、`--fw-overlay-2/3`（:32-33/:76-77）、text 族 `text-text/text-text-dim-1/2/3`（**无裸 `text-text-dim`**，tailwind.config.ts:35-39 已核实，写错=静默零输出）。
- 参考代码硬编码色换算：`#F7F7F7→text-text`、`#919191/#A8A8A8→text-text-dim-2/dim-1`、`bg-canvas-controls-hover→bg-overlay-2`、`hover:bg-btn-ghost-hover→hover:bg-overlay-3`。
- **白名单登记（仅 1 条新条目）**：风格库新组件的封面遮罩/渐变/「当前使用」徽章（bg-black/50、bg-white、text-black、border-white、from-black/to-black）命中 no-theme-utility（无 baseline、命中即违例，已核实）；按 **VideoCard 压媒体先例**（registry whitelistKeeps 已有 `allow:['bg','text']`、归因「时长胶囊压封面」）登记同款 `{glob, allow:[...]}`（allow 按 grep 出的实际属性族定）并**镜像进 canvas-migration-registry.json whitelistKeeps**。BaseFullscreenModal 的 bg-black/60 已在白名单（:92，已核实）。序号角标零成本（§3.4）。
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
  @@index([active, sortOrder, usageCount, id])   // 广场排序键（含 id tiebreaker）
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
| GET | `/api/styles?tab=all\|favorites\|recent&categoryId=&search=&commercialOnly=&page=1&pageSize=20` | all：active+筛选，`sortOrder asc, usageCount desc, id asc`；favorites：join 收藏、active 过滤，createdAt 倒序；recent：join 最近使用、active 过滤，lastUsedAt 倒序；search 匹配 name/authorName（contains, insensitive）。items 含 id/name/coverUrl(presign)/authorName/isCommercial/usageCount/favorited/promptText（详情与卡片同源，免二次请求） |
| GET | `/api/styles/:id` | 单个（含 promptText+presign coverUrl）；工具行圆图刷新后来源；404/停用返回 null data |
| POST | `/api/styles/:id/favorite` | body `{ favorited: boolean }` 显式目标态（幂等，免疫连点撞唯一索引）→ `{ favorited }` |
| POST | `/api/styles/:id/use` | 事务内：upsert StyleRecentUsage，**仅新建时** `usageCount: { increment: 1 }`（D14）→ `{ style }`；仅 active 风格可用 |

- favorited 批量：列表查询后按当页 styleIds 一次 `findMany({ where: { styleId: { in: ids }, userId } })`，**禁止逐条 N+1**。

### 6.2 Admin 侧（modules/styles/admin-style-category.controller.ts + admin-style.controller.ts——功能域管理端长在功能模块内，home-banner/content/video-work 先例，已核实；`api/admin/` 前缀由全局 AdminGuard 自动守卫（admin.guard.ts:14-18），**无需 @Roles**；无全局 ValidationPipe，两个控制器类级挂 `@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))`——admin-home-banner.controller.ts:12 先例；取用户 `@Req() req: any → req.user.id`，仓内无 @CurrentUser 装饰器，已核实）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/style-categories` | 列表（含 inactive）/ 新建（name 唯一校验） |
| PUT/DELETE | `/api/admin/style-categories/:id` | 编辑；**删除时下有风格（含 inactive）→ 400 阻止**（裸 BadRequestException+中文 message，folder.service.ts:93-94 先例；同类 video-work deleteCategory 走 SetNull 不拦属刻意偏离——本表有 promptText 业务载荷，孤儿风格不可接受） |
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
- api-caller 不改；其既有 `style` 入参为**死参数**（callImageGen :237-286 从不读，已核实），保持原样并声明废弃（B10）。

### 7.2 面板 prompt 断链顺手接通（D12）

:75 fallback 链补 `data?.prompt?.text`：

```
const prompt = upstream.textContents.join(' ') || data?.prompt?.text || data?.content || '';
```

- 已核实全模块无 `data.prompt.text` 读取；ImageNodeData 无 content 字段、VideoNodeData.prompt 是 PromptValue 对象——此修只影响「无上游文本」的图片/视频节点（正是断链对象），textInput（prompt 为 string，`.text` 取值为 undefined）与 audioGen 不受影响。
- 视频 `callVideoGen({ prompt: finalPrompt || vData?.prompt ... })` 的对象回退存量隐患（`[object Object]`）登记 B13 不另修（接通后该 fallback 实际不再触发）。

### 7.3 快照/克隆白名单（snapshot-filter.util.ts:33-42，已核实会剥掉 styleId/styleName）

- `WHITELIST` 的 `imageGen / imageExtGen / videoGen` 三行补 `styleId, styleName`——否则发布作品/克隆项目后风格无声消失，且现有测试只做 **type 级**覆盖断言（snapshot-filter.util.spec.ts:154），漏字段全绿，须补 **field 级**全覆盖断言（新字段必须出现在白名单或显式登记为有意剥离）。
- 存量事实登记：`allImages` 本就不在白名单（上传参考图同样不存活于快照/克隆），本轮不修（B9）。

## 8. 管理后台

### 8.1 后端

`modules/styles/` 内两个 admin controller（§6.2；守卫/pipes/取用户约定见该节）+ styles.module 注册进 app.module。

### 8.2 前端

- AdminLayout 菜单新增「风格库」组：**风格分类**、**风格内容**两项（AdminLayout.test.tsx:12 断言一级菜单组数 4→5，列入 §9 既有测试改造）；router.tsx admin 段注册 `/admin/styles/categories`、`/admin/styles`。
- 风格分类页（ProTable + ModalForm，ModelsPage 模式）：列 名称/排序/启用/创建时间/操作（编辑、删除-Popconfirm）；表单 名称（必填唯一）、排序 InputNumber、启用 Switch。
- 风格内容页：列 封面缩略（presign）/名称/分类/作者/可商用/promptText 摘要（truncate+tooltip）/使用量/排序/启用/操作；表单 名称（必填）、分类 Select（必填）、**封面上传（必填）——admin 前端无通用上传组件，为页内 inline input（HomeBannersPage/VideoWorksPage 模式，已核实），先传 `/api/admin/styles/upload-cover` 拿 coverKey 再提交**、作者名（可选）、可商用 Switch、promptText TextArea（必填）、排序 InputNumber、启用 Switch。使用量只读。
- 分类筛选下拉 + 名称搜索（ProTable 标准能力）。

## 9. 测试策略（TDD，红-绿-重构）

### 9.1 门禁命令（已核实仓根无 vitest/tsc 脚本）

- 全量单测：`pnpm test`（turbo→web vitest run + api tsc+vitest）
- lint：`pnpm lint`（→web lint-gate.mjs：no-color-hex 增量 + **no-theme-utility（无 baseline 命中即违例，本次唯一会拦风格库卡片的规则）**）
- 斜杠门禁：`node scripts/css-audit.mjs --slash-gate`（cwd=apps/web）
- 类型/构建：`pnpm --filter web build`（含 tsc -b）；api 侧 `pnpm --filter api build`
- 不涉及新增 token → 不跑 b0/contrast-table

### 9.2 既有测试改造清单（先红对象）

| 文件 | 改造 |
|---|---|
| ImageThumbnailBar.test.tsx | #2/#3 满 9 张隐藏语义（参考按钮恒显后改断言）；#7 file-input 存在性（删除）；#8/#10 顺序；#12 点击参考触发 startReferenceSelect（原：触发 input click）；#14 + 号 SVG 断言（换卡片选择图标） |
| SortableImageItem.test.tsx | `getByText('×')`（:65/:117）改角标两态断言（常态序号/hover 变 X） |
| AdminLayout.test.tsx:12 | 一级菜单组数 4→5 |
| execution.service.spec.ts | 手写 prisma mock（:27-30 仅 canvasProject/pricingRule，已核实）补 `style: { findUnique: vi.fn() }`，否则新查询直接抛 |
| 旧 spec image-node-panel-redesign | §8 验收 5/6（参考=上传）声明失效（头部已注明） |

### 9.3 新增测试

- **前端 vitest**：
  - CanvasReferenceSelectBanner：渲染/两按钮/Esc/满员提示文案（role=status 在文案 span）；
  - 可选判定纯函数（类型守卫/fileId ?? referenceImage/自身排除/去重/满员/无图）+ nodeStore 模式状态、setActiveEditNodeId 联动退出、menuStore 三切片互斥 + toggle() 修复；
  - CanvasView 接线：referenceSelect 时 nodesDraggable=false、onNodeClick 分支不调 selectNode、deleteKeyCode 置空（mock 层断言 props）；
  - SortableImageItem：index prop 序号、hovered 两态、X 点击删除回调、uploading 态角标可见；
  - StyleLibraryModal：tab 切换、分类/商用/搜索（防抖+竞态守卫）、卡片渲染（收藏态/当前使用态/商用徽章/使用量）、点卡=使用（updateConfig 调用+关窗）、**点收藏/详情不触发使用（stopPropagation）**、取消使用写 null、use 失败不关窗、加载更多、空态；
  - StyleDetailPreview：内容渲染 + 使用按钮 + Esc/背板关闭；
  - ImageThumbnailBar：风格按钮开弹窗、选中态按钮（封面+风格名，mock GET :id）；
  - stylesApi：信封拆包/参数/响应映射。
- **后端 vitest**：styles service（all/favorites/recent 查询口径与排序+id tiebreaker/favorited 批量/favorite 显式目标态幂等/use 事务+仅新建计数/inactive 过滤/404）；admin CRUD（分类删除阻止/名称唯一/upload-cover key 返回）；execution 风格拼接（有/无 styleId/inactive/空 prompt+风格文本）；execution prompt 断链接通（独立节点 data.prompt.text 进 prompt）；snapshot-filter 三行白名单 + field 级全覆盖断言。

## 10. 边界与裁定登记

| # | 事项 | 裁定 |
|---|---|---|
| B1 | 删除/停用风格后节点残留 styleId | 生成时忽略；「当前使用」按 styleId 匹配（不在列表则无标记）；不做清理任务 |
| B2 | admin 修改 promptText | 下次生成即生效（后端现查，节点 data 只存 id+name） |
| B3 | 协作/撤销 | allImages 走 updatePromptImages、styleId/styleName 走 updateConfig——均经 syncStoreToDoc(LocalUser)（canvasCollabRuntime.ts:220-223）+ UndoManager trackedOrigins=local-user（canvasUndo.ts:15-18），已核实；UI 状态（referenceSelect/styleLibrary）为本地态不协作（storeProjection 只映射结构字段） |
| B4 | 点击 vs 拖拽 | React Flow `nodeClickDistance` 默认 0（拖动即吞 click，已核实 CanvasView 未设置该值）+ 模式期 nodesDraggable=false——不写自造阈值 |
| B5 | 上传可发现性下降 | D2 拍板接受：拖拽/粘贴保留；后续如需恢复入口另起需求 |
| B6 | white/black 工具类 | 角标零成本（同文件已白名单）；风格库按 VideoCard 压媒体先例登记 1 条 + registry whitelistKeeps 镜像；不新增 token 不走 b0（§4.6 定稿） |
| B7 | 浮层互斥范围 | menuStore 三切片（open/openHandleMenu/openStyleLibrary 各清其余）+ toggle() 顺手修；AddNodeMenu 无需提升（page.tsx:218 已消费 menuStore.isOpen——**已核实并反驳审核"需状态提升"断言**）；groupContextMenu 本地态不纳入 |
| B8 | 视频节点风格 | promptText 拼入视频生成 prompt（D6/D3） |
| B9 | 快照/克隆白名单 | imageGen/imageExtGen/videoGen 三行补 styleId/styleName + field 级全覆盖断言（§7.3）；allImages 存量被剥，登记不修 |
| B10 | `data.style` 死字段三概念并存 | 已核实：nodeStore.ts:259 默认注入 '写实'、execution:170 透传、api-caller 从不读（死参）、快照白名单却收录。**声明废弃**：永不参与生成，读取方一律只看 styleId；UI 不读它；不做迁移 |
| B11 | updateConfig 无删键语义 | 契约=「键存在、值 null」（D16）；补断言钉死 `data.styleId === null` 且执行侧/UI 真值判断兼容；mergeNodeData 删键语义不做（精准修改） |
| B12 | 并发写 allImages 丢更新 | updatePromptImages 整体替换数组，两人同加参考图后写覆盖前写——上传路径存量问题，选择模式放大；登记已知限制，本轮不修 |
| B13 | 视频 prompt 对象回退 | execution:113 `vData?.prompt` 为 PromptValue 对象（`[object Object]` 隐患），存量；D12 接通后实际不再触发，登记不另修 |
| B14 | 画布选图不插 prompt chip | 与上传路径（onImageUploaded→insertImage）有意差异：chip=引用素材进 prompt 语义；登记 |
| B15 | 参考图对生成零影响 | 存量断链（D11）：allImages 全仓无读取 + HY-Image 无参考图入口；接通（含选型支持参考图的模型通道）留独立 spec |
| B16 | 无主图节点无工具行 | 面板门槛 `!fileId && !referenceImage`（ImageGenNode.tsx:1242/VideoGenNode.tsx:791，已核实）——已出图节点先「替换/重新生成」清空主图才能见工具行；验收前置步骤 |
| B17 | execution prisma 手写 mock | 补 style.findUnique 键（§9.2） |
| B18 | uploading/error 态角标 | 序号角标仍显示，z 高于进度/错误蒙层 |
| B19 | 批量执行的 style 查询 | 逐节点 findUnique（N 节点 N 查）；validation.service.ts:29 有批量 `findMany({id:{in}})` 先例，plan 可选优化，不强制 |
| B20 | doc 写入先于执行 | 节点 data 新字段逐键镜像进 Yjs doc（canvasCollabRuntime.ts:111-120，已核实）；「用风格后立刻生成」依赖 doc 写入先于 sv 计算——同步事务，plan 确认一句即可 |

## 11. 浏览器人工验收清单

前置：图片节点需无主图（B16）；风格数据由 admin 预先录入（§8）。

1. 参考按钮（恒显，含满 9 张）→ 横幅出现（顶部居中、controls-bg/shadow、无 backdrop-filter）；点击其他图片节点 → 参考图追加+序号角标一半悬外；连续多选；仅上传过参考图的源节点（无 fileId）也可选中；
2. 模式期节点不可拖动、画布可平移缩放、Delete/Backspace/Ctrl+Z 不生效；点发起节点自身/无图节点/视频节点无效；重复选同图去重；满 9 张横幅提示；空白点击不退出；
3. hover 参考图角标变 X → 点击删除；拖拽排序后序号跟随；uploading 态角标仍可见；
4. 「返回节点」滚动并选中发起节点、面板与序号可见（甲方案）；「退出」/Esc 纯退出；进入节点编辑/变换模式自动退出；
5. 拖拽/粘贴图片到工具行仍可上传（D2 保留路径）；
6. 风格按钮 → 风格库弹出（BaseFullscreenModal 背板/Esc/滚动锁/焦点恢复）；全部/收藏/最近 三 tab、分类 chips、搜索（防抖、切条件结果即换无串台）、仅看可商用、「加载更多」翻页；卡片 hover 三按钮且点收藏/详情不触发使用；当前使用卡片白边+遮罩+徽章；
7. 使用风格 → 弹窗关闭、工具行按钮显示封面+风格名（刷新后仍在，GET :id 惰性拉取）；换风格覆盖；取消使用还原默认态；use 接口失败弹窗不关+错误文案；
8. **生成验证（D12 接通后）**：独立图片节点（无上游文本）只填面板 prompt → 生成日志/产物含面板文本；选风格后 → prompt 含「面板文本+风格 promptText」；视频节点同验；无风格时 prompt 不多拼；
9. 收藏 toggle 星标与「我的收藏」tab 同步；「最近使用」出现刚用风格（倒序）；admin 停用某风格后从各 tab 消失且使用报错；
10. 详情浮层展示大图+promptText，使用按钮可用，关闭回风格库（风格库未关）；
11. admin：分类增删改（删除保护）、风格内容增删改（封面上传/必填校验）、删除有收藏的风格成功（Cascade）、前台即时可见；
12. 互斥矩阵：右键菜单/handle 菜单/风格库/参考选择两两互开互斥；Esc 优先级=详情浮层>风格库>handle 菜单>右键菜单>参考横幅；协作另一端能看到参考图/风格名变更。

## 12. 第二轮审核裁定记录（摘要）

- **采纳**：三份审核的全部事实性断言中，经逐条核实为真的均并入正文（Prisma 双向关系/@id/active/Cascade、coverKey+presign、prompt 组装点与断链、快照白名单、墓碑改 null、no-theme-utility 白名单定稿、斜杠硬约束、加载更多按钮、BaseFullscreenModal、usageCount 口径、竞态/失败分支、门禁命令勘误、既有测试清单、z-index/a11y 定值等）。
- **反驳**（1 条）：「AddNodeMenu 不在 menuStore、需状态提升」——page.tsx:218 其 isOpen 即 menuStore.isOpen，互斥只需三切片扩展。
- **修正细节**：onNodeClick 内为 activeEditNodeId 分支（非 isLocked 字面量，语义同源）；MultiImageConfigPanel 同名组件与 PromptEditor 路径归属勘误。
- **拍板**（D11-D19）：见 §1 第二轮表。


