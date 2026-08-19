# 文件夹持久化（后端阶段）设计

日期：2026-08-19
前置 spec：`2026-08-18-workspace-project-folders-design.md`（本文细化其 §12 预留方向，并消除 §9 的 4 个 mock 阶段限制）

## 1. 背景与目标

工作台的文件夹当前是前端会话状态（`fixtures.ts` + `localFolderMap` + 占位画布机制）。本特性把文件夹变为真实持久化数据：

- 新增 Folder 表与文件夹 CRUD API
- Template 落库归属（folderId），画布创建即产生真实记录（占位机制整体删除）
- 前端数据层直连 API，服务端分页
- 提供孤儿 CanvasProject 草稿清理端点

## 2. 已确认决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | 新建画布何时入列 | **创建即入列**：`POST /api/canvases` 事务内建 CanvasProject + 空 Template（folderId 落库），真实 id 立即出现在列表 |
| 2 | Folder 归属字段 | **userId**（与现有全部表及手动鉴权模式一致）；不加 workspaceId，团队空间阶段再加列 |
| 3 | Template (name,userId) 唯一约束 | **纯删除**，允许同名。Prisma 5.22 声明不了条件索引且无 type 字段可作条件；画布同名是合理需求 |
| 4 | 草稿清理形态 | **DELETE /api/projects/drafts 端点**，带 24h 时间窗口保护 |
| 5 | 文件夹同级重名 | **service 层校验**（同 userId 同 parentId 下重名 → 400）。不用 DB 约束：parentId 为 NULL 时 PG 默认 NULLS DISTINCT 拦不住根目录重名 |
| 6 | 删除非空文件夹 | **自动移根目录**（onDelete: SetNull 天然支持），非拒绝。前端弹窗文案："内含画布将移至根目录" |
| 7 | 画布状态区分 | Template 加 **status: DRAFT / SAVED**。PUBLISHED 命名被否（与 isPublic 语义冲突）。"未保存"标签 UI 一期不做 |
| 8 | 文件夹级联 updatedAt 语义 | **内容构成变化才 touch**：创建入夹、移动、删除、改名。isPublic 切换、描述修改、内容保存不 touch（避免文件夹排序抖动） |
| 9 | Template ↔ CanvasProject 基数 | **1 工程 : 1 画布记录**，`projectId @unique` 落库保证；与 save upsert 语义一致 |
| 10 | 旧 `POST /api/templates` 端点 | **随本次移除**：前端唯一调用方 SaveAsTemplateDialog 已切 save 端点，且 @unique 落库后旧端点会撞约束，双入口语义分叉 |

## 3. 数据模型（Prisma）

### 3.1 新增 Folder 表

```prisma
model Folder {
  id        String   @id @default(cuid())
  name      String   @db.VarChar(255)
  parentId  String?                    // 自引用，一期恒 null（根级）
  userId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  parent    Folder?    @relation("FolderHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
  children  Folder[]   @relation("FolderHierarchy")
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  templates Template[]

  @@index([userId, parentId])
}
```

遵循库内惯例：cuid 主键、`createdAt/updatedAt`、外键 Cascade（userId）/SetNull（parentId，同 MaterialFolder 先例）。

### 3.2 Template 表变更

```prisma
enum TemplateStatus {
  DRAFT      // 已创建未首次保存（POST /api/canvases 产生）
  SAVED      // 已通过保存端点快照过内容
}

model Template {
  // ...现有字段不变
  folderId   String?
  folder     Folder?   @relation(fields: [folderId], references: [id], onDelete: SetNull)
  projectId  String?  @unique                   // 现有字段，补 relation + 唯一约束（1 工程 : 1 画布记录）
  project    CanvasProject? @relation(fields: [projectId], references: [id], onDelete: SetNull)
  status     TemplateStatus @default(DRAFT)

  // 删除：@@unique([name, userId])
  @@index([folderId])
}

model CanvasProject {
  // ...现有字段不变
  templates  Template[]                    // 反向 relation，Prisma 要求两侧声明
}
```

- `status` 用于区分"刚建还没写内容的草稿"与"已保存画布"，后续自动保存、缩略图生成、排序可复用
- 补 `Template ↔ CanvasProject` relation（原 projectId 为裸字符串）：save upsert（findUnique by projectId）、删除级联、drafts 查询（`templates: { none: {} }`）三处依赖它
- `projectId @unique` 数据库层保证一个工程至多一条画布记录，import 首存并发安全由约束兜底

### 3.3 迁移清单（prisma migrate）

1. `CREATE TYPE "TemplateStatus"`、`CREATE TABLE "Folder"`（含 FK 与索引）
2. `Template` 加 `folderId` 列 + FK + 索引
3. `Template` 加 `status` 列（DEFAULT 'DRAFT'）
4. **Backfill**：`UPDATE "Template" SET status = 'SAVED'`（存量均为已保存模板）
5. `DROP CONSTRAINT "Template_name_userId_key"`
6. `Template.projectId` 加 FK → CanvasProject ON DELETE SET NULL。**加 FK 前先清理无效引用**：`UPDATE "Template" SET "projectId" = NULL WHERE "projectId" IS NOT NULL AND "projectId" NOT IN (SELECT "id" FROM "CanvasProject")`
7. **去重后再加 `projectId` 唯一约束**：旧行为是每次"保存项目"都新建 Template，同工程多次保存会产生多条同 projectId 记录。保留每组最新一条（createdAt 最大），其余置 NULL 脱钩（不删数据，降级为无工程关联的历史模板）：
   ```sql
   UPDATE "Template" SET "projectId" = NULL
   WHERE "projectId" IS NOT NULL AND "id" NOT IN (
     SELECT DISTINCT ON ("projectId") "id" FROM "Template"
     WHERE "projectId" IS NOT NULL
     ORDER BY "projectId", "createdAt" DESC
   );
   CREATE UNIQUE INDEX "Template_projectId_key" ON "Template" ("projectId");
   ```

## 4. API 设计（NestJS）

新增 `folder` 模块；扩展 template/project 模块。鉴权沿用现状（控制器内手动 `(req as any).user?.id` 校验），异常沿用 `NotFoundException / ForbiddenException / BadRequestException`。

### 4.1 文件夹 CRUD

| 端点 | 入参 | 行为与返回 |
|---|---|---|
| `GET /api/folders` | — | 当前用户文件夹列表。一次查询聚合（避免 N+1）：`include: { templates: { take: 3, orderBy: { updatedAt: 'desc' }, select: { id, coverUrl } } }` + `_count.templates`。返回 `{ folders: [{ id, name, parentId, createdAt, updatedAt, canvasCount, thumbnails: [{id, coverUrl}] }] }` |
| `POST /api/folders` | `{ name }`（1–255 字符） | 校验同级重名（同 userId + parentId=null 下同名 → 400 "已存在同名文件夹"）。parentId 一期只接受 null/缺省 |
| `PATCH /api/folders/:id` | `{ name }` | 重命名，同级重名校验**排除自身**（`id: { not: id }`，no-op 重命名不报错）。`@updatedAt` 自动刷新。文件夹不存在/非本人 → 404 |
| `DELETE /api/folders/:id` | — | 直接删除；内含画布经 SetNull 自动移至根目录。count 与 delete 放同一 `$transaction`（同快照，防并发计数不准），返回 `{ movedCanvasCount }`（前端据此提示"N 张画布已移至根目录"） |

### 4.2 画布创建（创建即入列）

`POST /api/canvases`

- 入参：`{ name: string（1–255）, folderId?: string | null }`
- folderId 传入时校验：存在且属于当前用户，否则 400
- **事务**（`prisma.$transaction`）：
  1. 建 CanvasProject：**复用 `ProjectService.create(name, userId)`**（已验证仅建工程行，nodes/edges 关系表由 sync 阶段创建，字段与默认值不遗漏）
  2. 建 Template：`{ name, userId, projectId, folderId, status: 'DRAFT', isPublic: false }`
  3. 若 folderId 非空 → touch 该文件夹（`folder.update` 触发 @updatedAt）
- 返回：`{ templateId, projectId }` —— templateId 用于列表入列，projectId 用于编辑器路由。不用裸 `id`

### 4.3 画布归属移动

`PATCH /api/templates/:id`（扩展 UpdateTemplateDto）

- 新增可选 `folderId: string | null`：null = 移到根目录；传入 id 时校验目标文件夹属于当前用户（防越权），否则 400
- 移动成功后 touch 源文件夹与目标文件夹（null 的跳过）
- 与现有 name/description/isPublic 更新共存于同一端点

### 4.4 保存（upsert，统一工作台与导入两条路径）

`POST /api/projects/:id/save`

- 入参：`{ name, description?, isPublic? }`（对齐现有 SaveAsTemplateDialog 传参）
- 行为：
  1. 校验工程归属（同现有 create 的权限逻辑）
  2. 从工程快照 templateData（nodes/edges/viewport 规范化 + `validateTemplateData`，复用现有 create 逻辑）。空画布首存无需特判——已验证 zod schema 为 `z.array()` 无 `.min(1)`，`nodes: [], edges: []` 本就合法
  3. 按 projectId `findUnique` 关联 Template（@unique 保证确定性）：**存在 → 更新**（templateData、name、description、isPublic、status 置 SAVED）；**不存在 → 创建**（status: SAVED，覆盖"从模板导入"路径的首存）。并发首存由唯一约束兜底
  4. 不 touch 文件夹（内容更新不属于"内容构成变化"，见 §4.8）
- **同步移除旧 `POST /api/templates` 端点**（决策 #10）：save 端点全面替代其创建职责，`CreateTemplateDto`/controller/service 对应入口与测试一并清理

### 4.5 画布删除

`DELETE /api/templates/:id`（扩展现有行为）

- 删除 Template 的同事务内删除关联 CanvasProject（及其 nodes/edges）
- touch 原所在文件夹

### 4.6 草稿清理

`DELETE /api/projects/drafts`

- 删除当前用户满足以下条件的 CanvasProject（含节点/边）：
  - 无任何 Template 关联（反向 relation：`templates: { none: {} }`）
  - `updatedAt < now - 24h`（时间窗口保护：编辑器 syncNodes/syncEdges 持续刷新 updatedAt，正在编辑的 import 工程不会被误删）
- 返回 `{ deletedCount }`
- mock 阶段历史孤儿：部署后手动调用一次即可清理

### 4.7 画布列表分页（扩展现有端点）

`GET /api/templates` 新增可选 `folderId` 参数，**仅在 `type=my` 下生效**（模板/社区场景无文件夹归属概念），controller 层显式 `type !== 'my'` 时忽略该参数：

- 缺省 → 不过滤（现状，社区/搜索场景不受影响）
- `folderId=root`（哨兵）→ `where: { folderId: null }`（根目录）
- 其他值 → 精确匹配（需属于当前用户，否则空结果）

分页返回沿用 `{ templates, total, page, limit, totalPages }`；`type=my` 下返回的 Template 自然携带 folderId、status 字段。

### 4.8 级联 updatedAt 规则（service 层实现）

语义：文件夹 updatedAt = **"内容构成的最后变化时间"**（决策 #8），非"内部任意活动时间"——改描述/切公开不应让文件夹跳到"最近修改"顶部。

| 触发操作 | touch 哪些文件夹 |
|---|---|
| 画布创建入夹 | 目标文件夹 |
| 画布移动 | 源 + 目标（null 跳过） |
| 画布删除 | 原所在文件夹 |
| 画布改名（PATCH `/api/templates/:id` 的 name 路径；save 端点附带的 name 同步不 touch） | 当前所在文件夹 |
| 画布保存 / isPublic 切换 / 描述修改 | **不 touch**（内容变化，非构成变化） |
| 文件夹重命名 | 自身（@updatedAt 自动） |
| 删除文件夹（画布 SetNull 移根目录） | 无需 touch（文件夹已不存在，画布 updatedAt 不变） |

## 5. 前端改造

### 5.1 useWorkspaceData（核心改造点）

- **删除**：`fixtures.ts` 整个文件、`MOCK_FOLDERS`、`buildInitialFolderMap`、`folderMap` 状态、占位画布机制、`deletePlaceholder`
- 文件夹 CRUD 直连 API（保留现有乐观更新 + 失败回滚 + `message.error` 模式）：
  - `createFolder` → `POST /api/folders`；`renameFolder` → `PATCH`；`deleteFolder` → `DELETE`（成功后按 `movedCanvasCount` 提示，画布列表 reload）
  - 移动/删除/新建画布后乐观更新对应文件夹的 `canvasCount`/`updatedAt`，失败 reload
- `createCanvas` → `POST /api/canvases`：真实记录直接进列表（无占位），返回 `{ templateId, projectId }`，导航编辑器用 projectId
- 画布加载：`getCanvases({ folderId: 'root' | folderId, page, limit })` 调 `GET /api/templates?type=my&folderId=...`；文件夹切换重置 page

### 5.2 API 客户端

- 新增 `folderApi.ts`（list/create/rename/remove）
- 新增 `canvasApi.ts`：`createCanvas(name, folderId?)`、`saveCanvas(projectId, payload)`、`cleanDrafts()`
- `templateApi.ts`：`updateTemplate` 入参类型加 `folderId`；`getTemplates` 查询类型加 `folderId`；**删除 `createTemplate` 函数**（端点已移除，调用方改用 `saveCanvas`）
- **删除** `projectApi.createProject` 前端函数（仅 useWorkspaceData 使用，自然完成 createProject → createCanvas 改名）

### 5.3 SaveAsTemplateDialog

- `createTemplate({ projectId, ... })` 改调 `POST /api/projects/:id/save`，交互不变

### 5.4 分页 UI

- 文件夹视图与根目录各自分页（单状态，切换文件夹重置）
- 列表底部"加载更多"按钮，`hasMore = page < totalPages`，点击追加下一页

### 5.5 零改动组件

FolderCard、CanvasCard、各 Modal（移动/重命名/新建）等消费 FolderViewModel/Canvas 形状不变。唯一文案变更：删除文件夹确认弹窗改为"内含画布将移至根目录"。

## 6. 数据流（创建即入列）

```
工作台新建画布
  → POST /api/canvases {name, folderId}
  → 事务：CanvasProject + 空 Template(DRAFT, folderId) + touch folder
  → 返回 {templateId, projectId}，前端真实入列，导航 /canvas/:projectId
编辑器编辑（syncNodes/syncEdges 刷新工程）
"保存项目"
  → POST /api/projects/:id/save
  → 快照 templateData，Template 更新，status DRAFT→SAVED（不 touch 文件夹）
从模板导入（不变）
  → POST /api/templates/:id/import（仅建 CanvasProject）
  → 首次保存走同一 save 端点 → 无关联 Template → 创建（SAVED）
```

## 7. §9 已知限制消除对照

| 旧限制 | 解决方式 |
|---|---|
| 文件夹刷新还原 | Folder 表 + folderId 落库 |
| 占位与真实记录并存（id 对不上） | 创建即入列，占位机制整体删除 |
| 删除占位留孤儿 CanvasProject | 新架构不产生孤儿 + `DELETE /api/projects/drafts`（24h 窗口）清历史与 import 流产孤儿 |
| 画布 >100 不分页 | 服务端分页（folderId 过滤 + page/limit）+ 加载更多 |

## 8. 测试策略（TDD）

- **后端**（Vitest 单测，mock PrismaService，沿用 template.service.spec 模式）：
  - folder service/controller：CRUD、同级重名 400、**重命名排除自身（no-op 不报错）**、他人文件夹 404、删除返回 movedCanvasCount（count+delete 同事务）、列表聚合（_count + take 3）
  - canvases 创建：事务、folderId 归属校验、复用 ProjectService.create、返回 {templateId, projectId}
  - template 扩展：folderId 移动 + touch 源/目标、目标文件夹越权 400、删除级联工程；**改名 touch 而 isPublic 切换不 touch**（决策 #8）
  - save：已有 Template 更新（findUnique by projectId，status→SAVED）、无 Template 创建（import 路径）、空画布首存（空数组合法）
  - **移除旧 POST /api/templates 端点及其测试**
  - drafts：无关联 + 24h 窗口两个条件的查询构造、返回 deletedCount
  - 列表：folderId 三态过滤（仅 type=my 生效）+ 分页
- **前端**（Vitest + Testing Library，mock folderApi/canvasApi）：
  - useWorkspaceData：直连 CRUD、乐观更新与回滚、createCanvas 真实入列、加载更多追加
  - SaveAsTemplateDialog：调用 save 端点
- **迁移**：本地库跑 `prisma migrate dev` 验证 backfill 与 FK 清理步骤

## 9. 非目标（本期不做）

- workspaceId / 团队空间（字段不加，到来时再加列）
- 嵌套文件夹 UI（parentId 落库但恒 null）
- DRAFT 画布的"未保存"标签 UI
- 模板中心 / Template type 区分（同名约束问题随之搁置）
- 封面截图生成（coverUrl 行为与现状一致）
