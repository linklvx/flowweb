# 后台管理重构实施计划（admin-console-refactor）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec v2.4（docs/superpowers/specs/admin-console-refactor.md）实现：User 角色（DB→BetterAuth→守卫→前端）、api/admin/* 全前缀 AdminGuard、ProLayout 后台（暗色+中文+代码分割）、8 个页面全部 ProTable/ProForm 化。

**Architecture:** 后端先建角色链路（migrate→seed→guard，防自锁顺序），前端基建（RequireAdmin/AdminLayout/路由骨架）先于页面迁移；页面迁移期新文件独立存在不动旧路由，最后 Task 20 一次性切换路由并删除旧组件 —— 迁移全程 `/admin` 旧页面零破坏。

**Tech Stack:** NestJS 10 + Prisma 5.22 + better-auth 1.6.11 / React 18 + react-router v7 + antd 5.22.5 + @ant-design/pro-components@2.8.10（精确锁定）/ Vitest 全栈。

**关键事实（已核源码，含二轮 plan 审核实证）：**
- apiFetch（apps/web/src/api/client.ts:10）path 不带 `/api` 前缀、自动 JSON header、`{code:0,data}` 解包
- 全局响应包装：controller 返回裸值即被包成 `{code:0,data}`；HttpExceptionFilter（main.ts:89）返回 `{code:-1,message}`；main.ts **无全局 ValidationPipe**（whitelist 不剥离未知字段 —— 字段名写错直达 Prisma 抛 500）
- app.module.ts:81 现有唯一 `{ provide: APP_GUARD, useClass: AuthGuard }`，AdminGuard 紧随其后注册
- 登录两条路径已调 `refresh()`（AuthModal.tsx:33/61、PhoneLoginForm.tsx:74）—— /me 自动带 role，登录组件零改动
- admin-subscription 路由：plans GET/POST/PATCH、subscriptions GET/PATCH（**仅认 body.status==='expired' 作废，其余静默返回 {message:'仅支持作废操作'}**）、credits/grant POST、orders/transactions GET（空壳）
- **SubscriptionStatus 枚举为小写** `active/expired/upgraded`（schema:443-447）；UserSubscription 字段为 `tier/period/subscribedAt/currentPeriodStart/currentPeriodEnd/nextGrantDate/paidAmount/totalCredits/consumedCredits`（**无 startedAt/expiresAt**），listSubscriptions include plan
- **SubscriptionPlan 12 字段**：name、**tier（必填枚举）**、monthlyCredits、storageLimitBytes、**现价 priceMonthly/priceQuarterly/priceAnnually 必填；original* 三字段 @default(0) 可选**、sort、isActive（**无 seatLimit**，那是 TeamPlan）；createPlan 后端强制 isActive:true（subscription.service.ts:79）—— 新建表单不放上架开关
- 订阅 Banner：**已有封装** subscriptionApi.getAdminBanner/updateBanner/uploadBannerImage + shared `AdminBannerData/UpdateBannerDto`（字段 **backgroundImageKey** 非 imageKey，schema:508）；上传限制 **2MB**（home-banner 才是 5MB）；autoExtend=true 无 countdownEndAt 后端抛错（subscription-banner.service.ts:91-93）
- antd 5.22.5：Modal 只有 **destroyOnClose**（destroyOnHidden 是 5.25+）；实心按钮文字色是 Button 组件 token **primaryColor**（colorTextLightSolid 是全局 alias token，放 components.Button 无效）
- BetterAuth source 确认：`input:false` 在 create 时静默覆盖为 defaultValue、update 时抛 FIELD_NOT_ALLOWED
- 裸 fetch 收敛范围：subscription 3 个 tab（plans/subscriptions/credits）—— banner tab 已走 subscriptionApi 不需收敛

**实施顺序红线（spec §3.3）：** Task 2 migrate → Task 4 seed 并验证 /me 返回 ADMIN → Task 5 才挂 AdminGuard。

**终端约定：本计划全部命令按 Git Bash（Unix 语法）书写 —— 执行会话的 shell 为 bash。若人工在 PowerShell 复跑，需自行改写（`&&`→`;`、去 `2>/dev/null`、`grep`→`Select-String`）。**

**运行命令（Bash CWD 漂移陷阱：每条命令显式绝对路径）：**
- API 测试：`cd D:/flowweb/apps/api && pnpm vitest run <file>`
- Web 测试：`cd D:/flowweb/apps/web && pnpm vitest run <file>`
- 迁移：`cd D:/flowweb/apps/api && pnpm prisma migrate dev --name user-role`（需本地 PG/Redis 在线；migrate dev 需一次性 CREATEDB 授权）

---

## 文件结构总览

```
packages/shared/src/types/role.types.ts                  [新] Role + isAdmin
apps/api/prisma/schema.prisma                             [改] enum Role + User.role
apps/api/src/auth/auth.ts                                 [改] additionalFields(input:false)
apps/api/src/auth/auth.role.spec.ts                       [新] 提权回归测试
apps/api/prisma/seed.ts                                   [改] ensureAdminAccount
apps/api/src/auth/admin.guard.ts                          [新] AdminGuard
apps/api/src/auth/admin.guard.spec.ts                     [新]
apps/api/src/app.module.ts                                [改] 注册 AdminGuard
apps/api/src/modules/team/team.controller.ts              [改] GET plans(@SkipTeamGuard)
apps/api/src/modules/team/team.controller.spec.ts         [新/改] plans 端点测试
apps/web/src/api/client.ts                                [改] !ok 读 body.message
apps/web/src/api/client.test.ts                           [新]
apps/web/src/api/adminApi.ts                              [改] subscription 封装追加
apps/web/src/api/teamApi.ts                               [改] listTeamPlans 路径
apps/web/src/components/AuthProvider.tsx                  [改] User.role
apps/web/src/components/RequireAdmin.tsx                  [新]
apps/web/src/components/RequireAdmin.test.tsx             [新]
apps/web/src/test-setup.ts                                [改] scroll mocks
apps/web/src/pages/admin/AdminLayout.tsx                  [新] 四层结构（default export）
apps/web/src/pages/admin/AdminLayout.test.tsx             [新]
apps/web/src/pages/admin/pages/ModelsPage.tsx             [新] 8 叶子页（均 default export）
apps/web/src/pages/admin/pages/PlansPage.tsx
apps/web/src/pages/admin/pages/SubscriptionsPage.tsx
apps/web/src/pages/admin/pages/CreditsPage.tsx
apps/web/src/pages/admin/pages/SubscriptionBannerPage.tsx
apps/web/src/pages/admin/pages/AnnouncementPage.tsx
apps/web/src/pages/admin/pages/HomeBannersPage.tsx
apps/web/src/pages/admin/pages/SettingsPage.tsx
apps/web/src/pages/admin/pages/*.test.tsx                 [新] 各页测试
apps/web/src/router.tsx                                   [改] Task 20 嵌套+lazy
apps/web/src/pages/admin/page.tsx                         [删] Task 20
apps/web/src/pages/admin/components/*                     [删] Task 20（全部旧组件+旧测试）
```

---

## 阶段 A：角色机制（后端）

### Task 0: 执行环境确认（动工前 30 秒）

- [ ] **Step 1: 确认 shell**

Run: `uname`
Expected: `MINGW64_NT-...`（Git Bash 的 MSYS 环境必有此内建命令）→ 本计划命令全部按 Git Bash 书写，直接执行。
若报 CommandNotFoundException /「不是内部或外部命令」（PowerShell / cmd 环境）→ 停止，先切换到 Git Bash 终端再执行本计划（或按头部「终端约定」改写全部命令）。注：PowerShell 中 `$0` 未定义、`echo $0` 仅输出空行，区分度弱于 uname（七轮审核修正）。

### Task 1: shared Role 类型 + isAdmin

**Files:**
- Create: `packages/shared/src/types/role.types.ts`
- Test: `packages/shared/src/types/role.types.test.ts`
- Modify: `packages/shared/src/index.ts`、`packages/shared/package.json`

- [ ] **Step 0: 给 shared 补 vitest 基建（该包现只有 tsc）**

Run: `cd D:/flowweb/packages/shared && pnpm add -D vitest@^2.1.0`
package.json scripts 改为：
```json
    "build": "tsc --noEmit",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
```
（turbo 若按 build 依赖 tsc 不受影响；test 从 tsc 换成 vitest run）

- [ ] **Step 1: 写失败测试**

```ts
// packages/shared/src/types/role.types.test.ts
import { describe, it, expect } from 'vitest';
import { isAdmin, type Role } from './role.types';

describe('isAdmin 类型谓词', () => {
  it('ADMIN 命中且收窄为 "ADMIN"', () => {
    const role: Role = 'ADMIN';
    if (isAdmin(role)) expect(role).toBe('ADMIN');
    else throw new Error('should narrow');
  });
  it('USER / undefined / 非法串均不命中', () => {
    expect(isAdmin('USER')).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin('admin' as unknown)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/packages/shared && pnpm vitest run src/types/role.types.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/shared/src/types/role.types.ts
export type Role = 'USER' | 'ADMIN';
export const isAdmin = (role: unknown): role is 'ADMIN' => role === 'ADMIN';
```

在 `packages/shared/src/index.ts` 末尾追加：
```ts
export * from './types/role.types';
```

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/packages/shared && pnpm vitest run src/types/role.types.test.ts`
Expected: PASS

- [ ] **Step 5: 检查 api 侧依赖（AdminGuard 要用 shared）**

Run: `grep '"@flowweb/shared"' D:/flowweb/apps/api/package.json`
若无输出：`cd D:/flowweb/apps/api && pnpm add @flowweb/shared --workspace`
验证：`cd D:/flowweb/apps/api && pnpm exec tsc -p tsconfig.spec.json --noEmit`（通过）

- [ ] **Step 6: Commit**

```bash
cd D:/flowweb && git add packages/shared apps/api/package.json apps/api/pnpm-lock.yaml 2>/dev/null; git add pnpm-lock.yaml 2>/dev/null; git commit -m "feat(shared): Role 类型与 isAdmin 谓词"
```

---

### Task 2: Prisma User.role 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（User 模型 + 新 enum）

- [ ] **Step 1: schema 加字段**

在 `schema.prisma` 的 `model User {` 内 `emailVerified` 行后加：
```prisma
  role           Role            @default(USER)
```
在文件任意顶层位置（建议 User 模型前）加：
```prisma
enum Role {
  USER
  ADMIN
}
```

- [ ] **Step 2: 迁移**

Run: `cd D:/flowweb/apps/api && pnpm prisma migrate dev --name user-role`
Expected: 生成新时间戳迁移目录（含 `CREATE TYPE "Role"` + `ALTER TABLE "User"`），并自动 regenerate client。
前置：本地 PostgreSQL/Redis 在线；migrate dev 需一次性 CREATEDB 授权（shadow DB）。

- [ ] **Step 3: 全链 replay 验证（spec §2.1）**

Run: `cd D:/flowweb/apps/api && pnpm prisma migrate reset --force`
Expected: 14+1 个迁移全部 replay 成功（开发库数据可清）。

- [ ] **Step 4: 类型冒烟**

Run: `cd D:/flowweb/apps/api && pnpm exec tsc -p tsconfig.spec.json --noEmit`
Expected: 通过（新 `$Enums.Role` 可用）

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/api/prisma/schema.prisma apps/api/prisma/migrations && git commit -m "feat(db): User.role 字段（enum USER/ADMIN 默认 USER）"
```

---

### Task 3: BetterAuth additionalFields + 提权回归测试

**Files:**
- Modify: `apps/api/src/auth/auth.ts`（betterAuth 配置）
- Test: `apps/api/src/auth/auth.role.spec.ts`

- [ ] **Step 1: 写失败测试（需本地 PG+Redis 在线；auth.ts 顶层 new Redis）**

```ts
// apps/api/src/auth/auth.role.spec.ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { auth } from './auth';

const prisma = new PrismaClient();

/** 清理：先删个人团队再删用户（关系无级联的方向需显式） */
async function cleanup(email: string) {
  const u = await prisma.user.findUnique({ where: { email } });
  if (u) {
    await prisma.team.deleteMany({ where: { ownerId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  }
}

afterAll(async () => { await prisma.$disconnect(); });

describe('role 防提权回归（P0-1，双路径）', () => {
  it('sign-up body 带 role=ADMIN → 落库仍 USER（input:false+defaultValue 静默覆盖）', async () => {
    const email = `priv1-${Date.now()}@test.flowweb.local`;
    await auth.api.signUpEmail({
      body: { email, password: 'password123', name: 'p1', role: 'ADMIN' } as any,
    });
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe('USER');
    await cleanup(email);
  });

  it('updateUser（PATCH /me 路径）带 role → 报错且不落库', async () => {
    const email = `priv2-${Date.now()}@test.flowweb.local`;
    await auth.api.signUpEmail({ body: { email, password: 'password123', name: 'p2' } });
    const signIn = await auth.api.signInEmail({ body: { email, password: 'password123' } });
    const headers = new Headers({ cookie: `flowweb.session_token=${signIn.token}` });
    await expect(
      auth.api.updateUser({ body: { name: 'x', role: 'ADMIN' } as any, headers }),
    ).rejects.toThrow();
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe('USER');
    await cleanup(email);
  });
});
```

备注：若 `updateUser` 拒绝行为不是 throw 而是 `{ error }` 返回，把断言改为 `res.error` 真值检查（better-auth 1.6.11 默认 throw APIError）。

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/api && pnpm vitest run src/auth/auth.role.spec.ts`
Expected: FAIL —— 第一条：sign-up 带 role 落库为 'ADMIN'（additionalFields 未配置，input 未禁）。
**执行勘误（Task 3 实测）**：真实红态在第二条（updateUser 对 role 静默接受、resolved 而非 reject）；第一条配置前即绿——better-auth 1.6.11 对未声明字段直接剥离 + Prisma @default(USER) 兜底。另：plan 原文的裸 `signIn.token` cookie 构建必过不了 HMAC 验签（假阳性），实现改为 `signInEmail({ returnHeaders: true })` 提取真实 Set-Cookie，拒绝断言用 `/role is not allowed/` 匹配具体错误。

- [ ] **Step 3: 实现 —— auth.ts 加 user.additionalFields**

在 `betterAuth({` 配置中（`databaseHooks` 之后）加：
```ts
  user: {
    additionalFields: {
      role: { type: 'string' as const, defaultValue: 'USER', returned: true, input: false },
    },
  },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/api && pnpm vitest run src/auth/auth.role.spec.ts`
Expected: PASS（两条）

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/api/src/auth/auth.ts apps/api/src/auth/auth.role.spec.ts && git commit -m "feat(auth): BetterAuth role additionalFields（input:false 防注册提权）+ 回归测试"
```

---

### Task 4: seed admin 账号

**Files:**
- Modify: `apps/api/prisma/seed.ts`（main() 尾部 console.log 前插入）

- [ ] **Step 1: 实现（signUpEmail 走 Argon2id；已存在则 update role）**

在 seed.ts 顶部 import 区加：
```ts
import { auth } from '../src/auth/auth';
```
在 `main()` 内最后的 `console.log('Seed complete...')` 之前加：
```ts
  // 管理员账号：不存在则经 BetterAuth signUpEmail（正确哈希），存在则确保 ADMIN
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@flowweb.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin12345'; // better-auth minPasswordLength=8
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await auth.api.signUpEmail({ body: { email: adminEmail, password: adminPassword, name: 'Admin' } });
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'ADMIN' } });
    console.log(`Admin created: ${adminEmail}`);
  } else if (existingAdmin.role !== 'ADMIN') {
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'ADMIN' } });
    console.log(`Admin promoted: ${adminEmail}`);
  }
```

- [ ] **Step 2: seed.ts 尾部加 process.exit(0)（必做 —— auth.ts:17 顶层 new Redis，ioredis 连接会让进程在 finally 后挂起）**

`main().finally` 块改为：
```ts
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
```

- [ ] **Step 3: 运行 seed**

Run: `cd D:/flowweb/apps/api && pnpm prisma db seed`
（prisma.seed=tsx 已配；若报无脚本用 `pnpm exec tsx prisma/seed.ts`）
Expected: 输出 `Admin created: admin@flowweb.local`，进程正常退出。

- [ ] **Step 4: 验证 /me 带 role（spec §3.3 顺序红线）**

```bash
cd D:/flowweb/apps/api && pnpm exec tsx -e "
import { auth } from './src/auth/auth';
const s = await auth.api.signInEmail({ body: { email: 'admin@flowweb.local', password: 'admin12345' } });
console.log('user.role =', s.user.role);
process.exit(0);
"
```
Expected: `user.role = ADMIN`（sign-in 响应经 returned:true 直接带 role）

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/api/prisma/seed.ts && git commit -m "feat(seed): 管理员账号（ADMIN_EMAIL/ADMIN_PASSWORD 可覆盖，signUpEmail 正确哈希）"
```

---

### Task 5: AdminGuard + 全局注册

**Files:**
- Create: `apps/api/src/auth/admin.guard.ts`
- Test: `apps/api/src/auth/admin.guard.spec.ts`
- Modify: `apps/api/src/app.module.ts:80-82`（providers）

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/auth/admin.guard.spec.ts
import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

const ctx = (path: string | undefined, user: any, type = 'http') => ({
  getType: () => type,
  switchToHttp: () => ({ getRequest: () => ({ path, user }) }),
}) as any;

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('非 HTTP 上下文（ws gateway）直接放行', () => {
    expect(guard.canActivate(ctx(undefined, undefined, 'ws'))).toBe(true);
  });
  it('非 admin 前缀放行（/api/team/plans）', async () => {
    await expect(guard.canActivate(ctx('/api/team/plans', { role: 'USER' }))).resolves.toBe(true);
  });
  it('前缀边界：/api/adminx 不拦', async () => {
    await expect(guard.canActivate(ctx('/api/adminx', { role: 'USER' }))).resolves.toBe(true);
  });
  // 执行期修正（Task 5 质量审查 C1）：Express 路由大小写不敏感，大写变体必须照拦
  it('大小写变体绕过防护：/API/admin/models USER → 403', async () => {
    await expect(guard.canActivate(ctx('/API/admin/models', { role: 'USER' }))).rejects.toThrow('需要管理员权限');
  });
  it('大小写变体绕过防护：/Api/Admin 未登录 → 401', async () => {
    await expect(guard.canActivate(ctx('/Api/Admin', undefined))).rejects.toThrow(UnauthorizedException);
  });
  it('/api/admin 无尾斜杠精确命中：未登录 401', async () => {
    await expect(guard.canActivate(ctx('/api/admin', undefined))).rejects.toThrow(UnauthorizedException);
  });
  it('USER 访问 admin 路径 403 中文 message', async () => {
    await expect(guard.canActivate(ctx('/api/admin/models', { role: 'USER' }))).rejects.toThrow('需要管理员权限');
  });
  it('ADMIN 放行', async () => {
    await expect(guard.canActivate(ctx('/api/admin/models', { role: 'ADMIN' }))).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/api && pnpm vitest run src/auth/admin.guard.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// apps/api/src/auth/admin.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { isAdmin } from '@flowweb/shared';

@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true; // execution/payment WS gateway 走各自鉴权
    const req = context.switchToHttp().getRequest();
    // 执行期修正（Task 5 质量审查 C1）：Express 路由大小写不敏感（caseSensitive 默认 false），
    // /API/admin/* 变体可命中控制器而大小写敏感前缀检查放行 → USER 绕过守卫，必须小写化对齐
    const path: string = (req.path ?? '').toLowerCase();
    const isAdminPath = path === '/api/admin' || path.startsWith('/api/admin/');
    if (!isAdminPath) return true;
    if (!req.user) throw new UnauthorizedException('未登录');
    if (!isAdmin(req.user?.role)) throw new ForbiddenException('需要管理员权限');
    return true;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/api && pnpm vitest run src/auth/admin.guard.spec.ts`
Expected: PASS（8 条，含大小写变体回归 2 条）

- [ ] **Step 5: 全局注册（AuthGuard 之后）**

`apps/api/src/app.module.ts`：import 区加 `import { AdminGuard } from './auth/admin.guard';`；providers 数组改为：
```ts
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AdminGuard },
    // ...其余原有 providers 保持不动
```

- [ ] **Step 6: 全量 api 测试回归**

Run: `cd D:/flowweb/apps/api && pnpm test`
Expected: 全绿（若既有测试因 admin 端点 403 失败：那些测试 mock 的 ExecutionContext 需带 user.role='ADMIN'，按失败信息逐个补 —— 不允许改 guard 放宽）

- [ ] **Step 7: Commit**

```bash
cd D:/flowweb && git add apps/api/src/auth/admin.guard.ts apps/api/src/auth/admin.guard.spec.ts apps/api/src/app.module.ts && git commit -m "feat(api): AdminGuard 全前缀拦截 api/admin/*（WS 跳过+边界精确+中文 403）"
```

---

### Task 6: GET /api/team/plans 只读端点 + teamApi 改造

**Files:**
- Modify: `apps/api/src/modules/team/team.controller.ts`
- Test: `apps/api/src/modules/team/team.controller.spec.ts`（存在则追加，否则新建）
- Modify: `apps/web/src/api/teamApi.ts:165-167`

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 team.controller.spec.ts（对齐该文件现有 mkController 风格：new TeamController(...))
import { describe, it, expect, vi } from 'vitest';
import { TeamController } from './team.controller';

const mkController = (prisma: any) =>
  new TeamController(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);

describe('GET /api/team/plans（成员只读上架套餐）', () => {
  it('只查 isActive:true、按 sort 排序、BigInt 转 Number', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'p1', name: '月卡', storageLimitBytes: 107374182400n, isActive: true, sort: 1 },
    ]);
    const c = mkController({ teamPlan: { findMany } });
    const plans = await (c as any).listActivePlans();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
    expect(plans[0].storageLimitBytes).toBe(107374182400); // Number 非 BigInt
    expect(typeof plans[0].storageLimitBytes).toBe('number');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/api && pnpm vitest run src/modules/team/team.controller.spec.ts`
Expected: FAIL（listActivePlans 不存在）

- [ ] **Step 3: 实现 —— team.controller.ts 加端点**

import 区补 `Get`（已有）。在类内 `createTeam` 方法后加：
```ts
  /** 成员级只读：上架团队套餐（TeamBillingPage 用；admin 全量走 /api/admin/team-plans） */
  @Get('plans')
  @SkipTeamGuard()
  async listActivePlans() {
    const plans = await this.prisma.teamPlan.findMany({
      where: { isActive: true },
      orderBy: { sort: 'asc' },
    });
    // storageLimitBytes 为 BigInt，JSON 序列化会 500（对齐 admin-team-plan.controller 处理）
    return plans.map((p) => ({ ...p, storageLimitBytes: Number(p.storageLimitBytes) }));
  }
```

- [ ] **Step 4: 运行确认通过 + api 全量回归**

Run: `cd D:/flowweb/apps/api && pnpm vitest run src/modules/team/team.controller.spec.ts && pnpm test`
Expected: PASS / 全绿

- [ ] **Step 5: 前端 teamApi 改路径**

`apps/web/src/api/teamApi.ts:166`：
```ts
export function listTeamPlans() {
  return apiFetch<TeamPlanRow[]>('/team/plans');
}
```
（TeamBillingPage.test.tsx mock 的是 teamApi 模块函数，不涉及 URL —— 零改动，运行 `cd D:/flowweb/apps/web && pnpm vitest run src/pages/team/TeamBillingPage.test.tsx` 确认仍绿。）

- [ ] **Step 6: Commit**

```bash
cd D:/flowweb && git add apps/api/src/modules/team apps/web/src/api/teamApi.ts && git commit -m "feat(team): GET /api/team/plans 成员只读上架套餐（BigInt 转 Number），TeamBillingPage 改调"
```

---

## 阶段 B：前端基建

### Task 7: apiFetch 失败读 body.message

**Files:**
- Modify: `apps/web/src/api/client.ts:17-23`
- Test: `apps/web/src/api/client.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/api/client.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch 失败提示', () => {
  it('非 ok 且 body 含 message → 抛中文 message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: -1, message: '需要管理员权限' }), { status: 403 }),
    ));
    await expect(apiFetch('/x')).rejects.toThrow('需要管理员权限');
  });
  it('body 无 message → 回退状态行（含 status）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(apiFetch('/x')).rejects.toThrow('500');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/api/client.test.ts`
Expected: 第一条 FAIL（实际抛 `API error: 403`）

- [ ] **Step 3: 实现 —— client.ts 17-23 行替换**

```ts
  if (!res.ok) {
    let msg = `API error: ${res.status} ${res.statusText}`;
    try {
      const j = await res.clone().json();
      if (j?.message) msg = j.message;
    } catch { /* body 非 JSON，保留状态行 */ }
    const err = Object.assign(new Error(msg), { status: res.status });
    throw err;
  }
```

- [ ] **Step 4: 运行确认通过 + web 全量回归（apiFetch 是公共路径）**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/api/client.test.ts && pnpm test`
Expected: PASS / 全绿（若既有测试断言英文状态行文案，按新行为更新断言 —— 属预期改进）

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/api/client.ts apps/web/src/api/client.test.ts && git commit -m "feat(web): apiFetch 非 ok 时读 body.message（中文失败提示）"
```

---

### Task 8: 安装 @ant-design/pro-components@2.8.10（精确锁定）

**Files:**
- Modify: `apps/web/package.json`（pnpm add 自动）

- [ ] **Step 1: 安装**

Run: `cd D:/flowweb/apps/web && pnpm add @ant-design/pro-components@2.8.10 --save-exact`
Expected: package.json 中 `"@ant-design/pro-components": "2.8.10"`（无 ^）

- [ ] **Step 2: 单实例验证（spec §1）**

Run: `cd D:/flowweb/apps/web && pnpm why antd`
Expected: 仅一份 antd 5.22.5（pro-components peer 满足，不引入第二份）

- [ ] **Step 3: 安装后全量回归**

（zhCNIntl/ProConfigProvider/ProFormDateTimePicker 导出已经审核方解包 2.8.10 定案：聚合包直接 re-export pro-provider 2.16.2 的 zhCNIntl 与 pro-form 2.32.0 的 ProFormDateTimePicker —— 无需再验导出）
Run: `cd D:/flowweb/apps/web && pnpm test`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
cd D:/flowweb && git add apps/web/package.json pnpm-lock.yaml && git commit -m "chore(web): 引入 @ant-design/pro-components@2.8.10（精确锁定）"
```

---

### Task 9: AuthProvider role 类型 + RequireAdmin

**Files:**
- Modify: `apps/web/src/components/AuthProvider.tsx:3-13`（User interface）
- Create: `apps/web/src/components/RequireAdmin.tsx`
- Test: `apps/web/src/components/RequireAdmin.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/components/RequireAdmin.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequireAdmin } from './RequireAdmin';

const authState = { user: null as any, loading: false };
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => authState,
}));

function setup() {
  return render(
    <MemoryRouter initialEntries={['/admin/x']}>
      <Routes>
        <Route element={<RequireAdmin />}>
          <Route path="/admin/x" element={<div>ADMIN CONTENT</div>} />
        </Route>
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { authState.user = null; authState.loading = false; });

describe('RequireAdmin', () => {
  it('loading 态不渲染 403 也不渲染内容（不闪烁）', () => {
    authState.loading = true;
    const { container } = setup();
    expect(container.querySelector('.ant-spin')).toBeTruthy();
    expect(screen.queryByText('需要管理员权限')).toBeNull();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });
  it('未登录 → 跳 /login', () => {
    authState.user = null;
    setup();
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy();
  });
  it('USER → 403 页面', () => {
    authState.user = { id: 'u', role: 'USER' };
    setup();
    expect(screen.getByText('需要管理员权限')).toBeTruthy();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });
  it('ADMIN → 渲染子路由', () => {
    authState.user = { id: 'u', role: 'ADMIN' };
    setup();
    expect(screen.getByText('ADMIN CONTENT')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/components/RequireAdmin.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

AuthProvider.tsx 的 User interface 加一行（import 区加 `import type { Role } from '@flowweb/shared';`）：
```ts
  role?: Role; // DB 加列后 /me 必返回；可选以兼容测试 fixture
```

```tsx
// apps/web/src/components/RequireAdmin.tsx
import { Navigate, Outlet } from 'react-router';
import { Result, Button, Spin } from 'antd';
import { useAuth } from '@/components/AuthProvider';
import { isAdmin } from '@flowweb/shared';

export function RequireAdmin() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex justify-center p-16"><Spin /></div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin(user.role)) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="需要管理员权限"
        extra={<Button type="primary" href="/">返回首页</Button>}
      />
    );
  }
  return <Outlet />;
}
```

- [ ] **Step 4: 运行确认通过 + tsc**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/components/RequireAdmin.test.tsx && pnpm exec tsc --noEmit`
（web 仅 tsconfig.json 无 tsconfig.app.json；build 走 tsc -b，验证用 noEmit 读默认配置）
Expected: PASS（4 条）/ 类型通过

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/components/AuthProvider.tsx apps/web/src/components/RequireAdmin.tsx apps/web/src/components/RequireAdmin.test.tsx && git commit -m "feat(web): RequireAdmin 守卫（403 中文/防闪烁）+ AuthProvider role 类型"
```

---

### Task 10: AdminLayout（四层结构）+ test-setup scroll mocks

**Files:**
- Modify: `apps/web/src/test-setup.ts`（末尾追加）
- Create: `apps/web/src/pages/admin/AdminLayout.tsx`（default export）
- Test: `apps/web/src/pages/admin/AdminLayout.test.tsx`

- [ ] **Step 1: test-setup 追加 scroll mocks（ProComponents 前置）**

```ts
// ProComponents（rc-virtual-list 等）依赖 scrollIntoView/scrollTo，jsdom 未实现
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!window.scrollTo) (window as any).scrollTo = () => {};
```

- [ ] **Step 2: 写失败测试**

```tsx
// apps/web/src/pages/admin/AdminLayout.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi } from 'vitest';

const authState = { user: { id: 'a', name: 'Admin', role: 'ADMIN' } as any, loading: false, logout: vi.fn() }; // AdminLayout 解构 logout，mock 需带
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authState }));

import AdminLayout from './AdminLayout';

describe('AdminLayout', () => {
  it('渲染 4 组一级菜单文案（二级菜单 jsdom 布局测量脆弱，用容错断言）', () => {
    render(
      <MemoryRouter initialEntries={['/admin/models']}>
        <AdminLayout />
      </MemoryRouter>,
    );
    // 一级菜单精确断言（ProLayout 菜单默认收起二级，展开依赖测量）
    for (const label of ['模型管理', '会员订阅', '首页配置', '参数配置']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 二级菜单容错：存在即可，不存在不视为失败（浏览器验收覆盖）
    for (const label of ['套餐管理', '公告条']) {
      screen.queryByText(label); // no-throw
    }
  });
  it('菜单项渲染为 react-router Link（href 指向子路由）', () => {
    render(
      <MemoryRouter initialEntries={['/admin/models']}>
        <AdminLayout />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /模型管理/ });
    expect(link.getAttribute('href')).toBe('/admin/models');
  });
  it('顶栏含退出登录按钮', () => {
    render(
      <MemoryRouter initialEntries={['/admin/models']}>
        <AdminLayout />
      </MemoryRouter>,
    );
    expect(screen.getByText('退出登录')).toBeTruthy();
  });

  it('点击退出登录调用 modal.confirm（useApp 必须在 AntdApp 内层，回归 P1-1）', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/models']}>
        <AdminLayout />
      </MemoryRouter>,
    );
    await user.click(screen.getByText('退出登录'));
    // modal.confirm 正常工作（在 App context 内）→ 弹窗标题渲染；若 useApp 在父层则此处抛 TypeError
    expect(await screen.findByText('确认退出登录？')).toBeTruthy();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/AdminLayout.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现（四层结构 = spec §4.4 定稿）**

```tsx
// apps/web/src/pages/admin/AdminLayout.tsx
import { Suspense } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { App as AntdApp, Button, ConfigProvider, Spin } from 'antd';
import { ProConfigProvider, ProLayout, zhCNIntl } from '@ant-design/pro-components';
import {
  AppstoreOutlined, CrownOutlined, HomeOutlined, LogoutOutlined, SettingOutlined,
} from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import { useAuth } from '@/components/AuthProvider';

const menuRoute = {
  path: '/admin',
  routes: [
    { path: '/admin/models', name: '模型管理', icon: <AppstoreOutlined /> },
    {
      path: '/admin/subscription', name: '会员订阅', icon: <CrownOutlined />,
      routes: [
        { path: '/admin/subscription/plans', name: '套餐管理' },
        { path: '/admin/subscription/subscriptions', name: '订阅管理' },
        { path: '/admin/subscription/credits', name: '积分发放' },
        { path: '/admin/subscription/banner', name: 'Banner 设置' },
      ],
    },
    {
      path: '/admin/homepage', name: '首页配置', icon: <HomeOutlined />,
      routes: [
        { path: '/admin/homepage/announcement', name: '公告条' },
        { path: '/admin/homepage/banners', name: '首页 Banner' },
      ],
    },
    { path: '/admin/settings', name: '参数配置', icon: <SettingOutlined /> },
  ],
};

// 外壳：Provider 层。useApp 必须在 <AntdApp> 子树内调用 —— 父组件读不到子 Provider 的 context
//（antd app/context.js 默认值 {message:{},modal:{}}，父层拿到空对象，modal.confirm 不是函数）
export default function AdminLayout() {
  return (
    <ProConfigProvider dark intl={zhCNIntl}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          // 不传 algorithm：嵌套 theme 的 child.algorithm 整体覆盖 parent（useTheme.js 合并语义），
          // 显式传 darkAlgorithm 会覆盖 ProConfigProvider dark 注入的 proTheme.darkAlgorithm（其内部已含 antd 暗色 + pro 专属暗色微调）—— 暗色统一交给 ProConfigProvider
          token: { colorPrimary: '#4ade80' },
          components: { Button: { primaryColor: 'rgba(0,0,0,0.88)' } }, // Q3 路径 A：实心按钮文字色是 Button 组件 token primaryColor（5.22.5 无 colorTextLightSolid 组件 token）
        }}
      >
        <AntdApp>
          <AdminLayoutInner />
        </AntdApp>
      </ConfigProvider>
    </ProConfigProvider>
  );
}

function AdminLayoutInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { modal } = AntdApp.useApp(); // 此时在 App context 内，confirm 可用且持暗色主题

  const handleLogout = () => {
    modal.confirm({
      title: '确认退出登录？',
      onOk: async () => {
        await logout();
        navigate('/login');
      },
    });
  };

  return (
    <ProLayout
            title="FlowWeb 管理后台"
            layout="side"
            navTheme="realDark"
            fixSiderbar
            fixedHeader
            route={menuRoute}
            location={{ pathname: location.pathname }}
            menuItemRender={(item, dom) => (item.path ? <Link to={item.path}>{dom}</Link> : dom)}
            actionsRender={() => [
              <span key="admin-name" className="pr-2 text-sm">{user?.name ?? '管理员'}</span>, // spec §4.2 顶栏管理员名称
              <Button key="logout" type="text" icon={<LogoutOutlined />} onClick={handleLogout}>
                退出登录
              </Button>,
            ]}
          >
            <Suspense fallback={<div className="flex justify-center p-16"><Spin /></div>}>
              <Outlet />
            </Suspense>
    </ProLayout>
  );
}
```

备注：zhCNIntl 的 import 源以 Task 8 Step 3 验证结果为准（聚合包 or pro-provider）。

- [ ] **Step 5: 运行确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/AdminLayout.test.tsx`
Expected: PASS（4 条）

- [ ] **Step 6: Commit**

```bash
cd D:/flowweb && git add apps/web/src/test-setup.ts apps/web/src/pages/admin/AdminLayout.tsx apps/web/src/pages/admin/AdminLayout.test.tsx && git commit -m "feat(web): AdminLayout 四层结构（ProConfigProvider dark+zhCNIntl/暗色/局部App/ProLayout）"
```

---

### Task 11: adminApi 补 subscription 封装（裸 fetch 收敛）

**Files:**
- Modify: `apps/web/src/api/adminApi.ts`（末尾追加）
- Test: `apps/web/src/api/adminApi.subscription.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/web/src/api/adminApi.subscription.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./client', () => ({ apiFetch: vi.fn().mockResolvedValue({}) }));
import { apiFetch } from './client';
import {
  fetchAdminPlans, createAdminPlan, updateAdminPlan,
  fetchAdminSubscriptions, updateAdminSubscription, grantCredits,
} from './adminApi';

afterEach(() => vi.clearAllMocks());

describe('admin subscription 封装（路径/方法/body）', () => {
  it('fetchAdminPlans → GET /admin/subscription/plans', async () => {
    await fetchAdminPlans();
    expect(apiFetch).toHaveBeenCalledWith('/admin/subscription/plans');
  });
  it('createAdminPlan → POST，updateAdminPlan → PATCH /:id', async () => {
    await createAdminPlan({ name: 'x' } as any);
    await updateAdminPlan('p1', { priceMonthly: 100 });
    expect(apiFetch).toHaveBeenCalledWith('/admin/subscription/plans', expect.objectContaining({ method: 'POST' }));
    expect(apiFetch).toHaveBeenCalledWith('/admin/subscription/plans/p1', expect.objectContaining({ method: 'PATCH' }));
  });
  it('fetchAdminSubscriptions → 服务端分页参数', async () => {
    await fetchAdminSubscriptions({ page: 2, pageSize: 20 });
    expect(apiFetch).toHaveBeenCalledWith('/admin/subscription/subscriptions?page=2&pageSize=20');
  });
  it('grantCredits → POST credits/grant', async () => {
    await grantCredits({ userId: 'u1', amount: 10, creditType: 'regular' });
    expect(apiFetch).toHaveBeenCalledWith('/admin/subscription/credits/grant', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/api/adminApi.subscription.test.ts`
Expected: FAIL（函数不存在）

- [ ] **Step 3: 实现 —— adminApi.ts 末尾追加**

```ts
// ===== 会员订阅管理（收敛自 SubscriptionTabs 裸 fetch，API 契约不变）=====
// AdminPlanRow 对齐 SubscriptionPlan schema:478-497（12 字段，无 seatLimit —— 那是 TeamPlan）
export interface AdminPlanRow {
  id: string; name: string; tier: 'basic' | 'pro' | 'max' | 'ultra';
  monthlyCredits: number; storageLimitBytes: number;
  priceMonthly: number; originalPriceMonthly: number;
  priceQuarterly: number; originalPriceQuarterly: number;
  priceAnnually: number; originalPriceAnnually: number;
  sort: number; isActive: boolean;
}
// 对齐 UserSubscription schema:520-545（status 小写枚举；无 startedAt/expiresAt）
export interface AdminSubscriptionRow {
  id: string; userId: string; planId: string;
  tier: string; period: string; status: 'active' | 'expired' | 'upgraded';
  paidAmount: number; totalCredits: number; consumedCredits: number;
  subscribedAt: string; currentPeriodStart: string; currentPeriodEnd: string; nextGrantDate: string;
  plan?: { name: string };
}
export type AdminSubscriptionPage = { items: AdminSubscriptionRow[]; total: number; page: number; pageSize: number };

export function fetchAdminPlans(): Promise<AdminPlanRow[]> {
  return apiFetch('/admin/subscription/plans');
}
export function createAdminPlan(data: Partial<AdminPlanRow>): Promise<AdminPlanRow> {
  return apiFetch('/admin/subscription/plans', { method: 'POST', body: JSON.stringify(data) });
}
export function updateAdminPlan(id: string, data: Partial<AdminPlanRow>): Promise<AdminPlanRow> {
  return apiFetch(`/admin/subscription/plans/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}
export function fetchAdminSubscriptions(params: { page: number; pageSize: number }): Promise<AdminSubscriptionPage> {
  const q = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  return apiFetch(`/admin/subscription/subscriptions?${q}`);
}
export function updateAdminSubscription(id: string, data: Partial<AdminSubscriptionRow>): Promise<AdminSubscriptionRow> {
  return apiFetch(`/admin/subscription/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}
/** 作废（后端仅认 status==='expired'，其余静默忽略 —— admin-subscription.controller.ts:40-43） */
export function cancelAdminSubscription(id: string): Promise<unknown> {
  return apiFetch(`/admin/subscription/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'expired' }) });
}
export function grantCredits(body: { userId: string; amount: number; creditType: 'regular' | 'subscription' }): Promise<void> {
  return apiFetch('/admin/subscription/credits/grant', { method: 'POST', body: JSON.stringify(body) });
}
```

备注：**订阅 Banner 不在此封装** —— subscriptionApi.ts:47-108 已有 `getAdminBanner/updateBanner/uploadBannerImage` + shared `AdminBannerData/UpdateBannerDto`，Task 16 直接复用（字段 `backgroundImageKey`）。adminApi.ts 若无 `apiFetch` import，在 import 区补 `import { apiFetch } from './client';`（现有函数已用同款封装则已有）。

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/api/adminApi.subscription.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/api/adminApi.ts apps/web/src/api/adminApi.subscription.test.ts && git commit -m "feat(web): adminApi 补 subscription/plans/subscriptions/credits/banner 封装（裸 fetch 收敛）"
```

---

## 阶段 C：页面迁移（新建独立文件，不动旧路由 —— Task 20 才切换）

> 通用测试模式（各页复用此骨架，mock `@/api/adminApi`；antd5 坑：**恰好两个汉字**的按钮文本才自动插空格（buttonHelpers.js `rxTwoCNChar=/^[\u4E00-\u9FA5]{2}$/`），四字如「新建模型」不插 —— 按钮断言统一用 `/新\s?建/` 形式两态兼容；「发放」两字会插成「发 放」）：
> ```tsx
> vi.mock('@/api/adminApi', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/adminApi')>()), fetchXxx: vi.fn() }));
> render(<MemoryRouter><AntdApp><XxxPage /></AntdApp></MemoryRouter>);
> ```
>
> **统一异步错误收口（全部 API 调用点，不限于 onFinish）**：
> 1. ModalForm/ProForm 的 onFinish：整体包 try/catch —— catch 中 `message.error((e as Error).message)`（apiFetch 已带中文 message，如 P2002 唯一冲突经 Filter 转译）并 **必须 `return false`**（返回 undefined 会被 ProForm 视为 resolve，弹窗照常关闭丢失用户输入）；成功路径末尾 return true。Task 16 保存后重取 fresh 也在同一 try 内。
> 2. 行内异步回调（上下线 toggle 链接、Popconfirm onConfirm、Switch onChange）：同样包 try/catch + `message.error((e as Error).message)` —— 否则断网时是 unhandled rejection 且无中文提示。
> 计划代码块为简洁省略此壳，实现时必须套上（Task 20 Step 5 有机械兜底检查）。

### Task 12: ModelsPage（NodeTypeTabs 升级 + 模型/计费规则双 ProTable + 创建编排）

**Files:**
- Create: `apps/web/src/pages/admin/pages/ModelsPage.tsx`（default export）
- Test: `apps/web/src/pages/admin/pages/ModelsPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/admin/pages/ModelsPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchNodeTypes: vi.fn().mockResolvedValue([
    { id: 'nt1', name: '文本', key: 'text', active: true },
  ]),
  fetchModels: vi.fn().mockResolvedValue([
    { id: 'm1', nodeTypeId: 'nt1', name: 'GLM', provider: 'zhipu', apiUrl: 'https://x', sortOrder: 1, recommended: true, active: true, resolutions: [], durations: [] },
  ]),
  fetchPricingRules: vi.fn().mockResolvedValue([]),
}));

import ModelsPage from './ModelsPage';

describe('ModelsPage', () => {
  it('节点类型 Tabs 渲染 + 模型列表加载（无「节点类型表格」—— 现状仅切换）', async () => {
    render(<MemoryRouter><AntdApp><ModelsPage /></AntdApp></MemoryRouter>);
    expect(await screen.findByText('文本')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('GLM')).toBeTruthy());
  });
  it('模型行操作齐全：编辑/上下线/删除 + 新建入口 + 计费规则标题', async () => {
    render(<MemoryRouter><AntdApp><ModelsPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('GLM')).toBeTruthy());
    expect(screen.getByText('编辑')).toBeTruthy();      // 编辑回填（P2 补齐）
    expect(screen.getByText('下线')).toBeTruthy();      // toggleModel（P2 补齐）
    expect(screen.getByText('删除')).toBeTruthy();
    expect(screen.getByRole('button', { name: /新\s?建/ })).toBeTruthy();
    expect(screen.getByText('计费规则')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/ModelsPage.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（⚠️ 所有 onFinish/onConfirm 的 API 调用必须套 try/catch + message.error + return false —— 见阶段 C 头部「onFinish 统一收口」，subagent 勿依赖看不见的全局约定）**

```tsx
// apps/web/src/pages/admin/pages/ModelsPage.tsx
import { useEffect, useState, useRef } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSwitch, ProFormList, ProFormSelect, ProFormDependency } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { Tabs, App as AntdApp, Popconfirm, Button, Tag } from 'antd';
import {
  fetchNodeTypes, fetchModels, createModel, updateModel, toggleModel, deleteModel, addResolution, addDuration,
  fetchPricingRules, createPricingRule, deletePricingRule,
  type NodeTypeData, type ModelData, type PricingRuleData,
} from '@/api/adminApi';

export default function ModelsPage() {
  const [nodeTypes, setNodeTypes] = useState<NodeTypeData[]>([]);
  const [activeNodeType, setActiveNodeType] = useState<string>('');
  const [models, setModels] = useState<ModelData[]>([]); // 级联下拉数据源（页面级加载一次）
  const modelsRef = useRef<ActionType>(null);
  const pricingRef = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  // 节点类型加载（原节点类型表已删，此处是唯一 setNodeTypes 来源，否则页面恒空）
  useEffect(() => {
    fetchNodeTypes().then((list) => {
      setNodeTypes(list);
      if (list.length) setActiveNodeType(list[0].id);
    });
  }, []);

  const activeNt = nodeTypes.find((nt) => nt.id === activeNodeType); // 拿 key（条件显示用）

  const modelColumns: ProColumns<ModelData>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '供应商', dataIndex: 'provider' },
    { title: '推荐', dataIndex: 'recommended', render: (_, r) => (r.recommended ? <Tag color="green">推荐</Tag> : '-') },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    { title: '分辨率', render: (_, r) => r.resolutions.map((x) => x.label).join(' / ') || '-' },
    { title: '时长', render: (_, r) => r.durations.map((x) => x.label).join(' / ') || '-' },
    { title: '状态', dataIndex: 'active', render: (_, r) => (r.active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
    {
      title: '操作', valueType: 'option',
      render: (_, record) => [
        <ModelFormModal key="edit" nodeTypeId={activeNodeType} nodeTypeKey={activeNt?.key} record={record}
          onDone={() => modelsRef.current?.reload()} trigger={<a>编辑</a>} />,
        <a key="toggle" style={{ color: '#f59e0b' }} onClick={async () => {
          await toggleModel(record.id); message.success(record.active ? '已下线' : '已上线'); modelsRef.current?.reload();
        }}>{record.active ? '下线' : '上线'}</a>,
        <Popconfirm key="del" title="确认删除该模型？" onConfirm={async () => { await deleteModel(record.id); message.success('已删除'); modelsRef.current?.reload(); }}>
          <a style={{ color: '#ff7875' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer title="模型管理">
      {nodeTypes.length > 0 && (
        <Tabs
          activeKey={activeNodeType}
          onChange={(k) => { setActiveNodeType(k); modelsRef.current?.reload(); pricingRef.current?.reload(); }}
          items={nodeTypes.map((nt) => ({ key: nt.id, label: nt.name }))}
        />
      )}
      {activeNodeType && (
        <>
          <ProTable<ModelData>
            headerTitle="模型列表" rowKey="id" search={false} size="small"
            actionRef={modelsRef}
            request={async () => {
              const d = await fetchModels(activeNodeType);
              setModels(d); // 页面级唯一 fetchModels（计费规则 request 不再重复拉，P3-8 收敛）
              return { data: d, success: true, total: d.length };
            }}
            columns={modelColumns}
            toolBarRender={() => [
              <ModelFormModal key="create" nodeTypeId={activeNodeType} nodeTypeKey={activeNt?.key}
                onDone={() => modelsRef.current?.reload()} trigger={<Button type="primary">新建模型</Button>} />,
            ]}
          />
          <ProTable<PricingRuleData>
            headerTitle="计费规则" rowKey="id" search={false} size="small" style={{ marginTop: 24 }}
            actionRef={pricingRef}
            request={async () => {
              const rules = await fetchPricingRules(activeNodeType);
              return { data: rules, success: true, total: rules.length };
            }}
            columns={[
              { title: '模型', render: (_, r) => r.model?.name ?? '-' },
              { title: '分辨率', render: (_, r) => r.resolution?.label ?? '-' },
              { title: '时长', render: (_, r) => r.duration?.label ?? '-' },
              { title: '积分消耗', dataIndex: 'creditCost' },
              { title: '状态', dataIndex: 'active', render: (_, r) => (r.active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
              {
                title: '操作', valueType: 'option',
                render: (_, r) => [
                  <Popconfirm key="del" title="确认删除该规则？" onConfirm={async () => { await deletePricingRule(r.id); message.success('已删除'); pricingRef.current?.reload(); }}>
                    <a style={{ color: '#ff7875' }}>删除</a>
                  </Popconfirm>,
                ],
              },
            ]}
            toolBarRender={() => [
              <ModalForm key="create" title="新建计费规则" trigger={<Button type="primary">新建规则</Button>}
                modalProps={{ destroyOnClose: true }}
                onFinish={async (v: any) => { await createPricingRule({ ...v, nodeTypeId: activeNodeType }); message.success('已创建'); pricingRef.current?.reload(); return true; }}>
                {/* 级联下拉（对齐现网 PricingRuleFormModal：模型→其分辨率/时长），不手填 ID */}
                <ProFormSelect name="modelId" label="模型" rules={[{ required: true }]}
                  options={models.map((m) => ({ label: m.name, value: m.id }))} />
                <ProFormDependency name={['modelId']}>
                  {({ modelId }) => {
                    const sel = models.find((m) => m.id === modelId);
                    return (
                      <>
                        <ProFormSelect name="resolutionId" label="分辨率（可选）" allowClear
                          options={(sel?.resolutions ?? []).map((x) => ({ label: x.label, value: x.id }))} />
                        <ProFormSelect name="durationId" label="时长（可选）" allowClear
                          options={(sel?.durations ?? []).map((x) => ({ label: x.label, value: x.id }))} />
                      </>
                    );
                  }}
                </ProFormDependency>
                <ProFormDigit name="creditCost" label="积分消耗" rules={[{ required: true }, { validator: (_, v) => v >= 0 ? Promise.resolve() : Promise.reject(new Error('需非负')) }]} />
                <ProFormSwitch name="active" label="启用" initialValue={true} />
              </ModalForm>,
            ]}
          />
        </>
      )}
      {nodeTypes.length === 0 && <div className="py-16 text-center text-gray-400">暂未配置节点类型，请先执行种子数据</div>}
    </PageContainer>
  );
}

/** 模型新建/编辑弹窗（P2 补齐：编辑回填、更新不发子资源、分辨率/时长按 nodeTypeKey 条件显示 —— 对齐 ModelFormModal.tsx:64/76） */
function ModelFormModal({ nodeTypeId, nodeTypeKey, record, onDone, trigger }: {
  nodeTypeId: string; nodeTypeKey?: string; record?: ModelData; onDone: () => void; trigger: React.ReactNode;
}) {
  const { message } = AntdApp.useApp();
  const isEdit = Boolean(record);
  const showResolutions = nodeTypeKey === 'image' || nodeTypeKey === 'video';
  const showDurations = nodeTypeKey === 'video';

  return (
    <ModalForm
      title={isEdit ? '编辑模型' : '新建模型'} trigger={trigger}
      modalProps={{ destroyOnClose: true }}
      initialValues={record ? {
        name: record.name, provider: record.provider, apiUrl: record.apiUrl,
        sortOrder: record.sortOrder, recommended: record.recommended, active: record.active,
        resolutions: record.resolutions.map((r) => ({ label: r.label, width: r.width, height: r.height })),
        durations: record.durations.map((d) => ({ label: d.label, seconds: d.seconds })),
      } : { sortOrder: 0, active: true }}
      onFinish={async (v: any) => {
        // base 必须剔除 resolutions/durations：后端 model.service.create:36-47 自建子资源，
        // data 带子资源+前端串行 add 是双重创建；解构剔除后只走前端串行，勿把子资源塞回 base。
        // 编辑分支不发子资源是「修复」而非对齐：旧 handleSave 编辑时把含子资源的 data 直接 PUT，
        // 后端 update 只收标量，旧链路本就会报错
        const { resolutions, durations, ...base } = v;
        if (isEdit && record) {
          await updateModel(record.id, base); // 编辑态子资源 List 已隐藏（见下），resolutions/durations 恒 undefined
        } else {
          // 创建编排（spec §5.2）：createModel 后串行 addResolution/addDuration
          const created = await createModel(nodeTypeId, base);
          if (showResolutions) for (const r of resolutions ?? []) await addResolution(created.id, r);
          if (showDurations) for (const d of durations ?? []) await addDuration(created.id, d);
        }
        message.success(isEdit ? '已更新' : '已创建');
        onDone();
        return true;
      }}
    >
      <ProFormText name="name" label="名称" rules={[{ required: true }]} />
      <ProFormText name="provider" label="供应商" rules={[{ required: true }]} />
      <ProFormText name="apiUrl" label="API 地址" rules={[{ required: true }]} />
      {/* 编辑态不传 apiKey：保持服务端已存密钥不变（不回显明文）。
          安全债登记（超出本计划）：GET /admin/models 列表明文下发 apiKey（findByNodeType 无 select），
          建议后端 select 剔除/脱敏，上线前处理 */}
      {!isEdit && <ProFormText name="apiKey" label="API Key（可选）" placeholder="留空则沿用服务端配置" />}
      <ProFormDigit name="sortOrder" label="排序" initialValue={0} />
      <ProFormSwitch name="recommended" label="推荐" />{/* 无 active 开关：启停统一走行内「上线/下线」（旧表单 onSave 本就无 active） */}
      {/* 编辑态隐藏子资源 List：更新分支不发子资源（改了也不保存会误导），仅创建时填写 */}
      {!isEdit && showResolutions && (
        <ProFormList name="resolutions" label="分辨率" initialValue={[]}
          creatorButtonProps={{ creatorButtonText: '添加分辨率' }}>
          <ProForm.Group>
            <ProFormText name="label" label="标签" rules={[{ required: true }]} />
            <ProFormDigit name="width" label="宽" rules={[{ required: true }]} />
            <ProFormDigit name="height" label="高" rules={[{ required: true }]} />
          </ProForm.Group>
        </ProFormList>
      )}
      {!isEdit && showDurations && (
        <ProFormList name="durations" label="时长" initialValue={[]}
          creatorButtonProps={{ creatorButtonText: '添加时长' }}>
          <ProForm.Group>
            <ProFormText name="label" label="标签" rules={[{ required: true }]} />
            <ProFormDigit name="seconds" label="秒" rules={[{ required: true }]} />
          </ProForm.Group>
        </ProFormList>
      )}
    </ModalForm>
  );
}
```

备注：`destroyOnClose`（非 destroyOnHidden —— 5.22.5 只有前者，用错 tsc 报 excess property 且不生效）。models/nodeTypes 的 state 声明与 useEffect 加载已在实现代码内（勿依赖本备注）。

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/ModelsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/pages/ModelsPage.tsx apps/web/src/pages/admin/pages/ModelsPage.test.tsx && git commit -m "feat(web): ModelsPage（节点类型 Tabs + 双 ProTable + 创建编排保留）"
```

---

### Task 13: PlansPage（套餐管理：ModalForm 复杂字段 + isActive 行内 Switch）

**Files:**
- Create: `apps/web/src/pages/admin/pages/PlansPage.tsx`
- Test: `apps/web/src/pages/admin/pages/PlansPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/admin/pages/PlansPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchAdminPlans: vi.fn().mockResolvedValue([
    { id: 'p1', name: '专业版', tier: 'pro', monthlyCredits: 300, storageLimitBytes: 107374182400,
      priceMonthly: 2900, originalPriceMonthly: 3900, priceQuarterly: 8700, originalPriceQuarterly: 11700,
      priceAnnually: 34800, originalPriceAnnually: 46800, sort: 2, isActive: true },
  ]),
  updateAdminPlan: vi.fn().mockResolvedValue({}),
}));

import PlansPage from './PlansPage';

describe('PlansPage', () => {
  it('套餐列表渲染（12 列齐全 + GB 换算 + 档位 Tag）', async () => {
    render(<MemoryRouter><AntdApp><PlansPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('专业版')).toBeTruthy());
    expect(screen.getByText('100 GB')).toBeTruthy();
    expect(screen.getByText('pro')).toBeTruthy();
    expect(screen.getByText('2900')).toBeTruthy();
    expect(screen.getByText('34800')).toBeTruthy();
  });
  it('编辑提交：storageGB 换算为字节 storageLimitBytes（守护 GB↔字节链路）', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><PlansPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('专业版')).toBeTruthy());
    await user.click(screen.getByText('编辑'));
    const storageInput = await screen.findByLabelText('存储(GB)');
    await user.clear(storageInput);
    await user.type(storageInput, '60');
    const okBtn = document.querySelector('.ant-modal-footer .ant-btn-primary') as HTMLElement;
    await user.click(okBtn);
    const { updateAdminPlan } = await import('@/api/adminApi');
    await waitFor(() => expect(updateAdminPlan).toHaveBeenCalledWith('p1', expect.objectContaining({ storageLimitBytes: 64424509440 })));
  });

  it('上下架 Switch + 编辑入口（ModalForm）+ 新建入口', async () => {
    render(<MemoryRouter><AntdApp><PlansPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('专业版')).toBeTruthy());
    expect(screen.getByRole('switch')).toBeTruthy();
    expect(screen.getByText('编辑')).toBeTruthy();
    expect(screen.getByRole('button', { name: /新\s?建/ })).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/PlansPage.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（先建共享 tier-colors.ts，Task 14 复用；⚠️ onFinish 统一 try/catch 收口，见阶段 C 头部）**

```ts
// apps/web/src/pages/admin/pages/tier-colors.ts
export const PLAN_TIER_COLORS: Record<string, string> = { basic: '#9ca3af', pro: '#3b82f6', max: '#a855f7', ultra: '#f59e0b' };
```

```tsx
// apps/web/src/pages/admin/pages/PlansPage.tsx
import { useRef } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSelect } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Button, Popconfirm, Switch, Tag } from 'antd';
import { fetchAdminPlans, createAdminPlan, updateAdminPlan, type AdminPlanRow } from '@/api/adminApi';
import { PLAN_TIER_COLORS } from './tier-colors';

const GB = 1024 ** 3;
// 整除显示整数，否则 1 位小数（对齐原 toGB）
const toGB = (b: number) => { const g = b / GB; return Number.isInteger(g) ? g : Number(g.toFixed(1)); };
const nonNeg = { validator: (_: unknown, v: number) => v >= 0 ? Promise.resolve() : Promise.reject(new Error('需非负')) };

export default function PlansPage() {
  const ref = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<AdminPlanRow>[] = [
    { title: 'ID', dataIndex: 'id', width: 90, ellipsis: true, copyable: true },
    { title: '名称', dataIndex: 'name' },
    { title: '档位', dataIndex: 'tier', render: (_, r) => <Tag color={PLAN_TIER_COLORS[r.tier]}>{r.tier}</Tag> },
    { title: '月积分', dataIndex: 'monthlyCredits' },
    { title: '存储上限(GB)', render: (_, r) => `${toGB(r.storageLimitBytes)} GB` },
    { title: '包月原价', dataIndex: 'originalPriceMonthly' },
    { title: '包月价', dataIndex: 'priceMonthly' },
    { title: '包季原价', dataIndex: 'originalPriceQuarterly' },
    { title: '包季价', dataIndex: 'priceQuarterly' },
    { title: '包年原价', dataIndex: 'originalPriceAnnually' },
    { title: '包年价', dataIndex: 'priceAnnually' },
    { title: '排序', dataIndex: 'sort', width: 70 },
    {
      title: '上架', dataIndex: 'isActive', width: 90,
      render: (_, r) => (
        <Popconfirm title={r.isActive ? '确认下架该套餐？' : '确认上架该套餐？'} onConfirm={async () => {
          await updateAdminPlan(r.id, { isActive: !r.isActive });
          message.success(r.isActive ? '已下架' : '已上架');
          ref.current?.reload();
        }}>
          <Switch checked={r.isActive} />
        </Popconfirm>
      ),
    },
    {
      title: '操作', valueType: 'option',
      render: (_, r) => [
        <ModalForm key="edit" title="编辑套餐" trigger={<a>编辑</a>}
          modalProps={{ destroyOnClose: true }}
          initialValues={{ ...r, storageGB: toGB(r.storageLimitBytes) }}
          onFinish={async (v: any) => {
            const { storageGB, ...rest } = v; // GB 输入提交换算字节
            await updateAdminPlan(r.id, { ...rest, storageLimitBytes: storageGB * GB });
            message.success('已更新'); ref.current?.reload(); return true;
          }}>
          <PlanFields initial={r} />
        </ModalForm>,
      ],
    },
  ];

  return (
    <PageContainer title="套餐管理">
      <ProTable<AdminPlanRow>
        rowKey="id" search={false} size="middle" columns={columns} actionRef={ref}
        request={async () => { const d = await fetchAdminPlans(); return { data: d, success: true, total: d.length }; }}
        toolBarRender={() => [
          /* 新建套餐为「增强」非迁移保留：现网 PlanManagementTab 无新建入口（仅 seed 建）；后端 POST /plans 支持故补齐 */
          <ModalForm key="create" title="新建套餐" trigger={<Button type="primary">新建套餐</Button>}
            modalProps={{ destroyOnClose: true }}
            onFinish={async (v: any) => {
              const { storageGB, ...rest } = v;
              // 后端 createPlan 强制 isActive:true（subscription.service.ts:79）—— 新建表单不放上架开关
              await createAdminPlan({ ...rest, storageLimitBytes: storageGB * GB });
              message.success('已创建'); ref.current?.reload(); return true;
            }}>
            <PlanFields />
          </ModalForm>,
        ]}
      />
    </PageContainer>
  );
}

/** 套餐字段（tier 必填枚举 + 三组价格必填；编辑回填含 storageGB 换算） */
function PlanFields({ initial }: { initial?: AdminPlanRow }) {
  return (
    <>
      <ProFormText name="name" label="名称" initialValue={initial?.name} rules={[{ required: true }]} />
      <ProFormSelect name="tier" label="档位" initialValue={initial?.tier}
        options={[
          { label: '基础版 basic', value: 'basic' }, { label: '专业版 pro', value: 'pro' },
          { label: '高级版 max', value: 'max' }, { label: '旗舰版 ultra', value: 'ultra' },
        ]}
        rules={[{ required: true }]} />
      <ProFormDigit name="monthlyCredits" label="月积分" initialValue={initial?.monthlyCredits} rules={[{ required: true }, nonNeg]} />
      {/* toStorageBytes 要求字节正整数（subscription.service.ts:70-75，小数 GB 抛 PLAN_STORAGE_LIMIT_INVALID）→ 整数 GB 输入 */}
      <ProFormDigit name="storageGB" label="存储(GB)" min={1} fieldProps={{ precision: 0 }} initialValue={initial ? toGB(initial.storageLimitBytes) : undefined} rules={[{ required: true }, { validator: (_, v) => v >= 1 && Number.isInteger(v) ? Promise.resolve() : Promise.reject(new Error('需≥1 的整数 GB')) }]} />
      <ProFormDigit name="priceMonthly" label="包月价(分)" initialValue={initial?.priceMonthly} rules={[{ required: true }, nonNeg]} />
      {/* 三个 original* schema @default(0)、DTO 可选 —— 不必填，留空走 0 */}
      <ProFormDigit name="originalPriceMonthly" label="包月原价(分)" initialValue={initial?.originalPriceMonthly} rules={[nonNeg]} />
      <ProFormDigit name="priceQuarterly" label="包季价(分)" initialValue={initial?.priceQuarterly} rules={[{ required: true }, nonNeg]} />
      <ProFormDigit name="originalPriceQuarterly" label="包季原价(分)" initialValue={initial?.originalPriceQuarterly} rules={[nonNeg]} />
      <ProFormDigit name="priceAnnually" label="包年价(分)" initialValue={initial?.priceAnnually} rules={[{ required: true }, nonNeg]} />
      <ProFormDigit name="originalPriceAnnually" label="包年原价(分)" initialValue={initial?.originalPriceAnnually} rules={[nonNeg]} />
      <ProFormDigit name="sort" label="排序" initialValue={initial?.sort ?? 0} />
      {!initial && <span className="text-xs opacity-60">新建后默认上架（服务端强制 isActive=true）</span>}
    </>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/PlansPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/pages/PlansPage.tsx apps/web/src/pages/admin/pages/PlansPage.test.tsx && git commit -m "feat(web): PlansPage（12 字段 ModalForm+isActive 行内 Switch）"
```

---

### Task 14: SubscriptionsPage（服务端分页 ProTable，契约对齐现网）

**Files:**
- Create: `apps/web/src/pages/admin/pages/SubscriptionsPage.tsx`
- Test: `apps/web/src/pages/admin/pages/SubscriptionsPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/admin/pages/SubscriptionsPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchAdminSubscriptions: vi.fn().mockResolvedValue({
    items: [{ id: 's1', userId: 'u1', planId: 'p1', plan: { name: '专业版' }, tier: 'pro', period: 'monthly',
      status: 'active', paidAmount: 2900, totalCredits: 300, consumedCredits: 10,
      subscribedAt: '2026-09-01T00:00:00.000Z', currentPeriodStart: '2026-09-01T00:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z', nextGrantDate: '2026-10-01T00:00:00.000Z' }],
    total: 21, page: 1, pageSize: 20,
  }),
  cancelAdminSubscription: vi.fn().mockResolvedValue({}),
}));

import SubscriptionsPage from './SubscriptionsPage';

describe('SubscriptionsPage', () => {
  it('列表渲染（真实字段：档位/周期/到期日）且请求带服务端分页参数', async () => {
    render(<MemoryRouter><AntdApp><SubscriptionsPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('专业版')).toBeTruthy());
    expect(screen.getByText('monthly')).toBeTruthy();
    const { fetchAdminSubscriptions } = await import('@/api/adminApi');
    expect(fetchAdminSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));
  });
  it('active 状态行显示「作废」且确认后 body 恰为 {status:"expired"}', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><SubscriptionsPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('作废')).toBeTruthy());
    await user.click(screen.getByText('作废'));
    const okBtn = document.querySelector('.ant-popover .ant-btn-primary') as HTMLElement;
    await user.click(okBtn);
    const { cancelAdminSubscription } = await import('@/api/adminApi');
    await waitFor(() => expect(cancelAdminSubscription).toHaveBeenCalledWith('s1'));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/SubscriptionsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现（列对齐现网 SubscriptionTabs.tsx:126-133；作废 {status:'expired'}；⚠️ onFinish/onConfirm 统一 try/catch 收口，见阶段 C 头部）**

```tsx
// apps/web/src/pages/admin/pages/SubscriptionsPage.tsx
import { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Tag, Popconfirm } from 'antd';
import { PLAN_TIER_COLORS } from './tier-colors';
import { fetchAdminSubscriptions, cancelAdminSubscription, type AdminSubscriptionRow } from '@/api/adminApi';

export default function SubscriptionsPage() {
  const ref = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<AdminSubscriptionRow>[] = [
    { title: '用户', dataIndex: 'userId', width: 110, ellipsis: true, copyable: true },
    { title: '套餐', render: (_, r) => r.plan?.name ?? '-' },
    { title: '档位', dataIndex: 'tier', render: (_, r) => <Tag color={PLAN_TIER_COLORS[r.tier]}>{r.tier}</Tag> },
    { title: '周期', dataIndex: 'period' },
    { title: '状态', dataIndex: 'status', render: (_, r) => (r.status === 'active' ? <Tag color="green">生效中</Tag> : <Tag>{r.status}</Tag>) },
    { title: '到期日', dataIndex: 'currentPeriodEnd', render: (_, r) => r.currentPeriodEnd ? new Date(r.currentPeriodEnd).toLocaleDateString('zh-CN') : '-' },
    {
      title: '操作', valueType: 'option',
      render: (_, r) => r.status === 'active'
        ? [<Popconfirm key="cancel" title="确认作废该订阅？" onConfirm={async () => {
            await cancelAdminSubscription(r.id); // 仅 status:'expired'（controller:40-43）
            message.success('已作废');
            ref.current?.reload(); // 作废后刷新（对齐旧版 load()，否则行状态滞留）
          }}>
            <a style={{ color: '#ff7875' }}>作废</a></Popconfirm>]
        : [<span key="none" className="opacity-50">-</span>],
    },
  ];

  return (
    <PageContainer title="订阅管理">
      <ProTable<AdminSubscriptionRow>
        rowKey="id" search={false} size="middle" columns={columns} actionRef={ref}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        request={async ({ current = 1, pageSize = 20 }) => {
          const d = await fetchAdminSubscriptions({ page: current, pageSize });
          return { data: d.items, success: true, total: d.total };
        }}
      />
    </PageContainer>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/SubscriptionsPage.test.tsx`
Expected: PASS（修复原「超 20 条不可见」缺陷 —— 服务端分页接通）

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/pages/SubscriptionsPage.tsx apps/web/src/pages/admin/pages/SubscriptionsPage.test.tsx apps/web/src/pages/admin/pages/tier-colors.ts && git commit -m "feat(web): SubscriptionsPage（真实字段+expired 作废契约+服务端分页）"
```

---

### Task 15: CreditsPage（ProForm 发放面板，非表格）

**Files:**
- Create: `apps/web/src/pages/admin/pages/CreditsPage.tsx`
- Test: `apps/web/src/pages/admin/pages/CreditsPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/admin/pages/CreditsPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  grantCredits: vi.fn().mockResolvedValue(undefined),
}));

import CreditsPage from './CreditsPage';

describe('CreditsPage（积分发放表单）', () => {
  it('填写 userId/数量后提交调用 grantCredits', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><CreditsPage /></AntdApp></MemoryRouter>);
    await user.type(screen.getByLabelText('用户 ID'), 'u1');
    await user.type(screen.getByLabelText('发放数量'), '10');
    await user.click(screen.getByRole('button', { name: /发 放/ }));
    const { grantCredits } = await import('@/api/adminApi');
    await waitFor(() => expect(grantCredits).toHaveBeenCalledWith({ userId: 'u1', amount: 10, creditType: 'regular' }));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/CreditsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现（⚠️ onFinish 统一 try/catch 收口，见阶段 C 头部）**

```tsx
// apps/web/src/pages/admin/pages/CreditsPage.tsx
import { PageContainer, ProCard, ProForm, ProFormText, ProFormDigit, ProFormRadio } from '@ant-design/pro-components';
import { App as AntdApp } from 'antd';
import { grantCredits } from '@/api/adminApi';

export default function CreditsPage() {
  const { message } = AntdApp.useApp();
  return (
    <PageContainer title="积分发放">
      <ProCard style={{ maxWidth: 520 }}>
        <ProForm
          submitter={{ searchConfig: { submitText: '发放' }, resetButtonProps: false }}
          onFinish={async (v: { userId: string; amount: number; creditType: 'regular' | 'subscription' }) => {
            await grantCredits(v);
            message.success('发放成功');
            return true;
          }}
        >
          <ProFormText name="userId" label="用户 ID" rules={[{ required: true }]} placeholder="目标用户 ID" />
          <ProFormDigit name="amount" label="发放数量" min={1} rules={[{ required: true }, { validator: (_, v) => v > 0 ? Promise.resolve() : Promise.reject(new Error('需为正数')) }]} />
          <ProFormRadio.Group name="creditType" label="积分类型" initialValue="regular"
            options={[{ label: '普通积分', value: 'regular' }, { label: '订阅积分', value: 'subscription' }]} />
        </ProForm>
      </ProCard>
    </PageContainer>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/CreditsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/pages/CreditsPage.tsx apps/web/src/pages/admin/pages/CreditsPage.test.tsx && git commit -m "feat(web): CreditsPage（ProForm 发放面板）"
```

---

### Task 16: SubscriptionBannerPage（单资源表单，复用 subscriptionApi，通道保留）

**Files:**
- Create: `apps/web/src/pages/admin/pages/SubscriptionBannerPage.tsx`
- Test: `apps/web/src/pages/admin/pages/SubscriptionBannerPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/admin/pages/SubscriptionBannerPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/subscriptionApi', () => ({  // subscriptionApi 是对象导出（非命名导出），mock 形状必须一致
  subscriptionApi: {
    getAdminBanner: vi.fn().mockResolvedValue({
    id: 'b1', title: '限时特惠', subtitle: '开通立减',
    backgroundImageKey: 'k1', backgroundImageUrl: null,
      countdownEndAt: null, autoExtend: false, isActive: true, createdAt: '', updatedAt: '',
    }),
    updateBanner: vi.fn().mockResolvedValue({}),
    uploadBannerImage: vi.fn(),
  },
}));

import SubscriptionBannerPage from './SubscriptionBannerPage';
// 若渲染报 ProProvider 相关 context 错误，测试外再包一层 <ProConfigProvider> 即可（pro 组件 context 有默认值，通常可裸渲染）

describe('SubscriptionBannerPage（单资源配置，复用 subscriptionApi）', () => {
  it('加载并回填现有配置（title/isActive）', async () => {
    render(<MemoryRouter><AntdApp><SubscriptionBannerPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByDisplayValue('限时特惠')).toBeTruthy());
    expect(screen.getByRole('switch')).toBeTruthy();
  });

  it('上传成功后清空 URL 输入（互斥：key 优先会静默吞 URL）', async () => {
    const { subscriptionApi } = await import('@/api/subscriptionApi');
    (subscriptionApi.uploadBannerImage as ReturnType<typeof vi.fn>).mockResolvedValue({ imageKey: 'k-new' });
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><SubscriptionBannerPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByDisplayValue('限时特惠')).toBeTruthy());
    const urlInput = screen.getByLabelText(/背景图 URL/);
    await user.type(urlInput, 'https://img/x.png');
    // user-event v14 不要求 input 可见，直接对隐藏 input 上传（内部赋 files + 派发 change）
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await user.upload(input, file);
    await waitFor(() => expect(subscriptionApi.uploadBannerImage).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByLabelText(/背景图 URL/) as HTMLInputElement).value).toBe(''));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/SubscriptionBannerPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现（复用 subscriptionApi.getAdminBanner/updateBanner/uploadBannerImage；字段 backgroundImageKey；对齐现网 BannerManagementTab 行为：互斥/autoExtend 联动/上传 2MB；⚠️ onFinish 统一 try/catch 收口，见阶段 C 头部）**

```tsx
// apps/web/src/pages/admin/pages/SubscriptionBannerPage.tsx
import { useEffect, useRef, useState } from 'react';
import { PageContainer, ProCard, ProForm, ProFormText, ProFormSwitch, ProFormDateTimePicker } from '@ant-design/pro-components';
import { App as AntdApp, Button } from 'antd';
import dayjs from 'dayjs';
import { subscriptionApi } from '@/api/subscriptionApi'; // 对象导出，方法调用 subscriptionApi.xxx
import type { AdminBannerData } from '@flowweb/shared';

export default function SubscriptionBannerPage() {
  const [banner, setBanner] = useState<AdminBannerData | null>(null);
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [form] = ProForm.useForm();
  const fileRef = useRef<HTMLInputElement>(null);
  const { message } = AntdApp.useApp();

  useEffect(() => {
    subscriptionApi.getAdminBanner().then((b) => {
      setBanner(b);
      setImageKey(b?.backgroundImageKey ?? null);
    });
  }, []);

  // 对齐现网：上传 key 与外链 URL 互斥（填了 URL 清 key，反之亦然）
  const handleUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) { message.error('图片不能超过 2MB'); return; } // 2MB（home-banner 才是 5MB）
    setUploading(true);
    try {
      const { imageKey: key } = await subscriptionApi.uploadBannerImage(file);
      setImageKey(key);
      form.setFieldValue('backgroundImageUrl', ''); // 互斥：清外链
      message.success('图片已上传，保存后生效');
    } catch (e) { message.error((e as Error).message); }
    finally { setUploading(false); }
  };

  if (!banner) return <PageContainer title="订阅 Banner 设置" />;

  return (
    <PageContainer title="订阅 Banner 设置">
      <ProCard style={{ maxWidth: 640 }}>
        <div className="mb-4">
          <div className="mb-1 text-sm">背景图（multipart 后端中转，≤2MB，jpg/png/webp）</div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
          <Button onClick={() => fileRef.current?.click()} loading={uploading}>选择文件</Button>
          <span className="ml-2 text-xs opacity-60">{imageKey ? `已上传：${imageKey}` : '未上传'}</span>
          {banner.backgroundImageUrl && !imageKey && (
            <div className="mt-2"><img src={banner.backgroundImageUrl} alt="预览" style={{ maxHeight: 60 }} /></div> // 现网预览保留
          )}
        </div>
        <ProForm
          form={form}
          initialValues={{
            title: banner.title, subtitle: banner.subtitle,
            backgroundImageUrl: banner.backgroundImageUrl ?? undefined,
            countdownEndAt: banner.countdownEndAt ? dayjs(banner.countdownEndAt) : undefined,
            autoExtend: banner.autoExtend, isActive: banner.isActive,
          }}
          submitter={{ searchConfig: { submitText: '保存' } }}
          onFinish={async (v: any) => {
            const countdownEndAt = v.countdownEndAt ? dayjs(v.countdownEndAt).toISOString() : null;
            // 后端校验：autoExtend=true 必须有 countdownEndAt（subscription-banner.service.ts:91-93）—— 前端联动拦截
            if (v.autoExtend && !countdownEndAt) { message.error('开启自动顺延必须设置倒计时截止时间'); return false; }
            await subscriptionApi.updateBanner({
              title: v.title, subtitle: v.subtitle,
              backgroundImageKey: imageKey,
              backgroundImageUrl: v.backgroundImageUrl || null,
              countdownEndAt, autoExtend: v.autoExtend, isActive: v.isActive,
            });
            message.success('已保存');
            // 保存后重载回显（服务端归一化结果，如 key 优先合并）
            const fresh = await subscriptionApi.getAdminBanner();
            if (fresh) { setBanner(fresh); setImageKey(fresh.backgroundImageKey ?? null); }
            return true;
          }}
        >
          <ProFormText name="title" label="标题" maxLength={64} rules={[{ required: true }]} /> {/* schema VarChar(64)，超长后端 500 */}
          <ProFormText name="subtitle" label="副标题" maxLength={200} />
          {/* 双向互斥（对齐现网）：key 优先级高于 URL（service normalize），手填 URL 必须清掉旧 key，否则 URL 静默失效 */}
          <ProFormText name="backgroundImageUrl" label="背景图 URL（可选，与上传互斥）"
            fieldProps={{ onChange: (e) => { if (e.target.value) setImageKey(null); } }} />
          <ProFormDateTimePicker name="countdownEndAt" label="倒计时截止（可选）" />
          <ProFormSwitch name="autoExtend" label="到期自动顺延 3 天（需设倒计时）" />
          <ProFormSwitch name="isActive" label="启用" />
        </ProForm>
      </ProCard>
    </PageContainer>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/SubscriptionBannerPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/pages/SubscriptionBannerPage.tsx apps/web/src/pages/admin/pages/SubscriptionBannerPage.test.tsx && git commit -m "feat(web): SubscriptionBannerPage（复用 subscriptionApi，backgroundImageKey 契约正确）"
```

---

### Task 17: AnnouncementPage（公告条 ProTable+ModalForm）

**Files:**
- Create: `apps/web/src/pages/admin/pages/AnnouncementPage.tsx`
- Test: `apps/web/src/pages/admin/pages/AnnouncementPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/admin/pages/AnnouncementPage.test.tsx
// 覆盖点对齐旧 AnnouncementManagementTab.test.tsx:40-88（禁用直改/启用互斥确认/颜色 hex 拦截 —— 迁移不丢用例）
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchAnnouncements: vi.fn().mockResolvedValue([
    { id: 'a1', message: '系统维护通知', linkText: null, linkUrl: null, bgColor: '#0f2761', textColor: '#ffffff', active: true, createdAt: '', updatedAt: '' },
  ]),
  updateAnnouncement: vi.fn().mockResolvedValue({}),
}));

import AnnouncementPage from './AnnouncementPage';

beforeEach(() => vi.clearAllMocks()); // 隔离 mock 调用历史（clearAllMocks 只清记录、保留工厂实现）—— 用例 3 的「确认前不发」不再依赖用例 2 的调用记录

describe('AnnouncementPage', () => {
  it('公告列表渲染（默认色对齐现网 #0f2761）', async () => {
    render(<MemoryRouter><AntdApp><AnnouncementPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('系统维护通知')).toBeTruthy());
    expect(screen.getByText('#0f2761')).toBeTruthy();
  });

  it('行内开关：禁用直改（不弹确认）', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><AnnouncementPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('系统维护通知')).toBeTruthy());
    await user.click(screen.getByRole('switch'));
    const { updateAnnouncement } = await import('@/api/adminApi');
    await waitFor(() => expect(updateAnnouncement).toHaveBeenCalledWith('a1', expect.objectContaining({ active: false })));
  });

  it('启用走互斥确认：确认前不发、确认后发 active:true', async () => {
    // 独立未启用夹具（一次点击即到确认分支）：默认 mock 恒回 active:true 且 Switch checked 完全来自行数据，
    // 「先禁用再启用」在本 mock 下状态不可达（reload 又灌回 true），必须用 mockResolvedValueOnce 换夹具
    const { fetchAnnouncements, updateAnnouncement } = await import('@/api/adminApi');
    vi.mocked(fetchAnnouncements).mockResolvedValueOnce([
      { id: 'a1', message: '系统维护通知', linkText: null, linkUrl: null, bgColor: '#0f2761', textColor: '#ffffff', active: false, createdAt: '', updatedAt: '' },
    ]);
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><AnnouncementPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('系统维护通知')).toBeTruthy());
    await user.click(screen.getByRole('switch')); // 未启用行：Popconfirm 可用，点击弹互斥确认
    expect(await screen.findByText(/并停用其他公告/)).toBeTruthy();
    expect(updateAnnouncement).not.toHaveBeenCalledWith('a1', expect.objectContaining({ active: true }));
    await user.click(document.querySelector('.ant-popover .ant-btn-primary') as HTMLElement);
    await waitFor(() => expect(updateAnnouncement).toHaveBeenCalledWith('a1', expect.objectContaining({ active: true })));
  });

  it('表单颜色 hex 校验：非法值不提交', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><AntdApp><AnnouncementPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('系统维护通知')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /新\s?建/ }));
    const colorInput = await screen.findByLabelText('背景色');
    await user.clear(colorInput);
    await user.type(colorInput, 'red');
    // ModalForm okText 链 = modalProps.okText ?? locale.Modal.okText ?? '确认'；
    // 测试环境无 zhCN（enUS→'OK'），统一用不依赖 locale 的类名选择器（其他页弹窗提交测试同此法）
    const okBtn = document.querySelector('.ant-modal-footer .ant-btn-primary') as HTMLElement;
    await user.click(okBtn);
    const { createAnnouncement } = await import('@/api/adminApi');
    // 校验/onFinish 走微任务：waitFor 一拍后再断言，避免同步断言假绿
    await waitFor(() => expect(screen.getByText(/颜色格式/)).toBeTruthy());
    expect(createAnnouncement).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/AnnouncementPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现（⚠️ onFinish 统一 try/catch 收口，见阶段 C 头部）**

```tsx
// apps/web/src/pages/admin/pages/AnnouncementPage.tsx
import { useRef } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormSwitch } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Button, Popconfirm, Switch, Tag } from 'antd';
import type { AnnouncementInfo } from '@flowweb/shared';
import { fetchAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement } from '@/api/adminApi';

type AnnFields = Omit<AnnouncementInfo, 'id' | 'createdAt' | 'updatedAt'>;
// 提交收口（对齐现网 :62）：空串→null（可空列直存空串会让列表 ?? '-' 失效显示空白）、message trim
const toAnnPayload = (v: any) => ({
  message: v.message?.trim(),
  linkText: v.linkText?.trim() || null,
  linkUrl: v.linkUrl?.trim() || null,
  bgColor: v.bgColor, textColor: v.textColor, active: v.active,
});
// 颜色 hex 前端校验（对齐现网 AnnouncementManagementTab，非法不提交）
const HEX_RULE = { pattern: /^#[0-9a-fA-F]{3,8}$/, message: '颜色格式须为 # 开头的十六进制（如 #0f2761）' }; // {3,8} 对齐现网 AnnouncementManagementTab.tsx:52

export default function AnnouncementPage() {
  const ref = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<AnnouncementInfo>[] = [
    { title: '内容', dataIndex: 'message', ellipsis: true },
    { title: '链接文字', dataIndex: 'linkText', render: (_, r) => r.linkText ?? '-' },
    { title: '背景色', dataIndex: 'bgColor', render: (_, r) => <Tag color={r.bgColor}>{r.bgColor}</Tag> },
    { title: '文字色', dataIndex: 'textColor' },
    {
      title: '启用', dataIndex: 'active', width: 80,
      // 对齐现网互斥逻辑：禁用直改；启用弹确认（多公告同显互斥，AnnouncementManagementTab 行为）
      render: (_, r) => (
        <Popconfirm title={`启用「${r.message.slice(0, 10)}」并停用其他公告？`} disabled={r.active}
          // 后端 content.service.ts:65-72：active!==true 直接 update（禁用直改）；active===true 才进互斥事务
          // → 未启用行 Popconfirm 可用（启用需确认）；已启用行 disabled（禁用直改走 Switch onChange）
          onConfirm={async () => { await updateAnnouncement(r.id, { active: true }); message.success('已启用，其他公告已自动停用'); ref.current?.reload(); }}>
          <Switch checked={r.active} onChange={(checked) => {
            if (!checked) void updateAnnouncement(r.id, { active: false }).then(() => { message.success('已禁用'); ref.current?.reload(); });
          }} />
        </Popconfirm>
      ),
    },
    {
      title: '操作', valueType: 'option',
      render: (_, r) => [
        <ModalForm key="edit" title="编辑公告" trigger={<a>编辑</a>} initialValues={r}
          modalProps={{ destroyOnClose: true }}
          onFinish={async (v: AnnFields) => { await updateAnnouncement(r.id, toAnnPayload(v)); message.success('已更新'); ref.current?.reload(); return true; }}>
          <AnnFormFields />
        </ModalForm>,
        <Popconfirm key="del" title="确认删除该公告？" onConfirm={async () => { await deleteAnnouncement(r.id); message.success('已删除'); ref.current?.reload(); }}>
          <a style={{ color: '#ff7875' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer title="公告条">
      <ProTable<AnnouncementInfo> rowKey="id" search={false} size="middle" columns={columns} actionRef={ref}
        request={async () => { const d = await fetchAnnouncements(); return { data: d, success: true, total: d.length }; }}
        toolBarRender={() => [
          <ModalForm key="create" title="新建公告" trigger={<Button type="primary">新建公告</Button>}
            modalProps={{ destroyOnClose: true }}
            onFinish={async (v: AnnFields) => { await createAnnouncement(toAnnPayload(v)); message.success('已创建'); ref.current?.reload(); return true; }}>
            <AnnFormFields />
          </ModalForm>,
        ]}
      />
    </PageContainer>
  );
}

function AnnFormFields() {
  return (
    <>
      <ProFormText name="message" label="内容" maxLength={200} rules={[{ required: true, whitespace: true, message: '公告内容不能为空' }]} />
      <ProFormText name="linkText" label="链接文字（可选）" maxLength={32} />
      <ProFormText name="linkUrl" label="链接 URL（可选）" maxLength={200} />
      <ProFormText name="bgColor" label="背景色" initialValue="#0f2761" rules={[HEX_RULE]} />
      <ProFormText name="textColor" label="文字色" initialValue="#ffffff" rules={[HEX_RULE]} />
      <ProFormSwitch name="active" label="启用" initialValue={false} /> {/* 对齐现网 EMPTY.active=false；新建即启用会撞全局唯一启用索引 */}
    </>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/AnnouncementPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/pages/AnnouncementPage.tsx apps/web/src/pages/admin/pages/AnnouncementPage.test.tsx && git commit -m "feat(web): AnnouncementPage（公告条 ProTable+ModalForm）"
```

---

### Task 18: HomeBannersPage（首页 Banner，multipart 通道保留）

**Files:**
- Create: `apps/web/src/pages/admin/pages/HomeBannersPage.tsx`
- Test: `apps/web/src/pages/admin/pages/HomeBannersPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/admin/pages/HomeBannersPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchHomeBanners: vi.fn().mockResolvedValue([
    { id: 'b1', title: '新版上线', subtitle: null, linkUrl: null, imageKey: 'k1', imageUrl: 'https://img/1.png', sortOrder: 1, active: true, createdAt: '', updatedAt: '' },
  ]),
}));

import HomeBannersPage from './HomeBannersPage';

describe('HomeBannersPage', () => {
  it('Banner 列表渲染（含图片预览列）', async () => {
    render(<MemoryRouter><AntdApp><HomeBannersPage /></AntdApp></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('新版上线')).toBeTruthy());
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy(); // 行内启停（P2 补齐）
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/HomeBannersPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现（uploadHomeBannerImage 现有封装直接复用，通道不变；⚠️ onFinish 统一 try/catch 收口，见阶段 C 头部）**

```tsx
// apps/web/src/pages/admin/pages/HomeBannersPage.tsx
import { useRef, useState } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSwitch } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Button, Popconfirm, Switch, Tag } from 'antd';
import type { HomeBannerInfo } from '@flowweb/shared';
import { fetchHomeBanners, createHomeBanner, updateHomeBanner, deleteHomeBanner, uploadHomeBannerImage } from '@/api/adminApi';

type BannerFields = Pick<HomeBannerInfo, 'title' | 'subtitle' | 'linkUrl' | 'sortOrder' | 'active'> & { imageKey: string };
// 空串收口（对齐公告页 toAnnPayload）：后端 ?? null 不捕获 ''，列表 ?? '-' 对空串不兜底会显示空白
const toBannerPayload = (v: any) => ({
  title: v.title?.trim() || null,
  subtitle: v.subtitle?.trim() || null,
  linkUrl: v.linkUrl?.trim() || null,
  sortOrder: v.sortOrder,
  active: v.active,
});

export default function HomeBannersPage() {
  const ref = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<HomeBannerInfo>[] = [
    { title: '预览', width: 120, render: (_, r) => (r.imageUrl ? <img src={r.imageUrl} alt={r.title ?? ''} style={{ height: 32 }} /> : '-') },
    { title: '标题', dataIndex: 'title', render: (_, r) => r.title ?? '-' },
    { title: '副标题', dataIndex: 'subtitle', render: (_, r) => r.subtitle ?? '-' },
    { title: '链接', dataIndex: 'linkUrl', ellipsis: true, render: (_, r) => r.linkUrl ?? '-' },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    {
      title: '启用', dataIndex: 'active', width: 80,
      render: (_, r) => (
        <Switch checked={r.active} onChange={(checked) => { // 行内启停（对齐现网 handleToggle）
          void updateHomeBanner(r.id, { active: checked }).then(() => { message.success(checked ? '已启用' : '已禁用'); ref.current?.reload(); });
        }} />
      ),
    },
    {
      title: '操作', valueType: 'option',
      render: (_, r) => [
        <BannerFormModal key="edit" mode="edit" record={r} onDone={() => ref.current?.reload()} trigger={<a>编辑</a>} />,
        <Popconfirm key="del" title="确认删除该 Banner？" onConfirm={async () => { await deleteHomeBanner(r.id); message.success('已删除'); ref.current?.reload(); }}>
          <a style={{ color: '#ff7875' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer title="首页 Banner">
      <ProTable<HomeBannerInfo> rowKey="id" search={false} size="middle" columns={columns} actionRef={ref}
        request={async () => { const d = await fetchHomeBanners(); return { data: d, success: true, total: d.length }; }}
        toolBarRender={() => [
          <BannerFormModal key="create" mode="create" onDone={() => ref.current?.reload()} trigger={<Button type="primary">新建 Banner</Button>} />,
        ]}
      />
    </PageContainer>
  );
}

function BannerFormModal({ mode, record, onDone, trigger }: {
  mode: 'create' | 'edit'; record?: HomeBannerInfo; onDone: () => void; trigger: React.ReactNode;
}) {
  const { message } = AntdApp.useApp();
  const [imageKey, setImageKey] = useState<string | undefined>(record?.imageKey);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try { const { imageKey: k } = await uploadHomeBannerImage(file); setImageKey(k); message.success('已上传，保存后生效'); }
    catch (e) { message.error((e as Error).message); }
    finally { setUploading(false); }
  };

  return (
    <ModalForm<BannerFields>
      title={mode === 'create' ? '新建 Banner' : '编辑 Banner'} trigger={trigger}
      modalProps={{ destroyOnClose: true }}
      initialValues={record ? { title: record.title ?? undefined, subtitle: record.subtitle ?? undefined, linkUrl: record.linkUrl ?? undefined, sortOrder: record.sortOrder, active: record.active, imageKey: record.imageKey } : { sortOrder: 0, active: true }}
      onFinish={async (v) => {
        if (!imageKey) { message.error('请先上传图片'); return false; }
        const payload = toBannerPayload(v);
        if (mode === 'create') await createHomeBanner({ ...payload, imageKey });
        else if (record) await updateHomeBanner(record.id, { ...payload, imageKey });
        message.success('已保存'); onDone(); return true;
      }}
    >
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
      <div className="mb-4">
        <div className="mb-1 text-sm">图片（建议 1920×240，8:1，≤5MB，jpg/png/webp）</div>
        <Button onClick={() => fileRef.current?.click()} loading={uploading}>选择文件</Button>
        <span className="ml-2 text-xs text-gray-400">{imageKey ? `已上传：${imageKey}` : '未上传'}</span>
      </div>
      <ProFormText name="title" label="标题（可选）" maxLength={128} />
      <ProFormText name="subtitle" label="副标题（可选）" maxLength={256} />
      <ProFormText name="linkUrl" label="链接 URL（可选）" maxLength={500} />
      <ProFormDigit name="sortOrder" label="排序" initialValue={0} />
      <ProFormSwitch name="active" label="启用" initialValue={true} />
    </ModalForm>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/HomeBannersPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/pages/HomeBannersPage.tsx apps/web/src/pages/admin/pages/HomeBannersPage.test.tsx && git commit -m "feat(web): HomeBannersPage（ProTable+ModalForm，上传通道保留）"
```

---

### Task 19: SettingsPage（FIELD_META 驱动元数据表单）

**Files:**
- Create: `apps/web/src/pages/admin/pages/SettingsPage.tsx`
- Test: `apps/web/src/pages/admin/pages/SettingsPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/src/pages/admin/pages/SettingsPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/adminApi', async (orig) => ({
  ...(await orig<typeof import('@/api/adminApi')>()),
  fetchAllSettings: vi.fn().mockResolvedValue({
    wechat_pay: [
      { key: 'WECHAT_PAY_APP_ID', value: 'wx123' },
      { key: 'WECHAT_PAY_API_V3_KEY', value: '' },  // fixture 备注：真实后端 GROUP_KEYS 不返回敏感 key（条目缺席 → valueOf('')→未配置，与空值等价）；
      // 敏感字段「已配置」需后端返回 configured 标志 —— 登记为后续项，不在本计划做
    ],
    sms: [], wechat_login: [],
  }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

import SettingsPage from './SettingsPage';

describe('SettingsPage（元数据驱动）', () => {
  it('三分组 Tab 渲染 + 非敏感字段回填 + 敏感字段显示「未配置」', async () => {
    render(<MemoryRouter><AntdApp><SettingsPage /></AntdApp></MemoryRouter>);
    expect(await screen.findByDisplayValue('wx123')).toBeTruthy();
    expect(screen.getByText(/未配置/)).toBeTruthy(); // 敏感判定在前端 FIELD_META：值非空→已配置
    for (const label of ['微信支付', '短信SMS', '微信扫码登录']) expect(screen.getByText(label)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/SettingsPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现（FIELD_META/分组/敏感只读/diff 禁用/重启文案，全部对齐原 SettingsTab 语义；⚠️ handleSave 的 API 调用统一 try/catch，见阶段 C 头部）**

```tsx
// apps/web/src/pages/admin/pages/SettingsPage.tsx
import { useEffect, useMemo, useState } from 'react';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { App as AntdApp, Button, Form, Input, Spin, Tabs, Tag } from 'antd';
import { fetchAllSettings, saveSettings, type SettingEntry, type SettingGroup } from '@/api/adminApi';

interface FieldMeta {
  key: string; label: string; type: 'text' | 'password' | 'textarea';
  placeholder?: string; sensitive?: boolean;
}

const FIELD_META: Record<SettingGroup, { title: string; description?: string; fields: FieldMeta[] }> = {
  wechat_pay: {
    title: '微信支付设置',
    description: 'API V3 密钥、商户私钥需在服务器 ~/flowweb/apps/api/.env 中配置',
    fields: [
      { key: 'WECHAT_PAY_APP_ID', label: 'App ID', type: 'text' },
      { key: 'WECHAT_PAY_MCH_ID', label: '商户号 (Mch ID)', type: 'text' },
      { key: 'WECHAT_PAY_API_V3_KEY', label: 'API V3 密钥', type: 'password', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'WECHAT_PAY_MERCHANT_SERIAL_NO', label: '商户证书序列号', type: 'text' },
      { key: 'WECHAT_PAY_PRIVATE_KEY', label: '商户私钥 (PEM)', type: 'textarea', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'WECHAT_PAY_MERCHANT_CERT', label: '商户证书 (PEM)', type: 'textarea' },
      { key: 'WECHAT_PAY_PUBLIC_KEY_ID', label: '平台公钥 ID', type: 'text' },
      { key: 'WECHAT_PAY_PUBLIC_KEY', label: '平台公钥 (PEM)', type: 'textarea' },
      { key: 'WECHAT_PAY_NOTIFY_URL', label: '支付回调地址', type: 'text', placeholder: 'https://www.flow123.com/api/recharge/notify' },
    ],
  },
  sms: {
    title: '短信 SMS 设置',
    description: 'SecretId / SecretKey 需在服务器 ~/flowweb/apps/api/.env 中配置',
    fields: [
      { key: 'TENCENT_SMS_SECRET_ID', label: 'SecretId', type: 'text', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'TENCENT_SMS_SECRET_KEY', label: 'SecretKey', type: 'password', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
      { key: 'TENCENT_SMS_SDK_APP_ID', label: 'SDK App ID', type: 'text' },
      { key: 'TENCENT_SMS_TEMPLATE_ID', label: '模板 ID', type: 'text' },
      { key: 'TENCENT_SMS_SIGN_NAME', label: '签名名称', type: 'text' },
    ],
  },
  wechat_login: {
    title: '微信扫码登录设置',
    fields: [
      { key: 'WECHAT_APP_ID', label: 'App ID', type: 'text' },
      { key: 'WECHAT_APP_SECRET', label: 'App Secret', type: 'password', placeholder: '仅可在服务器 ~/flowweb/apps/api/.env 中配置', sensitive: true },
    ],
  },
};

const GROUPS: SettingGroup[] = ['wechat_pay', 'sms', 'wechat_login'];
const GROUP_LABELS: Record<SettingGroup, string> = { wechat_pay: '微信支付', sms: '短信SMS', wechat_login: '微信扫码登录' };

export default function SettingsPage() {
  const [activeGroup, setActiveGroup] = useState<SettingGroup>('wechat_pay');
  const [allSettings, setAllSettings] = useState<Record<SettingGroup, SettingEntry[]>>({ wechat_pay: [], sms: [], wechat_login: [] });
  const [saving, setSaving] = useState(false);
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  // diff 基线：加载完成/切分组/保存成功后都重置，否则初始态 ''!==后端值 误判可保存（现网初始禁用）
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const resetBaseline = (g: SettingGroup, all: Record<SettingGroup, SettingEntry[]>) => {
    const metas = FIELD_META[g].fields.filter((f) => !f.sensitive);
    setFormValues(Object.fromEntries(metas.map((f) => [f.key, (all[g] ?? []).find((e) => e.key === f.key)?.value ?? ''])));
  };

  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchAllSettings().then((all) => { setAllSettings(all); resetBaseline('wechat_pay', all); setLoaded(true); });
  }, []);

  const meta = FIELD_META[activeGroup];
  const entries = allSettings[activeGroup] ?? [];
  const valueOf = (key: string) => entries.find((e) => e.key === key)?.value ?? '';
  const configured = (key: string) => Boolean(valueOf(key));

  const initialValues = useMemo(
    () => Object.fromEntries(meta.fields.filter((f) => !f.sensitive).map((f) => [f.key, valueOf(f.key)])),
    [activeGroup, entries], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // diff 禁用保存（对齐 SettingsTab.tsx:99-101：无变更时保存按钮 disabled）
  const hasChanges = meta.fields.some(
    (f) => !f.sensitive && (formValues[f.key] ?? '') !== (entries.find((e) => e.key === f.key)?.value ?? ''),
  );

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await saveSettings(meta.fields.filter((f) => !f.sensitive).map((f) => ({ key: f.key, value: values[f.key] ?? '' })));
      message.success('保存成功，请执行 pm2 restart flowweb-api 重启服务生效');
      setAllSettings((prev) => ({ ...prev, [activeGroup]: (prev[activeGroup] ?? []).map((e) => (values[e.key] !== undefined ? { ...e, value: values[e.key] } : e)) }));
      setFormValues(Object.fromEntries(meta.fields.filter((f) => !f.sensitive).map((f) => [f.key, values[f.key] ?? '']))); // 保存成功后基线同步，按钮熄灭
    } catch (e) { message.error((e as Error).message); }
    finally { setSaving(false); }
  };

  // 首载门控（对齐 Task16 if (!banner) 模式）：Form initialValues 仅挂载时生效一次，
  // 若在 fetch 完成前挂载（空 entries），后端值永不回填 —— 门控确保 Form 拿到数据后才首次挂载
  if (!loaded) return <PageContainer title="参数配置"><div className="flex justify-center p-16"><Spin /></div></PageContainer>;

  return (
    <PageContainer title="参数配置">
      <Tabs activeKey={activeGroup} onChange={(k) => { setActiveGroup(k as SettingGroup); form.resetFields(); resetBaseline(k as SettingGroup, allSettings); }}
        items={GROUPS.map((g) => ({ key: g, label: GROUP_LABELS[g] }))} />
      <ProCard title={meta.title} subtitle={meta.description}>
        <Form form={form} layout="vertical" initialValues={initialValues} key={activeGroup} style={{ maxWidth: 640 }}
          onValuesChange={(_, all) => setFormValues(all)}>
          {meta.fields.map((f) => (
            <Form.Item key={f.key} label={f.label} name={f.sensitive ? undefined : f.key}>
              {f.sensitive ? (
                <Tag color={configured(f.key) ? 'green' : 'default'}>{configured(f.key) ? '✓ 已配置（在服务器 .env 中管理）' : '✗ 未配置'}</Tag>
              ) : f.type === 'textarea' ? (
                <Input.TextArea rows={3} placeholder={f.placeholder} />
              ) : f.type === 'password' ? (
                <Input.Password placeholder={f.placeholder} />
              ) : (
                <Input placeholder={f.placeholder} />
              )}
            </Form.Item>
          ))}
          <Button type="primary" loading={saving} disabled={!hasChanges} onClick={handleSave}>保存</Button>
          <div className="mt-4 text-xs opacity-60">非敏感配置保存在数据库中，修改后需执行 pm2 restart flowweb-api 重启服务生效。敏感凭证仅可 SSH 登录服务器修改 ~/flowweb/apps/api/.env 文件。</div>
        </Form>
      </ProCard>
    </PageContainer>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/pages/admin/pages/SettingsPage.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd D:/flowweb && git add apps/web/src/pages/admin/pages/SettingsPage.tsx apps/web/src/pages/admin/pages/SettingsPage.test.tsx && git commit -m "feat(web): SettingsPage（FIELD_META 元数据驱动，敏感只读+重启文案保留）"
```

---

## 阶段 D：切换与验收

### Task 20: 路由切换 + 旧文件删除 + 全量回归

**Files:**
- Modify: `apps/web/src/router.tsx`（/admin 段重写）
- Create: `apps/web/src/router.admin.test.tsx`
- Delete: `apps/web/src/pages/admin/page.tsx` + `apps/web/src/pages/admin/index.ts`（barrel `export { AdminPage } from './page'`，不删 tsc 报错）+ `apps/web/src/pages/admin/components/` 下全部旧组件与测试（NodeTypeTabs、ModelTable、ModelFormModal、PricingRuleTable、PricingRuleFormModal、SubscriptionTabs、BannerManagementTab、AnnouncementManagementTab、HomeBannerManagementTab、SettingsTab 及对应 .test.tsx）

- [ ] **Step 1: 写路由结构失败测试**

```tsx
// apps/web/src/router.admin.test.tsx
import { describe, it, expect, vi } from 'vitest';

// 页面 lazy 依赖真实模块，全部 mock 成空组件
vi.mock('@/pages/admin/AdminLayout', () => ({ default: () => <div>layout</div> }));
for (const p of ['ModelsPage', 'PlansPage', 'SubscriptionsPage', 'CreditsPage', 'SubscriptionBannerPage', 'AnnouncementPage', 'HomeBannersPage', 'SettingsPage']) {
  vi.mock(`@/pages/admin/pages/${p}`, () => ({ default: () => <div>{p}</div> }));
}

import { router } from './router';
// 风险备注：import router 会静态连带加载全部真实页面（canvas 等重依赖）。若 jsdom 下因无关页面
// 顶层副作用报错，需将 router.tsx 中其余静态页面 import 一并 vi.mock 掉（本测试只断言路由树结构）

function flatten(routes: any[]): any[] {
  return routes.flatMap((r) => [r, ...(r.children ? flatten(r.children) : [])]);
}

describe('admin 路由树', () => {
  it('/admin 子树含 8 叶子 + index 重定向', () => {
    const all = flatten(router.routes);
    const adminLeaf = all.filter((r) => typeof r.path === 'string'
      && (r.path === 'models' || r.path.startsWith('subscription/') || r.path.startsWith('homepage/') || r.path === 'settings'));
    expect(adminLeaf.length).toBe(8);
    expect(all.some((r) => r.index === true && r.element)).toBe(true); // Navigate to /admin/models
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd D:/flowweb/apps/web && pnpm vitest run src/router.admin.test.tsx`
Expected: FAIL（旧 /admin 是单路由无子树）

- [ ] **Step 3: 实现 —— router.tsx 重写 /admin 段**

import 区修改：删除 `import { AdminPage } from '@/pages/admin';`，新增：
```tsx
import { lazy, Suspense } from 'react';
import { Spin } from 'antd';
import { RequireAdmin } from '@/components/RequireAdmin';

const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'));
const ModelsPage = lazy(() => import('@/pages/admin/pages/ModelsPage'));
const PlansPage = lazy(() => import('@/pages/admin/pages/PlansPage'));
const SubscriptionsPage = lazy(() => import('@/pages/admin/pages/SubscriptionsPage'));
const AdminCreditsPage = lazy(() => import('@/pages/admin/pages/CreditsPage')); // 避开 router.tsx:9 已导入的 settings/CreditsPage
const SubscriptionBannerPage = lazy(() => import('@/pages/admin/pages/SubscriptionBannerPage'));
const AnnouncementPage = lazy(() => import('@/pages/admin/pages/AnnouncementPage'));
const HomeBannersPage = lazy(() => import('@/pages/admin/pages/HomeBannersPage'));
const SettingsPage = lazy(() => import('@/pages/admin/pages/SettingsPage'));

const AdminLazy = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="flex justify-center p-16"><Spin /></div>}>{children}</Suspense>
);
```
（`Suspense` 若与文件顶部已有 import 冲突则合并；`lazy` 同。叶子不再包 Suspense —— AdminLayout 内部 Outlet 外已有 Suspense，单层接住全部 lazy 页面，pro 全家桶仍整体异步。）
RequireAuth children 内 `/admin` 路由对象整体替换为：
```tsx
      {
        path: '/admin',
        element: <RequireAdmin />,
        children: [
          {
            path: '',
            element: <AdminLazy><AdminLayout /></AdminLazy>,
            children: [
              { index: true, element: <Navigate to="/admin/models" replace /> },
              { path: 'models', element: <ModelsPage /> },
              { path: 'subscription/plans', element: <PlansPage /> },
              { path: 'subscription/subscriptions', element: <SubscriptionsPage /> },
              { path: 'subscription/credits', element: <AdminCreditsPage /> },
              { path: 'subscription/banner', element: <SubscriptionBannerPage /> },
              { path: 'homepage/announcement', element: <AnnouncementPage /> },
              { path: 'homepage/banners', element: <HomeBannersPage /> },
              { path: 'settings', element: <SettingsPage /> },
            ],
          },
        ],
      },
```
（pro-components 只进 lazy chunk —— AdminLayout/8 页面全部异步，spec §4.5。）

- [ ] **Step 4: 删除旧文件**

```bash
cd D:/flowweb && git rm apps/web/src/pages/admin/page.tsx apps/web/src/pages/admin/index.ts apps/web/src/pages/admin/components/NodeTypeTabs.tsx apps/web/src/pages/admin/components/NodeTypeTabs.test.tsx apps/web/src/pages/admin/components/ModelTable.tsx apps/web/src/pages/admin/components/ModelFormModal.tsx apps/web/src/pages/admin/components/PricingRuleTable.tsx apps/web/src/pages/admin/components/PricingRuleFormModal.tsx apps/web/src/pages/admin/components/SubscriptionTabs.tsx apps/web/src/pages/admin/components/SubscriptionTabs.test.tsx apps/web/src/pages/admin/components/BannerManagementTab.tsx apps/web/src/pages/admin/components/BannerManagementTab.test.tsx apps/web/src/pages/admin/components/AnnouncementManagementTab.tsx apps/web/src/pages/admin/components/AnnouncementManagementTab.test.tsx apps/web/src/pages/admin/components/HomeBannerManagementTab.tsx apps/web/src/pages/admin/components/HomeBannerManagementTab.test.tsx apps/web/src/pages/admin/components/SettingsTab.tsx
```
（先 `ls D:/flowweb/apps/web/src/pages/admin/components/` 核对实际文件清单，含 ModelTable/PricingRule 的测试文件若有则一并 rm；删除后 grep 全库 `from './components/`、`pages/admin'` 确认无残留引用。）

- [ ] **Step 5: 全量回归（两端）+ 收口机械兜底检查**

Run: `cd D:/flowweb/apps/web && pnpm test && pnpm exec tsc --noEmit`；`cd D:/flowweb/apps/api && pnpm test`
Expected: 全绿 + 类型通过（旧测试已删，新测试覆盖 8 页 + 布局 + 守卫）

机械兜底检查（阶段 C「统一异步错误收口」收口 —— 防实现者漏套 try 壳）：
Run: `grep -L "try {" D:/flowweb/apps/web/src/pages/admin/pages/*.tsx`
Expected: 无输出（8 个页面文件均含 try 块）；再人工核对每个 onFinish 的 catch 均含 `return false`、行内 onConfirm/Switch onChange/toggle 异步回调也已包裹。

- [ ] **Step 6: Commit**

```bash
cd D:/flowweb && git add -A apps/web/src && git commit -m "feat(web): /admin 嵌套路由+lazy 切换，删除旧单页组件（ProLayout 后台全量上线）"
```

---

### Task 21: 浏览器验收（spec §7 全清单）

**Files:** 无代码 —— 验收记录写入本 plan 末尾。

- [ ] **Step 1: 启动全栈**（按 docs/superpowers/project_startup.md；本地 PG/Redis/MinIO 在线 + apps/api dev + apps/web dev）

- [ ] **Step 2: 逐条验收（spec §7 的 11 条）**

1. 退出登录态访问 `/admin/models` → 跳 `/login`
2. USER 账号登录访问 `/admin/models` → 403 页面（含「返回首页」）
3. 角色拦截双态：未登录 curl `GET /api/admin/node-types` → AuthGuard 先抛 401 `Unauthorized`（英文，AdminGuard 中文分支不可达属合理纵深）；**USER 已登录**同请求 → 403 `{code:-1,message:'需要管理员权限'}`（中文）
4. 注册请求 body 加 `"role":"ADMIN"` → 注册成功但 `/me` role 仍 USER
5. admin@flowweb.local 登录 → 侧边栏 4 组菜单、二级展开正确、点击切换、菜单高亮与 URL 一致
6. 刷新 `/admin/subscription/credits` → 页面保持
7. 侧边栏折叠/展开可用
8. 8 页逐页：列表加载、分页（subscriptions 服务端分页翻页）、新建（ModalForm 校验+提交）、编辑回填（含 PlansPage storageGB 换算回填）、删除 popconfirm、断 api 后失败提示为中文
9. 普通成员 TeamBillingPage 套餐列表正常（走上架套餐）
10. admin 暗色页触发 message/modal.confirm（如删除确认）→ 弹层为暗色
11. 绿色实心按钮（如「新建模型」）文字为深色、可读（12.05:1）
12. （附加）访问 `/admin` 后 Network 面板确认 pro-components chunk 按需加载；首页/画布首屏无 pro-components
13. （附加）WS 冒烟：双全局 guard 上线后打开团队画布触发一次执行流 + 发起一次支付，确认 `/execution`、`/payment` WS 连接与消息正常（AuthGuard 本身无 WS 协议判断，属已登记技术债，冒烟兜底）

- [ ] **Step 3: 记录结果**

在本文件末尾追加「## 验收记录」小节，逐条标注 ✅/❌ 与备注；❌ 项修复后复验。

- [ ] **Step 4: 最终提交（含 spec/plan 文档）**

```bash
cd D:/flowweb && git add docs/superpowers && git commit -m "docs(admin-console): spec v2.4 + 实施 plan + 验收记录"
```

---

## Self-Review（含六轮 plan 审核修订记录）

**六轮审核（N1×3/N2/N3/N4/N5/N6，全部实证并修订）：**
- N1 Task13/14/16 三个测试文件漏 import userEvent（用例写了 setup 却无 import）—— 各补一行
- N2 公告互斥用例状态不可达（mock 恒回 active:true 且 Switch checked 来自行数据，「先禁再启」在 mock 下到不了确认分支）—— 改 mockResolvedValueOnce 独立未启用夹具
- N3 终端确认前置 —— 新增 Task 0（echo $0 验证 shell，bash 直接跑 / PowerShell 先切换）
- N4 onFinish try/catch 只在阶段 C 口头约定（subagent 只看单 Task 易丢）—— 8 个页面 Task 的 Step 3 标题逐个加 ⚠️ 提醒
- N5 Task16 上传用例 defineProperty+user.upload 设值重复（依赖边界行为）—— 简化为直接 user.upload 隐藏 input
- N6 SettingsPage formValues state 上移 resetBaseline 之前；Task4 两个 Step4 → 重排（Commit 变 Step5）；Task8 Step 3→5 → 补齐 Step4
- 六轮复核确认：五轮的 6 项修复全部真正闭环（useApp 内移/loaded 门控/四字正则/作废 reload/注释修正/终端标注），实现代码可直接落地

**七轮终审（Approved，P3×5 全部处理）：**
- Task 0 探针 `echo $0` 改 `uname`（PowerShell 中 $0 未定义仅输出空行，区分度弱；Git Bash 必有 uname 且输出 MINGW64_NT-...）
- 阶段 C 收口约定扩展：① onFinish 的 catch **必须 `return false`**（undefined 被 ProForm 视为 resolve，弹窗照关丢输入）；② 行内异步回调（onConfirm/Switch onChange/toggle）同口径包裹（否则断网 unhandled rejection 无中文提示）；③ Task 16 保存后重取 fresh 进同一 try；④ Task 20 Step 5 加 `grep -L "try {"` 机械兜底检查
- Task 10 Step 5 期望值 3 条改 4 条（测试实为 4 个 it，含点击退出回归）；Task 17 测试加 `beforeEach(vi.clearAllMocks)` 隔离 mock 历史；Self-Review 四处重复标题行删除；Task 19 handleSave 的 validateFields reject 边界知悉不改（本页字段无 rules，实际不触发）

**五轮审核（P1×3/P2×4/P3 择优，全部实证并修订）：**
- P1-1 AdminLayout 的 useApp 在 <AntdApp> 父层 → context 默认空对象（app/context.js:3-7），点退出必崩且测试掩盖 —— 重构为 Provider 外壳 + AdminLayoutInner，补「点退出出现 confirm 标题」回归测试
- P1-2 SettingsPage 首载不回填（Form initialValues 仅挂载时生效，fetch 后 key 不变不 remount；Task16 门控反证一致）—— 补 loaded 门控
- P1-3 恰好两个汉字才插空格（buttonHelpers.js:5 rxTwoCNChar）——「新建模型」四字不插，/新 建/ 必挂；Task12/13/17 三处改 /新\s?建/，通用模式经验描述更正
- P2-1 Task14 作废后无 reload（旧版有 load）—— 补 actionRef + reload + 作废 body 测试
- P2-2 Task12 两处注释与事实相反（旧编辑分支实发子资源属缺陷、apiKey 列表明文下发旧表单真实回填）—— 注释改为「修复」表述 + 登记安全债（GET /admin/models 明文 apiKey）+ 编辑态隐藏子资源 List
- P2-3 终端假设：审核方环境为 PowerShell、执行会话为 Git Bash —— plan 头部加终端约定标注（两种环境均可用）
- P2-4 测试覆盖净减少 —— 补 4 条：公告启用互斥确认（含取消不发/确认发 active:true）、PlansPage 提交 storageGB→字节换算（60GB→64424509440）、SubscriptionsPage 作废 body、Banner 上传清 URL 互斥；hex 用例改 waitFor 防假绿
- P3 择优：Task16 title/subtitle maxLength(64/200)+保存后重载回显；Task18 toBannerPayload 空串收口+linkUrl maxLength 500；Task19 fixture 备注（真实后端不返回敏感 key，configured 标志登记后续项）；Task20 路由测试静态加载风险备注；阶段 C 补 onFinish 统一 try/catch 收口约定；验收第 3 条双态措辞（未登录=401 英文/USER=403 中文）
- 五轮同时复核 30+ 项「为真」：39 控制器前缀、PATCH /me 双层 whitelist、三条登录路径直通返回含 role、Task20 删除清单 17 文件逐一对应、迁移 14 目录、master 工作区干净

**四轮审核（P1×3/P2×4/P3×7 实证并修订；P3-4 PowerShell 条目不适用 —— 执行环境为 Git Bash，Unix 语法有效）：**
- P1-1 删节点类型表后 setNodeTypes 无来源（页面恒空）—— 补 useEffect 加载
- P1-2 models state 只在备注 —— 补声明 + fetchModels 收敛页面级一次（P3-8）
- P1-3 ModalForm okText 在测试环境为 enUS 'OK'（真实 zhCN 是「确定」非「确认」）—— 弹窗提交断言统一类名选择器 `.ant-modal-footer .ant-btn-primary`
- P2-1 Task19 diff 基线初始态算反 + 切组/保存后不重置 —— resetBaseline 三处（fetch 后/onChange/保存成功）
- P2-2 Task16 互斥单向 + 丢预览 —— URL onChange 清 imageKey（key 优先会静默吞 URL）+ 预览补回
- P2-3 Task17 空串语义回退 —— toAnnPayload 收口（trim/||null/maxLength/whitespace）
- P2-4 嵌套 theme 的 child.algorithm 整体覆盖 parent（useTheme.js:26 合并语义）—— 内层 ConfigProvider 删 algorithm，暗色统一交 ProConfigProvider dark（其内部已含 antd 暗色+pro 专属微调）
- P3：Task10 顶栏补管理员名称；Task14 删未用形参；Task4 Step 重排；Task8 Step 合并；Task13 新建套餐注明「增强」；Task16 测试标注 ProConfigProvider 备选
- 四轮同时确认：rc-field-form useForm 只收集已挂载 Field —— ModalForm initialValues 整行传入的无关字段不会进 onFinish values，编辑弹窗无需白名单（误报排除）；Task1-6 后端链路、adminApi 函数名/类型对齐、删除清单 18 文件、cleanup 级联顺序均复核通过

**三轮审核（P1×3/P2×3/P3 全部实证并修订）：**
- P1-1 subscriptionApi 是对象导出非命名导出 —— Task 16 import/mock 全改 subscriptionApi.xxx 形状
- P1-2 router.tsx:9 已导入 settings/CreditsPage —— lazy 声明改 AdminCreditsPage 避重名
- P1-3 公告 Popconfirm disabled 方向反了 —— disabled={r.active}（启用需确认、禁用直改，对齐 content.service.ts:65-72）
- P2-4 web 无 tsconfig.app.json —— 两处 tsc 命令改 pnpm exec tsc --noEmit
- P2-5 original* 三字段 @default(0) 可选 —— 表单去 required、关键事实表述修正
- P2-6 toStorageBytes 要求字节正整数 —— storageGB 加 min=1/precision 0/整数校验
- P3：新建公告 active 初值 false（撞唯一启用索引）；HEX 正则对齐现网 {3,8}；Task 10 mock 补 logout；模型表单去 active 开关（启停走行内）；apiKey 编辑不传注明有意为之；base 剔除子资源注明双重创建原因

**二轮审核（P1×6/P2×4/P3 全部实证并修订）：**
- P1-1 订阅契约：状态改小写枚举、真实字段（tier/period/currentPeriodEnd 等）、作废 {status:'expired'} 新增 cancelAdminSubscription —— Task 11/14 重写
- P1-2 套餐字段：AdminPlanRow 12 字段（tier+6 价格字段，删 seatLimit）、tier ProFormSelect、新建无上架开关（后端强制 isActive:true）、编辑 ModalForm（含 storageGB 回填）—— Task 11/13 重写
- P1-3 Banner：删 adminApi 重复封装、复用 subscriptionApi、字段 backgroundImageKey、2MB（home-banner 才是 5MB）、autoExtend 联动拦截、上传/URL 互斥 —— Task 11/16 重写
- P1-4 destroyOnHidden → destroyOnClose（5.22.5）—— 全文替换
- P1-5 Button primaryColor（非 colorTextLightSolid）—— Task 10
- P1-6 shared 补 vitest devDep + 脚本 —— Task 1 Step 0
- P2 功能回退补齐：Task 12 编辑 ModalForm（更新不发子资源）+toggleModel 上下线+分辨率/时长按 nodeTypeKey 条件显示+计费规则 ProFormSelect 级联（删节点类型 ProTable）；Task 17 行内互斥 Switch+hex 校验+#0f2761+测试用例对齐旧覆盖；Task 18 行内 active Switch；Task 19 diff 禁用保存+SettingEntry mock 修正（无 sensitive 字段）
- P3：Task 20 删除清单补 index.ts barrel、Suspense 单层化；Task 4 process.exit(0) 必做；Task 6 对齐 mkController 风格；Task 15 文案「普通积分」；Task 10 二级菜单容错断言；关键事实「裸 fetch 3 个 tab」修正；Task 21 补 WS 冒烟

**一轮自查（保留）：**

**1. Spec 覆盖检查：**
- §1 版本锁定/单实例 → Task 8 ✅；react-router v7 导入 → router.tsx 写法 ✅
- §2.1 迁移+reset replay → Task 2 ✅；§2.2 三段链路+双路径提权 → Task 3 ✅；§2.3 seed 约束（≥8 位/Redis）→ Task 4 ✅；§2.4 shared Role → Task 1 ✅
- §3.1 AdminGuard 全要素 → Task 5 ✅；§3.2 team-plans（SkipTeamGuard/isActive/BigInt）→ Task 6 ✅；§3.3 防自锁顺序 → 红线声明 + Task 4 Step 3 /me 验证 ✅
- §4.1 路由树 8 叶子 → Task 20 ✅；§4.2 ProLayout 配置 → Task 10 ✅；§4.3 RequireAdmin+登录时序（已天然满足，只改类型）→ Task 9 ✅；§4.4 四层结构 → Task 10 ✅；§4.5 lazy 边界 → Task 20 Step 3 ✅
- §5.1 三类分页协议 → Task 11（封装）+ 12/13/18（全量）+ 14（服务端）✅ 空壳不放置 ✅；§5.2 九组件全部有 Task（12-19）✅ 编排保留 Task 12 ✅ Settings 单独排期 Task 19 ✅；§5.3 Popconfirm/App.useApp/apiFetch → Task 7/10/各页 ✅
- §6 Q3 路径 A（#4ade80+Button 深色字）→ Task 10 theme components ✅
- §7 验收 11 条 → Task 21 Step 2（含附加 2 条）✅
- §8 测试策略逐项 → Task 3/5/6（后端）、Task 9/10/12-20（前端）、scrollIntoView 预备 → Task 10 Step 1 ✅
- 发现并修正的 spec 小误差：subscription banner 实为**单资源**（GET/PATCH/upload 无列表）→ Task 16 按表单页实现（已在 plan 标注）

**2. 占位符扫描：** 无 TBD/TODO；Task 12 备注修正了 import 笔误说明；Task 13 编辑交互给了明确底线（isActive Switch + 复杂字段表单）与二选一范围；Task 20 Step 4 要求先 ls 核对清单再删 —— 均为有明确执行指令的备注，非悬空占位。

**3. 类型一致性：** `isAdmin`（Task 1 定义，Task 5/9 消费）；`AdminPlanRow/AdminSubscriptionRow/SubscriptionBannerData`（Task 11 定义，Task 13/14/16 消费）；`fetchAdminPlans` 等函数名在各 Task 间一致；AdminLayout/8 页面统一 default export（Task 10/12-19 定义，Task 20 lazy 消费）✅

**已知风险登记（实现时留意）：**
- Task 3 提权测试连真实 PG+Redis（auth.ts 顶层 Redis），CI 无 DB 时该文件应标记仅本地跑（现有 api 测试基建同为本地 DB 模式，先按本地跑处理）
- Task 4 seed 可能因 Redis 连接挂起不退出 —— 已给 process.exit(0) 备选
- Task 10 ProLayout 2.8.10 的 actionsRender/avatarProps API 名称以类型提示为准（计划代码为标准用法）
- Task 12 编辑已用独立 ModelFormModal（回填 resolutions/durations、更新不发子资源）—— 二轮审核后 startEditable 已移除

## 验收记录（Task 21，2026-09-04 执行）

**执行环境**：Git Bash + 本地 PG/Redis/MinIO + api(3000)/web(5173) dev server；测试账号 admin@flowweb.local（ADMIN）、accept-user/accept-evil@test.flowweb.local（USER）。

| # | 验收项 | 结果 | 备注 |
|---|---|---|---|
| 1 | 未登录访问 /admin/models → 跳 /login | ✅ | URL 保持 /login，登录表单可见 |
| 2 | USER 登录访问 /admin/models → 403 页 | ✅ | 含「需要管理员权限」+「返回首页」按钮，URL 不跳转 |
| 3 | 角色拦截双态 | ✅ | 未登录 → 401（AuthGuard 先拦，英文，纵深合理）；USER 已登录 → 403 `{code:-1,message:'需要管理员权限'}` 中文；**大写变体 /API/admin/* 亦 403（C1 修复活体验证）** |
| 4 | 注册 body 带 role:ADMIN → 无法提权 | ✅ | sign-up 201 → /me `role:"USER"` → admin 端点 403 |
| 5 | admin 侧边栏 4 组菜单 | ✅ | 模型管理/会员订阅(4 子项)/首页配置(2 子项)/参数配置；二级展开、点击切换路由、高亮与 URL 一致（套餐管理选中 ↔ /admin/subscription/plans） |
| 6 | 刷新深层路由 /admin/subscription/credits | ✅ | 硬加载页面保持，积分发放表单渲染，菜单高亮跟随 |
| 7 | 侧边栏折叠/展开 | ✅ | collapsed 状态往返正常 |
| 8 | 8 页逐页 | ✅ | models（Tabs+双表+行操作）/ plans（14 列+新建+编辑回填 storageGB=50 字节往返）/ subscriptions（请求带 `?page=1&pageSize=20`，现库 1 条故分页器隐藏）/ credits（表单+失败中文提示「用户默认团队缺失」）/ banner（表单+互斥）/ announcement（hex 校验拦截→创建→popconfirm 删除全链）/ home-banners（空态）/ settings（3 Tab+敏感 Tag+保 存 diff 禁用+重启文案）。**验收发现并修复 PlansPage nonNeg 校验空值 bug（87aff43）** |
| 9 | 普通成员读上架套餐 | ✅ | USER 会话 GET /api/team/plans → 200 两个上架套餐、storageLimitBytes 已转 Number；TeamBillingPage 对默认团队重定向个人积分页系 Plan A/B 既有行为（单测 5 绿） |
| 10 | 暗色页弹层持暗色 | ✅ | modal content rgb(31,31,31)、body rgb(20,20,20) |
| 11 | 绿色实心按钮深色文字 | ✅ | 按钮底 rgb(66,192,112)（darkAlgorithm 微调后的品牌绿）+ 文字 rgba(0,0,0,0.88)，对比度约 9:1 |
| 12 | pro-components 按需加载 | ✅ | 首页硬加载 0 个 pro chunk；/admin 加载时按需拉取 @ant-design_pro-components.js + AdminLayout.tsx + pages/ModelsPage.tsx（网络面板实证） |
| 13 | WS 冒烟（画布执行流+支付） | ⏭ | 浏览器自动化无法触发节点执行流——与上线前必修项 #2（团队画布 Socket 扣费推送人工验证）同源，留人工一并执行 |

**验收期排障记录（环境层面，非代码缺陷）：**
1. **Vite 依赖预构建双实例**：web dev server 在安装 pro-components 之前已运行，首次进 /admin 出现双 React 实例（两个 ?v= 哈希的 chunk）崩溃，硬重载后 Vite 重新预构建自愈。启示：新增依赖后需重启 dev server。
2. **预览窗口后台化**：document.hidden=true 且 rAF 不触发 → antd/rc-motion 关闭动画卡在 leave 态（弹窗 DOM 滞留但 React 状态已关闭）——渲染伪象非应用 bug，验证时以状态/数据为准。
3. **migrate reset 后 seed 无套餐/订阅数据**：套餐页初始为空，经 UI 新建「验收套餐-可删」一条 dev 数据完成编辑回填验证（保留在库，无害）。

**执行期代码修正汇总（相对 plan 的偏差，均已双审或实证）：** shared 值导入改 guard 内联（badef56，Node 无法加载纯 TS 源码包——首个运行时消费者触发潜伏地雷）；AdminGuard path 小写化（18604d3）；PlansPage nonNeg 空值放行（87aff43）；各页测试断言/类型适配 12 处（findBy 时序、getAllByRole 多命中、ReactElement、fieldProps.maxLength、subTitle 等）——详细见各 commit。

