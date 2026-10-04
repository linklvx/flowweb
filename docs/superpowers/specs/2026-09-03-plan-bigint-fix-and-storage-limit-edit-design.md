<!-- doc-status: historical | verified_at: n/a -->
# 订阅套餐 BigInt 序列化修复 + 后台存储上限编辑 — 设计 Spec

日期：2026-09-03（v4，吸收三轮评审：修 toStorageBytes 伪代码缺陷——fallback 收敛 number 空间；删冗余 BigInt() 嵌套；两个实现提示留痕）
状态：待用户确认

## 1. 背景

- 2026-08-30 主库 reset 清空订阅数据；2026-09-03 已按 v3.8 备份恢复 4 套餐（storageLimitBytes 50/100/200/500GB）
- 恢复后浏览器验收发现 `GET /api/subscription/plans` 返回 500：`SubscriptionPlan.storageLimitBytes` 为 BigInt，Prisma row 经全局 TransformInterceptor（main.ts:90）包装后由 Express `res.json` 序列化时抛 TypeError。此前表为空（返回 `[]`）故未暴露
- 同类问题 TeamPlan 已处理（admin-team-plan.controller.ts:8 注释 + 响应统一转 Number），个人订阅模块遗漏
- 新需求：管理后台套餐管理支持设置各套餐存储上限（当前 `UpdatePlanDto` 无 `storageLimitBytes` 字段、前端表格无该列）

## 2. 受影响端点（会 500，共 7 个）

| 端点 | 调用链 | 页面 |
| --- | --- | --- |
| GET /api/subscription/plans | `SubscriptionService.getPlans()` (subscription.service.ts:45) | 前台会员中心 |
| GET /api/subscription/me | `getMySubscription()` include plan (:78) | 前台会员中心 |
| GET /api/subscription/upgrade/available | `getUpgradeAvailable()` (:87) | 前台升级 |
| GET /api/admin/subscription/plans | `getAllPlans()` (:52) | 后台套餐管理 |
| POST /api/admin/subscription/plans | `createPlan()` (:58) | 后台套餐管理 |
| PATCH /api/admin/subscription/plans/:id | `updatePlan()` (:65) | 后台套餐管理 |
| GET /api/admin/subscription/subscriptions | `AdminSubscriptionService.listSubscriptions()` include plan (admin-subscription.service.ts:10) | 后台订阅管理 |

**穷尽性已复核**：全 schema 仅 3 个 BigInt 列（SubscriptionPlan:483 / TeamPlan:725 的 storageLimitBytes、CanvasDocUpdate:823 的 seq）；全仓 `subscriptionPlan.find*` 共 9 处，除上表 7 端点外仅 order service（内部算价）与 2 个 BullMQ processor（内部使用）；collab 的 seq 走 yjs 二进制协议不过 HTTP。UserSubscription/SubscriptionOrder 模型无 BigInt 列，只需转换 plan 一层（`UserSubscription.plan` 关系必填，schema:524，无空值分支）。

**不受影响**：`upgradePreview`（:115-126 手动构造响应，无该字段）、`deletePlan`/`getSubscription`（无路由暴露，死路径——仅指出不处理）。

## 3. 修复方案（service 层单点转换）

参照 admin-team-plan.controller.ts 既有模式。**转换函数从 subscription.service.ts 导出为独立纯函数，AdminSubscriptionService 直接 import 复用**（防两份漂移；跨模块复用已核实可行：AdminSubscriptionModule 本就 imports SubscriptionModule（admin-subscription.module.ts:8），后者 exports SubscriptionService（subscription.module.ts:36），纯函数导入是单向依赖、无循环引用）：

```ts
// subscription.service.ts 导出
export function serializeSubscriptionPlan<T extends { storageLimitBytes: bigint }>(plan: T) {
  return { ...plan, storageLimitBytes: Number(plan.storageLimitBytes) };
}
```

各方法转换形态（按实际返回结构，不无脑套）：

- `getPlans` / `getAllPlans` / `getUpgradeAvailable`：顶层 `Plan[]`，`map(serializeSubscriptionPlan)`
- `getMySubscription`：`sub ? { ...sub, plan: serializeSubscriptionPlan(sub.plan) } : null`（无 active sub 时 findFirst 返回 null，必须保 null）
- `createPlan` / `updatePlan`：返回前转换
- `AdminSubscriptionService.listSubscriptions`：`items.map(i => ({ ...i, plan: serializeSubscriptionPlan(i.plan) }))`

### 写入侧：create/update 共用一套校验（v4 修正伪代码缺陷）

抽私有纯函数，双入口共用（POST 收小数同样 `BigInt()` RangeError → 500，v2 只给 update 加了校验是半成品）。**fallback 必须在 number 空间收敛，校验通过后最后一步才转 BigInt**——v3 曾把 fallback 写成 bigint（`1073741824n`），而 `Number.isFinite` 对 bigint 恒返回 false（已 Node 实证），createPlan 不传字段的正常默认路径会必抛 `PLAN_STORAGE_LIMIT_INVALID`，新套餐永远建不出来：

```ts
// 非有限数 / 非整数 / <=0 一律拒绝（与前端 precision=0、min=1 对齐；不留 0GB 口子，不静默截断吞客户端 bug）
private toStorageBytes(input: number | undefined, fallback?: number): bigint {
  const v = input ?? fallback;   // 恒为 number（update 在 != null 守卫后调用，必为 number）
  if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0)
    throw new BusinessException('PLAN_STORAGE_LIMIT_INVALID', '存储上限非法');
  return BigInt(v);
}
```

- `createPlan`：`storageLimitBytes: this.toStorageBytes(dto.storageLimitBytes, 1073741824)`（fallback 是 number 字面量；统一 BigInt 入库口径，既有单测期望值同步改 `1073741824n`）
- `updatePlan`：字段缺省不更新；存在则 `this.toStorageBytes(storageLimitBytes)`（函数已返回 bigint，**不再外层包 BigInt()**）；**其余字段原样透传**
- 错误码固定 `PLAN_STORAGE_LIMIT_INVALID`（BusinessException 默认映射 400 BAD_REQUEST，business.exception.ts:11——已核实仅显式登记 code 才映射其他状态）

**已评估不采纳**：`BigInt.prototype.toJSON` 全局补丁一行可兜底，但改变全局序列化语义、掩盖未来新增 BigInt 列的遗漏；当前仅 3 个 BigInt 列且边界清晰，显式转换更可控。

**精度结论**（显式化避免反复争论）：`Number.MAX_SAFE_INTEGER ≈ 8 PiB`，当前最大档 500GB（5.37e11）有 4 个数量级余量，Number 化无精度风险。

## 4. 新功能：后台套餐存储上限编辑

### 后端

- `UpdatePlanDto` += `storageLimitBytes?: number`
- `updatePlan`：解构 `const { storageLimitBytes, ...rest } = dto`，`data: { ...rest, ...(storageLimitBytes != null ? { storageLimitBytes: this.toStorageBytes(storageLimitBytes) } : {}) }`

### 前端（PlanManagementTab，SubscriptionTabs.tsx）

- `renderNumberEdit` 增加第 5 个可选参数 `transform?: (v: number) => number`。**实现上在函数内部统一 commit 闭包**，onBlur（:64）与 onPressEnter（:65）两个保存点共用，杜绝漏挂：
  ```ts
  const commit = () => save(record.id, field, transform ? transform(numberRef.current) : numberRef.current);
  // onBlur={commit} onPressEnter={commit}
  ```
- 新增「存储上限」列（位置：月积分 :77 之后、包月原价 :78 之前）：
  - **显示态**：显式格式化函数，裸除法对 53.25GB 会渲染出两位小数，不满足「1 位小数」规则：
    ```ts
    const toGB = (b: number) => { const g = b / 1024 ** 3; return Number.isInteger(g) ? g : Number(g.toFixed(1)); };
    ```
  - **编辑态**：`InputNumber` 复用现有交互（blur/Enter 保存、Esc 取消），额外约束 `step={1}`、`precision={0}`、`min={1}`（整数 GB；0GB 意味着套餐完全无法上传，业务上是事故值）。`defaultValue` 直接用 `bytes / 1024 ** 3` 原始值，`precision={0}` 自行整数化显示，与吸附语义一致
  - **清空行为（沿用现有交互，行为闭环）**：InputNumber 被清空时 onChange 给 null → 现有逻辑 `numberRef` 落 0 → PATCH 0 → 后端 400 拒绝 → save 的 catch 弹「更新失败」并 reload 回滚原值。无需额外处理
  - **往返吸附语义（有意行为，留痕）**：编辑态 precision=0 决定了任何非 GiB 对齐的存量值一旦被编辑保存，即吸附为整数 GB。日后勿当数据损坏 bug 报告
- 本列传 `transform: v => v * 1024 ** 3`
- `subscriptionApi.ts:4-10` `SubscriptionPlan` 接口 += `storageLimitBytes: number`（MembershipPage/VipSubscribeModal 类型链迟早要用；PlanManagementTab 本身 `any[]` 不受编译约束）

## 5. 测试计划（TDD，先红后绿）

### API（apps/api，subscription.service.spec.ts / admin-subscription.service.spec.ts）

**mock 铁律：所有 plan mock 行的 storageLimitBytes 必须用真 bigint（`1073741824n` 等 n 后缀）**——mock 数字则 `Number()` 恒等，serializePlan 等于没被测到（现有 spec :69 即数字 mock，需替换）。

1. `getPlans` / `getAllPlans`：mock BigInt 行 → `typeof result.storageLimitBytes === 'number'`
2. `getUpgradeAvailable`：mock BigInt plans → 顶层 map 后为 number
3. `createPlan`：返回值 number；`prisma.create` 入参 storageLimitBytes 为 `1073741824n`（替换现有 :75-77 数字期望）；**不传 storageLimitBytes（默认路径）→ create 成功且入参仍为 `1073741824n`**（锁死 v3 fallback 伪代码回归）；小数入参抛 `PLAN_STORAGE_LIMIT_INVALID`
4. `updatePlan`：接受合法值 → prisma.update 收到 BigInt；**其余字段原样透传**（防解构误伤）；非整数 / 0 / 负数 / 非有限数 → 抛 `PLAN_STORAGE_LIMIT_INVALID`；字段缺省 → update 入参不含该键
5. `getMySubscription`：有订阅时嵌套 plan 转换；无订阅时保持 `null`
6. `listSubscriptions`：items[].plan.storageLimitBytes 为 number
7. **回归不变量**：每个序列化用例附 `expect(() => JSON.stringify(result)).not.toThrow()`——正是本次 bug 的最小复现

### 前端（apps/web，SubscriptionTabs.test.tsx）

8. 套餐表格渲染「存储上限」列，显示 GB 值（bytes 经 toGB 换算，含非整 GiB → 1 位小数样例）
9. 编辑存储上限单元格（输入 60）→ PATCH body 的 `storageLimitBytes` **精确等于 `64424509440`**；blur 与 Enter 两条保存路径均断言

### HTTP smoke（mock 证明不了 Express 序列化层）

10. 7 端点各跑一次真实 HTTP 请求（对运行中 dev API），断言 200 且响应体可解析。**会话前置**（auth.guard.ts 已核）：`/api/subscription` 整前缀在 PUBLIC_PREFIXES——plans 免登录，但 `/me`、`upgrade/available` 内部 `uid()` 无会话抛 401，需**普通登录 cookie**；4 个 `/api/admin/*` 端点需**管理员会话**。`/me` 覆盖两分支：有 active sub（嵌套 plan 转换）与无 sub（保 null）

## 6. 验收标准

- `GET /api/subscription/plans` 返回 4 套餐 200（无 500）
- 会员中心页 `/settings/membership` 表格显示 4 套餐
- 后台 `/admin?s=subscription` 套餐管理显示 4 套餐、订阅管理不 500
- 后台编辑某套餐存储上限（普通会员 50→60GB）→ 保存后重新加载显示 60GB、DB 值为 64424509440
- 7 端点 HTTP smoke 全 200（普通会话 + 管理员会话两套）

## 7. 非目标

- 不改 schema（字段已存在）
- 不动 TeamPlan（已处理）
- 不做向后兼容防护（无用户数据）
- 不处理 deletePlan/getSubscription 死路径
- **teamApi.ts:37 `TeamPlanRow.storageLimitBytes: string` 为团队侧既有类型笔误**（controller 实际返回 number；:170 处已是 number），后续清理，本次不扩大改动面
