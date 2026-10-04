<!-- doc-status: historical | verified_at: n/a -->
# Spec: 微信支付 Native 扫码支付集成

## 背景

当前充值流程使用 `MockPaymentProvider`，调用 `pay()` 即直接成功入账。此 mock 路径存在严重生产风险：若配置遗漏导致生产环境使用 mock provider，用户可免费获取余额。

**核心原则**：移除所有 mock/即时支付路径。余额仅通过微信支付回调入账。未配置微信凭证时 API 启动即报错（fail-fast）。

**生产域名**：`https://www.flow123.com`

---

## 一、架构变更

### 1.1 移除 MockPaymentProvider

- 删除 `MockPaymentProvider` 类
- `RechargeModule` 仅注册 `WechatPaymentProvider` 作为唯一支付实现
- 无支付 provider 切换逻辑，无降级路径

### 1.2 支付流程（唯一路径）

```
用户选择金额 → POST /api/recharge/orders（创建订单 + 投递 2h 过期延迟任务，含重试）
→ POST /api/recharge/orders/:orderNo/pay（归属校验 → 幂等检查 → 微信 Native 下单 → 返回 code_url）
→ 前端展示二维码弹窗（二维码 + 倒计时 + Socket.io 主通道 + 轮询降级）
→ 用户微信扫码支付
→ 微信 POST /api/recharge/notify/wechat（回调通知）
→ Content-Type 校验 → Nonce 去重(Redis) → 时间戳防重放(±5min) → 验签 → AEAD 解密 → 校验 appid/mchid/currency/金额
→ FOR UPDATE 悲观行锁 → 原子递增余额 → 更新订单 SUCCESS
→ Socket.io 推送 → Sentry 记录 → Prometheus 打点
→ 前端监听 → 关闭弹窗 + 刷新余额
```

### 1.3 IPaymentProvider 接口

```typescript
export interface CreatePaymentResult {
  codeUrl: string;      // weixin://wxpay/bizpayurl?pr=... 二维码内容
  prepayId: string;     // 微信预支付交易会话标识
}

export interface NotifyResult {
  outTradeNo: string;    // 商户订单号 = orderNo
  transactionId: string; // 微信支付交易号
  tradeState: string;    // SUCCESS / NOTPAY / CLOSED / PAYERROR / ...
  tradeStateDesc: string;
  amount: number;        // 实付金额，单位：分
  payerOpenid: string;
  appid: string;
  mchid: string;
}

export interface IPaymentProvider {
  /** 创建微信 Native 支付订单，返回二维码 URL。网络波动类错误内部重试 2 次（指数退避） */
  createPayment(order: {
    orderNo: string;
    amount: number;
    userId: string;
    description: string;
    notifyUrl: string;
    timeExpire: string;      // RFC 3339 过期时间，与本地 2h 对齐
  }): Promise<CreatePaymentResult>;

  /** 查询微信侧订单状态（主动查单兜底用） */
  queryOrder(orderNo: string): Promise<{
    tradeState: string;
    tradeStateDesc: string;
    transactionId?: string;
    amount?: number;
    payerOpenid?: string;
  }>;

  /** 解析并验证微信支付回调通知（验时间戳 + 匹配公钥ID + 验签 + 解密） */
  parseNotify(headers: Record<string, string>, rawBody: Buffer): Promise<NotifyResult>;

  /** 关闭微信侧支付订单 */
  closePayment(orderNo: string): Promise<void>;
}
```

---

## 二、数据库层

### 2.1 Prisma Schema 变更

```prisma
enum RechargeOrderStatus {
  PENDING
  SUCCESS
  FAILED
  CLOSED     // 新增：用户取消 或 超时自动关闭
}

model RechargeOrder {
  id             String              @id @default(cuid())
  orderNo        String              @unique
  userId         String
  amount         Int                 // 充值金额，单位：分（整数）
  balanceBefore  Int                 @default(0)   // 单位：分
  balanceAfter   Int                 @default(0)   // 单位：分
  status         RechargeOrderStatus @default(PENDING)
  payChannel     String?             @db.VarChar(32)  // "wechat"
  prepayId       String?             @db.VarChar(64)  // 微信预支付 ID
  transactionId  String?             @db.VarChar(64)  // 微信支付交易号
  payerOpenid    String?             @db.VarChar(64)  // 付款人 openid
  paidAt         DateTime?
  expiredAt      DateTime?           // 订单创建时写入：createdAt + 2h
  closedAt       DateTime?           // 订单关闭时间
  remark         String?             @db.VarChar(512) // 异常备注（回调失败原因、人工处理记录等）
  clientIp       String?
  notifySummary  Json?               // 回调核心业务字段（不含 openid、完整报文）
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  @@index([userId, createdAt])
  @@index([status, createdAt])
  @@index([status, expiredAt])
}

model UserBalanceTransaction {
  id             String    @id @default(cuid())
  userId         String
  amountFen      Int       // 变动金额（正=入账，负=出账），单位：分
  balanceBefore  Int       // 变动前余额，单位：分
  balanceAfter   Int       // 变动后余额，单位：分
  type           BalanceTxType  // RECHARGE / CONSUME / REFUND / ADJUST
  bizOrderNo     String    // 关联业务单号（RechargeOrder.orderNo）
  createdAt      DateTime  @default(now())

  @@index([userId, createdAt])
  @@index([bizOrderNo])
}

enum BalanceTxType {
  RECHARGE
  CONSUME
  REFUND
  ADJUST
}
```

**字段变更说明**：
- `notifyRaw` → 重命名为 `notifySummary`，仅存储 `transactionId`/`tradeState`/`tradeStateDesc`/`amount` 核心字段，**禁止存储完整加密报文和 openid**
- 新增 `prepayId`、`transactionId`、`payerOpenid`、`expiredAt`、`closedAt`、`remark`
- `expiredAt` 在订单创建时写入（`createdAt + 2h`），与 BullMQ 延迟任务触发时间严格对齐
- **新增 `UserBalanceTransaction` 表** — 余额变动流水，记录每次充值/消费/退款的金额、前后余额、关联业务单号，满足审计和对账需求

### 2.2 金额单位规范（强制）

| 层级 | 单位 | 示例 |
|------|------|------|
| 数据库 `amount` / `balance` / `balanceBefore` / `balanceAfter` | **分（Int 整数）** | 5000 = 50.00 元 |
| 微信 API 交互 `amount.total` | **分（Int）** | 5000 |
| 服务层内部计算 | **分（Int）** | 所有运算使用整数 |
| 前端 API 响应 / 显示 | **元（number，保留 2 位小数）** | 50.00 |
| 前端请求参数 `amount` | **元（number，max 2 位小数）** | 50.00 |

转换规则：
- 元 → 分：`Math.round(amount * 100)` — Controller 入参校验时转换
- 分 → 元：`amount / 100` — Controller 响应序列化时转换

### 2.3 订单号生成规范

```typescript
// RC + 8位日期(YYYYMMDD) + 4位userHash(大写字母数字) + 6位随机数字 = 20 字符
// 符合微信 out_trade_no 约束：≤32 位，仅数字、字母、下划线
generateRechargeOrderNo(userId) => `RC${date}${userHash}${random}`
```

### 2.4 并发安全：悲观行锁

使用 Prisma `$queryRaw` 模板字面量（自动参数化绑定，防 SQL 注入）：

```typescript
await tx.$queryRaw`
  SELECT * FROM "UserBalance"
  WHERE "userId" = ${userId}
  FOR UPDATE
`;
```

> **禁止使用 `$queryRawUnsafe` 或字符串拼接**。Prisma `$queryRaw` 模板字面量自动将 `${}` 变量作为预编译参数绑定，完全规避注入风险。

### 2.5 订单过期自动关闭

**方案一（主）**：BullMQ 延迟任务

```typescript
// rechargeQueue.add('close-expired-order', { orderNo, userId },
//   { delay: 2 * 60 * 60 * 1000, attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
```

- 订单创建成功（事务提交后）投递，投递失败重试 3 次
- 任务处理器：检查 `status === 'PENDING'` → 调用 `wechatProvider.closePayment(orderNo)` → 更新 `status = 'CLOSED', closedAt = now()`

**方案二（兜底）**：每日凌晨补偿扫描

```
扫描 status='PENDING' AND expiredAt < now() 的订单 → 批量调用微信关闭接口 → 标记 CLOSED
```

### 2.6 BullMQ 任务与数据库事务非原子性处理

订单创建在 Prisma 事务内，BullMQ 任务在事务提交成功后投递。投递失败时：

1. **同步重试**：任务投递失败立即重试，最多 3 次（BullMQ `attempts: 3`）
2. **兜底补偿**：2.5 节每日扫描脚本覆盖任务投递丢失场景（订单仍为 PENDING 且超过 24h）

---

## 三、API 层

### 3.0 充值档位配置（防篡改攻击）

**核心约束**：后端维护固定充值档位，禁止前端传入任意金额。攻击者无法通过抓包篡改金额造成资损。

```typescript
// 配置常量（分）
const RECHARGE_TIERS_FEN = [
  1000,   // 10 元
  3000,   // 30 元
  5000,   // 50 元
  10000,  // 100 元
  20000,  // 200 元
  50000,  // 500 元
];
```

`POST /api/recharge/orders` 创建订单时必须校验 `amountFen` 是否在 `RECHARGE_TIERS_FEN` 范围内，非档位金额直接返回参数错误。

### 3.1 `POST /api/recharge/orders`（行为变更）

**变更**：新增档位校验 + 客户端 IP 采集。

创建订单时：
1. Controller 解析 `amount`（元）→ 转分，校验是否属于 `RECHARGE_TIERS_FEN`
2. 从 `X-Forwarded-For` / `X-Real-IP` 头提取客户端真实 IP，存入 `clientIp` 字段（风控溯源预留）
3. 其余逻辑不变：订单号生成、PENDING 状态、投递 2h 过期 BullMQ 任务

### 3.2 `POST /api/recharge/orders/:orderNo/pay`（行为变更）

**变更前**：调用 mock 支付 → 立即更新余额 → 返回 `balanceAfter`

**变更后**：归属校验 → 幂等检查 → 调用微信 Native 下单 → 记录 `payChannel`/`prepayId` → 返回 `codeUrl`

**幂等逻辑**：
1. 查询订单，校验 `userId` 归属
2. 若 `status !== 'PENDING'` → 抛出 `RECHARGE_ORDER_STATUS_ERROR`
3. 若 `prepayId` 已存在 → 直接返回已有 `codeUrl`，不重复调用微信接口
4. 仅 `prepayId === null` 时调用微信 Native 下单接口

Response 200:
```json
{
  "orderNo": "RC20260726A1B2C3D4",
  "amount": 50.00,
  "status": "PENDING",
  "codeUrl": "weixin://wxpay/bizpayurl?pr=..."
}
```

微信 API 调用失败时 HTTP 200（服务内部错误）:
```json
{
  "code": "RECHARGE_PAY_CHANNEL_FAILED",
  "message": "支付渠道暂时不可用，请稍后重试"
}
```

### 3.3 `POST /api/recharge/notify/wechat`（新增）

微信支付回调通知端点。**无需用户鉴权**（使用微信签名验证身份）。

**HTTP 状态码规则**（严格遵循微信支付 V3 官方规范）：

| 场景 | HTTP 状态码 | 响应体 | 微信行为 |
|------|-----------|--------|---------|
| Content-Type 非法 / 验签不通过 | **400 或 500** | `{ "code": "FAIL", "message": "..." }` | 判定接收失败，触发重试 |
| 验签通过，业务校验失败（金额不符、订单终态、币种错误等） | **200** | `{ "code": "FAIL", "message": "..." }` | 判定接收成功但业务失败，按策略重试 |
| 验签通过且业务处理成功 | **200** | `{ "code": "SUCCESS", "message": "OK" }` | 终止重试 |

**设计原理**：HTTP 状态码是微信判断「商户是否正常接收通知」的核心依据。验签失败说明通知本身非法，返回非 200 让微信重试/告警；验签通过说明通知确实来自微信，无论业务成败都应返回 200。

**安全校验链**（按顺序执行）：

**第一层 — 请求合法性校验（不通过 → HTTP 400/500，微信重试）**：

1. **Content-Type 校验**：仅接受 `application/json`
2. **Nonce 去重**：提取 `Wechatpay-Nonce` 头，Redis `SET NX EX 300` 原子写入（Key: `wechat:pay:notify:nonce:{nonce}`），已存在直接返回 HTTP 200 + SUCCESS（微信重试导致，非攻击）
3. **时间戳防重放**：`|Wechatpay-Timestamp - now()| ≤ 300s`（Nonce + 时间戳双重防重放）
4. **公钥 ID 匹配**：`Wechatpay-Serial` === `WECHAT_PAY_PUBLIC_KEY_ID`
5. **签名验证**：使用匹配的公钥验证 `Wechatpay-Signature`

**第二层 — 业务合法性校验（不通过 → HTTP 200 + FAIL，微信按策略重试）**：

6. **AEAD 解密**：`AEAD_AES_256_GCM` 解密 resource ciphertext
7. **跨商户防护**：回调 `appid` / `mchid` 与系统配置一致
8. **币种校验**：`currency === 'CNY'`（非人民币直接拒绝）
9. **金额校验**：回调 `amount` 与订单 `amount`（分）严格相等
10. **只有 `tradeState === 'SUCCESS'` 才执行入账**

**入账事务**（任一环节抛异常 → 事务回滚 → Sentry 告警）：
```
$queryRaw FOR UPDATE 行锁 → 读取余额 → 原子递增 → 条件更新订单 SUCCESS
```

**幂等**：终态订单（SUCCESS/CLOSED）直接返回 `{ code: 'SUCCESS', message: 'OK' }`，流程不进入入账事务。

**响应格式**（不经过 TransformInterceptor 和全局异常过滤器包装）：
```json
{ "code": "SUCCESS", "message": "OK" }
```
```json
{ "code": "FAIL", "message": "signature verification failed" }
```

**Sentry 告警分级**（所有告警携带 `orderNo` 标签）：

| 级别 | 触发条件 |
|------|---------|
| **高优** | 验签失败、金额不一致、入账事务异常 |
| **低优** | 终态订单重复回调、Nonce 重放拦截、微信关闭接口返回状态冲突 |

### 3.4 `GET /api/recharge/orders/:orderNo`（新增）

查询单笔订单状态。前端轮询使用。

Response:
```json
{
  "orderNo": "RC20260726A1B2C3D4",
  "amount": 50.00,
  "status": "SUCCESS",
  "payChannel": "wechat",
  "paidAt": "2026-07-26T12:00:00.000Z"
}
```

### 3.5 `POST /api/recharge/orders/:orderNo/close`（新增）

用户主动取消支付。**需归属校验**（仅订单所属用户可关闭）。

**幂等处理**（前置）：
- 订单已为 `CLOSED` / `SUCCESS` → 直接返回成功，不调用微信接口

**正常流程**：
1. 校验 `userId` 归属
2. 仅 `status === 'PENDING'` 可关闭
3. 调用 `wechatProvider.closePayment(orderNo)` 关闭微信侧订单
4. **状态一致性处理**：
   - 微信关闭成功 → 更新 `status = 'CLOSED', closedAt = now()`
   - 微信返回「已支付」→ 重新查询订单状态，若已 SUCCESS 则不操作；若仍 PENDING → Sentry 告警（状态不一致），**不强制变更为 CLOSED**
   - 微信返回「已关闭」/「不存在」→ 直接更新本地为 CLOSED（幂等）
5. BullMQ 过期任务和每日兜底扫描遵循同样的一致性处理逻辑

### 3.6 主动查单兜底（回调丢失补偿）

回调通知是微信支付推送的，存在网络波动丢失的可能。新增 BullMQ 延迟查单任务作为补偿。

**机制**：订单创建后投递多个延迟查单任务（5 分钟 / 15 分钟 / 30 分钟）：

1. 到达延迟时间 → 检查订单 `status`
2. 若仍为 `PENDING` → 调用微信查单接口 `/v3/pay/transactions/out-trade-no/{orderNo}`
3. 微信返回 `tradeState === 'SUCCESS'` → 执行入账事务（同回调逻辑）
4. 微信返回 `tradeState === 'CLOSED'` → 标记 `CLOSED`
5. 微信返回其他状态 → Sentry 低优告警，记录 `remark` 字段
6. 若已为终态 → 不操作

**与回调的关系**：查单任务和回调竞争执行，`WHERE status='PENDING'` 条件更新确保先到的生效，后到的幂等跳过。

**入账逻辑统一复用**：主动查单和回调入账必须复用同一 Service 层方法 `completeOrderInTransaction(orderNo, tradeNo, channel, tx)`，包含行锁、余额递增、订单更新、流水写入。禁止两套独立逻辑，避免逻辑不一致导致资损。

### 3.7 客户端 IP 取数规则

创建订单时提取客户端 IP 规则：
- 优先取 `X-Forwarded-For` 头中**第一个非内网 IP**（`10.x`, `172.16-31.x`, `192.168.x` 视为内网）
- 多层代理场景下第一个外网 IP 才是最接近用户的真实 IP
- 若无外网 IP 则取 `X-Real-IP`
- 均无则记录 `0.0.0.0`

### 3.8 用户级频控

创建订单接口增加频率限制（复用 NestJS `@ThrottlerGuard` 或手动实现）：

```
单用户 POST /api/recharge/orders — 每分钟最多 3 次
```

防止恶意刷接口占用微信下单资源。

---

## 四、前端层

### 4.1 CreditsPage 充值流程变更

**档位按钮**：前端仅展示后端允许的固定金额档位（从后端获取或与前端的 `PRESET_AMOUNTS` 常量保持一致），移除自定义金额输入框。用户点击档位按钮 → 选中该金额 → 点击"立即充值"。

```
点击档位按钮选择金额 → 点击"立即充值"
→ POST /api/recharge/orders（后端校验金额是否在允许档位内）
→ POST /api/recharge/orders/:orderNo/pay（获取 codeUrl）
→ 打开 WeChatQRModal（展示二维码）
   ├─ 主通道：Socket.io 监听 recharge:payment:{orderNo} 事件
   ├─ 降级：每 2s 轮询 GET /api/recharge/orders/:orderNo
   └─ 倒计时：展示二维码剩余有效时间
→ 状态检测：
   ├─ SUCCESS → 关闭弹窗 → 刷新余额 + 订单记录
   ├─ CLOSED → 关闭弹窗 → 提示"订单已关闭"
   ├─ FAILED → 关闭弹窗 → 提示"支付失败"
   └─ 超时 → 提示"支付超时" → POST close
→ 取消支付 → POST /api/recharge/orders/:orderNo/close → 关闭弹窗
```

### 4.2 WeChatQRModal 组件（新增）

Props:
- `visible: boolean`
- `codeUrl: string`
- `orderNo: string`
- `amount: number` — 展示金额（元）
- `expiredAt: string` — 过期时间 ISO 字符串
- `onSuccess: () => void`
- `onCancel: () => void`

行为:
- 使用 `qrcode` 库将 `codeUrl` 渲染为 Canvas 二维码
- 倒计时显示剩余有效时间（后端同步 `expiredAt`）
- **主通道**：Socket.io 认证连接 → join room `recharge:payment:{orderNo}` → 监听 `payment:success` 事件
- **降级通道**：阶梯式轮询 `GET /api/recharge/orders/:orderNo`
  - 0~30s：2s 间隔
  - 30s~2min：5s 间隔
  - 2min 后：10s 间隔
- 任一通道检测到 `SUCCESS` → 停止全部 → `onSuccess`
- 检测到 `CLOSED` / `FAILED` → 立即停止轮询 → 展示对应提示
- 倒计时归零 → 提示"二维码已过期" → 自动 `POST close`
- "取消支付"按钮 → `POST close` → `onCancel`

### 4.3 前端订单状态枚举

```typescript
type OrderStatus = 'PENDING' | 'SUCCESS' | 'CLOSED' | 'FAILED';
```

状态映射：
| 状态 | 中文 | 图标色 |
|------|------|--------|
| PENDING | 处理中 | 橙色 #f59e0b |
| SUCCESS | 成功 | 绿色 #4ade80 |
| CLOSED | 已关闭 | 灰色 #666 |
| FAILED | 失败 | 红色 #ef4444 |

### 4.4 Socket.io 支付网关约定

**认证**：客户端连接时携带 token（复用现有 `ExecutionGateway` 认证模式）：
```typescript
const socket = io('/payment', {
  auth: { token: sessionToken },
});
```

**事件**：

| 事件 | 方向 | Payload |
|------|------|---------|
| `join:order` | Client → Server | `{ orderNo: string }` |
| `payment:success` | Server → Client | `{ orderNo: string, amount: number, balanceAfter: number }` |
| `payment:failed` | Server → Client | `{ orderNo: string }` |

**越权防护**：服务端在 `join:order` 处理中查询订单，校验 `order.userId === socket.data.userId`，非归属用户拒绝加入房间。

---

## 五、运行环境配置

### 5.1 环境变量

```env
# ── 微信支付 API v3（必填，API 启动时 Fail-Fast 校验）──
# 商户信息
WECHAT_PAY_APP_ID=wx1234567890abcdef
WECHAT_PAY_MCH_ID=1234567890
WECHAT_PAY_API_V3_KEY=5fc67c183c3a575130c66517a707cf0a
# 商户 API 证书
WECHAT_PAY_MERCHANT_SERIAL_NO=77D5D85B4F8D919C12DE0BCE8B614E6490EDC71B
WECHAT_PAY_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
WECHAT_PAY_MERCHANT_CERT="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
# 微信支付公钥（用于回调验签）
WECHAT_PAY_PUBLIC_KEY_ID=PUB_KEY_ID_0117466919672026072600181691003802
WECHAT_PAY_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
# 回调地址
WECHAT_PAY_NOTIFY_URL=https://www.flow123.com/api/recharge/notify/wechat
```

**证书文件与环境变量对应关系**：

| 微信支付提供的文件 | 对应环境变量 | 用途 |
|-------------------|-------------|------|
| `apiclient_key.pem` | `WECHAT_PAY_PRIVATE_KEY` | 商户私钥 — 签署发往微信的 API 请求 |
| `apiclient_cert.pem` | `WECHAT_PAY_MERCHANT_CERT` | 商户证书 — API 请求携带，标识商户身份 |
| `apiclient_cert.p12` | *不需要* | PKCS12 格式，PEM 文件已覆盖所需内容 |
| 微信支付公钥（商户平台下载） | `WECHAT_PAY_PUBLIC_KEY` | 验证微信支付回调通知的签名 |
| 微信支付公钥 ID（商户平台获取） | `WECHAT_PAY_PUBLIC_KEY_ID` | 匹配回调 `Wechatpay-Serial` 头 |

**密钥格式兼容**：
- **方式一（推荐 `.env` 文件）**：双引号包裹 + `\n` 换行符
- **方式二（容器环境变量注入）**：Base64 编码的 PEM 内容，启动时自动解码

### 5.2 Fail-Fast 启动校验

`RechargeModule` 初始化时执行：

```typescript
// ① 非空检查（逐字段校验，缺失时明确报出缺少哪个变量）
const requiredVars = ['WECHAT_PAY_APP_ID', 'WECHAT_PAY_MCH_ID', ...];
for (const key of requiredVars) {
  if (!process.env[key]) throw new Error(`WeChat Pay 配置不完整，拒绝启动 — 缺少: ${key}`);
}

// ② PEM 头尾标记检查
['WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_MERCHANT_CERT', 'WECHAT_PAY_PUBLIC_KEY'].forEach(key => {
  if (!process.env[key]?.includes('-----BEGIN')) throw new Error(`${key} 格式无效`);
});

// ③ 密钥格式有效性校验（使用 Node.js crypto 模块）
crypto.createPrivateKey(process.env.WECHAT_PAY_PRIVATE_KEY!);
crypto.createPublicKey(process.env.WECHAT_PAY_PUBLIC_KEY!);
new crypto.X509Certificate(process.env.WECHAT_PAY_MERCHANT_CERT!); // 证书合法性校验
```

### 5.3 Raw Body 获取方式

采用 NestJS 原生 `rawBody: true` 方案（无需手动中间件，不影响其他路由 JSON 解析）：

```typescript
// main.ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  rawBody: true,
});

// controller
@Post('notify/wechat')
async notify(@Req() req: RawBodyRequest<Request>) {
  const rawBody = req.rawBody; // Buffer
  const result = await this.paymentProvider.parseNotify(headers, rawBody);
  // ...
}
```

### 5.4 回调端点排除全局拦截器

`POST /api/recharge/notify/wechat` 必须排除 `TransformInterceptor` 和全局异常过滤器：

```typescript
// 使用自定义 @NoTransform() 装饰器
@Post('notify/wechat')
@NoTransform()
async notify(...) { ... }
```

异常也需手动 catch 并拼接标准格式返回，确保微信始终收到 HTTP 200 + 标准格式 body。

### 5.5 APISIX 网关回调路由配置

项目使用 APISIX 作为网关。回调路由 `/api/recharge/notify/wechat` 必须确保原始请求体完整透传，**关闭所有 Body 改写插件**（日志格式化、参数转换、限流等），否则验签必然失败。

APISIX 配置 checklist：
- 回调路由不启用 `body-transformer`、`response-rewrite` 等改写插件
- 回调路由不启用针对该路由的 `limit-req` / `limit-count` 限流（微信可能短时间内重试多次）
- 如启用 `file-logger` 等日志插件，确认不会对 Body 做格式化修改
- 回调路由增加请求方法限制，**仅允许 POST**，过滤 GET/PUT/DELETE 等非法请求，收敛攻击面
- 回调路由**显式禁用全局用户鉴权插件**（如 `forward-auth`、`key-auth`），该端点依赖微信签名验证而非用户 Token

---

## 六、可观测性

### 6.1 Sentry 告警

项目已集成 `@sentry/node` v10。支付资金链路必须接入，沿用现有 `Sentry.captureException` 模式：

```typescript
import * as Sentry from '@sentry/node';

Sentry.captureException(new Error('Recharge callback verify failed'), {
  tags: {
    module: 'recharge',
    errorType: 'CALLBACK_VERIFY_FAILED',
    orderNo,
  },
});
```

**告警触发条件**：验签失败、金额不一致、入账事务异常、幂等拦截（低优先级）

### 6.2 Prometheus 指标

新增支付相关指标（沿用项目现有 metrics 模式）：

| 指标名 | 类型 | 标签 |
|--------|------|------|
| `recharge_order_create_total` | Counter | `{channel: "wechat"}` |
| `recharge_callback_total` | Counter | `{result: "success"\|"fail"}` |
| `recharge_balance_incr_total` | Counter | `{type: "callback"\|"query"}`（区分回调入账和查单入账） |
| `recharge_callback_duration_seconds` | Histogram | `{result: "success"\|"fail"}` |
| `recharge_daily_amount_total` | Counter | 每日充值成功总金额（分），用于日终对账 |
| `recharge_daily_count_total` | Counter | 每日充值成功总笔数 |

### 6.3 日志规范

所有资金操作日志必须携带 `orderNo`、`userId`、`traceId`：

```typescript
this.logger.log(`Recharge callback processed`, { orderNo, userId, status: 'SUCCESS' });
```

**禁止打印**：完整加密报文、openid、用户手机号等敏感信息。回调异常仅记录 `orderNo` + `amount` + 错误摘要。

---

## 七、技术选型：wechatpay-axios-plugin

**选定 `wechatpay-axios-plugin`**，原生支持微信支付公钥模式，与项目技术栈（TypeScript + axios）完全匹配。无需自研签名/验签/解密逻辑。

### 7.1 初始化配置

```typescript
import { Wechatpay, AesGcm } from 'wechatpay-axios-plugin';

function normalizePem(key: string): string {
  return key.replace(/\\n/g, '\n');
}

const wxpay = new Wechatpay({
  mchid: process.env.WECHAT_PAY_MCH_ID!,
  serial: process.env.WECHAT_PAY_MERCHANT_SERIAL_NO!,
  privateKey: normalizePem(process.env.WECHAT_PAY_PRIVATE_KEY!),
  certs: {
    [process.env.WECHAT_PAY_PUBLIC_KEY_ID!]: normalizePem(process.env.WECHAT_PAY_PUBLIC_KEY!),
  },
});
```

`certs` 以公钥 ID 为键名，SDK 自动按 `Wechatpay-Serial` 匹配对应公钥完成验签。

### 7.2 核心能力映射

| 业务方法 | SDK 调用 |
|---------|---------|
| `createPayment` Native 下单 | `wxpay.v3.pay.transactions.native.post({...})` |
| `queryOrder` 查单 | `wxpay.v3.pay.transactions.outTradeNo.${out_trade_no}.get()` |
| `closePayment` 关闭订单 | `wxpay.v3.pay.transactions.outTradeNo.${out_trade_no}.close.post({...})` |
| 回调 AEAD 解密 | `AesGcm.decrypt(ciphertext, apiV3Key, nonce, associatedData)` |
| 回调签名验证 | SDK certs 配置后自动处理 |

### 7.3 下单参数规范

```typescript
// description ≤ 127 字符，固定格式：
`Flow123 AI创作平台充值 - ${amountYuan}元`

// time_expire RFC 3339 秒级精度，东八区格式，确保 100% 兼容微信官方规范
// 禁止使用 toISOString()（带毫秒 + Z 格式，存在解析不兼容风险）
const t = new Date(Date.now() + 2 * 60 * 60 * 1000);
const timeExpire = t.getFullYear() + '-'
  + String(t.getMonth() + 1).padStart(2, '0') + '-'
  + String(t.getDate()).padStart(2, '0') + 'T'
  + String(t.getHours()).padStart(2, '0') + ':'
  + String(t.getMinutes()).padStart(2, '0') + ':'
  + String(t.getSeconds()).padStart(2, '0') + '+08:00';
  appid: process.env.WECHAT_PAY_APP_ID,
  mchid: process.env.WECHAT_PAY_MCH_ID,
  description: `Flow123 AI创作平台充值 - ${amountYuan}元`,
  out_trade_no: orderNo,
  notify_url: process.env.WECHAT_PAY_NOTIFY_URL,
  time_expire: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  amount: { total: amountFen, currency: 'CNY' },
});
```

### 7.4 PEM 格式兼容

`normalizePem()` 统一处理 `\n` 转义，兼容 `.env` 文件、Docker、K8s 等多种部署环境的换行符解析差异。生产环境优先推荐 Base64 编码注入，避免换行符转义差异。

### 7.5 SDK 版本锁定

锁定大版本号（如 `^1.x`），避免 SDK 自动升级引入破坏性变更。升级前在开发环境验证签名/验签/解密全链路。

---

## 八、安全约束清单

| # | 约束 | 实现 |
|---|------|------|
| 1 | 余额仅通过回调入账 | `POST /orders/:orderNo/pay` 仅返回 codeUrl，不修改余额 |
| 2 | 充值金额档位校验 | 后端固定档位配置，禁止前端传入任意金额 |
| 3 | Content-Type 校验 | 仅接受 `application/json` |
| 4 | Nonce 去重 | Redis `SET NX EX 300`，防止 5 分钟窗口内重放 |
| 5 | 回调时间戳防重放 | `|Timestamp - now()| ≤ 300s`（双重防重放） |
| 6 | 公钥 ID 匹配 | `Wechatpay-Serial === WECHAT_PAY_PUBLIC_KEY_ID` |
| 7 | 回调签名验证 | SHA256-RSA256 使用微信支付公钥 |
| 8 | 跨商户防护 | 回调 appid / mchid 与配置一致 |
| 9 | 币种校验 | `currency === 'CNY'` |
| 10 | 金额校验 | 回调金额 === 订单金额（分） |
| 11 | 悲观行锁 | `SELECT ... FOR UPDATE` |
| 12 | 幂等 | `WHERE status='PENDING'` 条件更新 |
| 13 | 回调 HTTP 状态码分场景 | 验签不通过 → 4xx/5xx（微信重试）；验签通过 → 200 + body code 区分业务结果 |
| 14 | 关闭订单状态一致性 | 微信关闭失败不强制本地 CLOSED，区分处理 |
| 15 | Socket 越权防护 | join room 前校验订单归属 |
| 16 | 关闭订单鉴权 | 仅订单所属用户可关闭 |
| 17 | Fail-Fast | 微信配置不全时拒绝启动（含 crypto 校验） |
| 18 | 日志脱敏 | 不记录 openid、加密报文完整内容 |
| 19 | 回调报文不落库 | notifySummary 仅存核心字段 |
| 20 | 客户端 IP 采集 | 创建订单时从 X-Forwarded-For 提取，风控溯源 |
| 21 | 余额变动流水 | UserBalanceTransaction 记录每次变动，满足审计对账 |
| 22 | 主动查单兜底 | BullMQ 延迟查单（5/15/30min）补偿回调丢失 |
| 23 | 用户级频控 | 创建订单单用户 ≤ 3 次/分钟 |
| 24 | 网关 Body 透传 | APISIX 回调路由关闭所有 Body 改写插件 |
| 25 | SDK 版本锁定 | 锁定大版本号，升级前验证全链路 |
| 26 | 档位后端校验 | 金额仅允许固定档位，禁止自定义传入 |

---

## 九、不纳入项

- 微信支付退款 API（后续迭代）
- H5 支付 / JSAPI 支付（仅 Native 扫码）
- 支付宝支付
- 日终对账脚本
- 回调 IP 白名单（后续视需要添加）

---

## 十、成功标准

1. `/settings/credits` 仅展示预设档位按钮（无自定义金额输入），点击后弹出微信扫码支付二维码 + 倒计时
2. 后端拒绝非档位金额创建订单请求，防止前端篡改资损
3. 微信扫码支付成功后，Socket.io 推送 + 余额自动更新
4. 阶梯式轮询检测到 `CLOSED` / `FAILED` 时立即停止并提示
5. 二维码过期或取消后，余额不产生变动
6. Nonce 重放回调被 Redis 去重拦截，返回 SUCCESS 但不入账
7. Content-Type 非 `application/json` 的回调被直接拒绝
8. 重复/并发微信回调不产生重复入账（行锁 + 条件更新）
9. 伪造签名 / 时间戳过期 / 币种不符 / 金额不一致的回调全部拒绝
10. 微信关闭接口失败时不强制变更本地状态（一致性处理）
11. 关闭接口对已终态订单幂等返回成功
12. 主动查单兜底任务（5/15/30min）可正确恢复回调丢失的订单
13. 用户级频控：单用户每分钟 ≤ 3 次创建订单
14. 非订单所属用户无法通过 Socket 监听支付事件
15. 2 小时未支付订单自动标记 CLOSED（BullMQ + 兜底扫描）
16. 充值成功后写入 `UserBalanceTransaction` 余额变动流水
17. 验签通过的回调返回 HTTP 200 + 标准格式 body；验签不通过 / 请求格式非法返回非 200，触发微信重试
18. APISIX 回调路由不修改请求 Body，验签正常通过
19. API 在缺少或格式错误的微信配置时启动即报错（含 crypto 密钥验证）
20. `wechatpay-axios-plugin` SDK 全覆盖签名、下单、查单、关单、解密、验签
21. 现有测试全部通过，新增测试覆盖档位校验/Nonce去重/验签/行锁/幂等/越权/并发/过期/状态和解/流水写入/频控
