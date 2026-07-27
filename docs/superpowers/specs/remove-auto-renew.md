# Spec: 移除自动续费（连续包月/包季/包年）功能

## 背景

微信支付委托代扣申请被拒绝，连续包月/包季/包年（自动付费）功能无法落地。项目处于开发阶段，直接彻底删除整套自动续费链路及相关数据，只保留一次性购买包月/包季/包年。

## 变更范围

### 1. 前端 — VIP 订阅弹窗 (`VipSubscribeModal.tsx`)

- `PERIOD_LABELS`: `{ monthly: '连续包月', quarterly: '连续包季', annually: '连续包年' }` → `{ monthly: '包月', quarterly: '包季', annually: '包年' }`
- 删除 `PERIOD_RENEWAL_PREFIX` 常量（`{ monthly: '次月', quarterly: '次季', annually: '次年' }`）
- 删除卡片中续费提示行：`{PERIOD_RENEWAL_PREFIX[period]}续费 ¥{plan.originalPrice} 可随时取消`
- 全组件检索：清除所有"自动续费、次月续费、连续订阅、随时取消续费"相关静态文案、tooltip、底部须知

### 2. 前端 — 会员中心页 (`MembershipPage.tsx`)

- 从 `useMySubscription()` 解构中移除 `cancelAutoRenew`, `enableAutoRenew`
- 删除 `sub.autoRenew` 条件渲染的按钮组（"取消自动续费" / "开启自动续费"）
- 移除 `autoRenew` 字段在 `MySubscription` 类型中的引用

### 3. 前端 — Hook (`useSubscription.ts`)

- 移除 `cancelAutoRenew` callback（及内部 `subscriptionApi.cancelAutoRenew()` 调用）
- 移除 `enableAutoRenew` callback（及内部 `subscriptionApi.enableAutoRenew()` 调用）
- 从 return 对象中移除这两个方法

### 4. 前端 — API 客户端 (`subscriptionApi.ts`)

- `MySubscription` 接口移除 `autoRenew: boolean` 和 `cancelledAt: string | null` 字段
- 移除 `cancelAutoRenew()` 方法
- 移除 `enableAutoRenew()` 方法

### 5. 前端 — 测试 (`VipSubscribeModal.test.tsx`)

- `'连续包月'` → `'包月'`

### 6. 后端 — Controller (`subscription.controller.ts`)

**直接删除两个端点（开发阶段无需灰度兼容）：**
- 删除 `POST /api/subscription/cancel-auto-renew`
- 删除 `POST /api/subscription/enable-auto-renew`

### 7. 后端 — Service (`subscription.service.ts`)

**删除两个方法：**
- `cancelAutoRenew(userId)` 方法（整个方法体）
- `enableAutoRenew(userId)` 方法（整个方法体）

**全路径 Prisma 调用校验（已执行）：**

| 文件 | 调用 | autoRenew/cancelledAt |
|------|------|----------------------|
| `subscription.service.ts:131` | `create` (subscribe) | 无 |
| `subscription.service.ts:260` | `updateMany` (upgrade) | 仅 `status` |
| `subscription.service.ts:284` | `create` (upgrade) | 无 |
| `subscription.service.ts:316,324` | `updateMany` | 整个方法删除 |
| `credit.service.ts:86` | `updateMany` | 仅 `consumedCredits` |
| `grant-credit.processor.ts:36` | `update` | 仅 `nextGrantDate`, `grantCount` |
| `expire-subscription.processor.ts:33` | `update` | 仅 `status` |
| `admin-subscription.service.ts:43` | `update` (cancel) | **需移除赋值**（见第 9 条） |

### 8. 后端 — 过期处理器 (`expire-subscription.processor.ts`)

- 筛选条件：`status = 'active' AND currentPeriodEnd <= todayUtc`
- 移除 `current.cancelledAt ? 'cancelled' : 'expired'` 三元判断
- 所有到期活跃订阅统一更新为 `status: 'expired'`

### 9. 后端 — Admin Service (`admin-subscription.service.ts`)

- `cancelSubscription` 中移除 `autoRenew: false, cancelledAt: new Date()` 字段赋值，仅设置 `status: 'expired'`
- `TERMINAL` 集合移除 `'cancelled'`，最终值为 `['expired', 'upgraded']`

### 10. 后端 — Admin Controller (`admin-subscription.controller.ts`)

- `body.status === 'cancelled'` 条件改为 `body.status === 'expired'`
- 删除关于 `autoRenew` 的注释

### 11. 共享类型 (`packages/shared/src/types/subscription.types.ts`)

- `SubscriptionMeResponse` 移除 `autoRenew` 和 `cancelledAt` 字段
- `SubscriptionStatus` 移除 `'cancelled'` → 类型变为 `'active' | 'expired' | 'upgraded'`
- 检查 `SubscribeBody` / `UpgradeBody` 等下单请求类型：确认不存在 `autoRenew` 参数

### 12. 数据库 — Prisma Schema

**删除字段：**
- `UserSubscription.autoRenew` 列
- `UserSubscription.cancelledAt` 列

**`SubscriptionStatus` enum 移除 `cancelled` 值**

**Migration：** 直接执行 `prisma migrate dev` 生成 migration，review 自动生成的 SQL 确认正确性。开发阶段无需数据迁移。

### 13. 管理后台前端 (`SubscriptionTabs.tsx`)

- 取消按钮：`{ status: 'cancelled' }` → `{ status: 'expired' }`
- 状态列：直接显示 API 返回的原始 status 值，删枚举后自动不再出现 `cancelled`，无需额外映射修改
- 无状态筛选器，无需调整

### 14. 全局状态分支清理

**前端：**
- 全局搜索 `autoRenew`、`cancelledAt`、`cancelAutoRenew`、`enableAutoRenew`，确保无遗留代码引用
- `creditsStore.ts` 中 `fetchBalance()` 调用 `subscriptionApi.getMe()` 返回类型不再包含 `autoRenew`，验证无类型错误
- 已验证：无 `status === 'cancelled'` / `case 'cancelled'` 等状态判断分支（现有 `cancelled` 均为无关局部变量）

**后端：**
- 全局检索包含 `'cancelled'` 字符串的条件判断、查询 where、状态过滤逻辑（已确认全部在 Spec 覆盖文件内）
- 删字段/枚举后 TypeScript 编译器会自然捕获遗漏引用

### 15. 已验证无需修改项

| 项目 | 结论 |
|------|------|
| 管理后台前端 | 无自动续费 UI，仅需改取消按钮的 status 值 |
| 邮件/短信/站内信模板 | 代码库中不存在 |
| 后端 NestJS DTO 校验 | 无独立 DTO，入参来自共享包 |
| Prisma 索引 | `autoRenew`/`cancelledAt` 无独立索引 |
| BullMQ 续费/扣费任务 | 不存在 |

## 实现注意事项

1. **Prisma Enum 删值的 Migration SQL**：PostgreSQL 不支持直接从 enum 删除值，Prisma 自动生成 `DROP TYPE ... CREATE TYPE ... ALTER COLUMN TYPE` 三部曲。开发阶段无历史数据无风险，但需 review 生成的 SQL 确认语法正确。
2. **管理员取消操作的可追溯性**：`expired` 不再区分「管理员终止」与「自然到期」。如需追溯操作原因，后续通过独立审计日志记录，本次不新增审计字段。

## 不在范围内

- 充值/积分系统
- 订阅套餐（plans）CRUD
- 升级/降级逻辑
- 积分发放调度
- Banner 管理
- `SubscriptionOrderType.renewal` 枚举值 — 保留不做清理
- 埋点事件 — 若存在则移除，不存在则忽略

## 验收标准

1. VIP 弹窗周期标签显示"包月 / 包季 / 包年"，无"连续"前缀
2. VIP 弹窗套餐卡片无"次月续费 ¥xxx 可随时取消"文案
3. 会员中心页不显示自动续费开关按钮
4. `POST /api/subscription/cancel-auto-renew` 返回 404
5. `POST /api/subscription/enable-auto-renew` 返回 404
6. 订阅到期后状态统一为 `expired`
7. 管理员取消订阅 → 状态为 `expired`
8. 数据库 `UserSubscription` 表无 `autoRenew`、`cancelledAt` 列
9. 全局代码无 `autoRenew`、`cancelledAt`、`cancelAutoRenew`、`enableAutoRenew` 引用
10. 全站无残留文案：「连续包月、连续包季、自动续费、次月自动扣费、随时取消续费」
11. 现有测试更新后全部通过
12. TypeScript strict 模式无类型错误
13. 管理后台订阅列表无「已取消」状态展示（枚举已删除，数据中不会出现）
14. `SubscriptionStatus` 枚举仅包含 `active`、`expired`、`upgraded` 三个合法值
