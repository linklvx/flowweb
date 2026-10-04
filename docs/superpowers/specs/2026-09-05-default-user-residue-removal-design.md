<!-- doc-status: historical | verified_at: n/a -->
# default-user 生产代码回退残留清除设计

- 日期：2026-09-05
- 来源：上线前必修项登记 #12（Plan A/B BetterAuth 改造漏网之鱼）
- 状态：待用户确认

## 1. 背景与问题

BetterAuth 改造后，3 处生产代码仍残留 `?? 'default-user'` 回退：未登录（乃至已登录）请求会以虚构用户 `default-user` 的名义写数据、扣积分、生成存储 key。

## 2. 调查事实（2026-09-05 实测）

### 2.1 ai-image-edit.service.ts（危害最重）

- `getUserId()` 硬编码返回 `'default-user'`（含 TODO 注释），三个 enqueue 方法把该值写入 BullMQ job。
- **即使登录用户，图编辑任务（outpaint/erase/redraw）也一律以 default-user 执行**：
  - `ai-image-edit.processor.ts:122` — MinIO 对象 key 用该 userId 构建
  - `ai-image-edit.processor.ts:152` — `teamCredit.consume(projectTeamId, userId, ...)` 以该 userId 扣费
- Controller（`api/image-edit/*`）不在 AuthGuard PUBLIC_PREFIXES 中，即 HTTP 入口已要求登录，**但 controller 未把 req.user 传给 service**，守卫拦了寂寞。
- 同模块 lighting 已是正确模式：controller 取 `req.user?.id` 显式传参，无回退。

### 2.2 storyboard.controller.ts（死分支，低危）

- 两个端点 `(req as any).user?.id ?? 'default-user'`。
- 路径 `api/projects/:projectId/storyboard/*` 非公开，AuthGuard 通过后 `req.user` 必然存在，`?? 'default-user'` 为不可达死分支。
- 危害仅在未来守卫语义变化时复活；类型上 `(req as any)` 绕过检查。

### 2.3 execution.gateway.ts（虚假安全感）

- afterInit 中间件尝试 `auth.api.getSession` 验签，但：
  - **前端 3 处连接全部不传 token**（useSocket.ts:8、AudioGenNode.tsx:54、ImageGenNode.tsx:337，均无 auth 字段）→ 真实流量恒走 default-user 分支
  - 验签成功/失败都 `next()` 放行，从不拒绝连接
  - `socket.data.userId` 赋值后**全代码库无任何消费者**（对照 payment.gateway：null 回退 + 有消费者）
- 即：这段"鉴权"代码零效果，仅制造已鉴权假象。

## 3. 修复方案

### 3.1 ai-image-edit：userId 显式传递（对齐 lighting 模式）

- `AiImageEditService.enqueueOutpaint/enqueueErase/enqueueRedraw` 首参增加 `userId: string`，删除 `getUserId()`。
- `AiImageEditController` 三个 handler 增加 `@Req() req`，取 `req.user.id` 传入（AuthGuard 已保证存在）。

### 3.2 storyboard：删除死回退

- `(req as any).user?.id ?? 'default-user'` → `req.user.id`（两处）。

### 3.3 execution.gateway：删除无效中间件（决策点，推荐 A）

- **方案 A（用户已确认 2026-09-05）**：删除 afterInit 中间件及 OnGatewayInit 实现。理由：userId 无消费者、从不拒连、前端不传 token——删除零行为变化；未来若需 WS 鉴权（如按用户隔离推送），届时连同前端一起走完整三阶段。删除后 Gateway 仅剩 room 广播职责，语义纯粹。
- **方案 B（否决）**：改为强鉴权（无 token/验签失败 → `next(new Error('Unauthorized'))`），需同步改前端 3 处连接传 token，并验证 token 与裸 cookie 签名问题（上线项 #10 关联）。范围扩大约 3 倍。
- **配套登记（不进本 spec 的技术债章节）**：WS 链路（execution namespace）删除中间件后完全匿名，且 `handleJoin` 无权限校验——匿名连接可 join 任意 projectId 房间监听执行推送（含 resultUrl/扣费数据）。开发阶段无用户数据可接受；作为上线前安全评估项登记到 project_launch_blockers。

## 4. 不做的事

- 不改 AuthGuard / 公开前缀表。
- 不清理历史 default-user 脏数据（无用户数据阶段，且 dev 库已于 2026-09-04 清理过一轮）。
- 不做 WS 鉴权体系（方案 B 内容）。
- 不动 payment.gateway（模式已正确）。

## 5. 验收标准

1. `grep -rn "default-user" apps/api/src` 仅剩测试文件引用（或零命中）。
2. TDD：ai-image-edit.controller.spec 断言三个 enqueue 收到的 userId 来自 req.user.id；storyboard.controller.spec 断言 userId 直取 req.user.id；execution.gateway.spec 删除/改写中间件相关断言。
3. 全量 `pnpm test` 通过。
4. 浏览器验收：登录态触发一次图编辑任务，DB/任务记录中 userId 为当前用户 id（替代 default-user）。
