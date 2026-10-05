<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: 2026-10-06 | verified_at_commit: 4af57719 -->
# 后台管理重构 Spec（admin-console-refactor）

> 状态：v2.4 — 五轮审核意见均已并入（全部断言经源码/WCAG 实算/npm registry 验证属实），Q1-Q4 全部终版决议，待用户最终确认后冻结进入 plan
> 日期：2026-09-04
> 原则：稳定优先（锁版本）、可扩展性最优、实用性；开发测试阶段无用户数据，不做向后兼容防护，一步到位不留上线后的坑。

## 0. 背景与目标

当前 admin（`apps/web/src/pages/admin/page.tsx`）是单页面 useState 切换 section/subTab，手写 Tailwind 暗色样式，无侧边栏、无子路由、无菜单高亮、无角色守卫（后端 9 个 admin controller 也无角色校验，`User` 模型无 role 字段）。

本次重构目标：

1. 布局升级为 **ProLayout（@ant-design/pro-components@2.8.10）+ react-router v7 嵌套路由**，配置驱动菜单，未来加模块只加配置。
2. 建立完整**角色机制**：DB `role` 字段 → session 链路 → 后端 AdminGuard → 前端 RequireAdmin，一次闭环，且堵死注册提权路径。
3. 业务组件层全部迁移 **ProTable / ProForm（ModalForm 等）**，消除手写表格/表单/弹窗样板代码。
4. 后端 `api/admin/*` 全前缀角色守卫，按**路由前缀**（非目录）覆盖，未来新增自动覆盖。

## 1. 范围与依赖

**依赖（版本锁定）：**

- `apps/web` 新增 `@ant-design/pro-components` **精确版本 `2.8.10`（不带 `^`）**，与项目 antd/react 精确锁版本风格一致
- 依据：2.8.10 为 npm latest 稳定版；3.x 全部为 beta/`-N` 预发布（3.0.0-beta.x ~ 3.1.14-7），**禁止使用**；peer `antd ^4.24.15 || ^5.11.2`、`react >=17` 与现有 antd 5.22.5 + react 18.3.1 完全兼容
- 安装后执行 `pnpm why antd` 确认全树仅一份 antd@5.22.5（pnpm 多实例会导致 ConfigProvider/主题失效）
- react-router 为 **v7**：`Link`/`Outlet`/`createBrowserRouter` 均从 `react-router` 导入（非 react-router-dom）

**In scope：**

- Prisma：`User` 模型新增 `role` 字段（5.22.0，generator strict，migrate dev 后跑类型检查 + 登录冒烟）
- BetterAuth（1.6.11）：additionalFields 配置（含防提权，见 2.2）
- 后端：全局 AdminGuard 拦截 `api/admin/*`；team plans 成员只读端点（见 3.2）
- 前端：`/admin` 嵌套路由 + ProLayout 布局 + RequireAdmin 守卫
- 业务组件：admin 下全部表格/表单/弹窗迁移 ProTable/ProForm；裸 fetch 收敛到 adminApi 封装
- 测试：前后端全量同步（TDD）

**Out of scope：**

- 主应用（非 /admin）的任何页面与布局
- 非 admin 前缀的 API
- admin 菜单多级权限分级（只做 ADMIN/USER 两级）
- 现有 admin API 的业务逻辑变更（仅加守卫与 team plans 只读端点，不改业务语义）

## 2. 角色机制（数据与认证链路）

### 2.1 数据结构

```prisma
enum Role {
  USER
  ADMIN
}

model User {
  // ...
  role Role @default(USER)
}
```

- 迁移方式：`prisma migrate dev --name user-role`（本地时间戳目录名）；新增 `CREATE TYPE "Role"` 位于 14 个迁移链尾，**另跑一次 `migrate reset` 全链 replay**（开发库可清），与 fresh replay 要求对齐

### 2.2 role 链路（三段，职责各不相同）

**① 后端守卫与 /api/auth/me —— 与 additionalFields 无关，加列即生效：**
- 现有全局 AuthGuard（`auth.guard.ts:32`）用 `session.findUnique({ include: { user: true } })` 将 user 挂到 `req.user` —— User 表加列后 `req.user.role` 自动有值
- `/api/auth/me` 走 `AuthService.getSession`（Prisma 直查 include user，注释明确 bypass BetterAuth getSession）—— 加列后自动返回 role
- **因此 AdminGuard 直接读 `req.user.role` 即可，无需任何 BetterAuth 配置**

**② BetterAuth additionalFields —— 只负责两件事：登录响应带出 role + 锁客户端写入：**

```ts
user: {
  additionalFields: {
    role: { type: 'string' as const, defaultValue: 'USER', returned: true, input: false },
  },
},
```

- `returned: true`：sign-in/sign-up 响应体带 role，前端登录即知角色，不必等 /me 刷新
- **`input: false`（P0 安全，不可省略）**：better-auth 1.6.11 的 `parseInputData`（`dist/db/schema.mjs:40`）只对 `input === false` 的字段拒绝客户端写入。缺此项时，任何人 `POST /api/auth/sign-up` body 加 `"role":"ADMIN"` 即注册成管理员（手机验证码注册路径同理）。已核源码（schema.mjs:35-50）的双路径行为：
  - **create**（sign-up/sign-up-phone）：`input:false` + `defaultValue` → 强传值被**静默覆盖**为 USER
  - **update**（`PATCH /api/auth/me` updateUser）：直接抛 `FIELD_NOT_ALLOWED` 400 —— **改资料接口同样无法提权**，测试顺手覆盖两条路径

**③ 前端类型：** `AuthProvider.tsx` 的 `User` interface 增加 `role: 'USER' | 'ADMIN'`（来源：/api/auth/me 与登录响应）。

### 2.3 管理员账号指定（Q1 已决议：方案 a）

seed.ts 内实现（不复用现有 `default-user` —— 它无密码无法登录）：

1. `findUnique({ where: { email } })` 不存在 → 调 `auth.api.signUpEmail({ body: { email, password, name } })` 走正确 Argon2id 哈希（密码明文不能直接 `prisma.user.create`，Account 表哈希必须由 BetterAuth 生成）
2. 已存在 → `update({ data: { role: 'ADMIN' } })`
3. 密码用环境变量覆盖、给开发默认值（`ADMIN_EMAIL` / `ADMIN_PASSWORD`，seed 内读取）

**seed 运行约束：**

- better-auth 1.6.11 默认 `minPasswordLength = 8`（sign-up 路径强制校验），`ADMIN_PASSWORD` 开发默认值必须 ≥8 位，否则 seed 直接中断
- `import '@/auth/auth'` 会在模块顶层 `new Redis()`（ioredis 构造即连接）—— **seed 运行需要 Redis 在线**，不只是 DB
- signUpEmail 触发 `databaseHooks.user.create.after` 给 admin 自动建个人团队（无害，知情即可）

### 2.4 Role 类型收敛到 @flowweb/shared

项目已有前后端共享层 `packages/shared/src/{types,constants}`（adminApi 已在用）。新增 `Role` 类型与工具收进 shared，让 Prisma `$Enums.Role`、better-auth 字符串、AuthProvider、AdminGuard、RequireAdmin、seed 共用一份，消除 `'ADMIN'` 魔法字符串散落：

```ts
// packages/shared/src/types/role.types.ts
export type Role = 'USER' | 'ADMIN';
export const isAdmin = (role: unknown): role is 'ADMIN' => role === 'ADMIN';
```

AdminGuard 内直接复用 `isAdmin(req.user?.role)`。

## 3. 后端守卫

### 3.1 AdminGuard 设计

- 位置：`apps/api/src/auth/admin.guard.ts`
- **执行顺序**：app.module.ts providers 中 AuthGuard 在前、AdminGuard 在后（NestJS 多个 APP_GUARD 严格按注册顺序执行，否则 `req.user` 尚未挂上）
- **必须显式跳过非 HTTP 上下文**：项目有 2 个 NestJS `@WebSocketGateway`（execution（namespace `/execution`）/ payment（namespace `/payment`）），NestJS 全局 APP_GUARD 对 WS 上下文同样执行 canActivate，`req.path` 为 undefined 会抛 TypeError。第一行协议判断（WS 已有各自独立鉴权）。注意：`collab` 网关是 Hocuspocus 独立端口服务（COLLAB_PORT 默认 3001），**不经过 Nest APP_GUARD 链**，与此无关：

```ts
canActivate(context: ExecutionContext) {
  if (context.getType() !== 'http') return true;   // WS gateway 走各自鉴权
  const req = context.switchToHttp().getRequest();
  const path: string = (req.path ?? '').toLowerCase();  // 执行期修正：Express 路由大小写不敏感（caseSensitive 默认 false），/API/admin/* 变体可命中控制器绕过守卫，必须小写化对齐
  const isAdminPath = path === '/api/admin' || path.startsWith('/api/admin/');
  if (!isAdminPath) return true;
  if (!req.user) throw new UnauthorizedException();   // 防御纵深，不依赖前一个 guard
  if (!isAdmin(req.user?.role)) throw new ForbiddenException('需要管理员权限');  // 复用 §2.4，中文 message 经 HttpExceptionFilter 可读
  return true;
}
```

- 直接读 `req.user.role`（**不要**照抄 AuthGuard 里 `new PrismaClient()` 的写法，那是连接隐患）
- **前缀边界**：`path === '/api/admin' || path.startsWith('/api/admin/')`，不用裸 `startsWith('/api/admin')`（防 `/api/administrator-x` 类碰撞）。注意现有 `modules/admin/public/public.controller.ts` 前缀是 `api`（公开 node-types/models/pricing），不受影响 —— 这正说明守卫必须按路由前缀而非目录枚举
- 技术债登记（out of scope，本次不改）：既有 AuthGuard 存在同样的 WS path 空值隐患

### 3.2 team-plans 只读依赖处理（Q2 已决议：方案 A）

`teamApi.ts:166` 的 `GET /admin/team-plans` 被 TeamBillingPage（普通成员可访问）调用，全局守卫后会被 403。处理：

- 新端点挂在既有 `team.controller.ts`（前缀 `api/team`，登录即可读）：`@Get('plans')` + **显式 `@SkipTeamGuard()`**（类级挂了 `@UseGuards(TeamGuard)`；TeamGuard 对无 `:id` 路由本就放行，但仓库约定是显式声明防未来类级守卫变化，对齐 `createTeam` 等先例）。`@Get('plans')` 单段静态路由与现有 `:id/xxx` 两段路由不冲突；`/api/team` 不在公开白名单，全局 AuthGuard 已保证登录才可读
- 新端点**只返回 `isActive: true` 的上架套餐**（admin 端继续返回全部含下架）
- **`storageLimitBytes` 是 BigInt**：直接 JSON 序列化会 500（现有 admin-team-plan.controller.ts:8 有注释先例），新端点必须同样转 Number
- 前端 `teamApi.listTeamPlans` 改调 `/api/team/plans`，同步 `TeamBillingPage.test.tsx`
- 跨端依赖已全量扫描：仅此一处（subscriptionApi 的 [Admin] banner 三方法只被 admin 页调用，getPublicBanner 走公开端点，无问题）

## 3.3 实施顺序（防自锁）

固定联调顺序，避免中间态把后台锁死：

1. `migrate dev` 加 role 列
2. seed 建/升 ADMIN 账号，**先用 `/api/auth/me` 验证返回 `role: 'ADMIN'`**
3. **最后**接通 AdminGuard（Guard 单测用 mock user 先行，浏览器联调最后挂守卫）
4. 前端同理：先搭 RequireAdmin + AdminLayout + 路由骨架，再逐页迁 ProTable，避免中间态 `/admin` 全 403/404

## 4. 前端路由与布局

### 4.1 路由树（react-router v7 嵌套）

```
RequireAuth（已有）
└─ /admin → RequireAdmin（新）+ AdminLayout（ProLayout）
   ├─ index → <Navigate to="/admin/models" replace />
   ├─ models            模型管理（NodeTypeTabs + 模型 ProTable + 计费规则 ProTable）
   ├─ subscription      会员订阅
   │  ├─ plans          套餐管理
   │  ├─ subscriptions  订阅管理
   │  ├─ credits        积分发放（ProForm 面板）
   │  └─ banner         Banner 管理
   ├─ homepage          首页配置
   │  ├─ announcement   公告条
   │  └─ banners        首页 Banner
   └─ settings          参数配置
```

- 二级 tab 全部升级为子路由：URL 直达、刷新保持、菜单高亮由 pathname 驱动
- 原单页 page.tsx 的 section/subTab useState 全部删除

### 4.2 ProLayout 配置

- `layout="side"`，固定 header，侧边栏可折叠
- 菜单数据用 `route.routes` 配置驱动（name/icon/children）
- `menuItemRender` 用 react-router `<Link>` 渲染；`location` 传入当前 pathname 驱动选中态
- 顶栏右侧：管理员头像/名称（取 AuthProvider.user）+ 退出登录 —— **复用 `useAuth().logout()`**（已封装 sign-out + 清 state），然后 `navigate('/login')`
- 标题：「FlowWeb 管理后台」

### 4.3 RequireAdmin 组件

- `apps/web/src/components/RequireAdmin.tsx`，模式对齐现有 RequireAuth
- loading → 加载提示（**不闪烁 403**：loading 与 role 判定严格互斥，见 §8 测试边界）；`!isAdmin(user?.role)` → 403 页面（antd `Result status="403"` + 返回首页按钮）；ADMIN → `<Outlet />`
- **登录时序**：登录页成功后把响应 user 经 `updateUser()`/`refresh()` 写入 AuthProvider —— `returned: true` 带出的 role 第一时间可用，避免 RequireAdmin 初次渲染拿到旧 user

### 4.4 暗色主题 + 中文 locale（仅 admin 子树，最终结构固定）

App.tsx 顶层已有亮色 ConfigProvider（仅 zIndex，**全项目零 locale 配置**）+ `<AntdApp>` 包裹。AdminLayout 内固定如下结构（四层职责缺一不可）：

```tsx
<ProConfigProvider dark>                        {/* ① Pro 组件暗色 + zh_CN + dayjs 自动切换 */}
  <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary } }}>
    <App>                                       {/* ② admin 局部 antd App：命令式弹层持暗色 */}
      <ProLayout>{/* … */}<Outlet /></ProLayout>
    </App>
  </ConfigProvider>
</ProConfigProvider>
```

- **①与②必须并存**：`ProConfigProvider dark` 只处理 Pro 组件自身 token，antd 原生组件必须 antd `theme.darkAlgorithm`（两者职责不同，缺一边就半亮半暗）
- **②内层 `<App>` 不可省（运行时必现视觉缺陷）**：antd App 的 message/modal/notification holder 在 `<App>` 自身渲染位置创建、主题在该 React 树位置捕获（antd 5.22.5 `es/app/index.js:38`）。顶层亮色 `<AntdApp>` 管不到暗色子树 —— 无内层 `<App>` 时 `App.useApp()` 拿到顶层实例，`message`/`modal.confirm` 弹层渲染为亮色（admin 现有 Announcement/Banner/HomeBanner 3 个组件已在用 useApp，影响真实）。注：4.4 旧表述「Context 穿透 Portal」只对 JSX 形式（ModalForm）成立，命令式 holder 恰是反例
- **中文 locale（N9）**：ProConfigProvider 内部已默认注入 antd zh_CN、自动 dayjs locale、按 antd locale 解析 Pro 中文 intl，无需手动叠三层。导出名 `zhCNIntl`（plan 以实际包体复核）
- 知情点：ProConfigProvider 的 dayjs 切换是**全局**的（与 workspace/utils/time.ts 局部哲学不同），中文产品可接受

### 4.5 admin 子树代码分割

- 现状：vite.config.ts 无 manualChunks，router.tsx 全静态 import —— pro-components 是聚合大包（pro-table/form/layout/provider + 一批 rc-*），admin 静态引入会进**主 bundle**，拖慢画布/首页首屏，与「不影响非 /admin」的边界相悖
- 方案：`/admin` 子树改 `React.lazy` + `Suspense`（fallback 用 Spin），pro-components 只在访问后台时按需拉取；不上 manualChunks，路由级 lazy 足够
- **lazy 边界**：`ProConfigProvider`/ProLayout 等全部放在 lazy 后的 AdminLayout **内部**；RequireAdmin 保持轻量**同步**组件（只依赖 useAuth + antd Result），确保 pro 全家桶整体进异步 chunk

## 5. 业务组件迁移（ProTable / ProForm）

**API 契约不变**；subscription 4 个 Tab 现用裸 fetch（SubscriptionTabs.tsx，按响应体 `code` 判定成功），迁移时**统一收敛到 adminApi/apiFetch 封装**。

**apiFetch 失败提示增强（顺带修复）**：现 `client.ts:17-19` 在 `!res.ok` 时只抛 `API error: 403 ...` 不读 body，而后端异常实际返回可读 `{message}` —— 改为非 ok 时尝试读 `body.message` 挂到 Error。这样验收标准 8 的失败提示是中文可读信息。ProTable request 内 try/catch 返回 `{ data: [], success: false }` 走失败态。

### 5.1 分页协议（不能一个 adapter 一刀切）

| 类型 | 端点 | ProTable 处理 |
|---|---|---|
| 全量数组 | models / pricing-rules / plans / announcements / home-banners / node-types | 前端分页，`data` 全量返回、`total = data.length`。（team-plans **不在此列**：前端无团队套餐管理页、adminApi 无封装、无 PATCH 消费方 —— 后端 admin-team-plan.controller 仅被守卫保护即可，无 UI，不在本次范围） |
| 服务端分页 | subscriptions（`{items, total, page, pageSize}`，后端默认 20 条） | `current/pageSize` 传后端，返回 `{data: items, total}`；**顺带修复现存缺陷**：现前端不传 page/pageSize（antd 默认 10/页分页器在），后端固定截断前 20 条，超 20 条不可见 |
| 空壳端点 | orders / transactions（后端直接返回 `{items:[], total:0}`） | **本次不造假、不放置表格**，不做积分流水页 |

### 5.2 组件迁移清单

| 现组件 | 迁移目标 | 备注 |
|---|---|---|
| ModelTable + ModelFormModal | ProTable + ModalForm | **创建编排必须保留**：现 `handleSave` 创建模型后串行 `addResolution`/`addDuration`（更新分支不发子资源），ModalForm onFinish 同样编排，否则分辨率/时长丢失 |
| PricingRuleTable + PricingRuleFormModal | ProTable + ModalForm | |
| PlanManagementTab | ProTable + ModalForm + 行内 isActive Switch | **Q4 已决议**：复杂字段（价格等 12 字段）进 ModalForm（完整校验：非负、GB↔字节换算等）；`isActive` 上下架这类高频低风险操作保留**行内 Switch（带二次确认）** —— 效率与安全兼顾。替代现「点单元格即改」弱校验行内编辑 |
| SubscriptionManagementTab | ProTable | 服务端分页（5.1） |
| CreditManagementTab | **ProForm 发放面板（非表格）** | 实际是 userId + 数量 + 类型的发放表单，无列表概念 |
| BannerManagementTab | ProTable + ModalForm | |
| AnnouncementManagementTab | ProTable + ModalForm | |
| HomeBannerManagementTab | ProTable + ModalForm | **保留现有 multipart 后端中转通道与封装不变**（原生 `<input type="file">` → `uploadHomeBannerImage` FormData → 后端 FileInterceptor 内存 buffer 魔数校验 → `minio.upload`；presigned 仅用于读图）—— 仅把容器换 ModalForm，**不引入 ProUpload、不新建前端 presigned 直传**，否则违反「API 契约不变」。subscription banner 上传同理 |
| SettingsTab | **元数据驱动 ProForm（复杂表单，单独排期）** | 3 分组、FIELD_META 动态生成字段、敏感字段只读显示「已配置/未配置」、按 diff 禁用保存、保留「重启生效」文案 —— 工作量显著高于其他表单 |
| NodeTypeTabs | 保留节点类型切换交互、不做 ProTable 化 | 现状是手写 button 组（非 antd Tabs），可顺手升级为 antd Tabs |

### 5.3 统一规范

- 页面容器 `PageContainer`（标题、面包屑自动）
- **行内删除用 Popconfirm 二次确认；危险/批量操作用 `modal.confirm`**
- **消息/确认统一 `App.useApp()`**（依赖 §4.4 内层 `<App>`，弹层才持暗色）：antd 静态方法 `message.xxx`/`Modal.confirm` 拿不到内层暗色 ConfigProvider（现 SubscriptionTabs 就在用静态 message），迁移时一并改

## 6. 视觉规范（Q3 终版决议：路径 A —— 保持亮绿 + 按钮深色文字）

- 主题：§4.4 固定结构（ProConfigProvider dark + antd darkAlgorithm + 内层 App）；ProLayout `navTheme="realDark"`
- **品牌色对比度（WCAG 2.1 实算数据）**：antd darkAlgorithm 下实心按钮文字固定白色（`colorTextLightSolid` 不随 colorPrimary 亮度反转），故：

| colorPrimary | 配白字（antd 默认） | 配深色字 rgba(0,0,0,.88) |
|---|---|---|
| **#4ade80（现状绿）** | 1.74 ❌ | **12.05 AAA** |
| #22c55e | 2.28 ❌（不足 UI 3:1） | 9.22 AAA |
| #15803d | 5.02 ✅ AA | — |

- **决议：`colorPrimary` 保持 `#4ade80`（保住亮绿品牌识别），在主题 token `components.Button` 将实心按钮文字覆盖为深色**（对比度 12.05:1 AAA，与现状绿按钮配黑字经验一脉相承）。换深绿方案（#15803d+白字）放弃 —— 品牌色明显变暗
- 间距、卡片化遵循 pro-components 默认，不过度定制

## 7. 交互行为验收标准

1. 未登录访问任意 `/admin/*` → 跳转 `/login`
2. 已登录 USER 访问任意 `/admin/*` → 403 页面
3. USER 直接调任意 `api/admin/*` → 403（后端守卫，绕过前端也拦）
4. **注册/登录请求 body 携带 `role: "ADMIN"` → 落库仍为 USER，无法提权**
5. ADMIN 登录：侧边栏 4 组菜单（含二级）正确渲染，点击切换路由，菜单高亮与 URL 一致
6. 刷新 `/admin/subscription/credits` 等深层路由 → 页面保持
7. 侧边栏折叠/展开可用
8. 每个 ProTable 页面：列表、分页、新建（校验+提交）、编辑回填、删除确认、失败提示可用
9. TeamBillingPage（普通成员）套餐列表正常（只读上架套餐）
10. **暗色页面内 `message`/`modal.confirm` 弹层为暗色**（§4.4 内层 App 生效）
11. **暗色下绿色主按钮（#4ade80）配深色文字可读性达标（12.05:1 AAA，肉眼复核）**

## 8. 测试策略（TDD）

**后端：**
- AdminGuard 单测：未登录 401 / USER 403 / ADMIN 放行 / **前缀边界**（`/api/adminx` 不拦、`/api/admin/x` 拦、`/api/admin` 无尾斜杠精确命中）/ **`getType()` 返回 `'ws'` 时直接放行**
- **提权回归（P0-1，双路径）**：sign-up body 带 `role=ADMIN` → 落库仍 USER（create 静默覆盖）；`PATCH /api/auth/me`（updateUser）带 `role` → 400 FIELD_NOT_ALLOWED
- `/api/team/plans`：成员可读、只回 `isActive: true`、BigInt 转 Number
- 可选：APP_GUARD 注册顺序断言（AuthGuard 先于 AdminGuard，防未来误调 providers 顺序）

**前端**（Vitest + Testing Library；test-setup 已 mock matchMedia/ResizeObserver/rAF/:has() —— ProComponents 前置条件就绪；若报 `scrollIntoView/scrollTo is not a function`，在 test-setup 补这两个 jsdom 缺失 mock）：
- RequireAdmin：USER 渲染 403 / ADMIN 渲染 Outlet / **loading 态不闪烁 403**
- AdminLayout：菜单渲染、menuItemRender Link、pathname → selectedKeys、嵌套暗色 ConfigProvider
- 路由树：index 重定向、深层路由渲染对应页面
- 各页面：mock adminApi 验证列渲染、新建弹窗、删除确认；模型创建编排（addResolution/addDuration）单测
- **现有 5 个 admin 组件测试随新组件重写（保持覆盖，不是删光）**
- AuthProvider User 类型含 role

**浏览器验收：** 第 7 节全部条目。

## 9. 待确认问题

- ~~Q1 管理员账号~~ → **已决议方案 a**：seed 内 signUpEmail 创建 admin 账号（密码走环境变量、≥8 位、需 Redis 在线），已存在则 update role
- ~~Q2 team-plans~~ → **已决议方案 A**：`GET /api/team/plans` 只读端点（显式 @SkipTeamGuard、仅 isActive、BigInt 转 Number），TeamBillingPage 改调
- ~~Q3 品牌色~~ → **终版决议（数据定案）：路径 A** —— `colorPrimary` 保持 #4ade80 + `components.Button` 深色文字（12.05:1 AAA）。#22c55e+默认白字方案否决（2.28:1 连 UI 3:1 都不到）；#15803d+白字方案放弃（品牌绿明显变暗）
- ~~Q4 套餐编辑交互~~ → **已决议 a + 折中**：复杂字段 ModalForm（完整校验），isActive 上下架保留行内 Switch（二次确认）

## 10. 交付物清单

- Prisma migration（user role）
- `@ant-design/pro-components@2.8.10`（精确锁定）+ pnpm why antd 单实例验证记录
- shared：`packages/shared` 新增 Role 类型 + isAdmin
- 后端：AdminGuard（WS 协议跳过 + 前缀边界）+ 全前缀拦截（Guard 顺序正确）+ `GET /api/team/plans` 只读端点（@SkipTeamGuard）+ seed admin 账号（密码 ≥8 位）+ additionalFields（input:false）
- 前端：RequireAdmin、AdminLayout（ProLayout + 嵌套暗色主题 + zhCN locale + App.useApp + 复用 useAuth().logout()）、**8 个叶子路由页面 / 9 个迁移业务组件**（ProTable/ProForm 化 + 分页协议分类 + 裸 fetch 收敛 + apiFetch 读 body.message）、AuthProvider role、admin 子树 React.lazy 代码分割
- 删除：旧 page.tsx 单页切换结构、被替换旧组件（测试重写非删光）
- 全量测试 + 浏览器验收记录（含提权、对比度两条）

## 11. 明确留给 plan / 编码阶段的细节（不进 spec，防文档膨胀）

- AdminGuard 的 `Express.Request` 类型扩展 —— 新增 `global.d.ts`（`AuthenticatedUser` 含 role），AdminGuard 与 RequireAdmin 共用（项目现无声明，全靠 as any）
- ProLayout `menuItemRender/location/selectedKeys` 具体写法、菜单配置与路由 path 对齐
- ModalForm 各页字段校验规则、GB↔字节换算、模型创建编排实现
- `zhCNIntl` 导出名以 2.8.10 实际包体复核、pnpm 安装后单实例核验结果
