# 默认团队改造为「个人项目」体系 — 设计文档

日期：2026-08-29
状态：已与用户逐节确认（两批设计 + 补充细节评审）

## 1. 背景与目标

一期团队化时，历史「个人项目」已归入各用户注册时自动创建的默认团队（`{name}的团队`）。当前所有团队在 UI/逻辑上无差别，用户注册后看到「XX 的团队」，误以为平台不支持个人使用。

**目标**：将默认团队在产品语义上完全模拟为历史「个人项目」：

- 数据层仍是 Team（复用团队积分/订阅/扣费体系），标记 `isDefault=true`
- 默认团队仅用户一人：禁加成员、禁申请加入、禁解散、禁转让
- 默认团队与新建团队的积分/订阅完全独立
- `/works` 分「个人」「团队项目」双页签，团队项目按团队分组平铺
- 个人充值走 `/settings/membership`（订阅）+ `/settings/credits`（充值），操作默认团队账本
- 开发测试阶段无用户数据：不做向后兼容/存量数据防护，User 级账本彻底废弃

## 2. 核心决策总表

| 决策点 | 结论 |
| --- | --- |
| 默认团队标记 | `Team.isDefault Boolean @default(false)` |
| 文件夹隔离 | `Folder.teamId` 必填 + FK(onDelete: Cascade) + index |
| 个人订阅实体 | UserSubscription/SubscriptionOrder 挂 userId 不动（默认团队与用户一一对应，语义等价） |
| 个人订阅账本 | 发放/清零/升级/proration/后台调整的**全部写入点**改写默认团队 TeamBalance |
| 个人充值 | 复用团队充值链路：TeamRechargeOrder（teamId=默认团队）→ TeamBalance.credits |
| 团队充值/订阅 | TeamSubscription/TeamRechargeOrder/TeamPage 现有功能不动（已核实前后端完整） |
| 套餐配置 | 两套独立：SubscriptionPlan（个人，membership 页）/ TeamPlan（团队，TeamPage 页） |
| UserBalance | 彻底删除模型 + 所有读写代码 |
| recharge 模块 | **部分废弃**：只删 User 级充值分支；保留微信 provider、统一回调路由、订阅/团队回调分支（详见 §7） |
| 执行前余额校验 | 保留校验，改读**项目所属团队** TeamBalance，口径与 consume 对齐（详见 §8） |
| /works | 双页签；团队项目按团队分组平铺，每组独立新建入口 |
| /team | 只有默认团队时空状态引导；有真实团队后「个人项目」显示精简面板 |
| TeamSwitcher | 只有默认团队时整体隐藏；有团队时列表 =「个人项目」+ 真实团队，切换仅影响 /team 上下文 |
| 显示名 | 默认团队 DB 名不变（`{name}的团队`），前端显示层统一覆盖为「个人项目」 |

## 3. 数据模型变更（apps/api/prisma/schema.prisma）

| 模型 | 变更 |
| --- | --- |
| `Team` | 新增 `isDefault Boolean @default(false)` |
| `Folder` | 新增 `teamId String` **必填** + FK → Team(onDelete: Cascade) + `@@index([teamId])`（现状仅 userId，[schema.prisma:165](../../../apps/api/prisma/schema.prisma)） |
| `UserBalance` | **删除**模型及关联关系 |
| `CreditTransaction` | **删除**（纯 User 级流水，仅 userId 字段；团队流水走 TeamCreditTransaction） |
| `UserSubscription` / `SubscriptionOrder` / `SubscriptionPlan` | 结构不动（个人订阅引擎+套餐配置保留） |
| `TeamPlan` / `TeamSubscription` / `TeamRechargeOrder` / `TeamBalance` | 不动 |
| `RechargeOrder` | **删除**模型 |

迁移：`prisma migrate dev --name personal_project_refactor`（迁移基线已 squash，禁 db push）。

## 4. 后端服务变更（Phase 2）

1. **注册钩子**（[auth.ts:49-74](../../../apps/api/src/auth/auth.ts)）：建默认团队设 `isDefault: true`；赠送 100 积分逻辑不动（本就写默认团队 TeamBalance）
2. **`getDefaultTeam(userId)`**（team.service）：判据 `ownerId=userId AND isDefault=true`；`ensureDefaultTeam` 补建路径同样设 isDefault。**替换现有「任意 TeamMember 取最早」的错误判据**（修复画布挂错团队的隐藏 bug）
3. **默认团队四禁**（team.service）：`apply()` 拒申请（400）、`approve()` 拒审批、`disbandTeam()` 拒解散、`transferOwnership()` 拒转让
4. **新增 `GET /api/team/default`**：返回 `{id, name, isDefault}`，供前端获取默认团队 id（语义独立、数据量小于 getMyTeams）
5. `getMyTeams()` 返回值增加 `isDefault`；**订阅状态分叉**：默认团队行查 UserSubscription（经 ownerId），普通团队行查 TeamSubscription
6. **canvas/folder/template 服务与控制器**：接收 `teamId` 参数并校验请求者是该团队成员；不传 teamId = 默认团队（正常语义，非兼容分支）
7. **`GET /api/credits/balance`**（[credit.controller.ts](../../../apps/api/src/modules/credit/credit.controller.ts)）：查询目标换 `getDefaultTeam(userId)` 的 TeamBalance；返回 `{credits, subscriptionCredits, total}`（废弃 `balance` 现金字段与 `subscriptionCreditsExpiry`，前端顶栏显示组件适配）
8. 执行前余额校验修复（见 §8）

### ensureDefaultTeam 判据替换的波及面（已核实）

- [canvas.service.ts:28](../../../apps/api/src/modules/canvas/canvas.service.ts)：不传 teamId 时固定挂默认团队（之前可能挂用户加入的任意团队）
- [template.service.ts:54-60](../../../apps/api/src/modules/template/template.service.ts)：`type='my'` 的 OR 条件固定默认团队
- 开发库中已加入多团队的测试用户，「我的画布」列表可能变少（之前错误包含其他团队项目）——开发期可接受，不做防护

## 5. 前端变更 — /works（Phase 3）

- WorkspaceToolbar 激活「团队项目」页签（移除 disabled）
- **团队页签按团队分组平铺**（已确认的交互模式）：区分「我创建的/我加入的」区块，每组内显示该团队的文件夹树+画布，每组独立「新建文件夹/新建画布」入口，归属该组团队；组间数据完全隔离（Folder.teamId / CanvasProject.teamId）
- 个人页签维持现状语义（默认团队），内部走修正后的 getDefaultTeam
- `useWorkspaceData` 重构：`scope: 'personal' | 'team'` + `teamId?`
- canvasApi/folderApi/templateApi 增加可选 teamId 参数
- URL query `?tab=personal|team` 持久化页签状态（刷新/分享可定位）；平铺模式无团队选择状态，不引入 teamId 参数
- **UI 优化登记（暂不实现）**：团队数 > 3 时每组默认折叠/展开，或超阈值改二级导航

## 6. 前端变更 — TeamSwitcher 与 /team（Phase 4）

### TeamSwitcher（Navbar）

- 用户只有默认团队：**整个隐藏**（个人项目无感知）
- 有真实团队：显示当前团队名；列表 =「个人项目」+ 各真实团队；切换仅决定 /team 页面上下文（localStorage.currentTeamId + reload 行为保留），不联动 works
- 「新建团队」入口从 TeamSwitcher 移除（迁移至 /team）

### /team 页面

- 顶部「新建团队」按钮（复用 `POST /api/team/create`），创建后自动选中新团队
- 只有默认团队：空状态引导「创建你的第一个团队」，不渲染任何默认团队管理面板
- 有真实团队后切到「个人项目」：**精简面板** = 积分余额 + 订阅状态 + 充值/订阅跳转按钮（→ /settings/credits、/settings/membership）；隐藏邀请成员、加入申请、解散、转让、重命名；成员 tab 只显示自己且无操作按钮

## 7. 订阅充值账本架构（Phase 5）

### 最终账本架构

| 链路 | 页面 | 订单/订阅实体 | 账本 |
| --- | --- | --- | --- |
| 个人订阅 | /settings/membership | UserSubscription / SubscriptionOrder（不动） | 全部写入点 → 默认团队 TeamBalance |
| 个人充值 | /settings/credits | **复用** TeamRechargeOrder（teamId=默认团队） | 默认团队 TeamBalance.credits |
| 团队订阅 | /team（TeamPage，已有） | TeamSubscription | 各自团队 TeamBalance |
| 团队充值 | /team（TeamPage，已有） | TeamRechargeOrder | 各自团队 TeamBalance.credits |

全系统账本收敛为 **TeamBalance 唯一**。默认团队只有个人订阅引擎写入（TeamPage 对默认团队隐藏订阅功能），普通团队只有团队引擎写入——两套引擎不会并发写同一账本。

### 个人订阅写入点替换清单（已全局 grep 核实）

| 文件 | 写入点 | 处理 |
| --- | --- | --- |
| payment-success.processor.ts:117,137 | 支付成功发放 | → 默认团队 TeamBalance |
| grant-credit.processor.ts:44 | 周期发放 | → 默认团队 TeamBalance |
| expire-subscription.processor.ts:38 | 过期清零 | → 默认团队 TeamBalance |
| subscription.service.ts:162,254,268,302 | 升级 proration/清零 | → 默认团队 TeamBalance |
| admin-subscription.service.ts:47,67,70,81,84 | 后台手工调整 | → 默认团队 TeamBalance |

事务内先 `getDefaultTeam(userId)` 再写 TeamBalance。

### recharge 模块部分废弃（关键：不能整体删除）

recharge 模块是**支付基础设施**：`POST /api/recharge/notify/wechat`（[recharge.controller.ts:127](../../../apps/api/src/modules/recharge/recharge.controller.ts:127)）是全系统唯一微信回调路由，handleCallback 是回调分发器（:235 订阅订单 → subOrderService；:257 团队订单 → teamRechargeService）；wechat-payment.provider 被订阅/团队下单共用。

- **删除**：RechargeOrder 模型、User 级充值下单/查询/handleCallback 中 User 分支、active-query.processor 中 User 级订单补偿、credit.service 中 UserBalance CRUD（保留 balance 端点，见 §4.7）
- **保留**：wechat-payment.provider、payment.provider.interface、统一回调路由、订阅/团队回调分支
- 删除后全局 grep `recharge`/`RechargeOrder`/`userBalance` 确认无残留引用（含 app.module 注册、BullMQ queue）

### credits 页（/settings/credits）

- 充值入口改调团队充值 API（teamId=默认团队，经 `GET /api/team/default` 获取）
- 余额展示默认团队 TeamBalance；流水展示 TeamCreditTransaction（默认团队）
- 团队充值支付闭环（建单→扫码→回调入账→过期关闭→主动查询补偿）零新代码复用

## 8. 隐藏 bug 修复清单（本次顺手修复）

| Bug | 现状 | 修复 |
| --- | --- | --- |
| ensureDefaultTeam 判据错误 | 「任意 TeamMember 取最早」，加入他人团队后画布可能挂错团队 | `ownerId + isDefault` 精确判据 |
| 执行前校验读错账本 | [validation.service.ts:62](../../../apps/api/src/modules/execution/validation.service.ts:62) 读 UserBalance，扣费走 TeamBalance | 改读项目所属团队 TeamBalance（**保留预校验**，不删除：避免提交执行后才在异步任务中发现余额不足，UX 倒退） |
| 校验口径不含订阅积分 | :63 仅 `credits < totalCost`，未算 subscriptionCredits | 可用余额口径与 `teamCredit.consume` 对齐（credits + subscriptionCredits，以 consume 实现为准） |

## 9. 实施顺序

1. **Phase 1 — 数据模型**：schema 变更 + migration + 注册钩子 isDefault
2. **Phase 2 — 后端服务**：getDefaultTeam/四禁/GET /api/team/default + canvas/folder/template teamId + 订阅写入点替换 + validation 修复 + credits/balance 换源 + User 级废弃删除
3. **Phase 3 — 前端 works**：双页签 + 分组平铺 + useWorkspaceData scope 重构
4. **Phase 4 — 前端 team**：新建团队按钮 + 空状态 + 精简面板 + TeamSwitcher 改造
5. **Phase 5 — 前端充值订阅**：membership/credits 页切换默认团队链路 + 顶栏积分显示适配
6. **Phase 6 — 联调验收**：端到端验证扣费隔离、数据隔离、权限隔离

## 10. 成功标准（验收清单）

- 新用户注册后默认团队 isDefault=true，UI 显示「个人项目」
- 默认团队：API 层拒绝加成员/申请/审批/解散/转让，UI 层无入口
- `/works` 个人页签只显示默认团队画布/文件夹；团队页签按团队分组，各组数据完全隔离
- 团队页签每组新建的文件夹/画布归属该组团队
- 只有默认团队时：/team 显示空状态；TeamSwitcher 隐藏
- /team 有「新建团队」入口；切到「个人项目」显示精简面板
- 个人订阅（membership 页）发放/清零/升级写入默认团队 TeamBalance；顶栏积分显示同一账本
- 个人充值（credits 页）订单进 TeamRechargeOrder（默认团队），余额即时到账
- 团队订阅/充值（TeamPage）行为不变，扣各自团队积分
- 默认团队画布执行 AI 扣默认团队积分；团队画布扣该团队积分
- 执行前校验读项目所属团队 TeamBalance，口径与扣费一致
- UserBalance/RechargeOrder 模型及全部读写代码删除，微信回调路由正常服务订阅/团队订单
- TypeScript strict 无报错；现有测试通过 + 新增关键路径测试
