# 素材库独立页 + works 团队页对齐 设计文档

日期：2026-08-30
状态：v4（用户 2026-08-30 逐节确认，含六轮设计审核修订；v4 落实 initialFolderId 首帧单请求、useTeams 失败终态、非法 teamId replace 清 folder、DTO 精确清单、竞态职责分层）

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

- `TeamSection` 平铺渲染所有团队区块，每团队独立 `useWorkspaceData(team.id)` 挂载即发请求（N 团队 N 组并发，改单选中实例后自然消除）；团队 tab 顶部工具行隐藏（`showTools={tab==='personal'}`）
- **文件夹重命名/删除断链 404**：`folderApi.ts` 的 `renameFolder`/`deleteFolder` 无 teamId 形参 → 后端从 query.teamId 缺省回落 `ensureDefaultTeam` → 真实团队文件夹查不到 → 404「文件夹不存在」。后端 `PATCH/DELETE /api/folders/:id` 已支持 `query.teamId`
- `Folder.id` 为 cuid 全局唯一主键（schema.prisma:167），teamId 仅作作用域校验 + 缺省回落，非 ID 定位
- 画布操作（重命名/移动/公开切换 `PATCH /api/templates/:id`、删除 `DELETE /api/templates/:id`）后端权限自含（创建者/团队成员/项目编辑者任一；删除限创建者或 PROJECT_OWNER——D1 有意收紧），团队模式可用，**无需改动**
- 画布内 Modal context 时序安全：CanvasPageInner 仅 projectId 就绪后挂载，setTeamId 先于 finish，teamId 与 projectId 同源

### 设计

#### 1. 团队页签行与团队列表 hook

- 一级 tab（个人项目/团队项目）保持不变
- 团队 tab 内顶部渲染团队页签行：`realTeams = teams.filter(t => !t.isDefault)`
- 页签顺序：前端显式 `[...ownedTeams, ...joinedTeams]`（`t.isOwner` 区分，WorkspacePage.tsx:49-50 现状字段），平铺**不渲染**「我创建的/我加入的」分组标题；同组内保持接口返回顺序
- 组件：antd `Tabs`，超出容器宽度自动滚动（组件自带，零额外实现）
- **抽 `useTeams()` hook**（works 与 /materials 两页复用，替代各自内联 state）：三态 `loading / error / success`。现状 WorkspacePage.tsx:44-47 catch 只 message.error 不落终态 → teams 恒 null → 按「未就绪不挂载」规则失败即死屏无重试。error 态渲染「团队列表加载失败 + 重试按钮」（重试重新发请求）；素材页复用同一 hook，不复制缺陷

#### 2. URL 状态机（核心规则）

- 格式：`?tab=team&teamId=xxx&folder=yyy`——**沿用现状 key `folder`**（useFolderNavigation.ts:8/25 全部用 `folder`，不做 folderId 改名，避免无收益的全量改名）；默认选中第一个团队
- **切换 teamId 时强制清空 folder**（回该团队根目录）
- **切回个人 tab 时清除 teamId 和 folder**（现有 setTab 清 folder 行为扩展；个人/团队 folder 命名空间不同）
- 刷新/直链可恢复状态
- **门控联动**：`useFolderNavigation` 的 loaded 门控（WorkspacePage.tsx:33 `data.status !== 'loading' && tab === 'personal'`）必须去掉 `tab === 'personal'` 条件，否则团队维度直链无效 folder 的 fallback（重置根目录）不触发
- **直链 teamId 回落三分支**（teams 为异步拉取，`?tab=team` 时 URL 的 teamId 存在「未决」窗口）：
  1. **teams 未就绪且 URL 带 teamId**：团队分支只显示加载中，**不挂载共享组件**——防止先按第一个团队挂载发一轮错误请求再跳转闪烁
  2. **teamId 不在 realTeams**（已退出/被踢/解散/拼错）：`replace` 到第一个真实团队，**一次写入 `?tab=team&teamId=第一个`（不带 folder）**——若保留旧 folder 会再走一次无效 folder fallback 并弹「文件夹不存在」，误导真正病因（teamId 非法）；无真实团队则落 team-empty-state
  3. **`?tab=team` 不带 teamId**：teams 就绪后用 `replace`（非 push）补第一个，避免污染后退栈
  - 素材库页同构处理（素材页 folder 为 store 内态不进 URL，无 P3-a 的 folder 残留问题）

#### 3. 共享工作区组件

- 提取共享组件：个人 tab 与「团队 tab + 选中团队」渲染**同一组件**（`WorkspaceToolbar` + `WorkspaceBreadcrumb` + grid/list + 弹窗组），唯一区别 `useWorkspaceData(teamId | undefined)`
- `showTools` 恒为 true（不再对团队 tab 隐藏）；团队 tab 同样渲染面包屑
- **切团队状态归零**：共享组件以 `key={teamId ?? 'personal'}` 重挂载——viewMode/search/filter/弹窗等本地 state（WorkspacePage.tsx:35-40）自然归零，避免跨团队搜索残留把新团队过滤成空态；同时是 teamId 闭包陈旧问题的双保险
- **URL→loadFolder effect 下沉 + initialFolderId 首帧单请求**：现状 firstRender ref + URL folder 变化触发 loadFolder 的 effect 在父组件（WorkspacePage.tsx:75-82），firstRender **不随 key 重挂载重置**——切团队时子组件 mount effect 与父组件 effect 双发请求；且现状首帧逻辑「仅当 currentFolderId === null 才跳过」意味着**直链带 folder 时 mount effect 的 loadFolder(null) 与首帧 loadFolder(yyy) 双发**（个人页现状即如此，根请求被目标请求覆盖）。修法：`useWorkspaceData(teamId, initialFolderId)` 增加入参，mount effect 直接 `loadFolder(initialFolderId ?? null)`，下沉的 URL effect **首帧恒跳过**、只负责后续导航——全场景（根目录/直链 folder/切团队）挂载均 1 次请求，同时消掉个人页现状冗余根请求。父组件只产出「有效选中 teamId」；配合「teams 未就绪不挂载」，与消除 N 组并发的初衷一致
- **renameFolder 依赖补全**：`useWorkspaceData.renameFolder` 的 useCallback 依赖数组（现状仅 `[folders]`）显式加入 teamId
- `TeamSection` 组件删除，其职责被共享组件吸收（内部 state folderId 改为进 URL，与个人 tab 单一数据流一致）

#### 4. 空状态归属

- 空状态判断留在 **WorkspacePage 团队分支**（`realTeams.length === 0` → 空状态 + 「前往创建团队」引导，现状 WorkspacePage.tsx:146-150，含 `data-testid="team-empty-state"`）
- 共享组件保持纯粹：只接收维度渲染工作区，不感知 tab 上下文

#### 5. 新建画布规则

- 团队 tab 下新建画布：**创建请求**携带 `teamId + 当前 folder`，画布归属当前团队的当前文件夹（与个人页现状同构；明确不采「忽略 folder 归根目录」）。API 已支持：`POST /api/canvases {name, folderId, teamId}`
- **预填名通道**：`CreateCanvasModal` 打开时 `getNextUntitledName(teamId)`（组件已有 teamId prop，TeamSection 现传、个人分支未传）——共享组件必须传当前维度 teamId，否则团队 tab 预填名按默认团队序号串号
- `useWorkspaceData.createCanvas` 已传递 teamId

#### 6. 文件夹 rename/delete 修复

- `folderApi.ts` 的 `renameFolder`/`deleteFolder` 加 `teamId?: string` 形参（query 传递）
- `useWorkspaceData` 的 `renameFolder`/`deleteFolder` 传入当前维度 teamId

### 功能对齐清单（团队维度下与个人页逐项一致）

| 功能 | 说明 |
|------|------|
| 新建画布卡固定第一 | grid 第一卡 + list 虚线按钮 |
| 新建画布预填名 | `getNextUntitledName(teamId)` 按维度序号 |
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

- `MaterialLibraryModal` 仅挂画布页（canvas/page.tsx:295），footer=null，功能：上传/文件夹 CRUD/批量删除移动/收藏/缩放
- `materialLibraryStore` 从 `canvasStore` 取 `teamId`/`projectId`
- 后端 material-library 全端点 teamId **已就绪**：controller query/body、DTO（5 个均含 `teamId?`）、service `resolveTeamId` 统一门（外部 teamId 自证成员，缺省回落本人默认团队）
- store 存在脱离 React 树的 `getState()` 调用（键盘监听、FolderTree 等，共 18 文件引用：生产 9 + 测试 9）——action 内部从 `get().context` 取值，调用点零改动
- **「应用到画布」链路**：画布内是通的（FileCard → `requestAddMediaNode` 设 `pendingMediaFile` → CanvasView.tsx:111-181 订阅消费，创建节点/填充分镜格）。但独立页面无画布上下文：按钮成死按钮、`close()` 语义错误、`pendingMediaFile` 残留全局 store 无人消费

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

**收敛为单一入口 API `enterContext(ctx)`**（把时序约束编码进 API，杜绝多调用点各写三件套漏一处）：
- 一次完成：`set({ context: ctx, selectedFolderId: null, batchMode: false, files: [] })` + `loadFolders()` + `loadFiles()`
- 同步清空 `files` 避免瞬时显示上一团队文件
- 调用时机（4 处）：Modal `isOpen` 变 true（画布内，context 取 canvasStore 值）/ 页面挂载 / 切一级 tab / 切团队页签
- 离开 /materials 不做 context 清理（无害：下次挂载 enterContext 覆盖），不实现卸载清理
- **P3 登记（不阻塞）**：loadFolders/loadFiles 各自 finally 置 loading:false，先回的会提前关 loading（Modal:43 现状即如此）——后续可 Promise.all 收口或引用计数，本次不动

**各场景 context 值**：

| 场景 | context | 上传 presign 通道 |
|------|---------|------------------|
| 画布内 Modal（现状不变） | `{ teamId: canvasStore.teamId, projectId: canvasStore.projectId }` | ①级 projectId |
| 页面个人素材 tab | `{}`（均不传） | ③级默认团队回落 |
| 页面团队素材 tab × 团队 X | `{ teamId: X }` | ②级 dto.teamId |

`projectId` 是 presign ①级通道参数（解析项目所在团队+成员校验），保留在 context，页面场景恒 undefined 自然降级。

#### 4. action 注入清单（12 个 action / 13 个注入点，从 context 取 teamId 替代 canvasStore）

| store action | 后端通道 | 前端改动 |
|---|---|---|
| loadFolders / loadFiles | `GET ?teamId` | 改从 context 取 |
| createFolder / renameFolder / moveFolder | body `dto.teamId` | 补传 context.teamId |
| deleteFolder / moveFolderUp / deleteFile / toggleFavorite | `?teamId` query | 补传 |
| uploadFile（presign + 内部 move，2 个注入点） | `dto.teamId`（②级）+ move `dto.teamId` | 补传 |
| batchDelete / batchMove | body `teamId` | 补传 |

**显式排除**：`confirmUpload` **不传 teamId**——后端按 fileId 自证 creator/团队成员（storage.service.ts:69-79），防止对齐式乱补。

**连带修复**：`deleteFolder` 后补 `loadFiles()`（后端事务已把 media.folderId 置空，现状只 loadFolders 导致前端文件列表残留）。

#### 5. 上传快照与末尾刷新口径

- `uploadFile` 开头局部变量快照 context（teamId/projectId/selectedFolderId），请求链路（presign/上传/confirm/move）**一律用快照**，不受上下文切换影响
- **末尾刷新口径**：仅当「当前 context === 快照 context 且 selectedFolderId 未变」时才 `loadFiles()`，否则不刷新——用户已切走时当前视图本应展示另一套数据，刷新旧视图反而错误（且 session 序号会丢弃它）。测试按此口径断言

#### 6. 组件提取与场景感知

- `MaterialLibraryModal` 主体（FolderTree + FileGrid + 缩放 + 批量操作）提取为 `MaterialLibraryBrowser`
- props：`title` + `onApplyFile?: (f: MaterialFile) => void`
  - Modal 版（画布内）：传 `onApplyFile` = 现有行为（requestAddMediaNode + close），「应用到画布」按钮保留
  - 页面版：**不传** `onApplyFile` → 仅「应用到画布」按钮不渲染（透传链 Browser→FileGrid→FileCard 两层，槽位模式同现有 onToggleFavorite/onDelete）；**hover 预览 Popover 保留**（ImagePreview/VideoPreview——独立素材管理同样需要预览），不得整删 Popover
- Modal 版 = Modal 包装 Browser（画布内行为不变）
- 页面版 = Navbar + 一级 tab 行 + （团队 tab 时）团队页签行 + Browser

## 三、删除清单（FileUpload + TeamSection）

| 文件 | 说明 |
|------|------|
| `apps/web/src/components/FileUpload.tsx` | 无生产挂载（已全仓 grep，仅测试引用） |
| `apps/web/src/components/FileUpload.test.tsx` | 连带删除 |
| `apps/web/src/pages/workspace/components/TeamSection.tsx` | 职责被共享组件吸收 |
| `apps/web/src/pages/workspace/__tests__/TeamSection.test.tsx` | 连带删除（引用已删组件会编译失败） |
| `apps/web/src/utils/splitUploadService.ts:72` 注释 | 「same as FileUpload.tsx」悬空引用，同步清理 |

backups/、.claude/worktrees/ 下的 FileUpload 副本非生产路径，不动。

## 四、后端改动（material 模块防御性加固）

- **`ValidationPipe` 与装饰器必须成对**（只补装饰器不挂管道 = 防护为零，还留「已防护」错觉）：
  - folder.controller.ts、file.controller.ts **类级**加 `@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))`——不全局开启（main.ts 现无全局 pipe，全局开会波及所有裸 DTO 控制器，回归面不可控）。现状两 controller 类上均无 pipe（已复核）；works folder.controller 的 create/rename **方法级已挂**（:19/:27），works 侧防护齐全零改动再确认
  - **DTO 装饰器精确清单**（现状：batch-move-files.dto 已有完整装饰器无需动；真正裸奔 4 个 + 新建 1 个。whitelist 会剥离「无任何装饰器」的字段，漏标即静默丢弃）：

| DTO | 字段 | 装饰器 |
|---|---|---|
| CreateFolderDto | name 必填 | `@IsString() @IsNotEmpty()` |
| | parentId 可选可空（`?: string \| null`） | `@IsOptional() @IsString()` |
| | teamId 可选 | `@IsOptional() @IsString()` |
| UpdateFolderDto | name 可选 | `@IsOptional() @IsString() @IsNotEmpty()` |
| | teamId 可选 | `@IsOptional() @IsString()` |
| MoveFileDto | folderId **必填可空**（`!: string \| null`，null=根，缺字段要拒） | `@ValidateIf((_, v) => v !== null) @IsString()`，**不叠 @IsOptional** |
| | teamId 可选 | `@IsOptional() @IsString()` |
| MoveFolderDto | parentId / afterId **必填可空**（`!: string \| null`） | 同上 ValidateIf 模式 |
| | teamId 可选 | `@IsOptional() @IsString()` |
| BatchDeleteFilesDto（新建，对齐 batch-move） | ids | `@IsArray() @IsString({ each: true })` |
| | teamId 可选 | `@IsOptional() @IsString()` |

  - 装饰器规则：**可选可空**（`?:` 声明）用 `@IsOptional`（本身即对 null/undefined 放行，对齐仓内 batch-move 既有风格，不叠 ValidateIf）；**必填可空**（`!:` 声明、null 有语义）才用 ValidateIf 模式——@IsOptional 会把缺失的 undefined 一并放行，对必填字段失效
  - file.controller.ts batchDelete 现为**内联类型** `body: { ids: string[]; teamId?: string }`（运行时无 class 元数据，管道跳过、whitelist 不生效）——用 BatchDeleteFilesDto 替换
- **material folder.service update 收窄写入**：folder.service.ts:83 现为 `update({ where: { id }, data: dto })` 整体透传，dto 含 teamId 会执行 `SET teamId`（现因 findFirst 已按 resolved 过滤而幂等，属隐式不变量）——收窄为 `data: { name: dto.name }` 一行
- 其余后端零改动（works folder rename/delete 的 query.teamId、material 全端点、presign ②级均已就绪；works folder.service.rename 为白名单式 `data:{name}`，无透传问题）

## 错误处理

- 加载/上传失败提示沿用 store 现有 message 逻辑
- 团队列表加载失败复用 works 同款错误提示（message.error）

## 竞态防护（本次新增交互引入的风险）

团队页签快速 A→B 切换时，A 的慢响应后返回会覆盖 B 的数据（跨团队串台）。现状 `loadFolders`/`loadFiles`（素材）与 `loadFolder`（works）均无请求序号/Abort 防护：

- **职责分层（避免过度设计）**：
  - `key={teamId}` 重挂载已天然隔离**跨团队**一切在途回包（useWorkspaceData 为 hook 本地 state，旧实例卸载后 setState 为 no-op，含 refreshFolders、操作后 setFolders——序号**不需要**管跨团队）
  - session 序号只防护**同实例内**（key 不含 folder，同团队 folder A→B 不重挂载）：loadFolder 乱序 + loadMore 与 loadFolder 竞争
  - `refreshFolders` 拉团队全量树（不带 folderId），同团队内 A→B 结果幂等，不需独立序号——序号校验只需包住 canvases 写入
- **素材 store**：`loadFolders`/`loadFiles` 均为**替换型**（整体 set）——加请求序号（session 计数）归属校验，响应返回时序号已过则丢弃
- **works 共享维度区分两种语义**：
  - `loadFolder` **替换型**：严格最后一次生效（序号比对）
  - `loadMore` **追加型**：不能共用「全局最后序号」否则快速翻页误杀合法追加——`loadMore` 捕获发起时 sessionId，回包时相等才 append，session 已变即丢弃
  - 每次 loadFolder/切团队/重挂载递增 sessionId 并重置 page
- 乱序测试用伪定时器写（A 慢响应后到被丢弃，断言终态是 B 的数据）

## 测试策略

### works 团队页

- URL 状态机：切团队清 folder、切个人 tab 清 teamId+folder、直链恢复（key 用 `folder`）
- **直链 teamId 回落三分支**：teams 未就绪不挂载共享组件（不发请求）；非法 teamId replace 第一个真实团队且**不带 folder**（断言 URL 终态；无则 empty-state）；无 teamId 用 replace 补默认（后退栈不污染）
- **useTeams 失败终态**：teams 请求失败渲染「加载失败 + 重试」，重试后恢复（不再死屏）；素材页同款断言
- loaded 门控去掉 `tab==='personal'` 后，团队维度直链无效 folder 触发 fallback
- 团队页签渲染：顺序（owned 前 joined 后）、平铺无分组标题、默认选第一个
- 共享组件：个人/团队同构渲染、showTools 恒显、面包屑渲染
- `key={teamId ?? 'personal'}` 重挂载：切团队后搜索/筛选/视图/弹窗 state 归零；**initialFolderId 机制下全场景挂载均只发 1 次请求**（根目录/直链 folder/切团队三场景分别断言请求计数=1）
- folder rename/delete 请求带 teamId（断言 query 参数）
- 团队 tab 新建画布：创建请求带 teamId + 当前 folder；`next-untitled-name` 请求带 teamId
- 无团队空状态（team-empty-state）

### 素材库页

- 路由 + 一级 tab + 团队页签渲染（含无团队空态）
- `enterContext` 注入规则：4 个时机均触发（context + 清 selectedFolderId/batchMode/files + reload）
- presign 参数断言：个人 tab 不传 teamId/projectId、团队 tab 传 teamId、Modal 场景传 projectId；`confirmUpload` 不带 teamId
- 12 个 action 的 teamId 传递逐一断言
- `uploadFile` 快照：上传过程中切 context，断言 presign 与 move 均用快照时 teamId、**且不触发旧视图刷新**（末尾刷新口径）
- **场景感知**：页面版不渲染「应用到画布」但 **hover 预览 Popover 可唤起**；Modal 版按钮在且点击行为不变
- `deleteFolder` 后 loadFiles 被调用
- 画布内 Modal 回归：允许调整测试 setup（`enterContext` 注入替代 canvasStore mock——现 test 的 `vi.mock('@/stores/canvasStore')` 不再被消费），行为断言不变

### 后端 ValidationPipe

- material 两 controller：合法字段保留、**未声明字段被剥离**（whitelist 生效断言）；batchDelete 走 BatchDeleteFilesDto
- folder.service update 只写 name（不含 teamId 的 UPDATE 语句断言）

### 乱序竞态

- 素材 loadFolders/loadFiles：伪定时器写 A 慢响应后到被丢弃
- works loadFolder（替换型）：同款乱序用例；loadMore（追加型）：sessionId 相等才 append、session 变更丢弃且不误杀翻页

### 删除兜底

- FileUpload/TeamSection 删除后：tsc strict 通过 + grep 断言全仓无残留引用（测试中执行）

### 通用

- TypeScript strict: true
- TDD 红-绿-重构，先写失败测试
