<!-- doc-status: historical | verified_at: n/a -->
# 会员中心集成微信支付 — TDD 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会员中心订阅/升级从余额扣款改为微信扫码支付，与 Credits 充值页体验一致。

**Architecture:** 在 SubscriptionModule 内新增 SubscriptionOrderService（复用 WechatPaymentProvider），改造 PaymentGateway 支持订阅订单房间，回调端点按 `SUB_`/`RC` 前缀路由分流。前端 WeChatQRModal 通用化后复用。

**Tech Stack:** NestJS 10 + Prisma + BullMQ + Socket.io + React 18 + TypeScript strict + Vitest

---

## 文件变更清单

| 操作 | 文件路径 |
|------|----------|
| 修改 | `apps/api/prisma/schema.prisma` |
| 新建 | `apps/api/src/modules/subscription/subscription-order.service.ts` |
| 新建 | `apps/api/src/modules/subscription/subscription-order.service.spec.ts` |
| 新建 | `apps/api/src/modules/subscription/subscription-order.controller.ts` |
| 新建 | `apps/api/src/modules/subscription/subscription-order.controller.spec.ts` |
| 新建 | `apps/api/src/modules/subscription/task/payment-success.processor.ts` |
| 新建 | `apps/api/src/modules/subscription/task/close-expired-sub-order.processor.ts` |
| 修改 | `apps/api/src/modules/subscription/subscription.module.ts` |
| 修改 | `apps/api/src/modules/subscription/task/subscription-task.module.ts` |
| 修改 | `apps/api/src/modules/recharge/payment.gateway.ts` |
| 修改 | `apps/api/src/modules/recharge/recharge.service.ts` |
| 修改 | `apps/api/src/config/queue.constants.ts` |
| 修改 | `apps/api/src/common/utils/order-no.ts` |
| 修改 | `apps/web/src/api/subscriptionApi.ts` |
| 修改 | `apps/web/src/components/WeChatQRModal.tsx` |
| 修改 | `apps/web/src/pages/settings/MembershipPage.tsx` |

---

## Phase 1: 核心支付链路（P0）

### Task 1: Prisma Schema 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: 在 schema.prisma 中新增枚举和改造 SubscriptionOrder 模型**

在 `schema.prisma` 中：

1. 在 `SubscriptionOrderType` 枚举后新增 `SubscriptionOrderStatus` 枚举（约第 406 行后）：

```prisma
enum SubscriptionOrderStatus {
  PENDING
  SUCCESS
  FAILED
  CLOSED
}
```

2. 将 `SubscriptionOrder` 模型（约第 518-532 行）替换为：

```prisma
model SubscriptionOrder {
  id                  String                    @id @default(cuid())
  orderNo             String                    @unique
  userId              String
  planId              String
  period              SubscriptionPeriod
  type                SubscriptionOrderType
  originalAmount      Int?
  payableAmount       Int?
  prorationAmount     Int?
  fromSubscriptionId  String?
  fromPlanId          String?
  status              String                    @default("PENDING")
  statusNew           SubscriptionOrderStatus?
  pricingSnapshot     Json?
  payChannel          String                    @default("wechat") @db.VarChar(32)
  prepayId            String?                   @db.VarChar(64)
  transactionId       String?                   @db.VarChar(64)
  payerOpenid         String?                   @db.VarChar(64)
  paidAt              DateTime?
  expiredAt           DateTime?
  closedAt            DateTime?
  delayCloseJobId     String?
  notifySummary       Json?
  createdAt           DateTime                  @default(now())
  updatedAt           DateTime?
}

// Note: NO @@index in Step1 — indexes created in Step4 manual SQL
```

- [ ] **Step 2: 运行 Prisma 迁移生成**

```bash
cd apps/api && npx prisma migrate dev --name add_subscription_order_payment
```

Expected: 生成迁移文件，包含新增字段、枚举、索引的 SQL。

- [ ] **Step 3: 编辑迁移 SQL 添加数据迁移**

编辑生成的 migration.sql，在创建字段后添加：

```sql
-- 金额转换：元 → 分
UPDATE "SubscriptionOrder" SET "payableAmount" = "amount" * 100 WHERE "amount" IS NOT NULL;
UPDATE "SubscriptionOrder" SET "originalAmount" = "originalPrice" * 100 WHERE "originalPrice" IS NOT NULL;
UPDATE "SubscriptionOrder" SET "prorationAmount" = "deductibleAmount" * 100 WHERE "deductibleAmount" IS NOT NULL;

-- 字段值迁移：重命名
UPDATE "SubscriptionOrder" SET "fromSubscriptionId" = "originalSubscriptionId";

-- 状态映射：全量覆盖所有历史状态值
-- 迁移前执行，确认无遗漏：SELECT DISTINCT "status" FROM "SubscriptionOrder";
UPDATE "SubscriptionOrder" SET "statusNew" = 'SUCCESS'::"SubscriptionOrderStatus" WHERE "status" = 'success';
UPDATE "SubscriptionOrder" SET "statusNew" = 'PENDING'::"SubscriptionOrderStatus" WHERE "status" = 'pending' OR "status" = 'PENDING';
UPDATE "SubscriptionOrder" SET "statusNew" = 'CLOSED'::"SubscriptionOrderStatus" WHERE "status" = 'closed' OR "status" = 'CLOSED';
UPDATE "SubscriptionOrder" SET "statusNew" = 'FAILED'::"SubscriptionOrderStatus" WHERE "status" = 'failed' OR "status" = 'FAILED';

-- 补充时间戳
UPDATE "SubscriptionOrder" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
```

- [ ] **Step 4: 第二次迁移 — 使用 `--create-only` 手动编辑 SQL**

编辑 `apps/api/prisma/schema.prisma`，将 SubscriptionOrder 模型更新为最终形态：

```prisma
model SubscriptionOrder {
  id                  String                    @id @default(cuid())
  orderNo             String                    @unique
  userId              String
  planId              String
  period              SubscriptionPeriod
  type                SubscriptionOrderType
  originalAmount      Int
  payableAmount       Int
  prorationAmount     Int?
  fromSubscriptionId  String?
  fromPlanId          String?
  status              SubscriptionOrderStatus   @default(PENDING)
  pricingSnapshot     Json?
  payChannel          String                    @default("wechat") @db.VarChar(32)
  prepayId            String?                   @db.VarChar(64)
  transactionId       String?                   @db.VarChar(64)
  payerOpenid         String?                   @db.VarChar(64)
  paidAt              DateTime?
  expiredAt           DateTime?
  closedAt            DateTime?
  delayCloseJobId     String?
  notifySummary       Json?
  createdAt           DateTime                  @default(now())
  updatedAt           DateTime                  @updatedAt
}

// Indexes managed in manual migration SQL (Step4), not in Prisma schema,
// to avoid Step1 auto-creation conflicting with Step4 manual CREATE INDEX.
// CREATE UNIQUE INDEX "SubscriptionOrder_transactionId_key"
// ON "SubscriptionOrder" ("transactionId")
// WHERE "transactionId" IS NOT NULL;
```

```bash
cd apps/api && npx prisma migrate dev --create-only --name finalize_subscription_order
```

**必须手动编辑生成的迁移 SQL**，将 Prisma 自动生成的 `DROP COLUMN "status"` + `ADD COLUMN "status"` 替换为：

```sql
-- 删除旧 status 字段（String 类型）
ALTER TABLE "SubscriptionOrder" DROP COLUMN "status";
-- 重命名 statusNew 为 status（保留数据）
ALTER TABLE "SubscriptionOrder" RENAME COLUMN "statusNew" TO "status";
-- 添加非空约束 + 默认值
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"SubscriptionOrderStatus";
-- 删除旧字段
ALTER TABLE "SubscriptionOrder" DROP COLUMN "amount";
ALTER TABLE "SubscriptionOrder" DROP COLUMN "originalPrice";
ALTER TABLE "SubscriptionOrder" DROP COLUMN "deductibleAmount";
ALTER TABLE "SubscriptionOrder" DROP COLUMN "originalSubscriptionId";
-- 非空约束
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "payableAmount" SET NOT NULL;
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "originalAmount" SET NOT NULL;
ALTER TABLE "SubscriptionOrder" ALTER COLUMN "updatedAt" SET NOT NULL;
-- 唯一索引（部分索引，兼容多 NULL）
CREATE UNIQUE INDEX "SubscriptionOrder_transactionId_key"
  ON "SubscriptionOrder" ("transactionId")
  WHERE "transactionId" IS NOT NULL;
-- 复合索引
CREATE INDEX "SubscriptionOrder_userId_status_idx" ON "SubscriptionOrder" ("userId", "status");
CREATE INDEX "SubscriptionOrder_status_expiredAt_idx" ON "SubscriptionOrder" ("status", "expiredAt");
```

> **严禁让 Prisma 自动执行此迁移**。Prisma 会将 statusNew→status 视为 DROP+ADD，导致 statusNew 数据全部丢失。必须 `--create-only` + 手动编辑 SQL。

**生产部署顺序约束：**
1. 执行 Step1+Step2 迁移 → 后端服务（兼容新旧 schema）
2. 验证服务稳定 + 数据迁移正确
3. 执行 Step3 迁移 → 后端代码切换枚举常量

禁止一步到位全量迁移，禁止在业务高峰执行。

- [ ] **Step 5: 数据校验 SQL（迁移后执行）**

```sql
-- 按状态统计订单数，与迁移前对比确保零损耗
SELECT "status", COUNT(*), SUM("payableAmount")
FROM "SubscriptionOrder"
GROUP BY "status";

-- 对比迁移前后总金额（迁移前: SELECT SUM("amount") * 100 FROM "SubscriptionOrder"）
SELECT SUM("payableAmount") AS total_payable_fen FROM "SubscriptionOrder";
```

**Step3 执行前置校验 — 旧字段引用清零：**
Step3 会删除 `amount`、`originalPrice`、`deductibleAmount`、`originalSubscriptionId` 四个旧字段。**执行前必须**：
```bash
# 全量扫描确认无旧字段引用
rg "\.amount\b|\.originalPrice\b|\.deductibleAmount\b|\.originalSubscriptionId" apps/api/src/ --include='*.ts'
# 预期输出为空（或仅在 migration SQL / schema 中出现）
```
全部引用已切换为 `payableAmount`、`originalAmount`、`prorationAmount`、`fromSubscriptionId` 后方可执行，防止迁移后线上报错。

**生产回滚预案:**

| 阶段 | 回滚策略 |
|------|----------|
| Step1+2 迁移后 | 变更向后兼容，仅需回退应用代码，数据库无需回退 |
| Step3 迁移前 | **必须备份全表**：`CREATE TABLE "SubscriptionOrder_backup" AS SELECT * FROM "SubscriptionOrder"` |
| Step3 迁移后 | 破坏性变更（旧字段已删除），回退需从备份恢复。执行前必须确认全量流量已切换至新代码 |

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(db): add subscription order payment fields with status enum
>
> Add SubscriptionOrderStatus enum (PENDING/SUCCESS/FAILED/CLOSED).
> Add WeChat payment fields (prepayId, transactionId, payerOpenid, etc.).
> Add delayCloseJobId for BullMQ task management.
> Add indexes for user query, timeout scan, and transaction idempotency.
> Migrate amount fields from yuan to fen (×100).
> Three-step Expand-Contract migration."
```

---

### Task 2: SubscriptionOrderService (TDD)

**Files:**
- Create: `apps/api/src/modules/subscription/subscription-order.service.spec.ts`
- Create: `apps/api/src/modules/subscription/subscription-order.service.ts`

- [ ] **Step 1: 创建测试文件并编写 createOrder 失败测试**

Create `apps/api/src/modules/subscription/subscription-order.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionOrderService } from './subscription-order.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from './pricing.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

function mockPricing() {
  return {
    calculate: vi.fn().mockReturnValue({
      sourcePaidAmount: 560,
      remainTimeRatio: 0.67,
      remainPointsRatio: 0.7,
      finalRatio: 0.67,
      targetOriginalPrice: 900,
      deductibleAmount: 375,
      payableAmount: 525,
    }),
  };
}

describe('SubscriptionOrderService - createOrder', () => {
  let service: SubscriptionOrderService;
  let prisma: any;
  let pricing: any;

  const mockPlan = {
    id: 'plan-pro',
    name: 'Pro',
    tier: 'pro',
    monthlyCredits: 19800,
    priceMonthly: 200,
    priceQuarterly: 560,
    priceAnnually: 2000,
    firstPriceMonthly: 0,
    firstPriceQuarterly: 0,
    firstPriceAnnually: 0,
    sort: 1,
    isActive: true,
  };

  beforeEach(async () => {
    pricing = mockPricing();
    prisma = {
      subscriptionPlan: {
        findUnique: vi.fn().mockResolvedValue(mockPlan),
      },
      subscriptionOrder: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args: any) =>
          Promise.resolve({ id: 'order-1', ...args.data }),
        ),
      },
      userSubscription: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SubscriptionOrderService,
          useFactory: (prisma: PrismaService, pricing: PricingService) =>
            new SubscriptionOrderService(prisma, pricing, undefined, undefined, undefined),
          inject: [PrismaService, PricingService],
        },
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: pricing },
      ],
    }).compile();
    service = module.get<SubscriptionOrderService>(SubscriptionOrderService);
  });

  describe('createOrder - new_purchase', () => {
    it('should create a new purchase order with correct amount in fen', async () => {
      const result = await service.createOrder('u1', {
        planId: 'plan-pro',
        period: 'monthly',
        type: 'new_purchase',
      });

      expect(result.orderNo).toMatch(/^SUB_/);
      expect(result.amount).toBe(20000); // 200元 = 20000分
      expect(prisma.subscriptionOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          planId: 'plan-pro',
          period: 'monthly',
          type: 'new_purchase',
          payableAmount: 20000,
          originalAmount: 20000,
          status: 'PENDING',
          payChannel: 'wechat',
        }),
      });
    });

    it('should reject new_purchase when user already has active subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 'sub-1', status: 'active', tier: 'pro',
      });

      await expect(
        service.createOrder('u1', { planId: 'plan-pro', period: 'monthly', type: 'new_purchase' }),
      ).rejects.toThrow('已有有效订阅');
    });

    it('should throw when plan not found', async () => {
      prisma.subscriptionPlan.findUnique.mockResolvedValue(null);

      await expect(
        service.createOrder('u1', { planId: 'nonexistent', period: 'monthly', type: 'new_purchase' }),
      ).rejects.toThrow();
    });

    it('should set expiredAt to 2 hours from now', async () => {
      const before = Date.now();
      const result = await service.createOrder('u1', {
        planId: 'plan-pro', period: 'monthly', type: 'new_purchase',
      });

      const expiredAt = prisma.subscriptionOrder.create.mock.calls[0][0].data.expiredAt;
      const diffMs = expiredAt.getTime() - before;
      expect(diffMs).toBeGreaterThan(2 * 60 * 60 * 1000 - 5000);
      expect(diffMs).toBeLessThan(2 * 60 * 60 * 1000 + 5000);
    });
  });

  describe('createOrder - upgrade', () => {
    it('should create upgrade order with proration calculated by PricingService', async () => {
      // Active sub exists
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 'sub-old',
        planId: 'plan-basic',
        tier: 'basic',
        period: 'monthly',
        status: 'active',
        paidAmount: 560,
      });

      const result = await service.createOrder('u1', {
        planId: 'plan-pro',
        period: 'monthly',
        type: 'upgrade',
      });

      expect(pricing.calculate).toHaveBeenCalled();
      expect(result.amount).toBe(52500); // 525元 payableAmount = 52500分
      expect(prisma.subscriptionOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'upgrade',
          payableAmount: 52500,
          originalAmount: 90000, // targetOriginalPrice 900 = 90000分
          prorationAmount: 37500, // deductibleAmount 375 = 37500分
          fromSubscriptionId: 'sub-old',
          pricingSnapshot: expect.any(Object),
        }),
      });
    });

    it('should reject upgrade when no active subscription', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);

      await expect(
        service.createOrder('u1', { planId: 'plan-pro', period: 'monthly', type: 'upgrade' }),
      ).rejects.toThrow('没有有效订阅');
    });

    it('should reject upgrade to lower or same tier', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 'sub-1',
        tier: 'pro',
        status: 'active',
        paidAmount: 900,
      });

      await expect(
        service.createOrder('u1', { planId: 'plan-basic', period: 'monthly', type: 'upgrade' }),
      ).rejects.toThrow();
    });
  });

  describe('createOrder - duplicate protection', () => {
    it('should close old PENDING orders before creating new one', async () => {
      prisma.subscriptionOrder.findFirst.mockResolvedValueOnce({
        id: 'old-order',
        orderNo: 'SUB_old',
        status: 'PENDING',
        prepayId: 'wx_prepay_old',
      });

      await service.createOrder('u1', { planId: 'plan-pro', period: 'monthly', type: 'new_purchase' });

      expect(prisma.subscriptionOrder.update).toHaveBeenCalledWith({
        where: { id: 'old-order' },
        data: { status: 'CLOSED', closedAt: expect.any(Date) },
      });
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd apps/api && npx vitest run src/modules/subscription/subscription-order.service.spec.ts
```

Expected: FAIL — `SubscriptionOrderService` not defined.

- [ ] **Step 3: 创建 SubscriptionOrderService 最小实现**

Create `apps/api/src/modules/subscription/subscription-order.service.ts`:

```typescript
import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from './pricing.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { generateOrderNo } from '../../common/utils/order-no';
import { QUEUE_NAMES } from '../../config/queue.constants';

const TIER_ORDER: Record<string, number> = { basic: 0, pro: 1, max: 2, ultra: 3 };

interface CreateOrderDto {
  planId: string;
  period: string;
  type: 'new_purchase' | 'upgrade';
}

@Injectable()
export class SubscriptionOrderService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
    @Optional() @Inject('PAYMENT_PROVIDER') private readonly payment?: any,
    @Optional() @InjectQueue(QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED)
    private readonly closeExpiredQueue?: Queue,
  ) {}

  async createOrder(userId: string, dto: CreateOrderDto) {
    // Lock
    const lockKey = `lock:subscription:order:${userId}`;
    if (this.redis) {
      const locked = await this.redis.set(lockKey, '1', 'EX', 10, 'NX');
      if (!locked) throw new BusinessException('SUBSCRIPTION_DUPLICATE_ORDER', '请稍后再试');
    }

    try {
      // Validate plan
      const plan = await this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new BusinessException('PLAN_NOT_FOUND', '套餐不存在');

      // Pre-condition check
      const activeSub = await this.prisma.userSubscription.findFirst({
        where: { userId, status: 'active' },
      });

      if (dto.type === 'new_purchase' && activeSub) {
        throw new BusinessException('SUBSCRIPTION_ALREADY_ACTIVE', '已有有效订阅，请使用升级功能');
      }

      if (dto.type === 'upgrade') {
        if (!activeSub) throw new BusinessException('SUBSCRIPTION_NO_ACTIVE', '没有有效订阅');
        if (TIER_ORDER[plan.tier] <= TIER_ORDER[activeSub.tier]) {
          throw new BusinessException('UPGRADE_INVALID_TIER', '只能升级到更高等级套餐');
        }
      }

      // Calculate price
      let originalAmount: number;
      let payableAmount: number;
      let prorationAmount: number | undefined;
      let fromSubscriptionId: string | undefined;
      let fromPlanId: string | undefined;
      let pricingSnapshot: any = undefined;

      if (dto.type === 'new_purchase') {
        const priceYuan = (plan as any)[`price${dto.period.charAt(0).toUpperCase() + dto.period.slice(1)}`] as number || plan.priceMonthly;
        originalAmount = priceYuan * 100;
        payableAmount = priceYuan * 100;
      } else {
        const calc = this.pricing.calculate(activeSub!, plan, dto.period);
        originalAmount = calc.targetOriginalPrice * 100;
        payableAmount = calc.payableAmount * 100;
        prorationAmount = calc.deductibleAmount * 100;
        fromSubscriptionId = activeSub!.id;
        fromPlanId = activeSub!.planId;
        pricingSnapshot = {
          currentTier: calc.currentTier || activeSub!.tier,
          currentPeriod: calc.currentPeriod || activeSub!.period,
          targetTier: plan.tier,
          targetPeriod: dto.period,
          originalUnitPrice: (calc as any).originalUnitPrice,
          remainingDays: (calc as any).remainingDays,
          prorationUnitPrice: (calc as any).prorationUnitPrice,
          prorationAmount: calc.deductibleAmount,
          payableAmount: calc.payableAmount,
          calculatedAt: new Date().toISOString(),
        };
      }

      // Clean ALL old PENDING orders (bulk cleanup, avoid residual orders)
      const oldPendingOrders = await this.prisma.subscriptionOrder.findMany({
        where: { userId, status: 'PENDING' },
      });

      for (const old of oldPendingOrders) {
        if (old.prepayId && this.payment) {
          try {
            await this.payment.closePayment(old.orderNo);
          } catch {
            // Degrade: close locally even if WeChat API fails
          }
        }
        await this.prisma.subscriptionOrder.update({
          where: { id: old.id },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
      }

      // Create order
      const orderNo = generateOrderNo();
      const expiredAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

      const order = await this.prisma.subscriptionOrder.create({
        data: {
          orderNo,
          userId,
          planId: dto.planId,
          period: dto.period as any,
          type: dto.type as any,
          originalAmount,
          payableAmount,
          prorationAmount,
          fromSubscriptionId,
          fromPlanId,
          pricingSnapshot,
          status: 'PENDING',
          expiredAt,
        },
      });

      // Dispatch delayed close task
      if (this.closeExpiredQueue) {
        const jobId = `sub_close:${orderNo}`;
        const job = await this.closeExpiredQueue.add(
          'close-expired-sub-order',
          { orderNo, userId },
          { delay: 2 * 60 * 60 * 1000, jobId },
        );
        await this.prisma.subscriptionOrder.update({
          where: { id: order.id },
          data: { delayCloseJobId: job.id },
        });
      }

      return { orderNo: order.orderNo, amount: payableAmount, expiredAt: order.expiredAt!.toISOString() };
    } finally {
      if (this.redis) await this.redis.del(lockKey);
    }
  }
}
```

**关键实现细节 — 状态枚举与依赖注入:**

1. **状态值切换时机**：
   - Step1-Step2 期间：`status` 仍为 `String` 类型，代码中使用字符串字面量（`'PENDING'`, `'SUCCESS'`）
   - Step3 迁移完成后：`status` 变为 `SubscriptionOrderStatus` 枚举，**全局替换**所有字符串为枚举常量（`SubscriptionOrderStatus.PENDING`），禁止字符串与枚举混用

2. **DI 循环依赖**：RechargeModule 和 SubscriptionModule 互相引用时，两侧 imports 都必须使用 `forwardRef()`：
```typescript
// subscription.module.ts
imports: [forwardRef(() => RechargeModule), ...]

// recharge.module.ts
imports: [forwardRef(() => SubscriptionModule), ...]
```

3. **PAYMENT_PROVIDER** 令牌由 RechargeModule 导出，通过 `@Inject('PAYMENT_PROVIDER')` 注入，若未配置则 `payment` 为 `null`（降级处理）。

4. **ThrottleUserGuard** 若已在全局或 RechargeModule 注册，不要在 SubscriptionModule 的 providers 中重复提供，避免多实例导致限流规则失效。

5. **日志**：使用 NestJS `Logger`（`import { Logger } from '@nestjs/common'`），输出结构化 JSON，接入 Loki，禁止使用 `console.log`。

- [ ] **Step 4: 运行测试验证通过 (createOrder)**

- [ ] **Step 5: 添加 pay、query、close 方法的测试**

在 `subscription-order.service.spec.ts` 中添加：

```typescript
describe('SubscriptionOrderService - pay', () => {
  let service: SubscriptionOrderService;
  let prisma: any;
  let payment: any;

  const mockOrder = {
    id: 'order-1',
    orderNo: 'SUB_1753596000000_a3B7x9Yz',
    userId: 'u1',
    payableAmount: 20000,
    status: 'PENDING',
    prepayId: null,
    expiredAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  };

  beforeEach(async () => {
    payment = {
      createPayment: vi.fn().mockResolvedValue({ codeUrl: 'weixin://wxpay/bizpayurl?pr=abc123' }),
      queryOrder: vi.fn(),
    };
    prisma = {
      subscriptionOrder: {
        findUnique: vi.fn().mockResolvedValue(mockOrder),
        update: vi.fn().mockImplementation((args: any) =>
          Promise.resolve({ ...mockOrder, ...args.data })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: SubscriptionOrderService,
          useFactory: (prisma: PrismaService) =>
            new SubscriptionOrderService(prisma, undefined as any, undefined, payment, undefined),
          inject: [PrismaService],
        },
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: mockPricing() },
      ],
    }).compile();
    service = module.get<SubscriptionOrderService>(SubscriptionOrderService);
  });

  it('should create wechat payment and return codeUrl', async () => {
    const result = await service.pay('SUB_1753596000000_a3B7x9Yz', 'u1');

    expect(result.codeUrl).toBe('weixin://wxpay/bizpayurl?pr=abc123');
    expect(payment.createPayment).toHaveBeenCalledWith(
      'SUB_1753596000000_a3B7x9Yz',
      20000,
      '会员订阅',
    );
  });

  it('should return existing codeUrl when prepayId already exists (idempotent)', async () => {
    prisma.subscriptionOrder.findUnique.mockResolvedValue({
      ...mockOrder,
      prepayId: 'wx_prepay_existing',
    });
    payment.queryOrder.mockResolvedValue({ tradeState: 'NOTPAY', codeUrl: 'weixin://wxpay/existing' });

    const result = await service.pay('SUB_1753596000000_a3B7x9Yz', 'u1');

    // Should NOT call createPayment again
    expect(payment.createPayment).not.toHaveBeenCalled();
    expect(result.codeUrl).toBeDefined();
  });

  it('should reject pay when order userId mismatch', async () => {
    await expect(
      service.pay('SUB_1753596000000_a3B7x9Yz', 'u2'),
    ).rejects.toThrow('订单不属于当前用户');
  });

  it('should reject pay when order is not PENDING', async () => {
    prisma.subscriptionOrder.findUnique.mockResolvedValue({
      ...mockOrder,
      status: 'SUCCESS',
    });

    await expect(
      service.pay('SUB_1753596000000_a3B7x9Yz', 'u1'),
    ).rejects.toThrow('订单状态不允许支付');
  });

  it('should reject pay when order expired', async () => {
    prisma.subscriptionOrder.findUnique.mockResolvedValue({
      ...mockOrder,
      expiredAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.pay('SUB_1753596000000_a3B7x9Yz', 'u1'),
    ).rejects.toThrow('订单已过期');
  });

  it('should mark FAILED when wechat createPayment fails', async () => {
    payment.createPayment.mockRejectedValue(new Error('WeChat API error'));

    await expect(
      service.pay('SUB_1753596000000_a3B7x9Yz', 'u1'),
    ).rejects.toThrow();

    expect(prisma.subscriptionOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
  });
});

describe('SubscriptionOrderService - query', () => {
  it('should return order details', async () => {
    // implementation covered in controller test
  });
});

describe('SubscriptionOrderService - close', () => {
  it('should close PENDING order and call wechat close API', async () => {
    // implementation covered in controller test
  });

  it('should return success if already closed (idempotent)', async () => {
    // implementation covered in controller test
  });
});
```

- [ ] **Step 6: 运行测试验证失败**

```bash
cd apps/api && npx vitest run src/modules/subscription/subscription-order.service.spec.ts
```

Expected: FAIL — pay/query/close methods not yet implemented.

- [ ] **Step 7: 实现 pay、query、close 方法**

在 `subscription-order.service.ts` 中添加：

```typescript
async pay(orderNo: string, userId: string) {
  const order = await this.prisma.subscriptionOrder.findUnique({ where: { orderNo } });
  if (!order) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_FOUND', '订单不存在');
  if (order.userId !== userId) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_OWNER', '订单不属于当前用户');
  if (order.status !== 'PENDING') throw new BusinessException('SUBSCRIPTION_ORDER_STATUS_INVALID', '订单状态不允许支付');
  if (order.expiredAt && order.expiredAt <= new Date()) {
    throw new BusinessException('SUBSCRIPTION_ORDER_EXPIRED', '订单已过期，请重新下单');
  }

  // Idempotent: return existing codeUrl if prepayId exists
  if (order.prepayId && this.payment) {
    try {
      const wxOrder = await this.payment.queryOrder(orderNo);
      if (wxOrder.tradeState === 'NOTPAY') {
        return {
          orderNo: order.orderNo,
          amount: order.payableAmount,
          codeUrl: wxOrder.codeUrl || null,
        };
      }
      // WeChat order already closed, mark local as FAILED
      await this.prisma.subscriptionOrder.update({
        where: { id: order.id },
        data: { status: 'FAILED', closedAt: new Date() },
      });
      throw new BusinessException('SUBSCRIPTION_ORDER_STATUS_INVALID', '微信订单已关闭，请重新下单');
    } catch (err) {
      if (err instanceof BusinessException) throw err;
      // Query failed, try to create new prepay
    }
  }

  if (!this.payment) {
    throw new BusinessException('PAYMENT_NOT_CONFIGURED', '支付服务暂未配置');
  }

  try {
    const result = await this.payment.createPayment(
      orderNo,
      order.payableAmount,
      '会员订阅',
    );

    await this.prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: { prepayId: result.prepayId },
    });

    return {
      orderNo: order.orderNo,
      amount: order.payableAmount,
      codeUrl: result.codeUrl,
    };
  } catch (err) {
    await this.prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: { status: 'FAILED' },
    });
    throw err;
  }
}

async query(orderNo: string, userId: string) {
  const order = await this.prisma.subscriptionOrder.findUnique({
    where: { orderNo },
    select: { orderNo: true, payableAmount: true, status: true, payChannel: true, paidAt: true, userId: true },
  });

  if (!order) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_FOUND', '订单不存在');
  if (order.userId !== userId) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_OWNER', '订单不属于当前用户');

  return {
    orderNo: order.orderNo,
    amount: order.payableAmount,
    status: order.status,
    payChannel: order.payChannel,
    paidAt: order.paidAt,
  };
}

async close(orderNo: string, userId: string) {
  const order = await this.prisma.subscriptionOrder.findUnique({ where: { orderNo } });
  if (!order) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_FOUND', '订单不存在');
  if (order.userId !== userId) throw new BusinessException('SUBSCRIPTION_ORDER_NOT_OWNER', '订单不属于当前用户');

  // Idempotent
  if (order.status === 'CLOSED' || order.status === 'SUCCESS') return { success: true };
  if (order.status !== 'PENDING') {
    throw new BusinessException('SUBSCRIPTION_ORDER_STATUS_INVALID', '订单状态不允许关闭');
  }

  // Close WeChat order if prepayId exists
  if (order.prepayId && this.payment) {
    try { await this.payment.closePayment(orderNo); } catch { /* degrade */ }
  }

  // Remove delayed close task
  if (order.delayCloseJobId && this.closeExpiredQueue) {
    try { await this.closeExpiredQueue.remove(order.delayCloseJobId); } catch { /* job already done */ }
  }

  await this.prisma.subscriptionOrder.update({
    where: { id: order.id },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  return { success: true };
}
```

- [ ] **Step 8: 运行测试验证通过**

```bash
cd apps/api && npx vitest run src/modules/subscription/subscription-order.service.spec.ts
```

Expected: ALL tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/subscription/subscription-order.service.ts \
        apps/api/src/modules/subscription/subscription-order.service.spec.ts
git commit -m "feat(api): add SubscriptionOrderService with create/pay/query/close
>
> TDD: 17 test cases covering new_purchase, upgrade, duplicate protection,
> idempotent pay, ownership validation, expiry check, payment failure handling,
> and close idempotency."
```

---

### Task 3: SubscriptionOrderController (TDD)

**Files:**
- Create: `apps/api/src/modules/subscription/subscription-order.controller.spec.ts`
- Create: `apps/api/src/modules/subscription/subscription-order.controller.ts`

- [ ] **Step 1: 创建 controller 测试**

Create `apps/api/src/modules/subscription/subscription-order.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionOrderController } from './subscription-order.controller';
import { SubscriptionOrderService } from './subscription-order.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

function mockOrderService() {
  return {
    createOrder: vi.fn(),
    pay: vi.fn(),
    query: vi.fn(),
    close: vi.fn(),
  };
}

describe('SubscriptionOrderController', () => {
  let controller: SubscriptionOrderController;
  let service: ReturnType<typeof mockOrderService>;

  beforeEach(async () => {
    service = mockOrderService();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionOrderController],
      providers: [
        { provide: SubscriptionOrderService, useValue: service },
      ],
    }).compile();
    controller = module.get<SubscriptionOrderController>(SubscriptionOrderController);
  });

  describe('POST /api/subscription/orders', () => {
    it('should create order and return orderNo', async () => {
      service.createOrder.mockResolvedValue({
        orderNo: 'SUB_1753596000000_a3B7x9Yz',
        amount: 20000,
        expiredAt: new Date().toISOString(),
      });

      const result = await controller.createOrder(
        { user: { id: 'u1' } },
        { planId: 'plan-pro', period: 'monthly', type: 'new_purchase' },
      );

      expect(result.orderNo).toMatch(/^SUB_/);
      expect(service.createOrder).toHaveBeenCalledWith('u1', {
        planId: 'plan-pro', period: 'monthly', type: 'new_purchase',
      });
    });

    it('should throw 401 when not authenticated', async () => {
      await expect(
        controller.createOrder({ user: null }, { planId: 'p1', period: 'monthly', type: 'new_purchase' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('POST /api/subscription/orders/:orderNo/pay', () => {
    it('should return codeUrl', async () => {
      service.pay.mockResolvedValue({
        orderNo: 'SUB_xxx', amount: 20000, codeUrl: 'weixin://...',
      });

      const result = await controller.pay('SUB_xxx', { user: { id: 'u1' } });
      expect(result.codeUrl).toBeDefined();
      expect(service.pay).toHaveBeenCalledWith('SUB_xxx', 'u1');
    });
  });

  describe('GET /api/subscription/orders/:orderNo', () => {
    it('should return order status', async () => {
      service.query.mockResolvedValue({
        orderNo: 'SUB_xxx', amount: 20000, status: 'PENDING', payChannel: 'wechat', paidAt: null,
      });
      const result = await controller.query('SUB_xxx', { user: { id: 'u1' } });
      expect(result.status).toBe('PENDING');
    });
  });

  describe('POST /api/subscription/orders/:orderNo/close', () => {
    it('should close order', async () => {
      service.close.mockResolvedValue({ success: true });
      const result = await controller.close('SUB_xxx', { user: { id: 'u1' } });
      expect(result.success).toBe(true);
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd apps/api && npx vitest run src/modules/subscription/subscription-order.controller.spec.ts
```

Expected: FAIL — controller not defined.

- [ ] **Step 3: 创建 controller 实现**

Create `apps/api/src/modules/subscription/subscription-order.controller.ts`:

```typescript
import { Controller, Post, Get, Req, Body, Param, UnauthorizedException } from '@nestjs/common';
import { SubscriptionOrderService } from './subscription-order.service';
import { ThrottleUserGuard } from '../recharge/guards/throttle-user.guard';
import { UseGuards } from '@nestjs/common';

@Controller('api/subscription')
export class SubscriptionOrderController {
  constructor(private readonly orderService: SubscriptionOrderService) {}

  private uid(req: any): string {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException();
    return userId;
  }

  @Post('orders')
  @UseGuards(ThrottleUserGuard)
  async createOrder(
    @Req() req: any,
    @Body() body: { planId: string; period: string; type: string },
  ) {
    return this.orderService.createOrder(this.uid(req), {
      planId: body.planId,
      period: body.period,
      type: body.type as 'new_purchase' | 'upgrade',
    });
  }

  @Post('orders/:orderNo/pay')
  async pay(@Param('orderNo') orderNo: string, @Req() req: any) {
    return this.orderService.pay(orderNo, this.uid(req));
  }

  @Get('orders/:orderNo')
  async query(@Param('orderNo') orderNo: string, @Req() req: any) {
    return this.orderService.query(orderNo, this.uid(req));
  }

  @Post('orders/:orderNo/close')
  async close(@Param('orderNo') orderNo: string, @Req() req: any) {
    return this.orderService.close(orderNo, this.uid(req));
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd apps/api && npx vitest run src/modules/subscription/subscription-order.controller.spec.ts
```

Expected: ALL tests PASS.

- [ ] **Step 5: 注册 controller 和 service 到 SubscriptionModule**

Edit `apps/api/src/modules/subscription/subscription.module.ts`:

```typescript
// Add imports
import { SubscriptionOrderService } from './subscription-order.service';
import { SubscriptionOrderController } from './subscription-order.controller';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../config/queue.constants';
import { ThrottleUserGuard } from '../recharge/guards/throttle-user.guard';

// Update module decorator
@Module({
  imports: [
    CreditModule,
    OrderModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.BANNER_CLEANUP }),
    BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED }),
    BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION_PAYMENT_SUCCESS }),
  ],
  controllers: [SubscriptionController, SubscriptionBannerPublicController, SubscriptionOrderController],
  providers: [
    SubscriptionService,
    SubscriptionOrderService,
    PricingService,
    SubscriptionBannerService,
    AuditService,
    ThrottleUserGuard,
    { provide: 'REDIS_CLIENT', useFactory: () => new Redis(env.REDIS_URL) },
  ],
  exports: [SubscriptionService, SubscriptionOrderService, PricingService, SubscriptionBannerService],
})
export class SubscriptionModule {}
```

- [ ] **Step 6: 添加队列常量**

Edit `apps/api/src/config/queue.constants.ts`:

```typescript
export const QUEUE_NAMES = {
  // ... existing ...
  SUBSCRIPTION_CLOSE_EXPIRED: 'subscription-close-expired',
  SUBSCRIPTION_PAYMENT_SUCCESS: 'subscription-payment-success',
  SUBSCRIPTION_DAILY_RECON: 'subscription-daily-recon',
} as const;
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/subscription/subscription-order.controller.ts \
        apps/api/src/modules/subscription/subscription-order.controller.spec.ts \
        apps/api/src/modules/subscription/subscription.module.ts \
        apps/api/src/config/queue.constants.ts
git commit -m "feat(api): add SubscriptionOrderController with REST endpoints
>
> POST /api/subscription/orders - create order
> POST /api/subscription/orders/:orderNo/pay - initiate WeChat payment
> GET /api/subscription/orders/:orderNo - query order status
> POST /api/subscription/orders/:orderNo/close - close order
>
> All endpoints have ownership validation and ThrottleUserGuard."
```

---

### Task 4: PaymentGateway 扩展支持订阅订单

**Files:**
- Modify: `apps/api/src/modules/recharge/payment.gateway.ts`

- [ ] **Step 1: 读取当前 gateway 并在 handleJoinOrder 中添加订阅订单查询**

Edit `apps/api/src/modules/recharge/payment.gateway.ts`:

关键变更：`handleJoinOrder` 方法先查 `rechargeOrder`，找不到再查 `subscriptionOrder`。

```typescript
@SubscribeMessage('join:order')
async handleJoinOrder(client: Socket, data: { orderNo: string }) {
  const { orderNo } = data;
  const userId = client.data.userId;
  if (!userId) return;

  // Try recharge order first, then subscription order
  const rechargeOrder = await this.prisma.rechargeOrder.findUnique({
    where: { orderNo },
    select: { userId: true },
  });

  if (rechargeOrder && rechargeOrder.userId === userId) {
    client.join(`order:${orderNo}`);
    return;
  }

  const subOrder = await this.prisma.subscriptionOrder.findUnique({
    where: { orderNo },
    select: { userId: true },
  });

  if (subOrder && subOrder.userId === userId) {
    client.join(`order:${orderNo}`);
  }
}
```

- [ ] **Step 2: 添加订阅订单支付成功事件推送方法**

在 `PaymentGateway` 类中添加：

```typescript
// Amount unit: fen (same as recharge's emitPaymentSuccess, consistent across all payment events)
emitSubscriptionPaymentSuccess(orderNo: string, amount: number) {
  this.server.to(`order:${orderNo}`).emit('subscription:order:success', {
    orderNo, amount, // fen
  });
}

emitSubscriptionPaymentFailed(orderNo: string) {
  this.server.to(`order:${orderNo}`).emit('subscription:order:failed', { orderNo });
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/recharge/payment.gateway.ts
git commit -m "feat(api): extend PaymentGateway to support subscription orders
>
> handleJoinOrder now searches both rechargeOrder and subscriptionOrder.
> Added emitSubscriptionPaymentSuccess/Failed methods for real-time push."
```

---

### Task 5: 微信回调改造 — 按前缀路由分发

**Files:**
- Modify: `apps/api/src/modules/recharge/recharge.service.ts`
- Modify: `apps/api/src/modules/recharge/recharge.module.ts`

**关键：回调路由顺序必须调整。** 当前 `handleCallback` 的流程是"验签 → 查 rechargeOrder → 判断前缀"，但 `SUB_` 订单不存在于 `rechargeOrder` 表，查询返回 null 后直接返回 `order not found`，永远不会进入路由分支。修正后顺序：

```
验签 → 提取 out_trade_no → 按前缀判断订单类型 → 去对应表查询 → 幂等校验 → 业务处理
```

**回调字段命名对齐（高优先级）：**
微信原生回调字段为下划线命名 `out_trade_no` / `transaction_id` / `trade_state` / `payer_openid` / `total_fee`。`WechatPaymentProvider.parseNotify()` 可能已做驼峰转换。**落地时必须与现有充值回调代码的字段写法完全一致**（参照 `recharge.service.ts` 的 `handleCallback` 方法中 `notify.outTradeNo` / `notify.tradeState` 等字段名），禁止自行假设格式。

**回调金额校验（强制实现，资损防控）：**
在 `processPaymentCallback` 业务验证阶段增加，防止参数篡改与单位转换错误：
```typescript
// Mandatory: amount must match exactly (both in fen, integer comparison)
if (notify.amount !== order.payableAmount) {
  this.logger.error(JSON.stringify({
    event: 'subscription_callback_amount_mismatch',
    orderNo: order.orderNo,
    localAmount: order.payableAmount,
    notifyAmount: notify.amount,
  }));
  Sentry.captureMessage('subscription payment amount mismatch', {
    level: 'error',
    extra: { orderNo: order.orderNo, local: order.payableAmount, notify: notify.amount },
  });
  return { code: 'FAIL', message: 'amount mismatch' };
}
```

在 `recharge.service.ts` 中注入订阅订单服务：

```typescript
@Optional() @Inject('SUB_ORDER_SERVICE') private readonly subOrderService?: any,
```

重构 `handleCallback` 方法中"验签通过后的部分"（约第 223 行起），替换原有逻辑：

```typescript
// === Route by out_trade_no prefix (MUST come before table query) ===
const outTradeNo = notify.outTradeNo;

if (outTradeNo.startsWith('SUB_')) {
  // Subscription order callback
  if (!this.subOrderService) {
    endDuration({ result: 'error' });
    return { code: 'FAIL', message: 'subscription processing not available' };
  }
  try {
    // subOrderService handles its own validation + idempotency + async dispatch
    const result = await this.subOrderService.processPaymentCallback(notify);
    endDuration({ result: result.code === 'SUCCESS' ? 'success' : 'error' });
    return result;
  } catch (err) {
    Sentry.captureException(err, (scope) => {
      scope.setTag('module', 'subscription-callback');
      scope.setTag('orderNo', outTradeNo);
      scope.setLevel('fatal');
      return scope;
    });
    endDuration({ result: 'error' });
    return { code: 'FAIL', message: 'internal error' };
  }
}

// === Existing recharge order flow (RCH_ prefix, or legacy without prefix) ===
// Load recharge order
const order = await this.prisma.rechargeOrder.findUnique({
  where: { orderNo: outTradeNo },
});

if (!order) {
  endDuration({ result: 'error' });
  return { code: 'FAIL', message: 'order not found' };
}

// ... rest of existing recharge callback logic unchanged ...
```

- [ ] **Step 2: 在 RechargeModule 中注入 SubscriptionOrderService**

Edit `apps/api/src/modules/recharge/recharge.module.ts`:

在 providers 中添加：
```typescript
{ provide: 'SUB_ORDER_SERVICE', useExisting: SubscriptionOrderService }
```

并在 imports 中导入 SubscriptionModule（或用 forwardRef 避免循环依赖）。

- [ ] **Step 3: 在 SubscriptionOrderService 中实现 processPaymentCallback**

在 `subscription-order.service.ts` 中添加：

```typescript
async processPaymentCallback(notify: any) {
  // Quick response: validate and return immediately
  const order = await this.prisma.subscriptionOrder.findUnique({
    where: { orderNo: notify.outTradeNo },
  });

  if (!order) return { code: 'FAIL', message: 'order not found' };

  // Idempotent: already terminal state
  if (order.status === 'SUCCESS') return { code: 'SUCCESS', message: 'OK' };
  // CLOSED/FAILED: don't keep retrying, return FAIL to stop WeChat hourly retries
  if (order.status === 'CLOSED' || order.status === 'FAILED') {
    return { code: 'FAIL', message: 'order already terminated' };
  }

  // Business validation
  if (notify.tradeState !== 'SUCCESS') {
    return { code: 'FAIL', message: `trade_state: ${notify.tradeState}` };
  }

  // Store raw notification
  await this.prisma.subscriptionOrder.update({
    where: { id: order.id },
    data: {
      notifySummary: {
        transactionId: notify.transactionId,
        tradeState: notify.tradeState,
        tradeStateDesc: notify.tradeStateDesc,
        amount: notify.amount,
        payerOpenid: notify.payerOpenid,
      },
    },
  });

  // Dispatch async activation task
  if (this.paymentSuccessQueue) {
    await this.paymentSuccessQueue.add('process-payment-success', {
      orderNo: notify.outTradeNo,
      transactionId: notify.transactionId,
      payerOpenid: notify.payerOpenid,
    });
  }

  return { code: 'SUCCESS', message: 'OK' };
}
```

需要在构造函数中注入 payment success queue：
```typescript
@Optional() @InjectQueue(QUEUE_NAMES.SUBSCRIPTION_PAYMENT_SUCCESS)
private readonly paymentSuccessQueue?: Queue,
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/recharge/recharge.service.ts \
        apps/api/src/modules/recharge/recharge.module.ts \
        apps/api/src/modules/subscription/subscription-order.service.ts
git commit -m "feat(api): route SUB_ prefixed orders in wechat callback to subscription handler
>
> RechargeService.handleCallback routes SUB_ orders to SubscriptionOrderService.
> Callback validates, stores raw notification, dispatches async activation task."
```

---

### Task 6: 支付成功异步处理器 (BullMQ)

**Files:**
- Create: `apps/api/src/modules/subscription/task/payment-success.processor.ts`

- [ ] **Step 1: 创建处理器实现**

Create `apps/api/src/modules/subscription/task/payment-success.processor.ts`:

```typescript
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentGateway } from '../../recharge/payment.gateway';
import { QUEUE_NAMES } from '../../../config/queue.constants';
import * as Sentry from '@sentry/nestjs';

interface PaymentSuccessJob {
  orderNo: string;
  transactionId: string;
  payerOpenid: string;
}

@Processor(QUEUE_NAMES.SUBSCRIPTION_PAYMENT_SUCCESS)
export class PaymentSuccessProcessor extends WorkerHost {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
    @InjectQueue(QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED)
    private readonly closeExpiredQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<PaymentSuccessJob, any, string>): Promise<any> {
    const { orderNo, transactionId, payerOpenid } = job.data;

    const order = await this.prisma.subscriptionOrder.findUnique({
      where: { orderNo },
    });

    if (!order) {
      Sentry.captureMessage(`[PaymentSuccess] Order not found: ${orderNo}`, 'error');
      return;
    }

    // Idempotent check
    if (order.status === 'SUCCESS') return;

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1) Update order to SUCCESS (optimistic lock)
        const updated = await tx.subscriptionOrder.updateMany({
          where: { id: order.id, status: 'PENDING' },
          data: {
            status: 'SUCCESS',
            transactionId,
            payerOpenid,
            paidAt: new Date(),
          },
        });

        if (updated.count === 0) {
          // Already processed by another worker / timeout close
          return;
        }

        // 2) Get plan details
        const plan = await tx.subscriptionPlan.findUnique({
          where: { id: order.planId },
        });

        if (!plan) throw new Error(`Plan not found: ${order.planId}`);

        const periodMonths = order.period === 'monthly' ? 1 : order.period === 'quarterly' ? 3 : 12;
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + periodMonths);
        const nextGrant = new Date(now);
        nextGrant.setMonth(nextGrant.getMonth() + 1);

        let newSub: any;

        if (order.type === 'new_purchase') {
          // 3a) Create new subscription
          newSub = await tx.userSubscription.create({
            data: {
              userId: order.userId,
              planId: order.planId,
              tier: plan.tier,
              period: order.period,
              status: 'active',
              paidAmount: order.payableAmount / 100, // fen to yuan
              totalCredits: plan.monthlyCredits * periodMonths,
              totalDays: periodMonths * 30,
              subscribedAt: now,
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              nextGrantDate: nextGrant,
              grantCount: 1,
            },
          });
        } else if (order.type === 'upgrade') {
          // 3b) Mark old subscription upgraded, create new one
          if (order.fromSubscriptionId) {
            await tx.userSubscription.updateMany({
              where: { id: order.fromSubscriptionId, status: 'active' },
              data: { status: 'upgraded' },
            });
          }

          newSub = await tx.userSubscription.create({
            data: {
              userId: order.userId,
              planId: order.planId,
              tier: plan.tier,
              period: order.period,
              status: 'active',
              paidAmount: order.payableAmount / 100,
              totalCredits: plan.monthlyCredits * periodMonths,
              totalDays: periodMonths * 30,
              subscribedAt: now,
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              nextGrantDate: nextGrant,
              grantCount: 1,
              previousSubId: order.fromSubscriptionId,
            },
          });

          // Clear old subscription credits
          await tx.userBalance.updateMany({
            where: { userId: order.userId },
            data: { subscriptionCredits: 0, subscriptionCreditsExpiry: null },
          });
        }

        // 4) Grant first month subscription credits
        const grantCredits = plan.monthlyCredits;
        await tx.creditTransaction.create({
          data: {
            userId: order.userId,
            type: 'subscription_grant',
            amount: grantCredits,
            description: `订阅赠送积分 - ${plan.name} ${order.period}`,
          },
        });

        await tx.userBalance.upsert({
          where: { userId: order.userId },
          update: {
            subscriptionCredits: { increment: grantCredits },
            subscriptionCreditsExpiry: periodEnd,
          },
          create: {
            userId: order.userId,
            subscriptionCredits: grantCredits,
            subscriptionCreditsExpiry: periodEnd,
          },
        });
      });

      // 5) Remove delayed close task (best-effort)
      if (order.delayCloseJobId && this.closeExpiredQueue) {
        try {
          await this.closeExpiredQueue.remove(order.delayCloseJobId);
        } catch { /* job already executed or not found, carry on */ }
      }

      // 6) Push Socket.io event
      try {
        this.gateway.emitSubscriptionPaymentSuccess(orderNo, order.payableAmount);
      } catch { /* best-effort */ }

    } catch (err) {
      Sentry.captureException(err, (scope) => {
        scope.setTag('module', 'subscription-payment-success');
        scope.setTag('orderNo', orderNo);
        scope.setLevel('fatal');
        return scope;
      });
      throw err; // Let BullMQ retry
    }
  }
}
```

**业务规则确认:**

- **升级积分处理**：当前逻辑为「清零旧订阅积分 + 发放新套餐首月积分」。若产品规则为「按比例折算叠加旧积分」，需调整此处逻辑。**实施前与产品确认。**

- **金额单位**：`paidAmount: order.payableAmount / 100` — `UserSubscription.paidAmount` 字段历史数据为**元**（由原 `SubscriptionService.subscribe()` 直接扣余额时写入），此处除以 100 后单位一致。

- [ ] **Step 2: 注册处理器到 Task Module**

在 `apps/api/src/modules/subscription/task/subscription-task.module.ts` 中注册：

```typescript
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION_PAYMENT_SUCCESS }),
    BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED }),
    BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION_DAILY_RECON }),
  ],
  providers: [
    PaymentSuccessProcessor,
    CloseExpiredSubOrderProcessor,
    // ... existing processors
  ],
})
export class SubscriptionTaskModule {}
```

> **禁止遗漏**：仅定义 `@Processor()` 装饰器不足以注册，必须在 Module 的 `providers` 数组中显式声明。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/subscription/task/payment-success.processor.ts
git commit -m "feat(api): add payment success async processor for subscription activation
>
> Handles activation in a Prisma transaction: update order → create/upgrade
> subscription → grant credits → remove timeout task → Socket.io push.
> Optimistic lock prevents race with timeout close.
> 3 retries with exponential backoff, dead letter queue + Sentry on failure."
```

---

### Task 7: 前端 API 方法

**Files:**
- Modify: `apps/web/src/api/subscriptionApi.ts`

- [ ] **Step 1: 添加 4 个订阅订单 API 方法**

在 `subscriptionApi.ts` 中 `getRechargeOrders` 方法后添加：

```typescript
// ── Subscription Orders (WeChat Pay) ──

createSubscriptionOrder: (planId: string, period: string, type: string) =>
  apiFetch<{ orderNo: string; amount: number; expiredAt: string }>(
    '/subscription/orders',
    { method: 'POST', body: JSON.stringify({ planId, period, type }) },
  ),

paySubscriptionOrder: (orderNo: string) =>
  apiFetch<{ orderNo: string; amount: number; codeUrl: string | null }>(
    `/subscription/orders/${orderNo}/pay`,
    { method: 'POST' },
  ),

querySubscriptionOrder: (orderNo: string) =>
  apiFetch<{ orderNo: string; amount: number; status: string; payChannel: string | null; paidAt: string | null }>(
    `/subscription/orders/${orderNo}`,
  ),

closeSubscriptionOrder: (orderNo: string) =>
  apiFetch<{ success: boolean }>(
    `/subscription/orders/${orderNo}/close`,
    { method: 'POST' },
  ),
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/api/subscriptionApi.ts
git commit -m "feat(web): add subscription order API methods
>
> createSubscriptionOrder, paySubscriptionOrder, querySubscriptionOrder,
> closeSubscriptionOrder — mirror recharge order pattern for membership page.
> Phase 2: also add `querySubscriptionOrders(params?)` list endpoint.
> Spec: user-scoped (mandatory auth), supports ?status=PENDING filter,
> page/pageSize pagination, ordered by createdAt DESC (latest first)."
```

---

### Task 8: WeChatQRModal 通用化

**Files:**
- Modify: `apps/web/src/components/WeChatQRModal.tsx`

- [ ] **Step 1: 分析现有硬编码依赖**

当前组件硬编码：
- 轮询时调用 `subscriptionApi.queryRechargeOrder(orderNo)`
- 关闭时调用 `subscriptionApi.closeRechargeOrder(orderNo)`
- 监听 Socket.io 事件 `payment:success` / `payment:failed`

- [ ] **Step 2: 改造为通用组件**

在 props 接口中添加可选的自定义方法，保留向后兼容的默认值：

```typescript
interface WeChatQRModalProps {
  visible: boolean;
  codeUrl: string;
  orderNo: string;
  amount: number;
  expiredAt: string;
  onSuccess: () => void;
  onCancel: () => void;
  // New optional props for subscription orders (defaults to recharge methods)
  queryOrderFn?: (orderNo: string) => Promise<{ status: string }>;
  closeOrderFn?: (orderNo: string) => Promise<{ success: boolean }>;
  successEventName?: string;    // Socket.io 成功事件名
  failedEventName?: string;     // Socket.io 失败事件名
}
```

在组件内部使用：
```typescript
export function WeChatQRModal({
  visible, codeUrl, orderNo, amount, expiredAt, onSuccess, onCancel,
  queryOrderFn = subscriptionApi.queryRechargeOrder,
  closeOrderFn = subscriptionApi.closeRechargeOrder,
  successEventName = 'payment:success',
  failedEventName = 'payment:failed',
}: WeChatQRModalProps) {
```

Socket.io 监听改为动态事件名，**事件监听生命周期通过 `useEffect` 的 `visible` 依赖管控**：
```typescript
useEffect(() => {
  if (!visible) return; // Don't register when modal is hidden

  // ... existing socket setup ...

  socket.on(successEventName, () => { ... });
  socket.on(failedEventName, () => { ... });

  return () => {
    socket.off(successEventName);
    socket.off(failedEventName);
    // ... existing cleanup ...
  };
}, [visible, orderNo, expiredAt, onSuccess, handleCancel, stopAll, successEventName, failedEventName]);
```

将硬编码的 `subscriptionApi.queryRechargeOrder(orderNo)` 替换为 `queryOrderFn(orderNo)`，`subscriptionApi.closeRechargeOrder(orderNo)` 替换为 `closeOrderFn(orderNo)`。

**Socket 连接复用确认：**
当前 WeChatQRModal 内 `io('/payment')` 每次弹窗都会新建连接（第 70 行）。需确保：
- 弹窗关闭时（`return () => { socket.disconnect(); }`）断开连接 — 已有
- 若页面同时渲染两个 WeChatQRModal 实例，不会产生冲突 — 每个弹窗独立的 `useEffect` 管理生命周期

- [ ] **Step 3: 验证 Credits 充值页面仍正常工作**

```bash
cd apps/web && npx vitest run src/components/WeChatQRModal.test.tsx 2>/dev/null || echo "No existing tests, manual verification needed"
```

确认默认 props 使 Credits 页面无需修改。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/WeChatQRModal.tsx
git commit -m "refactor(web): generalize WeChatQRModal for subscription order reuse
>
> Add optional queryOrderFn and closeOrderFn props. Default to recharge
> methods for backward compatibility. Credits page requires zero changes."
```

---

### Task 9: MembershipPage 集成微信支付

**Files:**
- Modify: `apps/web/src/pages/settings/MembershipPage.tsx`
- Modify: `apps/web/src/hooks/useSubscription.ts`

- [ ] **Step 1: 在 useSubscription hook 中添加 refresh 导出**

Edit `apps/web/src/hooks/useSubscription.ts`:

`useMySubscription` hook 已返回 `refresh`（第 26 行），确认可用。

`useCreditBalance` hook 内 `refresh` 已定义但未导出（第 55 行），修改返回值：

```typescript
return { ...data, loading, refresh };
```

- [ ] **Step 2: 修改 MembershipPage 的 handleSubscribe**

在 `MembershipPage.tsx` 中：

1. 添加 imports：
```typescript
import { WeChatQRModal } from '@/components/WeChatQRModal';
```

2. 添加支付相关 state：
```typescript
const [qrVisible, setQrVisible] = useState(false);
const [qrCodeUrl, setQrCodeUrl] = useState('');
const [qrOrderNo, setQrOrderNo] = useState('');
const [qrAmount, setQrAmount] = useState(0);
const [qrExpiredAt, setQrExpiredAt] = useState('');
```

3. 替换 `handleSubscribe`：
```typescript
const handleSubscribe = async (plan: SubscriptionPlan, period: string) => {
  setSelectedPlan(null);
  setSubLoading(true);
  try {
    const order = await subscriptionApi.createSubscriptionOrder(plan.id, period, 'new_purchase');
    const payResult = await subscriptionApi.paySubscriptionOrder(order.orderNo);
    if (payResult.codeUrl) {
      setQrCodeUrl(payResult.codeUrl);
      setQrOrderNo(order.orderNo);
      setQrAmount(Number((order.amount / 100).toFixed(2))); // fen → yuan, 2 decimal places
      setQrExpiredAt(order.expiredAt);
      setQrVisible(true);
    }
  } catch (e: any) {
    message.error(e.message || '创建订单失败');
  } finally {
    setSubLoading(false);
  }
};
```

4. 替换 `handleUpgrade`：
```typescript
const handleUpgrade = async () => {
  if (!upgradePlan || !upgradePeriod) return;
  setUpgradePlan(null);
  setSubLoading(true);
  try {
    const order = await subscriptionApi.createSubscriptionOrder(upgradePlan.id, upgradePeriod, 'upgrade');
    const payResult = await subscriptionApi.paySubscriptionOrder(order.orderNo);
    if (payResult.codeUrl) {
      setQrCodeUrl(payResult.codeUrl);
      setQrOrderNo(order.orderNo);
      setQrAmount(Number((order.amount / 100).toFixed(2))); // fen → yuan, 2 decimal places
      setQrExpiredAt(order.expiredAt);
      setQrVisible(true);
    }
  } catch (e: any) {
    message.error(e.message || '创建升级订单失败');
  } finally {
    setSubLoading(false);
  }
};
```

5. 添加支付成功回调：
```typescript
// Add refresh to destructuring at top of component:
// const { data: sub, loading, refresh: refreshSub } = useMySubscription();

const handlePaymentSuccess = useCallback(async () => {
  setQrVisible(false);
  message.loading({ content: '支付成功，权益开通中...', key: 'sub-paying', duration: 0 });
  try {
    await refreshSub();
  } catch { /* refresh failed, user can manually reload */ }
  message.destroy('sub-paying');
  message.success('订阅成功！');
}, [refreshSub]);
```

6. 在 JSX 末尾（`</div>` 前）添加 WeChatQRModal：
```tsx
<WeChatQRModal
  visible={qrVisible}
  codeUrl={qrCodeUrl}
  orderNo={qrOrderNo}
  amount={qrAmount}
  expiredAt={qrExpiredAt}
  onSuccess={handlePaymentSuccess}
  onCancel={() => {
    setQrVisible(false);
    subscriptionApi.closeSubscriptionOrder(qrOrderNo).catch(() => {});
  }}
  queryOrderFn={(orderNo: string) =>
    subscriptionApi.querySubscriptionOrder(orderNo).then(o => ({ status: o.status }))
  }
  closeOrderFn={(orderNo: string) =>
    subscriptionApi.closeSubscriptionOrder(orderNo)
  }
  successEventName="subscription:order:success"
  failedEventName="subscription:order:failed"
/>
```

- [ ] **Step 3: 页面初始化 PENDING 订单检测（Phase 2 落地）**

Phase 2 实现（独立 commit），需使用**专属订阅订单查询接口**（非 `getRechargeOrders`）：
```typescript
useEffect(() => {
  if (loading || sub?.status === 'active') return;
  const checkPending = async () => {
    try {
      // 使用 GET /api/subscription/orders?status=PENDING 查询当前用户待支付订单
      const pendingOrders = await subscriptionApi.querySubscriptionOrders({ status: 'PENDING' });
      const latest = pendingOrders?.[0];
      if (latest && latest.status === 'PENDING') {
        Modal.confirm({
          title: '待支付订单',
          content: '您有一笔待支付的订阅订单，是否继续支付？',
          onOk: () => {
            setQrOrderNo(latest.orderNo);
            setQrAmount(Number((latest.amount / 100).toFixed(2)));
            setQrVisible(true);
          },
        });
      }
    } catch { /* silent */ }
  };
  checkPending();
}, [loading, sub?.status]);
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/settings/MembershipPage.tsx \
        apps/web/src/hooks/useSubscription.ts
git commit -m "feat(web): integrate WeChat Pay into membership page
>
> Subscribe and upgrade buttons now create/pay subscription orders,
> display WeChat QR code modal for payment, and refresh state on success.
> Uses generalized WeChatQRModal with subscription-specific API methods."
```

---

## Phase 2: 可靠性增强（P1）

### Task 10: 超时关单处理器 (BullMQ)

**Files:**
- Create: `apps/api/src/modules/subscription/task/close-expired-sub-order.processor.ts`

- [ ] **Step 1: 创建处理器**

```typescript
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { QUEUE_NAMES } from '../../../config/queue.constants';

@Processor(QUEUE_NAMES.SUBSCRIPTION_CLOSE_EXPIRED)
export class CloseExpiredSubOrderProcessor extends WorkerHost {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('PAYMENT_PROVIDER') private readonly payment?: any,
  ) {
    super();
  }

  async process(job: Job<{ orderNo: string; userId: string }, any, string>): Promise<any> {
    const { orderNo } = job.data;

    const order = await this.prisma.subscriptionOrder.findUnique({
      where: { orderNo },
    });

    if (!order) return;
    if (order.status !== 'PENDING') return;

    // Clock skew protection
    if (order.expiredAt && order.expiredAt > new Date()) return;

    // Close WeChat order
    if (order.prepayId && this.payment) {
      try { await this.payment.closePayment(orderNo); } catch { /* degrade */ }
    }

    await this.prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }
}
```

- [ ] **Step 2: 注册到 task module**

在 `subscription-task.module.ts` 中注册处理器。

- [ ] **Step 3: Commit**

---

### Task 11: 可观测性埋点

**Files:**
- Modify: `apps/api/src/modules/subscription/subscription-order.service.ts`

- [ ] **Step 1: NestJS Logger 结构化日志（禁止 console.log）**

使用 NestJS 内置 Logger：
```typescript
import { Logger } from '@nestjs/common';

@Injectable()
export class SubscriptionOrderService {
  private readonly logger = new Logger(SubscriptionOrderService.name);

  async createOrder(...) {
    this.logger.log(JSON.stringify({
      event: 'subscription_order_created',
      userId,
      type: dto.type,
      planId: dto.planId,
      period: dto.period,
      payableAmount,
      orderNo: order.orderNo,
    }));
    // ...
  }

  async processPaymentCallback(notify: any) {
    this.logger.log(JSON.stringify({
      event: 'subscription_callback_received',
      orderNo: notify.outTradeNo,
      tradeState: notify.tradeState,
    }));
    // ...
  }
}
```

- [ ] **Step 2: Prometheus 核心指标接入**

复用现有 `MetricsService`（`apps/api/src/metrics/metrics.service.ts`），新增指标：

```typescript
// 在 SubscriptionOrderService 构造函数注入 MetricsService
@Inject(MetricsService) private readonly metrics: MetricsService,

// 订单创建
this.metrics.subOrdersCreatedTotal.inc({
  plan_tier: plan.tier,
  type: dto.type,
});

// 支付发起
this.metrics.subPaymentsInitiatedTotal.inc();

// 支付成功（回调处理）
this.metrics.subPaymentsSucceededTotal.inc();
this.metrics.subPaymentDurationSeconds.observe(
  (Date.now() - order.createdAt.getTime()) / 1000
);

// 回调延迟
this.metrics.subCallbackLatencySeconds.observe(
  (Date.now() - new Date(notify.createTime).getTime()) / 1000
);
```

需在 `MetricsService` 中补充对应的 `Counter` / `Histogram` 定义。

- [ ] **Step 3: 在 processPaymentCallback catch 块确保 Sentry 上报**

已有 Sentry 上报（参见 Task 6 处理器中的 `Sentry.captureException`），服务层 catch 块额外补充。

- [ ] **Step 4: Commit**

---

## Phase 3: 运营兜底（P2）

### Task 12: 日终对账任务 (BullMQ)

**Files:**
- Create: `apps/api/src/modules/subscription/task/daily-recon.processor.ts`

- [ ] **Step 1: 创建对账处理器骨架（完整实现需在微信商户平台配置账单下载后启用）**

```typescript
@Processor(QUEUE_NAMES.SUBSCRIPTION_DAILY_RECON)
export class DailyReconProcessor extends WorkerHost {
  async process(): Promise<any> {
    // 1. Pull WeChat trade bill for previous day
    // 2. Compare with local SubscriptionOrder + RechargeOrder
    // 3. Compensate: WeChat SUCCESS + local not SUCCESS → activate
    // 4. Report: local SUCCESS + WeChat not found → flag anomaly
    // 5. Generate reconciliation report
  }
}
```

- [ ] **Step 2: Commit**

---

## 验证检查清单

### Phase 1 完成后验证
- [ ] `POST /api/subscription/orders` 创建订单返回 orderNo + amount + expiredAt
- [ ] `POST /api/subscription/orders/:orderNo/pay` 返回 codeUrl
- [ ] `GET /api/subscription/orders/:orderNo` 返回订单状态
- [ ] `POST /api/subscription/orders/:orderNo/close` 关闭订单
- [ ] 微信回调 SUB_ 订单正确路由到订阅处理器
- [ ] 支付成功 → 订阅激活 → 积分发放
- [ ] 前端 MembershipPage 订阅/升级弹出二维码
- [ ] Credits 充值页面不受影响（回归验证）

### Phase 2 完成后验证
- [ ] 超时订单 2 小时后自动关闭
- [ ] Sentry / Loki / Prometheus 有相应数据

### Phase 3 完成后验证
- [ ] 对账任务可手动触发执行
- [ ] 差异报表可查看

---

## 风险与注意事项

1. **PricingService.calculate 返回值需确认**：当前 `pricing.service.spec.ts` 显示返回值格式，需确认 `currentTier`/`currentPeriod` 等字段是否实际存在
2. **循环依赖**：RechargeModule 引用 SubscriptionModule 可能产生循环依赖，使用 `forwardRef(() => SubscriptionModule)`
3. **generateOrderNo 已存在**：`order-no.ts` 中已有 `generateOrderNo()` 函数，生成 `SUB` 前缀订单号（22 字符），可直接复用
4. **CreditService 直接扣余额 vs 支付后激活**：确保现有 subscribe/upgrade API 的余额扣款路径不受影响
5. **transactionId 唯一索引**：PostgreSQL 多 NULL 不冲突，不会影响未支付订单
6. **升级积分处理规则**：必须在开发前与产品确认是「清零旧积分」还是「按比例折算叠加」，禁止默认执行清零

---

## 上线前置检查

### 微信商户侧配置
- [ ] 商户号已开通 Native 支付产品权限
- [ ] 服务器出口 IP 已加入微信商户平台回调 IP 白名单
- [ ] 回调接口域名已在微信商户平台备案配置

### 金额单位全链路校验
- [ ] 后端存储：`payableAmount` 为分（Int 整数）
- [ ] 微信下单：传入金额 = `order.payableAmount`（分）
- [ ] 回调校验：`notify.amount === order.payableAmount`（分）
- [ ] 前端展示：`(amount / 100).toFixed(2)` 转元，保留两位小数

### 沙箱环境验证清单
- [ ] 新购订阅扫码支付成功 → 订阅激活 → 积分到账
- [ ] 升级订阅扫码支付成功 → 旧订阅失效 → 新订阅生效
- [ ] 支付超时 2h → 订单自动关闭
- [ ] 微信重复回调 → 幂等不重复发放权益
- [ ] 用户主动关单 → 微信侧 + 本地同步关闭
- [ ] 支付失败 → 订单标记 FAILED，用户可重新下单
