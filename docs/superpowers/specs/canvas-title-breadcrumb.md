# Canvas 标题栏面包屑改造设计

日期：2026-08-25
状态：已确认（含评审裁决）

## 1. 需求

Canvas 画布页左上角悬浮按钮（[ProjectTitle.tsx](../../../apps/web/src/pages/canvas/components/ProjectTitle.tsx)）三项变更：

1. **Flow123**：绿色 `#4ade80` → 白色，可点击返回工作空间（`/works`）
2. **面包屑路径**：分隔符 `/` 后显示画布所属文件夹的完整层级路径 + 画布名
   - 根目录画布：`💦 Flow123 / 主目录/画布n`
   - 嵌套文件夹画布：`💦 Flow123 / 文件夹A/子文件夹B/画布n`
3. **编辑框边框**：绿色 `#4ade80` → 深灰 `#555`

## 2. 方案总览

独立子资源接口返回 folderId + 前端沿 `Folder.parentId` 拼路径（复用 [useFolderNavigation.ts:23-31](../../../apps/web/src/pages/workspace/hooks/useFolderNavigation.ts) 的 chain 模式）。**不改动** `GET /api/projects/:id` 返回结构。

已否决的备选（记录）：
- `findById` 附带 folderPath：findById 无鉴权是有意的（公开画布访问），附带路径会向任意访问者泄露属主文件夹名称，或在核心接口加属主分支（更复杂）。
- React Query/SWR 缓存、全局 folders Zustand store：项目未用/不存在，超范围；本设计每次进页现请求，无缓存故无一致性问题。

## 3. 后端设计

### 接口

```
GET /api/projects/:id/folder
→ { success: true, data: { folderId: string | null } }
```

- 位于 ProjectController / ProjectService（[project.controller.ts](../../../apps/api/src/modules/project/project.controller.ts)）
- 前端不感知 Template 关联细节

### 实现逻辑（`ProjectService.getProjectFolder(id, userId)`）

```
1. userId 为空（未登录）        → { folderId: null }（200，不抛 401，公开画布访问者正常回退主目录）
2. canvasProject.findFirst({ where: { id, userId }, select: { id } })
   未命中（不存在/非属主/草稿） → { folderId: null }（不暴露存在性）
3. template.findUnique({ where: { projectId }, select: { folderId: true } })
   无记录或 folderId 为 null    → { folderId: null }
   否则                         → { folderId }
```

依据：
- 属主校验按最小权限原则新增（评审裁决）。注意字段是 `userId`（schema.prisma:139，可空），草稿画布不匹配 → null → 主目录。
- `Template.projectId` 已有 `@unique`（schema.prisma:117），`findUnique` 安全，无需改动 schema。

## 4. 前端设计

### 数据流（[page.tsx](../../../apps/web/src/pages/canvas/page.tsx)）

1. project 加载成功后请求 `GET /api/projects/:id/folder`
2. `folderId` 非空 → 请求 `GET /api/folders`（需登录，返回当前用户平铺文件夹列表）→ 沿 `parentId` 向上 `unshift` 拼 `folderPath: string[]`（顶层→直接父级）
3. 回退到 `folderPath = []`（显示 `主目录/`）的所有情形：
   - folderId 为 null（根目录 / 非属主 / 未登录 / 草稿）
   - folder 或 folders 请求失败（网络/401）
   - folderId 在 folders 列表中找不到（文件夹已被删除）
4. 竞态防护：沿用 page.tsx 现有 `isCancelled` 模式（page.tsx:38-60），旧响应不写入 state

### ProjectTitle 组件

- Props 新增 `folderPath?: string[]`，默认 `[]`
- **Flow123**：`text-white`，用 `<Link to="/works">` 包裹（react-router v7，键盘 Tab/回车可访问），`hover:opacity-80 transition-opacity`，保留 `select-none` 与 💦 emoji
- **路径前缀**（分隔符 `/` 之后、画布名之前）：
  - 文案：`folderPath.join('/') + '/'`，空数组显示 `主目录/`
  - 样式：`text-[#888] select-none`，不可点击；`max-w-[200px] truncate`（无条件应用）
- **编辑态**：路径前缀保留，输入框仅替换画布名：`Flow123 / 主目录/[输入框]`
- **输入框**：`border-[#555]`（替代 `#4ade80`），`min-w-[120px]`（原 80px）
- **常量**：`ROOT_FOLDER_NAME = '主目录'` 在 canvas 模块内导出（工作空间现有文案为"根目录（未分组）"，无跨页统一需求）
- 加载占位：folderPath 默认 `[]` → 初始即显示 `主目录/`，数据到达后替换，无 undefined 闪烁

## 5. 测试策略（TDD）

### 后端 project.service.spec
- 属主查询返回 folderId
- 非属主（userId 不匹配）返回 null，不暴露存在性
- 未登录（userId 空）返回 null
- 无 template 记录返回 null

### 前端 ProjectTitle.test.tsx
- Flow123 为白色 class 且点击导航到 /works
- folderPath=[] 渲染 `主目录/`；folderPath=['设计稿','子文件夹'] 渲染 `设计稿/子文件夹/`
- 编辑态路径前缀保留、输入框仅含画布名
- 输入框 `border-[#555]` 与 `min-w-[120px]` class 断言
- 路径前缀 `truncate` + `max-w-[200px]` 断言

### 前端 page.test.tsx
- 请求链：project 加载后请求 `/api/projects/:id/folder`，folderId 非空再请求 `/api/folders`
- 根目录 / 嵌套路径正确渲染
- folderId 不在 folders 列表（已删除）回退主目录
- 竞态：isCancelled 过期响应不覆盖新路径

## 6. 明确不做

- React Query / SWR 缓存
- 全局 folders Zustand store
- 文件夹重命名/移动的跨页面实时同步
