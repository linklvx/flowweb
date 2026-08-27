# 团队功能 + 画布实时协作（Team + Yjs）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 注册即建默认团队；团队管理页四 tab（成员/积分/权限/申请）；团队双池积分 + 微信支付直充 + 月付团队订阅 + 月度额度 + 席位/存储配额；画布 Yjs CRDT 实时共编（Hocuspocus 嵌 NestJS，server doc 唯一权威）；autosave 链路整条退役；执行/AI 全链路实时读写 server doc 并扣团队池。

**Architecture:** Hocuspocus 手动挂载 NestJS lifecycle（独立 WS 端口 3001）；业务服务端写 doc 一律 `CollabDocumentService.withDoc`（openDirectConnection + try/finally disconnect）与 `readCanvas`（doc→plain nodes/edges），严禁自建 Y.Doc；前端 store 仍为 React Flow 状态源，`canvasCollabRuntime` 双向桥（origin 防回环）+ awareness presence。

**Tech Stack:** api：NestJS + Prisma + PG + BullMQ + @hocuspocus/server + yjs + wechatpay；web：React + antd 5 + @xyflow/react + zustand/zundo + @hocuspocus/client + y-protocols；两侧 vitest。

**Spec:** `docs/superpowers/specs/2026-08-27-team-collab-yjs-design.md`（六轮评审 36 项裁定，2026-08-27 冻结）

**关键既有事实（实现者必读）：**
- 测试命令：api `pnpm --filter @flowweb/api test`；web `pnpm --filter @flowweb/web test`（各含 tsc --noEmit）
- Prisma 规则（memory）：只用 `migrate dev --name`，禁 `db push`；CREATEDB 授权一次性先配
- 迁移采用 expand-contract 两步（开发库有数据且 Y.Doc 序列化无法在 SQL 内完成）：Task 1 expand → Task 2 数据回填脚本 → Task 3 contract
- 个人支付链路复用点：回调前缀路由（recharge.controller notify/wechat 按 outTradeNo 前缀分流，现有 SUB* / RC*）；订单幂等 = FOR UPDATE + updateMany(status:PENDING)；BullMQ 兜底三件套
- Hocuspocus 无独立 unload 钩子：最后连接（含直连）断开自动 onStoreDocument flush 后销毁文档——S7 finally disconnect 是直连不阻止 flush 的保证
- 扣费/预检点全集：扣费 execution.service:84/167 + ai-image-edit.processor:138 + lighting.consumer:151（视频 :119 补扣）；预检 execution.service:92/119/181 + lighting.service:90
- 后端读画布 3 处：execution.service:29、project.service:73、canvas.service:56；异步 emit 4 处需改服务端回写：ai-download.processor:84、ai-image-edit.processor:141、lighting.consumer:154、stitch.consumer:107
- 循环依赖裁定（web runtime 模块）：顶层只允许 import 声明/函数定义/纯常量（参照 canvasHistoryRuntime.ts 头注）
- 深色为全站硬编码 hex，无暗色切换机制；团队主强调色 #5DDCFF/#07B8DD

**依赖顺序：** Task 1→2→3（迁移）→ 4（默认团队）→ 5/6/7（团队 API，可并行）→ 8（积分服务）→ 9/10/11（支付/订阅/扣费）→ 12（Hocuspocus）→ 13（后端读写切换）→ 14（前端桥）→ 15（autosave 退役）→ 16（presence）→ 17（存储）→ 18（管理页）→ 19（部署+全链路）。**Task 3 内完成最小编译修复（B1 裁定：临时 CanvasDoc 反序列化，保证 Task 4-11 测试可跑）；Task 13 为正式切换 readCanvas/withDoc；Task 14/15 必须连续完成（中间态前端不可用）。**

**明确不在本 plan 范围（登记防遗忘）：** Redis 5.0.14→6.2+ 升级（spec 并行改进项，独立实施）；多团队工作空间级切换器（一期仅 Task 18 最简下拉，见 I2）；Hocuspocus 多实例/redis-adapter。

---

### Task 1: Prisma expand 迁移——新表全量 + 可空 teamId

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: schema 新增 9 个 model + 2 列**

按 spec 数据模型节逐一添加：Team（status + @@index([status])）、TeamMember（@@unique([teamId,userId])、monthlyQuota/monthlyPeriod/monthlyUsed）、TeamBalance（teamId @unique + 双池 + version + **onDelete: Cascade**）、TeamCreditTransaction（type 枚举 6 值含 register_grant/subscription_grant、creditType、**teamId String? + onDelete: SetNull**）、TeamPlan、TeamSubscription（teamId **String? 可空 + onDelete: SetNull**、无 nextGrantDate/grantCount）、TeamRechargeOrder（**teamId String? 可空 + onDelete: SetNull**（I1：三表可空，否则 Task 5 解散的 SetNull 被 NOT NULL 拒绝）、payerUserId、TEAM 前缀单号、status）、TeamJoinRequest（decidedBy String? + **onDelete: Cascade**）、CanvasDoc（projectId @unique + state Bytes + Cascade 关系）。CanvasProject 加 `teamId String?` + 关系；Media 加 `teamId String?`。User 加 `teamsOwned Team[]`、`teamMemberships TeamMember[]`；Team.ownerId → User onDelete Restrict。枚举：TeamRole(OWNER|ADMIN|MEMBER)、TeamStatus(ACTIVE|DISBANDED)、JoinRequestStatus(PENDING|APPROVED|REJECTED)。

- [ ] **Step 2: 迁移**

```bash
cd apps/api && npx prisma migrate dev --name team-expand-tables
```

Expected: 迁移应用、`migrate status` up to date、现有数据未动。

- [ ] **Step 3: Commit** `feat(api): 团队域 schema expand——9 新表+可空 teamId`

---

### Task 2: 数据回填脚本（默认团队/回填/CanvasDoc 序列化）

**Files:**
- Create: `apps/api/scripts/backfill-team.ts`（tsx 运行）
- Modify: `apps/api/package.json`（script 入口 `backfill:team`）

- [ ] **Step 1: 安装 yjs（api 侧，Task 12 前置依赖）**

```bash
pnpm --filter @flowweb/api add yjs
```

- [ ] **Step 2: 写脚本（幂等，可重复跑）**

逻辑三段，全程 upsert/skip-existing：① 每个有 CanvasProject/Media 的 userId → upsert Team("{用户名}的团队", ACTIVE) + TeamMember(OWNER) + TeamBalance(credits=100, version=0) + TeamCreditTransaction(register_grant, amount=100, balanceAfter=100)；② CanvasProject/Media 回填 teamId=该默认团队（where teamId: null）；③ 每个 project：读 CanvasNode/CanvasEdge → 按 spec Y.Doc 结构构造（nodes ymap：type/parentId/width/height + position 子 ymap + data 逐键；edges ymap；parentId 父先序无所谓——CRDT 无外键约束）→ `Y.encodeStateAsUpdate` → upsert CanvasDoc。

- [ ] **Step 3: 运行并验证**

```bash
cd apps/api && pnpm backfill:team && npx prisma studio
```

Expected: 抽查 1 个项目——Team/Member/Balance/流水存在；project.teamId 非空；CanvasDoc.state 非空字节。重复跑不产生重复行（幂等）。

- [ ] **Step 4: Commit** `feat(api): 团队数据回填脚本——默认团队/回填/画布 Y.Doc 序列化`

---

### Task 3: Prisma contract 迁移——必填化 + 删旧表旧列

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: schema 收缩**

CanvasProject.teamId 改必填 + 删 `version`、`viewport` 列 + 删 `nodes CanvasNode[]`/`edges CanvasEdge[]` 关系；Media.teamId 必填；**删除 CanvasNode、CanvasEdge 两个 model**；Template 的 templateData 里 viewport 来源已改前端提交（Task 13 落实）。

- [ ] **Step 2: 最小编译修复（B1 裁定：必须采用，非可选）**

删表后 project.service/canvas.service/execution.service 编译必红，而测试命令含 tsc --noEmit——不修复则 Task 4-11 共 8 个任务的 TDD 循环全部无法运行（原"诚实红"方案与此矛盾，废弃）。**本步骤做最小修复，读与写都要救（M1）**：

- **读**：新建 `apps/api/src/modules/canvas/canvas-legacy.reader.ts`——`readCanvasLegacy(projectId)`：读 CanvasDoc.state → `Y.applyUpdate(new Y.Doc(), state)` 临时只读 doc → 返回 plain {nodes, edges}（形状对齐原 include 结果）；project.service.findById / canvas.service.save / execution.service 读画布三处改调它。**临时 reader 只读不写不持久化，不违反 Q1 单 doc 实例铁律**；Task 13 正式切换后删除。
- **写**：execution.service:74/114/176 三处 `prisma.canvasNode.update` 同样编译红（client 类型已无 canvasNode）——临时改为 **no-op**（空函数体 + `// TODO(Task13): withDoc`，不注释掉整段以免下游调用方跟着红）；异步 job 仅有 emit 无表引用（已核实），若 grep 出残余引用同样清理。
- **autosave 端点**：PUT /projects/:id/canvas 改为 **no-op 200**（M3：收到 nodes/edges 直接丢弃——数据已进 CanvasDoc；不返回 501/不删端点，否则 Task 3-15 窗口期前端 canvasSyncRuntime 每次保存都弹 error toast）；syncCanvas/updateViewport 服务方法删除（无调用方后编译干净）。

- [ ] **Step 3: 迁移 + 验证**

```bash
cd apps/api && npx prisma migrate dev --name team-contract-drop-node-tables && npx prisma migrate status
```

- [ ] **Step 4: Commit** `feat(api): contract 迁移——teamId 必填、删表、临时 legacy reader 保编译`

---

### Task 4: 注册钩子建默认团队（TDD）

**Files:**
- Modify: `apps/api/src/auth/auth.ts`（BetterAuth databaseHooks）
- Create: `apps/api/src/modules/team/team.module.ts`、`team.service.ts`、`team.controller.ts`、`team.service.spec.ts`

- [ ] **Step 1: 失败测试**——`team.service.spec.ts`：`ensureDefaultTeam(userId, userName)`：① 建 Team(ACTIVE) + TeamMember(OWNER) + TeamBalance(credits:100) + register_grant 流水（amount=100, balanceAfter=100）；② 幂等（已存在时 no-op 不重复建）；③ **无团队用户任意时机调用可补建**（I4：注册钩子失败/历史用户的兜底——创建项目、访问 /team 前均先调）。
- [ ] **Step 2: 红 → 实现**——TeamService.ensureDefaultTeam（$transaction 四写，设计为任意时机可调的幂等入口）；auth.ts databaseHooks.user.create.after 调用（BetterAuth 钩子内拿 db 直写或引 service，防循环依赖用 prisma 直写同逻辑）。
- [ ] **Step 3: 绿 → 手工验证**——注册新账号（/register）→ prisma studio 查 Team 行存在。
- [ ] **Step 4: Commit** `feat(api): 注册即建默认团队——余额100+register_grant流水`

---

### Task 5: TeamGuard + 团队基础 API（TDD）

**Files:**
- Create: `apps/api/src/modules/team/team.guard.ts`、`dto/`、guard 单测
- Modify: `team.service.ts`、`team.controller.ts`、`team.module.ts`

- [ ] **Step 1: 失败测试**——① `getMyTeams(userId)`：返回所在团队（含 role、成员数、active 订阅摘要、TeamBalance）；② `renameTeam`：仅 OWNER/ADMIN，DISBANDED 拒绝；③ `disbandTeam` **时序（M2）**：事务内置 DISBANDED + **删前查出 projectIds** → 提交后 `emitAsync('team.disbanded', { teamId, projectIds })`（断言 payload 含 projectIds；用 emitAsync 而非 emit——EventEmitter2 默认 emit 不等待监听器）→ 监听器完成后再执行物理删除：TeamMember/TeamJoinRequest/TeamBalance 删、projects 删（断言级联 CanvasDoc）、Media 删（断言投递 MinIO 清理 job——mock BullMQ queue.add）、订单/流水/订阅 teamId 置空保留（断言 updateMany SetNull 调用）；④ 唯一团队禁令：用户仅 1 团队时 disband 抛 BadRequest「不能解散唯一团队」；⑤ TeamGuard：req.user → teamId → member 角色注入 req.teamRole，非成员 403，DISBANDED 403；⑥ **项目 CRUD 团队化（B2）**：create 项目前 ensureDefaultTeam 且写入 teamId（断言 create data 含 teamId）；list 按 teamId 过滤（断言 where）；findOne/update/delete 挂 TeamGuard——非成员访问 403。
- [ ] **Step 2: 红 → 实现** —— Controller：GET /api/team/mine、PATCH /api/team/:id、POST /api/team/:id/disband（Guard + OWNER 限定）。Media 物理删除的 MinIO 清理投递新队列 `team-media-cleanup`（processor 在 Task 17 实现，本任务只投递 + TODO 注释）。**项目端点改造（B2）**：project.controller 的 create/list/findOne/update/delete 接入（list 从 query 或 currentTeam 上下文取 teamId）。**@nestjs/event-emitter 接入 AppModule**（I3：team 模块 emit `team.disbanded`，collab 模块 Task 12 监听关闭该团队所有文档连接——事件解耦避免 team→collab 硬依赖）。
- [ ] **Step 3: 绿 → Commit** `feat(api): 团队基础 API+项目CRUD团队化——解散清理/disband事件/TeamGuard`

---

### Task 6: 成员管理 API（TDD）

**Files:**
- Modify: `team.service.ts`、`team.controller.ts`、spec 追加

- [ ] **Step 1: 失败测试**——① `listMembers(teamId, page, pageSize)`：{items,total} 形状（对齐 admin 分页先例），item 含 user 摘要/role/monthlyQuota/monthlyUsed；② `changeRole`：仅 OWNER 可改；不能改 OWNER；③ `removeMember`：OWNER/ADMIN；OWNER 不可被移；④ `setQuota`：OWNER/ADMIN，monthlyQuota≥0；⑤ `resolveInvite(teamId)`：团队存在且 ACTIVE 才可申请。席位上限校验（成员数<seatLimit）放 Task 7 批准时。
- [ ] **Step 2: 红 → 实现** —— GET /api/team/:id/members、PATCH .../members/:memberId/role、DELETE .../members/:memberId、PATCH .../members/:memberId/quota。
- [ ] **Step 3: 绿 → Commit** `feat(api): 成员管理——分页列表/角色/移除/额度配置`

---

### Task 7: 加入申请 API（TDD）

**Files:**
- Modify: `team.service.ts`、`team.controller.ts`、spec 追加

- [ ] **Step 1: 失败测试**——① `apply(teamId, userId, message?)`：目标团队 ACTIVE；已有 PENDING 重复申请拒绝；② `approve`：OWNER/ADMIN；**席位校验**（成员数≥seatLimit 抛「席位已满」，seatLimit 从 active 订阅 plan 或免费常量 20 现算）；事务内建 MEMBER + 置 APPROVED(decidedBy/decidedAt)；③ `reject`；④ `listRequests(teamId, status)`；⑤ 「需审批」关闭时 apply 直接入团（团队设置字段 `joinApproval Boolean @default(true)`——补进 Task 1 已建的 Team 表？不，Task 1 已冻结改用**本任务在 Team 加列**：expand 已过，直接 `migrate dev --name team-join-approval` 加 `joinApproval Boolean @default(true)`）。
- [ ] **Step 2: 红 → 实现** —— POST /api/team/:id/join-requests、GET .../join-requests?status=、POST .../join-requests/:id/approve|reject。
- [ ] **Step 3: 绿 → Commit** `feat(api): 加入申请——申请/审批含席位校验/免审批开关`

---

### Task 8: TeamCreditService 双池扣费（TDD）

**Files:**
- Create: `apps/api/src/modules/team/team-credit.service.ts` + spec
- Modify: `team.module.ts`

- [ ] **Step 1: 失败测试**——spec 裁定全覆盖：① `getBalanceView(teamId, userId)`：双池+总额+该成员 quota/used（惰性重置：monthlyPeriod 非当月先清零再返回）；② `consume(teamId, userId, cost, referenceId)` **校验顺序（D5）**：总额不足拒且**不动 monthlyUsed** → quota 超限拒（不动池）→ 扣减订阅优先（先 subscriptionCredits 后 credits）乐观锁 version retry×3 → **monthlyUsed 原子累加：`updateMany({ where: { memberId, [monthlyPeriod 为当月] }, data: { monthlyUsed: { increment: cost } } })`——禁止读-改-写，防同成员并发统计丢失；quota 原子校验并入 updateMany where 条件（monthlyUsed <= quota - cost）** → 流水（creditType 按实际扣减池，可能两条）；③ 并发版本冲突：updateMany count=0 重试，3 次后失败返回 {success:false}；④ 三种拒绝路径的流水均不写。
- [ ] **Step 2: 红 → 实现**（复用 credit.service.ts 的 retry 写法 + consume 的订阅优先拆分逻辑）。
- [ ] **Step 3: 绿 → Commit** `feat(api): TeamCreditService——双池/额度/惰性重置/校验顺序/乐观锁`

---

### Task 9: 团队充值微信支付（TDD）

**Files:**
- Create: `apps/api/src/modules/team/team-recharge.service.ts`、controller 段、spec；`task/team-close-expired.processor.ts`、`team-active-query.processor.ts`
- Modify: `recharge.controller.ts`（notify 回调前缀路由加 TEAM* 分支）、`payment.provider` 复用

- [ ] **Step 1: 失败测试**——① `createOrder`：档位 [10,30,50,100,200,500] 校验、1 元=10 积分换算、outTradeNo=`TEAM`+ts+random（复制 order-no.ts 模式新函数）、建 PENDING + expiresAt 2h、投递 close-expired 延迟 job；② `pay`：幂等（有 prepayId 直接返回）、走 wechat-payment.provider；③ 回调处理 `completeTeamOrder(order)`（**签名按 kind 预留分支结构**——Task 10 加 subscription kind 时不再重构）：nonce 去重 → 验签/appid/mchid/金额 → FOR UPDATE + updateMany(status:PENDING) 幂等 → kind=credits 时 `credits += order.credits`（写 recharge 流水 balanceAfter）→ PaymentGateway 推送；④ 过期关闭：置 CLOSED。
- [ ] **Step 2: 红 → 实现** —— 端点：POST /api/team/:id/recharge/orders、.../orders/:orderNo/pay；回调分支注入（在现有 notify/wechat 的 SUB 分支旁加 TEAM 分支调 completeTeamOrder）；BullMQ 两 processor 复制个人版参数。
- [ ] **Step 3: 绿 → Commit** `feat(api): 团队充值——TEAM 订单/回调前缀分支/幂等入账/兜底任务`

---

### Task 10: 团队订阅月付（TDD）

**Files:**
- Create: `apps/api/src/modules/team/team-subscription.service.ts`、spec；`task/team-expire.processor.ts`
- Modify: admin 模块（TeamPlan CRUD）、回调 TEAM 分支区分 recharge/subscription（订单表加 `kind` 字段或独立 TeamSubscriptionOrder——采用 TeamRechargeOrder 加 `kind RechargeKind @default("credits")` 枚举 credits|subscription，迁移 `team-order-kind`）

- [ ] **Step 1: 失败测试**——① 购买：存在 active 订阅（currentPeriodEnd>now）直接拒绝；无 active → 回调事务：剩余 subscriptionCredits>0 先清零（expire_clear 负值流水）→ 覆盖发放 plan.monthlyCredits（subscription_grant 流水）→ 建 TeamSubscription(currentPeriodEnd=+30d)；② `team-expire` processor：扫描 currentPeriodEnd≤now 且 active → 置 expired + 清零 subscriptionCredits + expire_clear 流水（credits 不动）；③ 限额现算：`getLimits(teamId)`——active 订阅取 plan(seatLimit/storageLimitBytes)，否则免费常量(20/6GiB)。
- [ ] **Step 2: 红 → 实现** —— 「立即开通」端点 POST /api/team/:id/subscription/orders（kind=subscription）；admin TeamPlan CRUD 复用现有 admin controller 模式。
- [ ] **Step 3: 种子数据**——`apps/api/prisma/seed.ts`（或既有 seed 追加）：2-3 个 TeamPlan 付费档位（如 基础版/专业版：monthlyCredits/storageLimitBytes/seatLimit/priceMonthly），无 seed 则测试与手工验收都要手动建档。
- [ ] **Step 4: 绿 → Commit** `feat(api): 团队订阅月付——购买即发/覆盖式/active期拒购/到期清零/档位seed`

---

### Task 11: 执行扣费切团队池（TDD）

**Files:**
- Modify: `execution.service.ts`（:84/:92/:119/:167/:181）、`ai-image-edit.processor.ts`（:138）、`lighting/lighting.consumer.ts`（:151）、`lighting.service.ts`（:90）+ 各自 spec

- [ ] **Step 1: 失败测试（逐点改）**——扣费 5 点：`consume(project.teamId, userId, cost, ref)`（project 加载点已有，断言不再调 credit.deduct）；预检 4 点：`getBalanceView(teamId, userId)` 替代 `credit.getBalance`（lighting:90、execution:92 提交前 + :119/:181 回读展示）；**视频 :119 补扣**：成功后 consume（对齐惯例，测试断言新调用）。
- [ ] **Step 2: 红 → 实现** —— 统一在各处先 `project.teamId`（Media 类 job 从 job data projectId 反查或入队时带 teamId）。
- [ ] **Step 3: 绿 → Commit** `refactor(api): 执行扣费/预检全量切团队池——视频补扣`

---

### Task 12: Hocuspocus 嵌入 + CollabDocumentService（TDD）

**Files:**
- Modify: `apps/api/package.json`（@hocuspocus/server）、`app.module.ts`
- Create: `apps/api/src/modules/collab/collab.module.ts`、`collab.gateway.ts`（Hocuspocus Server 配置）、`collab-document.service.ts` + specs

- [ ] **Step 1: 安装** `pnpm --filter @flowweb/api add @hocuspocus/server`
- [ ] **Step 2: 失败测试（integration，随机端口起真 server + @hocuspocus/client 连）**——api devDependencies 加 @hocuspocus/client y-protocols 测试用。① onAuthenticate：无 BetterAuth session 拒；有 session 但非团队成员拒；成员连接成功且 context 带 userId/name/role；② onLoadDocument：有 CanvasDoc 时还原（客户端连后能读到节点）；无记录时空 doc；③ onStoreDocument：写变更后 debounce 落库（测试用短 debounce 配置）；④ `withDoc`：直连写入后，另一个已连接客户端收到变更广播；**回调结束后 connection 已 disconnect**（mock 断言/后续 unload 可发生）；⑤ `readCanvas`：返回 plain {nodes, edges} 形状与原 include 结果对齐（id/type/position/data/parentId/width/height + sourceId/targetId）；⑥ **closeTeamDocuments（I3/M2）**：emit `team.disbanded` 事件（payload 含 projectIds）后，对应文档的活跃连接被关闭、不查库。
- [ ] **Step 3: 红 → 实现** —— Hocuspocus Server（port=env COLLAB_PORT 3001）：**documentName 约定 `project:${projectId}`**（onAuthenticate 解析后查 project.teamId 再查成员）；onAuthenticate 复用 BetterAuth auth.api.getSession（照抄 execution.gateway 握手）+ TeamMember 校验；onLoadDocument 读 CanvasDoc applyUpdate；**持久化 debounce 用 Server 构造选项内置 `debounce: 5000, maxDebounce: 10000`——不在钩子里自己 setTimeout**；CollabDocumentService.withDoc = openDirectConnection + try/finally disconnect + transact；readCanvas = withDoc 内遍历 ymap 构造 plain；**监听 `team.disbanded` 事件（I3/M2）→ closeTeamDocuments(payload.projectIds)：按事件携带的 projectIds 逐个关闭文档连接（不查库——事件到达时 projects 可能已删），防解散后 onStoreDocument 向已删 projectId upsert（FK 报错）及解散后仍可编辑**。Nest lifecycle：onModuleInit listen、onApplicationShutdown destroy。
- [ ] **Step 4: 绿 → Commit** `feat(api): Hocuspocus 嵌入——auth/load/store 钩子+withDoc/readCanvas 薄封装`

---

### Task 13: 后端画布读写切换（TDD）

**Files:**
- Modify: `execution.service.ts`（:29 读 + :74/114/176 同步回写）、`ai-download.processor.ts`、`ai-image-edit.processor.ts`、`lighting.consumer.ts`、`stitch.consumer.ts`、`canvas.service.ts`（:56 模板）、`project.service.ts`（findById 去掉 nodes/edges include）、相关 specs

- [ ] **Step 1: 失败测试**——① 执行读：`readCanvas` 返回喂给 execute（断言调用形状）；② 同步回写 3 处：withDoc 内写 data/status 字段（断言节点 data 变更）；③ 异步回写 4 处：processor 完成后 withDoc 写 fileId/resultUrl/尺寸——**socket emit 保留但仅进度**（断言 emit payload 不再承载持久化职责也可保留 fileId 字段，前端 Task 15 处理）；④ 模板保存：canvas.service 从 readCanvas 取 nodes/edges，viewport 改入参（SaveAsTemplateDto 加 viewport，Task 18 前端传）；⑤ stitch 写 storyboard 组节点 data（fileIds 数组/cellCount/failedCount 逐键写入）。
- [ ] **Step 2: 红 → 实现**——三处读画布与七处回写（**含 Task 3 遗留的三处 no-op 同步回写，替换为 withDoc——M1 对齐**）全部从 canvas-legacy.reader 切到 readCanvas/withDoc，**完成后删除 canvas-legacy.reader.ts 与 PUT canvas no-op 端点**（B1/M3 临时件退役）。
- [ ] **Step 3: 绿 → 手工验证**——起 api+web，生成一张图（旧 autosave 仍在但 PUT 已无表可写会报错——**先临时注释 canvasSyncRuntime 的 doSave 或直接跳 Task 14/15 连续执行**，验证顺序采用后者：本任务 commit 后立即 Task 14）。
- [ ] **Step 4: Commit** `feat(api): 画布读写切 server doc——执行读/同步3处/异步4处回写/模板`

---

### Task 14: 前端 collab 桥 canvasCollabRuntime（TDD）

**Files:**
- Modify: `apps/web/package.json`（yjs、y-protocols、@hocuspocus/client）
- Create: `apps/web/src/stores/canvasCollabRuntime.ts`、`collab/ydocBuilder.ts`（结构构造/反序列化纯函数）+ specs；Modify `pages/canvas/page.tsx`（初始化）、`canvasStore.ts`（connStatus 字段）

- [ ] **Step 1: 失败测试**——ydocBuilder 纯函数：① `buildDocFromSnapshot(nodes, edges)`（localStorage 恢复用）与 `readCanvasFromDoc(doc)` 往返一致；② 桥：本地 setNodes → ydoc 写入（origin='local'）→ store 不被自己的 observe 回调重复应用（防回环断言）；③ 远端：直接 applyUpdate 模拟远端变更 → observe 回调以 withHistoryPaused 写 store（undo 栈长度不变）；④ undo：zundo undo 产生的 store 反向变更 → ydoc 收到 local-undo origin 写入；⑤ data 字段级：改 nodeStore 单键只产生该键 ydoc 事务。
- [ ] **Step 2: 红 → 实现** —— 初始化链：localStorage 快照 apply 到本地 doc → 连 Hocuspocus（标准 sync 自动合并）；桥订阅 canvasStore（结构投影）+ nodeStore（data 投影），差异转 ydoc 事务；observeDeep 批量转 store；connStatus('connected'|'connecting'|'offline') 入 canvasStore（不进 history/localStorage 快照）。**本任务起 canvasSyncRuntime 与桥并存但 doSave 停用（加 if 常量开关），Task 15 删除。**
- [ ] **Step 3: 绿 → 手工验证**——两浏览器不同账号同团队：拖节点/改参数实时同步；断网改 3 处恢复自动合并。
- [ ] **Step 4: Commit** `feat(web): collab 桥——双向同步/防回环/undo桥/标准sync恢复`

---

### Task 15: autosave 链路退役（TDD-回归）

**Files:**
- Delete: `apps/web/src/stores/canvasSyncRuntime.ts`；Modify: `project.controller.ts`（删 PUT canvas/viewport 端点）、`project.service.ts`（删 syncCanvas/updateViewport）、`project.service.spec.ts` 清理、web 端 api/projectApi 删对应函数、6 个生成触发点删 `await flush`、`useCanvasPersistence.ts`（v3 去 serverVersion）、`CanvasTopBar.tsx`（三态指示器→连接状态：已连接/连接中/离线重试）、`canvasSnapshot.ts`、相关 specs

- [ ] **Step 1: 失败测试**——连接状态指示器渲染三态；快照 v3 恢复逻辑（无 serverVersion 字段）。同时全量跑两侧测试套确认无旧端点引用残留（编译红即失败测试）。
- [ ] **Step 2: 红 → 实现** —— 按 spec T7 清单全删；saveStatus 字段替换为 connStatus。
- [ ] **Step 3: 绿 → 手工回归**——生成 6 类节点正常（执行读 server doc 实时值）；模板保存/导入；undo/redo；组操作。
- [ ] **Step 4: Commit** `refactor: autosave 链路退役——PUT/flush/409/viewport 全删，三态改连接状态`

---

### Task 16: Presence——光标/选区/在线成员（TDD）

**Files:**
- Create: `apps/web/src/pages/canvas/components/RemoteCursors.tsx` + spec、`collab/awareness.ts`
- Modify: `CanvasView.tsx`（指针/选区事件上报 + 渲染层）、`CanvasTopBar.tsx`（在线头像列表）

- [ ] **Step 1: 失败测试**——awareness 封装：setCursor/setSelection/getStates；RemoteCursors：两个 awareness state 渲染两个名字标签于坐标处（jsdom 断言 DOM）；TopBar 在线成员数。
- [ ] **Step 2: 红 → 实现** —— onPointerMove 节流 50ms 上报（screenToFlowPosition）；React Flow 变换层外渲染光标（transform: translate + 缩放跟随 viewport）；颜色按 userId hash 分配。
- [ ] **Step 3: 绿 → Commit** `feat(web): awareness presence——远端光标/选区/在线头像`

---

### Task 17: 存储配额（TDD）

**Files:**
- Create: `apps/api/src/modules/team/storage-quota.service.ts` + spec、`task/team-media-cleanup.processor.ts`
- Modify: `storage.service.ts`（presign 前校验 + **confirm 二次校验**）、`storage.controller.ts`（PresignUploadDto 加 teamId + 成员校验）、`ai-download.processor.ts`（落 MinIO 前校验）、素材库查询端点（teamId 过滤）+ specs

- [ ] **Step 1: 失败测试**——① `getUsage(teamId)`：sum(size, completed, deletedAt null)；② presign：超限拒；③ **confirm 二次校验（Q7）**：mock 两并发 presign 通过后 confirm 时 `已用+actualSize>限额` → 删 MinIO 对象 + 删 Media + 抛错（事务断言）；④ presign dto teamId 非成员 403；⑤ cleanup processor：批量删 MinIO 对象；⑥ **生成物超限语义**：ai-download.processor 落 MinIO 前校验失败 → Media 不创建、节点 withDoc 写失败态 data.errorCode='storage_quota_exceeded'、**credits 不退（推理已发生）**、emit 进度通知携带可读提示（清理素材或升级）。
- [ ] **Step 2: 红 → 实现**。
- [ ] **Step 3: 绿 → Commit** `feat(api): 团队存储配额——用量/presign+confirm双重校验/异步清理`

---

### Task 18: 团队管理页前端（TDD）

**Files:**
- Create: `apps/web/src/pages/team/TeamPage.tsx`（布局+左导航 4 项+**团队切换下拉**）、`MembersTab.tsx`、`CreditsTab.tsx`、`PermissionsTab.tsx`、`JoinRequestsTab.tsx`、`components/`（TeamHeader/OverviewCard/MemberTable/InviteModal/QuotaModal/RechargeModal/SubscribeModal）+ specs、`api/teamApi.ts`、`pages/join/JoinPage.tsx`（**B3：邀请落地页**）+ spec
- Modify: `router.tsx`（/team + /join 路由）、`Navbar.tsx`（用户菜单加「团队管理」）、个人中心 `CreditsPage.tsx`/`MembershipPage.tsx`（隐藏购买入口，引导团队——S5）、项目列表/素材库/创建项目上下文读 **currentTeamId**

- [ ] **Step 1: 失败测试（组件测试，mock teamApi）**——① 布局：左导航 4 项 + 默认成员管理激活；② TeamHeader：名称/角色标签/版本标签/团队 ID 复制（clipboard mock）/按钮组（解散仅 OWNER 且唯一团队禁用；立即开通免费版显示、active 期变「已开通·到期时间」；邀请主按钮 #5DDCFF）；③ OverviewCard：剩余积分=总额+通用积分=credits、席位 n/20、存储 X/6G、到期时间；④ MemberTable：antd Table 分页 {items,total}、进度条消耗/额度、角色标签、三点菜单（改角色/配额度/移除）；**预留席位占位行补齐到 seatLimit**；⑤ InviteModal：团队 ID + 链接 `/join?team=`；⑥ CreditsTab：流水表+档位充值（WeChatQRModal 复用）；⑦ JoinRequestsTab：批准/拒绝；⑧ PermissionsTab：审批开关；⑨ 个人页隐藏购买断言；⑩ **JoinPage（B3）**：未登录跳 /login?redirect=/join?team=xxx；已登录展示团队名+留言框+提交调 apply API；重复 PENDING 申请提示；⑪ **团队切换下拉（I2）**：getMyTeams 返回多团队时显示、切换写 localStorage currentTeamId 并刷新页面数据；单团队不渲染。
- [ ] **Step 2: 红 → 实现**（antd Table 模式照 SubscriptionTabs；深色硬编码风格 + #5DDCFF）。
- [ ] **Step 3: 绿 → 手工验收**——浏览器走 spec 验证标准 1-8 全清单（两账号协同/AI 实时/断网合并/充值沙箱/额度/席位/403/回归）。
- [ ] **Step 4: Commit** `feat(web): 团队管理页——4 tab/概览卡/成员表/邀请/充值/订阅/个人入口下线`

---

### Task 19: 部署配置 + 收尾验证

**Files:**
- Modify: `.claude/launch.json`（api env COLLAB_PORT）、`apps/web/vite.config.ts`（proxy /collab ws）、服务器 Nginx 配置（手动，参照 server_deployment_guide 记忆：/collab location upgrade）
- Create: 无新文档（验证记录进 commit message）

- [ ] **Step 1: Vite proxy** —— server.proxy 加 `'/collab': { target: 'ws://127.0.0.1:3001', ws: true }`；本地端到端验证两浏览器协同。
- [ ] **Step 2: 全量测试** —— `pnpm --filter @flowweb/api test && pnpm --filter @flowweb/web test` 全绿；`npx tsc --noEmit` 两侧通过。
- [ ] **Step 3: Nginx + 生产 env**（部署时执行）——Ubuntu 服务器加 /collab WS upgrade location + **PM2 ecosystem.config.js 的 api 环境加 COLLAB_PORT=3001** + 重启，参照部署指南记忆。
- [ ] **Step 4: Commit** `chore: collab 部署配置——Vite ws proxy/端口env`

---

## 验证对照（spec 验证标准 → 任务覆盖）

| spec 验证项 | 覆盖任务 |
|---|---|
| 1 双端实时同步+光标互见 | 12/14/16 手工 + 单测 |
| 2 AI 结果实时+离线不丢+刷新恢复 | 13/14（异步回写+CanvasDoc） |
| 3 断网合并无 409 | 14 |
| 4 充值/订阅/到期/重购/active 拒购 | 9/10 |
| 5 月度额度+跨月清零 | 8（惰性重置单测） |
| 6 席位满拒绝+存储超限拒绝 | 7/17 |
| 7 非成员 403+未登录握手拒 | 5/12 |
| 8 回归（模板/素材/undo/组/6 节点/个人页） | 15/18 手工清单 |
