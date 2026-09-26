# Canvas 参考选择模式与风格库 — 设计 Spec

日期：2026-09-26
状态：已确认（三段设计均经用户逐段确认）
关联：`2026-09-26-image-node-panel-redesign.md`（工具行 风格/参考 按钮为本次落地的入口；其 §7-4「风格按钮仅外观」拍板自本文起失效）

---

## 0. 背景与目标

图片节点工具行（ImageThumbnailBar）的 风格 / 参考 两按钮此前仅占位或承担文件上传。本次：

1. **参考按钮** → 进入「从画布选择参考」模式：画布顶部弹出横幅，点击画布上其他图片节点即把该节点主图加为参考图（带序号角标，hover 变 X 删除）。
2. **风格按钮** → 弹出风格库（自绘 overlay）：风格广场/我的收藏/最近使用 三 tab + 分类 + 搜索 + 仅看可商用 + 5 列卡片网格；选中风格记录到节点并**拼入生成 prompt**（图片两类节点 + 视频节点全生效）。
3. **管理后台**新增风格分类管理、风格内容管理（数据由 admin 录入）。

## 1. 需求与拍板记录

| # | 需求/分叉 | 拍板 |
|---|---|---|
| D1 | spec 组织 | 单 spec + 单 plan，plan 内分 A（参考选择）/B（风格库全链路）两组任务 |
| D2 | 参考按钮与上传入口冲突 | 点参考**直接进画布选择模式**；文件上传 input 移除，拖拽/粘贴上传路径保留 |
| D3 | 风格对生成的影响 | 风格带 `promptText`，生成时后端拼入 prompt；**视频节点同样生效** |
| D4 | 弹窗 MVP 范围 | 三 tab（广场/收藏/最近使用）+ 卡片详情预览；**不做**最小化按钮、**不做**模型选择器 |
| D5 | 横幅按钮语义 | 「返回节点」=退出模式+视口滚动并选中发起节点（面板不收起）；「退出」/Esc=纯退出 |
| D6 | 视频节点 | 风格与参考选择对视频节点全生效（风格 prompt 拼入视频生成） |
| D7 | 弹窗技术形态 | 自绘 overlay（非 antd Modal、非独立路由页），与画布现有弹层/menuStore 模式一致 |
| D8 | 序号角标范围 | **全部参考图统一显示**序号（上传+画布选择），hover 变 X 删除 |
| D9 | 使用风格后的弹窗行为 | 使用即关闭弹窗；换风格直接覆盖不弹确认；「取消使用」在当前使用卡片 hover 时出现 |
| D10 | 「推荐」chips | 广场默认视图（全部、`sortOrder asc, usageCount desc`），不进分类表 |

## 2. 架构总览

```
┌─ web 前端 ────────────────────────────────────────────────┐
│ ImageThumbnailBar（入口改造）                              │
│   ├ 参考按钮 → nodeStore.referenceSelect（画布选择模式）    │
│   └ 风格按钮 → menuStore.styleLibrary（风格库 overlay）     │
│ CanvasReferenceSelectBanner（新，CanvasView 内横幅）        │
│ StyleLibraryModal（新，自绘 overlay：三 tab/筛选/卡片网格） │
│ StyleDetailPreview（新，详情浮层）                          │
│ SortableImageItem（序号/X 角标两态）                        │
│ stylesApi.ts（新，用户侧接口封装）                          │
├─ api 后端 ────────────────────────────────────────────────┤
│ modules/styles（新：列表/收藏/use）                         │
│ modules/admin/style*.controller（新：分类+内容 CRUD）       │
│ modules/execution（改：styleId→promptText 拼接）           │
├─ admin 前端 ──────────────────────────────────────────────┐
│ /admin/styles/categories（分类管理页）                     │
│ /admin/styles（内容管理页，ProTable+ModalForm）            │
└─ DB：StyleCategory / Style / StyleFavorite /              │
      StyleRecentUsage（4 新表 + 分类种子）─────────────────┘
```

数据流关键约束：节点 data 只存 `styleId + styleName`（展示用），`promptText` 每次生成时后端按 styleId 现查（admin 改风格即生效，节点 data 不膨胀）。

## 3. 功能块 A：画布参考选择模式

### 3.1 状态与入口

- `nodeStore` 新增：
  ```ts
  referenceSelect: { sourceNodeId: string } | null;
  startReferenceSelect(nodeId: string): void;  // 互斥：关闭 styleLibrary
  exitReferenceSelect(): void;
  ```
- `ImageThumbnailBar` 参考按钮 `onClick` → `startReferenceSelect(nodeId)`；**删除**隐藏 file input 与 `handleUploadClick`；拖拽（handleDrop）与粘贴上传路径保留不动。
- 互斥：进入参考选择时若风格库开着 → 关闭风格库；反之打开风格库时退出参考选择。进入节点编辑模式（activeEditNodeId 锁定态）时自动退出选择模式。

### 3.2 顶部横幅（CanvasReferenceSelectBanner，新组件）

- 渲染于 CanvasView 画布区 `absolute` 顶部居中（避让画布缩放/平移，不随 viewport 变换），`role="status"`，结构对标参考代码：
  `[图标盒(cardSelect 风格自绘 SVG)] [从画布选择参考] [返回节点] [退出]`
- 样式：`--canvas-controls-bg` 底 + `--canvas-controls-border` 边 + `--canvas-shadow-*`（以仓内现值为准）+ `backdrop-filter: blur(12px)`，圆角同仓内横幅/菜单惯例；两个按钮为 ghost 文本按钮（hover `bg-overlay-2`）。
- 满员提示：达到 9 张上限后再点节点，横幅文案行短暂显示「最多 9 张参考图」（2s 后还原），不弹 toast。

### 3.3 选择行为与约束

- 模式下**点击**（非拖拽位移，位移阈值同仓内惯例 5px 量级，plan 定）图片类节点（`imageGen` / `imageExtGen`）：
  - 取该节点**当前主图**（当前展示 URL + 其 MinIO fileId；具体字段组合按 ImageGenNode 展示逻辑，plan 对齐）构造 `ImageItem { id: 源图 fileId, url, name: 源节点 mediaName || '参考图', status: 'success' }`；
  - 追加进发起节点 `allImages`（走既有 `updatePromptImages`，自动获得撤销/协作语义）。
- 约束（不满足时点击无效果，其中满员走 §3.2 提示）：
  - 不可选发起节点自身；
  - 目标节点无主图 → 忽略；
  - 源图 fileId 已在发起节点参考图中 → 跳过（去重）；
  - 满 9 张（maxCount）→ 提示后忽略；
  - 视频节点、组节点、文本等其他类型 → 不作为参考源。
- 横幅常驻可连续多选；「返回节点」= `exitReferenceSelect()` + 视口滚动到发起节点并置选中态；「退出」/Esc = 纯退出。

### 3.4 序号/X 角标（SortableImageItem 改造）

- 全部参考图（上传+画布选择，D8）右上角序号角标：圆形小徽章，`absolute top-0 right-0 translate-x-1/2 -translate-y-1/2`（一半悬在图外），序号 = 在 `allImages` 中的顺序（1..n，拖拽排序后自动跟随），token 底色+边框。
- hover 缩略图时角标**变为 X**（同一位置两态切换），点击 = 现有删除逻辑（`handleDeleteImage`），原 hover X 按钮由角标两态取代。

## 4. 功能块 B：风格库弹窗

### 4.1 打开/关闭与互斥

- `menuStore` 新增 `styleLibrary: { nodeId: string } | null` + `openStyleLibrary(nodeId)` / `closeStyleLibrary()`；与 AddNodeMenu、handleMenu **三方互斥**（打开任一关闭其余）。
- 风格按钮（Image/ImageExt/Video 三面板共享）onClick → `openStyleLibrary(nodeId)`。
- 关闭：背板点击 / 右上关闭按钮 / Esc。

### 4.2 布局（自绘 overlay）

```
全屏背板（半透明遮罩）
└─ 居中卡片：max-w-[1600px]，高 min(calc(100vh−160px), 1200px)，圆角 12px，
   bg var(--canvas-controls-bg) + 0.5px border var(--canvas-controls-border) + blur(12px)
   ├─ 行1（h-10）：[风格广场|我的收藏|最近使用]（分段控件） [搜索框 336px] …… [关闭×]
   ├─ 分隔线（var(--canvas-controls-border)）
   ├─ 行2：分类 chips 横向滚动（推荐 + 分类表，右缘渐隐+下拉箭头） … [✓仅看可商用]
   └─ 主体：5 列网格（column-gap 12px，纵向滚动，左右 padding 16px），无限滚动 20 条/页
```

- tab：选中 `bg-overlay-2` + `text-text`；未选 `text-text-dim-2` + hover `bg-overlay-2`。
- 搜索框：`bg-overlay-2` 底，focus 边框品牌色 token；防抖 300ms，匹配名称+作者名。
- 「仅看可商用」复选框默认**不勾选**。
- 「推荐」chips = 广场默认视图：全部 enabled 风格，`sortOrder asc, usageCount desc`（D10）。
- 加载更多：IntersectionObserver 触发；底部 spinner；加载失败显示错误文案。

### 4.3 卡片

- 封面：`aspect-ratio 3/4`、object-cover、圆角 lg、`loading="lazy"`；hover 顶部渐变（浅黑）+ 底部渐变（深黑）。
- hover 浮层按钮（均在封面上）：
  - 左上「使用」（图标钮，hover 展开文字，对标参考代码）；若该卡为当前使用风格 → 变「取消使用」；
  - 右上收藏星标（已收藏常显，未收藏 hover 显示；toggle 调 §6 接口）；
  - 右下「详情」。
- **当前使用**风格卡：白边框 + 半黑遮罩（bg-black/50 量级）+ 左下白底黑字「当前使用」徽章（对标参考代码）。white/black 工具类命中 no-theme-utility 规则 → 实现时按规则登记白名单或换 token，plan 定。
- 信息区（封面下方）：
  - 行1：标题（truncate，14px medium）+「商用」徽章（isCommercial 时，dim 色）；
  - 行2：作者（占位圆点头像+作者名 dim 色）+ 使用量（usageCount，dim 色）。
- 点击卡片任意处 = 使用（等同左上按钮）；点击**当前使用**卡片主体 = 无操作（取消只走 hover 出现的「取消使用」按钮）。

### 4.4 交互语义

- **使用**：`POST /api/styles/:id/use`（usageCount+1、upsert 最近使用）成功后 `updateConfig(nodeId, { styleId, styleName })` → **关闭弹窗**（D9）。
- **取消使用**：当前使用卡片 hover → 左上按钮变「取消使用」→ `updateConfig(nodeId, { styleId: undefined, styleName: undefined })`（走 updateConfig 的既有键过滤/撤销通道，plan 对齐），弹窗不关。
- **三 tab 数据源**：`tab=square`（分类+搜索+商用筛选）/ `favorites`（该用户收藏，按收藏时间倒序）/ `recent`（该用户最近使用，按 lastUsedAt 倒序）；收藏/最近 tab 下分类行与商用筛选隐藏（无意义维度）。
- **详情预览**（StyleDetailPreview，新组件）：居中小浮层（同 token 自绘，z 高于风格库）：大封面（3:4）+ 名称 + 作者 + 可商用徽章 + promptText 全文（可滚）+「使用」按钮；背板点击关闭，回到风格库（风格库不关）。
- **空态**：收藏空「暂无收藏的风格」/ 最近空「暂无使用记录」/ 搜索或筛选无结果「未找到匹配风格」。

### 4.5 工具行风格按钮选中态

- 节点 data 有 `styleId` 时：按钮上部显示风格封面小圆图（coverUrl），下部显示 `styleName`（truncate，超长省略）；无风格时维持现状（调色盘图标+「风格」）。
- 点击行为不变（打开风格库）。

### 4.6 token 与门禁

- 参考代码中硬编码色全部换算为项目语义 token / 语义类：`#F7F7F7→text-text`、`#919191/#A8A8A8→text-text-dim 系`、`bg-canvas-controls-hover→bg-overlay-2`、`hover:bg-btn-ghost-hover→hover:bg-overlay-3` 等（终值以仓内 token 表为准，plan 对齐）。
- 新增 overlay 不引入新 hex（no-color-hex 增量门禁）；white/black 族工具类（遮罩/当前使用徽章）按 no-theme-utility 规则登记；如有新增 token 走 b0 登记/contrast-pairs/registry 变更登记管道。

## 5. 数据模型（Prisma）

```prisma
model StyleCategory {
  id        String   @id @default(cuid())
  name      String   @unique
  sortOrder Int      @default(0)
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  styles    Style[]
}

model Style {
  id           String        @id @default(cuid())
  name         String
  category     StyleCategory @relation(fields: [categoryId], references: [id])
  categoryId   String
  coverUrl     String
  authorName   String?
  isCommercial Boolean       @default(false)
  promptText   String
  sortOrder    Int           @default(0)
  enabled      Boolean       @default(true)
  usageCount   Int           @default(0)
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  favorites    StyleFavorite[]
  recents      StyleRecentUsage[]
}

model StyleFavorite {
  userId     String
  styleId    String
  createdAt  DateTime @default(now())
  user       User   @relation(fields: [userId], references: [id])
  style      Style  @relation(fields: [styleId], references: [id])
  @@unique([userId, styleId])
}

model StyleRecentUsage {
  userId    String
  styleId   String
  lastUsedAt DateTime @default(now())
  user      User   @relation(fields: [userId], references: [id])
  style     Style  @relation(fields: [styleId], references: [id])
  @@unique([userId, styleId])
}
```

- Migration：本地时间戳目录 + `migrate dev --name add-style-tables`；同 migration 内 seed 9 个初始分类：摄影写真/电商营销/动漫游戏/风格插画/平面设计/建筑及室内设计/创意玩法/文创周边/小说推文（sortOrder 1..9）。风格内容初始为空。
- 封面存 `coverUrl` 直链（admin 上传 MinIO 后取 URL；后端复用 banner 先例 `admin-home-banner.controller.ts` 的 `uploadCover`（multer `@UploadedFile`→storage）模式，前端对齐其上传组件，plan 落位）。

## 6. API 设计

### 6.1 用户侧（modules/styles，登录态）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/styles/categories` | enabled 分类，sortOrder asc |
| GET | `/api/styles?tab=square\|favorites\|recent&categoryId=&search=&commercialOnly=&page=1&pageSize=20` | square：enabled+筛选，`sortOrder asc, usageCount desc`；favorites：按 createdAt 倒序；recent：按 lastUsedAt 倒序；search 匹配 name/authorName（contains, insensitive） |
| POST | `/api/styles/:id/favorite` | toggle 收藏 → `{ favorited: boolean }` |
| POST | `/api/styles/:id/use` | usageCount+1 + upsert StyleRecentUsage → `{ style }`（仅 enabled 风格可用） |

列表返回 items 含：id/name/coverUrl/authorName/isCommercial/usageCount/favorited/currentUserId 视角不需要其它。

### 6.2 Admin 侧（modules/admin）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/admin/style-categories` | 列表（含 disabled）/ 新建（name 唯一校验） |
| PUT/DELETE | `/api/admin/style-categories/:id` | 编辑；**删除时下有风格（含 disabled）→ 400 阻止**并提示 |
| GET | `/api/admin/styles?categoryId=&search=&page=` | 分页列表（含全部字段） |
| POST | `/api/admin/styles` | 新建（封面 URL 由既有 admin 上传通道先传后提交） |
| PUT/DELETE | `/api/admin/styles/:id` | 编辑 / 删除 |

删除风格不做级联清理节点 data.styleId（开发期无存量防护，见 §10）。

## 7. 生成集成（execution.service.ts）

- `ImageNodeData` / `VideoNodeData` 新增 `styleId?: string; styleName?: string`；旧 `style?: string` 字段不动、不迁移。
- execution.service 三处分支（imageGen/imageExtGen 共用 callImageGen 前的 prompt 组装点、videoGen 分支）：
  ```
  const style = data.styleId ? await prisma.style.findUnique({ where: { id: data.styleId } }) : null;
  const finalPrompt = [prompt, style?.enabled ? style.promptText : null].filter(Boolean).join('\n');
  ```
  查不到 / disabled → 忽略，不阻塞生成。
- api-caller 不改（prompt 已在 execution 侧拼好）；其既有 `style` 入参原样保留。

## 8. 管理后台

### 8.1 后端

`modules/admin` 下新增 style 管理控制器（对齐既有 admin controller 守卫/模式）：分类 CRUD + 风格 CRUD（§6.2）。

### 8.2 前端

- AdminLayout 菜单新增「风格库」组：**风格分类**、**风格内容**两项；router.tsx 注册 `/admin/styles/categories`、`/admin/styles`。
- 风格分类页（ProTable + ModalForm，对齐 ModelsPage 模式）：列 名称/排序/启用/创建时间/操作（编辑、删除-Popconfirm）；表单 名称（必填唯一）、排序 InputNumber、启用 Switch。
- 风格内容页：列 封面缩略/名称/分类/作者/可商用/promptText 摘要（truncate+tooltip）/使用量/排序/启用/操作；表单 名称（必填）、分类 Select（必填）、封面上传（必填，既有上传组件/通道）、作者名（可选）、可商用 Switch、promptText TextArea（必填）、排序 InputNumber、启用 Switch。使用量只读。
- 分类筛选下拉 + 名称搜索（ProTable 标准能力）。

## 9. 测试策略（TDD，红-绿-重构）

- **前端 vitest**：
  - CanvasReferenceSelectBanner：渲染/两按钮行为/满员提示；
  - 参考选择逻辑：可选判定纯函数（类型守卫/自身排除/去重/满员/无图）+ nodeStore 模式状态与互斥；
  - SortableImageItem：序号角标常态、hover 变 X、点击删除回调；
  - StyleLibraryModal：tab 切换、分类 chips、商用筛选、搜索防抖、卡片渲染（收藏态/当前使用态/商用徽章）、使用/取消使用对 updateConfig 的调用、收藏 toggle、无限滚动触发、空态；menuStore 三方互斥；
  - StyleDetailPreview：内容渲染 + 使用按钮；
  - ImageThumbnailBar：参考按钮进选择模式（不再触发 file input）、风格按钮开弹窗、选中态按钮（封面+风格名）；
  - stylesApi：请求参数/响应映射。
- **后端 vitest**：styles service（三 tab 查询口径/收藏 toggle/use 计数与 upsert/未启用 400）、admin CRUD（分类删除阻止/名称唯一）、execution 风格拼接（有/无 styleId、disabled、prompt 为空时纯风格文本）。
- **门禁**：`pnpm vitest run` 全绿；`pnpm lint`（no-color-hex 增量）；`node scripts/css-audit.mjs`；`npx tsc -b`；如新增 token 走 b0/contrast/registry 管道。
- **浏览器人工验收**（§11）。

## 10. 边界与裁定登记

| # | 事项 | 裁定 |
|---|---|---|
| B1 | 删除风格后节点残留 styleId | 生成时忽略（§7）；风格库「当前使用」按 styleId 匹配，已删则无标记；不做清理任务（开发期无存量防护） |
| B2 | admin 修改 promptText | 下次生成即生效（后端现查，节点 data 只存 id+name） |
| B3 | 协作/撤销 | allImages 走 updatePromptImages、styleId/styleName 走 updateConfig，均复用既有通道；UI 状态（referenceSelect/styleLibrary）为本地态不协作 |
| B4 | 拖拽节点 vs 点击选择 | 位移阈值区分，拖动不触发加入（阈值 plan 定，对齐仓内 5px 惯例） |
| B5 | 上传可发现性下降 | D2 拍板接受：拖拽/粘贴保留；后续如需恢复入口另起需求 |
| B6 | 「当前使用」白底黑字/黑色遮罩 | white/black 工具类命中 no-theme-utility → 按规则登记白名单或换 token（plan 定，不逃避门禁） |
| B7 | 风格库/参考选择/右键菜单/handle 菜单 | 四画布 UI 互斥，menuStore/nodeStore 现有互斥逻辑扩展 |
| B8 | 视频节点风格 | promptText 拼入视频生成 prompt（D6/D3） |

## 11. 浏览器人工验收清单

1. 参考按钮 → 横幅出现（顶部居中、blur、token 底）；画布点击其他图片节点 → 参考图追加+序号角标一半悬外；连续多选；
2. 拖动节点不触发加入；点发起节点自身/无图节点/视频节点无效；重复选同图去重；满 9 张横幅提示；
3. hover 参考图角标变 X → 点击删除；拖拽排序后序号跟随；
4. 「返回节点」滚动并选中发起节点；「退出」/Esc 纯退出；进入节点编辑模式自动退出；
5. 拖拽/粘贴图片到工具行仍可上传（D2 保留路径）；
6. 风格按钮 → 风格库弹出（1600px/高度约束/5 列/三 tab/分类 chips/搜索/仅看可商用/无限滚动）；卡片 hover 三按钮；当前使用卡片白边+遮罩+徽章；
7. 使用风格 → 弹窗关闭、工具行按钮显示封面+风格名；生成出图 prompt 含风格文本（后端日志或产物验证）；换风格覆盖；取消使用还原「风格」默认态；
8. 收藏 toggle 同步星标与「我的收藏」tab；「最近使用」tab 出现刚用过的风格（倒序）；
9. 详情浮层展示大图+promptText，使用按钮可用，关闭回风格库；
10. 视频节点：参考选择可用；选风格后视频生成 prompt 含风格文本；
11. admin：分类增删改（删除保护）、风格内容增删改（封面上传/必填校验）、前台即时可见新数据；
12. 四画布 UI 互斥逐一验证；Esc 全部可关；协作另一端能看到参考图/风格名变更。

---

## 附：参考来源

- 横幅结构：用户提供的 `CanvasReferenceSelectBanner` DOM（role=status / iconBox / label / returnButton / exitButton）。
- 风格库布局与卡片：用户提供的 liblib 风格库 Modal DOM（三 tab、分类行、仅看可商用、5 列虚拟网格、卡片 hover 按钮、当前使用态、详情/收藏按钮）——**视觉对标、实现自绘且全部 token 化**。

