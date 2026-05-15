# 个人中心页面 — 设计文档

**日期**: 2026-05-15
**版本**: v1.1.1 → v1.2
**方案**: B — 嵌套路由（侧边栏 + 内容区）

---

## 1. 概述

在 FlowAI 中新增 `/settings` 个人中心页面。用户可以查看和编辑个人资料（用户名、头像）、查看积分余额。页面受路由守卫保护，仅登录用户可访问。

### 目标

1. 查看/编辑个人资料（用户名 + 头像 URL）
2. 查看积分余额（含最后更新时间）
3. 侧边栏 + 内容区布局，可扩展（后续加交易记录）
4. 安全：DTO 验证、token 取 userId、防 XSS、域名白名单、重复提交防护

---

## 2. 路由设计

```
/settings (RequireAuth layout)
  ├── index        → redirect to /settings/profile
  ├── /profile     → ProfilePage
  └── /credits     → CreditsPage
```

路由注册在 `apps/web/src/router.tsx`，置于 `RequireAuth` 的 children 内。

---

## 3. API 设计

### 3.1 `PATCH /api/auth/me` — 更新个人资料（新增）

**Controller**: `auth.controller.ts`
**Service**: `auth.service.ts → updateProfile()`

```
Request:
  Content-Type: application/json
  Cookie: flowweb.session_token=<token>
  Body: { name?: string, image?: string }

Response 200:
  {
    "success": true,
    "data": {
      "user": { id, name, email, emailVerified, image, createdAt, updatedAt }
    }
  }

Response 400:
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "验证失败",
      "details": [...]
    }
  }

Response 401:
  {
    "success": false,
    "error": {
      "code": "UNAUTHORIZED",
      "message": "未登录"
    }
  }
```

**实现逻辑**（Better Auth 最佳实践）:

```
1. AuthGuard 自动解析 session cookie → 挂载 req.user（已完成，无需额外代码）
2. Controller 直接使用 req.user.id
3. Service 调用 Better Auth 原生方法更新：

// auth.service.ts
async updateProfile(userId: string, dto: UpdateProfileDto) {
  const user = await auth.api.updateUser({
    body: { userId, name: dto.name, image: dto.image }
  });
  return user;
}
```

**越权防护**:
- `PATCH /me` 不接受任何 userId 参数 — 用户 ID 始终从 `req.user`（AuthGuard 解析的 session token）获取
- 任何尝试在 body 中传递 userId 的行为均被忽略
- 测试覆盖：User A 的 token 无法修改 User B 的资料

**Better Auth 优势**:
- 更新后所有设备上的会话自动刷新
- 无需手动处理 session 同步
- 无需手动 Prisma 查询
- 符合 Better Auth 最佳实践

### 3.2 `PATCH /api/auth/me` DTO 验证

```ts
// auth/dto/update-profile.dto.ts (新文件)
import { IsOptional, IsString, Length, IsUrl, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @Length(1, 50)
  @Matches(/^[\p{L}\p{N}\s_-]+$/u, {
    message: '用户名只能包含字母、数字、空格、下划线和连字符'
  })
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsUrl({
    require_tld: process.env.NODE_ENV === 'production',
    protocols: process.env.NODE_ENV === 'production' ? ['https'] : ['http', 'https'],
    allow_underscores: true,
    host_whitelist: process.env.NODE_ENV === 'production'
      ? ['flowai.dev', 'cdn.flowai.dev', '*.githubusercontent.com', '*.googleusercontent.com']
      : ['localhost', '127.0.0.1']
  })
  image?: string;
}
```

**安全策略**:
- `@Transform` trim 自动去空格
- name 限制字符集 `[\p{L}\p{N}\s_-]` 防 XSS
- image URL 域名白名单：生产环境仅允许 `flowai.dev`、`cdn.flowai.dev`、GitHub/Google 用户内容 CDN
- 生产环境强制 HTTPS
- 使用 `class-validator` + `class-transformer`（已在项目中）

### 3.3 `GET /api/credits/balance` — 从 token 取 userId（修改）

**Before**: `getBalance(@Query('userId') userId)` — userId 从查询参数传入，回退 `'default-user'`

**After**:
1. 从 request 中获取 `req.user`（由 AuthGuard 解析后挂载）
2. 如无 user 则抛出 401
3. 用 `req.user.id` 查询余额

```ts
@Get('balance')
async getBalance(@Req() req: any) {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedException();
  const balance = await this.service.getOrCreateBalance(userId);
  return {
    credits: balance.credits,
    updatedAt: balance.updatedAt.toISOString()   // ISO 8601
  };
}
```

**响应示例**:
```json
{
  "credits": 100,
  "updatedAt": "2026-05-15T16:30:00.000Z"
}
```

前端可显示 "最后更新于 2026-05-15 16:30"。

---

## 4. 前端设计

### 4.1 文件结构

```
apps/web/src/
├── router.tsx                           # 新增 /settings 嵌套路由
├── components/AuthProvider.tsx           # 扩展 User 接口 + updateUser()
└── pages/settings/
    ├── index.ts                         # barrel export
    ├── SettingsLayout.tsx               # 侧边栏 + <Outlet />
    ├── ProfilePage.tsx                  # 查看/编辑个人资料
    ├── CreditsPage.tsx                  # 积分余额展示
    ├── SettingsLayout.test.tsx          # 布局测试
    ├── ProfilePage.test.tsx             # 资料页测试
    └── CreditsPage.test.tsx             # 积分页测试
```

### 4.2 SettingsLayout（侧边栏）

```
┌─────────────────────────────────────────────────┐
│  ← 返回画布                       FlowAI        │
├────────────┬────────────────────────────────────┤
│            │                                    │
│  个人资料   │          <Outlet />                │
│  积分余额   │       (ProfilePage                 │
│            │        CreditsPage)                 │
│  ────────  │                                    │
│  退出登录   │                                    │
│            │                                    │
└────────────┴────────────────────────────────────┘
```

- 左侧：`w-48` 侧边栏，深色背景 `bg-[#1A1A1A]`
- 导航链接使用 `<NavLink>` 高亮当前 tab
- "退出登录" 调用 `useAuth().logout()` → 跳转首页
- 顶部有 "← 返回画布" 链接

### 4.3 ProfilePage

**查看模式** (默认):
- 头像：显示 image URL 图片，无头像时显示默认占位
- 用户名：可读文本
- 邮箱：灰色只读
- 注册时间：`createdAt` ISO 8601 格式化显示
- 最后更新：`updatedAt` ISO 8601 格式化显示
- "编辑资料" 按钮

**编辑模式** (点击编辑后):
- 头像 URL 输入框
- 用户名输入框（1-50 字符）
- "保存" / "取消" 按钮

**空请求体处理**:
- `PATCH /api/auth/me` with `{}` → 200，不修改任何字段
- 前端：当用户未修改任何内容时，禁用 "保存" 按钮

**重复提交防护**:
- 保存按钮点击后立即 `disabled`，直到请求完成
- 后端 Better Auth 自动处理幂等性

**数据流**:
```
ProfilePage
  │ PATCH /api/auth/me { name, image }
  └── res.data.user ──► auth.updateUser(res.data.user)
                              │
CanvasTopBar ◄── useAuth().user ◄──（实时反映新名字）
```

### 4.4 CreditsPage

- 大字显示当前积分（金色 ⚡ 图标）
- 显示 "最后更新于 YYYY-MM-DD HH:mm"（基于 `updatedAt`）
- 简单统计（如 "注册赠送 100 积分"）
- 后续可扩展为交易记录列表

### 4.5 User 接口扩展

```ts
// AuthProvider.tsx
interface User {
  id: string;
  name: string;
  email: string;
  image?: string;
  emailVerified: boolean;
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601 — 新增
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateUser: (user: User) => void;  // 新增 — 更新本地 auth 状态
}
```

`updateUser` 实现：直接 `setUser(user)`，同步更新本地状态。

### 4.6 CanvasTopBar 联动

CanvasTopBar 中用户名改为 `<Link to="/settings">`，点击跳转到个人中心。

---

## 5. 样式规范

沿用项目 Tailwind 暗色主题：
- 背景: `bg-[#0f0f0f]`
- 卡片: `bg-[#1a1a1a]` + `border-[#333]`
- 主文字: `text-[#e2e8f0]`
- 次要文字: `text-[#888]` / `text-[#ccc]`
- 绿色强调: `text-[#4ade80]` / `bg-[#4ade80]`
- 金色积分: `text-[#f59e0b]`
- 输入框: `bg-[#0f0f0f] border-[#333] text-[#ccc]`
- 按钮: hover 状态 + transition
- 错误: `text-[#ef4444]`

---

## 6. 测试覆盖

### API 测试

| 测试 | 预期 |
|------|------|
| PATCH /me with valid name → 200 + updated user | ✅ |
| PATCH /me with valid image → 200 + updated user | ✅ |
| PATCH /me with both fields → 200 | ✅ |
| PATCH /me with empty body `{}` → 200, no changes | ✅ |
| PATCH /me without cookie → 401 | ✅ |
| **PATCH /me with User A's token → cannot modify User B (越权防护)** | ✅ |
| PATCH /me with name > 50 chars → 400 + VALIDATION_ERROR | ✅ |
| PATCH /me with invalid URL image → 400 | ✅ |
| PATCH /me with non-whitelisted image host → 400 | ✅ |
| PATCH /me with XSS characters in name → 400 | ✅ |
| GET /credits/balance without token → 401 | ✅ |
| GET /credits/balance with token → 200 + credits + updatedAt | ✅ |

### Web 测试

| 测试 | 预期 |
|------|------|
| SettingsLayout renders sidebar links | ✅ |
| SettingsLayout highlights active tab | ✅ |
| ProfilePage shows user info (name, email, createdAt) | ✅ |
| ProfilePage toggles edit mode | ✅ |
| ProfilePage save button disabled when no changes | ✅ |
| ProfilePage save button disabled during request | ✅ |
| ProfilePage saves and calls API → calls updateUser() | ✅ |
| CreditsPage shows credit balance | ✅ |
| CreditsPage shows updatedAt time | ✅ |
| /settings redirects to /settings/profile | ✅ |

---

## 7. 文件变更清单

### API (apps/api/)

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/auth/dto/update-profile.dto.ts` | 新建 | DTO 含 host_whitelist、trim、字符集验证 |
| `src/auth/auth.controller.ts` | 修改 | 新增 `PATCH /me`，使用 req.user（AuthGuard 已挂载） |
| `src/auth/auth.service.ts` | 修改 | 新增 `updateProfile()`，调用 Better Auth 原生方法 |
| `src/auth/auth.controller.spec.ts` | 修改 | 新增 update + 验证测试 |
| `src/modules/credit/credit.controller.ts` | 修改 | 从 token 取 userId，返回 updatedAt |

### Web (apps/web/)

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/router.tsx` | 修改 | 新增 `/settings` 嵌套路由 |
| `src/components/AuthProvider.tsx` | 修改 | 扩展 User (updatedAt) + updateUser() |
| `src/pages/settings/index.ts` | 新建 | barrel |
| `src/pages/settings/SettingsLayout.tsx` | 新建 | 侧边栏 + Outlet |
| `src/pages/settings/ProfilePage.tsx` | 新建 | 查看/编辑资料，空表单/重复提交防护 |
| `src/pages/settings/CreditsPage.tsx` | 新建 | 积分余额 + 更新时间 |
| `src/pages/settings/*.test.tsx` | 新建 | 3 个测试文件 |
| `src/pages/canvas/components/CanvasTopBar.tsx` | 修改 | 用户名链接到 /settings |

---

## 8. 依赖

- `class-validator` — DTO 验证（已在项目中使用）
- `class-transformer` — `@Transform` trim（已在项目中使用）
- `react-router` — NavLink / Outlet / Navigate（已在项目中使用）
- 不需要新依赖
