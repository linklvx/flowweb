# Spec: 会员订阅功能

## 1. 概述

在现有积分系统之上，添加会员订阅体系。用户分为普通用户和订阅会员，订阅会员按梯度享有不同额度的月积分发放。

**全局约定：** 所有时间字段统一使用 UTC 存储，定时任务按 UTC 自然日执行。

---

## 2. 数据模型

### 2.1 新增表

#### SubscriptionPlan（订阅计划）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | String (cuid) | 主键 |
| name | String | 普通会员 / Pro / Max / Ultra |
| tier | Enum | basic / pro / max / ultra（档位标识，梯度排序由 sort 字段控制） |
| monthlyCredits | Int | 每月发放订阅积分数 |
| priceMonthly | Int | 包月价格（管理后台可配置） |
| priceQuarterly | Int | 包季价格（管理后台可配置） |
| priceAnnually | Int | 包年价格（管理后台可配置） |
| sort | Int @default(0) | 前端展示排序 |
| isActive | Boolean @default(true) | 是否上架 |
| createdAt | DateTime | |
| updatedAt | DateTime | |

**种子数据：** monthlyCredits 固定（普通 9,800 / Pro 19,800 / Max 64,800 / Ultra 131,400），价格由管理后台设置。

**约束：** 修改价格/月积分仅对新购订阅生效，不影响已生效的历史订阅（UserSubscription 冗余存储 totalCredits / totalDays / paidAmount 锁定基准值）。

#### UserSubscription（用户订阅）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | String (cuid) | 主键 |
| userId | String | 关联 User |
| planId | String | 关联 SubscriptionPlan |
| tier | Enum | basic / pro / max / ultra（冗余，便于查询） |
| period | Enum | monthly / quarterly / annually |
| status | Enum | active / expired / upgraded / cancelled |
| paidAmount | Int | 实付积分（升级抵扣计算基数） |
| totalCredits | Int | 本周期总积分权益（订阅时 monthlyCredits × 周期月数，锁定值） |
| totalDays | Int | 本周期总天数（月30/季90/年365，锁定值） |
| consumedCredits | Int @default(0) | 本周期累计已消耗订阅积分（仅业务消费，不含升级清零/到期清零） |
| subscribedAt | DateTime | 订阅开始时间 |
| currentPeriodStart | DateTime | 当前周期开始 |
| currentPeriodEnd | DateTime | 当前周期结束 |
| nextGrantDate | DateTime | 下一次积分发放日期 |
| grantCount | Int @default(1) | 已发放次数（首次订阅创建时已发放第1次=1） |
| autoRenew | Boolean @default(true) | 是否自动续费 |
| cancelledAt | DateTime? | 取消自动续费时间 |
| previousSubId | String? | 上一级订阅 ID（追溯升级链） |
| createdAt | DateTime | |
| updatedAt | DateTime | |

**状态语义：**
| 状态 | 含义 |
|---|---|
| active | 生效中 |
| expired | 自然到期（autoRenew=true，到期未续费） |
| upgraded | 因升级被终止 |
| cancelled | 用户取消自动续费后到期（autoRenew=false, cancelledAt 有值） |

**状态机流转规则：**
```
         ┌─────────────┐
         │   active    │
         └──┬───┬───┬──┘
            │   │   │
     upgrade│   │   │cancel-auto-renew + 到期
            │   │   │
            ▼   │   ▼
    upgraded    │  cancelled
                │
          到期（autoRenew=true）
                │
                ▼
            expired
```
- active → upgraded / expired / cancelled（仅三种合法流转）
- 终态（expired / upgraded / cancelled）不可逆回 active
- 所有状态变更必须校验当前状态，非法流转拒绝执行

**数据库兜底约束：** `@@unique([userId], where: { status: "active" })` — 部分唯一索引，数据库层面强制同一用户仅允许一条生效订阅。

**字段锁定说明：** totalCredits、totalDays、paidAmount 在订阅创建时写入后不再修改，后台修改计划配置不影响已有订阅的升级抵扣计算。

#### SubscriptionOrder（订阅订单）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | String (cuid) | 主键 |
| orderNo | String (唯一) | 业务订单号 |
| userId | String | |
| planId | String | 目标计划 |
| period | Enum | |
| type | Enum | new_purchase / upgrade / renewal（renewal 预留，本期不使用） |
| amount | Int | 实付积分 |
| originalPrice | Int | 目标订阅原价 |
| deductibleAmount | Int @default(0) | 可抵扣积分（new_purchase=0） |
| status | Enum @default(success) | success / failed |
| originalSubscriptionId | String? | 升级场景关联的原订阅 ID |
| pricingSnapshot | Json? | 升级计价参数快照（剩余时长占比、剩余积分占比、折算比例） |
| createdAt | DateTime | |

#### CreditTransaction（积分流水）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | String (cuid) | 主键 |
| userId | String | |
| amount | Int | 变动额度（正=入账，负=出账） |
| type | Enum | subscription_grant / upgrade_clear / expire_clear / admin_clear / admin_grant / consumption / subscription_payment |
| creditType | Enum | regular / subscription |
| referenceId | String? | 关联业务 ID |
| referenceType | Enum | subscription / order / execution / admin |
| balanceAfter | Int | 操作后余额（= creditType 对应账户余额：subscription→subscriptionCredits，regular→credits） |
| createdAt | DateTime | |

**type 语义：**
| 类型 | 说明 |
|---|---|
| subscription_grant | 月度订阅积分发放 |
| upgrade_clear | 升级导致订阅积分清零 |
| expire_clear | 到期导致订阅积分清零 |
| admin_clear | 管理员手动清零 |
| admin_grant | 管理员手动发放 |
| consumption | 业务消费扣减 |
| subscription_payment | 订阅购买扣积分 |

**type ↔ referenceType 对应约束：**
| type | referenceType | 说明 |
|---|---|---|
| subscription_grant / upgrade_clear / expire_clear | subscription | 关联订阅 ID |
| subscription_payment | order | 关联订单 ID |
| consumption | execution | 关联节点执行 ID |
| admin_grant | subscription（发放订阅积分时）/ admin（发放普通积分时） | 订阅积分关联订阅 ID，普通积分关联 AuditLog ID |
| admin_clear | subscription | 关联被清零的订阅 ID |

#### AuditLog（审计日志）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | String (cuid) | 主键 |
| operatorId | String | 操作人 ID |
| operatorName | String | 操作人名称（冗余，管理端列表无需联表查询） |
| targetType | Enum | subscription / subscription_plan / point / order |
| targetId | String | 操作对象 ID |
| action | String | 操作类型（update / create / delete / grant / clear） |
| beforeValue | Json? | 变更前值 |
| afterValue | Json? | 变更后值 |
| remark | String? | 操作备注/原因 |
| createdAt | DateTime | |

### 2.2 修改现有表

#### UserBalance 新增字段
| 字段 | 类型 | 说明 |
|---|---|---|
| subscriptionCredits | Int @default(0) | 订阅积分余额 |
| subscriptionCreditsExpiry | DateTime? | 订阅积分过期时间（= 当前订阅 currentPeriodEnd） |

现有字段保持不变：
- `credits` = 普通积分（永久有效）
- `version` = 乐观锁（已存在，沿用防超扣）

**前端显示：** 积分余额 = credits + subscriptionCredits

**管理员发放订阅积分约束：**
- 仅当用户存在生效中订阅时，允许发放 subscription 类型积分
- 过期时间强制等于当前订阅 currentPeriodEnd，不单独指定
- 无生效订阅时，禁止发放 subscription 类型积分，仅可发放普通积分
- 升级/到期时，订阅积分账户全额清零，不分来源（管理员发放的同步清零）

---

## 3. API 设计

### 3.1 分页规范

所有列表接口统一参数：`page`（默认1）、`pageSize`（默认20）。返回格式：
```json
{ "items": [], "total": 100, "page": 1, "pageSize": 20 }
```

### 3.2 字段一致性约束

`autoRenew` 与 `cancelledAt` 两个字段始终强一致：
- cancel-auto-renew → autoRenew = false, cancelledAt = now
- enable-auto-renew → autoRenew = true, cancelledAt = null
- 禁止任何接口/管理员单独修改其中某一字段

### 3.3 幂等与防重规则

所有写接口基于用户当前订阅状态做前置校验：
- 同一用户同一状态下重复提交 → 直接返回已有结果，不重复执行业务逻辑
- 订单号全局唯一（格式：`SUB + UTC毫秒时间戳 + 6位随机数`），重复创建订单 → 返回已有订单
- 前端增加幂等 token + loading 防重复点击

### 3.4 用户端

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/subscription/plans | 获取所有上架计划（按 sort 排序） |
| GET | /api/subscription/me | 当前用户订阅状态（含计划信息、周期、到期日、积分明细） |
| POST | /api/subscription/subscribe | 新订阅（body: { planId, period }） |
| GET | /api/subscription/upgrade/available | 获取可升级档位+周期列表（前端无需自行过滤高低） |
| GET | /api/subscription/upgrade/preview | 升级预览：?targetPlanId=xxx&targetPeriod=xxx → 返回可抵扣积分、应付差价、升级后到期日、首月积分数 |
| POST | /api/subscription/upgrade | 确认升级（body: { targetPlanId, targetPeriod }） |
| POST | /api/subscription/cancel-auto-renew | 取消自动续费（同时设置 autoRenew=false, cancelledAt=now；当前周期仍有效，到期后自动过期） |
| POST | /api/subscription/enable-auto-renew | 重新开启自动续费（同时设置 autoRenew=true, cancelledAt=null；仅 active 状态生效） |
| GET | /api/subscription/orders | 我的订阅订单列表（分页） |
| GET | /api/credits/balance | 修改返回：增加 subscriptionCredits + subscriptionCreditsExpiry |

### 3.5 管理端（/api/admin/subscription）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /plans | 所有计划（含未上架） |
| POST | /plans | 创建计划 |
| PATCH | /plans/:id | 更新计划。**约束：修改价格/月积分仅对新购生效，不影响已有订阅** |
| DELETE | /plans/:id | 删除计划 |
| GET | /subscriptions | 订阅列表（筛选：userId, planId, status, 分页） |
| PATCH | /subscriptions/:id | 手动修改订阅。规则见 §6.8 |
| GET | /orders | 订单列表（筛选：userId, type, status, 日期范围, 分页） |
| POST | /credits/grant | 手动发放积分（body: { userId, amount, creditType }；subscription 类型过期时间自动 = 当前订阅到期日，regular 类型无过期时间；无生效订阅时禁止发放 subscription） |
| GET | /transactions | 积分流水查询（筛选：userId, type, creditType, 日期范围, 分页） |

---

## 4. 前端页面

### 4.1 会员中心（/settings/membership）

**未订阅状态：**
- 套餐对比表格，每档显示三列（包月/包季/包年价格）、月积分额度
- 点击 CTA → 确认弹窗（显示应扣积分）→ 订阅成功

**已订阅状态：**
- 当前套餐详情卡片（等级标识、到期日、周期、月积分额度）
- 已发放/剩余订阅积分
- 升级入口 → 选择目标档位+周期 → 预览弹窗（调用 preview API 显示差价明细）→ 确认 → 升级成功
- 取消自动续费按钮
- 订单历史列表

### 4.2 Navbar 积分显示

- 积分图标旁增加会员等级徽章（点击跳转 `/settings/membership`）
- 悬停 tooltip：普通积分 / 订阅积分 明细

### 4.3 管理后台（/admin → 新增 Tab）

- **计划管理 Tab**：表格 + 编辑弹窗（名称、梯度、月积分、三档价格、排序、上下架）
- **订阅管理 Tab**：搜索用户 → 查看/修改订阅状态、周期、到期日
- **订单管理 Tab**：订单列表，按时间/用户/类型筛选
- **积分管理 Tab**：手动发放积分弹窗 + 积分流水列表

---

## 5. 业务逻辑

### 5.1 新订阅流程（Prisma 事务包裹）

**价格映射规则：** `monthly → priceMonthly` / `quarterly → priceQuarterly` / `annually → priceAnnually`，作为原价计算与扣费基准。

1. 验证：用户无 active 订阅
2. 验证普通积分 ≥ 对应周期价格
3. 事务执行（严格按序）：
   - 创建 SubscriptionOrder (type=new_purchase, status=success) — 先建单拿到订单 ID
   - 扣减普通积分（乐观锁 version 校验）
   - 写入 CreditTransaction（type=subscription_payment，creditType=regular，amount 为负，referenceId=订单ID）
   - 创建 UserSubscription：
     - subscribedAt = now (UTC)
     - currentPeriodStart = now (UTC)
     - currentPeriodEnd = now + totalDays (UTC)
     - nextGrantDate = now + 30天（00:00:00 UTC）
     - grantCount = 1
     - totalCredits / totalDays / paidAmount 写入锁定值
   - 发放首月订阅积分 → UserBalance.subscriptionCredits += monthlyCredits，expiry = currentPeriodEnd
   - 写入 CreditTransaction (type=subscription_grant，creditType=subscription，amount 为正)
4. 返回订阅状态

### 5.2 升级预览（GET /api/subscription/upgrade/preview）

纯计算，无副作用。返回：

| 字段 | 计算方式 |
|---|---|
| currentTier / currentPeriod | 当前订阅信息 |
| targetTier / targetPeriod | 目标档位信息 |
| originalPrice | 目标订阅原价 |
| deductibleAmount | 原订阅实付金额 × min(剩余时长占比, 剩余积分权益占比)，Math.floor |
| payableAmount | max(0, originalPrice - deductibleAmount) |
| targetEndDate | 升级当日 + 目标周期天数 |
| firstMonthCredits | 目标档位 monthlyCredits |

### 5.3 升级计价公式

```
可抵扣剩余价值 = 原订阅 paidAmount × min(剩余时长占比, 剩余积分权益占比)
剩余时长占比 = (currentPeriodEnd - now) / totalDays
剩余积分权益占比 = (totalCredits - consumedCredits) / totalCredits
用户应付差价 = max(0, 目标原价 - 可抵扣剩余价值)
```

**差价为负处理：** 当可抵扣价值 ≥ 目标原价，执行免费升级，差额不返还。
**精度：** 所有占比计算使用 Math.floor，杜绝浮点数。

**consumedCredits 统计口径：** 本周期内所有通过业务消费扣减的订阅积分（含月度发放和管理员发放，二者在同一账户无法区分来源），均计入 consumedCredits。升级清零、到期清零不计入。

### 5.4 升级执行流程（Prisma 事务包裹）

1. 验证：当前有 active 订阅，目标 tier > 当前 tier
2. 调用计价引擎计算差价
3. 需要补差价时，验证普通积分充足
4. 事务执行（严格按序）：
   - 创建 SubscriptionOrder (type=upgrade, deductibleAmount, pricingSnapshot) — 先建单拿到订单 ID
   - 扣减普通积分差价（如差价 > 0）
   - 写入 CreditTransaction（type=subscription_payment，creditType=regular，amount 为负，referenceId=订单ID）
   - 更新原订阅：`UPDATE UserSubscription SET status = 'upgraded' WHERE id = ? AND status = 'active'` — 行数=0 则事务回滚
   - 原订阅积分清零 → UserBalance.subscriptionCredits = 0，写入 CreditTransaction (type=upgrade_clear，creditType=subscription，amount 为负)
   - 创建新 UserSubscription：
     - subscribedAt = now (UTC)
     - currentPeriodStart = now (UTC)
     - currentPeriodEnd = now + totalDays (UTC)
     - nextGrantDate = now + 30天（00:00:00 UTC）
     - grantCount = 1
     - previousSubId = 原订阅ID
     - totalCredits / totalDays / paidAmount 写入新档位锁定值
   - 发放新订阅首月积分 → 写入 CreditTransaction (type=subscription_grant，creditType=subscription，amount 为正)
   - 更新 UserBalance.subscriptionCreditsExpiry = 新订阅 currentPeriodEnd
5. 返回新订阅状态

### 5.5 积分发放调度

**定时任务执行顺序：** 先到期清零（0:30），再积分发放（2:00），避免当日到期的订阅被误发放积分。

**触发机制：** BullMQ 定时任务，每天凌晨 2:00 扫描。

**时间精度：** nextGrantDate 统一存储为对应自然日的 `00:00:00`，不保留时分秒。订阅创建时、每次发放更新时均遵循此规则。定时任务按自然日扫描，所有当日及之前到期未发放的统一执行。

**扫描条件：** `status = active AND nextGrantDate <= 今天`

**发放逻辑（事务包裹）：**
1. 校验 grantCount < 周期上限（基于订阅创建时的 period 字段：monthly→1次 / quarterly→3次 / annually→12次），防止超发。**管理员手动延长到期日不增加发放次数**，如需额外积分由管理员手动发放。
2. 发放 monthlyCredits 订阅积分 → UserBalance.subscriptionCredits += monthlyCredits
3. 写入 CreditTransaction (type=subscription_grant)
4. 更新 nextGrantDate = nextGrantDate + 30天（保持 00:00:00 精度），grantCount += 1

**故障兜底：** 任务故障次日自动补发所有逾期订阅（nextGrantDate ≤ 今天 全部覆盖）。

### 5.6 积分消费（Prisma 事务包裹）

修改现有 CreditService.deduct 逻辑：

1. 计算扣减方案：totalNeed ≤ subscriptionCredits → 全扣订阅；否则先扣订阅积分，剩余从普通积分补
2. **单次 UPDATE 同时完成两个字段的扣减与 version 递增**（同一行锁，避免分次扣减导致乐观锁失效）：
   ```
   UPDATE UserBalance
   SET subscriptionCredits = subscriptionCredits - subDeduct,
       credits = credits - regularDeduct,
       version = version + 1
   WHERE userId = ? AND version = ?
     AND subscriptionCredits >= subDeduct
     AND credits >= regularDeduct
   ```
   更新行数 = 0 → 事务回滚（乐观锁冲突或余额不足）
3. 扣减成功后：
   - 若 subDeduct > 0 → `UPDATE UserSubscription SET consumedCredits += subDeduct WHERE userId = ? AND status = 'active'`
   - 若 subDeduct = 0（全扣普通积分场景）→ 跳过此步，不更新 consumedCredits
4. 写入积分流水：
   - 若 subDeduct > 0 → 写入 CreditTransaction（type=consumption，creditType=subscription，amount 为负）
   - 若 regularDeduct > 0 → 写入 CreditTransaction（type=consumption，creditType=regular，amount 为负）
   - 同一事务内完成

### 5.7 订阅到期处理

**BullMQ 定时任务，每天 0:30 扫描：** `status = active AND currentPeriodEnd <= 今天 00:00:00 UTC`（比积分发放早执行，避免误发）。**自然日判定：** currentPeriodEnd 为当日 00:00:00 UTC 即视为当日到期，纳入当日处理（使用 `<=` 确保当日 0 点到期的订阅在当日 0:30 处理，不延迟到次日）。
**发放时二次校验：** 积分发放任务执行时，再次校验 `status = active` 兜底

**处理（事务包裹）：**
- 若 cancelledAt 有值 → status = cancelled（用户主动取消续费后到期）
- 若 cancelledAt 无值 → status = expired（自然到期）
- 订阅积分清零 → UserBalance.subscriptionCredits = 0，写入 CreditTransaction (type=expire_clear)
- 自动续费逻辑预留（本期直接走到期流程）

**清零范围：** 订阅积分全额清零，不分发放来源。同时将 UserBalance.subscriptionCreditsExpiry 置为 null。

---

## 6. 边界场景

### 6.1 连续多次升级
每次以当前生效订阅为计算基准，历史已失效订阅不参与折算。通过 previousSubId 追溯升级链。

### 6.2 赠送/优惠部分
- 运营活动赠送的时长/积分，不参与剩余价值折算，升级时直接作废（本期不涉及赠送字段，规则预留）
- 优惠券/折扣订单按实付金额作为计算基数（本期不涉及，规则预留）
- 普通积分中的赠送部分不受升级影响

### 6.3 降级
- 不支持直接降级，不提供预约降级功能
- 用户取消自动续费 → 当前权益保留至到期 → 到期后按普通用户身份重新购买任意档位

### 6.4 同档位周期变更
不支持中途变更周期，需等待当前订阅到期后重新购买。

### 6.5 重复订阅
已存在 active 订阅的用户不允许新购。需等过期或取消后重新购买（按新用户原价，无抵扣）。

### 6.6 订阅过期后重新购买
按新用户原价处理，无任何抵扣。

### 6.7 管理员发放积分
- creditType=regular：不参与自动过期，计入普通积分余额（credits）
- creditType=subscription：仅当用户存在 active 订阅时允许发放，过期时间强制 = currentPeriodEnd，随订阅到期/升级统一清零
- 无生效订阅时，禁止发放 subscription 类型积分
- 管理员发放的订阅积分与月度发放积分在同一账户（subscriptionCredits），消费时不可区分来源，统一计入 consumedCredits，参与升级抵扣计算

### 6.8 管理员修改订阅

| 操作 | 规则 |
|---|---|
| 延长到期日 | 订阅积分过期时间同步延长，不额外发放积分；不自动调整 nextGrantDate 与 grantCount |
| 缩短到期日 | 不主动提前清零积分，保留至原到期日自动清零 |
| 作废订阅 | status → cancelled；同步设置 autoRenew = false, cancelledAt = now；清零订阅积分 + subscriptionCreditsExpiry → null；写入 CreditTransaction (type=admin_clear)；记录操作人 + 变更前后值至 AuditLog |
| 手动延长周期 | 积分发放节奏保持原逻辑，不移改 nextGrantDate/grantCount；如需补充积分由管理员手动发放 |
| 修改续费字段 | 禁止单独修改 autoRenew 或 cancelledAt；二者必须同步变更：开启→autoRenew=true, cancelledAt=null；关闭→autoRenew=false, cancelledAt=now |

**审计要求：** 所有管理端修改操作（修改订阅、发放积分、修改计划）必须写入 AuditLog 表，记录操作人、操作类型、变更前后值。

### 6.9 并发防护
- Prisma 事务（userSubscription + userBalance 同一事务内操作）保证升级/消费互斥
- UserBalance.version 乐观锁防超扣
- 订单号唯一约束兜底幂等
- 前端 loading 防重复点击
- Redis 分布式锁（后续支付上线时引入，本期不涉及）

### 6.10 功能开关

| 环境变量 | 控制范围 | 关闭行为 |
|---|---|---|
| `SUBSCRIPTION_ENABLED` | 订阅功能总开关 | 入口隐藏，API 返回 403 |
| `SUBSCRIPTION_UPGRADE_ENABLED` | 升级功能子开关 | 升级入口隐藏，API 返回 403 |
| `SUBSCRIPTION_ADMIN_GRANT_ENABLED` | 管理端积分发放 | 发放按钮禁用，API 返回 403 |

关闭时已生效订阅正常运行，仅阻断新操作。支持线上故障精准熔断，无需全量关闭。

### 6.11 数据迁移
- UserBalance 新增 subscriptionCredits（默认0）、subscriptionCreditsExpiry（默认null），不影响现有普通积分
- 全量执行前在测试环境验证迁移脚本
- 历史用户无需数据回填

### 6.12 生产级注意事项
- **部分唯一索引：** `@@unique([userId], where: { status: "active" })` 依赖 PostgreSQL 部分索引，Prisma 不原生支持 `where` 语法，需手动编写迁移 SQL
- **CHECK 约束：** 建议添加 `CHECK (subscriptionCredits = 0 OR subscriptionCreditsExpiry IS NOT NULL)`，数据库层面兜底「有积分必有过期时间」
- **乐观锁自动重试：** 积分扣减、升级等核心写操作，针对乐观锁冲突 / 唯一索引冲突自动重试 2-3 次，提升接口成功率
- **事务隔离级别：** 核心写操作使用 PostgreSQL 默认 READ COMMITTED，配合行级条件更新 + 乐观锁
- **定时任务巡检：** 每日任务执行后生成报告（处理数、发放数、清零数、失败数），接入 Sentry 告警

---

## 7. 不纳入本期范围

- 微信支付接入（开发阶段用平台积分购买）
- 自动续费扣款（逻辑预留，到期直接 expired）
- 按会员等级购买普通积分折扣
- 积分不足时的充值引导流程
- 邮件/站内信通知
- Redis 分布式锁
- 赠送时长/积分字段（bonusDays、bonusPoints）
- 优惠券系统
