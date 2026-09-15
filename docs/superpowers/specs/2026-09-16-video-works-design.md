# 视频作品展示页（Video Works Showcase）设计文档

- 日期：2026-09-16
- 状态：已确认（brainstorming 三节呈现 + 三轮架构审核均通过）
- 范围：公开作品页 + 全屏播放 Modal + 创作过程快照 + 画布克隆 + Admin 管理后台

## 1. 概述

新增公开免登录的视频作品展示页 `/videos`（顶部导航入口），展示由画布视频剪辑导出的优秀作品。管理员在后台从已导出视频中策展上架，可配置每个作品是否允许查看创作过程、是否允许克隆画布。播放为全屏弹出 Modal（参考 liblib.tv），Modal 内可切换"创作过程"只读画布快照，并从快照顶栏"复制项目"克隆画布到当前用户。

**本期只做管理员策展**。用户发布+后台审核为后续独立功能：预留方式为 status 枚举后续追加 `PENDING_REVIEW`（仅 schema 变更），本期不提前加值（YAGNI）。

## 2. 已确认决策清单

| # | 决策 | 说明 |
|---|---|---|
| D1 | VideoWork 不建外键指向 Media/CanvasProject | 裸字符串引用 + 自持 MinIO key 副本，消除团队解散级联删 Media 的生命周期污染；与全仓既有风格一致 |
| D2 | 全新独立功能岛 | 独立表、独立模块 `modules/video-work/`、独立路由前缀、前端目录 `pages/videos/`；不复用 Template/HomeBanner/ContentCard 业务编排，仅复用底层基础设施（Yjs 读写、MinIO 签名、ProjectService.create） |
| D3 | 开发测试阶段无存量数据 | 不做向后兼容/存量防护；但表结构与接口本身必须正确 |
| D4 | 游客可匿名访问 | 公开端点免登录；不依赖团队/权限体系；clone 端点 handler 内自守登录 |
| D5 | 播放页形态 = 全屏 Modal（非独立详情页） | 列表页点击卡片弹 Modal；分享直链 `/videos/:id` 渲染列表并自动弹 Modal；浏览器返回键/Esc/返回钮关闭 |
| D6 | 观看/喜欢 = 真实计数 + 后台可改数值 | like 为 toggle 端点（详见 §4.5 计数语义） |
| D7 | 标签 = 后台标签池 + 自由输入 | VideoTag 池表 + 作品 `tags String[]` 存实际值 |
| D8 | 创作过程快照展示业务内容、剥离内部 id | 学习价值优先；安全隐患（内部 id/素材 URL/XSS 面）由服务端白名单封死（§4.6） |
| D9 | 含 videoEdit 节点的作品 v1 禁克隆 | 校验兜底；"克隆时剥离 videoEdit 节点"进 plan 作紧随增强批次，落地后解除限制 |
| D10 | 下架时效 ≤1h | presign 3600s 直连；下架后列表/详情立即 404，存量 URL 最长 1h 失效；不做流式端点 |
| D11 | 底部轮播 = 后台全局设置 | VideoWorkSetting 单行表：carouselEnabled（默认 true）/ carouselScope（all\|category，默认 all）；仅存在于播放 Modal 内 |
| D12 | 路由 `/videos` + 顶部导航 | 命名收敛：后端 video-work（模块/表/API）+ 前端 /videos + pages/videos/ + videoWorkApi.ts；showcase 一词弃用 |
| D13 | 列表卡片只显示封面+时长+标题+标签 | 不显示作者/日期/观看数/喜欢数（整洁）；作者/更新时间显示在播放 Modal 顶栏 |

## 3. 数据模型

### 3.1 Schema

```prisma
enum VideoWorkStatus {
  DRAFT
  PUBLISHED
}

model VideoWork {
  id              String          @id @default(cuid())
  title           String          @db.VarChar(200)
  description     String?         @db.Text
  authorName      String          @db.VarChar(64) // 展示用，后台自由填
  categoryId      String?
  category        VideoCategory?  @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  // 媒体：自持 key 副本，不建 FK 指向 Media（D1）
  videoKey        String          @db.VarChar(512) // MinIO 对象键
  videoMediaId    String? // 来源追溯，裸字符串
  coverKey        String?         @db.VarChar(512) // 后台上传优先，兜底源 Media.thumbnailKey
  canvasProjectId String? // 创作过程/克隆源，裸字符串（D1）

  // 选片时从源 Media.metadata 复制（卡片时长角标 + 播放器初始比例）
  durationSec     Int?
  width           Int?
  height          Int?

  viewCount       Int             @default(0)
  likeCount       Int             @default(0)
  tags            String[]        @default([]) // 实际值；池在 VideoTag（D7）
  sortOrder       Int             @default(0)
  status          VideoWorkStatus @default(DRAFT)
  allowViewProcess Boolean        @default(false) // 逐作品开关
  allowClone      Boolean         @default(false) // 逐作品开关；画布含 videoEdit 节点时强制 false（D9）
  publishedAt     DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@index([status, sortOrder, publishedAt(sort: Desc)])
  @@index([categoryId, status])
}

model VideoCategory {
  id        String      @id @default(cuid())
  name      String      @db.VarChar(64) @unique
  sortOrder Int         @default(0)
  active    Boolean     @default(true)
  works     VideoWork[]
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  @@index([active, sortOrder])
}

model VideoTag {
  id        String   @id @default(cuid())
  name      String   @db.VarChar(32) @unique
  sortOrder Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([active, sortOrder])
}

// 单行配置（id 固定 'singleton'）；不侵入 modules/admin/settings（见风险 R10）
model VideoWorkSetting {
  id              String   @id @default("singleton")
  carouselEnabled Boolean  @default(true)
  carouselScope   String   @default("all") // all | category
  updatedAt       DateTime @updatedAt
}
```

### 3.2 字段语义说明

- **自持 key 副本**：videoKey/coverKey 是创建/编辑作品时从源 Media 复制的字符串，作品读取不查 Media 表。已知边界：源团队解散会物理删 MinIO 对象（team.service.ts:428），DB 层已解耦但对象层仍坏链——详情/快照接口对"对象不存在"做降级容错（D3 接受）。
- **coverKey 兜底顺序**：后台上传的封面 > 源 Media.thumbnailKey（BullMQ 异步生成，选片时可能仍为 null）> 无封面占位。
- **标签池语义**：VideoTag 仅作录入建议（ProFormSelect mode="tags" 的选项来源）；删除池中标签不影响作品已存 tags；作品 tags 可能出现池中已删的值——自由输入语义的必然结果，非缺陷。按标签筛选本期不做。
- **publishedAt**：后台"发布"动作时若为空自动设 now（防止排序塌陷）；重新下架再发布不重置。
- **索引方向**：`publishedAt(sort: Desc)` 显式声明（Postgres 混合方向排序需显式才能完整命中）。

## 4. 后端设计

### 4.1 模块结构（独立岛，D2）

```
apps/api/src/modules/video-work/
├── video-work.module.ts
├── video-work.service.ts          # 唯一 service，公开+后台共用
├── video-work.controller.ts       # 公开只读 @Controller('api/video-works')
├── admin-video-work.controller.ts # 后台 CRUD @Controller('api/admin/video-works')
├── video-work-clone.service.ts    # 克隆编排（独立，不寄生 Template/Project 业务编排）
├── dto/create-video-work.dto.ts
├── dto/update-video-work.dto.ts
├── dto/video-category.dto.ts
├── dto/video-tag.dto.ts
└── *.spec.ts
```

样板参照 `modules/home-banner/`（公开+admin 双 controller 共用一个 service）。注册：`app.module.ts` imports +1。

**跨模块触点仅 1 处**：`auth.guard.ts` PUBLIC_PREFIXES 加 `/api/video-works`（前缀放行 + handler 自守，先例 /api/subscription）。

**路由声明顺序红线**：controller 内静态段路由（`categories`）必须声明在参数路由（`:id`）之前，否则被吃掉。spec 断言 `GET /api/video-works/categories` 命中 categories handler。

### 4.2 公开 API（`/api/video-works`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 列表：`?categoryId=&page=&pageSize=`（pageSize 上限 50）；仅 PUBLISHED；orderBy `[sortOrder asc, publishedAt desc]`；返回 `{items,total,page,pageSize}`，item 含封面 URL（presign 3600s） |
| GET | `/categories` | active 类型列表（**声明在 `/:id` 之前**） |
| GET | `/:id` | 详情：PUBLISHED 否则 404；返回 + videoUrl(presign 3600s) + coverUrl + description + tags + authorName + publishedAt + canViewProcess/canClone（服务端计算实际可用性 = allowX && status==PUBLISHED && 画布存在；canClone 额外 && 画布无 videoEdit 节点） |
| POST | `/:id/view` | 观看 +1（Redis IP 去重 1h + 滑动窗口限流，见 §4.5） |
| POST | `/:id/like` | 喜欢 toggle ±1（见 §4.5） |
| GET | `/:id/process` | 创作过程快照（PUBLISHED + allowViewProcess + 画布存在；collab 离线 503；Redis 缓存 TTL 300s；白名单见 §4.6） |
| POST | `/:id/clone` | 克隆到当前用户默认团队（未登录 401；校验见 §4.7） |

**轮播取数口径（D11）**：复用列表端点，由前端组装——scope=all → `GET /?page=1&pageSize=10`；scope=category → `GET /?categoryId={当前作品}&page=1&pageSize=10`；前端过滤掉当前作品后渲染 CarouselBar；轮播仅存在于播放 Modal 内（列表页无轮播）。

### 4.3 后台 API（`/api/admin/video-works`，AdminGuard 路径前缀保护）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/` 、`/:id` PUT/DELETE | 作品 CRUD；create/update 校验：allowClone=true 且画布含 videoEdit 节点 → 400（D9）；发布动作自动设 publishedAt；viewCount/likeCount 可直接编辑（覆盖式） |
| GET | `/candidates` | 候选视频池：分页 + orderBy createdAt desc；口径见 §4.4；返回 id/key/thumbnailKey/durationSec/width/height/createdAt + 预览 presign URL |
| POST | `/upload-cover` | multipart 封面上传（本模块自有端点，不复用 HomeBanner 的） |
| GET/POST/PUT/DELETE | `/categories`、`/tags` 子资源 | 类型/标签池 CRUD |
| GET/PUT | `/settings` | 轮播设置读写（VideoWorkSetting 单行 upsert） |

### 4.4 候选列表口径

```ts
where: {
  status: 'completed',
  deletedAt: null,
  type: 'generated',
  mimeType: 'video/mp4',
  metadata: { path: ['origin'], equals: 'video-project' }, // 唯一能标识画布导出的字段
}
```

metadata JSON 无索引 → 全表扫（D3 可接受，登记风险 R7）。选中后复制 key/metadata(durationSec,width,height)/thumbnailKey 到 VideoWork。

### 4.5 view/like 计数语义（D6）

- **计数定位 = 互动量，非独立用户数**（IP ≠ 人：NAT 共享、换网重刷——已知妥协，接受）。
- **view**：Redis key `videoWork:view:{workId}:{ipHash}` TTL 1h，存在则不计。
- **like toggle**：Redis key `videoWork:like:{workId}:{ipHash}` 无 TTL 记"该 IP 已赞"；存在 → delta=-1 并删键，不存在 → delta=+1 并写键。前端 localStorage 记本机态负责"再点取消"UX（展示层状态以后端计数为准）。
- **DB 原子下界保护**：`UPDATE "VideoWork" SET "likeCount" = GREATEST("likeCount" + ${delta}, 0) WHERE id = ${id}`（$executeRaw，防负数）。
- **防脚本**：view/like 端点各加 Redis 滑动窗口限流（INCR+EXPIRE，每 IP 30 次/分钟，超限 429）。全局 ThrottlerGuard 未挂 APP_GUARD（已验证），不依赖它。
- **IP 取值**：生产经 Nginx 代理，plan 阶段确认 Express trust proxy / X-Forwarded-For 配置后取真实客户端 IP（哈希后作 key）。
- **后台编辑**：update 直接覆盖设值，不叠加；后台改后 Redis 已赞标记残留导致个别用户首点变"取消"（-1）——接受（互动量语义）。

### 4.6 创作过程快照 + 字段白名单（D8，安全核心）

**三条红线**：
1. `prompt` 只取 `.text`，**永不返回 `.html`**（tiptap 富文本 → 存储型 XSS 源）。
2. 文本字段（content/prompt.text）按纯文本处理，前端用文本节点渲染，**禁 innerHTML/dangerouslySetInnerHTML**。
3. 过滤只发生在**服务端**（GET /:id/process 响应构造处），不靠前端自觉。

**响应结构**：

```ts
{
  workId, title,
  nodes: Array<{ id, type, position:{x,y}, width?, height?, parentId?, data: WhitelistedData }>,
  edges: Array<{ id, source, target }>
}
```

**data 字段白名单表**（按节点类型；未列出的字段一律剥离）：

| 节点类型 | 保留字段 | 剥离示例（必须） |
|---|---|---|
| textInput | content, prompt?.text | prompt.html, prompt.referencedImageIds |
| imageGen / imageExtGen | prompt?.text, style, model, quality, ratio, resolution, aspectRatio | fileId, referenceImage, mediaName, allImages（整个字段，含 url）, prompt.html, generationBatchId, editMode, status |
| videoGen | model, ratio, prompt?.text, trimStart, trimEnd | fileId, referenceVideo, allImages, trimmedFileId, trimTaskStatus, status |
| audio | model, content | fileId, referenceAudio, status |
| videoEdit | （仅结构字段） | 全部 data |
| 其他/未知类型 | （仅结构字段） | 全部 data（新增节点类型默认全剥，白名单需随演进维护——风险 R11） |

**安全验收用例（必须）**：断言 /:id/process 响应 JSON 序列化后不含 `"html"`、`"fileId"`、`"referencedImageIds"`、`"url"`、`"generationBatchId"`、`"mediaName"` 子串。

**缓存**：Redis `videoWork:process:{workId}` TTL 300s（readCanvas 走 Hocuspocus 直连加载整个 Yjs doc，公开端点必须挡住爬虫/热链；先例 media.service.ts 840s 缓存）。作品编辑/上下架时主动删缓存。

**产物缩略图**：v1 媒体产物节点显示类型占位；快照内嵌产物缩略图（服务端 presign thumbnailKey 注入 data.thumbnailUrl）为 plan 增强批次。

### 4.7 克隆（D9）

```ts
// video-work-clone.service.ts
async clone(workId, userId) {
  const work = 校验(status==PUBLISHED && allowClone) 否则 404/403;
  const { nodes, edges } = await collabDoc.readCanvas(work.canvasProjectId); // collab 离线则 503
  校验 nodes 不含 type==='videoEdit'，含则 400;  // v1 兜底（D9）
  const project = await projectService.create(`${work.title} (副本)`, userId, nodes, edges);
  return { projectId: project.id };
}
```

- 复用底层原语：`CollabDocumentService.readCanvas` + `ProjectService.create`（写 ProjectMember(PROJECT_OWNER)；不传 teamId → ensureDefaultTeam 归属克隆者默认团队）。
- **不复用** TemplateService.import（丢 parentId/width/height + Template 语义污染 + importCount 虚增，已验证 template.service.ts:245）。
- 不复制 CanvasDoc（withDoc 断连时 compact upsert 自动生成）、CanvasDocUpdate（seq 全局冲突）、原项目成员、VideoProject。
- 已知丢失：viewport（readCanvas 只返回 nodes/edges，接受）。
- **plan 增强批次**：克隆时剥离 videoEdit 节点及其相连边（~10 行过滤），克隆体得到干净画布（产物节点都在，可重新建剪辑工程）；落地后解除"含 videoEdit 禁克隆"限制（canClone 计算 + 保存校验同步移除）。
- 未登录：handler 内 req.user 为空 → 401（公开前缀下 optional auth 已挂 req.user）。

### 4.8 播放与下架

- presign GET 3600s 直连（Range 已验证 206 可用，进度条正常）。
- 下架（status→DRAFT/DELETE）：列表/详情/process 立即 404；已发出 URL ≤1h 后自然失效（D10）。
- 前端 video onError → 重拉详情刷新 URL（TTL 到期自愈）。

### 4.9 路由/守卫注册

- `auth.guard.ts` PUBLIC_PREFIXES += `/api/video-works`（+1 行）。
- admin controller 路径 `/api/admin/video-works` 由现有 AdminGuard 前缀机制自动保护（无需装饰器，与现有 admin 模块一致）。

## 5. 前端设计

### 5.1 路由（公开组 AppLayout，免登录）

| 路由 | 渲染 |
|---|---|
| `/videos` | VideosPage：类型 tab + 卡片网格 + 分页 |
| `/videos/:id` | 同 VideosPage，mount 时自动弹出该作品播放 Modal（分享直链） |

Modal 开关与路由同步：点卡片 → `navigate(/videos/:id)`；关闭 → 返回 `/videos`。浏览器返回键/Esc/返回钮均可关闭。

### 5.2 目录结构

```
apps/web/src/pages/videos/
├── VideosPage.tsx           # 类型 tab（含"全部"）+ 卡片网格 + antd Pagination
├── VideoPlayerModal.tsx     # 全屏黑底 Modal；播放视图 ↔ 创作过程视图内部切换
├── ProcessSnapshot.tsx      # @xyflow/react 只读渲染（nodesDraggable/Connectable/elementsSelectable=false, fitView, panOnDrag, zoomOnScroll）
├── CarouselBar.tsx          # 底部轮播（按 VideoWorkSetting 渲染；点击切换 = 更新路由 :id）
└── __tests__/
apps/web/src/api/videoWorkApi.ts   # 列表/详情/view/like/process/clone/categories 封装（apiFetch）
apps/web/src/pages/admin/pages/VideoWorksPage.tsx   # 后台管理
```

### 5.3 ProcessSnapshot 关键约束

- **不得复用 CanvasView.tsx**（耦合 6 个 store + 9 种业务节点组件 + collab runtime）。
- 新组件只依赖 `@xyflow/react` + 静态快照数据；节点用简版自定义节点（类型图标 + 标题 + 白名单文本），零 store/API 依赖。
- 文本一律文本节点渲染（红线 2，禁 innerHTML）。

### 5.4 交互细节

- 中央按钮组按作品动态渲染：「查看制作过程」仅 canViewProcess；「复制项目」仅 canClone（在创作过程视图顶栏）。
- 喜欢 toggle：localStorage 记本机态；点/再点调 POST /:id/like。
- 分享：`navigator.clipboard.writeText(location.href)` + message 提示。
- 视频 onError → 重拉详情刷新 presign URL。
- 未登录点「复制项目」→ 跳登录（RequireAuth 回跳能力 plan 阶段查证；无则登录后回 /videos）。
- 顶部导航 AppLayout 加「视频作品」入口。
- 骨架屏/空态复用 CardGridSkeleton / EmptyState 模式。

### 5.5 列表卡片（D13）

只显示：封面（16:9，coverUrl，无封面占位）+ 时长角标（mm:ss，右下）+ 标题（单行截断）+ 标签 chips。**不显示**作者/日期/观看数/喜欢数。

### 5.6 Admin 后台（/admin/content/video-works，菜单注册 AdminLayout）

- **作品管理**：ProTable（标题/类型/状态/观看/喜欢/排序/更新时间）+ ModalForm：
  - 候选视频选择（下拉 + 缩略图预览，数据来自 /candidates）
  - 标题/简介/作者名/类型（select）/标签（ProFormSelect mode="tags"，选项来自标签池）/排序/上下架（Switch 或状态列操作）
  - allowViewProcess / allowClone 开关（后者在画布含 videoEdit 时禁用+提示）
  - viewCount/likeCount 数字输入（后台可调）
- **类型管理 / 标签管理**：同页 Tab 或子区块，ProTable+ModalForm 轻量 CRUD。
- **轮播设置卡片**：carouselEnabled 开关 + carouselScope 单选（全部作品/同类型），读写 /settings。

## 6. UI 规范

Mockup 参考：`.superpowers/brainstorm/601-1789488912/content/videos-ui-v2.html`（三屏）。

- **列表页**：顶部导航（视频作品高亮态 #09caf5）+ 圆角 pill 类型 tab（选中 #141414 白字）+ 4 列卡片网格 + 居中分页。
- **播放 Modal**：全屏黑底（100dvh）；封面背景层（opacity .55）+ 上黑下渐变遮罩；顶栏（返回钮 rgba(50,50,50,.45) 毛玻璃 / 头像 / 作者名 / 分隔线 / 标题 | 更新时间 + "含 AI 生成内容"）；中央按钮组（白色"立即观看"主钮 / 毛玻璃"查看制作过程" / 喜欢 / 分享圆钮）；左下简介浮层（悬停或常显，含标签 chips）；底部轮播条（16:9 缩略卡 110px 宽，当前项白 ring，其余 50% 遮罩）。
- **创作过程视图**：顶栏（作品标题 / 工作流|故事板 segmented / 复制项目按钮（#09caf5）/ 关闭 ✕）+ 点阵灰底画布（#f5f5f5，16px 点阵 #dedede）+ 左下缩放控件（白底毛玻璃）。节点卡：白底 1px #e3e3e3 圆角 8px + 类型图标 + 标题 + 白名单文本；连线 #c4c4c4。
- 设计 token 沿用现有 neutral/brand 色系（--color-neutral-*、#09caf5 主色）。

## 7. 测试策略（TDD，strict: true）

每批次红-绿-重构循环；关键用例：

**后端（service/controller spec）**：
1. 候选列表口径：metadata.origin='video-project' 断言（非画布导出的 generated 不出现）。
2. 非管理员访问 admin 端点 403；匿名访问公开列表 200 且 DRAFT 不可见。
3. 路由顺序：GET /api/video-works/categories 命中 categories handler（不被 :id 吞）。
4. view 去重：同 IP 1h 内重复请求只 +1。
5. like toggle：+1/-1/GREATEST 下界（刷到 0 不为负）；限流 429。
6. **快照安全验收**：响应序列化后不含 `html/fileId/referencedImageIds/url/generationBatchId/mediaName` 子串；DRAFT 或 allowViewProcess=false → 404；collab 离线 503；缓存命中（第二次请求不触 readCanvas）。
7. 克隆：新项目含 nodes/edges（含 parentId/width/height）；Template 行数与 importCount 不变；含 videoEdit → 400；未登录 401。
8. 保存校验：allowClone=true 且画布含 videoEdit → 400。
9. 发布自动设 publishedAt。

**前端（Vitest + TestingLibrary）**：
1. 列表渲染：卡片只含 封面/时长/标题/标签（断言不含作者/日期/计数节点）。
2. /videos/:id mount 自动开 Modal；关闭返回 /videos。
3. canViewProcess=false 时不渲染「查看制作过程」按钮。
4. 喜欢 toggle 本地态 + API 调用。
5. ProcessSnapshot 纯文本渲染（无 dangerouslySetInnerHTML）。
6. onError 触发详情重拉。

**测试触点（易漏，改既有测试）**：router.admin.test.tsx 精确断言 admin 叶子数；auth.guard.spec.ts 白名单逐条断言 +1 行。

## 8. 实施批次

| 批 | 内容 | 验收 |
|---|---|---|
| 1 | schema + migration（prisma migrate dev --name add_video_work）+ 模块骨架 | migrate deploy 后 diff 零差异；模块可启动 |
| 2 | 后台 CRUD + 类型/标签 CRUD + 候选列表 + 封面上传 + 设置端点 | service spec 覆盖候选口径；非 ADMIN 403 |
| 3 | 公开列表 + 详情 + presign + PUBLIC_PREFIXES | 匿名 curl 200；DRAFT 404 |
| 4 | view/like 计数 + 限流 | 去重/下界/429 用例全绿 |
| 5 | 创作过程快照 + ProcessSnapshot 只读渲染 | 安全验收断言全绿 |
| 6 | 克隆 + videoEdit 校验 | 克隆断言 + Template 不变 |
| 增强（紧随） | 克隆剥离 videoEdit 节点，解除 D9 限制 | 含 videoEdit 作品可克隆且克隆体无该节点 |
| 增强 | 快照内嵌产物缩略图 | 媒体节点显示缩略图 |

上线顺序：先 `prisma migrate deploy` 再发代码（deploy.sh 只跑 generate）；db push 禁用。

## 9. 风险登记

| # | 风险 | 级别 | 处置 |
|---|---|---|---|
| R1 | 快照泄露 prompt.html/内部 id/素材 URL | 高 | §4.6 白名单 + 三红线 + 安全验收必测 |
| R2 | 剪辑节点不可克隆（sourceNodeId 全局唯一） | 中 | v1 禁克隆（D9）+ plan 增强剥离节点 |
| R3 | 下架后 URL ≤1h 残留 | 中 | D10 接受；onError 自愈 |
| R4 | 团队解散删 MinIO 对象 → 作品坏链 | 中 | 自持 key 解 DB 耦合；详情容错（D3） |
| R5 | readCanvas 依赖 collab 在线 | 中 | 503 + 前端提示 |
| R6 | 计数可刷（全局 Throttler 未生效） | 中 | 端点级 Redis 限流；互动量语义接受残余 |
| R7 | 候选列表 metadata JSON 全表扫 | 低 | D3 接受；数据量增长后加可索引字段 |
| R8 | 无 og 标签 → 社交分享无预览卡 | 低 | 范围外；需 SSR，未做 |
| R9 | 生产网关 Range 透传未知 | 中 | 上线前置检查（proxy_force_ranges） |
| R10 | 不碰 modules/admin/settings | — | 轮播配置走 VideoWorkSetting 单行表；"白名单外 key 静默丢弃"行为测试属 settings 模块，本任务不补 |
| R11 | 快照白名单需随节点类型演进维护 | 低 | 未知类型默认全剥；新增类型时同步白名单表 |

## 10. 范围外（明确不做）

- 用户发布 + 后台审核流（预留 PENDING_REVIEW 枚举扩展点，后续独立功能）
- 标签筛选（has 查询 + 索引另开）
- og 社交预览卡片（需 SSR）
- 下架秒级失效（服务端流式端点）
- 全局限流修复（挂 APP_GUARD ThrottlerGuard）——仅做 view/like 端点级 Redis 限流
- 快照产物缩略图 / 克隆剥离 videoEdit —— plan 内增强批次（非本期外）

