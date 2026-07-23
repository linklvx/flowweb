# Spec: 账户余额（元）功能

## 背景

当前系统使用积分（credits/subscriptionCredits）进行消费和订阅支付。会员订阅使用 `credit.deductRegular()` 扣除普通积分，与 AI 图像生成的积分消费共用同一积分池，产生冲突。需要新增独立的"账户余额（元）"体系，支持充值，用于会员订阅等场景。

---

## 一、数据库层

### 1.1 UserBalance 新增字段

现有 `UserBalance` 已有 `userId` 唯一约束、`version` 乐观锁、`updatedAt`，只需新增：

```prisma
balance  Int  @default(0)  // 账户余额，单位：分
```

### 1.2 RechargeOrder 模型（新增）

```prisma
enum RechargeOrderStatus {
  PENDING
  SUCCESS
  FAILED
}

model RechargeOrder {
  id            String              @id @default(cuid())
  orderNo       String              @unique
  userId        String
  amount        Int                 // 充值金额，单位：分
  balanceBefore Int                 // 支付成功时快照，单位：分
  balanceAfter  Int                 // 支付成功时快照，单位：分
  status        RechargeOrderStatus @default(PENDING)
  paidAt        DateTime?
  payChannel    String?             // 支付渠道：mock / wechat / alipay
  tradeNo       String?             @unique // 第三方支付流水号
  clientIp      String?             // 客户端IP，支付风控预留
  notifyRaw     Json?               // 支付回调原始报文，对账排障预留
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt

  @@index([userId, createdAt])
  @@index([status, createdAt])
}
```

### 1.3 余额快照规则（关键）

- **创建订单时**：`balanceBefore` / `balanceAfter` 不做快照，使用默认值
- **支付成功事务内**：读取当前实时余额作为 `balanceBefore`，计算 `balanceAfter` 后写入订单
- 创建订单接口响应不含 `balanceBefore`，避免误导

---

## 二、API 层

### 2.1 鉴权约束

所有 `/api/recharge/*` 与 `/api/credits/balance` 接口：
- 统一接入 Better Auth 用户态鉴权
- 从请求上下文提取 `userId`，**禁止通过请求参数传入 `userId`**
- 查询/操作仅返回当前用户数据，杜绝越权

### 2.2 金额校验与转换规则

- 接收 `amount`（元）后，使用 `Math.round(Number(amount) * 100)` 转为整数分
- 校验规则：金额范围 1 ~ 10000 元，小数位 ≤ 2 位
- 非法直接返回参数错误
- 响应中金额（元）统一保留两位小数

### 2.3 接口列表

#### `GET /api/credits/balance`（修改）

响应新增 `balance` 字段：

```json
{
  "credits": 100,
  "subscriptionCredits": 50,
  "subscriptionCreditsExpiry": "2026-08-01T00:00:00.000Z",
  "balance": 200.00,
  "updatedAt": "2026-07-23T12:00:00.000Z"
}
```

#### `POST /api/recharge/orders` — 创建充值订单

- Request: `{ amount: number }`（元，1~10000，最多 2 位小数）
- Response: `{ id, orderNo, amount, status, createdAt }`（不含 balanceBefore）

#### `POST /api/recharge/orders/:orderNo/pay` — 发起支付

**事务原子执行流程：**

1. 查询订单，校验 `userId` 归属 + `status === PENDING`
2. 原子递增余额：`balance: { increment: amount }`
3. 更新订单：`status = SUCCESS`、`paidAt = now()`、`payChannel = 'mock'`、`balanceBefore/After` 快照
4. 任一失败，整体回滚

**幂等保障：** 更新订单时携带条件 `where: { orderNo, status: PENDING }`。终态订单重复调用直接返回原结果，不重复入账。

- Response: `{ orderNo, amount, balanceBefore, balanceAfter, status: "SUCCESS", paidAt }`

#### `GET /api/recharge/orders` — 查询充值记录

- Query: `page`（默认 1）, `pageSize`（默认 20）
- Response: `{ items: RechargeOrder[], total, page, pageSize }`
- 仅返回当前用户记录，按 `createdAt` 倒序

### 2.4 错误码

基于项目现有 `BusinessException` 扩展：

| 错误码 | 含义 |
|--------|------|
| `INVALID_RECHARGE_AMOUNT` | 金额格式或范围非法 |
| `RECHARGE_ORDER_NOT_FOUND` | 订单不存在或不属于当前用户 |
| `RECHARGE_ORDER_STATUS_ERROR` | 订单状态不允许支付（非 PENDING） |
| `RECHARGE_BALANCE_UPDATE_FAILED` | 余额更新事务执行失败 |

### 2.5 订单状态机

```
PENDING → SUCCESS
PENDING → FAILED
终态（SUCCESS / FAILED）不可逆向变更
```

---

## 三、前端层

### 3.1 CreditsPage 改造（`/settings/credits`）

**双卡片布局：**

- 积分余额卡片（保留现有）：⚡ {credits} + 最后更新时间
- 账户余额卡片（新增）：¥ {balance}（保留两位小数）+ 最后更新时间

**充值面板：**

- 金额输入框（数字，校验范围 1~10000，最多 2 位小数）
- 预设金额快捷按钮：10 / 50 / 100 / 200 / 500 元
- "立即充值"按钮

**交互约束：**

- **防重控制**：点击"立即充值"后按钮立即置灰 + loading，请求完成后恢复
- **实时校验**：金额不符合规则时"立即充值"按钮置灰
- **展示规范**：余额和充值记录金额统一保留两位小数，带 ¥ 符号

**充值记录列表（可折叠）：**

- 列表展示：金额、时间、状态
- 分页加载
- 金额带 ¥ 符号与两位小数

### 3.2 充值流程

```
用户输入金额 → 点击"立即充值" → POST /api/recharge/orders 创建订单
→ POST /api/recharge/orders/:orderNo/pay 发起支付
→ 成功后刷新余额 + 追加充值记录
```

---

## 四、非功能需求

1. 余额更新与订单状态变更必须在同一数据库事务内完成
2. 订单状态遵循严格状态机，终态不可逆向变更
3. 所有接口必须通过用户鉴权，仅可操作当前用户数据

---

## 五、延后项（不纳入本次）

以下内容经评估后不纳入本次开发范围：

- **UserBalanceLog 统一流水表** — 待订阅扣款切换到余额时再建设
- **Redis 级幂等控制** — DB 层条件更新已满足当前防重需求
- **APISIX 网关层限流** — 项目无此基础设施
- **Prometheus / Loki / Sentry** — 充值量级尚不需要专项埋点
- **日终对账脚本与人工调账后台** — 上线后视需要迭代

---

## 六、成功标准

1. `/settings/credits` 页面同时显示积分余额和账户余额双卡片
2. 用户可通过充值面板增加账户余额，金额精确到分
3. 余额变更可追溯（RechargeOrder 记录含 balanceBefore/After 快照）
4. 重复点击不会产生重复入账
5. 刷新页面后余额和订单记录保持不变
6. 数据库 migration 无错误
