# Plan: 微信支付 Native 扫码支付集成

## 概述

基于已确认的 spec，将 `/settings/credits` 页面的"立即充值"按钮从 Mock 支付切换到实际微信支付 Native 扫码支付。

## 实施策略

严格 TDD 模式：每个 Phase 先写测试 → 确认失败 → 写实现 → 测试通过。

---

## Phase 1: 数据库迁移 & Schema 更新

### 目标
更新 Prisma Schema 以支持微信支付所需的所有字段和新表。

### 文件变更

| 操作 | 文件 |
|------|------|
| 修改 | `apps/api/prisma/schema.prisma` |
| 新增 | `apps/api/prisma/migrations/` (Prisma 生成) |

### 具体变更

1. **`RechargeOrderStatus` 枚举** — 新增 `CLOSED`
2. **`BalanceTxType` 枚举（新增）** — `RECHARGE` / `CONSUME` / `REFUND` / `ADJUST`
3. **`RechargeOrder` 模型** — 新增字段：
   - `prepayId String?` — 微信预支付 ID
   - `transactionId String?` — 微信支付交易号
   - `payerOpenid String?` — 付款人 openid
   - `expiredAt DateTime?` — 订单过期时间
   - `closedAt DateTime?` — 订单关闭时间
   - `remark String?` — 异常备注
   - `notifyRaw` 重命名为 `notifySummary`（类型保持 Json?）
4. **`UserBalanceTransaction` 模型（新增）** — 余额变动流水表
   - `id`, `userId`, `amountFen`, `balanceBefore`, `balanceAfter`, `type`, `bizOrderNo`, `createdAt`
   - 索引：`[userId, createdAt]`, `[bizOrderNo]`

### 验证
```bash
pnpm prisma migrate dev --name add_wechat_pay_fields
pnpm prisma generate
```

---

## Phase 2: WeChat Pay SDK 与 Provider

### 目标
安装 SDK，创建 `WechatPaymentProvider`，更新 `IPaymentProvider` 接口，移除 `MockPaymentProvider`，Fail-Fast 启动校验。

### 文件变更

| 操作 | 文件 |
|------|------|
| 修改 | `apps/api/package.json` — 新增 `wechatpay-axios-plugin` 依赖 |
| 重写 | `apps/api/src/modules/recharge/providers/payment.provider.interface.ts` |
| 新增 | `apps/api/src/modules/recharge/providers/wechat-payment.provider.ts` |
| 新增 | `apps/api/src/modules/recharge/providers/wechat-payment.provider.spec.ts` |
| 删除 | `apps/api/src/modules/recharge/providers/mock-payment.provider.ts` |
| 修改 | `apps/api/src/modules/recharge/recharge.module.ts` — 注册 WechatPaymentProvider（替换 MockProvider） |
| 修改 | `apps/api/src/config/env.ts` — 新增微信配置 Zod schema（Fail-Fast 前置至此） |
| 修改 | `apps/api/src/modules/recharge/recharge.service.spec.ts` — 适配新接口 |
| 修改 | `apps/api/src/auth/auth.guard.ts` — 新增 `/api/recharge/notify` 为公开路径 |

### 具体变更

1. **IPaymentProvider 接口更新**：按 spec 1.3 节定义 `createPayment` / `queryOrder` / `parseNotify` / `closePayment`
2. **WechatPaymentProvider**：使用 `wechatpay-axios-plugin` 实现 Native 下单、查单、关单、验签解密
   - `normalizePem()` 兼容 `\n` 转义和 Base64 编码
   - `createPayment` 网络波动重试 2 次（指数退避）
   - **time_expire 格式**：禁止 `toISOString()`（含毫秒 `.000Z`），统一使用 RFC 3339 秒级精度东八区格式 `YYYY-MM-DDTHH:mm:ss+08:00`，与订单 `expiredAt` 严格对齐
3. **Fail-Fast 前置到 env.ts**：
   - **env.ts Zod 层**：所有 `WECHAT_PAY_*` 变量 `z.string().min(1)` 非空校验，启动时最先执行
   - **RechargeModule 层**（补充）：PEM 头尾标记检查 + `crypto.createPrivateKey/createPublicKey/X509Certificate` 密钥有效性校验
   - 两层校验确保配置缺失时尽早 Fail-Fast
4. **移除 MockPaymentProvider**：模块仅注册 `WechatPaymentProvider`
5. **全局鉴权豁免**：AuthGuard 的 `PUBLIC_PREFIXES` 数组新增 `/api/recharge/notify`，使回调端点跳过用户鉴权（安全保障完全由微信签名校验链路承担）

### 验证
```bash
# 启动时微信配置缺失应报错
WECHAT_PAY_APP_ID="" pnpm --filter api test
# 单元测试：createPayment / queryOrder / parseNotify / closePayment
pnpm --filter api test -- --reporter=verbose
```

---

## Phase 3: 后端 API — 订单创建 & 支付

### 目标
改造 `POST /api/recharge/orders`（档位校验 + IP采集）和 `POST /api/recharge/orders/:orderNo/pay`（微信 Native 下单）。

### 文件变更

| 操作 | 文件 |
|------|------|
| 修改 | `apps/api/src/modules/recharge/recharge.controller.ts` |
| 修改 | `apps/api/src/modules/recharge/recharge.service.ts` — 大幅重写 |
| 新增 | `apps/api/src/modules/recharge/recharge.controller.spec.ts` |
| 新增 | `apps/api/src/modules/recharge/recharge.service.spec.ts` (更新) |
| 修改 | `packages/shared/src/types/subscription.types.ts` |

### 具体变更

1. **档位校验**：`RECHARGE_TIERS_FEN = [1000, 3000, 5000, 10000, 20000, 50000]`
   - `createOrder` 校验 `amountFen` 是否在档位范围内
2. **客户端 IP**：`createOrder` 从 `X-Forwarded-For` / `X-Real-IP` 提取并存入 `clientIp` + `expiredAt` 写入
3. **`pay` 方法重写**：
   - 归属校验 → 幂等检查（已有 prepayId 直接返回）
   - 调用 `wechatProvider.createPayment()` 获取 `codeUrl`
   - **不修改余额**（余额仅通过回调入账）
   - 返回 `{ orderNo, amount, status: 'PENDING', codeUrl }`
4. **BullMQ 任务投递入口预留**：订单创建事务提交后投递过期关闭任务和主动查单任务。**投递方法签名和调用位置在 Phase 3 定义，处理器实现延后至 Phase 5 补全**（通过 mock processor 占位，避免功能断点）

### TDD 测试用例

| # | 测试 | 类型 |
|---|------|------|
| 1 | 档位金额（10/30/50/100/200/500元）创建订单成功 | 正常 |
| 2 | 非档位金额（15元）创建订单返回参数错误 | 异常 |
| 3 | 客户端 IP 正确从 X-Forwarded-For 提取 | 正常 |
| 4 | 内网 IP 跳过，取第一个外网 IP | 边界 |
| 5 | 幂等：重复调用 pay 不重复创建微信订单 | 正常 |
| 6 | pay 返回 codeUrl，不修改余额 | 核心 |
| 7 | pay 对非 PENDING 状态订单返回错误 | 异常 |
| 8 | pay 对非归属订单返回权限错误 | 安全 |

### 验证
```bash
pnpm --filter api test -- --reporter=verbose
```

---

## Phase 4: 后端 API — 回调 & 查单 & 关闭

### 目标
实现 `POST /api/recharge/notify/wechat`（回调）、`GET /api/recharge/orders/:orderNo`（查单）、`POST /api/recharge/orders/:orderNo/close`（关闭）。

### 文件变更

| 操作 | 文件 |
|------|------|
| 修改 | `apps/api/src/modules/recharge/recharge.controller.ts` — 新增 3 个端点 |
| 修改 | `apps/api/src/modules/recharge/recharge.service.ts` — 新增回调处理/查单/关闭逻辑 |
| 新增 | `apps/api/src/common/decorators/no-transform.decorator.ts` |
| 修改 | `apps/api/src/common/interceptors/transform.interceptor.ts` — 支持 @NoTransform() 跳过包装 |
| 修改 | `apps/api/src/main.ts` — `NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })` |
| 修改 | `apps/api/src/auth/auth.guard.ts` — `PUBLIC_PREFIXES` 新增 `/api/recharge/notify` |

### 具体变更

1. **rawBody 配置**：在 `apps/api/src/main.ts` 中修改：
   ```typescript
   const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
   ```
   这是 NestJS 应用级 HTTP 配置（非 REPL），使 `POST /api/recharge/notify/wechat` 能通过 `req.rawBody` 获取原始 Buffer 用于微信签名验证。

2. **回调端点全局鉴权豁免**：`POST /api/recharge/notify/wechat` 是微信第三方回调，无用户态。在 `auth.guard.ts` 的 `PUBLIC_PREFIXES` 数组中新增 `/api/recharge/notify`。安全保障完全由微信签名校验链路（Nonce 去重、时间戳防重放、公钥匹配、签名验证）承担，符合微信官方安全规范。

3. **回调端点** `POST /api/recharge/notify/wechat`（`@NoTransform()` + 全局异常过滤器豁免）：
   - 安全校验链（按顺序）：
     - Content-Type 校验（仅 `application/json`）
     - Nonce 去重：Redis `SET NX EX 300` key: `wechat:pay:notify:nonce:{nonce}`
     - 时间戳防重放：`|Timestamp - now| ≤ 300s`
     - 公钥 ID 匹配 + 签名验证（SDK 自动处理）
     - AEAD 解密 → 跨商户校验 → 币种 `CNY` → 金额相等
   - 入账事务：`FOR UPDATE` 行锁 → 余额递增 → `UserBalanceTransaction` 写入 → 订单 SUCCESS
   - HTTP 状态码分场景：验签失败→400/500，验签通过→200（body `code` 区分）
   - 幂等：终态订单直接返回 SUCCESS
4. **查单端点** `GET /api/recharge/orders/:orderNo`：返回单笔订单状态，不含 codeUrl/openid 等敏感字段
5. **关闭端点** `POST /api/recharge/orders/:orderNo/close`：
   - 归属校验 → 幂等处理（终态直接返回）
   - 调用微信关单 → 状态一致性处理（区分微信已支付/已关闭/不存在）
6. **回调全链路异常兜底**：`@NoTransform()` 排除 TransformInterceptor 后，控制器方法最外层必须 `try/catch` 全量兜底：
   - catch 到任何未预期异常 → 手动构建 `{ code: "FAIL", message: "..." }` 响应 + HTTP 200
   - Sentry.captureException 上报异常详情
   - 彻底规避全局异常过滤器漏网导致微信收到非标准格式 500 响应，引发无限重试

> **未来优化**：官方推荐「先应答、后处理业务」模式 — 验签通过后立即返回 HTTP 204，入账逻辑投递 BullMQ 异步执行。当前同步方案功能正确，若后续出现回调超时 5s 的告警，可切换至此模式（订单状态幂等控制天然兼容）。

### TDD 测试用例

| # | 测试 | 类型 |
|---|------|------|
| 1 | 回调验签通过 + 金额一致 → 入账成功，HTTP 200 | 核心 |
| 2 | 回调验签失败 → HTTP 400 | 安全 |
| 3 | 回调 Nonce 去重（重复 Nonce 不重复入账） | 安全 |
| 4 | 回调时间戳过期 → 拒绝 | 安全 |
| 5 | 回调金额与订单不一致 → HTTP 200 + FAIL | 安全 |
| 6 | 回调币种非 CNY → 拒绝 | 安全 |
| 7 | 回调 appid/mchid 不匹配 → 拒绝 | 安全 |
| 8 | 并发回调不重复入账（FOR UPDATE 行锁） | 并发 |
| 9 | 入账成功写入 UserBalanceTransaction 流水 | 数据 |
| 10 | 查询订单返回正确状态 | 正常 |
| 11 | 关闭 PENDING 订单成功 | 正常 |
| 12 | 关闭已 SUCCESS 订单幂等返回 | 边界 |
| 13 | 非归属用户无法关闭订单 | 安全 |
| 14 | Content-Type 非 application/json → HTTP 400 | 安全 |
| 15 | 入账事务抛异常 → try/catch 兜底返回 HTTP 200 + FAIL（非 500） | 防御 |

### 验证
```bash
pnpm --filter api test -- --reporter=verbose
```

---

## Phase 5: BullMQ 任务

### 目标
实现订单过期自动关闭 + 主动查单兜底（回调丢失补偿）。

### 文件变更

| 操作 | 文件 |
|------|------|
| 新增 | `apps/api/src/modules/recharge/task/close-expired-order.processor.ts` |
| 新增 | `apps/api/src/modules/recharge/task/active-query.processor.ts` |
| 新增 | `apps/api/src/modules/recharge/task/daily-scan.processor.ts` |
| 修改 | `apps/api/src/modules/recharge/recharge.module.ts` — 注册 BullMQ |
| 新增 | `apps/api/src/modules/recharge/task/*.spec.ts` |

### 具体变更

1. **过期订单关闭**（BullMQ 延迟任务，delay: 2h）：
   - 订单创建成功后投递 `close-expired-order` 任务
   - 检查 status === PENDING → 调用微信关单 → 标记 CLOSED
   - 投递失败重试 3 次（指数退避）
2. **主动查单兜底**（3 个延迟任务：5min / 15min / 30min）：
   - 检查 status === PENDING → 调用微信查单
   - SUCCESS → 执行入账事务（复用 `completeOrderInTransaction`）
   - CLOSED → 标记 CLOSED
   - 其他 → Sentry 低优告警
3. **每日兜底扫描**（BullMQ repeatable job，cron: `0 0 * * *` 每日凌晨触发）：
   - 分页扫描 `status='PENDING' AND expiredAt < now()` 的订单（每批 100 条），避免单次全量查询造成数据库瞬时压力
   - 批量调用微信关单 → 标记 CLOSED
   - 使用 `@nestjs/bullmq` 的 `@Repeatable()` 装饰器注册，避免遗漏调度配置

### TDD 测试用例

| # | 测试 | 类型 |
|---|------|------|
| 1 | 过期订单被自动标记 CLOSED | 正常 |
| 2 | 主动查单发现已支付 → 执行入账 | 核心 |
| 3 | 主动查单发现已关闭 → 同步 CLOSED | 正常 |
| 4 | 已终态订单任务不重复处理 | 边界 |
| 5 | closeExpiredOrder 投递失败自动重试 | 可靠性 |
| 6 | 入账逻辑统一复用 completeOrderInTransaction | 架构 |

### 验证
```bash
pnpm --filter api test -- --reporter=verbose
```

---

## Phase 6: Socket.io 支付网关 & 频控

### 目标
实现支付状态实时推送 + 用户级频控。

### 文件变更

| 操作 | 文件 |
|------|------|
| 新增 | `apps/api/src/modules/recharge/payment.gateway.ts` |
| 新增 | `apps/api/src/modules/recharge/payment.gateway.spec.ts` |
| 修改 | `apps/api/src/modules/recharge/recharge.service.ts` — 回调入账后推送 |
| 新增 | `apps/api/src/modules/recharge/guards/throttle-user.guard.ts` |
| 修改 | `apps/api/src/modules/recharge/recharge.controller.ts` — 添加频控装饰器 |

### 具体变更

1. **PaymentGateway**：
   - 认证：复用现有 token 认证模式
   - `join:order` 事件：校验 `order.userId === socket.data.userId`（越权防护）
   - `payment:success` 推送
   - `payment:failed` 推送
2. **频控**：`POST /api/recharge/orders` 单用户每分钟 ≤ 3 次

### TDD 测试用例

| # | 测试 | 类型 |
|---|------|------|
| 1 | Socket join:order 归属校验（非本人拒绝加入） | 安全 |
| 2 | Socket payment:success 仅推送给正确 room | 正常 |
| 3 | 频控：单用户创建订单超过 3 次/分钟被拒绝 | 安全 |
| 4 | 不同用户频控独立 | 边界 |

### 验证
```bash
pnpm --filter api test -- --reporter=verbose
```

---

## Phase 7: 前端 — WeChatQRModal 组件

### 目标
创建微信支付二维码弹窗组件。

### 文件变更

| 操作 | 文件 |
|------|------|
| 新增 | `apps/web/src/components/WeChatQRModal.tsx` |
| 新增 | `apps/web/src/components/WeChatQRModal.test.tsx` |
| 新增 | `apps/web/src/components/WeChatQRModal.css` （或 Tailwind class） |
| 修改 | `apps/web/package.json` — 新增 `qrcode.react` 依赖（React 声明式二维码组件，代替原生 qrcode Canvas 操作） |

### 具体变更

1. **Props**：`visible`, `codeUrl`, `orderNo`, `amount`, `expiredAt`, `onSuccess`, `onCancel`
2. **核心能力**：
   - 用 `qrcode.react` 组件渲染二维码（React 声明式，自动处理 Canvas 绘制，支持 SSR）
   - 倒计时显示（基于 `expiredAt`）
   - 主通道：Socket.io 监听 `payment:success`
   - 降级通道：阶梯式轮询 `GET /api/recharge/orders/:orderNo`
     - 0~30s: 2s 间隔 / 30s~2min: 5s 间隔 / 2min+: 10s 间隔
   - 任一通道 SUCCESS → 停止全部 → `onSuccess`
   - 检测到 CLOSED/FAILED → 停止轮询 → 提示
   - 倒计时归零 → 提示过期 → 自动 close
   - "取消支付"按钮 → `POST close` → `onCancel`

### TDD 测试用例

| # | 测试 | 类型 |
|---|------|------|
| 1 | 渲染二维码 canvas | 正常 |
| 2 | 倒计时正确显示（基于 expiredAt） | 正常 |
| 3 | 轮询检测到 SUCCESS → 调用 onSuccess | 核心 |
| 4 | 轮询检测到 CLOSED → 显示"已关闭" | 正常 |
| 5 | 倒计时归零 → 自动关闭 | 边界 |
| 6 | 点击取消 → POST close + onCancel | 正常 |
| 7 | 阶梯式轮询间隔切换 | 逻辑 |

### 验证
```bash
pnpm --filter web test -- --reporter=verbose
```

---

## Phase 8: 前端 — CreditsPage 充值流程更新

### 目标
移除自定义金额输入，接入 WeChatQRModal，展示订单状态。

### 文件变更

| 操作 | 文件 |
|------|------|
| 修改 | `apps/web/src/pages/settings/CreditsPage.tsx` |
| 修改 | `apps/web/src/pages/settings/CreditsPage.test.tsx` |
| 修改 | `apps/web/src/api/subscriptionApi.ts` — 新增 API 方法 |
| 修改 | `packages/shared/src/types/subscription.types.ts` — 新增类型 |

### 具体变更

1. **移除自定义金额输入框** — 仅保留预设档位按钮
2. **充值流程**：选中金额 → 点击"立即充值" → `POST /orders` → `POST /orders/:orderNo/pay` → 打开 WeChatQRModal
3. **支付成功**：关闭弹窗 → 刷新余额 + 订单记录
4. **支付取消/过期**：关闭弹窗 → 提示
5. **订单历史**：状态列显示彩色标签（PENDING 橙色 / SUCCESS 绿色 / CLOSED 灰色 / FAILED 红色）
6. **新增 API 方法**：
   - `queryRechargeOrder(orderNo)` → `GET /api/recharge/orders/:orderNo`
   - `closeRechargeOrder(orderNo)` → `POST /api/recharge/orders/:orderNo/close`
   - Socket.io 连接逻辑

### TDD 测试用例

| # | 测试 | 类型 |
|---|------|------|
| 1 | 仅展示预设档位按钮，无自定义输入 | 正常 |
| 2 | 点击"立即充值"→ 创建订单 → 打开二维码弹窗 | 核心 |
| 3 | 支付成功后余额刷新 | 核心 |
| 4 | 订单历史正确显示各状态标签色 | 正常 |
| 5 | 档位按钮选中态切换 | 交互 |

### 验证
```bash
pnpm --filter web test -- --reporter=verbose
pnpm --filter web dev  # 浏览器访问 /settings/credits 验证完整流程
```

---

## Phase 9: 可观测性

### 目标
添加 Sentry 告警、Prometheus 指标、日志脱敏。

### 文件变更

| 操作 | 文件 |
|------|------|
| 修改 | `apps/api/src/modules/recharge/recharge.service.ts` — 关键节点 Sentry + 日志 |
| 新增 | `apps/api/src/modules/recharge/metrics.ts` — Prometheus 指标 |
| 修改 | `apps/api/src/modules/recharge/providers/wechat-payment.provider.ts` — 异常 Sentry 上报 |

### 具体变更

1. **Sentry**：验签失败（高优）、金额不一致（高优）、入账事务异常（高优）、终态重复回调（低优）、Nonce 重放（低优）
2. **Prometheus**：
   - `recharge_order_create_total` Counter `{channel: "wechat"}`
   - `recharge_callback_total` Counter `{result: "success"|"fail"}`
   - `recharge_callback_fail_total` Counter `{stage: "content_type"|"nonce"|"timestamp"|"sign"|"decrypt"|"appid"|"currency"|"amount"}` — 按校验阶段细分失败计数，便于快速定位回调异常根因
   - `recharge_balance_incr_total` Counter `{type: "callback"|"query"}` — 区分回调入账和查单入账
   - `recharge_callback_duration_seconds` Histogram `{result: "success"|"fail"}`
   - `recharge_daily_amount_total` Counter — 每日充值成功总金额（分），日终对账用
   - `recharge_daily_count_total` Counter — 每日充值成功总笔数
3. **日志脱敏**：禁止打印 openid、加密报文完整内容

### 验证
```bash
pnpm --filter api test -- --reporter=verbose
# 确认 Sentry 告警携带 orderNo 标签
# 确认 Prometheus metrics 端点可访问
```

---

## 文件总览

```
新增:
  apps/api/src/modules/recharge/providers/wechat-payment.provider.ts
  apps/api/src/modules/recharge/providers/wechat-payment.provider.spec.ts
  apps/api/src/modules/recharge/recharge.controller.spec.ts
  apps/api/src/modules/recharge/task/close-expired-order.processor.ts
  apps/api/src/modules/recharge/task/active-query.processor.ts
  apps/api/src/modules/recharge/task/daily-scan.processor.ts
  apps/api/src/modules/recharge/task/*.spec.ts
  apps/api/src/modules/recharge/payment.gateway.ts
  apps/api/src/modules/recharge/payment.gateway.spec.ts
  apps/api/src/modules/recharge/guards/throttle-user.guard.ts
  apps/api/src/modules/recharge/metrics.ts
  apps/api/src/common/decorators/no-transform.decorator.ts
  apps/web/src/components/WeChatQRModal.tsx
  apps/web/src/components/WeChatQRModal.test.tsx

删除:
  apps/api/src/modules/recharge/providers/mock-payment.provider.ts

重写:
  apps/api/src/modules/recharge/providers/payment.provider.interface.ts
  apps/api/src/modules/recharge/recharge.service.ts
  apps/api/src/modules/recharge/recharge.service.spec.ts

修改:
  apps/api/prisma/schema.prisma
  apps/api/package.json
  apps/api/src/config/env.ts
  apps/api/src/modules/recharge/recharge.module.ts
  apps/api/src/modules/recharge/recharge.controller.ts
  apps/api/src/auth/auth.guard.ts
  apps/api/src/main.ts
  apps/api/src/common/interceptors/transform.interceptor.ts
  apps/web/package.json
  apps/web/src/pages/settings/CreditsPage.tsx
  apps/web/src/pages/settings/CreditsPage.test.tsx
  apps/web/src/api/subscriptionApi.ts
  apps/web/src/api/client.ts
  packages/shared/src/types/subscription.types.ts
```

---

## 依赖与风险

| 风险 | 缓解措施 |
|------|---------|
| 全局 AuthGuard 拦截微信回调 | `PUBLIC_PREFIXES` 新增 `/api/recharge/notify`（Phase 2 代码层）+ APISIX 网关层回调路由禁用全局鉴权插件（部署侧双重保障） |
| APISIX 网关鉴权插件拦截回调 | APISIX 层对 `/api/recharge/notify/wechat` 路由显式禁用 `forward-auth`/`key-auth` 等全局鉴权插件，与代码层 `PUBLIC_PREFIXES` 形成双重保障 |
| APISIX 改写回调 Body 导致验签失败 | 回调路由关闭所有 Body 改写插件（`body-transformer`、`response-rewrite`、`file-logger` 等），仅允许 POST 方法 |
| rawBody 配置在错误位置 | 明确在 `main.ts` 的 `NestFactory.create` 中启用（非 REPL），Phase 4 验证 |
| time_expire 格式不兼容微信 | 禁止 `toISOString()`，统一使用 `YYYY-MM-DDTHH:mm:ss+08:00` 东八区秒级精度格式 |
| wechatpay-axios-plugin 与 Node.js 版本兼容 | SDK 锁定大版本号，启动时 crypto 校验密钥 |
| 微信公钥文件换行符在不同部署环境差异 | `normalizePem()` 统一处理 `\n` 转义 + Base64 解码 |
| BullMQ 任务投递失败 | 3 次重试（指数退避） + 每日兜底扫描 |
| 回调通知网络丢失 | 主动查单（5/15/30min）+ 前端轮询降级 |
| 并发回调重复入账 | FOR UPDATE 悲观行锁 + `WHERE status='PENDING'` 条件更新 |
| 前端篡改金额 | 后端固定档位配置，拒绝非档位金额 |
