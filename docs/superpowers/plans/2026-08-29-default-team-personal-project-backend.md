# 默认团队个人项目化 — 后端实施计划（Plan A：Phase 0-6）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec v3.1（docs/superpowers/specs/2026-08-29-default-team-personal-project-design.md）完成后端改造：Team.isDefault 标记、统一 Bootstrap、默认团队操作禁令、资源团队化（project/canvas/folder/template/media/task/storyboard）、个人订阅账本迁移到默认团队 TeamBalance、删除 User 级账本与充值死链路。

**Architecture:** 数据层仍是 Team（默认团队=个人项目），加 `isDefault` 标记 + partial unique index；权限收敛为 ProjectPermissionService/团队成员资格双层；账本收敛为 TeamBalance 唯一（个人订阅引擎写入默认团队，团队引擎写入各自团队）。**schema 采用"先加后删"策略：Task 1 只做加法（新列/索引/枚举值），删除 User 级模型推迟到 Task 13（先断引用再删模型，保证中间所有 Phase 编译可用）。**

**Tech Stack:** NestJS + Prisma 5.22 + PostgreSQL、Vitest（`pnpm test` = tsc --noEmit + vitest run）、TypeScript strict。

**范围说明:** 本计划只覆盖 spec 的 Phase 0-6（后端）。Phase 7-9（前端 works/team/billing/上传上下文/顶栏积分）与 Phase 10（联调）在 Plan A 验收后另写 Plan B。**Plan A 内对 apps/web 只做三类最小改动**：① 删除死链路及其引用（Task 12）；② `/api/credits/balance` 返回结构调整（Task 11，**保留 `subscriptionCreditsExpiry` 字段**，见 C1 决策）；③ Task 13 Step 1.11 含删除 User 级账本的**必要前端配套**（CreditsPage 充值入口改团队链路、删「账户余额」卡、creditsStore 适配新返回结构）——这是删模型的编译连带，不是功能改造，works/team/billing 主 UI 一律不动（Plan B）。`cd apps/web && pnpm exec tsc -b && pnpm test` 是 Plan A 硬门禁（vitest 不查类型，tsc -b 必须显式跑）。

**全局安全不变量（P0-3）:** TeamGuard 仅对 URL 带 `:id` 的路由校验成员（team.guard.ts:24-25 无 `:id` 直接放行）。因此**任何从 body/query 接收外部 teamId 且 URL 无 `:id` 的接口（folder/template/material-library/media/storage 的 list/create 等），第一道必须调用成员自证**（Task 6 起统一使用 `assertTeamMember`，见 team.util.ts 扩展），校验通过才允许进 where/data；每个此类接口必须配一条「他团队成员猜 ID → 403」反例测试。

**通用约定:**
- 测试命令（单文件快速迭代）：`cd apps/api && pnpm exec vitest run <文件路径>`；全量门禁：`cd apps/api && pnpm test`
- **web 侧门禁（B4 修正）**：`apps/web` 的 `pnpm test` = `vitest run`（esbuild 转译，**不做类型检查**）。涉及 apps/web 改动的 Task（12/13），门禁必须是 `cd apps/web && pnpm exec tsc -b && pnpm test`（tsc -b 走 project references 纯类型检查）
- 现有测试用 mock prisma 模式（`prisma.team.findFirst.mockResolvedValue(...)`），新测试遵循同模式
- 每个 Task 完成后必须：api 门禁全绿（涉 web 时加 web 双门禁）→ commit（信息风格：`feat(api): ...` 中文描述）
- 默认团队操作禁令（历史文档称"六禁"，**实际覆盖 9 个 team 操作 + 2 个团队订阅入口 + 1 个单画布协作者入口，共 12 处**，见 Task 4）错误消息统一前缀 `个人项目不支持`，测试断言用正则 `/个人项目不支持/`（防措辞漂移）
- 行号引用基于 2026-08-29 代码状态，若漂移以内容定位

---

### Task 0: 测试基线

**Files:** 无变更

- [ ] **Step 1: 跑全量测试确认现状全绿**

Run: `cd apps/api && pnpm test`
Expected: 全部通过（若有既有红测，记录并向用户确认后再继续，不得带病开工）

- [ ] **Step 2: 记录基线**

记录通过测试数量（后续 Task 以此为回归参照）。

---

### Task 1: Schema 加法变更 + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<ts>_personal_project_refactor/migration.sql`（由 prisma 生成后手写补充索引）

- [ ] **Step 1: schema 加法编辑**

在 `Team` model（schema.prisma:711-731）追加：

```prisma
  isDefault        Boolean  @default(false)
  folders          Folder[]
  templates        Template[]
  materialFolders  MaterialFolder[]
  lightingTasks    LightingTask[]
  videoTrimTasks   VideoTrimTask[]
  videoSeparateTasks VideoSeparateTask[]
```

（`templates Template[]` 不可漏——Template 加 team FK 后 Prisma 要求双向关系，缺它 `prisma validate` 直接报 missing opposite relation field。）

在 `Folder` model（:165-179）加：

```prisma
  teamId    String
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
```

并将 `@@index([userId, parentId])` **替换**为 `@@index([teamId])`（查询全部切 teamId 维度后旧组合索引成死索引，仅有写开销——已核实无"跨团队按 userId+parentId 查文件夹"场景，无存量数据直接删）。`userId` 字段保留（语义=创建人）。

`Media` model **teamId 已存在，无需加列**（schema.prisma:309-310，`teamId String` 非空 + FK Cascade + Team.media 反向关系 ：725 均已有——D4 素材直传改造时加的，Task 7 直接使用）。**仅需补 `@@index([teamId])`**（:312-318 现有索引清单无 teamId；Task 7 后 confirmUpload/getMediaUrl/素材库均按 teamId 查询，缺索引全表扫）。

`SubscriptionPlan` model（:489-507）加 `storageLimitBytes BigInt`（与 TeamPlan:780 同类型；C7 决策——个人套餐**含**存储权益，getLimits 回退链路见 Task 10）。

对 `MaterialFolder`、`LightingTask`、`VideoTrimTask`、`VideoSeparateTask` 四个 model 做同样操作（teamId String + FK Cascade + `@@index([teamId])`；userId 保留）。先读各 model 现状确认字段名。

`Template` model 加 **`teamId String?`（可空）** + FK（Cascade）+ `@@index([teamId])`。**必须可空的原因**：`initOfficialTemplates`（template.service.ts:227-266）创建 `userId=OFFICIAL_USER_ID` 的官方模板，该系统用户无团队不走 bootstrap；社区公共模板 isPublic 且 projectId 可空（schema:122）也存在游离态。非空约束会让官方模板 seed 直接 NOT NULL/FK 违约。语义约定：公共/官方模板 teamId=null；用户/团队模板由 service 层保证非空；my/team 维度查询按 teamId 直查天然排除 null 公共模板；official/community 分支仍按 isPublic/userId 查（:54/:66 现状不变）。Folder/MaterialFolder/三类 Task 无公共概念，保持非空。

`TeamCreditTransactionType` enum（:686-693）改为：

```prisma
enum TeamCreditTransactionType {
  recharge
  subscription_grant
  consumption
  expire_clear
  register_grant
  upgrade_clear
  admin_grant
  admin_clear
}
```

（删除 `admin_adjust`——已核实零代码引用；新增三个值。）

`TeamSubscription.teamId`（:795）删去 `@unique`，同时 **`String?` 改 `String`（非空）**、关系 `onDelete: SetNull` 改 **`Cascade`**。理由：订阅必有归属团队，可空会让 partial unique index 对 NULL 失效（多条 teamId=NULL 的 active 记录互不撞约束）；SetNull 要求可空字段，团队删除时订阅随之级联删（订阅随团队存亡，语义合理；无存量数据）。**防回归门禁**：删 @unique 后 Prisma client 上 `teamSubscription.findUnique({ where: { teamId } })` 会编译报错——已核实全库现状零使用（team-subscription.service.ts:164 用 findFirst），Step 4 加 grep 确认。

- [ ] **Step 2: 生成 migration（无数据，干净重建）**

Run: `cd apps/api && pnpm prisma migrate reset --force && pnpm prisma migrate dev --name personal_project_refactor`
Expected: migration 生成成功。**注意**：migrate dev 需一次性 CREATEDB 授权（见项目 memory），若提示权限问题按 memory 中流程处理。

- [ ] **Step 3: migration.sql 手写补充索引**

打开生成的 `migration.sql`，在末尾追加：

```sql
-- 默认团队每用户唯一
CREATE UNIQUE INDEX "team_owner_default_unique" ON "Team"("ownerId") WHERE "isDefault" = true;
CREATE INDEX "team_owner_id_idx" ON "Team"("ownerId");

-- Folder 同级重名（root 与 parent 分开：PG 中 NULL 互不相等）
CREATE UNIQUE INDEX "folder_team_root_name_unique" ON "Folder"("teamId", "name") WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX "folder_team_parent_name_unique" ON "Folder"("teamId", "parentId", "name") WHERE "parentId" IS NOT NULL;

-- MaterialFolder 同级重名
CREATE UNIQUE INDEX "material_folder_team_root_name_unique" ON "MaterialFolder"("teamId", "name") WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX "material_folder_team_parent_name_unique" ON "MaterialFolder"("teamId", "parentId", "name") WHERE "parentId" IS NOT NULL;

-- 个人/团队订阅各仅一个 active
CREATE UNIQUE INDEX "user_subscription_one_active" ON "UserSubscription"("userId") WHERE status = 'active';
CREATE UNIQUE INDEX "team_subscription_one_active" ON "TeamSubscription"("teamId") WHERE status = 'active';
```

- [ ] **Step 4: 应用并验证**

Run: `cd apps/api && pnpm prisma migrate reset --force && pnpm prisma generate && pnpm test`
Expected: migration 应用成功（含手写索引）、现有测试全绿（新列有默认值/新 enum 值不破坏现有代码；注意 Prisma migrate reset 后会重跑 seed 若存在）。

附加验证两条：
```bash
# ① teamSubscription.findUnique({ where: { teamId } }) 防回归（删 @unique 后此写法编译报错，须零命中）
cd apps/api && grep -rn "teamSubscription\.findUnique" src --include="*.ts"
# ② 手写 partial unique index DDL 实际生效（mock 单测覆盖不到 DB 约束，此处直接验索引）
psql -h 127.0.0.1 -U flowweb -d flowweb -c "\d Team" -c "\d Folder"
```
Expected: ① 无输出；② 输出含 `team_owner_default_unique`、`folder_team_root_name_unique` 等 partial index 定义。

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): Phase1 schema 加法——Team.isDefault/六表 teamId/流水枚举/订阅 active 唯一索引（先加后删策略，User 级模型删除推迟 Task13）"
```

---

### Task 2: 统一 Bootstrap

**Files:**
- Create: `apps/api/src/modules/team/team.bootstrap.ts`
- Test: `apps/api/src/modules/team/team.bootstrap.spec.ts`
- Modify: `apps/api/src/auth/auth.ts:46-77`（注册钩子）
- Modify: `apps/api/src/auth/auth.controller.ts:45-72`（sign-up）、`:85-105`（me 补偿）
- Modify: `apps/api/src/auth/wechat/wechat.service.ts`（注册路径）
- Modify: `apps/api/src/modules/team/team.service.ts:23-59`（ensureDefaultTeam）
- Modify: `apps/api/src/modules/team/team.util.ts`（getOwnerTeamId 判据，本 Task 一并改）

- [ ] **Step 1: 写失败测试**

创建 `team.bootstrap.spec.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { bootstrapPersonalTeam } from './team.bootstrap';

type Tx = Record<string, any>;

function makeDb(overrides: Partial<Tx> = {}): Tx {
  return {
    team: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 't1', name: 'Alice的团队', ownerId: 'u1', isDefault: true }),
    },
    teamMember: { create: vi.fn().mockResolvedValue({}) },
    teamBalance: { create: vi.fn().mockResolvedValue({}) },
    teamCreditTransaction: { create: vi.fn().mockResolvedValue({}) },
    materialFolder: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
    $transaction: vi.fn(async (fn: (tx: Tx) => Promise<any>) => fn(db)),
    ...overrides,
  } as unknown as Tx;
}

describe('bootstrapPersonalTeam', () => {
  it('已存在 isDefault 团队时直接返回，不重建', async () => {
    const existing = { id: 't0', ownerId: 'u1', isDefault: true };
    const db = makeDb({ team: { findFirst: vi.fn().mockResolvedValue(existing) } as any });
    const team = await bootstrapPersonalTeam(db as any, 'u1', 'Alice');
    expect(team).toBe(existing);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('判据为 ownerId+isDefault，与成员身份无关', async () => {
    const db = makeDb();
    await bootstrapPersonalTeam(db as any, 'u1', 'Alice');
    expect(db.team.findFirst).toHaveBeenCalledWith({ where: { ownerId: 'u1', isDefault: true } });
  });

  it('事务内创建 Team(isDefault)+OWNER+Balance(100)+流水+默认素材文件夹', async () => {
    const db = makeDb();
    await bootstrapPersonalTeam(db as any, 'u1', 'Alice');
    expect(db.team.create).toHaveBeenCalledWith({
      data: { name: 'Alice的团队', ownerId: 'u1', status: 'ACTIVE', isDefault: true },
    });
    expect(db.teamMember.create).toHaveBeenCalledWith({
      data: { teamId: 't1', userId: 'u1', role: 'OWNER' },
    });
    expect(db.teamBalance.create).toHaveBeenCalledWith({ data: { teamId: 't1', credits: 100 } });
    expect(db.teamCreditTransaction.create).toHaveBeenCalledWith({
      data: { teamId: 't1', operatorUserId: 'u1', amount: 100, type: 'register_grant', creditType: 'regular', balanceAfter: 100 },
    });
    expect(db.materialFolder.createMany).toHaveBeenCalledWith({
      data: ['角色', '场景', '道具', '风格', '音效'].map((name, i) => ({
        name, teamId: 't1', userId: 'u1', isDefault: true, sortOrder: i,
      })),
    });
  });

  it('并发撞唯一索引（P2002）时重查返回既有团队', async () => {
    const existing = { id: 't-old', ownerId: 'u1', isDefault: true };
    const db = makeDb({
      team: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)   // 首查无
          .mockResolvedValueOnce(existing), // 冲突后重查
        create: vi.fn().mockRejectedValue({ code: 'P2002' }),
      } as any,
    });
    const team = await bootstrapPersonalTeam(db as any, 'u1', 'Alice');
    expect(team).toBe(existing);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/team/team.bootstrap.spec.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 team.bootstrap.ts**

```typescript
import { DEFAULT_FOLDER_NAMES } from '../material-library/constants/material-library.constants';

type Db = {
  team: { findFirst: Function };
  $transaction: Function;
};

/**
 * 统一个人团队（默认团队）Bootstrap——邮箱/手机/微信注册与 ensureDefaultTeam 的唯一入口。
 * 判据固定 ownerId+isDefault（与用户是否加入其他团队无关）；
 * 并发创建由 team_owner_default_unique 兜底，冲突时重查返回既有行。
 */
export async function bootstrapPersonalTeam(db: Db, userId: string, userName: string) {
  const existing = await db.team.findFirst({ where: { ownerId: userId, isDefault: true } });
  if (existing) return existing;

  const name = userName?.trim() || '用户';
  try {
    return await db.$transaction(async (tx: any) => {
      const team = await tx.team.create({
        data: { name: `${name}的团队`, ownerId: userId, status: 'ACTIVE', isDefault: true },
      });
      await tx.teamMember.create({ data: { teamId: team.id, userId, role: 'OWNER' } });
      await tx.teamBalance.create({ data: { teamId: team.id, credits: 100 } });
      await tx.teamCreditTransaction.create({
        data: {
          teamId: team.id, operatorUserId: userId, amount: 100,
          type: 'register_grant', creditType: 'regular', balanceAfter: 100,
        },
      });
      await tx.materialFolder.createMany({
        data: DEFAULT_FOLDER_NAMES.map((folderName, i) => ({
          name: folderName, teamId: team.id, userId, isDefault: true, sortOrder: i,
        })),
      });
      return team;
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const existingAfterConflict = await db.team.findFirst({ where: { ownerId: userId, isDefault: true } });
      if (existingAfterConflict) return existingAfterConflict;
    }
    throw err;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && pnpm exec vitest run src/modules/team/team.bootstrap.spec.ts`
Expected: 4 个测试全 PASS。

- [ ] **Step 5: 收敛四条调用路径**

1. `auth.ts:46-77`：钩子整体替换为：

```typescript
      after: async (user) => {
        // 统一 Bootstrap：唯一建团入口（含默认素材文件夹），判据 ownerId+isDefault
        try {
          await bootstrapPersonalTeam(prisma, user.id, user.name);
        } catch (err) {
          console.error(`[databaseHooks] personal team bootstrap failed for ${user.id}`, err);
        }
      },
```

顶部加 `import { bootstrapPersonalTeam } from '../modules/team/team.bootstrap';`，删除 `DEFAULT_FOLDER_NAMES` import（若无其他使用）。

2. `auth.controller.ts` sign-up（:53-65）：删除"Create default material folders"整段 try/catch（Bootstrap 已建）。`/auth/me` 补偿段（:91-102）替换为：

```typescript
      // 补偿个人团队（幂等，含素材文件夹）
      try {
        await bootstrapPersonalTeam(this.prisma, session.user.id, session.user.name);
      } catch { /* 非致命 */ }
```

顶部静态 `import { bootstrapPersonalTeam } from '../modules/team/team.bootstrap';`（纯函数模块，无循环依赖）。

3. `wechat.service.ts`：`prisma.user.create`（:58）之后、素材文件夹 createMany（:70）之前插入 `await bootstrapPersonalTeam(this.prisma as any, user.id, user.name ?? '用户');`，随后**删除**原 materialFolder.createMany 段（:70 起）。**事实依据（不会双调）**：wechat 注册是直接 `prisma.user.create`（:58），不经 Better Auth databaseHooks（钩子只在 Better Auth 自身注册流程触发）——此处的显式调用是**必须且唯一**的 bootstrap 入口，与 auth.ts 钩子无重叠。

4. `team.service.ts` ensureDefaultTeam（:27-59）整个方法体替换为：

```typescript
  async ensureDefaultTeam(userId: string, userName?: string) {
    const name =
      userName ??
      (await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ??
      '用户';
    return bootstrapPersonalTeam(this.prisma, userId, name);
  }
```

顶部加 import。**注意**：旧判据注释（:23-26）一并删除；原行为"已加入他人团队则不补建"被有意改变——个人团队与成员身份解耦（spec §4.1）。

5. `team.util.ts` getOwnerTeamId（:6-21）替换为：

```typescript
export async function getOwnerTeamId(
  db: { team: { findFirst: Function } },
  userId?: string | null,
): Promise<string> {
  if (!userId) throw new BadRequestException('用户未登录')
  const team = await db.team.findFirst({
    where: { ownerId: userId, isDefault: true },
    select: { id: true },
  })
  if (team) return team.id
  throw new BadRequestException('用户暂无个人团队')
}
```

（删除成员团队兜底；调用方的补建路径走 ensureDefaultTeam，本函数只读。同步更新 team.util.spec.ts：删除"成员兜底"用例，新增"无个人团队时抛错"用例。）

6. **auth.ts:92-109 `callbackOnVerification` 整段删除**（手机注册回调只补素材文件夹且不带 teamId——Task 1 后 MaterialFolder.teamId 必填，该段一旦执行即崩；团队+文件夹已统一由 bootstrap 建）。删除 phoneNumber 插件配置中的 `callbackOnVerification` 整个属性，`DEFAULT_FOLDER_NAMES` import 一并清理。

7. auth.ts 钩子 catch 中补 Sentry 上报（项目已接 @sentry/nestjs）：`import * as Sentry from '@sentry/nestjs';` 后 `Sentry.captureException(err);`——bootstrap 失败用户后续会在 getOwnerTeamId 处炸，必须可观测。**先确认 auth.ts 入口处 Sentry 已 init**（main.ts 之外的直连路径），否则 captureException 静默无效。
8. 清理 auth.ts:7 的 `maskPhone` 死 import（callbackOnVerification 删除后无引用）。

**Task 2 验收追加（C4）**：手动/集成验证手机验证码注册（phoneNumber 插件 signUpOnVerification 创建用户）**确实触发** databaseHooks.user.create.after（进而 bootstrap）；若不触发，手机用户在首次 `/auth/me` 之前的任何团队接口会抛「用户暂无个人团队」——此时须在手机注册完成点显式调用 bootstrapPersonalTeam。验证方式：手机号注册新用户 → 立即调需团队接口（如 POST /api/canvases）→ 应成功而非 500。微信路径验收：微信扫码注册新用户 → 查库应有且仅有一条 isDefault=true 团队（Prisma 查库替代 psql，见 memory）。

- [ ] **Step 6: 全量测试并修复受影响用例**

Run: `cd apps/api && pnpm test`
Expected: 全绿。`team.util.spec.ts`、`team.service.spec.ts` 中依赖旧判据（成员兜底/最早团队）的用例按新语义更新——这是有意的行为变更。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): 统一个人团队 Bootstrap——邮箱/手机/微信/ensureDefaultTeam 收敛唯一入口，判据 ownerId+isDefault，并发冲突重查"
```

---

### Task 3: getDefaultTeam + GET /api/team/default + getMyTeams

**Files:**
- Modify: `apps/api/src/modules/team/team.service.ts`（getMyTeams :82-113）
- Modify: `apps/api/src/modules/team/team.controller.ts`
- Test: `apps/api/src/modules/team/team.service.spec.ts`（追加）

- [ ] **Step 1: 写失败测试（team.service.spec.ts 追加）**

```typescript
  describe('getMyTeams（个人项目化）', () => {
    it('返回 isDefault/isOwner，默认团队排第一，默认团队订阅来自 UserSubscription', async () => {
      // mock findMany 返回两个成员关系：默认团队（owner）+ 普通团队（member）
      prisma.teamMember.findMany.mockResolvedValue([
        {
          role: 'MEMBER',
          team: {
            id: 't-team', name: '梦幻团队', ownerId: 'someone-else', isDefault: false,
            balance: { credits: 5, subscriptionCredits: 0 },
            subscriptions: [{ plan: { name: '团队月卡' }, status: 'active', currentPeriodEnd: new Date('2026-09-30') }],
            _count: { members: 3 },
          },
        },
        {
          role: 'OWNER',
          team: {
            id: 't-default', name: 'Alice的团队', ownerId: 'u1', isDefault: true,
            balance: { credits: 100, subscriptionCredits: 50 },
            subscriptions: [],
            _count: { members: 1 },
          },
        },
      ]);
      prisma.userSubscription.findFirst.mockResolvedValue({
        plan: { tier: 'pro' }, status: 'active', currentPeriodEnd: new Date('2026-09-15'),
      });

      const result = await service.getMyTeams('u1');

      expect(result[0]).toMatchObject({ id: 't-default', isDefault: true, isOwner: true });
      expect(result[0].subscription).toMatchObject({ planName: 'pro', status: 'active' });
      expect(result[1]).toMatchObject({ id: 't-team', isDefault: false, isOwner: false });
      expect(result[1].subscription.planName).toBe('团队月卡');
    });
  });
```

（spec 文件中已有的 prisma mock 变量名以现有文件为准，融入现有 describe 结构。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/team/team.service.spec.ts`
Expected: FAIL — 返回结构无 isDefault/isOwner。

- [ ] **Step 3: 实现**

getMyTeams 替换为：

```typescript
  async getMyTeams(userId: string) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      include: {
        team: {
          include: {
            balance: true,
            // Task 1 起 Team 侧为 subscriptions[]（一对多）：取最新 active 一条
            subscriptions: {
              where: { status: 'active' },
              orderBy: { currentPeriodEnd: 'desc' },
              take: 1,
              include: { plan: { select: { name: true } } },
            },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { team: { createdAt: 'asc' } },
    });
    const rows = await Promise.all(memberships.map(async (m) => {
      // 订阅状态分叉：默认团队查个人订阅（UserSubscription），普通团队查 TeamSubscription
      let subscription: { planName: string; status: string; currentPeriodEnd: Date } | null = null;
      if (m.team.isDefault) {
        const personal = await this.prisma.userSubscription.findFirst({
          where: { userId, status: 'active' },
          orderBy: { currentPeriodEnd: 'desc' },
          include: { plan: { select: { tier: true } } },
        });
        if (personal) {
          subscription = { planName: personal.plan.tier, status: personal.status, currentPeriodEnd: personal.currentPeriodEnd };
        }
      } else if (m.team.subscriptions[0]) {
        const teamSub = m.team.subscriptions[0];
        subscription = {
          planName: teamSub.plan.name,
          status: teamSub.status,
          currentPeriodEnd: teamSub.currentPeriodEnd,
        };
      }
      return {
        id: m.team.id,
        name: m.team.name,
        role: m.role,
        status: m.team.status,
        isDefault: m.team.isDefault,
        isOwner: m.team.ownerId === userId,
        memberCount: m.team._count.members,
        createdAt: m.team.createdAt,
        balance: {
          credits: m.team.balance?.credits ?? 0,
          subscriptionCredits: m.team.balance?.subscriptionCredits ?? 0,
        },
        subscription,
      };
    }));
    // 排序规则：默认团队固定第一（前端 ?? teams[0] 缺省不得落到真实团队）
    // → 我创建的（OWNER）优先于我加入的（MEMBER）→ 同级按创建时间升序
    return rows.sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        Number(b.isOwner) - Number(a.isOwner) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }
```

team.controller.ts 新增端点（`mine` 端点旁）：

```typescript
  @SkipTeamGuard()
  @Get('default')
  getDefault(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return this.teams.ensureDefaultTeam(userId).then((t) => ({ id: t.id, name: t.name, isDefault: true }));
  }
```

import `SkipTeamGuard`（team.guard.ts 已导出，参考 mine 端点用法），加注释 `// 无 :id 路由守卫本就放行，显式声明防未来类级守卫变化`。**路由顺序**：`default` 必须声明在 `:id` 通配路由（如 `@Get(':id/balance')`）之前不会冲突（NestJS 按字面量优先），但 `@Get('default')` 与 `@Get('mine')` 同级放置即可。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && pnpm exec vitest run src/modules/team/team.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: 全量测试 + Commit**

```bash
cd apps/api && pnpm test
git add apps/api/src
git commit -m "feat(api): getMyTeams 返回 isDefault/isOwner+默认团队第一+订阅分叉；新增 GET /api/team/default"
```

---

### Task 4: assertNotPersonalTeam 默认团队操作禁令

> 历史文档/spec 中称"六禁"，**实际拦截 12 处入口**：team.service 9 个操作（apply/approve/reject/renameTeam/changeRole/removeMember/setQuota/disbandTeam/transferOwnership）+ team-subscription 2 处（createSubscriptionOrder/completeSubscriptionCallback）+ project-member 1 处（addProjectMember）。

**Files:**
- Modify: `apps/api/src/modules/team/team.service.ts`（apply/approve/reject/renameTeam/changeRole/removeMember/setQuota/disbandTeam/transferOwnership）
- Modify: `apps/api/src/modules/team/team-subscription.service.ts`（createSubscriptionOrder/completeSubscriptionCallback）
- Modify: `apps/api/src/modules/project-member/project-member.service.ts`（addProjectMember）
- Modify: `apps/api/src/modules/team/team.service.ts`（createTeam 补默认素材文件夹）
- Test: `apps/api/src/modules/team/team.service.spec.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```typescript
  describe('默认团队操作禁令（12 处入口）', () => {
    it('apply/reject 对默认团队抛 400', async () => {
      prisma.team.findUnique.mockResolvedValue({ status: 'ACTIVE', joinApproval: true, isDefault: true });
      await expect(service.apply('t1', 'u2')).rejects.toThrow('个人项目不支持');
    });
    it('disbandTeam/transferOwnership 对默认团队拒绝', async () => {
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      prisma.team.findUnique.mockResolvedValue({ status: 'ACTIVE', isDefault: true });
      await expect(service.disbandTeam('t1', 'u1')).rejects.toThrow('个人项目不支持');
      await expect(service.transferOwnership('t1', 'u1', 'u2')).rejects.toThrow('个人项目不支持');
    });
    it('renameTeam/changeRole/removeMember/setQuota 对默认团队拒绝', async () => {
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'OWNER', monthlyQuota: 0 });
      prisma.team.findUnique.mockResolvedValue({ status: 'ACTIVE', isDefault: true });
      await expect(service.renameTeam('t1', 'u1', 'x')).rejects.toThrow('个人项目不支持');
      await expect(service.changeRole('t1', 'u1', 'u2', 'ADMIN')).rejects.toThrow('个人项目不支持');
      await expect(service.removeMember('t1', 'u1', 'u2')).rejects.toThrow('个人项目不支持');
      await expect(service.setQuota('t1', 'u1', 'u2', 100)).rejects.toThrow('个人项目不支持');
    });
  });
```

（mock 结构以现有 spec 为准调整；断言消息统一 `个人项目不支持此操作`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/team/team.service.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

team.service.ts 新增私有方法：

```typescript
  /** 默认团队（个人项目）服务端不变量：操作禁令入口统一拦截 */
  private async assertNotPersonalTeam(teamId: string, action: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { isDefault: true } });
    if (team?.isDefault) throw new BadRequestException(`个人项目不支持此操作：${action}`);
  }
```

在各方法入口（权限校验之前或之后均可，建议紧贴方法首行）插入调用：

- `apply`：`await this.assertNotPersonalTeam(teamId, '申请加入');`
- `approve` / `reject`：`await this.assertNotPersonalTeam(teamId, '审批加入申请');`
- `renameTeam`：`'重命名'`；`changeRole`：`'调整角色'`；`removeMember`：`'移除成员'`；`setQuota`：`'调整配额'`
- `disbandTeam`：`'解散'`；`transferOwnership`：`'转让'`

team-subscription.service.ts：

- `createSubscriptionOrder`（:15）入口加：

```typescript
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { isDefault: true } });
    if (team?.isDefault) throw new BadRequestException('个人项目不支持团队套餐订阅');
```

- `completeSubscriptionCallback`（:60 取得 teamId 后）加同样拦截（回调兜底入口）。

project-member.service.ts `addProjectMember`：经 project.teamId 查 team.isDefault，为真抛 `BadRequestException('个人项目画布不支持添加协作者')`（project 获取方式参考该文件现有代码）。

createTeam（team.service.ts:62-80）事务内 `teamMember.create` 之后追加：

```typescript
      await tx.materialFolder.createMany({
        data: DEFAULT_FOLDER_NAMES.map((name, i) => ({
          name, teamId: team.id, userId, isDefault: true, sortOrder: i,
        })),
      });
```

（顶部 import DEFAULT_FOLDER_NAMES。）

- [ ] **Step 4: 跑测试确认通过 + 更新受影响既有用例**

Run: `cd apps/api && pnpm test`
Expected: 全绿（team-subscription/team-recharge/project-member 既有 spec 若构造的团队未设 isDefault，Prisma 默认 false，应不受影响；若 mock 显式返回 undefined 也为 falsy——按需补 mock 字段）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): 默认团队操作禁令（12 处入口）服务端不变量 assertNotPersonalTeam + createTeam 初始化素材文件夹"
```

---

### Task 5: canvas/project 团队化

**Files:**
- Modify: `apps/api/src/modules/canvas/canvas.service.ts`（create/save/nextUntitledName）
- Modify: `apps/api/src/modules/canvas/canvas.controller.ts`
- Modify: `apps/api/src/modules/project/project.service.ts`（create/getProjectFolder/cleanDrafts）
- Modify: `apps/api/src/modules/project/project.controller.ts`
- Test: `apps/api/src/modules/canvas/canvas.service.spec.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```typescript
  describe('团队化', () => {
    it('create 传 teamId 时挂指定团队并校验成员', async () => {
      prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
      prisma.team.findFirst.mockResolvedValue({ id: 't-team', isDefault: false });
      prisma.template.findMany.mockResolvedValue([]);
      prisma.canvasProject.create.mockResolvedValue({ id: 'p1', teamId: 't-team' });
      const result = await service.create('u1', undefined, undefined, 't-team');
      expect(prisma.canvasProject.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ teamId: 't-team' }) }),
      );
      expect(result.teamId).toBe('t-team');
    });
    it('create 传非成员 teamId 时抛 403', async () => {
      prisma.teamMember.findUnique.mockResolvedValue(null);
      await expect(service.create('u1', undefined, undefined, 't-team')).rejects.toThrow('非团队成员');
    });
    it('save 不再拒绝团队成员（无 creator-only）', async () => {
      // perm.assertEditor 通过 + project.userId 为他人 → 保存成功不抛
      perm.assertEditor.mockResolvedValue(undefined);
      prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', userId: 'other-user', teamId: 't-team' });
      projectService.findById.mockResolvedValue({ id: 'p1', userId: 'other-user', teamId: 't-team' });
      // readCanvas/collabDoc mock 返回空画布（按现有 spec 结构）
      await expect(service.save('p1', { name: 'x' }, 'u2', new Uint8Array())).resolves.toBeDefined();
    });
  });
```

（变量名以现有 spec 文件为准。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/canvas/canvas.service.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

canvas.service.ts：

1. `save`（:63-68）：**删除** :66-68 三行 creator-only 判断（`if (project.userId !== null && ...`），assertEditor 为唯一权威。
2. `create`（:23，现状签名 `(name: string, folderId: string | null, userId: string)`）**保持参数顺序、追加尾参** `teamId?: string`（最小 diff，现有调用点不动）：

```typescript
  async create(name: string, folderId: string | null, userId: string, teamId?: string) {
    let teamIdResolved: string;
    if (teamId) {
      const member = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId } },
      });
      if (!member) throw new ForbiddenException('非团队成员');
      teamIdResolved = teamId;
    } else {
      teamIdResolved = (await this.teamService.ensureDefaultTeam(userId)).id;
    }
    if (folderId) {
      const folder = await this.prisma.folder.findFirst({ where: { id: folderId, teamId: teamIdResolved } });
      if (!folder) throw new BadRequestException('目标文件夹不存在');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      let finalName = name;
      if (!name?.trim()) {
        // advisory lock 与 nextUntitledName 必须同时切 teamId 维度（漏一处即编号竞态重名）
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'canvas_untitled:' + teamIdResolved}))`;
        finalName = await CanvasService.nextUntitledName(tx, teamIdResolved);
      }
      const project = await tx.canvasProject.create({
        data: { name: finalName, userId, teamId: teamIdResolved },
      });
      const template = await tx.template.create({
        data: { name: finalName, userId, teamId: teamIdResolved, projectId: project.id, folderId, status: 'DRAFT', isPublic: false },
      });
      return { templateId: template.id, projectId: project.id, name: finalName };
    });
    this.templateService.clearCache();
    if (folderId) await this.folderService.touch([folderId]);
    return result;
  }
```

3. `nextUntitledName`（:53-59）改 teamId 维度：

```typescript
  private static async nextUntitledName(db: { template: { findMany: Function } }, teamId: string): Promise<string> {
    const templates = await db.template.findMany({ where: { teamId }, select: { name: true } });
    // 余下 max 解析逻辑不变
  }
```

4. **save 首存分支补 teamId（P1-2）**：save 内 template.create（:106-117）数据加 `teamId: project.teamId`；并发回退分支（:120-135 的 update）无需加（行已存在）。
5. `getNextUntitledName`（:49-50）public 入口同步切 teamId 维度（读签名现状，默认解析默认团队）。

project.service.ts：

6. `create`（:33，现状 `(name, userId?, nodes?, edges?)`）**追加第 5 参 `teamId?: string`**（不占位第 3/4 位），同 canvas 的 team 解析模式（校验成员/默认回落），project 数据写 teamId。
7. `getProjectFolder`（`where: { id, userId }`）改 `where: { id, teamId }`（teamId 来自 project 解析或参数，读该函数现状后最小改动）；对应 controller 端点补团队成员校验。
8. **cleanDrafts 保留 userId 维度不动（P1-5）**：草稿=未存成模板的进行中工作，A 触发清理不得删同团队 B 正在编辑的草稿——维持"本人创建"语义，本 Task 不改此函数（从原计划的改动清单中移除）。

controller 层（canvas.controller.ts / project.controller.ts）：body/query 透传 `teamId`（`@Body() body: { name?: string; folderId?: string; teamId?: string }`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && pnpm test`
Expected: 全绿（更新受影响既有用例：nextUntitledName mock 从 template.userId 查询改为 teamId 查询）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): canvas/project 团队化——save 删 creator-only 残留、create 接收 teamId+成员校验、nextUntitledName/cleanDrafts/getProjectFolder 团队维度"
```

---

### Task 6: works folder + template 团队化

**Files:**
- Modify: `apps/api/src/modules/folder/folder.service.ts`（list/create/rename/remove）
- Modify: `apps/api/src/modules/folder/folder.controller.ts`
- Modify: `apps/api/src/modules/template/template.service.ts`（findMany/getTemplate/update/delete/import）
- Modify: `apps/api/src/modules/template/template.controller.ts`
- Test: `apps/api/src/modules/folder/folder.service.spec.ts`、`apps/api/src/modules/template/template.service.spec.ts`（追加）

- [ ] **Step 1: 写失败测试（folder.service.spec.ts 追加，模式同前）**

```typescript
  it('list 按 teamId 查询（队友可见，平铺全量——前端自行按 parentId 组树/过滤）', async () => {
    prisma.folder.findMany.mockResolvedValue([]);
    await service.list('u1', 't-team');
    expect(prisma.folder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ teamId: 't-team' }),
    }));
  });
  it('create 校验 parent.teamId 一致，防跨团队挂载', async () => {
    prisma.folder.findFirst.mockResolvedValue({ id: 'f1', teamId: 't-other' });
    await expect(service.create({ name: 'x', parentId: 'f1' }, 'u1', 't-team')).rejects.toThrow('跨团队');
  });
```

template.service.spec.ts 追加：

```typescript
  it('findMany 传 teamId 时按本表 teamId 直查（不走 project 反查、不含 userId 兜底）', async () => {
    prisma.template.findMany.mockResolvedValue([]);
    await service.findMany({ type: 'my', teamId: 't-team' }, 'u1');
    expect(prisma.template.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 't-team' },
    }));
  });
  it('getTemplate 团队模板对团队成员放行（teamMember 直查）', async () => {
    prisma.template.findUnique.mockResolvedValue({ id: 'tp1', userId: 'creator', isPublic: false, teamId: 't-team', projectId: 'p1' });
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    const result = await service.getTemplate('tp1', 'teammate');
    expect(result.isOwner).toBe(false);
    expect(perm.resolve).not.toHaveBeenCalled(); // 成员已放行，无需再走项目权限链
  });
  it('getTemplate 非团队成员但项目协作者可打开（OR 关系）', async () => {
    prisma.template.findUnique.mockResolvedValue({ id: 'tp1', userId: 'creator', isPublic: false, teamId: 't-team', projectId: 'p1' });
    prisma.teamMember.findUnique.mockResolvedValue(null); // 非团队成员
    perm.resolve.mockResolvedValue({ role: 'PROJECT_EDITOR' }); // 但是项目显式协作者
    const result = await service.getTemplate('tp1', 'outside-collaborator');
    expect(result.isOwner).toBe(false);
  });
  it('getTemplate 既非团队成员又非项目协作者 → 403', async () => {
    prisma.template.findUnique.mockResolvedValue({ id: 'tp1', userId: 'creator', isPublic: false, teamId: 't-team', projectId: 'p1' });
    prisma.teamMember.findUnique.mockResolvedValue(null);
    perm.resolve.mockResolvedValue(null);
    await expect(service.getTemplate('tp1', 'stranger')).rejects.toThrow(ForbiddenException);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/folder src/modules/template`
Expected: FAIL。

- [ ] **Step 3: 实现**

**先建统一成员自证（P0-3 全局不变量）**——team.util.ts 追加：

```typescript
export async function assertTeamMember(
  db: { teamMember: { findUnique: Function } },
  teamId: string,
  userId: string,
): Promise<void> {
  const member = await db.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!member) throw new ForbiddenException('非团队成员');
}
```

folder.service.ts：**每个接收外部 teamId 的入口先 `assertTeamMember(this.prisma, teamId, userId)`**；随后所有 `where: { userId ... }` / `{ id, userId }` 的权限语义改 teamId 维度（userId 仅在 create 的 data 中作为创建人保留）；`list(userId, teamId?)`——不传 teamId 时解析 ensureDefaultTeam；`create(dto, userId, teamId?)` 同理；create/rename 涉及 parentId 时校验 `parent.teamId === teamId` 否则抛 `BadRequestException('不能跨团队挂载文件夹')`；**现状已有的同名预检查保留（create :31-32 / rename :38-41 抛 `已存在同名文件夹`），仅把预检查 where 的 userId 切 teamId——partial unique index 只是并发兜底，友好报错走预检查**；`remove` 删除父文件夹前消解同名冲突（把将升入 root 的子文件夹中与 root 现有同名者重命名为 `${name} (1)` 递增后缀）。controller 透传 teamId（query/body）。

template.service.ts：

- `findMany`（:54-67 区域）加 teamId 分支：有 teamId 时 **`where: { teamId }` 直查本表字段**（P1-4——不走 `project: { teamId }` 反查：Template 自带 teamId 且带索引，反查多一次 join 且漏掉本团队 projectId=null 的模板）；无 teamId 且 type='my' 时 OR 中 teamId 换成 `ensureDefaultTeam(userId).id` 的精确值；official/community 分支按现状（:54/:66）不动。
- `getTemplate`（:105-111）：

```typescript
  async getTemplate(id: string, userId: string) {
    const template = await this.findById(id);
    if (!template.isPublic && template.userId !== userId) {
      // 鉴权为 OR 关系：团队成员 OR 项目显式协作者任一通过即放行。
      // 不得写成 if-else if 互斥——普通团队允许 addProjectMember 添加外部协作者（Task 4 只拦默认团队），
      // 互斥写法会让非团队成员的项目协作者永远打不开项目内模板。
      let allowed = false;
      if (template.teamId) {
        const member = await this.prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: template.teamId, userId } },
        });
        if (member) allowed = true;
      }
      if (!allowed && template.projectId) {
        const perm = await this.perm.resolve(template.projectId, userId);
        if (perm) allowed = true;
      }
      if (!allowed) throw new ForbiddenException('无权访问此模板');
    }
    return { ...template, isOwner: template.userId === userId };
  }
```

（断言 TeamMember 用 findUnique 直查而非 assertTeamMember——此处需要"成员资格作为 OR 条件之一"而非"不通过即抛"，语义不同。）

- `update`（:113）：creator 或 `assertTeamMember(template.teamId)` / `perm.assertEditor` 任一通过；update 中 folderId 校验 `findFirst({ where: { id: input.folderId, teamId: template.teamId } })`。
- **`delete`（:146）权限收紧（D1 简化版）**：EDITOR 不足——template.delete 会级联删 canvasProject，团队成员 EDITOR 可删他人整个工程。`perm.resolve` 的 PROJECT_OWNER 已覆盖 创建者/团队 OWNER/显式项目 OWNER 三种情形（project-permission.service:21,27 解析链），无需单查 teamMember（省一次查询）：

```typescript
  async delete(id: string, userId: string) {
    const template = await this.findById(id);
    if (template.userId !== userId) {
      const perm = template.projectId ? await this.perm.resolve(template.projectId, userId) : null;
      if (perm?.role !== 'PROJECT_OWNER') {
        throw new ForbiddenException('仅创建者或项目 OWNER 可删除');
      }
    }
    // 余下删除事务不变
  }
```

- `import`（:163）：解析目标 teamId（参数或默认团队，**先 assertTeamMember**）透传给 projectService.create；**重名循环（:181-187）按 userId 查切 teamId**（否则队友导入同模板产生错乱编号）；**注意 import 路径不创建 Template**（projectService.create 只建 Project+ProjectMember，首个 Template 由 canvas.save 首存创建，Task 5 已覆盖 teamId 写入——不要在此找 Template 写入点）。
- controller：query/body 透传 teamId；**每个外部 teamId 入口配一条「他团队成员猜 ID → 403」反例测试**。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd apps/api && pnpm test`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): works folder/template 团队化——teamId 维度查询/跨团队挂载防护/Template 鉴权走 ProjectPermissionService/import 透传"
```

---

### Task 7: media/material-library/storage 团队化

**Files:**
- Modify: `apps/api/src/modules/material-library/services/material.service.ts`、`folder.service.ts`（素材文件夹）
- Modify: `apps/api/src/modules/media/media.service.ts`（getMediaUrl、缓存 key）
- Modify: `apps/api/src/modules/storage/storage.service.ts`（presign 三级回落、confirmUpload）
- Modify: `apps/api/src/modules/storage/dto/presign.dto.ts`（加 projectId）
- Test: `apps/api/src/modules/storage/storage.service.spec.ts`（追加）、material-library 两 spec（追加）

- [ ] **Step 1: 写失败测试（storage.service.spec.ts 追加）**

```typescript
  it('presign 三级回落①：projectId → project.teamId + editor 校验', async () => {
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1', teamId: 't-team' });
    // perm/assertMember mock 通过
    await service.presignUpload('u1', { projectId: 'p1', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' });
    expect(prisma.media.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-team' }),
    }));
  });
  it('presign 三级回落②：无 projectId 带 teamId → assertMember 放行', async () => {
    quota.assertMember.mockResolvedValue(undefined);
    await service.presignUpload('u1', { teamId: 't-team', fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' });
    expect(quota.assertMember).toHaveBeenCalledWith('t-team', 'u1');
  });
  it('presign 三级回落③：都无 → 默认团队', async () => {
    // getOwnerTeamId 返回 t-default
    await service.presignUpload('u1', { fileName: 'a.png', fileType: 'image/png', fileSize: 100, type: 'image' });
    expect(prisma.media.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-default' }),
    }));
  });
  it('confirmUpload 团队成员可确认他人上传', async () => {
    prisma.media.findFirst.mockResolvedValue({ id: 'm1', userId: 'other', teamId: 't-team' });
    prisma.teamMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    minio.statObject.mockResolvedValue({ ContentLength: 100 });
    await service.confirmUpload('u1', { fileId: 'm1', key: 'k', fileSize: 100 });
    expect(prisma.media.update).toHaveBeenCalled();
  });
```

material/folder spec 追加团队维度用例（模式同 Task 6：`where` 断言含 `teamId`、团队成员放行）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/storage src/modules/material-library src/modules/media`
Expected: FAIL。

- [ ] **Step 3: 实现**

storage.service.ts `presignUpload`（:17-21）替换为：

```typescript
  async presignUpload(userId: string, dto: PresignUploadDto) {
    // 三级回落：projectId（后端解析+editor 校验）> teamId（assertMember）> 默认团队
    let teamId: string;
    if (dto.projectId) {
      const project = await this.prisma.canvasProject.findUnique({ where: { id: dto.projectId }, select: { teamId: true } });
      if (!project) throw new BadRequestException('项目不存在');
      await this.quota.assertMember(project.teamId, userId);
      teamId = project.teamId;
    } else if (dto.teamId) {
      await this.quota.assertMember(dto.teamId, userId);
      teamId = dto.teamId;
    } else {
      teamId = await getOwnerTeamId(this.prisma, userId);
    }
    await this.quota.assertCanUpload(teamId, dto.fileSize);
    // 余下不变（key/media.create 用上面 teamId）
  }
```

presign.dto.ts 加 `projectId?: string;`。confirmUpload（:60-67）改：

```typescript
    const media = await this.prisma.media.findFirst({ where: { id: dto.fileId } });
    if (!media) throw new BadRequestException('文件记录不存在');
    if (media.userId !== userId) {
      const member = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: media.teamId, userId } },
      });
      if (!member) throw new BadRequestException('无权操作此文件');
    }
```

material-library 两个 service（**粒度细化，B5——比 works folder 复杂，逐方法改造**）：

- **懒创建（folder.service:30-53 findAllByUserId）**：空时 createMany 默认文件夹**不带 teamId，Task 1 后直接 NOT NULL 崩**——改为按 teamId 查、按 teamId 建（`findAllByTeamId(teamId, userId)` 或加参；调用方无 teamId 时先解析默认团队）
- **删父提 root（:73-86 remove 事务）**：`:78-81` 把子文件夹 parentId 置 null 升入 root 域，会撞 Task 1 的 `material_folder_team_root_name_unique`——**删除前同名消解**（同 Task 6 works folder 模式：将升入 root 的子文件夹与 root 现有同名者重命名 `(1)` 递增）
- **移动越权（material.service moveFile/moveFiles/moveFolder、folder.service:184 moveFolder）**：必须校验目标文件夹 `teamId === 源 teamId`，否则 A 团队文件挂进 B 团队文件夹（数据越权）；**移动同名预检查**——moveFolder 后与目标父文件夹下现有同名文件夹会撞 `material_folder_team_parent_name_unique`，移动前查同名并抛 `BadRequestException('目标目录下已存在同名文件夹')`（与 Task 6 预检查同模式）
- **递归/排序私有方法**：hasFilesRecursive/isDescendant/getFolderDepth 及 moveFolder 的 siblings sortOrder 重排（:213）全部 userId where 切 teamId，否则层级断裂、排序错乱
- 总量参照：material.service 16 处 userId / 0 处 teamId，7 个公开方法逐一改造；每个接收外部 teamId 的入口先 `assertTeamMember`
- 「不存在」与「无权」统一报错文案（防 fileId/folderId 存在性探测）

media.service `getMediaUrl`（:14-37）**鉴权前置重构（B6——现状 :17-20 缓存命中直接返回，key 换 teamId 后非成员可命中队友预热缓存拿 URL）**：

```typescript
  async getMediaUrl(fileId: string, userId: string): Promise<string> {
    // 1. 先鉴权：查 media + 团队成员校验（缓存命中不得跳过）
    const media = await this.prisma.media.findUnique({ where: { id: fileId } });
    if (!media) throw new NotFoundException('媒体资源不存在');
    if (media.userId !== userId) {
      await assertTeamMember(this.prisma, media.teamId, userId); // 非 creator 走团队校验，不通过即 403
    }
    // 2. 鉴权通过后再读缓存（key 团队维度：同团队共享预热）
    const cacheKey = `media:url:${media.teamId}:${fileId}`;
    const cachedUrl = await this.redis.get(cacheKey);
    if (cachedUrl) return cachedUrl;
    // 3. 生成预签名 URL 并写缓存（14min TTL 不变）
    const url = await this.minio.generatePresignedGetUrl(media.key, 900);
    await this.redis.set(cacheKey, url, 'EX', 840);
    return url;
  }
```

**必配反例测试**：非成员命中已预热缓存 → 403（先 mock redis.get 返回 URL，断言仍抛 ForbiddenException）。（storage 的 minio buildKey(type,userId) 按上传者命名保留，与此缓存 key 是两回事。）对应 controller 透传 teamId，**每个外部 teamId 入口配一条「他团队成员 → 403」反例测试**。

**quota.assertMember 收敛（防逻辑漂移）**：`storage-quota.service.ts:51-56` 的 assertMember 与 Task 6 新建的 `team.util.ts assertTeamMember` 逐字相同——保留 service 方法签名（现有注入与 mock 不动），**方法体改为一行委托**：

```typescript
  /** 素材直传归属校验（D4）：用户须为 teamId 成员（规范实现在 team.util.ts，此处委托防双实现漂移） */
  async assertMember(teamId: string, userId: string): Promise<void> {
    await assertTeamMember(this.prisma, teamId, userId);
  }
```

（顶部 import assertTeamMember；storage-quota.service.spec.ts 既有用例不改——mock prisma 层，委托后行为不变。）

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd apps/api && pnpm test`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): media/material/storage 团队化——presign 三级回落、confirmUpload/getMediaUrl/素材库 teamId 鉴权、缓存 key 团队维度"
```

---

### Task 8: 异步链路 getOwnerTeamId 收敛 + task/storyboard 团队化

（表述澄清：实际为 **6 处 processor/consumer 收敛** + storage.service:21 ——后者是 presign 三级回落的第③级（无 project 上下文的全局上传归个人团队），**属正确设计必须保留**，Task 7 已覆盖，本 Task 不得误删。）

**Files:**
- Modify: `apps/api/src/modules/ai-download/ai-download.processor.ts:99`
- Modify: `apps/api/src/modules/ai-image-edit/ai-image-edit.processor.ts:129`
- Modify: `apps/api/src/modules/ai-image-edit/lighting/lighting.consumer.ts:129`、`lighting.service.ts`（getTask/幂等）
- Modify: `apps/api/src/modules/media-process/media-process.service.ts:175`
- Modify: `apps/api/src/modules/storyboard/stitch.consumer.ts:91`、`storyboard.controller.ts`（assertEditor）
- Modify: `apps/api/src/modules/execution/video-trim.processor.ts:102`、`video-trim.service.ts`、`video-separate.service.ts`（validateFileOwnership/状态查询/幂等）

- [ ] **Step 1: 写失败测试（各模块 spec 追加，以 ai-download 为例）**

```typescript
  it('生成物归属 = project.teamId（非 getOwnerTeamId 反推）', async () => {
    // processor 上下文已含 project.teamId = 't-team'（配额校验已查出）
    prisma.media.create.mockResolvedValue({ id: 'm1' });
    await processor.process({ data: { projectId: 'p1', userId: 'u1', /* ... */ } } as any);
    expect(prisma.media.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-team' }),
    }));
    // 不再调用 team.findFirst 反推
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
  });
```

storyboard.controller.spec 追加：

```typescript
  it('stitch 提交前校验 assertEditor', async () => {
    perm.assertEditor.mockResolvedValue(undefined);
    await controller.stitch({ params: { id: 'p1' }, body: {} } as any, 'u1');
    expect(perm.assertEditor).toHaveBeenCalledWith('p1', 'u1');
  });
```

video-trim/lighting/video-separate spec 追加团队鉴权用例（`getTask(teamId 校验)`、幂等键 `teamId+nodeId+params`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/ai-download src/modules/ai-image-edit src/modules/media-process src/modules/storyboard src/modules/execution`
Expected: FAIL。

- [ ] **Step 3: 实现（统一模式）**

7 处 `teamId: await getOwnerTeamId(this.prisma, userId)` 逐个替换：

- **ai-download.processor:99**：复用配额校验已查出的 `project.teamId`（:72-75 已有 quotaTeamId）——**TS 收窄（B7）**：quotaTeamId 类型 `string | undefined`，Media.teamId 非空，strict 下 `teamId: quotaTeamId` 编译不过；且 project 缺失时不得静默回落个人团队。改法：

```typescript
    if (!quotaTeamId) {
      // project 缺失/解析失败：job 已无意义，直接 failed 不再 create Media
      Sentry.captureException(new Error(`ai-download: project team missing for job ${job.id}`));
      return { status: 'failed', reason: 'PROJECT_TEAM_MISSING' };
    }
    // 此后 quotaTeamId 收窄为 string，再 media.create({ data: { teamId: quotaTeamId, ... } })
```

（**新 failed 分支必须带 Sentry.captureException**——已核实 Task 8 涉及的 6 个 processor 现状均无 Sentry（grep 零命中），teamId 缺失导致的 failed 若无可观测性会成为静默黑洞；只在新分支加，对齐 payment-success.processor:163 模式，不改各文件既有 catch。）

- **ai-image-edit.processor:129 / lighting.consumer:129 / media-process.service:175 / stitch.consumer:91 / video-trim.processor:102**：同模式——从上下文 project 解析 teamId 并做空值收窄（缺失即 failed，不回落）；确无 project 上下文的保留 `getOwnerTeamId`（Task 2 后已是 isDefault 精确判据）
- 删除各文件不再使用的 `getOwnerTeamId` import
- **幂等维度改造注意（D6）**：lighting/video-trim/video-separate 的幂等查重键切 `teamId + nodeId + params` 时，**进行中并发锁（如 `user:video-separate:${userId}`）保留 userId 维度**（避免队友相互阻塞）；lighting 的 hashParams 若用 JSON.stringify，需**深排序键**（嵌套对象键序不同会击穿幂等）——实现一个 stableStringify 递归排序

任务查询服务（lighting.service getTask / video-trim.service / video-separate.service）：

- 状态查询：`findFirst({ where: { id } })` 后校验 `teamMember.findUnique({ where: { teamId_userId: { teamId: task.teamId, userId } } })`，非成员 403
- `validateFileOwnership`：media 按 `media.teamId` 团队成员校验（同 Task 7 confirmUpload 模式）
- 幂等维度：`userId + nodeId` → `teamId + nodeId + params 摘要`（读各现状后最小改造，params 摘要 = JSON.stringify 排序键后哈希或直接字符串拼接）

storyboard.controller：stitch 与 /status 入口加 `await this.perm.assertEditor(projectId, userId)`（status 至少 `resolve` 非 null 校验）。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd apps/api && pnpm test`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): 异步生成物归属收敛 project.teamId（7 处）+ task/storyboard 团队鉴权与幂等维度"
```

---

### Task 9: 个人订阅 4 写入点迁移默认团队

**Files:**
- Modify: `apps/api/src/modules/subscription/task/payment-success.processor.ts`（:117,:125,:137）
- Modify: `apps/api/src/modules/subscription/task/grant-credit.processor.ts`（:44,:49）
- Modify: `apps/api/src/modules/subscription/task/expire-subscription.processor.ts`（:38,:43）
- Modify: `apps/api/src/modules/subscription/admin/admin-subscription.service.ts`（:47,:51,:67,:70,:74,:81,:84,:90）
- Test: 上述四文件的 `.spec.ts`（更新断言）

- [ ] **Step 1: 更新测试为新账本断言（先红）**

四 spec 中所有 `userBalance.update/updateMany/upsert` 与 `creditTransaction.create` 的断言替换为 `teamBalance` / `teamCreditTransaction` 断言。以 grant-credit 为例：

```typescript
  it('周期发放写入默认团队 TeamBalance（FOR UPDATE + 先清零流水再发放流水）', async () => {
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true }); // getDefaultTeam
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', credits: 10, subscriptionCredits: 20, version: 1 });
    await processor.process({ data: { subscriptionId: 's1' } } as any);
    expect(prisma.$queryRaw).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.arrayContaining(['t-default']) }), // SELECT ... FOR UPDATE
    );
    // 旧池剩余 20 > 0：先清零 + expire_clear 流水（覆盖不滚存 + 账务完整）
    expect(prisma.teamBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 't-default' },
      data: { subscriptionCredits: 0 },
    }));
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-default', amount: -20, type: 'expire_clear', balanceAfter: 0 }),
    }));
    // 再设值发放 + subscription_grant 流水（非 increment）
    expect(prisma.teamBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 't-default' },
      data: { subscriptionCredits: 100 },
    }));
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 't-default', amount: 100, type: 'subscription_grant', creditType: 'subscription', balanceAfter: 100 }),
    }));
  });
  it('旧池为 0 时跳过清零段（无空流水）', async () => {
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.team.findFirst.mockResolvedValue({ id: 't-default', isDefault: true });
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', credits: 0, subscriptionCredits: 0 });
    await processor.process({ data: { subscriptionId: 's1' } } as any);
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledTimes(1); // 仅发放流水
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'subscription_grant' }),
    }));
  });
```

expire spec 追加口径用例：

```typescript
  it('过期清零 amount = 实时剩余订阅积分（非 totalCredits-consumedCredits 推算）', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ teamId: 't-default', subscriptionCredits: 37 });
    await processor.process({ data: {} } as any);
    expect(prisma.teamCreditTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: -37, balanceAfter: 0 }),
    }));
    // TeamBalance.teamId @unique：统一用 update（与实现模板一致，勿用 updateMany 断言）
    expect(prisma.teamBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 't-default' },
      data: { subscriptionCredits: 0 },
    }));
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/subscription`
Expected: FAIL。

- [ ] **Step 3: 实现（四文件统一模式）**

每个写入点按**完整序列**替换（对齐团队侧 team-subscription.service:67-89 口径——发放前先清旧池，防窗口续费/升级时旧池残留与新积分叠加多发）。**账务完整性铁律：凡 `subscriptionCredits` 设值前旧池 `before > 0`，必须先写清零流水再写发放流水——余额每笔变动都有流水可审计，禁止无声覆盖**（评审第 3 点：原 clearBeforeGrant=false + 直接设值的组合会让周期发放的旧池剩余无声消失）：

```typescript
        // 统一模式：锁默认团队 TeamBalance 行 → 实时读 → 旧池有剩余必先清零+流水 → 发放+流水
        const personalTeam = await tx.team.findFirst({ where: { ownerId: userId, isDefault: true } });
        if (!personalTeam) throw new Error(`personal team missing for ${userId}`);
        await tx.$queryRaw`SELECT * FROM "TeamBalance" WHERE "teamId" = ${personalTeam.id} FOR UPDATE`;
        let bal = await tx.teamBalance.findUnique({ where: { teamId: personalTeam.id } });
        if (!bal) {
          // bootstrap 失败被吞掉的用户兜底：补建账本行，不裸 update（P2025）
          bal = await tx.teamBalance.create({ data: { teamId: personalTeam.id, credits: 0 } });
        }
        const before = bal.subscriptionCredits ?? 0;
        if (before > 0) {
          // 清零必有流水（clearType 按场景：'upgrade_clear' | 'expire_clear'）
          await tx.teamBalance.update({
            where: { teamId: personalTeam.id },
            data: { subscriptionCredits: 0 },
          });
          await tx.teamCreditTransaction.create({
            data: {
              teamId: personalTeam.id, operatorUserId: userId,
              amount: -before, type: clearType, creditType: 'subscription',
              referenceId: sub.id, referenceType: 'subscription', balanceAfter: 0,
            },
          });
        }
        await tx.teamBalance.update({
          where: { teamId: personalTeam.id },
          data: { subscriptionCredits: grantAmount }, // 清零后直接设为目标值（非 increment 推算）
        });
        await tx.teamCreditTransaction.create({
          data: {
            teamId: personalTeam.id,
            operatorUserId: userId,
            amount: grantAmount,
            type: 'subscription_grant',
            creditType: 'subscription',
            referenceId: sub.id,
            referenceType: 'subscription',
            balanceAfter: grantAmount, // 锁内实时值
          },
        });
```

各文件差异点：
- payment-success（:117,:137 两个写入点 + :125 流水）：新购发放 `plan.monthlyCredits`（before 必为 0，清零段自然跳过）；**升级分支 `clearType='upgrade_clear'`**（现状 :117 先清 :137 再发的语义保留，改为写流水+实时值）；**renewal 类型（:69-121 现无分支）定义 `clearType='expire_clear'`**（续费=新周期，先清旧池再发，与团队侧续费口径一致）
- grant-credit（:44,:49）：周期发放 `clearType='expire_clear'`（周期覆盖清零同样有流水）；**顺带修复既有分页 bug**：现状 :17-30 用 skip 分页+循环内 continue，被跳过记录导致后续页错位漏发——重写为 cursor 分页（`where: { id: { gt: lastId } }, orderBy: { id: 'asc' }, take: N`，处理完记录 lastId）
- expire（:38,:43）：`clearType='expire_clear'`、无发放段（`grantAmount=0` 时跳过发放）、`amount:-before`（实时剩余，禁 consumedCredits 推算）；**同款分页漏扫 bug 一并修**：现状 :14-28 与 grant-credit 相同的 skip 分页 + :28 状态复查 continue——漏过期的后果是订阅积分不清零、active 不关闭，比漏发更严重，同模式改 cursor 分页
- admin-subscription（:47,:67,:81 三处调整）：手工加/扣积分——type 用 `admin_grant`（加）/`admin_clear`（扣）、amount=±实际调整量、balanceAfter 用调整后实时值（regular 池操作 balanceAfter=credits）
- **paidAmount 单位统一为分（D5 顺带修）**：payment-success :78/:104 两处 `paidAmount: order.payableAmount! / 100` **去掉 `/100` 直接存分**（TeamSubscription.paidAmount 现状即存分 `order.amountFen`，同名不同单位是展示层地雷）；pricing.service 折算公式读同一库值自洽不受影响；对应 spec 断言同步改（subscription.service.ts:137/:288 的元单位写入随 Task 12 死链路删除一并消失）

**账务语义决策（C3，用户 2026-08-29 拍板确认）**：现状个人订阅周期发放用 increment（积分滚存），统一模式改为**周期覆盖不滚存**（清旧发新+完整流水，对齐团队侧 team-subscription 覆盖式口径）——这是有意的账务语义变更，个人订阅积分每周期不结转（本月剩 50 下月发 100 → 余额 100）。

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd apps/api && pnpm test`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): 个人订阅 4 写入点迁移默认团队 TeamBalance——FOR UPDATE 行锁/实时值流水/双池口径/清零不再推算"
```

---

### Task 10: TeamSubscription 回调修复 + 充值订单列表端点

**Files:**
- Modify: `apps/api/src/modules/team/team-subscription.service.ts`（completeSubscriptionCallback :92 前 + getLimits :163-175 个人订阅回退）
- Modify: `apps/api/src/modules/team/team.controller.ts`（GET :id/recharge/orders）
- Modify: `apps/api/src/modules/team/team-recharge.service.ts`（新增 listOrders）
- Test: `team-subscription.service.spec.ts`、`team.controller` 相关（追加）

- [ ] **Step 1: 写失败测试（team-subscription.service.spec.ts 追加）**

```typescript
  it('回调 create 前先关闭旧 active 订阅（到期未过期 job 窗口续费）', async () => {
    prisma.teamRechargeOrder.findUnique.mockResolvedValue({
      id: 'o1', outTradeNo: 'TEAM1', teamId: 't1', payerUserId: 'u1', amountFen: 3000,
      credits: 300, kind: 'subscription', planId: 'plan1', status: 'PENDING',
    });
    prisma.teamPlan.findUnique.mockResolvedValue({ id: 'plan1', monthlyCredits: 300, isActive: true });
    prisma.user.findUnique.mockResolvedValue({ name: 'A' });
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.teamBalance.findUnique.mockResolvedValue({ subscriptionCredits: 50 });
    prisma.teamSubscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.teamSubscription.create.mockResolvedValue({ id: 's-new' });
    prisma.teamRechargeOrder.updateMany.mockResolvedValue({ count: 1 });
    audit.logTx.mockResolvedValue(undefined);

    const result = await service.completeSubscriptionCallback({
      outTradeNo: 'TEAM1', appid: 'a', mchid: 'm', amount: 3000, tradeState: 'SUCCESS',
    });
    expect(result.code).toBe('SUCCESS');
    // 先关旧（updateMany 在 create 之前调用）
    const closeIdx = prisma.teamSubscription.updateMany.mock.invocationCallOrder[0];
    const createIdx = prisma.teamSubscription.create.mock.invocationCallOrder[0];
    expect(closeIdx).toBeLessThan(createIdx);
    expect(prisma.teamSubscription.updateMany).toHaveBeenCalledWith({
      where: { teamId: 't1', status: 'active' },
      data: { status: 'expired' },
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/team/team-subscription.service.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

completeSubscriptionCallback 事务内、`teamSubscription.create`（:92）之前插入：

```typescript
        // 先关旧 active（partial unique 是最后防线，不能替代此步：到期后 expire-job 未跑窗口续费场景）
        await tx.teamSubscription.updateMany({
          where: { teamId, status: 'active' },
          data: { status: 'expired' },
        });
```

**getLimits 个人订阅回退（C7，用户 2026-08-29 拍板：个人套餐含存储权益）**——team-subscription.service.ts `getLimits`（:163-175）替换为：

```typescript
  /** 限额现算：默认团队回退个人订阅（C7），普通团队 active 订阅取 plan，否则免费常量 */
  async getLimits(teamId: string): Promise<{ seatLimit: number; storageLimitBytes: number }> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { isDefault: true, ownerId: true },
    });
    if (team?.isDefault) {
      // 默认团队永远没有 TeamSubscription（禁令），个人会员存储权益来自 UserSubscription
      const personal = await this.prisma.userSubscription.findFirst({
        where: { userId: team.ownerId, status: 'active', currentPeriodEnd: { gt: new Date() } },
        select: { plan: { select: { storageLimitBytes: true } } },
      });
      return {
        seatLimit: 1, // 默认团队恒单人（禁令保证），无席位概念
        storageLimitBytes: personal ? Number(personal.plan.storageLimitBytes) : TEAM_FREE_STORAGE_LIMIT_BYTES,
      };
    }
    const sub = await this.prisma.teamSubscription.findFirst({
      where: { teamId, status: 'active', currentPeriodEnd: { gt: new Date() } },
      select: { plan: { select: { seatLimit: true, storageLimitBytes: true } } },
    });
    if (sub) {
      return {
        seatLimit: sub.plan.seatLimit,
        storageLimitBytes: Number(sub.plan.storageLimitBytes),
      };
    }
    return { seatLimit: TEAM_FREE_SEAT_LIMIT, storageLimitBytes: TEAM_FREE_STORAGE_LIMIT_BYTES };
  }
```

对应 Step 1 补测试：

```typescript
  describe('getLimits 个人订阅回退（C7）', () => {
    it('默认团队 + 个人 pro 会员 → plan.storageLimitBytes、seatLimit=1', async () => {
      prisma.team.findUnique.mockResolvedValue({ isDefault: true, ownerId: 'u1' });
      prisma.userSubscription.findFirst.mockResolvedValue({ plan: { storageLimitBytes: 21474836480n } });
      const limits = await service.getLimits('t-default');
      expect(limits).toEqual({ seatLimit: 1, storageLimitBytes: 21474836480 });
    });
    it('默认团队 + 无个人订阅 → 免费档', async () => {
      prisma.team.findUnique.mockResolvedValue({ isDefault: true, ownerId: 'u1' });
      prisma.userSubscription.findFirst.mockResolvedValue(null);
      const limits = await service.getLimits('t-default');
      expect(limits.storageLimitBytes).toBe(TEAM_FREE_STORAGE_LIMIT_BYTES);
    });
    it('普通团队走 TeamSubscription（现状不变）', async () => {
      prisma.team.findUnique.mockResolvedValue({ isDefault: false, ownerId: 'u1' });
      prisma.teamSubscription.findFirst.mockResolvedValue({ plan: { seatLimit: 5, storageLimitBytes: 107374182400n } });
      const limits = await service.getLimits('t-team');
      expect(limits).toEqual({ seatLimit: 5, storageLimitBytes: 107374182400 });
    });
  });
```

（TEAM_FREE_* 常量按现有 import 路径引入 spec；**SubscriptionPlan.storageLimitBytes 初始化数据**：Task 1 加列后，seed/套餐初始化须按档位赋值——free 档可给与 TEAM_FREE_STORAGE_LIMIT_BYTES 相同值，pro/max 递增，具体数值执行时按产品定价表填。）

team-recharge.service.ts 新增：

```typescript
  async listOrders(teamId: string, page = 1, pageSize = 20, kind?: 'credits' | 'subscription') {
    const where: any = { teamId };
    if (kind) where.kind = kind;
    const [items, total] = await Promise.all([
      this.prisma.teamRechargeOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.teamRechargeOrder.count({ where }),
    ]);
    return { items, total };
  }
```

team.controller.ts 新增（TeamGuard 自动生效，成员可查）：

```typescript
  @Get(':id/recharge/orders')
  listRechargeOrders(@Param('id') id: string, @Query('kind') kind: 'credits' | 'subscription', @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.teamRecharge.listOrders(id, Number(page) || 1, Number(pageSize) || 20, kind);
  }
```

（注入名 `teamRecharge`——已核实 controller 现有注入名，非 this.recharge。）

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd apps/api && pnpm test`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "fix(api): 团队订阅回调先关旧 active 防续费撞约束；getLimits 默认团队回退个人订阅（C7）；新增 GET /team/:id/recharge/orders 订单列表"
```

---

### Task 11: validation 修复 + credits/balance 换源

**Files:**
- Modify: `apps/api/src/modules/execution/validation.service.ts`（:14,:62-69）
- Modify: `apps/api/src/modules/execution/execution.service.ts:52`（调用点传 teamId）
- Modify: `apps/api/src/modules/credit/credit.controller.ts`、`credit.service.ts`（balance 换源）
- Test: `validation.service.spec.ts`、`credit` 模块 spec（更新）

- [ ] **Step 1: 更新测试（先红）**

validation.service.spec.ts：

```typescript
  it('余额校验读项目团队 TeamBalance，口径 credits+subscriptionCredits', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ credits: 5, subscriptionCredits: 10 });
    const result = await service.validateAll(
      [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }], 't-team', 'u1',
    );
    expect(prisma.teamBalance.findUnique).toHaveBeenCalledWith({ where: { teamId: 't-team' } });
    expect(result.valid).toBe(true); // totalCost 15 内
  });
  it('总额不足时 invalid 且错误消息含双池合计', async () => {
    prisma.teamBalance.findUnique.mockResolvedValue({ credits: 1, subscriptionCredits: 2 });
    const result = await service.validateAll(
      [{ id: 'n1', type: 'imageGen', data: { model: 'm1' } }], 't-team', 'u1',
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('当前 3 积分');
  });
```

（model/pricingRule mock 沿用现有 spec 结构。）credit spec：`getBalance` 断言 `team.findFirst({ where: { ownerId, isDefault: true } })` + `teamBalance.findUnique`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && pnpm exec vitest run src/modules/execution/validation.service.spec.ts src/modules/credit`
Expected: FAIL。

- [ ] **Step 3: 实现**

validation.service.ts：

```typescript
  async validateAll(nodes: any[], teamId: string, userId: string): Promise<ValidationResult> {
```

（userId 参数保留供模型校验扩展，当前未用可留 underscore 约定——以 lint 规则为准，若 noUnusedParameters 开启则命名为 `_userId`。）:61-69 余额段替换：

```typescript
    // 校验口径与 teamCredit.consume 一致：credits + subscriptionCredits（quota 以 consume 为准，不预校验）
    const balance = await this.prisma.teamBalance.findUnique({ where: { teamId } });
    const available = (balance?.credits ?? 0) + (balance?.subscriptionCredits ?? 0);
    if (available < totalCost) {
      return {
        valid: false,
        errors: [`余额不足: 需要 ${totalCost} 积分，当前 ${available} 积分`],
        totalCost,
      };
    }
```

execution.service.ts:52 调用点：`this.validation.validateAll(nodes, project.teamId, userId)`（project 已在作用域）。

credit.controller.ts `getBalance` 换源（**C1 决策：保留 `subscriptionCreditsExpiry` 字段**——前端 creditsStore:46-48 用它判订阅态、CreditsDropdown:221 显示到期、MembershipPage:154 同源，且三个前端测试 mock 了该字段；删除会造成顶栏订阅态静默失效 + tsc -b excess property 报错。数据源改为 active UserSubscription 现读）：

```typescript
  @Get('balance')
  async getBalance(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    const team = await this.prisma.team.findFirst({ where: { ownerId: userId, isDefault: true } });
    if (!team) throw new BadRequestException('个人团队未初始化');
    const balance = await this.prisma.teamBalance.findUnique({ where: { teamId: team.id } });
    const sub = await this.prisma.userSubscription.findFirst({
      where: { userId, status: 'active', currentPeriodEnd: { gt: new Date() } },
      orderBy: { currentPeriodEnd: 'desc' },
      select: { currentPeriodEnd: true },
    });
    return {
      credits: balance?.credits ?? 0,
      subscriptionCredits: balance?.subscriptionCredits ?? 0,
      total: (balance?.credits ?? 0) + (balance?.subscriptionCredits ?? 0),
      subscriptionCreditsExpiry: sub?.currentPeriodEnd?.toISOString() ?? null,
      updatedAt: (balance?.updatedAt ?? new Date()).toISOString(),
    };
  }
```

**双池口径共享函数（D3）**：预校验/账本展示处统一 `export function availableCredits(b: { credits: number; subscriptionCredits: number }) { return b.credits + b.subscriptionCredits; }`（放 team.util.ts 或 team-credit.service 导出），防三处口径再漂移。validation.service 的 `available` 计算改用该函数。

（credit.service 的 UserBalance CRUD 方法本 Task 不删——Task 13 统一删除。**注意**：credit.controller 现仅注入 CreditService（:6），直查 prisma 需补 `@Inject(PrismaService) private readonly prisma: PrismaService`。）

- [ ] **Step 4: 跑测试确认通过 + 全量**

Run: `cd apps/api && pnpm test`
Expected: 全绿（execution.service.spec 中 validateAll 调用 mock 同步更新签名）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "fix(api): 执行预校验读项目团队账本（口径对齐 consume）；/api/credits/balance 换源默认团队 TeamBalance"
```

---

### Task 12: 删除现金余额买订阅死链路

**Files:**
- Modify: `apps/api/src/modules/subscription/subscription.service.ts`（删 subscribe :104-173 / upgrade :219 起 及其依赖的私有方法）
- Modify: `apps/api/src/modules/subscription/subscription.controller.ts`（删 POST /subscribe /upgrade :28-46 区域）
- Modify: `apps/web/src/api/subscriptionApi.ts`（删 subscribe/upgrade）
- Modify: `apps/web/src/hooks/useSubscription.ts:36,42`（删暴露）
- Test: 对应 spec 删除相关用例

- [ ] **Step 1: 确认前端无调用方（含 hook 解构层）**

Run:
```bash
cd apps/web && grep -rn "subscriptionApi.subscribe\|subscriptionApi.upgrade" src --include="*.tsx" --include="*.ts" | grep -v "api/subscriptionApi.ts" | grep -v "hooks/useSubscription.ts"
grep -rn "subscribe,\|, subscribe\|upgrade,\|, upgrade" src/pages/settings/MembershipPage.tsx
```
Expected: 第一条无输出（死代码已核实）；第二条命中 MembershipPage.tsx:54 的解构（`const { data: sub, loading, subscribe, upgrade, refresh: refreshSub } = useMySubscription()`）——已核实两函数全组件从未调用。

- [ ] **Step 2: 删除后端链路**

- subscription.service.ts：删除 `subscribe()`（:104-173）与 `upgrade()`（:219-260 区域，含读取 userBalance.balance 的 :250-258）；**顺带清理死代码（C5，已核实现状即死）**：构造器里从未被调用的 CreditService(:42)/OrderService(:43) 死注入、subscribe/upgrade 专用的 `nextGrantUtc`(:322)/`PERIOD_MONTHS`(:35)（若仅此两方法用）、`generateOrderNo`（若仅 subscribe 用）；`upgradePreview`/`getUpgradeAvailable` 保留（升级预览仍用于微信订单升级流程，MembershipPage:95 在用）。recharge.service.ts 删 User 分支后尾部 `formatTimeExpire` 一并核查删除。
- subscription.controller.ts：删除 `POST /subscribe`、`POST /upgrade` 两个 handler。
- 对应 spec 文件删除 subscribe/upgrade 用例。

- [ ] **Step 3: 删除前端暴露（含解构，P1-1）**

- subscriptionApi.ts：删 `subscribe`、`upgrade` 两个函数。
- useSubscription.ts:36,42：删 hook 内对应函数与返回字段。
- **MembershipPage.tsx:54：解构中删去 `subscribe, upgrade`**（否则 tsc 报属性不存在，web 测试门禁必红）。

- [ ] **Step 4: 全量测试（前后端）**

Run: `cd apps/api && pnpm test && cd ../web && pnpm test`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/web/src
git commit -m "refactor: 删除现金余额买订阅死链路（后端 subscribe/upgrade + controller 端点 + 前端暴露）"
```

---

### Task 13: 删除 User 级账本与 recharge 死链路（Phase 6 门禁）

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（删 UserBalance/CreditTransaction/UserBalanceTransaction/RechargeOrder + 4 枚举）
- Create: 第二个 migration
- Modify/Delete: recharge 模块 User 级文件、credit.service、payment.gateway User 推送、shared types、admin 引用
- Modify: `apps/web`（CreditsPage 充值改团队链路 + 删 balance 依赖）

- [ ] **Step 1: 断引用清单（先代码后模型）**

按序删除/改造（每小步后 `cd apps/api && pnpm exec tsc -p tsconfig.json --noEmit` 验证）：

1. recharge.controller.ts：删 5 个 User 端点（:35-125 区域），**保留** `POST notify/wechat`（:127）
2. recharge.service.ts：删 User 级充值方法（建单/支付/查询/completeOrderInTransaction :266-347）与 handleCallback 中 User 订单分支；保留 SUB/TEAM 分发与「未知单号返 FAIL」兜底；删 UserBalanceTransaction 写入（:383 区域）
3. task/active-query.processor.ts：删 User 级订单补偿分支（保留团队订单补偿，若有）
4. 删除文件：`task/close-expired-order.processor.ts`、`task/daily-scan.processor.ts`、`task/recharge-scheduler.service.ts`、`guards/throttle-user.guard.ts`（及其 module 注册）
5. recharge.module.ts / recharge-task.module.ts：清理对应 providers/imports/queues
6. credit.service.ts：删 UserBalance CRUD（getOrCreateBalance/deduct 等）；credit.controller 仅剩 Step-3 改造后的 balance 端点（直接查 prisma，不再依赖 service）——或 service 仅保留 thin wrapper
7. payment.gateway.ts：删 User 级余额推送（emitPaymentSuccess/Failed 的 UserBalance 来源），保留团队事件
8. execution/validation.service.ts 已在 Task 11 改完；全库 grep `userBalance` 确认零残留
9. `packages/shared/src/types/subscription.types.ts`：删 balance/User Recharge 相关类型
10. 管理后台（admin 模块）引用 UserBalance 的接口：改查默认团队 TeamBalance 或删除该 admin 端点（读现状决定，保持 admin 功能不塌）
11. `apps/web`：CreditsPage 充值区块改调团队充值 API（teamId 经 `GET /api/team/default`），删「账户余额（元）」卡与 `balance.balance` 依赖；MembershipPage 删「账户余额 ¥」与 :23 文案改个人语义；creditsStore/`useCreditBalance` 适配新返回结构 `{credits, subscriptionCredits, total}`

- [ ] **Step 2: grep 门禁（Phase 6 DoD 第一部分）**

Run:
```bash
cd apps/api && grep -rn "userBalance\|UserBalanceTransaction\|RechargeOrder\|BalanceTxType\|CreditReferenceType\|CreditTransactionType\|creditTransaction\.\|deductRegular\|getOrCreateBalance\|subscriptionCreditsExpiry" src prisma --include="*.ts" | grep -v ".spec.ts" | grep -v "TeamRechargeOrder\|teamCreditTransaction\|TeamCreditTransaction"
cd apps/web && grep -rn "balance\.balance\|/recharge/orders" src --include="*.ts" --include="*.tsx"
```
Expected: 均无输出（spec 文件此时应已同步删除/改写，一并清零；**grep 范围含 prisma/ 与 scripts/**——`prisma/seed.ts:200` 有 `userBalance.upsert`，**删模型后 migrate reset 重跑 seed 会直接失败，必须列入 Step 1 改造清单**：删除该段或改为 teamBalance 写默认团队；`scripts/backfill-team.ts` 用 team 模型无害，核查即可）。

- [ ] **Step 3: schema 删模型 + 第二 migration**

schema.prisma 删除 `UserBalance`、`CreditTransaction`、`UserBalanceTransaction`、`RechargeOrder` 四个 model 及 User 上的反向关系；删 enum `RechargeOrderStatus`、`BalanceTxType`、`CreditTransactionType`、`CreditReferenceType`（删前 grep 确认零引用）。

Run: `cd apps/api && pnpm prisma migrate reset --force && pnpm prisma migrate dev --name drop_user_level_ledger && pnpm prisma generate`
Expected: 成功。

- [ ] **Step 4: 全量门禁（Phase 6 DoD 第二部分）**

Run: `cd apps/api && pnpm test && cd ../web && pnpm test`
Expected: 全绿（tsc --noEmit 含在 api test 内；web 侧跑自己的类型检查/测试）。

- [ ] **Step 5: SetNull 全局排查（folder 唯一索引配套）**

Run: `cd apps/api && grep -rn "SetNull" prisma/schema.prisma | grep -i "parent"`
Expected: 确认 Folder/MaterialFolder 的 parentId onDelete 策略。对**所有**会让 parentId 变 null 的路径（删父文件夹、批量移动等）逐一核查：升入 root 域前完成同名消解（Task 6 remove 已实现，此步确认无遗漏入口）。

- [ ] **Step 6: 资源团队化词表核查（Phase 3/4 收尾门禁）**

Run: `cd apps/api && grep -rn "where: { id, userId }\|where: { userId" src/modules/{material-library,media,storage,project,canvas,template,storyboard} --include="*.ts" | grep -v ".spec.ts"`
Expected: 无输出（权限语义的 `{id, userId}` 全部已团队化；创建人语义的 userId 保留在 data 不在 where。**范围含各模块 controller**——material-library/media/storyboard/video-trim 的 controller 正是外部 ID 入口，不得遗漏）。

- [ ] **Step 7: Commit**

```bash
git add apps/api apps/web packages/shared
git commit -m "refactor: 删除 User 级账本与充值死链路——模型/枚举/模块/前端全链路清理，账本收敛 TeamBalance 唯一"
```

---

## Plan A 验收（对齐 spec §9 后端部分）

- [ ] 邮箱/手机/微信注册后只有一个 isDefault=true 团队；并发补建仅一条（team.bootstrap 并发用例 + 唯一索引）
- [ ] 默认团队操作禁令 12 处 API 全部拒绝且 kind=credits 充值放行
- [ ] 团队成员可打开/保存队友创建的画布；B 团队不可猜 ID 访问 A 资源
- [ ] 个人订阅发放/清零/升级入默认团队 TeamBalance；流水双池口径正确；**覆盖不滚存语义下清零必有流水（grant-credit/expire/升级/续费四场景）**
- [ ] getLimits 默认团队回退个人订阅（C7）：个人 pro/max 会员默认团队存储 quota 取 SubscriptionPlan.storageLimitBytes
- [ ] UserSubscription/TeamSubscription 的 paidAmount 统一为分
- [ ] TeamSubscription 到期窗口续费不撞约束
- [ ] 执行预校验与扣费同一账本同口径
- [ ] 微信回调重复投递不重复加积分
- [ ] Phase 6 双门禁通过（tsc+grep 词表零命中）
- [ ] `cd apps/api && pnpm test` 与 `cd apps/web && pnpm test` 全绿

Plan A 验收通过后，编写 Plan B（前端 Phase 7-9 + 联调 Phase 10）。

## 已知缺口登记（本 Plan 不处理，Plan B/后续决策）

- **D4 视频节点先调 API 后扣费**：execution.service:121 余额不足时 API 成本已损失（既有问题，建议后续预冻结机制）。

（原 C7 存储配额、D5 paidAmount 单位差异两项已在本版落实：C7 → Task 1 加 `SubscriptionPlan.storageLimitBytes` + Task 10 getLimits 默认团队回退个人订阅；D5 → Task 9 统一 paidAmount 存分。）

## Plan B 交接约束（后端已定死的事实，前端不得接反）

1. **支付双轨**：默认团队「订阅」走 SUB 前缀（SubscriptionOrder→UserSubscription，积分落默认团队 TeamBalance）；「积分充值」走 TEAM 前缀（TeamRechargeOrder，teamId=默认团队）。个人项目页两条链不能接反。
2. **默认团队识别**：`getMyTeams` 默认团队固定首位、`isDefault` 为前端唯一判据；`/team` 页面对 isDefault 团队过滤不显示管理面板；显示名统一 `teamDisplayName(t) => t.isDefault ? '个人项目' : t.name`。
3. **teamId 透传**：所有 body/query 传 teamId 的接口后端已强制 assertTeamMember；前端切换团队时必须把 currentTeamId 透传到 works/folder/template/material/storage 全部请求，缺省回落个人项目（默认团队）。
4. **余额结构**：`/api/credits/balance` 返回 `{credits, subscriptionCredits, total, subscriptionCreditsExpiry, updatedAt}`（subscriptionCreditsExpiry 来自 active UserSubscription）。
5. **个人项目页不得出现团队套餐入口**（默认团队操作禁令配套）；团队账单页 `/team/:id/billing` 数据源 TeamPlan/TeamSubscription/TeamRechargeOrder。
