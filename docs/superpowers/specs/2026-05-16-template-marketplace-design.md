# Phase 8: 模板广场 — 设计文档

> **Status:** Approved
> **Date:** 2026-05-16
> **Scope:** 画布项目保存为模板、模板列表/预览/导入、社区分享、官方预设工作流

## 1. 背景

当前项目中"模板广场"仅有 UI 占位（导航栏按钮 + 首页标题），无任何后端实现。`CanvasProject` 模型缺少模板相关字段（userId、isTemplate、category 等），`ProjectService` 无 clone/duplicate/import/export 方法。

本次目标：构建完整的模板系统（创建→存储→浏览→导入），支持个人模板管理、社区公开模板展示、系统官方预设。

## 2. 功能范围

### P0 — 核心（先做）

| 功能 | 说明 |
|------|------|
| 保存为模板 | 画布页面添加按钮，弹出表单（名称、描述、是否公开），自动生成封面 |
| 模板列表页 | 官方预设 / 我的模板 / 社区公开 三栏分类，卡片展示（封面、名称、作者、导入次数） |
| 模板预览与导入 | 点击卡片进入预览页，显示大图+描述+作者，"一键导入"创建新画布项目并跳转 |
| 我的模板管理 | 个人中心新增 Tab：编辑模板信息（名称/描述/公开状态）、删除模板 |
| 模板权限控制 | 公开/私有，私有模板仅创建者可访问 |
| 模板有效性验证 | 导入时 Zod 校验 JSON 结构，防止损坏模板导致画布崩溃 |
| 模板封面自动生成 | 保存时截取画布区域作为封面 |
| 模板搜索与分类 | 按名称搜索，按官方/社区/我的分类筛选，按热度/最新排序 |
| 模板使用统计 | 每次导入 importCount++，列表默认按热度排序 |

### P1 — 体验优化

| 功能 | 说明 |
|------|------|
| 分页 | 模板列表分页（page/limit），默认 20 条/页 |
| 重名处理 | 导入时自动检测重名并追加 "(副本 N)" |
| 列表缓存 | 内存 Map 缓存 5 分钟 TTL，写操作自动清空 |

### P2 — 后续迭代

- 模板版本管理
- 模板点赞/收藏
- 付费模板（依赖支付系统）

### 不在本阶段

- 完整社区社交功能（分享链接、评论）
- MinIO 真实文件上传（封面用占位图，模板数据存 DB JSON 字段）
- dataUrl 大模板存储（预留字段，数据暂一律存 templateData JSON）

## 3. 数据模型

### 3.1 Template（新表）

```prisma
enum TemplateCategory {
  OFFICIAL
  COMMUNITY
}

model Template {
  id           String             @id @default(cuid())
  name         String
  description  String?
  coverUrl     String?            // 封面图 URL（暂用占位，未来 MinIO）
  dataUrl      String?            // 预留 MinIO 大模板数据 URL（未来优化）
  templateData Json?              // 模板 JSON 数据（nodes + edges + viewport）
  userId       String
  isPublic     Boolean            @default(false)
  importCount  Int                @default(0)
  category     TemplateCategory?  // OFFICIAL | COMMUNITY
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt

  user         User               @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([isPublic])
  @@index([category])
  @@index([importCount])
}
```

**业务约束**（Service 层验证）：`templateData` 与 `dataUrl` 至少一个不为空。

### 3.2 CanvasProject（扩展）

```prisma
model CanvasProject {
  id        String       @id @default(cuid())
  name      String
  userId    String?      // 新增：项目归属（兼容已有数据）
  viewport  Json         @default("{ \"x\": 0, \"y\": 0, \"zoom\": 1 }")
  nodes     CanvasNode[]
  edges     CanvasEdge[]
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  user      User?        @relation(fields: [userId], references: [id], onDelete: Cascade) // 新增

  @@index([userId])
}
```

## 4. API 设计

### 4.1 端点总览

| Method | Path | Auth | 权限 |
|--------|------|------|------|
| `POST` | `/api/templates` | ✅ | 验证项目所有权 |
| `GET` | `/api/templates` | ✅ | type 过滤 + 搜索 + 排序 + 分页 |
| `GET` | `/api/templates/:id` | ✅ | 公开模板或创建者可访问 |
| `PATCH` | `/api/templates/:id` | ✅ | 仅创建者可编辑 |
| `DELETE` | `/api/templates/:id` | ✅ | 仅创建者可删除 |
| `POST` | `/api/templates/:id/import` | ✅ | 公开模板或创建者可导入 |

### 4.2 请求/响应格式

**成功响应：**
```json
{ "success": true, "data": { ... } }
```

**错误响应：**
```json
{ "success": false, "error": { "code": "FORBIDDEN", "message": "无权访问此模板" } }
```

### 4.3 DTO

**CreateTemplateDto：**
```typescript
{ projectId: string; name: string; description?: string; isPublic?: boolean }
```

**TemplateListQuery：**
```typescript
{ type?: 'official' | 'my' | 'community'; search?: string; sort?: 'importCount' | 'newest'; page?: number; limit?: number }
```

**UpdateTemplateDto：**
```typescript
{ name?: string; description?: string; isPublic?: boolean }
```

### 4.4 权限过滤

| type | WHERE 逻辑 |
|------|-----------|
| `official` | `{ userId: 'system-official-templates', isPublic: true }` |
| `my` | `{ userId: req.user.id }` |
| `community` | `{ isPublic: true, userId: { not: 'system-official-templates' } }` |

### 4.5 分页响应

```json
{
  "success": true,
  "data": {
    "templates": [...],
    "total": 156,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

每个 template 对象含 `isOwner: boolean`（前端据此显示编辑/删除按钮）。

## 5. 服务层

### 5.1 template.validation.ts（新增）

```typescript
import { z } from 'zod';

const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.any()),
});

const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
});

export const TemplateDataSchema = z.object({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
});

export function validateTemplateData(data: unknown) {
  return TemplateDataSchema.parse(data);
}
```

### 5.2 template.service.ts 核心方法

| 方法 | 权限逻辑 | 说明 |
|------|---------|------|
| `create(dto, userId)` | 验证项目所有权 → 提取 nodes/edges/viewport → validateTemplateData → create | 保存模板 |
| `findMany(query, userId)` | type 过滤 + 搜索 + 排序 + 分页 + isOwner 标记 | 模板列表 |
| `findById(id)` | 无权限检查 | 内部查询 |
| `getTemplate(id, userId)` | 公开模板 或 userId 匹配 → 返回模板 | 模板详情 |
| `update(id, dto, userId)` | 仅 `template.userId === userId` | 编辑模板 |
| `delete(id, userId)` | 仅 `template.userId === userId` | 删除模板 |
| `import(id, userId)` | 公开模板 或 userId 匹配 → 深拷贝 → 验证 → 创建项目 → importCount++ | 一键导入 |

### 5.3 导入流程

```
POST /api/templates/:id/import (userId)
  → findById(templateId)
  → 权限: !isPublic && userId !== creator → 403
  → JSON.parse(JSON.stringify(template.templateData))     // 深拷贝隔离
  → validateTemplateData(projectData)                     // Zod 验证
  → 重名检测: while exists(name, userId) → "副本 N"
  → canvasProjectService.create({ name, userId, ...data })
  → prisma.template.update({ importCount: increment })
  → return { projectId, name }
```

### 5.4 官方模板初始化

在应用启动时（`main.ts` bootstrap）作为一次性任务执行：

```typescript
// main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 初始化官方模板
  const templateService = app.get(TemplateService);
  await templateService.initOfficialTemplates();
  // ...
  await app.listen(env.PORT);
}
```

`initOfficialTemplates()` 使用 `system-official-templates` 作为 userId，upsert 官方模板（category=OFFICIAL, isPublic=true），数据存于 `templateData` JSON 字段。

### 5.5 列表缓存

缓存 key 必须包含 `userId` 和完整查询参数，避免不同用户看到相同数据：

```typescript
private cache = new Map<string, { data: any; timestamp: number }>();
private readonly CACHE_TTL = 5 * 60 * 1000; // 5 min

async findMany(query: TemplateListQuery, userId: string) {
  const cacheKey = JSON.stringify({ query, userId });
  if (this.cache.has(cacheKey)) {
    const cached = this.cache.get(cacheKey);
    if (Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
  }
  // 查询数据库...
  const data = await this.prisma.template.findMany({ ... });
  this.cache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}
```

写操作（create/update/delete）调用 `this.cache.clear()` 清空全部缓存。

## 6. 安全审计

| 检查点 | 威胁 | 对策 |
|--------|------|------|
| `POST /templates` | 用户将他人项目保存为模板 | 验证 `project.userId === userId` |
| `GET /templates/:id` | 访问私有模板 | 公开模板 或 userId 匹配 |
| `PATCH /templates/:id` | 修改他人模板 | `template.userId === userId` |
| `DELETE /templates/:id` | 删除他人模板 | `template.userId === userId` |
| `POST /templates/:id/import` | 导入私有模板 | 公开模板 或 userId 匹配 |
| 模板数据注入 | 损坏 JSON 导致画布崩溃 | Zod schema 验证 |

## 7. 前端设计

### 7.1 路由

```tsx
// 公开路由
{ path: '/templates', element: <TemplateMarketPage /> },
{ path: '/templates/:id', element: <TemplatePreviewPage /> },

// 需登录 (RequireAuth 内)
{ path: '/settings/templates', element: <MyTemplatesPage /> },
```

### 7.2 页面组件

| 组件 | 路由 | 功能 |
|------|------|------|
| `TemplateMarketPage` | `/templates` | 三标签（官方/社区/我的）+ 搜索框 + 排序下拉 + 模板卡片网格 + 分页 |
| `TemplatePreviewPage` | `/templates/:id` | 大封面 + 名称 + 描述 + 作者 + importCount + 一键导入按钮 + 编辑/删除（isOwner） |
| `MyTemplatesPage` | `/settings/templates` | 个人模板列表 + 编辑/删除操作 |
| `SaveAsTemplateDialog` | CanvasTopBar 内 | "保存为模板"按钮 → Modal（名称、描述、公开开关） |
| `TemplateCard` | 复用 | 封面缩略图 + 名称 + 作者 + importCount |

### 7.3 API 客户端

```typescript
// apps/web/src/api/templateApi.ts (新增)
createTemplate(dto: CreateTemplateDto)              → POST   /api/templates
getTemplates(query: TemplateListQuery)              → GET    /api/templates
getTemplate(id: string)                             → GET    /api/templates/:id
updateTemplate(id: string, dto: UpdateTemplateDto)  → PATCH  /api/templates/:id
deleteTemplate(id: string)                          → DELETE /api/templates/:id
importTemplate(id: string)                          → POST   /api/templates/:id/import
```

## 8. 测试策略 (TDD)

### 8.1 单元测试

| 文件 | 覆盖 |
|------|------|
| `template.validation.spec.ts` | 合法/非法 nodes, edges, viewport; 空数据; 损坏 JSON |
| `template.service.spec.ts` | CRUD 权限、导入深拷贝隔离、importCount++、跨用户防越权、重名检测、缓存 |
| `template.controller.spec.ts` | Mock Service，验证 DTO 校验、分页、权限过滤、isOwner 标记 |

### 8.2 集成测试

- 保存→列表→导入完整流程
- 私有模板不可被他人访问/导入
- 官方模板对所有人可见可导入
- 分页与搜索正确性

## 9. 验证标准

- [ ] `pnpm test` 全部通过
- [ ] TypeScript 编译无错误
- [ ] `POST /api/templates` — 创建模板成功（模板数据从项目提取）
- [ ] `POST /api/templates` — 非项目所有者被 403
- [ ] `GET /api/templates` — 分页/搜索/排序/type 过滤全部正确
- [ ] `GET /api/templates/:id` — 私有模板非所有者被 403
- [ ] `PATCH /api/templates/:id` — 非创建者被 403
- [ ] `DELETE /api/templates/:id` — 非创建者被 403
- [ ] `POST /api/templates/:id/import` — 导入创建新项目、importCount++、重名自动处理
- [ ] `POST /api/templates/:id/import` — 私有模板非所有者被 403
- [ ] 模板列表返回 `isOwner` 字段
- [ ] 官方模板 seed 正确初始化
- [ ] 前端 `/templates` 页面渲染模板卡片
- [ ] 前端 `/templates/:id` 预览页一键导入跳转画布

## 10. 不在范围内

- MinIO 真实文件上传（封面用占位，数据存 DB JSON）
- dataUrl 大模板存储（预留字段，数据暂全存 templateData）
- 模板版本管理
- 模板点赞/收藏/评分
- 付费模板
- 完整社区社交（评论、分享链接、用户主页）
- 模板标签（预留 tags 字段但本阶段不实现）
