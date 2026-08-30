# 素材库独立页 + works 团队页对齐 设计文档

日期：2026-08-30
状态：已确认（用户 2026-08-30 逐节确认，含三轮设计审核修订）

## 背景

「默认团队个人项目化」前端 Plan A/B 已完成，处理遗留问题：

1. spec §5.1「团队数 >3 折叠」改为 tab 页方案；`/works?tab=team` UI 与功能和个人项目页完全对齐
2. 画布外团队素材库页面不存在（全仓无 `/materials` 路由），presign 三级回落第②级（`dto.teamId` 通道）后端就绪但前端无消费方
3. `FileUpload.tsx` 无生产挂载点（遗留），删除

### 非范围（登记不处理）

- `/admin/team-plans` 角色守卫：继续登记为上线前必修项（读+写均仅 AuthGuard；加守卫时需同步给普通成员开放只读套餐通道）
- Navbar 全局积分显示个人口径：全局上下文无团队语义，个人口径即正确，不改

## 一、works 团队页对齐

### 现状与根因（已查证）

- `TeamSection` 平铺渲染所有团队区块；团队 tab 顶部工具行隐藏（`showTools={tab==='personal'}`）
- **文件夹重命名/删除断链 404**：`folderApi.ts` 的 `renameFolder`/`deleteFolder` 无 teamId 形参 → 后端从 query.teamId 缺省回落 `ensureDefaultTeam` → 真实团队文件夹查不到 → 404「文件夹不存在」。后端 `PATCH/DELETE /api/folders/:id` 已支持 `query.teamId`
- `Folder.id` 为 cuid 全局唯一主键（schema.prisma:168），teamId 仅作作用域校验 + 缺省回落，非 ID 定位
- 画布操作（重命名/移动/公开切换 `PATCH /api/templates/:id`、删除 `DELETE /api/templates/:id`）后端权限自含（创建者/团队成员/项目编辑者任一；删除限创建者或 PROJECT_OWNER——D1 有意收紧），团队模式可用，**无需改动**

### 设计

#### 1. 团队页签行

- 一级 tab（个人项目/团队项目）保持不变
- 团队 tab 内顶部渲染团队页签行：`realTeams = teams.filter(t => !t.isDefault)`
- 页签顺序：前端显式 `[...ownedTeams, ...joinedTeams]`（`t.isOwner` 区分，WorkspacePage.tsx:49-50 现状字段），平铺**不渲染**「我创建的/我加入的」分组标题；同组内保持接口返回顺序
- 组件：antd `Tabs`，超出容器宽度自动滚动（组件自带，零额外实现）

#### 2. URL 状态机（核心规则）

- 格式：`?tab=team&teamId=xxx&folderId=yyy`；默认选中第一个团队
- **切换 teamId 时强制清空 folderId**（回该团队根目录）
- **切回个人 tab 时清除 teamId 和 folderId**（现有 setTab 清 folder 行为扩展；个人/团队 folderId 命名空间不同）
- 刷新/直链可恢复状态

#### 3. 共享工作区组件

- 提取共享组件：个人 tab 与「团队 tab + 选中团队」渲染**同一组件**（`WorkspaceToolbar` + `WorkspaceBreadcrumb` + grid/list + 弹窗组），唯一区别 `useWorkspaceData(teamId | undefined)`
- `showTools` 恒为 true（不再对团队 tab 隐藏）
- 团队 tab 同样渲染面包屑
- `TeamSection` 组件删除，其职责被共享组件吸收（内部 state folderId 改为进 URL，与个人 tab 单一数据流一致）

#### 4. 空状态归属

- 空状态判断留在 **WorkspacePage 团队分支**（`realTeams.length === 0` → 空状态 + 「前往创建团队」引导，现状 WorkspacePage.tsx:146-150，含 `data-testid="team-empty-state"`）
- 共享组件保持纯粹：只接收维度渲染工作区，不感知 tab 上下文

#### 5. 新建画布规则

- 团队 tab 下新建画布：请求携带 `teamId + 当前 folderId`，画布归属**当前团队的当前文件夹**（与个人页现状同构；明确不采「忽略 folderId 归根目录」）
- API 已支持：`POST /api/canvases {name, folderId, teamId}`（canvasApi.ts:11-16），`useWorkspaceData.createCanvas` 已传递

#### 6. 文件夹 rename/delete 修复

- `folderApi.ts` 的 `renameFolder`/`deleteFolder` 加 `teamId?: string` 形参（query 传递）
- `useWorkspaceData` 的 `renameFolder`/`deleteFolder` 传入当前维度 teamId

### 功能对齐清单（团队维度下与个人页逐项一致）

| 功能 | 说明 |
|------|------|
| 新建画布卡固定第一 | grid 第一卡 + list 虚线按钮 |
| 搜索 | 300ms 防抖，前端过滤 |
| 筛选 | 显示全部/仅文件夹/仅画布 |
| grid/list 视图切换 | 同个人页 |
| 加载更多 | PAGE_SIZE=20 分页 |
| 新建文件夹 | createFolder 已带 teamId，保持 |
| 文件夹重命名/删除 | **本次修复**（补 teamId 通道） |
| 画布重命名/移动/公开切换/删除 | 后端权限自含，可用 |
| 空状态/骨架/错误态 | 同个人页 |

## 二、独立素材库页 /materials

### 现状（已查证）

- `MaterialLibraryModal` 仅挂画布页（canvas/page.tsx:295），无 onInsert 插入回调（footer=null，纯管理界面：上传/文件夹 CRUD/批量删除移动/收藏/缩放）
- `materialLibraryStore` 从 `canvasStore` 取 `teamId`/`projectId`
- 后端 material-library 全端点 teamId **已就绪**：controller query/body、DTO（create-folder/update-folder/move-folder/move-file/batch-move 均 `teamId?`）、service `resolveTeamId` 统一门（外部 teamId 自证成员，缺省回落本人默认团队）
- store 存在脱离 React 树的 `getState()` 调用（键盘监听等，共 19 文件引用）

### 设计

#### 1. 路由与入口

- `router.tsx` 加 `/materials`（RequireAuth 子树）
- Navbar navLinks 加「素材库」入口（「工作空间」旁）

#### 2. 页面结构（与 works 设计语言同构）

- 一级 tab：`个人素材 | 团队素材`（URL `?tab=`，默认 personal）
- 团队 tab 内：团队页签行（realTeams 过滤 isDefault，owned 前 joined 后，平铺），选中进 URL `?teamId=`
- 无真实团队：空状态 + 引导创建（同 works 模式）
- 切 tab 清 teamId；**切团队清 `selectedFolderId` 回根目录**（与 works 一致）

#### 3. store 上下文参数化（全局单例 + context 字段）

**方案**：保持全局单例 store，增加 `context: { teamId?: string; projectId?: string }` 字段。
不采 React Context 多实例（`getState()` 脱离 React 树调用点真实存在，迁移面大；且 SPA 单路由两场景不并发）。

**注入规则（时序安全，全部强制 `setContext + setSelectedFolder(null) + reload`）**：
- Modal `isOpen` 变 true（画布内）
- 页面挂载
- 切一级 tab
- 切团队页签

**各场景 context 值**：

| 场景 | context | 上传 presign 通道 |
|------|---------|------------------|
| 画布内 Modal（现状不变） | `{ teamId: canvasStore.teamId, projectId: canvasStore.projectId }` | ①级 projectId |
| 页面个人素材 tab | `{}`（均不传） | ③级默认团队回落 |
| 页面团队素材 tab × 团队 X | `{ teamId: X }` | ②级 dto.teamId |

`projectId` 是 presign ①级通道参数（解析项目所在团队+成员校验），保留在 context，页面场景恒 undefined 自然降级。

#### 4. action 注入清单（13 个 action 从 context 取 teamId，替代 canvasStore）

| store action | 后端通道 | 前端改动 |
|---|---|---|
| loadFolders / loadFiles | `GET ?teamId` | 改从 context 取 |
| createFolder / renameFolder / moveFolder | body `dto.teamId` | 补传 context.teamId |
| deleteFolder / moveFolderUp / deleteFile / toggleFavorite | `?teamId` query | 补传 |
| uploadFile（presign + 内部 move） | `dto.teamId`（②级）+ move `dto.teamId` | 补传 |
| batchDelete / batchMove | body `teamId` | 补传 |

#### 5. 上传快照

`uploadFile` 开头局部变量快照 context（teamId/projectId/selectedFolderId），上传过程中不受上下文切换影响；完成后按快照刷新（现有 selectedFolderId 已是此模式）。

#### 6. 组件提取

- `MaterialLibraryModal` 主体（FolderTree + FileGrid + 缩放 + 批量操作）提取为 `MaterialLibraryBrowser`
- props 极简：`title`（无 mode/onInsert——两场景功能完全相同）
- Modal 版 = Modal 包装 Browser（画布内行为不变）
- 页面版 = Navbar + 一级 tab 行 + （团队 tab 时）团队页签行 + Browser

## 三、FileUpload.tsx 删除

- 删除 `apps/web/src/components/FileUpload.tsx` + `FileUpload.test.tsx`
- 已全仓 grep 确认：仅测试文件引用（backups/、.claude/worktrees/ 副本非生产路径，不动）；无 Storybook/动态 import

## 错误处理

- 加载/上传失败提示沿用 store 现有 message 逻辑
- 团队列表加载失败复用 works 同款错误提示（message.error）

## 测试策略

### works 团队页

- URL 状态机：切团队清 folderId、切个人 tab 清 teamId+folderId、直链恢复
- 团队页签渲染：顺序（owned 前 joined 后）、平铺无分组标题、默认选第一个
- 共享组件：个人/团队同构渲染、showTools 恒显、面包屑渲染
- folder rename/delete 请求带 teamId（断言 query 参数）
- 团队 tab 新建画布请求带 teamId + 当前 folderId
- 无团队空状态（team-empty-state）

### 素材库页

- 路由 + 一级 tab + 团队页签渲染（含无团队空态）
- context 注入规则：页面挂载/切 tab/切团队/Modal 打开均触发 setContext + 清 selectedFolderId + reload
- presign 参数断言：个人 tab 不传 teamId/projectId、团队 tab 传 teamId、Modal 场景传 projectId
- 13 个 action 的 teamId 传递逐一断言
- 画布内 Modal 回归：允许调整测试 setup（setContext 注入方式），行为断言不变

### 通用

- TypeScript strict: true
- TDD 红-绿-重构，先写失败测试
