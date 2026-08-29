# 默认团队改造为「个人项目」体系 — 设计文档

日期：2026-08-29（v2，吸收深度设计评审：4 P0 + 8 P1 + 8 P2 全部核实属实并修订）
状态：已与用户逐节确认（两批设计 + 补充细节评审 + 深度设计评审 + 4 项决策拍板）

## 1. 背景与目标

一期团队化时，历史「个人项目」已归入各用户注册时自动创建的默认团队（`{name}的团队`）。当前所有团队在 UI/逻辑上无差别，用户注册后看到「XX 的团队」，误以为平台不支持个人使用。

**目标**：将默认团队在产品语义上完全模拟为历史「个人项目」：

- 数据层仍是 Team（复用团队积分/订阅/扣费体系），标记 `isDefault=true`，数据库级保证每用户唯一
- 默认团队仅用户一人：禁加成员、禁申请加入、禁审批、禁解散、禁转让、禁团队套餐订阅、禁单画布协作者分享（六禁）
- 默认团队与新建团队的积分/订阅完全独立
- `/works` 分「个人」「团队项目」双页签，团队项目按团队分组平铺
- 个人充值走 `/settings/membership`（订阅）+ `/settings/credits`（充值），操作默认团队账本
- 异步生成物（Media/Task/MaterialFolder）归属收敛到项目团队，数据隔离全覆盖
- 开发测试阶段无用户数据：不做向后兼容/存量数据防护，User 级账本彻底废弃

## 2. 核心决策总表

| 决策点 | 结论 |
| --- | --- |
| 默认团队标记 | `Team.isDefault Boolean @default(false)` + **partial unique index**（裸 SQL：`CREATE UNIQUE INDEX team_owner_default_unique ON "Team"("ownerId") WHERE "isDefault" = true`，Prisma schema 表达不了，migration 手写） |
| 默认团队六禁 | 服务层强制：拒申请/拒审批/拒解散/拒转让/拒团队套餐订阅（第五禁）/拒单画布 ProjectMember 分享（第六禁）；**积分充值（kind=credits）放行**（个人充值依赖） |
| 文件夹隔离 | `Folder.teamId` 必填 + FK(Cascade) + index + `@@unique([teamId,parentId,name])`；userId 保留但语义降为「创建人」，scope 全部换 teamId |
| 个人订阅实体 | UserSubscription/SubscriptionOrder 挂 userId 不动（默认团队与用户一一对应，语义等价） |
| 现金余额买订阅 | **删除死链路**（前端已核实无调用方，MembershipPage 真实购买全走微信订单；TeamBalance 无现金字段，改写不成立） |
| 个人订阅账本 | 积分发放/清零/后台调整的写入点（payment-success / grant-credit / expire / admin 四处）改写默认团队 TeamBalance |
| 个人充值 | 复用团队充值链路：TeamRechargeOrder（teamId=默认团队）→ TeamBalance.credits；档位与团队一致（1 元=10 积分，已核实与 CreditsPage 预设相同） |
| 团队充值/订阅 | TeamSubscription/TeamRechargeOrder/TeamPage 现有功能不动 |
| 套餐配置 | 两套独立：SubscriptionPlan（个人，membership 页）/ TeamPlan（团队，TeamPage 页） |
| 团队流水枚举 | TeamCreditTransactionType **新增** `upgrade_clear` / `admin_grant` / `admin_clear`（保证资金审计语义） |
| 流水金额口径 | 清零/发放流水的 amount、balanceAfter 一律以事务内实时读到的 TeamBalance 实际值为准，不用 consumedCredits 推算 |
| UserBalance 体系 | 彻底删除：UserBalance、CreditTransaction、UserBalanceTransaction、RechargeOrder 模型 + 伴随枚举（见 §3） |
| recharge 模块 | **部分废弃**：删 User 级充值全链路（含 scheduler/daily-scan/close-expired/throttle-guard）；保留微信 provider、统一回调路由、订阅/团队回调分支 |
| 执行前余额校验 | 保留校验；签名改 `validateAll(nodes, teamId, userId)`，唯一调用点 execution.service:52 传 `project.teamId`（已在作用域，零额外查库）；余额口径对齐 consume（credits+subscriptionCredits）；月度配额明确「以 consume 为准，预校验只挡团队总额」 |
| 异步媒体归属 | **getOwnerTeamId 判据与 7 处调用全部收敛**：拿得到 project 的一律以 `CanvasProject.teamId` 为唯一权威；仅无项目直传回落 isDefault 默认团队；删除「成员团队兜底」 |
| 素材/任务隔离 | **纳入本期**：MaterialFolder、LightingTask、VideoTrimTask、VideoSeparateTask 加 teamId，与 Media 同步隔离 |
| 顶栏积分 | 非画布页显个人（默认团队）；团队画布内显当前团队积分（复用 execution.gateway 已推 credits）；订阅有效期由 /subscription/me（status=active 且 currentPeriodEnd>now）提供 |
| /works | 双页签；团队项目按团队分组平铺，每组独立新建入口 |
| /team | 只有默认团队时空状态引导；有真实团队后「个人项目」显示精简面板 |
| TeamSwitcher | 只有默认团队时整体隐藏；有团队时列表 =「个人项目」+ 真实团队（默认团队固定排第一），切换仅影响 /team 上下文 |
| 显示名 | DB 名不变；前端统一 `teamDisplayName(t) => t.isDefault ? '个人项目' : t.name`，全 UI 复用防漏改 |
| Template 授权 | getTemplate/update/delete 从「只认 creator」改为 ProjectPermissionService.resolve；团队 scope 查询 `{ project: { teamId } }`（去掉 userId 兜底）；无 projectId 模板只归个人页签；import 透传 teamId |

## 3. 数据模型变更（apps/api/prisma/schema.prisma）

| 模型 | 变更 |
| --- | --- |
| `Team` | 新增 `isDefault Boolean @default(false)` + partial unique index（migration 手写 SQL） |
| `Folder` | 新增 `teamId String` **必填** + FK → Team(Cascade) + `@@index([teamId])` + `@@unique([teamId, parentId, name])` |
| `MaterialFolder` | 新增 `teamId String` 必填 + FK + index（现状仅 userId） |
| `LightingTask` / `VideoTrimTask` / `VideoSeparateTask` | 各新增 `teamId` + FK + index |
| `CanvasProject` | teamId 已存在必填，**无需变更** |
| `UserBalance` | **删除** |
| `CreditTransaction` | **删除** |
| `UserBalanceTransaction`（schema:610-622） | **删除**（现金流水，recharge.service 写它） |
| `RechargeOrder` | **删除** |
| enum 删除 | `RechargeOrderStatus`、`BalanceTxType`、`CreditTransactionType`、`CreditReferenceType`（实施时 grep 确认仅被删除模型引用） |
| enum 保留 | `CreditType` **不删**——TeamCreditTransaction:767 共用 |
| enum 新增值 | `TeamCreditTransactionType` += `upgrade_clear` / `admin_grant` / `admin_clear` |
| `UserSubscription` / `SubscriptionOrder` / `SubscriptionPlan` | 结构不动 |
| Team 级模型（TeamBalance/TeamSubscription/TeamRechargeOrder/TeamPlan/TeamCreditTransaction） | 不动 |

迁移：`prisma migrate dev --name personal_project_refactor`（基线已 squash，禁 db push；partial unique index 在生成的 migration 中手写补充）。

## 4. 后端服务变更（Phase 2）

### 4a. 判据统一与六禁

1. **注册钩子**（[auth.ts:49-74](../../../apps/api/src/auth/auth.ts)）：建默认团队设 `isDefault: true`；与 `ensureDefaultTeam` 是两份重复建团逻辑（DI 外直写），**抽无依赖纯函数共用**，auth 现有 `findFirst({ownerId})` 同步精确为 `ownerId+isDefault`；赠送 100 积分不动
2. **`getDefaultTeam(userId)`**（team.service）：判据 `ownerId=userId AND isDefault=true`；`ensureDefaultTeam` 补建路径同样设 isDefault；并发补建由 partial unique index 兜底（冲突时重查返回既有行）
3. **`getOwnerTeamId`**（[team.util.ts:6-21](../../../apps/api/src/modules/team/team.util.ts)）：判据改为 `ownerId+isDefault`，**删除「成员团队兜底」**
4. **六禁**（team.service / team-subscription.service / project-member.service）：
   - `apply()` 拒申请（400）、`approve()` 拒审批、`disbandTeam()` 拒解散、`transferOwnership()` 拒转让
   - `createSubscriptionOrder()` 对 isDefault 团队抛 400（**第五禁**，防两套订阅引擎并发写默认团队账本）
   - `addProjectMember()` 对默认团队项目拒加（**第六禁**，完全个人语义）
   - **放行**：默认团队的 `POST :id/recharge/orders`（kind=credits）——个人充值依赖
5. **新增 `GET /api/team/default`**：返回 `{id, name, isDefault}`；**必须加 `@SkipTeamGuard()`**（类级 TeamGuard 靠 `:id` 解析，参考 mine 端点）
6. `getMyTeams()`：返回值加 `isDefault`；**默认团队固定排第一**（前端 `?? teams[0]` 缺省不再落到真实团队）；订阅状态分叉——默认团队行查 UserSubscription（经 ownerId），普通团队行查 TeamSubscription

### 4b. canvas/folder/template/teamId 化 + 账本改写 + User 级废弃删除

7. **canvas.service**：`create(name, folderId, userId, teamId?)`，校验用户是该团队成员；folderId 校验改 `{id, teamId}`；`nextUntitledName` 与 advisory lock 从 userId 维度改 **teamId** 维度（防团队并发「画布 N」重名）
8. **folder.service**：`list/create/rename/remove` 的 scope 从 userId 换 teamId（A 能看到 B 建的团队文件夹）；create 校验 `parent.teamId === teamId`（防跨团队挂载）
9. **template.service**：
   - `findMany` 增加 teamId 查询参数：传时 `{ project: { teamId } }`（**去掉 userId 兜底**，防本人无项目模板混进团队组）；无 projectId 的模板永远只归个人页签
   - `getTemplate/update/delete` 鉴权从「只认 creator」改 **ProjectPermissionService.resolve**（团队成员可打开队友创建的团队画布，否则团队页「可见打不开」）
   - `import` 透传 teamId 到 projectService.create
10. **订阅积分写入点改写**（只剩 4 处积分引擎，现金链路已删，见 §7）：
    - payment-success.processor（支付成功发放）
    - grant-credit.processor（周期发放）
    - expire-subscription.processor（过期清零）
    - admin-subscription.service（后台调整）
    - 每处伴随的 `creditTransaction.create` 同步改写 `teamCreditTransaction.create`（type 用扩充值；amount/balanceAfter 以事务内实时 TeamBalance 为准）
    - 事务内先 `getDefaultTeam(userId)` 再写 TeamBalance
11. **删除现金余额买订阅死链路**：subscription.service 的 `subscribe()`/`upgrade()`（读 UserBalance.balance 扣款，[:121-124](../../../apps/api/src/modules/subscription/subscription.service.ts:121)）、subscription.controller 的 `POST /subscribe` `/upgrade`、前端 subscriptionApi.subscribe/upgrade 与 useSubscription hook 暴露（已核实无组件调用）
12. **`GET /api/credits/balance`**：换源 `getDefaultTeam(userId)` 的 TeamBalance，返回 `{credits, subscriptionCredits, total}`；订阅有效期不再来自 balance（由 /subscription/me 提供，见 §7）
13. **validation 修复**：`validateAll(nodes, userId)` → `validateAll(nodes, teamId, userId)`，余额读 TeamBalance（credits+subscriptionCredits 口径）；quota 以 consume 为准不预校验
14. **User 级废弃删除**：credit.service 的 UserBalance CRUD、recharge 模块 User 级全链路（见 §7 删除清单）

### 4c. 异步媒体归属收敛（必须在联调前完成）

15. **7 处 getOwnerTeamId 调用全部改造**（已 grep 核实）：
    - ai-download.processor:99、ai-image-edit.processor:129、lighting.consumer:129、media-process.service:175、stitch.consumer:91、video-trim.processor:102、storage.service:21
    - 原则：作用域内拿得到 project 的（配额校验已查 project.teamId），**一律复用 `project.teamId` 作为 Media/Task 归属**（ai-download 直接复用已查出的 quotaTeamId），删除按 userId 反推
    - 仅「无项目的素材直传」presignUpload 允许回落，回落判据 = isDefault 默认团队
16. **MaterialFolder/LightingTask/VideoTrimTask/VideoSeparateTask** 的创建/查询按 teamId 隔离

### 判据替换波及面（已核实）

- canvas.service:28 / template.service:54-60：固定默认团队（修复挂错团队 bug）
- 开发库已加入多团队的测试用户「我的画布」可能变少——开发期可接受

## 5. 前端变更 — /works（Phase 3）

- WorkspaceToolbar 激活「团队项目」页签（移除 disabled）
- **团队页签按团队分组平铺**：区分「我创建的/我加入的」区块；建议抽 `useTeamWorkspace(teamId)` hook + 每团队一个 `<TeamSection>` 实例（各组文件夹/搜索/新建天然隔离）；每组独立新建入口归属该组团队
- 个人页签维持现状语义（默认团队）
- `useWorkspaceData` 重构：`scope: 'personal' | 'team'` + `teamId?`；canvasApi/folderApi/templateApi 加可选 teamId
- URL query `?tab=personal|team` 持久化页签；平铺模式不引入 teamId 参数
- **`teamDisplayName(t)`** 统一函数（TeamSwitcher/TeamPage/works 分组/邀请链接复用），默认团队显示「个人项目」
- 团队页签顶部「新建文件夹」归属规则：属当前展开组（无展开则禁用，引导组内新建）
- **UI 优化登记（暂不实现）**：团队数 > 3 时每组默认折叠/展开

## 6. 前端变更 — TeamSwitcher 与 /team（Phase 4）

### TeamSwitcher（Navbar）

- 只有默认团队：**整个隐藏**
- 有真实团队：显示当前团队名；列表 =「个人项目」（固定第一）+ 真实团队；切换仅决定 /team 上下文（localStorage.currentTeamId + reload 保留），不联动 works
- 「新建团队」入口移除（迁移至 /team）

### /team 页面

- 顶部「新建团队」按钮（复用 `POST /api/team/create`），创建后自动选中新团队
- 只有默认团队：空状态引导「创建你的第一个团队」，不渲染默认团队管理面板
- 切到「个人项目」：**精简面板** = 积分余额 + 个人订阅状态（getMyTeams 默认团队行装 UserSubscription）+ 充值/订阅跳转（→ /settings/credits、/settings/membership）；`refreshAll` **不再拉** listJoinRequests/listTeamPlans/getTeamLimits；隐藏邀请成员、邀请链接、解散、转让、重命名；成员 tab 只显示自己且无操作按钮

## 7. 订阅充值账本架构（Phase 5）

### 最终账本架构

| 链路 | 页面 | 订单/订阅实体 | 账本 |
| --- | --- | --- | --- |
| 个人订阅 | /settings/membership | UserSubscription / SubscriptionOrder（不动） | 4 处积分写入点 → 默认团队 TeamBalance |
| 个人充值 | /settings/credits | 复用 TeamRechargeOrder（teamId=默认团队） | 默认团队 TeamBalance.credits |
| 团队订阅 | /team（已有） | TeamSubscription | 各自团队 TeamBalance |
| 团队充值 | /team（已有） | TeamRechargeOrder | 各自团队 TeamBalance.credits |

全系统账本收敛为 **TeamBalance 唯一**。六禁保证默认团队只有个人订阅引擎写入、普通团队只有团队引擎写入——无并发写同一账本。

### 删除的现金链路（P0-1）

- 后端：subscription.service.subscribe/upgrade、controller POST /subscribe /upgrade、OrderService.createOrder（确认仅此处用后删）
- 前端：subscriptionApi.subscribe/upgrade、useSubscription hook 中对应暴露
- 性质变更：原 §清单中 subscription.service:162/254/268/302 从「改写」变为「随方法删除」；真正改写的只剩 payment-success / grant-credit / expire / admin 四处积分引擎

### 改写清单（积分发放/清零/调整，含伴随流水）

| 文件 | 写入点 | 处理 |
| --- | --- | --- |
| payment-success.processor.ts:117,137（+ :125 流水） | 发放 | → 默认团队 TeamBalance + TeamCreditTransaction |
| grant-credit.processor.ts:44（+ :49 流水） | 周期发放 | 同上 |
| expire-subscription.processor.ts:38（+ :43 流水） | 过期清零 | 同上；**amount 以事务内实时 TeamBalance 为准**（consumedCredits 不再回写，推算必失真） |
| admin-subscription.service.ts:47,67,70,81,84（+ :51,74,90 流水） | 后台调整 | 同上（type 用新增 admin_grant/admin_clear） |

### recharge 模块部分废弃（不能整体删除）

`POST /api/recharge/notify/wechat`（recharge.controller:127）是全系统唯一微信回调路由；handleCallback 按单号前缀分发（SUB→订阅 :235、TEAM→团队 :257），nonce 去重/验签在统一入口。

- **删除**：RechargeOrder 模型与 User 级充值链路——controller 5 个 User 端点（:35-125）、handleCallback User 分支（:266-347 + completeOrderInTransaction，删后保留「未知单号返 FAIL」兜底）、active-query.processor User 补偿、close-expired-order.processor、daily-scan.processor、recharge-scheduler.service、throttle-user.guard、User 级 metrics、generateRechargeOrderNo(RCH)、UserBalanceTransaction 写入
- **保留**：wechat-payment.provider、payment.provider.interface、统一回调路由（**notify 免鉴权现状不破坏**）、订阅/团队回调分支
- 删完全局 grep `rechargeOrder|userBalanceTransaction|userBalance|RechargeOrder`（含 module/queue/scheduler 注册）确认无残留

### credits 页（/settings/credits）

现状是「已下线 + 引导跳团队」（:137-141）。改造：

- **重新启用**档位充值区块，改调团队充值 API（teamId 经 `GET /api/team/default`）
- 删「账户余额（元）」卡（:124-134）；订单记录从 User RechargeOrder 换默认团队 TeamRechargeOrder/TeamCreditTransaction 流水
- MembershipPage 顶部「账户余额 ¥」同步删

### 顶栏积分显示

- 非画布页：个人积分（默认团队 TeamBalance，经 /api/credits/balance）
- 团队画布内：**当前团队积分**（复用 execution.gateway 已推的 credits 数据）
- 订阅有效期：由并行拉取的 /subscription/me（status=active 且 currentPeriodEnd>now）提供；creditsStore:27-37 小幅改造
- creditsDropdown/CreditsDropdown/CanvasTopBar 适配（删除 balance 现金字段依赖）

## 8. 隐藏 bug 修复清单（本次顺手修复）

| Bug | 现状 | 修复 |
| --- | --- | --- |
| ensureDefaultTeam 判据错误 | 「任意 TeamMember 取最早」 | `ownerId + isDefault` 精确判据 + partial unique index |
| getOwnerTeamId 归属错乱 | 7 处异步链路按「最早拥有团队」归属生成物；团队 A 画布生成的素材挂错团队、配额与归属记账对不上 | project.teamId 为唯一权威；直传回落 isDefault；删成员兜底 |
| 执行前校验读错账本 | validation.service:62 读 UserBalance，扣费走 TeamBalance | 改读 project.teamId 的 TeamBalance |
| 校验口径不含订阅积分 | :63 仅比 credits | credits+subscriptionCredits（与 consume 一致，consume:51/71/75 已核实订阅优先扣） |
| 清零流水失真 | expire:45 用 totalCredits-consumedCredits 推算，consumedCredits 不再回写后恒等于总额 | 流水以事务内实时 TeamBalance 为准 |

## 9. 实施顺序

1. **Phase 1 — 数据模型**：schema 变更 + migration（含手写 partial unique index）+ 完整删表/枚举（无数据成本最低）+ 注册钩子 isDefault
2. **Phase 2a — 判据与六禁**：getDefaultTeam/getOwnerTeamId 统一、六禁、GET /api/team/default(SkipTeamGuard)、getMyTeams isDefault+排序+订阅分叉
3. **Phase 2b — 账本改写与 User 级删除**：canvas/folder/template teamId 化与鉴权、订阅 4 处写入点改写、删现金死链路、删 recharge User 链路、credits/balance 换源、validation 修复
4. **Phase 2c — 异步媒体归属收敛**：7 处 getOwnerTeamId 调用改造、MaterialFolder/Task 隔离（联调前必须完成）
5. **Phase 3 — 前端 works**：双页签 + TeamSection 分组平铺 + scope 重构 + teamDisplayName
6. **Phase 4 — 前端 team**：新建按钮 + 空状态 + 精简面板 + TeamSwitcher 改造
7. **Phase 5 — 前端充值订阅**：membership/credits 切换链路 + 顶栏积分跟随画布
8. **Phase 6 — 联调验收**

## 10. 成功标准（验收清单）

- 新用户注册后默认团队 isDefault=true，UI 显示「个人项目」；**并发补建仅产生一条默认团队**（唯一索引验证）
- 默认团队六禁：API 拒绝加成员/申请/审批/解散/转让/团队套餐订阅/单画布协作者，UI 无入口；**积分充值放行**
- `/works` 个人页签只显示默认团队画布/文件夹；团队页签按团队分组，各组数据完全隔离；每组新建归属该组团队
- 团队成员可打开队友创建的团队画布/模板（ProjectPermissionService 鉴权）
- 只有默认团队时：/team 空状态；TeamSwitcher 隐藏
- /team 有「新建团队」入口；「个人项目」精简面板不拉团队接口
- 个人订阅发放/清零/升级入默认团队 TeamBalance；顶栏个人积分同一账本；**团队画布内顶栏显示该团队积分**
- 个人充值订单进 TeamRechargeOrder（默认团队），余额即时到账；档位 1 元=10 积分
- 团队订阅/充值行为不变，扣各自团队积分
- **Media/Task/MaterialFolder 归属与配额记账同团队**（团队 A 画布生成的素材在团队 A 可见）
- 执行前校验读项目所属团队 TeamBalance，口径与扣费一致
- User 级模型/代码全删，微信回调路由正常服务订阅/团队订单
- 团队流水含 upgrade_clear/admin_grant/admin_clear 语义，amount/balanceAfter 反映真实账本
- TypeScript strict 无报错；现有测试通过 + 新增关键路径测试
