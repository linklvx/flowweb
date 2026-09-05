# default-user 残留清除实施计划

- 日期：2026-09-05
- Spec：docs/superpowers/specs/2026-09-05-default-user-residue-removal-design.md（方案 A 已确认）
- 状态：待用户确认

## 概览

3 个任务 + 1 个收尾，均 TDD（Task 3 为纯删除重构，安全网 = 现有全量测试）。

```
Task 1  ai-image-edit userId 透传（高优先，真实扣费 bug）
Task 2  storyboard 死回退删除
Task 3  execution.gateway 无效中间件删除（REFACTOR）
Task 4  验证收尾（grep + 全量测试 + 浏览器验收 + 记忆更新）
```

## Task 1：ai-image-edit userId 透传

**改动文件**
- `apps/api/src/modules/ai-image-edit/ai-image-edit.controller.spec.ts`
- `apps/api/src/modules/ai-image-edit/ai-image-edit.controller.ts`
- `apps/api/src/modules/ai-image-edit/ai-image-edit.service.ts`
- `apps/api/src/modules/ai-image-edit/ai-image-edit.service.spec.ts`（新增）

**RED-1**（改 controller.spec）
- 三个用例调用处增加第二个参数 `req = { user: { id: 'u1' } } as any`
- 断言变更为首参 `'u1'`：
  - `toHaveBeenCalledWith('u1', 'proj1', 'node1', 'file-1', rect, 512, 512)`
  - `toHaveBeenCalledWith('u1', 'proj1', 'node1', 'file-1', 'mask-1')`
  - `toHaveBeenCalledWith('u1', 'proj1', 'node1', 'file-1', 'mask-1', 'a beautiful sunset', 70)`
- 运行：`pnpm --filter @flowweb/api test -- ai-image-edit.controller` → 失败（当前不接收 req / 传的是 default-user）

**RED-2**（新增 service.spec，审核 P0-1）
- mock 方式对齐项目先例（video-separate.service.spec.ts:52）：`{ provide: getQueueToken(AI_IMAGE_EDIT_QUEUE_NAME), useValue: { add: vi.fn().mockResolvedValue({ id: 'job-1' }) } }`——mock 必须挂在真实注入 token 上，避免 mock 对象错位假阳性
- 断言 `enqueueOutpaint('u1', ...)` 后 `queue.add` 收到的 job `data.userId === 'u1'`（三个 enqueue 各一条）
- 运行 → 失败（当前 service 无 userId 参数，job data.userId 恒为 'default-user'）
- 与 processor.spec:112/147 既有断言（`teamCredit.consume('team1','user1',...)`）拼合，controller→service→processor 单元级全链闭环

**GREEN**
- service：`enqueueOutpaint/enqueueErase/enqueueRedraw` 首参加 `userId: string`，job data 用该参数；删除 `getUserId()` 及 TODO 注释
- controller：三个 handler 加 `@Req() req: any`，调用处传 `req.user.id`
- processor 零改动（job.data.userId 字段名不变）

**verify**
- 目标 spec 通过 + `pnpm --filter @flowweb/api test -- ai-image-edit` 全绿
- **浏览器验证（前移，执行审核建议 4；消耗一次 dev 积分）**：登录态触发一次图编辑，查 `TeamCreditTransaction` 最新流水 **`userId` 字段**（注意不是 `teamId` 字段，consume 签名为 `(teamId, userId, amount, key)` 两字段同表易混）= 当前登录用户 id；`Media` 新记录归属当前用户

## Task 2：storyboard 死回退删除

**改动文件**
- `apps/api/src/modules/storyboard/storyboard.controller.spec.ts`
- `apps/api/src/modules/storyboard/storyboard.controller.ts`

**RED**（改 controller.spec:49-54）
- 用例「无 user → 用 default-user」改写为「无 user → 不再回退 default-user」：
  ```ts
  const req = {} as any;
  await controller.stitch('p1', body, req);
  expect(service.createStitchTask).toHaveBeenCalledWith('p1', body, undefined);
  ```
- 运行 → 失败（当前实现返回 `'default-user'`）

**GREEN**
- controller 两处 `(req as any).user?.id ?? 'default-user'` → `(req as any).user?.id`（对齐 lighting.controller.ts:15 既有正确模式；AuthGuard 保证非公开路径 req.user 存在，运行时 undefined 会进 resolve 返回 null → 403，无越权窗口）

**verify**：`pnpm --filter @flowweb/api test -- storyboard.controller` 全绿

## Task 3：execution.gateway 无效中间件删除（REFACTOR）

**改动文件**
- `apps/api/src/modules/gateway/execution.gateway.ts`

**步骤**（纯删除，无新行为，不新增测试；现有 `should be defined` 作安全网）
- 删除 `afterInit` 方法整体（execution.gateway.ts:13-32）
- 删除 `OnGatewayInit` 接口实现与 import、`auth` import
- 保留：`OnGatewayConnection/OnGatewayDisconnect` 空实现、`handleJoin`、全部 `emitXxx`

**verify**
- `pnpm --filter @flowweb/api test -- execution.gateway` 绿 + 全量测试绿
- **集成兜底（执行审核建议 2，轻量）**：dev server 热重载后 `preview_logs` 无初始化异常；浏览器打开画布页 console 无 /execution WS 连接错误（完整收发验证由浏览器验收的图编辑推送天然覆盖，不另建流程）

## Task 4：验证收尾（回归）

1. `grep -rn "default-user" apps/api/src --include="*.ts" | grep -v spec` → 零命中
2. 全量 `pnpm test`（turbo 全 workspace）
3. 浏览器验收已前移至 Task 1 verify（核心 bug 早反馈，积分只消耗一次）；此处仅回归确认图编辑链路可用
4. 记忆更新：project_launch_blockers.md 勾销 #12；新增动作式登记「上线前完成 execution WS 房间越权监听风险评估（完全匿名 + handleJoin 无 PROJECT 权限校验，知道 projectId 即可监听执行推送）；上线后核对 DB 无新 default-user 记录」
5. git 提交（feat → test → implementation → pass → commit 顺序已满足，单 commit 收尾）

## 审核意见处置记录（2026-09-05）

- ✅ P0-1 service 层测试：采纳 → Task 1 RED-2
- ✅ P0-2 扣费流水验收：采纳并修正 → Task 4.3（图编辑无 DB 任务表，验收对象为 TeamCreditTransaction + Media）
- ❌ P1 消除 any：前提错误——项目无 Request 类型扩展（grep 零命中），lighting.controller.ts:15 即 `req: any`，全项目 124 处同模式；引入局部接口违反精准修改原则
- ❌ P1 未登录 403 验证：事实混淆——未登录被 AuthGuard 拦截返回 401（到不了 controller）；"误 public 化"场景已由 Task 2 单元断言覆盖；测 AuthGuard 超本任务范围
- ✅ P2 删除前副作用确认：已核验（gateway 13-32 行无日志/metrics/初始化副作用；全库无 socket.data.userId 消费者），无新增动作
- ✅ 可选项：登记含"上线前必须评估 + join 越权风险 + 上线后 default-user 核对"；表名已明确

执行阶段审核（2026-09-05 第二轮，4 条全采纳）：

- ✅ mock 一致性：service.spec 用 `getQueueToken(AI_IMAGE_EDIT_QUEUE_NAME)` 注入（项目 5 处先例，如 video-separate.service.spec.ts:52）→ Task 1 RED-2
- ✅ Task 3 集成兜底：dev server 日志无初始化异常 + 画布页 WS 连接正常（轻量形式，完整收发由浏览器验收覆盖）→ Task 3 verify
- ✅ 验收字段精准：查 `TeamCreditTransaction.userId` 而非 `teamId`（consume 签名 `(teamId, userId, amount, key)` 同表易混）→ Task 1 verify
- ✅ Task 1 后提前浏览器验证：核心 bug 早反馈，Task 4 改为纯回归 → 任务结构调整

## 明确不做

- 不改 AuthGuard/公开前缀；不动 payment.gateway；不清理历史脏数据（dev 库 2026-09-04 已清）；不做 WS 鉴权（方案 B）
