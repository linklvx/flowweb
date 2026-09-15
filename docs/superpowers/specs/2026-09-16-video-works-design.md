# 视频作品展示页（Video Works Showcase）设计文档

- 日期：2026-09-16
- 状态：已确认（brainstorming 三节呈现 + 三轮架构审核均通过）
- 范围：公开作品页 + 全屏播放 Modal + 创作过程快照 + 画布克隆 + Admin 管理后台

## 1. 概述

新增公开免登录的视频作品展示页 `/videos`（左侧 Sidebar 入口），展示由画布视频剪辑导出的优秀作品。管理员在后台从已导出视频中策展上架，可配置每个作品是否允许查看创作过程、是否允许克隆画布。播放为全屏弹出 Modal（参考 liblib.tv），Modal 内可切换"创作过程"只读画布快照，并从快照顶栏"复制项目"克隆画布到当前用户。

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
| D8 | 创作过程快照展示业务内容、剥离内部 id | 学习价值优先；安全隐患（内部 id/素材 URL/XSS 面）由服务端白名单封死（§4.6）；白名单 type 键以 `NODE_TYPES`（nodeStore.ts:6-13）为唯一真值 |
| D9 | 克隆 = 工作流配方（白名单剥离） | 克隆时剥离 videoEdit 节点、shadow-/\_\_ephemeral 临时节点及相连边、敏感 data 字段（fileId/mediaUrl 等），并重发节点 id——克隆体节点在但产物资源位为空（用户重新生成）；限制"含 videoEdit 禁克隆"随之解除 |
| D10 | 下架时效 ≤1h | presign 3600s 直连；下架后列表/详情立即 404，存量 URL 最长 1h 失效；不做流式端点 |
| D11 | 底部轮播 = 后台全局设置 | VideoWorkSetting 单行表：carouselEnabled（默认 true）/ carouselScope（all\|category，默认 all）；仅存在于播放 Modal 内 |
| D12 | 路由 `/videos` + 左侧 Sidebar 入口 | 命名收敛：后端 video-work（模块/表/API）+ 前端 /videos + pages/videos/ + videoWorkApi.ts；showcase 一词弃用 |
| D13 | 列表卡片只显示封面+时长+标题+标签 | 不显示作者/日期/观看数/喜欢数（整洁）；作者/更新时间显示在播放 Modal 顶栏 |
| D14 | 复用暗色 AppLayout + Sidebar | 项目为暗色主题+左侧 Sidebar（无顶部导航）；Sidebar 加第 5 项「视频作品」，pathname 前缀匹配自动高亮；播放 Modal 经 portal 全屏黑底不受主题影响；mockup 的浅色顶栏仅作布局示意 |
| D15 | 登录才能点赞 | like 端点要求登录（userId 去重，语义正确、不可刷）；view 计数保持匿名 IP 去重；未登录点喜欢 → 跳登录 |
| D16 | canvasProjectId 来源 = /candidates 返回的 Media.projectId | 导出登记时 Media.projectId 即 workflowId（= CanvasProject.id）；不走 metadata.videoProjectId（VideoProject 随剪辑节点级联删） |

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
  allowClone      Boolean         @default(false) // 逐作品开关（克隆时自动剥离 videoEdit/shadow- 节点与敏感字段，D9）
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

- **自持 key 副本**：videoKey/coverKey 是创建/编辑作品时从源 Media 复制的字符串，作品读取不查 Media 表。已知边界：源团队解散时对象删除为**入队异步执行**（team.service.ts:421 入队，team-media-cleanup.processor 消费，只删主 key、不删 thumbnailKey、吞错无重试）——DB 层已解耦但对象层仍坏链，详情/快照接口对"对象不存在"做降级容错（D3 接受）。
- **coverKey 兜底顺序**：后台上传的封面 > 源 Media.thumbnailKey（BullMQ 异步生成，选片时可能仍为 null——候选列表可稍后重选或手填封面兜底，接受）> 无封面占位。
- **标签池语义**：VideoTag 仅作录入建议（ProFormSelect mode="tags" 的选项来源）；删除池中标签不影响作品已存 tags；作品 tags 可能出现池中已删的值——自由输入语义的必然结果，非缺陷。按标签筛选本期不做。
- **publishedAt**：仅由服务端在 status 转 PUBLISHED 且为空时设 now（请求体不接受该字段）；重新下架再发布不重置。
- **durationSec 取整**：源 Media.metadata.durationSec 可能为小数，入库 Int 前必须取整（Math.round），否则 Prisma 类型错误。
- **VideoWorkSetting 默认值兜底**：GET /settings 无行时返回默认值 `{carouselEnabled:true, carouselScope:'all'}`，不依赖 DB 里有行。
- **Media 候选索引**：现有 Media 索引不含 type+status+deletedAt 组合（where 条件全表扫），migration 补 `CREATE INDEX "ix_media_candidates" ON "Media"("type","status","deletedAt")`（D3 无数据，普通索引瞬间完成）。
- **同一 Media 可重复策展为多条作品**：有意为之（不同标题/类型视角），不加唯一约束。
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
| GET | `/` | 列表：`?categoryId=&page=&pageSize=`；仅 PUBLISHED；categoryId 为 plain filter（不校验 active/存在性）；pageSize 手写 clamp 至 [1,50]；orderBy `[sortOrder asc, publishedAt desc]`；返回 `{items,total,page,pageSize}`，item **只含** id/title/coverUrl(presign 3600s)/durationSec/tags——列表不返回 videoUrl（防批量爬直链） |
| GET | `/categories` | active 类型列表；Redis 缓存 30-60s（公开免登录端点，切 tab 高频） |
| GET | `/:id` | 详情：PUBLISHED 否则 404；返回 + videoUrl(presign 3600s) + coverUrl + description + tags + authorName + publishedAt + durationSec/width/height + **canViewProcess**（allowViewProcess && PUBLISHED && canvasProjectId 非空，一次 canvasProject.findUnique 校验画布存在）+ **canClone**（allowClone && PUBLISHED && canvasProjectId 非空，原始开关值）。**详情端点禁止 readCanvas**（videoEdit 判定在 process/clone 中做，见 §4.6/§4.7）——公开热点端点不得冷载 Yjs doc |
| POST | `/:id/view` | 观看 +1（匿名，Redis IP 去重 1h + 限流，见 §4.5） |
| POST | `/:id/like` | 喜欢 toggle ±1（**要求登录** D15，未登录 401；userId 去重，见 §4.5） |
| GET | `/:id/process` | 创作过程快照（PUBLISHED + allowViewProcess + 画布存在，否则 404；readCanvas 有界超时→503；Redis 缓存 TTL 300s；白名单见 §4.6） |
| POST | `/:id/clone` | 克隆到当前用户默认团队（未登录 401；校验见 §4.7） |

**路由声明顺序红线（泛化）**：所有 controller 的静态段路由（`categories`、后台的 `tags`/`settings`/`candidates`/`upload-cover`）必须声明在参数路由 `:id` 之前——NestJS 按声明顺序匹配，静态段会被 `:id` 吞掉。

**轮播取数口径（D11）**：复用列表端点，由前端组装——scope=all → `GET /?page=1&pageSize=11`；scope=category → `GET /?categoryId={当前作品}&page=1&pageSize=11`（当前作品 categoryId 为 null 时降级 all）；前端过滤掉当前作品后取前 10 条渲染 CarouselBar；轮播仅存在于播放 Modal 内（列表页无轮播）。

### 4.3 后台 API（`/api/admin/video-works`，AdminGuard 路径前缀保护）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/`、`/:id` PUT/DELETE | 作品 CRUD；发布时服务端自动设 publishedAt（请求体不接受该字段）；viewCount/likeCount 可直接编辑（覆盖式）。**删除红线：DELETE 只删 DB 行，禁止调用 minio.delete**——videoKey 与源 Media 指向同一 MinIO 对象（自持副本非所有权），删对象会击穿素材库；HomeBanner"先删对象再删行"的先例**不可照抄**；coverKey 自有上传对象 v1 也统一不删（零风险，后续手动清理） |
| GET | `/candidates` | 候选视频池：分页 + orderBy createdAt desc；口径见 §4.4；返回 id/key/**projectId（→canvasProjectId 来源，D16）**/thumbnailKey/durationSec/width/height/createdAt + 预览 presign URL。**跨团队可见是有意设计**（admin 策展全站导出，登记 R11），非越权缺口 |
| POST | `/upload-cover` | multipart 封面上传（本模块自有端点，不复用 HomeBanner 的）；校验 magic-number 为图片（先例 admin-home-banner.controller.ts） |
| GET/POST/PUT/DELETE | `/categories`、`/tags` 子资源 | 类型/标签池 CRUD（静态段路由先于 `:id` 声明） |
| GET/PUT | `/settings` | 轮播设置读写（VideoWorkSetting 单行 upsert；GET 无行返回默认值） |

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

metadata JSON 无索引 → JSON 条件不走索引，但 where 基础列（type/status/deletedAt）已补组合索引（§3.2）。选中后复制 key/metadata(durationSec 取整,width,height)/thumbnailKey/**projectId→canvasProjectId**（D16，videoMediaId 取 media.id 同源）到 VideoWork。

### 4.5 view/like 计数语义（D6/D15）

- **view（匿名）**：计数定位 = 互动量，非独立用户数（IP ≠ 人：NAT 共享、换网重刷——已知妥协，接受）。Redis key `videoWork:view:{workId}:{ipHash}` TTL 1h，存在则不计。
- **like（登录，D15）**：未登录 401。Redis key `videoWork:like:{workId}:{userId}`，**SET key 1 NX EX 7776000（90 天）原子判断**（勿 GET-再-SET，并发双击会 +2）：NX 成功 → delta=+1；NX 失败且键存在 → delta=-1 并删键。90 天 TTL（"很久以前点过的不再记忆"可接受，避免键永久驻留）。前端 localStorage 记本机态负责"再点取消"UX（展示层状态以后端计数为准）。
- **DB 原子下界保护**：`UPDATE "VideoWork" SET "likeCount" = GREATEST("likeCount" + ${delta}, 0) WHERE id = ${id}`（$executeRaw，防负数）。
- **限流复用 RateLimiterService**（common/services/rate-limiter.service.ts，勿新写 INCR/EXPIRE）：`checkIpRateLimit(ip, action, windowSec, max)` 用于 view（如 60s/30 次）；注意其默认白名单 127.0.0.1/::1 本地不限流；**REDIS_CLIENT 为 app 级 provider，VideoWorkModule 需自行 provide**（先例 media.module.ts）。全局 ThrottlerGuard 未挂 APP_GUARD（已验证），不依赖它。
- **IP 取值**：复用 `RateLimiterService.getClientIp`（已实现 X-Forwarded-For/X-Real-IP 优先，兼容 APISIX）。已知削弱点：main.ts:82 `trust proxy: true` 信任任意 XFF → view 去重/限流 key 可被伪造刷大——互动量语义接受，登记 R6；like 已由登录 userId 去重免疫（D15）。
- **后台编辑**：update 直接覆盖设值，不叠加。

### 4.6 创作过程快照 + 字段白名单（D8，安全核心）

**type 键唯一真值来源 = `NODE_TYPES`（nodeStore.ts:6-13）**：`imageGen / imageExtGen / textInput / videoGen / audioGen / multiImageGen` + 注册表另有 `videoEdit / group`（CanvasView.tsx:42-51）。**注记**：`isTextNode`（nodeStore.ts:207）用 `'text'` 判断、nodeStore 部分测试 fixture 也用 `'text'`——与 NODE_TYPES.TEXT=`'textInput'` 不符，**白名单实现勿参照**（既有不一致不在本任务修，按 CLAUDE.md 只指出）。

**三条红线**：
1. PromptValue 对象只取 `.text`，**永不返回 `.html`**（tiptap 富文本 → 存储型 XSS 源）；注意 `textInput.prompt` 与 `multiImageGen.prompt` 是**纯 string**（非 PromptValue），直接保留。
2. `textInput.content` 存的是 **tiptap HTML**（TextInputNode onUpdate 存 `editor.getHTML()`）——服务端做 HTML→纯文本转换后返回（标签剥净），前端用文本节点渲染，**禁 innerHTML/dangerouslySetInnerHTML**。
3. 过滤只发生在**服务端**（GET /:id/process 响应构造处），不靠前端自觉。

**响应结构**：

```ts
{
  workId, title,
  nodes: Array<{ id, type, position:{x,y}, width?, height?, parentId?, data: WhitelistedData }>,
  edges: Array<{ id, source, target }>  // readCanvas 返回 {id, sourceId, targetId}，服务端显式映射
}
```

**data 字段白名单表**（按真实类型键；未列出的字段一律剥离；未知类型默认全剥）：

| 节点类型 | 保留字段 | 剥离示例（必须） |
|---|---|---|
| textInput | content（**HTML→纯文本转换后**）、prompt（string） | — |
| imageGen / imageExtGen | prompt?.text、style、model、quality、ratio、resolution、aspectRatio、aiTool | fileId、mediaUrl、referenceImage、mediaName、allImages（整个字段，含 url）、prompt.html、prompt.referencedImageIds、extConfig（**整体剥离**——内含嵌套 prompt.html，将来若保留须先剥 extConfig.prompt）、generationBatchId、editMode、status |
| videoGen | model、ratio、prompt?.text、trimStart、trimEnd | fileId、mediaUrl、referenceVideo、allImages、trimmedFileId、trimTaskStatus、status |
| audioGen | model、content | fileId、referenceAudio、status |
| multiImageGen | prompt（string）、label | images（整个字段，含 url）、generationBatchId、nodeStatus、mainImageIndex、expanded |
| videoEdit / group | group 的 cells（子节点 id 列表，结构字段，保留以渲染组框）；videoEdit 仅结构字段 | 其余全部 data |
| 未知类型 | （仅结构字段） | 全部 data（R8：nodeTypes 注册表每个 key 必须在本表有显式条目，测试红线防漏） |

**节点显示标题**：类型图标+类型名+序号（mediaName 属必剥字段，不放行；multiImageGen 的 label 为用户自由文本可显示）。

**产物缩略图（v1 内实现，提前自增强批次）**：服务端在响应构造时收集各节点 data.fileId → 批量 `media.findMany({where:{id: in}})` 取 thumbnailKey → presign（3600s）→ 注入 `data.thumbnailUrl` → 随后剥离 fileId。Media 已删/无 thumbnail 则不注入（前端占位）。只给缩略图，不给原图/媒体 id——学习价值与安全面兼顾。

**shadow- 临时节点过滤**：`shadow-` 前缀节点与 `__ephemeral` 标记（AI 重生成临时节点，ydocBuilder.ts 约定）及其相连边，快照与克隆**都必须过滤**。

**画布存在性与超时**：process/clone 前置 `canvasProject.findUnique` 校验（不存在 → 404）——Hocuspocus 与 API **同进程**（collab.gateway 构造于 onModuleInit），loadDocument 对不存在项目返回空 doc 不报错，不前置校验会产出空快照 200；readCanvas 外套有界等待（Promise.race，如 5s）→ 超时 503（失败面是 Redis/DB 异常或挂起，非"collab 离线"）。

**缓存与新鲜度**：Redis `videoWork:process:{workId}` TTL 300s（readCanvas 直连加载整个 Yjs doc，公开端点必须挡住爬虫/热链；纪律参照 media.service.ts:16-31——TTL < 资源 TTL、构造后写缓存）。作品编辑/上下架时主动删缓存。**新鲜度 ≤5min**：作者策展后继续编辑画布，快照 5 分钟内随之漂移——接受并登记（R9）；readCanvas 支持 sv 钉版为后续增强。

**安全验收用例（必须，键级+正向配对）**：
- **键级断言**：递归收集响应对象全部 key，断言不含 `html/fileId/mediaUrl/referencedImageIds/allImages/referenceImage/referenceVideo/referenceAudio/trimmedFileId/generationBatchId/mediaName`（键级而非子串——子串断言会被用户内容污染：content 里写个 "url" 就假红）。
- **正向断言（防 key 写错时全绿）**：fixture 放 `type:'textInput'`、`data.content:'<p>一只猫在窗台上</p>'` → 断言响应含纯文本"一只猫在窗台上"；imageGen 断言 prompt.text 保留；multiImageGen 断言 prompt 保留。
- **edges 断言**：`edges[0]` 有 `source/target` 且无 `sourceId` 键。
- **nodeTypes 全覆盖**：注册表每个 type key 在白名单表有条目，否则测试红。
- 危险夹具：content 嵌 `<img src=x onerror=alert(1)>` → 断言响应文本中无 `<` 标签残留。

### 4.7 克隆（D9：工作流配方）

```ts
// video-work-clone.service.ts
async clone(workId, userId) {
  const work = 校验(status==PUBLISHED && allowClone && canvasProjectId 存在) 否则 404/403;
  const { nodes, edges } = await 有界超时(readCanvas(work.canvasProjectId)); // 超时 503
  const filtered = 过滤(nodes, edges, {
    dropTypes: ['videoEdit'],            // 剥离剪辑节点及相连边（sourceNodeId 全局唯一，克隆体必 403）
    dropIdPrefixes: ['shadow-'],         // AI 重生成临时节点及相连边
    stripDataFields: 克隆剥离集,          // fileId/mediaUrl/thumbnailUrl/allImages/referenceImage/referenceVideo/referenceAudio/trimmedFileId/mediaName/generationBatchId/…
  });
  const { nodes: remapped, edges: mappedEdges } = 重发节点id(filtered); // idMap + edges 映射（先例 template.service.ts idMap 写法）
  const project = await projectService.create(`${work.title} (副本)`, userId, remapped, mappedEdges);
  return { projectId: project.id };
}
```

- **克隆 = 工作流配方**（D9）：提示词/参数/节点结构完整保留，产物资源位为空（fileId/mediaUrl 已剥）——用户克隆后**重新生成**内容；"复制项目"按钮的预期文案在 UI 中体现"克隆工作流"语义。含 videoEdit 节点的作品**可直接克隆**（剥离后无冲突），原"禁克隆"限制解除，canClone 不再判定 videoEdit、后台保存校验移除。
- **重发节点 id**：彻底解耦源/克隆体（画布节点 id 虽无全局唯一约束，但重发后零关联，且与 sourceNodeId 类未来约束天然隔离）。
- 复用底层原语：`CollabDocumentService.readCanvas` + `ProjectService.create`（写 ProjectMember(PROJECT_OWNER)；不传 teamId → ensureDefaultTeam 归属克隆者默认团队；支持 parentId/width/height 完整写入）。
- **不复用** TemplateService.import（丢 parentId/width/height + Template 语义污染 + importCount 虚增，已验证 template.service.ts:245）。
- 不复制 CanvasDoc（withDoc 断连时 compact upsert 自动生成）、CanvasDocUpdate（seq 全局冲突）、原项目成员、VideoProject（videoEdit 已剥离，无工程可言）。
- 已知丢失：viewport（readCanvas 只返回 nodes/edges，接受）。
- 未登录：handler 内 req.user 为空 → 401（公开前缀下 optional auth 已挂 req.user）。
- **克隆限流**：登录用户每用户限流（RateLimiterService，如 10 次/h——每次克隆建 CanvasProject + Yjs doc，防脚本化滥用）。

### 4.8 播放与下架

- presign GET 3600s 直连（Range 已验证 206 可用，进度条正常）。
- 下架（status→DRAFT/DELETE）：列表/详情/process 立即 404；已发出 URL ≤1h 后自然失效（D10）。
- 前端 video onError → 重拉详情刷新 URL（TTL 到期自愈）。

### 4.9 路由/守卫/模块注册

- `auth.guard.ts` PUBLIC_PREFIXES += `/api/video-works`（+1 行）。
- admin controller 路径 `/api/admin/video-works` 由现有 AdminGuard 前缀机制自动保护（无需装饰器，与现有 admin 模块一致）。
- **模块 imports**：`ProjectModule`（导出 ProjectService）、`CollabModule`（导出 CollabDocumentService）——DI 先例：TemplateService 已注入 ProjectService、video-project.service 已注入 CollabDocumentService；PrismaModule/MinioModule 为 @Global。REDIS_CLIENT 为 app 级 provider，需在 VideoWorkModule 自行 provide（先例 media.module.ts）。

## 5. 前端设计

### 5.1 路由（公开组 AppLayout，免登录，D14 复用暗色外壳）

**单条路由 + 可选参数**：`path: '/videos/:id?'`（react-router 可选段）渲染同一 VideosPage 实例——避免 `/videos` 与 `/videos/:id` 两条平级路由导致点卡片时整页重挂（列表/ tab/滚动位置丢失、Modal 弹在空列表上）。组件内 `useParams().id` 驱动 Modal 开关：有 id → 弹对应作品播放 Modal（分享直链）；无 id → 关闭。点卡片 → `navigate(/videos/${id})`；关闭 Modal/浏览器返回键/Esc → 返回 `/videos`。

**Sidebar 入口**：NAV_ITEMS 加第 5 项「视频作品」（`/videos`，VideoCameraOutlined 图标）；Sidebar 高亮是 pathname.startsWith 前缀匹配，`/videos/:id` 自动保持高亮，无需额外处理。

**新页面必须 `lazy()` 懒加载**（router.admin.test.tsx 会连带加载 router 静态 import，与既有约定一致）。

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

- 中央按钮组按作品动态渲染：「查看制作过程」仅 canViewProcess；「复制项目」仅 canClone（在创作过程视图顶栏，按钮语义为"克隆工作流"——产物资源位为空需重新生成）。
- 喜欢 toggle：**未登录 → 跳登录（D15）**；登录后 localStorage 记本机态；点/再点调 POST /:id/like。
- 分享：`navigator.clipboard.writeText(location.href)` + message 提示。
- 视频/封面 URL 走 **/flowai/<key> 同源改写**（复用 mediaApi.ts:6 的改写约定——视频 seek 依赖同源拿 Content-Range），videoWorkApi 沿用同一改写函数。
- 视频 onError → 重拉详情刷新 presign URL。
- 未登录点「复制项目」→ 跳登录；**登录后回 /videos 列表**（定案：RequireAuth 无回跳能力——裸 Navigate to="/login" 丢 location、登录页硬编码跳 /canvas；不改造全局登录链路，符合 D2）。
- 骨架屏/空态复用 CardGridSkeleton / EmptyState 模式。
- **播放 Modal 外壳复用 BaseFullscreenModal**（portal 到 body、z-[100000]、Esc、body 滚动锁、焦点恢复）；注意 App.tsx `zIndexPopupBase: 11000` 的 antd 弹层叠放。antd 版本 5.22.5 **无 styles prop**（5.23+ 才有）——Modal 细粒度样式用 className，勿用 styles API。

### 5.5 列表卡片（D13）

只显示：封面（16:9，coverUrl，无封面占位）+ 时长角标（mm:ss，右下）+ 标题（单行截断）+ 标签 chips。**不显示**作者/日期/观看数/喜欢数。

### 5.6 Admin 后台（/admin/content/video-works，菜单注册 AdminLayout）

- **作品管理**：ProTable（标题/类型/状态/观看/喜欢/排序/更新时间）+ ModalForm：
  - 候选视频选择（下拉 + 缩略图预览，数据来自 /candidates）
  - 标题/简介/作者名/类型（select）/标签（ProFormSelect mode="tags"，选项来自标签池）/排序/上下架（Switch 或状态列操作）
  - allowViewProcess / allowClone 开关（D9 解除限制后 allowClone 无画布类型约束）
  - viewCount/likeCount 数字输入（后台可调）
- **类型管理 / 标签管理**：同页 Tab 或子区块，ProTable+ModalForm 轻量 CRUD。
- **轮播设置卡片**：carouselEnabled 开关 + carouselScope 单选（全部作品/同类型），读写 /settings。

## 6. UI 规范

Mockup 参考：`.superpowers/brainstorm/601-1789488912/content/videos-ui-v2.html`（三屏，**浅色顶栏仅作布局示意——实际为暗色 AppLayout + 左侧 Sidebar，D14**）。

- **列表页（暗色）**：AppLayout 内容区 + 圆角 pill 类型 tab（选中态用现有暗色 token，如 --ve-* 系）+ 4 列卡片网格（暗色卡面、边框 --canvas-node-border 系）+ 居中分页。
- **播放 Modal**：portal 全屏黑底（100dvh，不受主题影响）；封面背景层（opacity .55）+ 上黑下渐变遮罩；顶栏（返回钮 rgba(50,50,50,.45) 毛玻璃 / 头像 / 作者名 / 分隔线 / 标题 | 更新时间 + "含 AI 生成内容"）；中央按钮组（白色"立即观看"主钮 / 毛玻璃"查看制作过程" / 喜欢 / 分享圆钮）；左下简介浮层（含标签 chips）；底部轮播条（16:9 缩略卡，当前项白 ring，其余 50% 遮罩）。
- **创作过程视图**（Modal 内，暗色）：顶栏（作品标题 / 工作流视图切换 / 复制项目按钮（品牌主色 #4ade80 系）/ 关闭 ✕）+ 点阵暗底画布（沿用 --canvas-bg-dot）+ 缩放控件。节点卡：暗色卡面 + 类型图标 + 类型名+序号 + 白名单文本（含产物缩略图 thumbnailUrl）；连线 --canvas-edge。
- 主色用项目现有 token（#4ade80 主色 / --ve-* / --canvas-*）；**不引入 #09caf5**（liblib 参考色，项目内不存在）。

## 7. 测试策略（TDD，strict: true）

每批次红-绿-重构循环；关键用例（controller spec 形态沿用仓库惯例：Test.createTestingModule 后直接调方法，**无 supertest/e2e**——路由顺序类断言用 `Object.getOwnPropertyNames(Controller.prototype)` 声明序，或列为 curl 手工验收步骤）：

**后端（service/controller spec）**：
1. 候选列表口径：metadata.origin='video-project' 断言（非画布导出的 generated 不出现）；**返回 projectId**。
2. 非管理员访问 admin 端点 403；匿名访问公开列表 200 且 DRAFT 不可见。
3. 路由声明序：categories/tags/settings/candidates 静态段在 :id 之前（getOwnPropertyNames 断言）。
4. view 去重：同 IP 1h 内重复请求只 +1。
5. like：匿名 401；登录 toggle +1/-1（SET NX 原子）；GREATEST 下界（刷到 0 不为负）；限流 429。
6. **快照安全验收（键级+正向配对）**：递归收集响应 key 不含 `html/fileId/mediaUrl/referencedImageIds/allImages/referenceImage/referenceVideo/referenceAudio/trimmedFileId/generationBatchId/mediaName`；正向断言（textInput 的 content 纯文本在、imageGen prompt.text 在、multiImageGen prompt 在）；危险夹具（嵌 `<img onerror>` 的 content 转纯文本无标签残留）；edges 有 source/target 无 sourceId；DRAFT 或 allowViewProcess=false 或画布不存在 → 404；readCanvas 挂起 → 有界超时 503；缓存命中（第二次请求不触 readCanvas）；**详情端点 spy 断言 readCanvas 0 次**；nodeTypes 注册表全覆盖白名单表。
7. 克隆：新项目含 nodes/edges（含 parentId/width/height）；节点 id 已重发；克隆体 data key 不含剥离集字段；无 videoEdit/shadow- 节点及相连边；Template 行数与 importCount 不变；未登录 401；canvasProjectId 空/不存在 → 404。
8. 发布自动设 publishedAt；请求体带 publishedAt 被忽略。
9. candidates 分页；pageSize=9999 clamp 50；settings 无行返回默认值。

**前端（Vitest + TestingLibrary）**：
1. 列表渲染：卡片只含 封面/时长/标题/标签（断言不含作者/日期/计数节点）。
2. /videos/:id 自动开 Modal；关闭返回 /videos；**关闭后再按浏览器返回 → 离开列表页（不产生 back 循环）**。
3. canViewProcess=false 时不渲染「查看制作过程」按钮。
4. 喜欢：未登录跳登录；登录 toggle 本地态 + API 调用。
5. ProcessSnapshot 纯文本渲染（无 dangerouslySetInnerHTML）。
6. onError 触发详情重拉。

**测试触点**：auth.guard.spec.ts **新增**一条公开路径用例（既有 7 条逐条断言不含计数，无需改）；router.admin.test.tsx 过滤器硬编码前缀（content/ 不在其中）**不会变红**——新增 admin 页覆盖靠本功能自建测试，不改既有测试。

**验证命令**：web 侧无独立 typecheck 脚本（tsc -b 在 build 内）→ 用 `pnpm --filter @flowweb/web build`；api 侧 `pnpm --filter @flowweb/api test`。

## 8. 实施批次

| 批 | 内容 | 验收 |
|---|---|---|
| 1 | schema + migration（prisma migrate dev --name add_video_work，含 Media 候选索引）+ 模块骨架 | migrate deploy 后 diff 零差异；模块可启动 |
| 2 | 后台 CRUD + 类型/标签 CRUD + 候选列表（含 projectId）+ 封面上传（magic-number 校验）+ 设置端点（默认值兜底） | service spec 覆盖候选口径；非 ADMIN 403 |
| 3 | 公开列表 + 详情 + presign + PUBLIC_PREFIXES | 匿名 curl 200；DRAFT 404；详情 readCanvas 0 次 |
| 4 | view 计数（IP 去重）+ like（登录 userId 去重）+ RateLimiterService 限流 | 去重/下界/429/匿名 401 用例全绿 |
| 5 | 创作过程快照（含产物缩略图注入、edges 映射、shadow- 过滤）+ ProcessSnapshot 只读渲染 | 键级+正向安全断言全绿 |
| 6 | 克隆（videoEdit/shadow- 剥离 + 敏感字段剥离 + 重发 id） | 克隆断言 + Template 不变 |
| 后续增强 | readCanvas sv 钉版（快照版本绑定，消除 ≤5min 漂移） | — |

**上线顺序（修正）**：deploy.sh 的 api 上传**只含 apps/api/src，不含 prisma/migrations**——直接 migrate deploy 会空跑（No pending migrations）后应用 500。正确顺序：**全量部署（或手动上传 prisma/migrations 目录）→ `npx prisma migrate deploy` → 重启 api**。db push 禁用。

## 9. 风险登记

| # | 风险 | 级别 | 处置 |
|---|---|---|---|
| R1 | 快照泄露 prompt.html/内部 id/素材 URL | 高 | §4.6 白名单 + 三红线 + 键级/正向安全验收必测 |
| R2 | **既有洞：GET /api/media/by-key 匿名任意 key→presign URL 兑换口**（PUBLIC_PREFIXES 白名单 + 无归属校验，media.controller.ts:23-28）——使"剥离 key/fileId"的价值打折（拿到 key 即可兑换 URL） | 高（既有） | 独立 ticket 处理（移出白名单+加归属校验）；本功能不扩大暴露面（快照/详情/克隆响应不含任何 key/id），不将其作为本功能前置 |
| R3 | 克隆体产物资源位为空（fileId/mediaUrl 剥离） | 低 | D9 有意设计（工作流配方），UI 文案体现"克隆工作流、重新生成" |
| R4 | 下架后 URL ≤1h 残留 | 中 | D10 接受；onError 自愈 |
| R5 | 团队解散删 MinIO 对象 → 作品坏链 | 中 | 自持 key 解 DB 耦合；详情容错（D3）；删除为异步队列、只删主 key、吞错无重试（既有行为） |
| R6 | view 计数可刷（trust proxy=true 下 XFF 可伪造 + 全局 Throttler 未生效） | 中 | 端点级 RateLimiterService + IP 去重；like 已登录免疫（D15）；互动量语义接受残余 |
| R7 | 候选列表 JSON 条件不走索引 | 低 | 已补 type/status/deletedAt 组合索引缓解 |
| R8 | 快照白名单需随节点类型演进维护 | 低 | 未知类型默认全剥 + nodeTypes 全覆盖测试红线 |
| R9 | 快照新鲜度 ≤5min（作者策展后继续编辑画布，缓存窗口内漂移） | 低 | 接受并登记；作品编辑/上下架主动删缓存；sv 钉版为后续增强 |
| R10 | 同一 Media 可重复策展 / candidates 跨团队可见 | 低 | 均为有意设计（策展场景），登记非缺陷 |
| R11 | 无 og 标签 → 社交分享无预览卡 | 低 | 范围外；需 SSR，未做 |
| R12 | 生产 Nginx /flowai 反代 Range 透传 | 中 | 上线前置实测（video-editor plan 已有双验法：curl 206 + DevTools 多次 206 无 range 警告；需 proxy_force_ranges on） |
| R13 | isTextNode 用 'text' 与 NODE_TYPES 不符（既有不一致） | 低 | 白名单实现勿参照（§4.6 注记）；不在本任务修 |
| R14 | "白名单外 key 静默丢弃"行为测试属 settings 模块 | — | 本任务不碰 settings 模块，不补该测试 |

**既有安全洞独立 ticket（本功能不处理、不作前置）**：① /api/media/by-key 公开兑换口（R2）；② POST /api/image-edit/outpaint\|erase\|redraw 无授权；③ POST /api/templates/:id/import 原样复制节点 data（同类引用外泄已存在于线上路径）。

## 10. 范围外（明确不做）

- 用户发布 + 后台审核流（预留 PENDING_REVIEW 枚举扩展点，后续独立功能）
- 标签筛选（has 查询 + 索引另开）
- og 社交预览卡片（需 SSR）
- 下架秒级失效（服务端流式端点）
- 全局限流修复（挂 APP_GUARD ThrottlerGuard）——仅做 view/like/clone 端点级限流
- 登录回跳改造（不做全局链路改动，登录后回 /videos）
- 快照 sv 钉版（后续增强批次）
- 三条既有安全洞修复（独立 ticket，见 §9）

