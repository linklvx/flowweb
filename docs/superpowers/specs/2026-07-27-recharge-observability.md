# Spec: 微信支付充值模块可观测性 (Phase 9)

**日期**: 2026-07-27  
**状态**: 待确认  
**范围**: `apps/api/src/modules/recharge/`

## 背景

微信支付 Native 扫码支付已在生产环境验证通过。当前项目可观测性基础设施：
- `@sentry/node` 已安装但从未初始化（`Sentry.init()` 未调用，无 DSN 配置）
- 无 Prometheus 指标（无 `prom-client` 依赖，无 `/metrics` 端点）
- 日志仅使用 NestJS 内置 Logger

## 目标

为 recharge 模块的关键业务节点增加可观测性，同时建立项目级可观测性基础设施框架，后续模块可直接复用。

## 需求拆解

### 1. Sentry 错误告警

#### 1.1 SDK 选型与初始化

- [ ] **安装 `@sentry/nestjs`**：利用 NestJS 原生集成能力（`SentryGlobalFilter`、`nestIntegration()`），替代纯 `@sentry/node` 手动初始化
- [ ] **初始化位置**：`main.ts` 中 `NestFactory.create` 之前执行 `Sentry.init()`，确保捕获应用启动全生命周期异常
- [ ] **全局异常捕获**：注册 `SentryGlobalFilter` 为全局**第一个**异常过滤器。NestJS 过滤器按注册顺序执行，若前置有自定义过滤器捕获了异常，Sent 将无法收到事件，必须保证注册顺序最先
- [ ] **集成 `nestIntegration()`**：自动注入 NestJS 框架埋点（请求路径、IP、HTTP 状态码等上下文信息）
- [ ] **初始化容错**：`Sentry.init()` 包裹 `try/catch`，配置错误时仅 `console.warn` 打印警告，绝不阻断应用启动。可观测性是旁路能力，禁止因监控故障影响业务主流程
- [ ] **env schema**：`config/env.ts` 添加可选字段 `SENTRY_DSN`（不配置时 SDK 静默不工作）
- [ ] **环境标识**：初始化时配置 `environment`（`production`/`development`）和 `release`（git commit hash），便于按环境过滤告警、关联故障引入的代码版本

#### 1.2 关键节点手动打点

| 优先级 | severity | 位置 | 场景 |
|--------|----------|------|------|
| P0 | `fatal` | `handleCallback` 事务失败 | 用户已付款但入账失败，最严重 |
| P0 | `error` | `pay` 微信 API 调用失败 | 支付渠道不可用 |
| P1 | `error` | `parseNotify` 验签失败 | 可能是伪造回调或配置错误 |
| P1 | `warning` | `active-query` 主动轮询异常 | 异步兜底任务失败 |
| P1 | `warning` | `close-expired-order` 关单异常 | 异步关单任务失败 |

#### 1.3 事件标签规范（强制）

所有 `Sentry.captureException` 必须携带标准化标签：
- `module: 'recharge'` — 必填
- `orderNo` — 上下文存在时必填
- `userId` — 上下文存在时必填

确保告警可直接定位到具体订单与用户。

#### 1.4 异步上下文透传（BullMQ）

BullMQ 处理器运行在独立上下文，全局异常过滤器无法捕获。手动打点时必须用 `Sentry.withScope()` 或 `Sentry.getCurrentScope()` 将 `orderNo`、`userId` 写入 scope，避免异步上下文丢失导致标签缺失。

#### 1.5 告警噪音优化（可选）

初始化时配置 `ignoreErrors` 过滤预期内低价值异常（参数校验错误、频控拦截等），减少无效告警。过滤规则可根据线上 Sentry 数据后续动态调整。

#### 1.6 采样率（可选优化）

对 `warning` 级别的异步任务异常可配置 `sampleRate` 降采样，避免大量低优先级事件占用 Sentry 配额。`fatal`/`error` 级别始终全量上报。

### 2. Prometheus 指标

#### 2.1 基础设施

- [ ] **添加依赖**：安装 `prom-client`
- [ ] **Metrics 模块**：创建 `apps/api/src/metrics/` 共享模块，添加 `@Global()` 装饰器，封装 `prom-client` 的 Counter/Histogram 注册和获取。全局单例避免多模块重复导入导致 "duplicate metric" 报错
- [ ] **指标注册幂等**：prom-client 重复注册同名指标会抛错，模块设计为 provider 初始化时一次性注册所有指标，全局单例确保只加载一次
- [ ] **运行时指标**：调用 `collectDefaultMetrics()` 获取 Node.js 默认指标（内存、GC、事件循环、进程 CPU 等），零开发成本完善基础设施监控
- [ ] **`/metrics` 端点**：通过 `MetricsController` 暴露 Prometheus 文本格式（`GET /metrics`）

#### 2.2 端点安全约束

- [ ] **APISIX 层**：配置路由规则，禁止外网请求访问 `/metrics` 路径，仅允许内网 Prometheus 抓取节点访问
- [ ] **应用层（可选）**：支持 `PROMETHEUS_TOKEN` 环境变量，配置时通过 Guard 校验 `X-Prometheus-Token` 请求头，作为第二层纵深防御
- [ ] **鉴权豁免**：`/api/metrics` 加入全局 `AuthGuard` 的 `PUBLIC_PREFIXES` 白名单，避免 Prometheus 抓取被 401 拦截

#### 2.3 recharge 指标定义

| 指标名 | 类型 | 标签 | buckets | 说明 |
|--------|------|------|---------|------|
| `recharge_orders_created_total` | Counter | `amount_tier` | — | 各档位订单创建数 |
| `recharge_orders_completed_total` | Counter | `channel` | — | 支付成功数（`callback` / `active_query`） |
| `recharge_orders_closed_total` | Counter | `reason` | — | 订单关闭数（`expired` / `manual` / `api_fail`） |
| `recharge_callback_total` | Counter | `result` | — | 回调结果（`success` / `sig_fail` / `amount_mismatch` / `error`） |
| `recharge_wechat_api_duration_seconds` | Histogram | `api` | `[0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10]` | 微信支付 API 耗时（`create_payment` / `query_order` / `close_payment`） |
| `recharge_amount_fen_total` | Counter | — | — | 累计充值金额（分） |
| `recharge_callback_duration_seconds` | Histogram | `result` | 默认 | 回调全链路耗时 |

#### 2.4 Histogram 分桶说明

微信 API 调用耗时通常在 50ms-10s 范围，prom-client 默认分桶（毫秒级到 10s）颗粒度不足。自定义分桶 `[0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10]` 秒可提升 P50/P95/P99 统计精度。回调耗时使用默认分桶即可，因为回调全链路耗时分布较广。

## 非目标

- 不引入 OpenTelemetry（过度工程）
- 不替换 NestJS Logger 为 Winston/Pino（改动范围过大）
- 不处理其他模块的可观测性（仅建立框架 + recharge 模块示范）
- 不覆盖 BullMQ 通用队列指标（任务处理耗时、失败率、积压数），留给后续基础设施统一补充

## 成功标准

1. 无 `SENTRY_DSN` 时，应用正常启动，Sentry 静默不报错
2. Sentry 初始化异常不阻断应用启动（仅 `console.warn`）
3. `GET /metrics` 返回 Prometheus 格式指标数据，包含全部 recharge 业务指标 + Node.js 运行时指标
4. 所有 Sentry 事件携带 `module: 'recharge'` 标签
5. recharge 模块关键异常按 severity 分级上报
6. BullMQ 异步任务异常可被 Sentry 正常捕获，且携带标准化标签（`orderNo`、`userId`）
7. `/metrics` 端点公网不可直接访问，仅内网 Prometheus 抓取节点可正常获取指标
