<!-- doc-status: historical | verified_at: n/a -->
# Plan: 移除自动续费（连续包月/包季/包年）功能

## 执行策略

TDD 红-绿-重构，自底向上：共享类型 → 数据库 → 后端 → 前端 → 全局清理。

## 任务分解

### Task 1: 共享类型更新 【TDD 红阶段】

**文件：** `packages/shared/src/types/subscription.types.ts`

- `SubscriptionStatus` 移除 `'cancelled'` → `'active' | 'expired' | 'upgraded'`
- `SubscriptionMeResponse` 移除 `autoRenew: boolean` 和 `cancelledAt: string | null`

**前置操作：** 若共享包需预构建才能被其他包引用类型，先执行：
```bash
pnpm --filter shared build
```

**红阶段输出：** 执行全量类型检查，收集所有类型报错的文件清单，作为后续 Tasks 3-13 的必改核对清单，确保无遗漏：
```bash
pnpm run typecheck
```

**验证：** 确认报错文件清单完整覆盖 Spec 变更范围内的所有文件

---

### Task 2: 数据库 Prisma Schema + Migration

**文件：** `apps/api/prisma/schema.prisma`

- `SubscriptionStatus` enum 移除 `cancelled`
- `UserSubscription` 模型删除 `autoRenew` 和 `cancelledAt` 字段

**执行：** `cd apps/api && pnpm prisma migrate dev --name remove_auto_renew`

> `prisma migrate dev` 仅用于开发环境；后续正式上线生产环境需使用 `prisma migrate deploy`。当前为开发阶段改造，不影响本次执行。

**Migration SQL Review 要点：**
- 确认枚举删值采用「删旧枚举 → 建新枚举 → 改列类型」标准流程
- 确认字段删除无残留约束、无意外 `DROP TABLE` 等高危语句

**验证：**
- review migration SQL 通过
- 确认 Prisma Client 类型已同步更新 — `UserSubscription` 类型无 `autoRenew`、`cancelledAt` 字段，`SubscriptionStatus` 枚举无 `cancelled` 值
- 执行 `pnpm --filter api run typecheck`，确认后端类型无新增错误

**回滚预案：** 若 migration 执行异常，执行以下命令标记回滚，修正 schema 后重新生成：
```bash
cd apps/api && pnpm prisma migrate resolve --rolled-back remove_auto_renew
```

---

### Task 3: 后端 — Subscription Service

**文件：** `apps/api/src/modules/subscription/subscription.service.ts`

- 删除 `cancelAutoRenew(userId)` 方法（line 315-321）
- 删除 `enableAutoRenew(userId)` 方法（line 323-329）

**验证：** `pnpm --filter api test -- subscription.service` 通过

---

### Task 4: 后端 — Subscription Controller

**文件：** `apps/api/src/modules/subscription/subscription.controller.ts`

- 删除 `POST cancel-auto-renew` 端点（line 48-52）
- 删除 `POST enable-auto-renew` 端点（line 54-58）

**验证：** 启动本地服务后查看 NestJS 路由日志，确认无 `cancel-auto-renew`、`enable-auto-renew` 路由注册；Controller 编译通过；最终 404 结果由 Task 14 统一验证

---

### Task 5: 后端 — 过期处理器

**文件：** `apps/api/src/modules/subscription/task/expire-subscription.processor.ts`

- line 30: `current.cancelledAt ? 'cancelled' : 'expired'` → 固定 `'expired'`

**测试同步更新：** 若测试用例中存在「到期后状态为 `cancelled`」的断言，同步改为断言 `'expired'`

**补充验证：** 确认文件内无其他 `cancelledAt` 字段残留引用，避免字段删除后编译报错

**验证：** `pnpm --filter api test -- expire-subscription` 通过

---

### Task 6: 后端 — Admin Service

**文件：** `apps/api/src/modules/subscription/admin/admin-subscription.service.ts`

- line 38: `TERMINAL` 集合移除 `'cancelled'` → `new Set(['expired', 'upgraded'])`
- line 45: `data: { status: 'cancelled', autoRenew: false, cancelledAt: new Date() }` → `data: { status: 'expired' }`

**测试同步更新：** `cancelSubscription` 相关测试用例，状态断言从 `'cancelled'` 改为 `'expired'`，移除对 `autoRenew`、`cancelledAt` 字段的断言

**验证：** `pnpm --filter api test -- admin-subscription` 通过

---

### Task 7: 后端 — Admin Controller

**文件：** `apps/api/src/modules/subscription/admin/admin-subscription.controller.ts`

- line 40: `body.status === 'cancelled'` → `body.status === 'expired'`
- line 43: 删除 `autoRenew` 相关注释

**测试同步更新：** 若存在 Controller 层接口测试，同步更新状态断言 `'cancelled'` → `'expired'`

**验证：** Controller 编译通过

---

### Task 8: 前端 — API 客户端

**文件：** `apps/web/src/api/subscriptionApi.ts`

- `MySubscription` 接口移除 `autoRenew` 和 `cancelledAt` 字段
- 删除 `cancelAutoRenew()` 方法
- 删除 `enableAutoRenew()` 方法

**验证：** `pnpm --filter web run typecheck` 通过

---

### Task 9: 前端 — Hook

**文件：** `apps/web/src/hooks/useSubscription.ts`

- 删除 `cancelAutoRenew` callback（line 46-49）
- 删除 `enableAutoRenew` callback（line 51-54）
- return 对象移除 `cancelAutoRenew, enableAutoRenew`（line 56）

**验证：** `pnpm --filter web run typecheck` 通过

---

### Task 10: 前端 — 会员中心页

**文件：** `apps/web/src/pages/settings/MembershipPage.tsx`

- line 52: 解构移除 `cancelAutoRenew, enableAutoRenew`
- line 108-113: 删除 `sub.autoRenew` 条件渲染的按钮组

**验证：** `pnpm --filter web test -- MembershipPage` 通过

---

### Task 11: 前端 — VIP 订阅弹窗

**文件：** `apps/web/src/components/VipSubscribeModal.tsx`

- line 103: `PERIOD_LABELS` 去掉"连续"前缀
- line 106: 删除 `PERIOD_RENEWAL_PREFIX` 常量
- line 529: 删除续费提示行

**验证：** `pnpm --filter web test -- VipSubscribeModal` 通过

---

### Task 12: 前端 — 测试更新

**文件：** `apps/web/src/components/VipSubscribeModal.test.tsx`

- `'连续包月'` → `'包月'`

**验证：** `pnpm --filter web test -- VipSubscribeModal.test` 通过

---

### Task 13: 管理后台前端

**文件：** `apps/web/src/pages/admin/components/SubscriptionTabs.tsx`

- line 109: `{ status: 'cancelled' }` → `{ status: 'expired' }`

**验证：** `pnpm --filter web run typecheck` 通过

---

### Task 14: 全局清理与最终验证

**依赖：** Tasks 3-7（后端全量）+ Tasks 8-13（前端全量）全部完成后执行，作为最终验收节点。

**全局搜索（标准化命令）：**
```bash
# 代码引用清理
grep -rn "autoRenew\|cancelledAt\|cancelAutoRenew\|enableAutoRenew" apps/ packages/ --include="*.ts" --include="*.tsx"
# 文案清理
grep -rn "连续包月\|连续包季\|自动续费\|次月自动扣费\|随时取消续费" apps/ packages/ --include="*.ts" --include="*.tsx"
```

**接口 404 验证：**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/subscription/cancel-auto-renew
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/subscription/enable-auto-renew
# 期望：两个接口均返回 404
```

**全量验证：**
- `pnpm run typecheck` — 全量类型检查通过
- `pnpm test` — 全量测试通过

## 依赖关系

```
Task 1 (共享类型)  ← TDD 红阶段：产出类型错误清单
 │
 ├─> Task 2 (Prisma Schema + Migration)
 │    ├─> Task 3 (Service) ──> Task 4 (Controller)
 │    ├─> Task 5 (过期处理器)
 │    └─> Task 6 (Admin Service) ──> Task 7 (Admin Controller)
 │
 └─> Task 8 (API 客户端)  ← 前端任务仅依赖 Task 1，不依赖数据库变更
      ├─> Task 9 (Hook)
      │    └─> Task 10 (会员中心页)
      ├─> Task 11 (VIP 弹窗) ──> Task 12 (测试更新)
      └─> Task 13 (管理后台)
 
 Tasks 3-7 (后端) + Tasks 8-13 (前端) 全部完成后
  └─> Task 14 (全局清理验证)
```

**并行策略：** 前端任务（Tasks 8-13）仅依赖 Task 1（共享类型），不依赖数据库变更，可与后端任务（Tasks 3-7）完全并行执行。

## Git 提交节点

| 节点 | 提交内容 | 前置校验 |
|------|---------|---------|
| Commit 1 | Task 1 + Task 2（共享类型 + 数据库变更） | `pnpm run typecheck` 通过 |
| Commit 2 | Tasks 3-7（后端全量修改完成） | `pnpm --filter api test` 通过 |
| Commit 3 | Tasks 8-13（前端全量修改完成） | `pnpm --filter web test` 通过 |
| Commit 4 | Task 14（全局清理验证通过） | `pnpm test && pnpm run typecheck` 通过 |

> 每个 Commit 提交前必须保证对应范围的 typecheck 与测试通过，不允许提交编译失败的代码。

## 验证命令汇总

| 阶段 | 命令 | 说明 |
|------|------|------|
| 全量类型检查 | `pnpm run typecheck` | 全仓 TypeScript 编译 |
| 后端类型检查 | `pnpm --filter api run typecheck` | 仅 api 包 |
| 前端类型检查 | `pnpm --filter web run typecheck` | 仅 web 包 |
| 后端单测 | `pnpm --filter api test -- <test-name>` | `<test-name>` 为 vitest 用例筛选 |
| 前端单测 | `pnpm --filter web test -- <test-name>` | `<test-name>` 为 vitest 用例筛选 |
| 全量测试 | `pnpm test` | 全仓测试 |
| Migration | `cd apps/api && pnpm prisma migrate dev --name remove_auto_renew` | 生成迁移文件 |

> 注意：`--filter <package>` 是 pnpm workspace 包筛选（必须在命令前），`-- <filter>` 是 vitest 测试用例筛选（必须在 `--` 后）。
