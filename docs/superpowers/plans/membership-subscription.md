<!-- doc-status: historical | verified_at: n/a -->
# Plan: 会员订阅功能

## 文件变更总览

```
新增:
  apps/api/prisma/migrations/XXXX_add_subscription/
    migration.sql                            — 正向迁移 + 手动部分唯一索引 / CHECK 约束
    rollback.sql                             — 回滚 SQL
  apps/api/src/common/audit/
    audit.service.ts                         — 统一审计日志写入
    audit.decorator.ts                       — @Audit() 装饰器
  apps/api/src/common/utils/
    order-no.ts                              — 订单号生成工具（SUB + UTC + 6位随机）
  apps/api/src/common/guards/
    subscription-feature.guard.ts            — 功能开关守卫（3 个开关）
  apps/api/src/modules/subscription/
    subscription.module.ts
    subscription.service.ts
    subscription.controller.ts
    pricing.service.ts                       — 升级计价引擎（纯函数）
    dto/
  apps/api/src/modules/subscription/admin/
    admin-subscription.module.ts
    admin-subscription.controller.ts
    admin-subscription.service.ts
  apps/api/src/modules/subscription/task/
    grant-credit.processor.ts
    expire-subscription.processor.ts
    subscription-task.module.ts
  apps/api/src/modules/order/
    order.module.ts
    order.service.ts
    dto/
  apps/web/src/pages/settings/membership/
    page.tsx
    components/
      PlanTable.tsx                          — 未订阅：套餐对比
      CurrentSubscription.tsx                — 已订阅：详情卡片
      UpgradeModal.tsx                       — 升级预览 + 确认
      OrderHistory.tsx                       — 订单列表
  apps/web/src/pages/admin/components/
    PlanManagementTab.tsx
    SubscriptionManagementTab.tsx
    OrderManagementTab.tsx
    CreditManagementTab.tsx
  apps/web/src/stores/subscriptionStore.ts
  apps/web/src/api/subscriptionApi.ts
  apps/web/src/hooks/useSubscriptionFeature.ts  — 功能开关读取 Hook
  apps/web/src/hooks/useCreditBalance.ts        — 统一积分查询 Hook（全局单数据源）
  packages/shared/src/types/subscription.types.ts — 基于 Prisma 类型扩展（含 DTO 类型、UpgradePricingSnapshot）

修改:
  apps/api/prisma/schema.prisma                  — 新增枚举 + 5 表 + UserBalance 扩展
  apps/api/src/app.module.ts                     — 注册新模块
  apps/api/src/modules/credit/credit.service.ts  — 双账户单 UPDATE 扣减
  apps/api/src/modules/credit/credit.controller.ts — balance 返回扩展
  apps/web/src/router.tsx                        — /settings/membership
  apps/web/src/pages/home/components/Navbar.tsx  — 双账户积分 + 会员徽章
  apps/web/src/pages/admin/page.tsx              — 4 个新 Tab
```

---

## 修正后的任务依赖

```
Task 1 (DB Schema)
    │
    ├── Task 2 (Plan CRUD) ────────────────────────────┐
    │                                                   │
    └── Task 3 (双账户积分改造) ── 底层能力优先 ────────┤
         │                                              │
         ├── Task 4 (新订阅流程) ───────────────────────┤
         ├── Task 5 (升级计价引擎 + 升级流程) ──────────┤
         └── Task 6 (续费开关) ─────────────────────────┤
              │                                         │
              └── Task 7 (BullMQ 定时任务) ─────────────┤
                   │                                    │
                   └── Task 8 (管理端 API) ─────────────┤
                        │                              │
                        ├── Task 9 (会员中心页面) ──────┤
                        └── Task 10 (Navbar + Admin Tab)┘

Task 0 (审计服务 + 功能开关守卫) — 基础设施，Task 1 完成后、Task 4~8 启动前完成
```

---

## Task 0: 基础设施（审计服务 + 功能开关 + 共享类型）

### Task 0a: 统一审计服务

**文件：**
- `apps/api/src/common/audit/audit.service.ts`
- `apps/api/src/common/audit/audit.decorator.ts`

**能力：**
- `AuditService.log(params)` — 统一写入 AuditLog
- `@AuditLog(action, targetType)` 装饰器 — 自动读取 req.user，自动序列化返回值
- 管理端所有写操作 + 用户端核心操作（订阅、升级、取消续费）通过审计服务写入
- **审计来源区分规则：** 用户端操作的 `operatorId` = 当前登录用户 ID，管理端操作的 `operatorId` = 管理员 ID。用户端与管理端共用同一张 AuditLog 表，通过 operatorId 区分操作来源，便于全链路问题溯源。targetType 对应用户端实体（subscription / order），action 区分操作类型（subscribe / upgrade / cancel_auto_renew）

**验证：** audit.service.spec.ts — 写入 AuditLog 成功，操作人/类型/变更值正确

### Task 0b: 功能开关守卫

**文件：** `apps/api/src/common/guards/subscription-feature.guard.ts`

**三个开关（环境变量）：**

| 变量 | 默认值 | 关闭行为 |
|---|---|---|
| `SUBSCRIPTION_ENABLED` | true | 所有订阅 API 返回 403 |
| `SUBSCRIPTION_UPGRADE_ENABLED` | true | 升级相关 API 返回 403 |
| `SUBSCRIPTION_ADMIN_GRANT_ENABLED` | true | 管理端积分发放 API 返回 403 |

**注册方式：** 在 subscription.module / admin-subscription.module 路由层挂载对应守卫，关闭时已生效订阅正常运行。

**验证：** guard.spec.ts — 开关关闭返回 403 + 对应文案；开关开启正常放行

### Task 0c: 共享类型对齐 + 订单号工具

**文件：**
- `packages/shared/src/types/subscription.types.ts` — 基于 Prisma 类型扩展（PlansResponse, SubscriptionMeResponse, UpgradePreviewResponse, **UpgradePricingSnapshot**, **SubscribeBody, UpgradeBody, GrantCreditBody 等 DTO**，以及订阅列表/订单列表/流水列表的筛选参数类型 `SubscriptionFilter` / `OrderFilter` / `TransactionFilter`），前后端共用
- `packages/shared/src/constants/subscription-error.ts` — 统一错误码常量，前后端共用，避免两端重复定义、迭代时不同步
- `apps/api/src/common/utils/order-no.ts` — 统一订单号生成：`SUB + UTC毫秒时间戳 + 6位随机数`
- `apps/api/src/common/exceptions/business.exception.ts` — 统一业务异常类，封装错误码与 HTTP 状态码映射，避免各处手动 `throw new HttpException(...)`，保证错误返回格式一致，便于全局异常过滤器统一处理与日志记录

**UpgradePricingSnapshot 接口：**
```typescript
interface UpgradePricingSnapshot {
  sourcePaidAmount: number;
  remainTimeRatio: number;
  remainPointsRatio: number;
  finalRatio: number;
  targetOriginalPrice: number;
  deductibleAmount: number;
  payableAmount: number;
}
```

**验证：** `pnpm --filter shared exec tsc --noEmit`，工具类单测

---

## Task 1: 数据库 Schema + 迁移

**文件：**
- `apps/api/prisma/schema.prisma` — 新增枚举 + SubscriptionPlan / UserSubscription / SubscriptionOrder / CreditTransaction / AuditLog + UserBalance 扩展
- `apps/api/prisma/migrations/XXXX_add_subscription/migration.sql` — 正向迁移
- `apps/api/prisma/migrations/XXXX_add_subscription/rollback.sql` — 回滚 SQL

**Prisma Schema 索引：**
- `@@index([status, nextGrantDate])` — 积分发放扫描
- `@@index([status, currentPeriodEnd])` — 到期扫描

**手动编写内容（Prisma 不原生支持）：**
- 部分唯一索引：`CREATE UNIQUE INDEX ... ON UserSubscription (userId) WHERE status = 'active'`
- CHECK 约束：`ALTER TABLE UserBalance ADD CONSTRAINT ... CHECK (subscriptionCredits = 0 OR subscriptionCreditsExpiry IS NOT NULL)`
- **重要：手动 SQL 必须写在 migration.sql 末尾**，防止 Prisma 后续重生成迁移时覆盖手动内容。执行 `prisma migrate dev` 后，通过 verify-indexes.sql 直接查询 pg_indexes / pg_constraint 验证索引与约束是否存在

**开发环境验证流程：**
1. `prisma migrate dev --name add_subscription` → 生成迁移文件并应用到开发库
2. 执行回滚 SQL 验证脚本可逆性
3. 通过 verify-indexes.sql 校验部分唯一索引、CHECK 约束生效
4. 开发联调前全量跑通相关单元测试，验证数据模型正确性

**验证：**
```bash
pnpm --filter api exec prisma migrate dev --name add_subscription
# 手动验证索引
pnpm --filter api exec prisma db execute --file verify-indexes.sql
```

---

## Task 2: SubscriptionPlan CRUD（后端）

**文件：** `apps/api/src/modules/subscription/subscription.module.ts`, `*.service.ts`, `*.controller.ts`, `dto/`

**API：**
- `GET /api/subscription/plans`（公开，仅 isActive）
- `GET /api/admin/subscription/plans`（管理端，含未上架，按 sort）
- `POST /api/admin/subscription/plans`
- `PATCH /api/admin/subscription/plans/:id`
- `DELETE /api/admin/subscription/plans/:id`

**测试：** `subscription.service.spec.ts`, `subscription.controller.spec.ts`

**验证：**
- 创建/更新/删除计划正常
- 上架/下架切换正确
- 按 sort 排序正确
- 修改计划不影响已有订阅

---

## Task 3: 双账户积分改造（底层能力，优先）

**依赖：** Task 1 完成

**文件：**
- `apps/api/src/modules/credit/credit.service.ts` — 重写 deduct 方法
- `apps/api/src/modules/credit/credit.controller.ts` — balance 接口扩展

**核心改造：拆分为两个独立方法，语义分离**

```typescript
// 方法 A：业务消费（节点执行大模型调用）
// 优先扣订阅积分 → 不足扣普通积分 → 同步更新 consumedCredits
// 内部固定：type=consumption, referenceType=execution
async consume(userId: string, amount: number, relatedId: string): Promise<void>

// 方法 B：仅扣普通积分（订阅支付、升级差价）
// 不碰订阅积分，不更新 consumedCredits
// 内部固定：type=subscription_payment, referenceType=order
async deductRegular(userId: string, amount: number, relatedId: string): Promise<void>
```

**原因：** 订阅支付 / 升级差价必须只扣普通积分，若复用 consume 方法会错误地优先扣减订阅积分。

**流水写入职责：** 两个方法内部封装 CreditTransaction 写入，调用方无需关心流水细节：
- `consume`：内部完成 subscription（subDeduct>0 时）+ regular（regularDeduct>0 时）流水写入，type 固定 `consumption`，referenceType 固定 `execution`
- `deductRegular`：内部完成 regular 流水写入，type 固定 `subscription_payment`，referenceType 固定 `order`
- 方法入参仅接收 `relatedId`，**referenceType 由方法内部固定赋值，禁止调用方传入**。Spec §2.1 已定义 type ↔ referenceType 强对应约束，调用方传参错误会破坏流水关联规则
- 管理员发放、清零等其他场景由对应服务单独处理流水，不复用这两个方法，从底层杜绝传参错误

**共享底层能力：** 两个方法复用同一套事务、乐观锁、重试逻辑：
- `consume`：单 UPDATE 同时扣减 subscriptionCredits + credits，subDeduct=0 时跳过 consumedCredits + subscription 流水
- `deductRegular`：单 UPDATE 仅扣减 credits，校验 credits >= amount

**流水写入顺序（balanceAfter 取值规则）：**
1. 先执行 UPDATE 扣减积分，通过 affected rows 判断是否成功
2. 扣减成功后，读取对应账户的最新余额（同一个 Prisma 事务内保证一致性）
3. balanceAfter 取 creditType 对应账户的扣减后余额（subscription→subscriptionCredits，regular→credits）
4. 最后写入 CreditTransaction（balanceAfter = step 2 读取的值）
- **严格禁止先写流水再扣减**，否则流水余额与实际数据库不一致，对账失效

**乐观锁冲突自动重试 2-3 次**（仅 version 冲突重试，业务异常不重试；每次重试前重查最新数据。详见「开发规范与约定 — 乐观锁重试边界」）
- `GET /api/credits/balance` 返回 `{ credits, subscriptionCredits, subscriptionCreditsExpiry }`

**测试：** credit.service.spec.ts — consume 场景 + deductRegular 场景 + 乐观锁重试

**验证（TDD 红→绿）：**
- consume：订阅积分充足 → 全扣订阅 + consumedCredits 累加
- consume：订阅积分不足 → 扣完订阅再扣普通，两条流水
- consume：全扣普通 → 仅 regular 流水，不更新 consumedCredits
- deductRegular：仅扣普通积分，不碰 subscriptionCredits
- deductRegular：普通积分不足 → 拒绝
- 乐观锁冲突 → 自动重试成功

---

## Task 4: 新订阅流程（后端）

**依赖：** Task 3（积分双账户改造）完成

**文件：**
- `apps/api/src/modules/order/order.module.ts`, `order.service.ts`
- `apps/api/src/modules/subscription/subscription.service.ts`（subscribe 方法）
- `apps/api/src/modules/subscription/subscription.controller.ts`

**API：**
- `POST /api/subscription/subscribe`（事务包裹，审计日志）
- `GET /api/subscription/me`
- `GET /api/subscription/orders`

**UserSubscription 字段统一计算规则（Task 4 新购 + Task 5 升级均按此规则）：**

| 字段 | 计算规则 |
|---|---|
| paidAmount | **新购**：对应周期价格（monthly→priceMonthly / quarterly→priceQuarterly / annually→priceAnnually）；**升级**：payableAmount（用户实际支付差价） |
| totalCredits | `plan.monthlyCredits × 周期月数`（月×1 / 季×3 / 年×12），订阅创建时锁定 |
| totalDays | 周期固定天数（月=30 / 季=90 / 年=365），订阅创建时锁定 |
| subscribedAt | `now()` UTC |
| currentPeriodStart | `now()` UTC |
| currentPeriodEnd | `now() + totalDays`（UTC） |
| nextGrantDate | `(now() + 30天)` 的 `00:00:00` UTC |
| grantCount | `1`（首次发放已完成） |
| consumedCredits | `0` |

**事务步骤（严格按序）：**
1. 业务层幂等校验：用户已有 active 订阅 → 直接返回已有
2. 创建 SubscriptionOrder → 拿到订单 ID
3. 调用 credit.deductRegular(userId, amount, orderId) — 内部完成扣减 + 流水写入（subscription_payment），referenceId=订单ID
4. 创建 UserSubscription（所有周期字段 + 锁定值）
5. 发放首月积分 + 写入流水（subscription_grant，creditType=subscription，amount 为正，referenceId=新订阅ID，referenceType=subscription）
6. 设置 UserBalance.subscriptionCreditsExpiry

**订单状态说明：** 当前 SubscriptionOrder.status 枚举仅使用 `success`（本期无支付环节，创建即成功）。后续接入支付时扩展 `pending`、`failed`、`refunded` 等状态，本期预留枚举值，保证向前兼容。

**测试：** order.service.spec.ts, subscription subscribe 相关测试

**验证：**
- 新订阅成功，所有字段正确
- 已有 active → 幂等返回已有
- 积分不足 → 拒绝
- 订单号唯一索引冲突 → 幂等返回已有订单

---

## Task 5: 升级计价引擎 + 升级流程（后端）

**依赖：** Task 3（积分双账户改造）完成

**文件：**
- `apps/api/src/modules/subscription/pricing.service.ts`（纯函数，零副作用）
- subscription.service.ts（upgrade / preview / available 方法）
- subscription.controller.ts

**API：**
- `GET /api/subscription/upgrade/available` — 可升级档位列表
- `GET /api/subscription/upgrade/preview?targetPlanId&targetPeriod` — 计价预览
- `POST /api/subscription/upgrade` — 确认升级

**升级预览缓存：** `GET /api/subscription/upgrade/preview` 使用服务端内存缓存（`Map<string, { data, ts }>`），同一用户+相同参数 1 分钟内重复请求直接返回缓存，避免重复计算。缓存 key = `userId:targetPlanId:targetPeriod`。**适用边界：** 当前内存缓存仅适用于单实例开发环境；后续多实例生产部署时需替换为 Redis 集中缓存，避免各实例缓存不一致。

**PricingService 测试场景（TDD，优先写）：**

| # | 场景 | 预期 |
|---|---|---|
| 1 | Pro包季→Max包季，剩余60天/积分70% | 正常抵扣，付差价 |
| 2 | 积分已耗尽（0%），时长剩余93% | min=0%，付全价 |
| 3 | Pro包季→Ultra包年，剩余45天/积分60% | min=50%，付差价 |
| 4 | Max包年→Ultra包年，剩余65天/积分44% | min=17.8%，付差价 |
| 5 | 可抵扣 ≥ 目标原价 | 免费升级，差额不返 |
| 6 | 向下升级（Max→Pro） | 拒绝 |
| 7 | 同档位变更周期（Max包月→Max包季） | 拒绝 |
| 8 | 非 active 订阅 | 拒绝 |

**升级事务步骤：**
1. 业务层幂等：当前订阅已是 upgraded → 直接返回
2. 创建升级订单 → 定价快照存档
3. 调用 credit.deductRegular 扣差价积分（仅普通积分）+ 写流水
4. `prisma.userSubscription.updateMany` — `WHERE id=? AND status='active' SET status='upgraded'` — 返回 count=0 则抛异常回滚
5. 原订阅积分清零 + upgrade_clear 流水，**同时将 UserBalance.subscriptionCreditsExpiry 置为 null**（与 CHECK 约束语义对齐：清零则无过期时间）
6. 创建新订阅（所有周期字段 + previousSubId）
   - **paidAmount = payableAmount（用户本次实际支付的差价），而非目标订阅原价**
   - 与新购订阅口径一致：paidAmount 始终代表用户为当前订阅实际支付的普通积分数量，作为后续再次升级的抵扣计算基数
   - 若 payableAmount = 0（免费升级），paidAmount = 0，后续再次升级时抵扣基数为 0
7. 发放新首月积分 + 写入 CreditTransaction（type=subscription_grant，creditType=subscription，amount 为正，referenceId=新订阅ID）+ 更新 expiry
8. @AuditLog 装饰器记录

**验证：** 事务原子性、updateMany 行级条件防并发、upgraded 后不可再次 upgraded

---

## Task 6: 自动续费开关（后端）

**依赖：** Task 3 完成

**文件：** subscription.controller.ts + subscription.service.ts

**API：**
- `POST /api/subscription/cancel-auto-renew` → autoRenew=false, cancelledAt=now（仅 active，幂等）
- `POST /api/subscription/enable-auto-renew` → autoRenew=true, cancelledAt=null（仅 active，幂等）

**验证：** 字段强一致，非 active 拒绝，重复调用幂等

---

## Task 7: BullMQ 定时任务

**依赖：** Task 4、5、6（订阅生命周期逻辑稳定）

**文件：**
- `apps/api/src/modules/subscription/task/grant-credit.processor.ts`
- `apps/api/src/modules/subscription/task/expire-subscription.processor.ts`
- `apps/api/src/modules/subscription/task/subscription-task.module.ts`

**队列配置：**

| 队列 | Cron | 时区 | 重试策略 | 死信队列 | 告警 |
|---|---|---|---|---|---|---|
| `subscription:expire` | 0 30 * * * | `timezone: 'UTC'`（显式指定） | 指数退避，最多 3 次 | `subscription:expire:dlq` | Sentry 告警 |
| `subscription:grant-credit` | 0 2 * * * | `timezone: 'UTC'`（显式指定） | 指数退避，最多 3 次 | `subscription:grant-credit:dlq` | Sentry 告警 |

**BullMQ 时区约束：** 两个定时任务的 Cron 均必须在 BullMQ 队列配置中显式指定 `timezone: 'UTC'`，禁止依赖服务器本地时区默认值，确保与全局 UTC 时间口径一致。

**双层去重机制：**
- 投递层：以订阅 ID 作为 BullMQ jobId，利用原生任务去重，同一订阅同一批次不重复投递
- 执行层：处理器内部二次校验业务状态（发放校验 nextGrantDate ≤ 今天 且 grantCount < 上限；到期校验 status=active），状态不匹配直接跳过

**grant-credit processor：**
- 扫描 `status=active AND nextGrantDate <= 今天 00:00:00 UTC`
- grantCount 达上限 → 跳过
- 发放 → 更新 nextGrantDate (+30天 00:00:00) + grantCount += 1
- 故障次日自动补发

**expire-subscription processor：**
- 扫描 `status=active AND currentPeriodEnd <= 今天 00:00:00 UTC`（`<=` 纳入当日到期，与 Spec「当日 00:00:00 视为当日到期」规则一致）
- cancelledAt 有值→cancelled，无值→expired
- 积分清零 + expiry → null + 写入 CreditTransaction（type=expire_clear，creditType=subscription，amount 为负，referenceId=订阅ID，referenceType=subscription）
- 二次校验 status=active（发放任务也会校验，兜底）

**分页批量处理机制：**
- 每次分页查询 100 条符合条件的订阅，处理完成后再查询下一批，直至全部处理完毕
- 单条订阅处理失败不影响同批次其他订阅，失败项计入执行统计并进入 BullMQ 重试
- 避免全量查询导致内存溢出或处理超时

**批次标识：** 每次定时任务执行生成唯一 batchId（`grant-{UTC日期}-{随机6位}`），所有处理记录与日志关联批次号，便于追踪特定批次异常与对账

**执行统计：** 每次执行后日志输出 [batchId=X] 处理数/成功数/失败数，未来接入 Prometheus 指标

**测试：** processor.spec.ts — 幂等测试（重复执行不重复发放）、死信流转测试

---

## Task 8: 管理端 API（后端）

**依赖：** Task 7（定时任务逻辑稳定，管理端可能触发积分/状态变更）

**文件：**
- `apps/api/src/modules/subscription/admin/admin-subscription.module.ts`
- `apps/api/src/modules/subscription/admin/admin-subscription.controller.ts`
- `apps/api/src/modules/subscription/admin/admin-subscription.service.ts`

**API：**（同 Spec §3.5）

**管理操作规则（实现校验）：**
- **终态不可逆：** expired / upgraded / cancelled 不可恢复为 active，仅允许修改终态订阅的备注类字段
- 修改续费字段 → 强制 autoRenew + cancelledAt 同步变更
- 作废 → cancelled + autoRenew=false + cancelledAt=now + 清零 + 审计（仅 active 可作废）
- 延长/缩短到期日 → 不自动调整积分发放节奏
- 发放 subscription 积分 → 校验 active 订阅存在，expiry=currentPeriodEnd
- **管理员操作流水关联规则（区分 creditType）：**

| 操作 | type | creditType | referenceId | referenceType |
|---|---|---|---|---|
| 发放订阅积分 | admin_grant | subscription | 当前订阅ID | subscription |
| 发放普通积分 | admin_grant | regular | 审计日志ID | admin |
| 作废清零订阅积分 | admin_clear | subscription | 当前订阅ID | subscription |

- 管理员发放/清零不复用 `consume` / `deductRegular` 方法，由 admin-subscription.service 独立处理流水写入，确保关联规则不受消费/支付逻辑干扰

**审计：** 所有写操作通过 @AuditLog 装饰器 + audit.service 写入 AuditLog

**测试：** 覆盖所有管理操作 + 边界规则校验 + 终态恢复 active 被拒绝

---

## Task 9: 前端 — 会员中心页面

**依赖：** Task 4、5、6（后端 API 就绪）

**文件：**
- `apps/web/src/pages/settings/membership/page.tsx`
- `apps/web/src/pages/settings/membership/components/PlanTable.tsx`
- `apps/web/src/pages/settings/membership/components/CurrentSubscription.tsx`
- `apps/web/src/pages/settings/membership/components/UpgradeModal.tsx`
- `apps/web/src/pages/settings/membership/components/OrderHistory.tsx`
- `apps/web/src/stores/subscriptionStore.ts`
- `apps/web/src/api/subscriptionApi.ts`
- `apps/web/src/hooks/useSubscription.ts` — 封装订阅状态查询（GET /api/subscription/me）+ **写操作**（subscribe、upgrade、cancelAutoRenew、enableAutoRenew），统一管理 loading、错误提示、成功后数据刷新
- `apps/web/src/hooks/useSubscriptionPlans.ts` — 封装套餐列表查询（GET /api/subscription/plans）
- `apps/web/src/hooks/useSubscriptionOrders.ts` — 封装订单列表查询（分页）

**API 封装风格：** 与 `useCreditBalance()` 保持一致，统一封装为自定义 Hooks：
- 基于项目现有 `apiFetch` 封装，**不引入 React Query/SWR 等新依赖**
- 查询 Hook 提供 `{ data, loading, error, refresh }` 接口
- **写操作 Hook**（subscribe、upgrade、cancelAutoRenew 等）提供 `{ execute, loading, error }` 接口，内置 loading 状态管理、错误提示、成功后自动调用相关查询 Hook 的 `refresh()` 刷新缓存
- 内部使用 `useState` + `useEffect` + `useCallback` 管理请求状态
- 页面组件不直接调用 apiFetch，统一通过 Hooks 获取数据与执行操作，避免重复编写请求与状态处理代码

**Store 数据职责边界（单一数据源）：**
- `subscriptionStore`：仅存储订阅元信息（tier、period、currentPeriodEnd、autoRenew），不存储积分余额。Store 作为 Hooks 之间的桥接层，订阅状态变更后同步更新
- **`useCreditBalance()` Hook**：统一封装 `/api/credits/balance` 请求，全局共享缓存，提供 `{ credits, subscriptionCredits, subscriptionCreditsExpiry, refresh }` — 所有积分展示场景统一复用
- 订阅/升级/取消续费操作成功 → 调用 `refresh()` 刷新积分 + 更新 subscriptionStore

**功能开关前端 Hook：** `useSubscriptionFeature()` — 读取 Vite 构建时注入的环境变量（`import.meta.env.VITE_SUBSCRIPTION_ENABLED` / `VITE_SUBSCRIPTION_UPGRADE_ENABLED` / `VITE_SUBSCRIPTION_ADMIN_GRANT_ENABLED`），统一暴露 boolean 值控制入口显隐

**路由：** `/settings/membership`（AuthGuard）

**功能开关前端 Hook：** `apps/web/src/hooks/useSubscriptionFeature.ts`
```typescript
// 统一读取 Vite 环境变量，集中管理开关状态
function useSubscriptionFeature(): {
  subscriptionEnabled: boolean;
  upgradeEnabled: boolean;
  adminGrantEnabled: boolean;
}
```
各页面通过 Hook 判断入口显隐，避免重复编写判断逻辑。后续若需动态开关能力，平滑替换为 API 获取，Hook 接口不变。

**测试：**
- 未订阅用户看到套餐表格 → 点击订阅 → 弹窗确认 → 成功
- 已订阅用户看到详情卡片 + 升级入口
- 升级：选档位→preview→明细弹窗→确认→成功
- 取消/开启续费
- 订单历史分页
- 功能开关关闭 → 入口隐藏 + 页面提示而非白屏

---

## Task 10: 前端 — Navbar 改造 + Admin 后台 Tab

**依赖：** Task 9（subscriptionStore 就绪）

**Navbar 改造：**
- 积分显示 = credits + subscriptionCredits（从 balance API 读取）
- 已订阅用户显示会员等级徽章（tier 色标）
- 悬停 tooltip：普通积分 / 订阅积分 明细 + 到期日
- 点击 → `/settings/membership`；功能开关关闭 → 隐藏会员入口

**Admin 4 个 Tab：**
- PlanManagementTab — 表格 + 弹窗编辑 + sort 拖拽
- SubscriptionManagementTab — 搜索栏 + 表格 + 修改/作废操作
- OrderManagementTab — 筛选栏 + 分页列表
- CreditManagementTab — 发放弹窗 + 流水筛选列表

**测试：** Navbar 改造验证、Admin Tab CRUD 验证

---

## 补充测试场景（各 Task 测试文件中覆盖）

| 类别 | 场景 |
|---|---|
| 并发 | 两请求同时升级同一订阅 → 一个成功一个失败 |
| 并发 | 升级与消费同时执行 → 事务串行化，一个重试成功 |
| 幂等 | 定时任务同一订阅重复执行 → 不重复发放 |
| 幂等 | 积分清零重复执行（升级/到期/作废）→ 余额始终为 0，不出现负数 |
| 状态机 | active→upgraded / active→expired / active→cancelled（合法流转） |
| 状态机 | upgraded/expired/cancelled 尝试 upgrade/cancel → 拒绝（终态不可操作） |
| 状态机 | 管理员尝试将终态恢复为 active → 拒绝 |
| 边界 | 管理员作废→升级→到期多种组合状态流转 |
| 开关 | 各功能开关关闭时 API 返回 403，前端入口隐藏 |
| 时区 | 积分发放、到期时间跨 UTC 日期边界正确 |

---

## 全局验证命令

```bash
# 全量测试
pnpm test

# 单模块测试
pnpm --filter api test -- --reporter=verbose
pnpm --filter web test -- --reporter=verbose

# 类型检查
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
pnpm --filter shared exec tsc --noEmit

# 验证部分唯一索引
pnpm --filter api exec prisma db execute --file verify-indexes.sql

# 启动全栈联调
pnpm dev
```

---

## 开发规范与约定

### TDD 执行顺序
- **优先 TDD**：计价引擎（pricing.service）、积分扣减（consume/deductRegular）等纯逻辑模块 → 先写测试，再写实现
- **后补测试**：接口 Controller、前端页面组件 → 实现后补充集成测试
- **核心资产 100% 覆盖**：定价计算、积分扣减、升级事务三个核心逻辑的所有边界场景

### 统一错误码

| 错误码 | 含义 | HTTP |
|---|---|---|
| `CREDIT_INSUFFICIENT` | 积分余额不足 | 400 |
| `SUBSCRIPTION_ACTIVE_EXISTS` | 已存在生效订阅，不可重复购买 | 400 |
| `SUBSCRIPTION_NOT_ACTIVE` | 无生效订阅，操作不可执行 | 400 |
| `UPGRADE_INVALID_TIER` | 仅支持向上升级 | 400 |
| `SUBSCRIPTION_STATUS_INVALID` | 当前订阅状态不支持此操作 | 400 |
| `SUBSCRIPTION_FEATURE_DISABLED` | 订阅功能未开放 | 403 |
| `GRANT_NO_ACTIVE_SUB` | 无生效订阅，不可发放订阅积分 | 400 |
| `STATE_MACHINE_TERMINAL` | 终态不可逆回 active | 400 |

### 积分清零约束
所有积分清零场景（升级清零、到期清零、管理员作废清零）统一使用 `subscriptionCredits = 0` **直接赋值**，禁止使用 `-=` 减法运算。原因：避免并发场景下减法产生负积分，直接赋值为 0 是幂等安全的。

### Prisma 事务实例使用规范
所有 `prisma.$transaction` 回调内的数据库操作，**必须使用事务回调参数 `tx` 实例**执行查询与更新，**禁止在事务内使用全局 `prisma` 实例**。原因：全局 prisma 操作不受事务保护，事务回滚时不会撤销，导致数据不一致。事务回滚测试必须覆盖此场景：

```typescript
// ✅ 正确
await prisma.$transaction(async (tx) => {
  await tx.userBalance.update(...)
  await tx.userSubscription.create(...)
})

// ❌ 错误 — prisma 不受事务保护
await prisma.$transaction(async (tx) => {
  await prisma.userBalance.update(...)  // 回滚无效
})
```

### 乐观锁重试边界
- **仅针对 version 冲突（affected rows = 0）重试**，2-3 次，指数退避
- **每次重试前必须重新查询**最新的 version 与余额数据，不可复用旧值
- **余额不足、状态非法等业务异常不重试**，直接抛出错误，避免无效循环
- consume / deductRegular 方法统一执行此重试策略

### 前端功能开关注入方式
功能开关值通过 Vite 构建时环境变量统一注入（`import.meta.env.VITE_SUBSCRIPTION_ENABLED` 等），在 `useSubscriptionFeature()` Hook 中集中读取并暴露 boolean 值。后续若需动态开关能力（如管理后台实时切换），平滑替换为 API 获取即可，Hook 接口不变。

### 接口响应格式
所有接口遵循现有 `{ code: 0, data: ..., message: 'ok' }` 格式，错误时 `code: -1`，由 `TransformInterceptor` / `HttpExceptionFilter` 统一包裹。

### 测试 Mock 规范
- 数据库：使用真实的测试数据库（现有惯例），不做 mock
- BullMQ：队列处理器使用 mock 队列
- 外部 API：无需 mock（本期无外部依赖）

### 时区全链路
- 后端：所有时间字段 UTC 存储，定时任务按 UTC 自然日执行
- 前端：通过 dayjs 转本地时间展示
- 联调重点：积分发放日、到期日的 UTC → 本地时间日期边界正确性

### 事务回滚验证
新订阅、升级、积分消费三个核心流程的测试必须覆盖：中途异常触发回滚，不会出现「扣了积分但没创建订阅」等半成功状态。
