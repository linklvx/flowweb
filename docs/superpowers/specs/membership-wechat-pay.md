<!-- doc-status: historical | verified_at: n/a -->
# Spec: 会员中心集成微信支付

## 目标
会员中心 (`/settings/membership`) 的"立即订阅"和"确认升级"按钮，从当前的**直接扣余额**改为**微信扫码支付**，与 Credits 页面的"立即充值"体验一致。

## 当前行为 vs 目标行为

| 操作 | 当前 | 目标 |
|------|------|------|
| 新购订阅 | 直接扣余额 → 激活订阅 | 弹出微信二维码 → 扫码支付 → 激活订阅 |
| 升级订阅 | 直接扣余额 → 升级 | 弹出微信二维码 → 扫码支付 → 升级 |

## 用户流程

### 新购订阅
1. 用户在套餐表点击"立即订阅" → 弹出确认弹窗（已有）
2. 确认 → 创建订单+发起支付 → **弹出微信支付二维码弹窗**
3. 用户扫码支付 → Socket.io 实时推送或轮询确认 → 激活订阅 → 关闭二维码 → "订阅成功"→ 局部刷新
4. 支付失败/超时/用户取消 → 关闭二维码 → 调关单接口 → 不做任何变更

### 升级订阅
1. 用户选择升级套餐 → 弹出升级确认弹窗（已有，显示折后价）
2. 确认升级 → 创建订单+发起支付 → **弹出微信支付二维码弹窗**
3. 支付成功 → 激活升级 → 关闭二维码 → "升级成功"→ 局部刷新
4. 支付失败/超时/取消 → 关闭二维码 → 调关单接口 → 原订阅不受影响

---

## 一、数据模型

### 1.1 枚举定义

```prisma
enum SubscriptionOrderStatus {
  PENDING   // 待支付
  SUCCESS   // 已支付
  FAILED    // 支付失败
  CLOSED    // 已关闭（超时/用户取消）
}

enum SubscriptionOrderType {
  NEW_PURCHASE
  UPGRADE
}
```

### 1.2 SubscriptionOrder 表（目标结构）

所有金额字段统一为 **Int，单位：分**，禁止浮点类型。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | String | @id @default(cuid()) | 主键 |
| orderNo | String | @unique | 商户订单号，规则：`SUB_` + 13位毫秒时间戳 + 8位随机字符串，总长 24 位（< 微信 32 位限制） |
| userId | String | | 下单用户 ID，关联 User 表 |
| planId | String | | 目标套餐 ID |
| period | SubscriptionPeriod | | 订阅周期 |
| type | SubscriptionOrderType | | NEW_PURCHASE / UPGRADE |
| originalAmount | Int | | 订单原价，单位：分 |
| payableAmount | Int | | 实付金额（折后），单位：分 |
| prorationAmount | Int? | | 升级场景：抵扣金额，单位：分 |
| fromSubscriptionId | String? | | 升级场景：原订阅 ID |
| fromPlanId | String? | | 升级场景：原套餐 ID |
| status | SubscriptionOrderStatus | @default(PENDING) | 订单状态 |
| pricingSnapshot | Json? | | 升级定价快照，固定结构见 1.4 |
| payChannel | String | @default("wechat") @db.VarChar(32) | 支付渠道（预留支付宝、银联等扩展） |
| prepayId | String? | @db.VarChar(64) | 微信预支付 ID |
| transactionId | String? | @db.VarChar(64) | 微信支付单号 |
| payerOpenid | String? | @db.VarChar(64) | 支付者 OpenID |
| paidAt | DateTime? | | 支付时间 |
| expiredAt | DateTime? | | 过期时间（创建时 +2h） |
| closedAt | DateTime? | | 关闭时间 |
| delayCloseJobId | String? | | BullMQ 超时关单任务 ID，用于支付成功后精准移除 |
| notifySummary | Json? | | 回调原始数据 |
| createdAt | DateTime | @default(now()) | 创建时间 |
| updatedAt | DateTime | @updatedAt | 更新时间 |

### 1.3 索引与关联

```prisma
@@index([userId, status])        // 用户维度订单查询
@@index([status, expiredAt])     // 超时任务批量扫描
@@unique([transactionId])        // 防重复入账（幂等）

// 外键关联
user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
```

### 1.4 pricingSnapshot 固定结构

```typescript
interface PricingSnapshot {
  currentTier: string       // 原套餐等级
  currentPeriod: string     // 原订阅周期
  targetTier: string        // 目标套餐等级
  targetPeriod: string      // 目标订阅周期
  originalUnitPrice: number // 原套餐单价（分）
  remainingDays: number     // 剩余天数
  prorationUnitPrice: number // 抵扣单价（分/天）
  prorationAmount: number   // 抵扣金额（分）
  payableAmount: number     // 应付金额（分）
  calculatedAt: string      // 计算时间戳 ISO
}
```

### 1.5 迁移策略（三步执行，标准 Expand-Contract 模式）

**Step 1 — 新增目标字段 + statusNew 过渡字段（全部允许为空）**
- 新增枚举类型 `SubscriptionOrderStatus`
- 新增 `statusNew SubscriptionOrderStatus?`（过渡字段，Step 3 重命名为 status）
- 新增 payableAmount, originalAmount, prorationAmount（Int?）
- 新增 fromSubscriptionId, fromPlanId（String?）
- 新增 prepayId, transactionId, payerOpenid, paidAt, expiredAt, closedAt, delayCloseJobId, notifySummary, updatedAt

**Step 2 — 数据迁移 SQL**
```sql
-- 金额转换：元 → 分
UPDATE "SubscriptionOrder" SET "payableAmount" = "amount" * 100;
UPDATE "SubscriptionOrder" SET "originalAmount" = "originalPrice" * 100;
UPDATE "SubscriptionOrder" SET "prorationAmount" = "deductibleAmount" * 100;
-- 字段值迁移
UPDATE "SubscriptionOrder" SET "fromSubscriptionId" = "originalSubscriptionId";
-- 状态映射（旧 String → 新枚举）
UPDATE "SubscriptionOrder" SET "statusNew" = 'SUCCESS'::"SubscriptionOrderStatus" WHERE "status" = 'success';
UPDATE "SubscriptionOrder" SET "statusNew" = 'PENDING'::"SubscriptionOrderStatus" WHERE "status" = 'pending';
-- 补充时间戳
UPDATE "SubscriptionOrder" SET "updatedAt" = "createdAt";
```

**Step 3 — 删除旧字段 + 重命名 + 加非空约束**
- 删除 amount, originalPrice, deductibleAmount, originalSubscriptionId 列
- 删除旧 status 列（String 类型）
- `statusNew` 重命名为 `status`，设置 `@default(PENDING)` + NOT NULL
- payableAmount, originalAmount, updatedAt 设为 NOT NULL

> **严禁直接重命名字段**，避免金额单位错误与枚举值不匹配。使用 `statusNew` 过渡字段而非直接改类型，完全符合 Prisma 官方「Expand and Contract」迁移范式。

### 1.6 软删适配

若现有 User 表采用软删模式，`onDelete: Cascade` 需改为 `SetNull` 或保留记录，避免用户软删时级联丢失订单数据影响财务对账。若现有体系为硬删则保持 `Cascade` 不变。

### 1.7 订单号生成规则

```
格式：SUB_ + 13位毫秒时间戳 + 8位随机字符串
示例：SUB_1753596000000_a3B7x9Yz
总长：24 位（远低于微信 32 位限制）
字符集：仅使用数字、大小写字母（符合微信 out_trade_no 要求：数字、字母及 _-*）
```

---

## 二、API 设计

### 2.1 创建订阅订单

```
POST /api/subscription/orders
Auth: 需登录
Throttle: 每分钟 3 次（复用 ThrottleUserGuard）
Body: { planId: string, period: string, type: "new_purchase" | "upgrade" }
Response 200: { orderNo: string, amount: number, expiredAt: string }
```

**处理流程**：
1. 价格防篡改：后端计算（new_purchase → 查 Plan 价格；upgrade → PricingService.calculate()）
2. 前置状态校验：new_purchase 无 active 订阅（409）、upgrade 有 active 且目标 tier > 当前（400）
3. Redis 分布式锁：`lock:subscription:order:{userId}`，TTL 10s
4. 清理旧 PENDING 订单（若存在）：
   - 有 prepayId → 调用微信关单 + 本地标记 CLOSED。**降级处理**：若微信关单接口网络异常/超时，本地仍标记 CLOSED + 记录错误日志 + Sentry 告警，不阻塞新订单创建，由日终对账兜底
   - 无 prepayId → 直接本地标记 CLOSED（禁止调用微信关单，避免 ORDERNOTEXIST 错误阻断流程）
5. 创建订单：生成 orderNo，计算 payableAmount，expiredAt = now() + 2h，status = PENDING
   - **升级场景**：将 `PricingService.calculate()` 返回的完整结果序列化写入 `pricingSnapshot`，与订单创建在同一事务内原子完成，确保定价可追溯、不可篡改
6. 投递 BullMQ 延迟关单任务：jobId = `sub_close:${orderNo}`，delay = 2h，存入 delayCloseJobId
7. 释放分布式锁（必须在 `finally` 块中执行，确保异常时仍能释放，避免死锁阻塞用户后续下单），返回 { orderNo, amount, expiredAt }

### 2.2 发起支付

```
POST /api/subscription/orders/:orderNo/pay
Auth: 需登录
Response 200: { orderNo: string, amount: number, codeUrl: string | null }
```

**校验链**：
- 订单存在性（404）
- 所属校验：order.userId === currentUserId（403）
- 状态校验：仅 PENDING（400）
- 过期校验：expiredAt > now()，已过期返回 400 "订单已过期，请重新下单"
- 幂等：若已有 prepayId，查询微信订单状态 → 若仍可支付则返回已有 codeUrl；若微信侧已关闭则标记 FAILED + 记录 closedAt 与关闭原因，保持状态字段完整性

**支付失败处理**：调用微信下单接口异常 → 标记订单 FAILED + 记录错误信息 → 返回错误，用户可重新下单

### 2.3 查询订单状态

```
GET /api/subscription/orders/:orderNo
Auth: 需登录
Response 200: { orderNo, amount, status, payChannel, paidAt }
```

- 所属校验：order.userId === currentUserId（403）

### 2.4 关闭订单

```
POST /api/subscription/orders/:orderNo/close
Auth: 需登录
Response 200: { success: boolean }
```

**校验链**：
- 所属校验（403）
- 幂等：已 CLOSED/SUCCESS 直接返回 success（不报错）
- 仅 PENDING 可关闭（400）
- 有 prepayId → 调用微信关单 + 本地标记 CLOSED, closedAt
- 无 prepayId → 直接本地标记 CLOSED, closedAt
- **同步清理延迟任务**：通过 `delayCloseJobId` 调用 `queue.remove(jobId)` 移除 BullMQ 超时关单任务

### 2.5 微信支付回调（改造已有端点）

```
POST /api/recharge/notify/wechat
```

**路由规则**（基于 out_trade_no 前缀）：
- `SUB_` → 订阅订单处理
- `RCH_` → 充值订单处理（已有逻辑，不动）

**订阅回调处理流程**：
1. 验签通过 → 复用现有 `WechatPaymentProvider` 内置验签能力，确保与充值回调验签标准一致 → 提取 out_trade_no
2. **订单存在性校验**：查询订单，不存在则返回失败应答（拦截恶意回调）
3. **幂等校验**：status 已是 SUCCESS → 直接返回 `{ code: 'SUCCESS' }`
4. **快速落库**：原始回调数据写入 notifySummary，返回 `{ code: 'SUCCESS' }` 给微信（< 5s）
5. **异步处理**：BullMQ 入队 `subscription-payment-success` → 异步执行激活逻辑
6. **乐观锁更新**：`update({ where: { id, status: PENDING }, data: { status: SUCCESS } })` — 确保状态只能从 PENDING 流转，与超时关单并发的竞态由数据库行锁彻底解决

**支付成功异步任务事务边界**（一个 Prisma `$transaction` 内全部完成）：
- 更新 SubscriptionOrder → SUCCESS，写入 transactionId, payerOpenid, paidAt
- 新购场景：创建 UserSubscription（设置 period start/end、nextGrantDate、grantCount=1）
- 升级场景：旧订阅标记 upgraded → 创建新订阅（记录 previousSubId）
- 发放首月订阅积分：写入 CreditTransaction（type=subscription_grant），更新 UserBalance.subscriptionCredits
- 移除超时关单任务：`try { await queue.remove(delayCloseJobId) } catch { /* 任务已执行或不存在，仅记录日志，不影响主事务提交 */ }`
- 通过 Socket.io 向 userId 房间推送 `subscription:order:success` 事件（携带 orderNo）

**操作要么全部成功，要么全部回滚，杜绝资金与权益不一致。**

### 2.6 已有接口保留

- `POST /api/subscription/subscribe` — 保留不动
- `POST /api/subscription/upgrade` — 保留不动

### 2.7 错误码体系

| 错误码 | 含义 |
|--------|------|
| `SUBSCRIPTION_ORDER_NOT_FOUND` | 订单不存在 |
| `SUBSCRIPTION_ORDER_NOT_OWNER` | 订单不属于当前用户 |
| `SUBSCRIPTION_ORDER_STATUS_INVALID` | 订单状态不允许此操作 |
| `SUBSCRIPTION_ORDER_EXPIRED` | 订单已过期 |
| `SUBSCRIPTION_ALREADY_ACTIVE` | 用户已有有效订阅 |
| `SUBSCRIPTION_NO_ACTIVE` | 无有效订阅无法升级 |
| `UPGRADE_INVALID_TIER` | 目标套餐等级不高于当前 |
| `SUBSCRIPTION_PRICE_MISMATCH` | 价格校验失败 |
| `SUBSCRIPTION_DUPLICATE_ORDER` | 旧订单清理失败，无法自动创建新订单（仅异常场景，正常流程自动清理不需要前端适配） |

---

## 三、异步任务与对账

### 3.1 超时关单任务（BullMQ 延迟任务）

- **投递**：创建订单时，`jobId = sub_close:${orderNo}`，延迟 2h，存入 `delayCloseJobId`
- **执行逻辑**：查订单 → 若 PENDING 且 `expiredAt <= now()` → 调微信关单 + 标记 CLOSED, closedAt；若 PENDING 但 `expiredAt > now()` → 跳过（时钟偏差保护，避免误关单）；若已 SUCCESS/FAILED/CLOSED → 跳过
- **移除**：支付成功 + 用户主动关单时，通过 `delayCloseJobId` 精准调用 `queue.remove(jobId)`

### 3.2 支付成功处理任务（BullMQ 队列任务）

- 队列：`subscription-payment-success`
- 失败重试：3 次指数退避，超过入死信队列 + Sentry 告警
- 事务边界见 2.5

### 3.3 日终对账任务（BullMQ 定时任务）

- 每日 03:00 UTC 执行
- **幂等键**：以「对账日期」为幂等键（Redis 锁或对账记录表），避免任务重复执行
- **账单类型**：交易账单（`tradebill`）用于订单状态核对，资金账单（`fundflowbill`）用于资金流水对账
- 拉取微信前一日账单
- 与本地 SubscriptionOrder + RechargeOrder 逐一核对
- 差异分类处理：
  - 「微信已支付、本地未成功」→ 幂等执行补偿激活（复用 2.5 异步任务逻辑）
  - 「本地已成功、微信无记录」→ 标记异常 + Sentry 告警
- 生成对账差异报表

### 3.4 可观测性

| 层级 | 工具 | 内容 |
|------|------|------|
| 结构化日志 | Loki | 订单创建、支付发起、回调处理、关单、对账补偿 |
| 异常告警 | Sentry | 支付失败、对账差异、事务回滚、死信队列 |
| 核心指标 | Prometheus | 订单创建量、支付成功率、平均支付时长（创建→支付）、回调延迟 |

---

## 四、前端实现

### 4.1 WeChatQRModal 通用化改造

新增 props（若现有组件不支持）：
```typescript
interface WeChatQRModalProps {
  visible: boolean
  codeUrl: string
  orderNo: string
  amount: number
  expiredAt: string
  onSuccess: () => void
  onCancel: () => void
  // 新增：注入查询/关单方法
  queryOrderFn: (orderNo: string) => Promise<{ status: string }>
  closeOrderFn: (orderNo: string) => Promise<{ success: boolean }>
}
```

### 4.2 轮询与资源清理规则

- **轮询间隔**：固定 3 秒
- **终止条件**：status 变为 SUCCESS / CLOSED / FAILED 时立即停止
- **资源清理**：弹窗关闭、组件卸载时，清除 `setInterval`/`setTimeout` 定时器 + Socket.io disconnect + 移除事件监听
- **超时兜底**：轮询超过 5 分钟仍 PENDING → 提示"支付结果确认中，若已支付请稍后刷新页面查看"，不强制引导重新支付

### 4.3 异常状态 UI 提示

| 场景 | 提示文案 |
|------|----------|
| 二维码过期前 30s | "二维码即将过期，请尽快支付" |
| 支付接口异常 | "支付服务异常，请重试或选择其他支付方式" |
| 轮询失败 | "网络异常，正在重试确认支付结果..." |
| 支付成功但权益延迟 | "支付成功，权益正在开通中，请稍候..." |

### 4.4 MembershipPage 改造

1. 引入 `WeChatQRModal`，注入订阅版本的 `queryOrderFn` / `closeOrderFn`
2. 新增支付相关 state：`qrVisible`, `qrCodeUrl`, `qrOrderNo`, `qrAmount`, `qrExpiredAt`
3. `handleSubscribe`：创建订单 → 发起支付 → 显示二维码弹窗 → 成功 → `useSubscription.refresh()`
4. `handleUpgrade`：创建订单 → 发起支付 → 显示二维码弹窗 → 成功 → `useSubscription.refresh()`
5. **保留 loading**：创建订单+发起支付期间按钮 loading
6. **弹窗关闭**：用户主动关闭时调 `closeSubscriptionOrder`
7. **页面初始化**：
   - 查询是否存在 PENDING 订单
   - 若存在 → 弹出确认提示"您有一笔待支付的订阅订单，是否继续支付？"
   - 用户确认 → 直接调查询接口获取订单信息 → 拉起二维码弹窗（无需重新下单，提升转化）
   - 若 PENDING 订单已支付成功（SUCCESS）→ 局部刷新订阅状态
8. **价格一致性**：确认弹窗展示金额以创建订单接口返回值为准，不以前端本地计算为准
9. **支付成功过渡态**：收到 success 事件/轮询到 SUCCESS 后 → 先展示"支付成功，权益开通中..."加载态 → 待 `refresh()` 完成后再展示成功提示 → 避免页面状态闪烁

### 4.5 subscriptionApi.ts

```typescript
createSubscriptionOrder(planId: string, period: string, type: string) =>
  apiFetch<{ orderNo: string; amount: number; expiredAt: string }>(
    '/subscription/orders',
    { method: 'POST', body: JSON.stringify({ planId, period, type }) }
  )

paySubscriptionOrder(orderNo: string) =>
  apiFetch<{ orderNo: string; amount: number; codeUrl: string | null }>(
    `/subscription/orders/${orderNo}/pay`,
    { method: 'POST' }
  )

querySubscriptionOrder(orderNo: string) =>
  apiFetch<{ orderNo: string; amount: number; status: string; payChannel: string | null; paidAt: string | null }>(
    `/subscription/orders/${orderNo}`
  )

closeSubscriptionOrder(orderNo: string) =>
  apiFetch<{ success: boolean }>(
    `/subscription/orders/${orderNo}/close`,
    { method: 'POST' }
  )
```

### 4.6 Socket.io 事件

- `subscription:order:success` 事件**仅在二维码弹窗打开时注册监听**，弹窗关闭时立即 `socket.off()` 移除，避免多页面/多弹窗场景事件冲突
- 收到事件后校验 orderNo 匹配当前展示订单 → 触发 onSuccess()

### 4.7 倒计时精度

二维码倒计时以服务端返回的 `expiredAt` 为绝对基准，结合 `Date.now()` 计算剩余时长。页面刷新后倒计时仍准确，不依赖前端本地计时器累积。

---

## 五、边界与异常场景（全量）

| # | 场景 | 处理方案 |
|---|------|----------|
| 1 | 支付超时（2h） | BullMQ 延迟关单 + 前端倒计时自动关闭 |
| 2 | 重复支付（同一订单号） | 微信侧去重 + transactionId 唯一索引 |
| 3 | 回调丢失（微信未回调） | 日终对账任务补偿激活 |
| 4 | 微信重复回调（≤15次） | 订单状态幂等校验，已 SUCCESS 直接返回 |
| 5 | 回调成功与关单并发 | 乐观锁 `WHERE status=PENDING` + 行锁 |
| 6 | 支付成功但激活失败 | Prisma 事务原子性，全部回滚 |
| 7 | 用户主动关闭二维码 | 调用关单接口（微信+本地），清理定时器/Socket |
| 8 | 升级支付失败 | 原订阅不受任何影响 |
| 9 | 套餐价格变动 | 订单创建时锁定价格（pricingSnapshot），不受后续变更影响 |
| 10 | 套餐下架 | 已创建订单不受影响，支付成功仍按创建时规则激活 |
| 11 | 用户重复点击创建多笔订单 | Redis 分布式锁 + 清理旧 PENDING 订单 |
| 12 | 页面刷新/断网后重回 | 初始化时查询 PENDING 订单状态 |
| 13 | 发起支付微信接口异常 | 标记 FAILED + 记录错误，用户可重新下单 |
| 14 | 回调延迟（用户已支付但轮询未确认） | 超 5 分钟提示"结果确认中"，不引导重复支付 |
| 15 | 对账任务重复执行 | 补偿逻辑复用激活任务幂等校验 |
| 16 | 未生成预支付单即关单 | 有 prepayId 才调微信关单，否则直接本地 CLOSED |

---

## 六、架构兼容性

- **复用现有基础设施**：WechatPaymentProvider、Prisma 事务、Redis (`ioredis`)、BullMQ、PaymentGateway (Socket.io)、ThrottleUserGuard
- **无新增依赖**：不引入新的 npm 包或中间件
- **无破坏性变更**：原余额支付 API 完整保留
- **模块归属**：`SubscriptionModule` 内新增 `SubscriptionOrderService`，支付能力复用 `WechatPaymentProvider`

---

## 七、不涉及
- 余额支付模式（保留现有 API 不动）
- 自动续费（已移除）
- 管理后台变更
- 管理后台手动发放/作废逻辑

---

## 八、分阶段实施

### 第一阶段：核心链路（P0）
数据模型迁移 → SubscriptionOrderService 核心服务 → 微信支付回调改造 → 前端页面改造 → 联调测试

### 第二阶段：可靠性增强（P1）
超时关单延迟任务 → 可观测性埋点（Loki/Sentry/Prometheus）→ 异常告警配置

### 第三阶段：运营兜底（P2）
日终对账任务 → 对账报表能力
