# Spec: 团队功能 + 画布实时协作（Team + Yjs）

日期：2026-08-27
状态：待确认（第六轮补全：解散清理清单完整化（Media/TeamBalance/JoinRequest）/ 迁移补流水 / unload 框架行为表述修正；共 36 项裁定，五轮架构评审已闭环，本轮为边角完整性）
来源：方案调研（生产级协作方案对比 + 外部建议评审 4 处纠错 2 处补漏）+ 用户 7 项决策 + liblib 团队管理页 UI 参考
关联：canvas-autosave-design.md（其乐观锁/409/flush 链路本 spec 全面退役；"未来扩展-Yjs overlay"按一步到位路线直接实施）

## 背景与目标

当前画布为纯单人编辑模型（debounce 全量 PUT + 乐观锁 + 409 败者全量重载），无团队/成员/权限概念，credits/订阅/充值全部挂在个人 user 维度。目标：引入完整的团队产品形态（成员/席位/积分池/额度/订阅/存储配额/加入申请），并将画布升级为 Yjs CRDT 实时多人共编，AI 执行链路全程实时读写服务器权威 Y.Doc。

## 已确认决策（用户 2026-08-27）

1. **一步到位 Yjs**：不做共享式协作中间形态，直接替换 autosave 链路
2. **Team + TeamMember** 权限模型（"工作空间"名称已被 /works 个人页占用，团队概念独立命名）
3. **Hocuspocus 嵌入 NestJS** 作同步引擎（生产级协议侧现成：auth 钩子/持久化钩子/文档生命周期）
4. **团队 credits 池**：执行扣费扣项目所属团队的池
5. **完整产品形态**：含团队订阅、加入申请审批流、存储配额；**不做**：移出成员次数限制、席位付费扩展（免费 20 席固定）
6. **团队充值直接接微信支付**（团队级订单，复用回调前缀路由机制）
7. **团队角色 OWNER/ADMIN/MEMBER** 三级

## 侦查结论（2026-08-27 源码验证）

1. **画布保存链路**：canvasSyncRuntime.ts 2s debounce → PUT /projects/:id/canvas {nodes,edges,version} → 事务内 updateMany where version + deleteMany/createMany 全量重写（project.service.ts:102）→ 409 全量重载
2. **后端画布消费者：直写 4 处 + 异步 emit 4 处 + 读取 3 处**：同步写 = execution.service.ts:74/114/176（AI 回写状态/结果）+ project.service.ts:44（自动保存）；**异步 emit fileId（前端收 socket 写回 store 再 autosave，无服务端持久化）** = ai-download.processor.ts:84、ai-image-edit.processor.ts:141、lighting.consumer.ts:154、stitch.consumer.ts:107；读 = execution.service.ts:29 + project.service.ts:73 + canvas.service.ts:56（模板保存构造 templateData，均读 project.nodes/edges）
3. **执行扣费点 5 处**全走旧 `credit.deduct`（无流水版）：execution.service:84（文本，成功后扣）、:167（图片，成功后扣）、:119（视频仅查余额未实扣）、ai-image-edit.processor:138、lighting.consumer:151（失败均不扣）。`consume`（订阅优先+流水）无生产调用
4. **支付链路通道可复制、入账必须重写**：订单流/回调（Redis nonce 去重→验签→outTradeNo 前缀路由，实际前缀 SUB=订阅 / RC=充值，回调仅判 SUB 其余走充值默认分支）/FOR UPDATE 行锁+updateMany(PENDING) 幂等/BullMQ 三件套兜底/PaymentGateway socket/WeChatQRModal 均可复制；但个人版 completeOrderInTransaction 入账的是 **UserBalance.balance（现金，分）**（recharge.service.ts:358-364），团队版入 credits 需全新实现
5. **订阅发放可复制**：grant-credit.processor 批量扫描 nextGrantDate + scheduler cron（02:00 UTC）+ 事务内发放；expire 任务同理
6. **UserBalance**：userId unique 键，credits/subscriptionCredits/balance(现金)/version 乐观锁；无 owner 类型判别——团队池需新表
7. **Media**：userId 归属（AuthGuard server-side），已有 size 字段，**无任何用量统计端点**
8. **前端**：react-router v7；settings 嵌套布局（SettingsLayout 左导航+Outlet）为团队页挂载范式；antd Table 先例 SubscriptionTabs（客户端分页，列表 API 形状 {items,total,page,pageSize}）；全站硬编码深色，无暗色切换机制
9. **socket.io /execution** namespace 已有 project:{id} 房间 + BetterAuth 握手，仅服务端单向推送
10. **nodeStore data 已引用化**（fileId/URL/参数，无 base64）——Yjs 同步体积可控的前提已满足

## 总体架构

```
┌─ web ─────────────────────────────────────────────┐
│ React Flow ←→ canvasStore/nodeStore（状态源不变）   │
│      ↕ canvasCollabRuntime（新桥：origin 防回环）   │
│ @hocuspocus/client + y-protocols/awareness         │
└────────┬─ WS :3001/collab ────────────────────────┘
         ↓
┌─ api (NestJS) ────────────────────────────────────┐
│ Hocuspocus（嵌入）                                 │
│   onAuthenticate: BetterAuth + TeamMember 校验     │
│   onStoreDocument: 5s debounce → CanvasDoc 快照    │
│   server doc = 权威文档（AI 回写/执行读取的入口）    │
│ execution.service: 读 server doc → AI → applyUpdate│
│ /execution namespace: node:status 推送（不变）      │
└────────┬──────────────────────────────────────────┘
         ↓
PostgreSQL: Team/TeamMember/TeamBalance/CanvasProject.teamId/CanvasDoc...
微信支付: TEAM* 前缀订单 → 团队池入账
```

## 数据模型（Prisma）

**新增：**

```
Team                id, name, ownerId(→User), status(ACTIVE|DISBANDED) @default(ACTIVE), createdAt; @@index([status])
TeamMember          id, teamId, userId, role(OWNER|ADMIN|MEMBER),
                    monthlyQuota Int @default(0)      // 0=不限额
                    monthlyPeriod String?             // 'YYYY-MM'
                    monthlyUsed Int @default(0)
                    joinedAt; @@unique([teamId,userId])
TeamBalance         teamId @unique, credits(充值积分，永不过期), subscriptionCredits(订阅积分，本期有效), version  // 双池，复制 UserBalance 模式（UI 概览卡"剩余积分/通用积分"双字段佐证）；订阅积分的有效期由 TeamSubscription.currentPeriodEnd 界定，无需独立 expiry 字段（月付购买即发、到期统一清零）
TeamCreditTransaction teamId(可空，解散后 SetNull 保留凭证), operatorUserId?, amount, type(recharge|subscription_grant|consumption|expire_clear|register_grant|admin_adjust), creditType(regular|subscription), balanceAfter, referenceId?, createdAt   // subscription_grant=订阅购买/续费发放（对齐个人版 payment-success 语义；subscription_payment 在个人版是"普通积分支付订阅"的支出类型，不采用——T1 裁定）
TeamPlan            id, name, monthlyCredits, storageLimitBytes, seatLimit, priceMonthly(Int 分), isActive, sort   // 一期仅月付档位
TeamSubscription    teamId @unique→Team, planId→TeamPlan, status(active|expired), paidAmount, currentPeriodStart/End   // 一期仅月付：无 nextGrantDate/grantCount（月付无月度分摊发放，付款即发、到期即清——Q2/Q6 裁定）；免费版=无 active 行
TeamRechargeOrder   teamId, payerUserId(付款人，服务端取当前登录用户，Q5), outTradeNo(前缀 TEAM*), amountFen, credits, status(PENDING|SUCCESS|CLOSED), expiresAt, paidAt   // 复制 RechargeOrder 模式
TeamJoinRequest     id, teamId, userId, status(PENDING|APPROVED|REJECTED), message?, createdAt, decidedAt, decidedBy String?(→User)
CanvasDoc           projectId @unique, state Bytes, updatedAt;  project CanvasProject @relation(fields:[projectId], references:[id], onDelete: Cascade)   // Y.encodeStateAsUpdate 全量快照；随项目级联删除（T4 裁定：解散/删项目物理清理时无 FK 阻止）
```

**修改：**

- `CanvasProject`：+ `teamId`（必填，FK→Team）；`userId` 语义改为"创建者"保留；**删除 `version`**（乐观锁随 autosave 退役）与 `viewport` 列（T7）
- `Media`：+ `teamId`（必填）——上传/生成时服务端归属
- **支付凭证关系不做 Cascade**：TeamRechargeOrder/TeamSubscription 对 Team 的外键用 `SetNull`（teamId 可空）——微信支付订单是对账/退款凭证，解散团队不得物理删除（P2 裁定：财务凭证保留为合规要求，不属于"无存量包袱"豁免范围）

**迁移（开发库已有 CanvasProject/Media 行，必填列直接迁移会失败）：**

1. `prisma migrate dev` 前置 data migration：为每个已有 userId upsert 默认团队（name="{用户名}的团队"）+ TeamMember(OWNER) + TeamBalance(credits=100, subscriptionCredits=0) **+ 一条 register_grant 流水（amount=100, creditType=regular, balanceAfter=100，账实相符——与 T3 注册赠送路径同构）**
2. 回填所有 CanvasProject.teamId / Media.teamId = 对应默认团队
3. 拷贝现有 nodes/edges 行序列化为初始 Y.Doc state（Y.encodeStateAsUpdate）写入 CanvasDoc，随后删除两表

**删除（无存量数据包袱）：**

- `CanvasNode` / `CanvasEdge` 表（数据进 Y.Doc）
- `UserBalance.credits` 消费语义整体废弃个人池：执行扣费一律走团队池（个人 UserBalance/订阅/充值链路保留运行但不再被执行消耗；个人充值页引导至团队积分管理）

## 模块设计

### T1 团队生命周期

- **注册即建默认团队**：BetterAuth 用户创建钩子 → 建 Team（"{用户名}的团队"）+ TeamMember(OWNER)。个人使用 = 单人默认团队，无双轨
- **邀请成员**：「邀请成员」弹窗展示团队 ID（复制）+ 邀请链接 `/join?team={teamId}`；被邀请人打开链接 → 填申请留言 → TeamJoinRequest(PENDING)
- **加入申请审批**：OWNER/ADMIN 在「加入申请」tab 批准/拒绝；批准 = 事务内（席位校验：成员数 < 20 → 建 TeamMember(MEMBER) → 请求置 APPROVED）；「权限设置」tab 提供「新成员加入需审批」开关（默认开，关 = 自动通过直接入团）
- **移除成员**：OWNER/ADMIN 操作；OWNER 不可被移出；移除 = 删 TeamMember 行（其创建的项目留team）
- **角色变更**：OWNER 可将成员提为 ADMIN/降级；OWNER 转让（一期不做，登记未来扩展）
- **解散团队**：**禁止解散用户所属的唯一团队（Q3 裁定：前端按钮禁用 + 后端校验双重防护）**——否则解散后既无团队又无创建入口（一期无"新建团队"功能）。非唯一团队时，OWNER 二次确认后**完整清理清单**：① Team 置 `status=DISBANDED`；② 物理删除 TeamMember / TeamJoinRequest（Cascade，团队不存在申请无意义）/ TeamBalance（余额是状态非凭证，流水已单独保留，余额行无保留意义）；③ 物理删除 projects（级联删 CanvasDoc）；④ 物理删除 Media（DB 记录 + MinIO 对象投递 BullMQ 异步清理，配额随之释放——无存量包袱、二次确认破坏性操作，随团队删最干净，不做 SetNull）；⑤ **模板自动保留**（schema.prisma:118 Template.project 已是 onDelete: SetNull，模板是个人/社区资产不随团队消失——S4 澄清，现状即如此无需改 schema）；⑥ **支付订单/流水/订阅记录仅保留**（外键 SetNull，teamId 置空，对账凭证不删）；已解散团队所有端点/网关拒绝访问
- **月度额度惰性重置**：扣费时 `monthlyPeriod != 当前月` 则清零 monthlyUsed 并更新 period——无 cron

### T2 团队管理页（web，/team 路由）

- 挂载：Navbar 用户菜单新增「团队管理」；`/team` 顶层路由（RequireAuth），布局仿 SettingsLayout：左侧 200px 导航 4 项 + Outlet
- **成员管理 tab**（默认）：
  - 顶部团队信息栏：头像（名字首字）、团队名（可编辑，OWNER/ADMIN）、角色标签、版本标签（免费版/团队版）、团队 ID + 复制按钮；右侧按钮组：解散团队（OWNER）/ 立即开通（免费版显示，跳团队订阅购买）/ 邀请成员（青色 #5DDCFF 高亮主按钮）
  - 资源概览卡片：剩余积分（+「充值」文字链）、通用积分、席位 n/20、存储空间 X/6G（+「管理资产」链到素材库）、到期时间（免费版 `--`）
  - 提示行：下次发放权益时间（一期固定 `--`，与 T4 裁定一致——T3 统一）+「积分额度配置」按钮（批量弹窗：逐成员设 monthlyQuota）
  - 成员表格（antd Table，服务端分页 {items,total}）：成员（头像+名）/ 本月积分消耗÷额度（进度条）/ 角色（标签）/ 三点菜单（改角色、配额度、移除）；**预留席位占位行**：补齐到 20 席的空行（纯前端展示，`-` 占位）
- **积分管理 tab**：团队流水表（TeamCreditTransaction 分页列表）+ 充值档位按钮组（复用个人档位 [10,30,50,100,200,500] 元）
- **权限设置 tab**：角色权限说明矩阵（只读）+「新成员加入需审批」开关
- **加入申请 tab**：PENDING 列表（申请人/留言/时间）+ 批准/拒绝；已处理记录灰显
- 视觉沿用全站硬编码深色 + #5DDCFF/#07B8DD 青蓝强调（与 UI 参考一致）

### T3 团队积分池 + 微信支付

- **TeamCreditService**（复制已验证模式）：`consume(teamId, cost, operatorUserId, referenceId)`——**校验顺序（D5 裁定）**：① 双池总余额（subscriptionCredits+credits）不足直接拒（不动 monthlyUsed）→ ② 成员月度额度校验（quota>0 时 used+cost≤quota，不足拒）→ ③ 扣减（订阅优先：先 subscriptionCredits 后 credits，乐观锁 version + MAX_RETRIES=3）→ ④ monthlyUsed 累加 → 流水（type=consumption，creditType 按实际扣减池拆分）；失败返回 {success:false}，执行链路按现有"余额不足"路径处理
- **初始余额（P3 裁定）**：注册建默认团队时 TeamBalance.credits = 100（对齐个人版 getOrCreateBalance 赠送）+ 一笔流水（**type=register_grant**，Q8 裁定：新枚举值，不复用 admin_adjust——那是管理员手动调整语义）——否则新用户无法执行任何生成
- **充值**：`POST /api/team/:id/recharge/orders`（档位校验）→ `.../pay` → 微信 Native 二维码（WeChatQRModal 复用，join:order 频道带 TEAM 前缀）→ 回调 notify/wechat **前缀路由新增 TEAM\* 分支** → FOR UPDATE + 幂等完成：`credits += order.credits`（1 元 = 10 积分，服务端常数）+ 流水（recharge）+ PaymentGateway 推送
- **兜底**：复制 close-expired（2h）/active-query 延迟任务，队列名 team-recharge-*
- **管理端**：admin 模块加团队余额 grant/adjust（type=admin_adjust）

### T4 团队订阅

- TeamPlan 档位数据行（管理端维护）；免费版为代码常量（seatLimit=20，storageLimit=6GiB，monthlyCredits=0）。**一期团队订阅仅支持月付（Q6 裁定）**
- **购买/续费（Q2 裁定：月付模型，无月度分摊发放；S3 裁定：不支持提前续费）**：「立即开通」→ 选套餐 → 微信支付（TEAM 前缀订单复用回调，type 区分 recharge/subscription）→ 回调成功事务内（复制 payment-success.processor 幂等模式）：① 若有上期剩余 subscriptionCredits 先清零（expire_clear 流水，记负值——防御 expire cron 延迟窗口内到期未清即续购的场景）→ ② `subscriptionCredits = plan.monthlyCredits`（覆盖式发放，杜绝累计）→ ③ 建 TeamSubscription（currentPeriodEnd = +30d）→ ④ 流水 **subscription_grant**（T1 裁定：与个人版 payment-success 发放语义对齐）；**存在 active 订阅时购买接口直接拒绝**（前端按钮变"已开通·到期时间"，到期后才可续订）——续费 = 到期后新购，无顺延/清零歧义、无提前续费损害用户问题
- **到期**：team-expire processor（复制 expire-subscription 模式：扫描 currentPeriodEnd ≤ now → 置 expired + 清零 subscriptionCredits + expire_clear 流水，充值 credits 不动）→ 回落免费版限额（席位超 20 不踢人，仅禁止新增；存储超限仅禁止上传）
- **不做月度发放 cron**（个人版的 grant-credit.processor 是季/年付月度分摊机制，月付 maxGrants=1 付款即发——团队版月付同构，无自动周期发放）
- 概览卡：「到期时间」从 active TeamSubscription.currentPeriodEnd 读取；「下次发放权益时间」一期固定显示 `--`（发放发生在续费付款时点，无自动发放周期；季/年付分摊发放登记未来扩展）；**双池展示映射：「剩余积分」= subscriptionCredits + credits 总额，「通用积分」= credits**（充值积分）
- **个人购买入口一期下线（S5 裁定）**：执行扣费全走团队池后，个人 subscriptionCredits 无消耗出口——前端隐藏个人订阅购买/升级入口与个人充值入口（后端链路保留不删），个人中心订阅/积分页仅展示余额并引导至团队积分管理，避免用户买到无用额度

### T5 存储配额

- 用量 = `Media.aggregate({ _sum: size, where: { teamId, status: 'completed', deletedAt: null } })`
- 上传（storage.controller presign 前）与生成物落 MinIO 前（ai-download.processor）校验 `已用 + 本次 ≤ 限额`；**confirmUpload 二次校验（Q7 裁定）**：presign 后客户端直传 MinIO，实际大小在 confirm 才落库（storage.service.ts:64 actualSize）——两并发上传可同时通过 presign 校验但合计超限；confirm 置 completed 前事务内校验 `已用 + actualSize ≤ 限额`，超限则删 MinIO 对象 + 删 Media 记录 + 抛错
- **素材库直传的 teamId 来源（D4 裁定）**：PresignUploadDto 增加 teamId 字段（客户端传当前团队上下文），服务端校验该用户为团队成员后归属；AI 生成类由 job 内 projectId 解 teamId
- 「管理资产」→ 素材库页按当前团队过滤（Media.teamId 接线）
- 素材库其余 UI 不动

### T6 Yjs 实时协作

**服务端（Hocuspocus 嵌 NestJS）：**

- 依赖：`@hocuspocus/server`（+ NestJS lifecycle 手动挂载或 `@hocuspocus/nestjs`，plan 阶段定）；监听独立端口 3001；Nginx 加 `/collab` WS upgrade location；Vite dev proxy `ws: true`
- `onAuthenticate`：BetterAuth cookie 校验（复制 execution.gateway 握手模式）→ TeamMember 存在校验（团队内 MEMBER 及以上即可写；一期无项目级只读角色）→ connection 携带 userId/name/color
- `onStoreDocument`：5s debounce → `Y.encodeStateAsUpdate` 全量写 CanvasDoc（单表快照，无 update 日志表——单机部署+文档 MB 级，增量日志属超前设计）
- **单一 Y.Doc 实例铁律（Q1 裁定，实施最易踩坑，写死）**：Hocuspocus 自身管理 Y.Doc 生命周期（onLoadDocument 创建、最后连接断开 unload）——**服务器端业务写入（AI 回写/异步任务回写）必须走 Hocuspocus 官方 `server.openDirectConnection(documentName)` 直连 API**，拿直连后 `connection.transact(doc => {...})` 修改，走完整 onLoadDocument→变更广播→onStoreDocument 生命周期；**严禁在业务 service 里自建 Y.Doc 实例**（自建实例与 Hocuspocus 管理的 doc 双轨：AI 写 A、客户端同步 B，互不可见、持久化互相覆盖）
- **doc 装载/持久化归 Hocuspocus 钩子**：onLoadDocument 内从 CanvasDoc 快照 `Y.applyUpdate` 还原并返回；onStoreDocument 5s debounce 全量快照落盘。CollabDocumentService 退化为薄封装：`withDoc(projectId, fn)`（openDirectConnection + 事务回调，**try/finally 保证回调结束后 connection.disconnect()——S7 裁定：直连不关闭则该文档永远不被 Hocuspocus unload、最后断开时 debounce 快照不 flush**）+ `readCanvas(projectId)`（doc → plain nodes/edges 反序列化，供执行/模板读取）——不持有任何 doc 实例/LRU 池；**最后连接（含直连）断开时 Hocuspocus 框架自动调用 onStoreDocument flush 落盘后销毁文档**（无独立 unload 钩子，S7 的 try/finally disconnect 保证直连不阻止该 flush——D7 落盘语义由此框架内置行为承载，无需额外实现）
- 单机单实例：不做 Redis adapter / sticky session（登记未来扩展）

**Y.Doc 结构（细粒度建模）：**

```
ymap 'nodes': nodeId → Y.Map
  ├ 常规键: type, parentId, width, height
  ├ 'position': Y.Map {x, y}        // 拖动高频，独立子 Map
  └ 'data': Y.Map {prompt, model, resultUrl, status, ...}  // data 内字段逐键，禁止整块替换
ymap 'edges': edgeId → Y.Map {source, target}
（viewport 不进 doc——纯 UI 偏好，走 awareness 或维持 localStorage）
```

**前端桥 canvasCollabRuntime（对偶退役的 canvasSyncRuntime）：**

- store 仍为 React Flow 状态源；桥双向同步 + **origin 标记防回环**（本地变更 `local` origin 写 ydoc；远端 observe 回调跳过 local origin）
- 本地：onNodesChange/setNodeData 等 mutation 统一经桥转译为 ydoc 事务（position 拖动结束写入 position Map；删除 = nodes map delete）
- 远端：observeDeep → 批量 diff → hydrate 模式写入 store（复用 withHistoryPaused，远端变更不入 undo 栈）
- undo/redo：**保留 zundo**（不换 Y.UndoManager，改动最小）；undo 产生的 store 反向变更经桥以 `local-undo` origin 写 ydoc
- **awareness presence**：光标位置（pointer 事件 → awareness.set('cursor',{x,y,viewport})）+ 选区（selectedIds）+ 用户名/颜色；CanvasView 渲染 RemoteCursor 层与选中高亮描边；在线成员头像列表挂 TopBar
- localStorage 崩溃快照保留（D2 裁定）：**连接前将快照 apply 到本地 Y.Doc，随后连接 Hocuspocus 走标准 sync 协议**（state vector 自动交换差异、自动合并，server 为准）——不做手动 mergeUpdates 拼接发送

### T7 autosave 链路退役（全部删除，无兼容负担）

- canvasSyncRuntime.ts 整文件、PUT /projects/:id/canvas 端点、project.service.syncCanvas、409 冲突重载逻辑、flushCanvasSync/flushOnUnload、6 个生成触发点的 `await flush('execute')`
- **"执行读旧参数"风险收敛说明（D1 裁定）**：ydoc 实时同步将该窗口从"最长 2s debounce"压缩到"WS 传输毫秒级"，但客户端 update 到服务器 apply 为异步，**不能声称从根上消除**；登记为已知限制（同机房毫秒级窗口，一期接受，不做执行端点 state vector 等待机制——复杂度不成比例，登记未来扩展）
- saveStatus 三态指示器 → 协作连接状态指示（已连接/连接中/离线重试），语义变更为 WS 连接健康
- **viewport 通道退役（D6 裁定）**：删除 PUT /projects/:id/viewport 端点 + updateViewport API + CanvasProject.viewport 列；viewport 改纯 localStorage（个人视角不共享）；模板保存时的 viewport 改由前端 SaveAsTemplateDialog 提交当前 viewport（原从 project.viewport 列读取的路径随列删除）
- CanvasProject.version 字段删除；localStorage 快照 v3 去掉 serverVersion

### T8 AI 回写 + 后端读画布改造

- execution.service.ts:29 读画布 → `CollabDocumentService.readCanvas(projectId)` 从 server doc 实时读（plain nodes/edges 结构，形状与原 include 结果对齐，下游零改动；S1 统一：全文仅 readCanvas/withDoc 两 API，无 getDoc/applyServerUpdate）
- execution.service.ts:74/114/176 同步 AI 回写 → `withDoc(projectId, doc => {...})`：直连事务内写节点 data/status → 在线端实时收到 → 持久化钩子落 CanvasDoc
- **四个异步 job 完成后的服务端回写（P1 裁定，原为 emit fileId 交前端写回）**：ai-download.processor / ai-image-edit.processor / lighting.consumer / stitch.consumer 完成后由服务器 `withDoc` 直连写入节点 data（fileId/resultUrl/尺寸等字段）并广播；**socket 推送退化为纯进度通知**（前端仅做 loading 态切换，不再承担持久化职责）——否则所有端离线时 fileId 永久丢失。stitch 写入 storyboard 组节点的 doc 结构（cellCount/fileIds 数组）在 plan 阶段明确
- 模板保存（canvas.service.ts:56 读画布）→ 同样从 server doc 读
- 入队 job data 不变（projectId 驱动，worker 内取 doc）；/execution namespace 的 node:status 推送保留（高频进度与文档写入分离）

### T9 执行扣费改造

- 5 个扣费点统一改调 `TeamCreditService.consume(teamId, cost, operatorUserId, referenceId)`；teamId 从 project.teamId 解（执行链路已有 project 加载点）
- **余额预检点同步改造（Q9 裁定，比扣费点易漏）**：lighting.service.ts:90（提交前 `getBalance` 预检）、execution.service.ts:92（文本执行前预检）、execution.service.ts:119/181（扣费后余额回读展示）——全部改查团队双池 + 成员 quota 余额视图
- 视频 :119 未实扣的存量问题顺带补上（对齐"成功后扣"惯例）——在任务范围内修正
- 失败不扣/不退语义维持现状

### T10 权限贯通

- TeamGuard（NestJS）：请求级解析"操作者 → 目标资源（project/media/team）→ 所属团队 → TeamMember 角色"；项目 CRUD/画布/执行/团队管理端点全部接入
- 团队内 MEMBER 即可编辑团队全部项目并实时协作（一期无项目级角色，登记未来扩展）
- Hocuspocus onAuthenticate 复用同一判定

## 前置依赖与版本

- 新依赖（api）：yjs、@hocuspocus/server（或 @hocuspocus/nestjs，plan 定）；（web）：yjs、y-protocols、@hocuspocus/client
- Redis 5.0.14 → 6.2+ 升级（BullMQ 长期警告；本地 Windows + 腾讯云 Ubuntu 各一套）——非本功能硬前置，列为并行改进项
- 微信支付团队订单沿用现有商户配置，零新配置

## 明确不做（一期边界）

- 移出成员次数限制、席位付费扩展（用户裁定不要）
- 项目级角色（EDITOR/VIEWER）、多团队切换 UI、OWNER 转让
- CanvasDoc 增量 update 日志表、多实例 redis-adapter/sticky session
- 离线长期编辑的 UI 化管理（CRDT 断线重连自动合并已覆盖）
- 团队微信支付退款

## 验证标准

1. 两浏览器登录不同账号同团队：拖节点/改参数/删节点实时同步，互不覆盖；光标与选区互见
2. AI 生成完成（含异步链路：图片下载/图片编辑/lighting/视频拼接）：服务器写 server doc，另一在线端节点结果实时出现（不经刷新）；**所有在线端关闭后再完成的异步任务，重新打开页面后结果仍在**（服务端持久化，非前端写回）；刷新页面后从 CanvasDoc 恢复一致
3. 断网 30s 本地编辑 3 处 → 恢复：自动合并同步，无 409/重载/toast
4. 团队充值（微信沙箱/mock 回调）：订单 PENDING→SUCCESS，池余额与流水正确；免费版购买团队版：当期 subscriptionCredits 到账（subscription_grant 流水）；到期（模拟 currentPeriodEnd 过期触发 team-expire）后清零并回落免费限额；active 订阅期内再次购买被拒绝；到期后重新购买：subscriptionCredits 重新发放、流水正确
5. 月度额度：quota=5 的成员当月累计扣费 5 后第 6 次生成被拒；跨月自动清零
6. 席位：成员满 20 后批准加入被拒；存储超 6G 后上传被拒
7. 非团队成员打开项目 URL：403；未登录连 /collab：握手拒绝
8. 回归：模板保存/导入、素材库、撤销重做、组操作、6 类节点生成、个人订阅/充值页正常

## 未来扩展（登记不实施）

- 多团队管理/切换、项目级权限角色、OWNER 转让、团队审计日志
- CanvasDoc 增量日志 + 多实例（@hocuspocus/extension-redis）
- 执行端点 state vector 等待（彻底消除"执行读旧参数"毫秒级窗口）
- Y.UndoManager 替换 zundo（远端/AI 写入不入 undo 栈的原生支持）
