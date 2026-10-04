<!-- doc-status: historical | verified_at: n/a -->
# 默认团队改造为「个人项目」体系 — 设计文档

日期：2026-08-29（v3.1，收敛四轮深度评审：v2 评审 4P0+8P1+8P2、v2 审核 6P0+8P1、v3 审核 2P0+5P1+5P2，全部代码级核实属实）
状态：待用户批准 v3.1

## 1. 背景与目标

一期团队化时，历史「个人项目」已归入各用户注册时自动创建的默认团队（`{name}的团队`）。当前所有团队在 UI/逻辑上无差别，用户注册后看到「XX 的团队」，误以为平台不支持个人使用。

**目标**：将默认团队在产品语义上完全模拟为历史「个人项目」：

- 数据层仍是 Team（复用团队积分/订阅/扣费体系），标记 `isDefault=true`，数据库级每用户唯一
- 默认团队仅用户一人：六禁（拒申请/拒审批/拒解散/拒转让/拒团队套餐订阅/拒单画布协作者分享），积分充值放行
- 默认团队与新建团队的积分/订阅完全独立
- `/works` 分「个人」「团队项目」双页签，团队项目按团队分组平铺
- 团队订阅/充值独立页面 `/team/:id/billing`（复用 MembershipPage 组件风格）
- 资源团队化全覆盖：Media/MaterialFolder/Task/Storyboard 读写下线 creator-only，以团队为权限边界
- 异步生成物归属收敛到项目团队
- 开发测试阶段无用户数据：不做向后兼容/存量数据防护，User 级账本彻底废弃

## 2. 核心决策总表

| 决策点 | 结论 |
| --- | --- |
| 默认团队标记 | `Team.isDefault Boolean @default(false)` + partial unique index（手写 SQL） |
| 默认团队唯一性 | `CREATE UNIQUE INDEX team_owner_default_unique ON "Team"("ownerId") WHERE "isDefault" = true` + `CREATE INDEX team_owner_id_idx ON "Team"("ownerId")` |
| 统一 Bootstrap | 邮箱/手机/微信三条注册路径 + ensureDefaultTeam 全部收敛到单一低依赖 bootstrap 函数（见 §4.1） |
| 默认团队六禁 | 服务端集中不变量 `assertNotPersonalTeam(team, action)`（见 §4.2） |
| 文件夹隔离 | Folder/MaterialFolder `teamId` 必填 + **双 partial unique index**（root 与 parent 分开，PostgreSQL NULL 不相等） |
| Template 团队列 | **Template 加 `teamId` 必填 + FK + index**（nextUntitledName 现按 template.userId 取「画布 N」最大值 :53-54，无 teamId 列则团队编号无法实现且处处 join project；无 projectId 模板也可按团队归集） |
| 个人订阅实体 | UserSubscription/SubscriptionOrder 挂 userId 不动 + **active 唯一约束**（partial unique index） |
| 现金余额买订阅 | 删除死链路（前端无调用方已核实；TeamBalance 无现金字段，改写不成立） |
| 个人订阅账本 | 积分发放/清零/后台调整 4 处写入点改写默认团队 TeamBalance，**事务内 FOR UPDATE 锁行** |
| 个人充值 | 复用 TeamRechargeOrder（teamId=默认团队，kind=credits）→ TeamBalance.credits（1 元=10 积分已核实一致） |
| 充值订单列表 | **新增 `GET /api/team/:id/recharge/orders?kind=credits`**（现状无 GET 列表端点，CreditsPage 依赖） |
| 团队订阅/充值页 | **独立页面 `/team/:id/billing`**（复用 MembershipPage 套餐卡/二维码/订单记录组件，数据源 TeamPlan/TeamSubscription/TeamRechargeOrder）；TeamPage 积分 tab 保留余额/流水 |
| TeamSubscription 唯一约束 | 删字段级 `@unique` 改 partial unique `WHERE status='active'`；**回调事务内 create 前先 `updateMany({where:{teamId,status:'active'},data:{status:'expired'}})` 关闭旧行**（对齐个人版 payment-success upgrade「先改旧再建新」；partial unique 是最后防线不能替代此步——已核实现回调 :92 直接 create，到期后 expire-job 未跑的窗口内续费会付了钱不开通） |
| 团队流水枚举 | TeamCreditTransactionType 新增 `upgrade_clear`/`admin_grant`/`admin_clear`；**删除 `admin_adjust`**（已核实全部 .ts 代码零引用，仅 schema 定义，避免四个近义枚举并存） |
| 流水口径 | balanceAfter 双池分离：regular→TeamBalance.credits、subscription→TeamBalance.subscriptionCredits；清零 amount=实时剩余，禁 consumedCredits 推算 |
| User 级账本 | 彻底删除（UserBalance/CreditTransaction/UserBalanceTransaction/RechargeOrder + 4 枚举），CreditType 保留（TeamCreditTransaction 共用） |
| recharge 模块 | 部分废弃：删 User 级全链路（含 scheduler/daily-scan/close-expired/throttle-guard）；保留微信 provider、统一回调路由、订阅/团队分支 |
| 执行前校验 | 保留；`validateAll(nodes, teamId, userId)`，唯一调用点传 `project.teamId`；口径 credits+subscriptionCredits；quota 以 consume 为准 |
| 协作鉴权 | **ProjectPermissionService 为唯一权威**：删 canvas.save 的 creator-only 残留；template/media/task/storyboard 读写下线 creator-only |
| 资源读取鉴权 | Media：operatorUserId 仅记录操作者，访问按 media.teamId+TeamMember；MaterialFolder/Task 同理；storyboard 补 assertEditor |
| 异步媒体归属 | 7 处 getOwnerTeamId 收敛：project.teamId 唯一权威；直传回落 isDefault 默认团队；删成员兜底 |
| 上传归属 | 前端 CanvasWorkspaceContext 提供 projectId/teamId；后端 **三级回落**：① 有 projectId → 解析 project.teamId 并校验 editor（「不信任前端」仅指此级必须后端解析）；② 无 projectId 但带 teamId → 保留现有 dto.teamId 通道 + assertMember（storage.service:19-21 已存在，画布外向团队素材库上传依赖它，不可删）；③ 都无 → 默认团队 |
| 新建团队 | `POST /api/projects` 与 `POST /api/canvases` 均接收 teamId 并校验成员资格；不传=默认团队；createTeam 事务内建团队默认 MaterialFolder |
| 顶栏积分 | scope-aware store（personal/team）；画布内显当前团队（初始经 project.teamId 拉 /team/:id/balance，不只等 Socket）；Socket 事件统一完整结构；充值跳转分流（个人→/settings/credits，团队→/team/:id/billing） |
| /works | 双页签；团队项目按团队分组平铺（TeamSection 组件化）；`?tab=` 持久化 |
| /team | 只有默认团队时空状态；「个人项目」精简面板；顶部新建团队按钮 |
| TeamSwitcher | 只有默认团队时整体隐藏；有团队时列表=「个人项目」（固定第一）+真实团队 |
| 显示名 | `teamDisplayName(t) => t.isDefault ? '个人项目' : t.name` 全 UI 复用 |

## 3. 数据模型变更（apps/api/prisma/schema.prisma）

### 模型变更

| 模型 | 变更 |
| --- | --- |
| `Team` | + `isDefault Boolean @default(false)` + 反向关系：`folders/materialFolders/lightingTasks/videoTrimTasks/videoSeparateTasks`（Prisma 要求双向） |
| `Folder` | + `teamId String` 必填 + FK(Cascade) + `@@index([teamId])`；userId 保留语义=创建人 |
| `MaterialFolder` | 同上（现状仅 userId） |
| `Template` | + `teamId String` 必填 + FK + `@@index([teamId])`（nextUntitledName 团队维度编号、无 projectId 模板团队归集的落点） |
| `LightingTask`/`VideoTrimTask`/`VideoSeparateTask` | 各 + `teamId` + FK + index |
| `CanvasProject` | teamId 已存在必填，不变更 |
| `UserBalance`/`CreditTransaction`/`UserBalanceTransaction`/`RechargeOrder` | **删除** |
| enum | 删 `RechargeOrderStatus`/`BalanceTxType`/`CreditTransactionType`/`CreditReferenceType`（实施时 grep 确认仅删除模型引用）；**保留 `CreditType`**；`TeamCreditTransactionType` += upgrade_clear/admin_grant/admin_clear |
| `UserSubscription` | 结构不动 |
| `TeamSubscription` | **删 `teamId @unique` 字段级约束** |
| Team 其余模型 | 不动 |

### 手写 SQL 索引（migration 内补充，Prisma schema 表达不了）

```sql
-- 默认团队每用户唯一
CREATE UNIQUE INDEX team_owner_default_unique ON "Team"("ownerId") WHERE "isDefault" = true;
CREATE INDEX team_owner_id_idx ON "Team"("ownerId");

-- Folder 同级重名（root 与 parent 分开：PostgreSQL NULL 互不相等）
CREATE UNIQUE INDEX folder_team_root_name_unique ON "Folder"("teamId", "name") WHERE "parentId" IS NULL;
CREATE UNIQUE INDEX folder_team_parent_name_unique ON "Folder"("teamId", "parentId", "name") WHERE "parentId" IS NOT NULL;
-- MaterialFolder 同样处理

-- 个人订阅仅一个 active（防并发支付/重复回调/升级双 active 重复清账本）
CREATE UNIQUE INDEX user_subscription_one_active ON "UserSubscription"("userId") WHERE status = 'active';

-- 团队订阅 active 唯一（替代删除的字段级 @unique，expired 行可保留）
CREATE UNIQUE INDEX team_subscription_one_active ON "TeamSubscription"("teamId") WHERE status = 'active';
```

### 复合索引（团队化查询路径）

- `Media(teamId,folderId,deletedAt,createdAt)`、`Media(teamId,isFavorite,deletedAt)`、`Media(teamId,type,mimeType)`
- `MaterialFolder(teamId,parentId,deletedAt,sortOrder)`
- 三类 Task：`(teamId,status,createdAt)`、`(teamId,nodeId)`

迁移：`prisma migrate dev --name personal_project_refactor`。

## 4. 后端服务变更

### 4.1 统一 Bootstrap（P0-1）

现状四条用户创建/补偿路径不全建团：auth.ts 钩子建团（:50 注释自带「与 ensureDefaultTeam 同逻辑」两份重复）、auth.controller.ts:55,97 只补素材文件夹、**wechat.service.ts:58 直接 prisma.user.create + :70 只补素材文件夹（微信注册用户无默认团队）**。

收敛为单一低依赖 bootstrap 函数（事务内）：

1. 判据固定 `ownerId=userId AND isDefault=true`，与用户是否加入其他团队无关
2. 一个事务创建：Team(isDefault=true) + TeamMember(OWNER) + TeamBalance(credits=100) + register_grant 流水 + 默认 MaterialFolder
3. 并发创建捕获唯一索引冲突后**重查返回既有行**，不再建
4. 邮箱、手机验证码、微信三条注册路径 + `ensureDefaultTeam` 全部调用同一函数；auth.ts DI 外直写问题用无 prisma.service 依赖的纯函数（接收 tx/client 参数）解决
5. **点名删除 4 处散落的默认 MaterialFolder 创建**（bootstrap 事务内已建，双轨必乱）：auth.controller.ts:55、:97，auth.ts:100，wechat.service.ts:70

### 4.2 六禁集中不变量（P1-4）

新增 `assertNotPersonalTeam(team, action)` 统一拦截，覆盖：`apply`、`approve/reject`、`disband`、`transfer`、**rename、changeRole、removeMember、quota 调整**、TeamSubscription 创建与回调、ProjectMember 新增/改角色、邀请链接 JoinPage。

**放行**：`kind=credits` 的 TeamRechargeOrder（个人充值）；`kind=subscription` 必须拒绝。

### 4.3 判据与查询

- `getDefaultTeam(userId)`：`ownerId+isDefault`；`getOwnerTeamId`（team.util）同判据，**删成员兜底**
- `GET /api/team/default`（**@SkipTeamGuard()**）：`{id, name, isDefault}`
- `getMyTeams()`：+isDefault、**+isOwner（team.ownerId===userId）**——「我创建的/我加入的」分组依据必须用 ownerId 而非 role（转让后 role=OWNER 但非创建者，按 role 分组会错）、默认团队固定排第一、订阅状态分叉（默认团队行查 UserSubscription，普通团队查 TeamSubscription）
- `GET /api/team/default` 显式加 `@SkipTeamGuard()` + 注释（team.guard 对无 `:id` 路由本就放行，此处为风格统一与防御未来类级守卫变化）

### 4.4 项目/画布/文件夹/模板团队化（P0-3）

1. **canvas.service.save**：删除 :66-68 creator-only 判断（`if project.userId !== null && project.userId !== userId` throw），**ProjectPermissionService.assertEditor 为唯一权威**——否则团队成员 B 无法保存团队画布
2. **project.service.getProjectFolder**：`where {id, userId}` → teamId 维度；project.controller 对应端点补团队权限校验
3. **POST /api/projects**：接收 teamId 并校验成员资格；不传=默认团队（现状永远 ensureDefaultTeam）
4. **POST /api/canvases**：同上；folderId 校验 `{id, teamId}`；nextUntitledName 与 advisory lock 从 userId 维度改 teamId 维度
5. **folder.service**（works 文件夹）：scope 全部 userId→teamId；create 校验 parent.teamId===teamId；**删除父文件夹时先消解同名**（parentId onDelete:SetNull 会把子级升入 root 域，可能撞 root 同名唯一索引）
6. **template.service**：teamId 查询参数（`{project:{teamId}}`，去 userId 兜底；无 projectId 模板只归个人页签）；getTemplate/update/delete 改 ProjectPermissionService.resolve；import 透传 teamId 到 projectService.create

### 4.5 团队资源读取鉴权（P0-2，creator-only 全下线）

已核实 creator-only 路径（团队 A 生成的资源队友 B 看不到/打不开/不能操作）：

| 模块 | 改造 |
| --- | --- |
| material-library/material.service | 列表/移动/收藏/删除/批量操作 where 全部 userId→teamId |
| material-library/folder.service | 素材文件夹 15+ 处 userId→teamId |
| media.service.getMediaUrl(fileId,userId) | 只认创建人 → 按 media.teamId+TeamMember 校验 |
| storage.service.confirmUpload | :62-63 `findFirst({id,userId})` creator-only → 团队维度校验 |
| project.service.cleanDrafts | :117-123 `deleteMany where {userId}` → teamId 维度 |
| video-trim.service / video-separate.service | validateFileOwnership 团队化；任务状态查询校验用户属 task.teamId；幂等维度 userId+nodeId → **teamId+nodeId+params** |
| lighting.service | getTask 同上团队鉴权 |
| storyboard.controller | stitch 提交前 assertEditor(projectId,userId)；/status 至少 resolve() 非 null |

Media 创建人字段仅作 operatorUserId（审计），权限一律团队维度。media.service:16 缓存 key 含 userId → 改 teamId 维度（同团队每人一份缓存属冗余）。

### 4.6 订阅账本改写与充值接口

1. **删除现金买订阅死链路**：subscription.service.subscribe/upgrade（读 UserBalance.balance 扣款）、controller POST /subscribe /upgrade、前端 api/hook 暴露（无组件调用已核实）
2. **4 处积分写入点改写**（每处伴随 creditTransaction.create → teamCreditTransaction.create）：
   - payment-success.processor:117,137（+:125）/ grant-credit.processor:44（+:49）/ expire-subscription.processor:38（+:43）/ admin-subscription.service:47,67,70,81,84（+:51,74,90）
   - 事务内 `getDefaultTeam(userId)` → **锁定 TeamBalance 行（SELECT...FOR UPDATE）** → 读实时余额 → 写账本+流水（amount/balanceAfter 实时值；regular 池 balanceAfter=credits、subscription 池=subscriptionCredits）→ 更新订阅/订单状态（同一事务，回调幂等由 active 唯一索引+订单状态机双保险）
3. **新增 `GET /api/team/:id/recharge/orders?kind=credits`**：分页返回订单列表（CreditsPage 订单记录依赖；现状团队侧无 GET 列表端点）
4. `GET /api/credits/balance`：换源默认团队 TeamBalance，返回 `{credits, subscriptionCredits, total}`
5. **TeamSubscription 二次订阅修复**：删字段级 @unique；**回调事务内 create 前先关闭旧 active 行**（`updateMany({where:{teamId,status:'active'},data:{status:'expired'}})`）——已核实现回调 :92 直接 create，且下单拒单判断带 `currentPeriodEnd>now`，到期后 expire-job 未跑窗口内续费：只加 partial unique 会撞 P2002 = 付了钱回调失败不开通
6. **两套订阅/清零链路边界（最易接反处，实施对照）**：

| | 默认团队（=个人项目） | 普通团队 |
| --- | --- | --- |
| 订阅实体 | UserSubscription（挂 userId，SubscriptionPlan） | TeamSubscription（TeamPlan） |
| 下单链路 | /subscription/orders 微信 | /team/:id/subscription/orders（kind=subscription） |
| 积分落账 | 默认团队 TeamBalance 双池 | 该团队 TeamBalance 双池 |
| 到期清零 job | 迁移后的个人 expire-subscription.processor | team-subscription-expire（已正确：实时 remaining + FOR UPDATE） |
| TeamSubscription 允许性 | 永不允许——六禁须**同时挡 createSubscriptionOrder 与 completeSubscriptionCallback 两个入口**（仅挡创建不够，回调要兜底） | 允许 |

   个人 expire job 只清默认团队、团队 expire job 绝不清默认团队，两条线不得串。

### 4.7 上传归属（P0-5）

前端 16 处 presignUpload 调用均不传 teamId（已核实）。改造：

- 后端 presign **三级回落**：① dto.projectId → 解析 project.teamId + 校验 editor（前端传的 teamId 不直接采信）；② dto.teamId（无 projectId）→ 保留现有通道 + assertMember（storage.service:19-21 已有，画布外团队素材库上传依赖）；③ 都无 → isDefault 默认团队
- 7 处 getOwnerTeamId 异步链路（ai-download:99/ai-image-edit:129/lighting:129/media-process:175/stitch:91/video-trim:102/storage:21）：作用域有 project 的一律复用 project.teamId（ai-download 复用已查出的 quotaTeamId）
- `createTeam()` 事务内建团队默认 MaterialFolder（P1-6）

## 5. 前端变更

### 5.1 /works（Phase 7）

- 双页签激活；团队页签按团队分组平铺：`useTeamWorkspace(teamId)` + `<TeamSection>` 组件（各组文件夹/搜索/新建隔离），区分「我创建的/我加入的」
- 每组新建归属该组团队；`?tab=personal|team` 持久化；`teamDisplayName` 统一
- UI 优化登记（暂不实现）：团队数 >3 折叠

### 5.2 /team 与 TeamSwitcher（Phase 8）

- 顶部「新建团队」按钮（复用 POST /api/team/create）；只有默认团队时空状态；「个人项目」精简面板（refreshAll 不拉 joinRequests/teamPlans/limits，只拉 balance+个人订阅）
- TeamSwitcher：只有默认团队隐藏；否则「个人项目」固定第一；新建入口移除

### 5.3 充值订阅页面（Phase 8）

- `/settings/membership`：个人项目订阅（SubscriptionPlan 套餐），删顶部「账户余额 ¥」；修正 :23 按钮文案「团队订阅（前往团队管理）」为个人语义（现状与页面定位冲突）
- `/settings/credits`：重新启用档位充值（改调团队充值 API，teamId 经 GET /api/team/default）；删「账户余额（元）」卡；订单记录换新 GET 端点 + TeamCreditTransaction 流水
- **`/team/:id/billing`（新页面）**：团队订阅+充值，复用 MembershipPage 套餐卡/微信二维码/订单记录组件，数据源 TeamPlan/TeamSubscription/TeamRechargeOrder

### 5.4 上传上下文与顶栏积分（Phase 9）

- CanvasWorkspaceContext：画布顶层提供 projectId/teamId，MaterialLibrary 及各上传组件（FileUpload/materialLibraryStore/mediaUploadUtils/splitUploadService/各媒体节点）presign 一律传 projectId
- 顶栏积分 scope-aware：`{scope:'personal'} | {scope:'team', teamId}`；画布初始进入经 project.teamId 拉 `/team/:id/balance`（不只等 Socket）；Socket 事件统一 `{credits, subscriptionCredits, total, subscription:{status, currentPeriodEnd, planName}}`（现状文本/图片节点口径不一，事件名 plan 阶段核实）；充值跳转分流（个人画布→/settings/credits，团队画布→/team/:id/billing）

## 6. 删除与清理清单（P1-8）

- recharge 模块 User 级链路：controller 5 端点（:35-125）、handleCallback User 分支（:266-347+completeOrderInTransaction，保留「未知单号返 FAIL」兜底、notify 免鉴权不破坏）、active-query User 补偿、close-expired-order、daily-scan、recharge-scheduler、throttle-user.guard、User 级 metrics、RCH 单号生成
- credit.service 的 UserBalance CRUD、CreditModule 对应 providers/imports/exports
- packages/shared/src/types/subscription.types.ts 的 balance/User Recharge 类型、前端 subscriptionApi/useSubscription 死方法、相关 spec
- 管理后台引用 UserBalance 的接口
- 最终 grep 词表：`UserBalance|CreditTransaction|RechargeOrder|UserBalanceTransaction|BalanceTxType|CreditReferenceType|CreditTransactionType|/credits/balance|/recharge/orders|balance.balance`（含 module/queue/scheduler 注册）
- **资源团队化 grep 词表**（Phase 3/4 收尾零残留）：`where: { userId`、`{ id, userId }`、`userId,` 于 material-library/media/storage/project/canvas/template/storyboard 各模块逐一过检，区分「创建人语义保留」与「应改 teamId 的权限语义」

## 7. 隐藏 bug 修复清单（本次顺手修复）

| Bug | 修复 |
| --- | --- |
| ensureDefaultTeam/getOwnerTeamId 判据错误 | ownerId+isDefault + 唯一索引 |
| 微信注册用户无默认团队 | 统一 Bootstrap |
| canvas.save creator-only 拒绝团队成员 | 删残留，ProjectPermissionService 唯一权威 |
| 7 处异步生成物挂错团队 | project.teamId 唯一权威 |
| validation 读错账本+口径缺订阅积分 | 读 project.teamId 的 TeamBalance，total 口径 |
| expire 清零流水失真 | 实时 TeamBalance 值 |
| TeamSubscription 二次订阅撞唯一约束 | partial unique(active) |
| UserSubscription 可能双 active 重复清账本 | partial unique(active) + FOR UPDATE |

## 8. 实施顺序（资源团队化必须早于前端页面）

```
Phase 0  测试基线与资源鉴权清单
Phase 1  Schema + migration + 手写索引 + 反向关系（无数据：migrate reset + migrate dev 干净重建，必填列不写 backfill）
Phase 2  统一 Bootstrap + isDefault 判据 + 六禁集中不变量
Phase 3  Project/Canvas/Folder/Template 团队化（含 save 残留删除）
Phase 4  Media/MaterialFolder/Task/Storyboard 团队化（读取鉴权）
Phase 5  个人订阅 4 写入点迁移默认团队 TeamBalance + 充值订单列表接口
Phase 6  删除 UserBalance/User Recharge 死链路（DoD 门禁：tsc --strict 零报错 + §6 两张 grep 词表零命中，先断引用再删模型）
Phase 7  /works 双页签与团队分组
Phase 8  /team、TeamSwitcher、membership/credits、/team/:id/billing
Phase 9  上传上下文、顶栏积分 scope-aware、Socket 余额口径
Phase 10 联调：负向权限测试、支付回调幂等测试
```

## 9. 成功标准（验收清单）

**默认团队**
- 邮箱/手机/微信注册后都只有一个 isDefault=true 团队；并发补建仅一条
- 六禁全部 API 拒绝且 UI 无入口；kind=credits 充值放行
- /team 空状态与精简面板；TeamSwitcher 隐藏逻辑

**团队隔离与协作**
- A 团队生成的 Media/Task/MaterialFolder 全属 A；B 团队不可猜 ID 访问 A 的项目/素材/任务/媒体 URL
- 团队普通成员可打开/编辑/保存队友创建的画布（save 残留已删）
- 团队成员上传素材团队内可见；presign 传 projectId 后端解析校验

**账本**
- 个人订阅积分/个人充值入默认团队 TeamBalance；团队订阅/充值只入对应团队
- 团队画布执行只扣该团队积分；画布内顶栏显该团队积分
- 微信回调重复投递不重复加积分（active 唯一索引 + 订单状态机）
- **订阅到期但 expire-job 未跑时立即续费：不撞约束且正常开通**（P0-1 回归）
- **个人/团队两条清零链路互不串**（个人 job 只清默认团队、团队 job 绝不清默认团队）
- 团队二次订阅不撞约束；流水 balanceAfter 双池口径正确

**资源与回归**
- **画布外向指定团队上传素材可达**（三级回落第②级）
- **队友 B 走通全部资源点**：getMediaUrl / confirmUpload / cleanDrafts / 保存画布
- 邮箱/手机/微信三注册 + 并发首请求下，默认团队与默认素材文件夹均唯一

**前端**
- /works?tab=team 按「我创建的/我加入的」分组，组间不串团队
- /settings/membership 只操作个人；/team/:id/billing 只操作当前团队
- TypeScript strict 无报错；现有测试通过 + 新增关键路径测试
