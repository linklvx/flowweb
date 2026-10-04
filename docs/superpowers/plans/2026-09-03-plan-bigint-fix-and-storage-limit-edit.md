<!-- doc-status: historical | verified_at: n/a -->
# 订阅套餐 BigInt 序列化修复 + 后台存储上限编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 SubscriptionPlan.storageLimitBytes（BigInt）经 Express 序列化导致的 7 端点 500，并在管理后台套餐表格增加可编辑的存储上限（GB）列。

**Architecture:** service 层单点转换——从 subscription.service.ts 导出纯函数 `serializeSubscriptionPlan` 供 AdminSubscriptionService 复用；写入侧抽私有 `toStorageBytes`（fallback 收敛 number 空间、校验后转 BigInt）create/update 共用；前端 `renderNumberEdit` 加 transform 入参做 GB→bytes 换算。

**Tech Stack:** NestJS 10 + Prisma 5.22 + Vitest（API）；React 18 + antd 5 + Vitest + Testing Library（web）。

**Spec:** docs/superpowers/specs/2026-09-03-plan-bigint-fix-and-storage-limit-edit-design.md（v4）

**测试命令基准**（Bash CWD 必须显式绝对路径，见记忆 feedback_bash_cwd）：
- API：`cd /d/flowweb/apps/api && pnpm exec vitest run src/modules/subscription/subscription.service.spec.ts`
- Admin spec：`cd /d/flowweb/apps/api && pnpm exec vitest run src/modules/subscription/admin/admin-subscription.service.spec.ts`
- Web：`cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/admin/components/SubscriptionTabs.test.tsx`

**Shell 探针**：首条测试命令即环境探针——若报「&& 不是有效语句分隔符」（PowerShell 环境），全部命令切换为 `Set-Location D:\flowweb\apps\api; pnpm exec vitest run ...`（分号 + Windows 路径），不要改写命令硬试。

---

### Task 1: 导出 serializeSubscriptionPlan + 三个顶层数组方法转换（getPlans/getAllPlans/getUpgradeAvailable）

**Files:**
- Modify: `apps/api/src/modules/subscription/subscription.service.ts:45-56, 87-99`
- Test: `apps/api/src/modules/subscription/subscription.service.spec.ts`

- [ ] **Step 1: 写失败测试（改写 2 个既有用例 + 新增 1 个 describe；mock 全部用真 bigint）**

`subscription.service.spec.ts` 的 beforeEach prisma mock 增加 `userSubscription`（getUpgradeAvailable 需要）：

```ts
    prisma = {
      subscriptionPlan: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      userSubscription: {
        findFirst: vi.fn(),
      },
    };
```

改写 `getPlans` 用例（mock 行加 `storageLimitBytes: 53687091200n` + 转换断言 + JSON 回归不变量）：

```ts
  describe('getPlans', () => {
    it('should return active plans sorted by sort order', async () => {
      prisma.subscriptionPlan.findMany.mockResolvedValue([
        { id: 'p1', name: '普通会员', tier: 'basic', monthlyCredits: 9800, priceMonthly: 100, priceQuarterly: 280, priceAnnually: 1000, sort: 1, isActive: true, storageLimitBytes: 53687091200n },
      ]);

      const result = await service.getPlans();
      expect(result).toHaveLength(1);
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { sort: 'asc' },
      });
      // BigInt 序列化回归（2026-09-03 /plans 500 最小复现）：storageLimitBytes 转 number，可过 JSON.stringify
      expect(result[0].storageLimitBytes).toBe(53687091200);
      expect(typeof result[0].storageLimitBytes).toBe('number');
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });
```

改写 `getAllPlans` 用例：

```ts
  describe('getAllPlans (admin)', () => {
    it('should return all plans including inactive', async () => {
      prisma.subscriptionPlan.findMany.mockResolvedValue([
        { id: 'p0', name: '下架档', tier: 'basic', monthlyCredits: 1, priceMonthly: 1, priceQuarterly: 1, priceAnnually: 1, sort: 0, isActive: false, storageLimitBytes: 1073741824n },
      ]);
      const result = await service.getAllPlans();
      expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({ orderBy: { sort: 'asc' } });
      expect(result[0].storageLimitBytes).toBe(1073741824);
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });
```

新增 `getUpgradeAvailable` describe（放在 deletePlan describe 之后）：

```ts
  describe('getUpgradeAvailable', () => {
    it('返回更高档套餐，plan 行 storageLimitBytes 转 number 且可 JSON 序列化', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({ id: 's1', userId: 'u1', tier: 'basic' });
      prisma.subscriptionPlan.findMany.mockResolvedValue([
        { id: 'p1', tier: 'basic', sort: 1, isActive: true, storageLimitBytes: 53687091200n },
        { id: 'p2', tier: 'pro', sort: 2, isActive: true, storageLimitBytes: 107374182400n },
      ]);

      const result = await service.getUpgradeAvailable('u1');

      expect(result.map((p: any) => p.tier)).toEqual(['pro']);
      expect(result[0].storageLimitBytes).toBe(107374182400);
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });
```

- [ ] **Step 2: 运行确认失败原因正确**

Run: `cd /d/flowweb/apps/api && pnpm exec vitest run src/modules/subscription/subscription.service.spec.ts`
Expected: 3 个用例 FAIL——`result[0].storageLimitBytes` 实际为 `53687091200n`（BigInt）而非 number / JSON.stringify 抛 TypeError

- [ ] **Step 3: 最小实现**

`subscription.service.ts`——class 定义前新增导出纯函数（import 区无需新增依赖，`BusinessException` 已在）：

```ts
// SubscriptionPlan.storageLimitBytes 为 BigInt，无法经 Express JSON.stringify 序列化（抛 TypeError → 500），
// 响应统一转 Number（对齐 admin-team-plan.controller.ts 既有约定）。导出纯函数供 AdminSubscriptionService 复用。
export function serializeSubscriptionPlan<T extends { storageLimitBytes: bigint }>(plan: T) {
  return { ...plan, storageLimitBytes: Number(plan.storageLimitBytes) };
}
```

改 `getPlans` / `getAllPlans` / `getUpgradeAvailable` 尾部：

```ts
  async getPlans() {
    const rows = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sort: 'asc' },
    });
    return rows.map((p) => serializeSubscriptionPlan(p));
  }

  async getAllPlans() {
    const rows = await this.prisma.subscriptionPlan.findMany({
      orderBy: { sort: 'asc' },
    });
    return rows.map((p) => serializeSubscriptionPlan(p));
  }
```

```ts
    return plans.filter(p => currentOrder[p.tier] > currentOrder[sub.tier]).map(p => serializeSubscriptionPlan(p));
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /d/flowweb/apps/api && pnpm exec vitest run src/modules/subscription/subscription.service.spec.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
cd /d/flowweb && git add apps/api/src/modules/subscription/subscription.service.ts apps/api/src/modules/subscription/subscription.service.spec.ts && git commit -m "fix(api): 订阅套餐响应 storageLimitBytes BigInt→Number 序列化（getPlans/getAllPlans/getUpgradeAvailable，含测试）"
```

---

### Task 2: getMySubscription 嵌套转换（保 null）+ AdminSubscriptionService.listSubscriptions 复用

**Files:**
- Modify: `apps/api/src/modules/subscription/subscription.service.ts:78-83`
- Modify: `apps/api/src/modules/subscription/admin/admin-subscription.service.ts:1-4, 18-28`
- Test: `apps/api/src/modules/subscription/subscription.service.spec.ts`（新增 describe）
- Test: `apps/api/src/modules/subscription/admin/admin-subscription.service.spec.ts`（mock 扩展 + 新增 describe）

- [ ] **Step 1: 写失败测试**

`subscription.service.spec.ts` 新增 describe（deletePlan describe 之后）：

```ts
  describe('getMySubscription', () => {
    it('有 active 订阅：嵌套 plan.storageLimitBytes 转 number 且可 JSON 序列化', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 's1', userId: 'u1', tier: 'pro', status: 'active',
        plan: { id: 'p2', name: 'Pro会员', tier: 'pro', storageLimitBytes: 107374182400n },
      });

      const result = await service.getMySubscription('u1');

      expect(result!.plan.storageLimitBytes).toBe(107374182400);
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('无 active 订阅：保持 null', async () => {
      prisma.userSubscription.findFirst.mockResolvedValue(null);

      const result = await service.getMySubscription('u1');

      expect(result).toBeNull();
    });
  });
```

`admin-subscription.service.spec.ts`——beforeEach 的 `userSubscription` mock 增加 `findMany` 与 `count`，并新增 describe（放在 cancelSubscription describe 之后）：

```ts
      userSubscription: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
```

```ts
  describe('listSubscriptions', () => {
    it('items[].plan.storageLimitBytes 转 number，可 JSON 序列化', async () => {
      prisma.userSubscription.findMany.mockResolvedValue([
        { id: 's1', userId: 'u1', tier: 'pro', status: 'active', createdAt: new Date('2026-09-01'), plan: { id: 'p2', tier: 'pro', storageLimitBytes: 107374182400n } },
      ]);
      prisma.userSubscription.count.mockResolvedValue(1);

      const result = await service.listSubscriptions({});

      expect(result.items[0].plan.storageLimitBytes).toBe(107374182400);
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });
```

- [ ] **Step 2: 运行确认失败原因正确**

Run: `cd /d/flowweb/apps/api && pnpm exec vitest run src/modules/subscription/subscription.service.spec.ts src/modules/subscription/admin/admin-subscription.service.spec.ts`
Expected: 新增 3 用例 FAIL——plan.storageLimitBytes 为 BigInt

- [ ] **Step 3: 最小实现**

`subscription.service.ts` 的 `getMySubscription`：

```ts
  async getMySubscription(userId: string) {
    const sub = await this.prisma.userSubscription.findFirst({
      where: { userId, status: 'active' },
      include: { plan: true },
    });
    return sub ? { ...sub, plan: serializeSubscriptionPlan(sub.plan) } : null;
  }
```

`admin-subscription.service.ts`——顶部 import 增加 + `listSubscriptions` 返回值转换：

```ts
import { serializeSubscriptionPlan } from '../subscription.service';
```

```ts
    return { items: items.map(i => ({ ...i, plan: serializeSubscriptionPlan(i.plan) })), total, page, pageSize };
```

（AdminSubscriptionModule 已 imports SubscriptionModule（:8）且后者 exports SubscriptionService（:36），纯函数导入单向依赖无循环——spec §3 已核实。）

- [ ] **Step 4: 运行确认通过**

Run: `cd /d/flowweb/apps/api && pnpm exec vitest run src/modules/subscription/subscription.service.spec.ts src/modules/subscription/admin/admin-subscription.service.spec.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
cd /d/flowweb && git add apps/api/src/modules/subscription/subscription.service.ts apps/api/src/modules/subscription/admin/admin-subscription.service.ts apps/api/src/modules/subscription/subscription.service.spec.ts apps/api/src/modules/subscription/admin/admin-subscription.service.spec.ts && git commit -m "fix(api): /subscription/me 与后台订阅列表嵌套 plan BigInt→Number（保 null 分支，含测试）"
```

---

### Task 3: toStorageBytes 写入校验（create/update 共用）+ UpdatePlanDto 加字段 + 返回值转换

**Files:**
- Modify: `apps/api/src/modules/subscription/subscription.service.ts:6-32, 58-70`
- Test: `apps/api/src/modules/subscription/subscription.service.spec.ts`（改写 createPlan/updatePlan 用例 + 新增）

- [ ] **Step 1: 写失败测试（改写既有 2 个用例 + 新增 4 个）**

改写 `createPlan` 用例（mock 与期望值改真 bigint + 转换断言）：

```ts
  describe('createPlan', () => {
    it('未指定 storageLimitBytes 时默认 1GB（BigInt 入库），返回转 number', async () => {
      const dto = {
        name: 'Pro', tier: 'pro' as const, monthlyCredits: 19800,
        priceMonthly: 200, priceQuarterly: 560, priceAnnually: 2000, sort: 2,
      };
      prisma.subscriptionPlan.create.mockResolvedValue({ id: 'p2', ...dto, isActive: true, storageLimitBytes: 1073741824n });

      const result = await service.createPlan(dto);
      expect(result.name).toBe('Pro');
      expect(result.tier).toBe('pro');
      expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith({
        data: { ...dto, isActive: true, storageLimitBytes: 1073741824n },
      });
      expect(result.storageLimitBytes).toBe(1073741824);
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('显式 storageLimitBytes：BigInt 入库、返回转 number', async () => {
      prisma.subscriptionPlan.create.mockResolvedValue({ id: 'p3', storageLimitBytes: 64424509440n });
      const result = await service.createPlan({
        name: 'X', tier: 'max', monthlyCredits: 1,
        priceMonthly: 1, priceQuarterly: 1, priceAnnually: 1, storageLimitBytes: 64424509440,
      });
      expect(prisma.subscriptionPlan.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ storageLimitBytes: 64424509440n }),
      }));
      expect(result.storageLimitBytes).toBe(64424509440);
    });

    it('小数 storageLimitBytes 抛 PLAN_STORAGE_LIMIT_INVALID 且不落库', async () => {
      await expect(service.createPlan({
        name: 'X', tier: 'pro', monthlyCredits: 1,
        priceMonthly: 1, priceQuarterly: 1, priceAnnually: 1, storageLimitBytes: 107374182.4,
      })).rejects.toMatchObject({ errorCode: 'PLAN_STORAGE_LIMIT_INVALID' });
      expect(prisma.subscriptionPlan.create).not.toHaveBeenCalled();
    });
  });
```

改写 `updatePlan` 用例（原 'should update plan fields' 被第一个新用例吸收）：

```ts
  describe('updatePlan', () => {
    it('storageLimitBytes 合法值 BigInt 入库、其余字段原样透传、返回转 number', async () => {
      prisma.subscriptionPlan.update.mockResolvedValue({ id: 'p1', name: 'Updated', storageLimitBytes: 64424509440n });

      const result = await service.updatePlan('p1', { name: 'Updated', storageLimitBytes: 64424509440 });

      expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Updated', storageLimitBytes: 64424509440n },
      });
      expect(result.storageLimitBytes).toBe(64424509440);
      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('storageLimitBytes 缺省：update 入参不含该键', async () => {
      prisma.subscriptionPlan.update.mockResolvedValue({ id: 'p1', name: 'Updated', storageLimitBytes: 53687091200n });
      await service.updatePlan('p1', { name: 'Updated' });
      expect(prisma.subscriptionPlan.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { name: 'Updated' },
      });
    });

    it.each([0, -1, 107374182.4, NaN, Infinity])(
      '非法 storageLimitBytes(%s) 抛 PLAN_STORAGE_LIMIT_INVALID 且不落库',
      async (bad) => {
        await expect(service.updatePlan('p1', { storageLimitBytes: bad as number }))
          .rejects.toMatchObject({ errorCode: 'PLAN_STORAGE_LIMIT_INVALID' });
        expect(prisma.subscriptionPlan.update).not.toHaveBeenCalled();
      },
    );
  });
```

- [ ] **Step 2: 运行确认失败原因正确**

Run: `cd /d/flowweb/apps/api && pnpm exec vitest run src/modules/subscription/subscription.service.spec.ts`
Expected: FAIL——`PLAN_STORAGE_LIMIT_INVALID` 未定义（errorCode 不匹配）、create 期望 `1073741824n` 实际 number `1073741824`、update 期望 BigInt 实际 number

- [ ] **Step 3: 最小实现**

`subscription.service.ts`——`UpdatePlanDto` 接口加字段（`originalPriceAnnually?: number;` 之后）：

```ts
  originalPriceAnnually?: number;
  storageLimitBytes?: number;
```

class 内新增私有方法 + 改写 createPlan/updatePlan：

```ts
  // 非有限数 / 非整数 / <=0 一律拒绝（与前端 precision=0、min=1 对齐；不留 0GB 口子，不静默截断）。
  // fallback 必须收敛 number 空间、校验通过后最后一步才转 BigInt——fallback 若为 bigint，
  // Number.isFinite 恒 false（bigint 不做类型转换），create 默认路径必抛（v3 spec 缺陷，勿回退）。
  private toStorageBytes(input: number | undefined, fallback?: number): bigint {
    const v = input ?? fallback;
    if (v == null || !Number.isFinite(v) || !Number.isInteger(v) || v <= 0)
      throw new BusinessException('PLAN_STORAGE_LIMIT_INVALID', '存储上限非法');
    return BigInt(v);
  }

  async createPlan(dto: CreatePlanDto) {
    const plan = await this.prisma.subscriptionPlan.create({
      data: { ...dto, isActive: true, storageLimitBytes: this.toStorageBytes(dto.storageLimitBytes, 1073741824) },
    });
    return serializeSubscriptionPlan(plan);
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    const { storageLimitBytes, ...rest } = dto;
    const plan = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: { ...rest, ...(storageLimitBytes != null ? { storageLimitBytes: this.toStorageBytes(storageLimitBytes) } : {}) },
    });
    return serializeSubscriptionPlan(plan);
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /d/flowweb/apps/api && pnpm exec vitest run src/modules/subscription/subscription.service.spec.ts`
Expected: 全部 PASS

- [ ] **Step 5: 全模块回归**

Run: `cd /d/flowweb/apps/api && pnpm exec vitest run src/modules/subscription`
Expected: subscription 全模块（含 banner/order/task specs）PASS——确认无其他用例依赖旧的 number 写入口径

- [ ] **Step 6: Commit**

```bash
cd /d/flowweb && git add apps/api/src/modules/subscription/subscription.service.ts apps/api/src/modules/subscription/subscription.service.spec.ts && git commit -m "feat(api): 套餐存储上限写入校验 toStorageBytes（create/update 共用，非法值 400）+ UpdatePlanDto 加字段（含测试）"
```

---

### Task 4: 前端——类型同步 + renderNumberEdit transform + 存储上限列

**Files:**
- Modify: `apps/web/src/api/subscriptionApi.ts:4-10`
- Modify: `apps/web/src/pages/admin/components/SubscriptionTabs.tsx:53-71, 73-86`
- Test: `apps/web/src/pages/admin/components/SubscriptionTabs.test.tsx`

- [ ] **Step 1: 写失败测试（mockPlans 加字段 + 新增 3 用例）**

`SubscriptionTabs.test.tsx`——mockPlans 两行各加 `storageLimitBytes`（75GB 整数样例 + 53.5GB 一位小数样例，值避开既有列的 30/50/90/100/200/399/480/500/540/135/150/1920 等数字防 getByText 多匹配）：

```ts
const mockPlans = [
  { id: 'plan1', name: '基础版', tier: 'basic', monthlyCredits: 100, storageLimitBytes: 80530636800, priceMonthly: 50, originalPriceMonthly: 30, priceQuarterly: 135, originalPriceQuarterly: 90, priceAnnually: 480, originalPriceAnnually: 399, sort: 1, isActive: true },
  { id: 'plan2', name: '专业版', tier: 'pro', monthlyCredits: 500, storageLimitBytes: 57495537152, priceMonthly: 200, originalPriceMonthly: 150, priceQuarterly: 540, originalPriceQuarterly: 400, priceAnnually: 1920, originalPriceAnnually: 1500, sort: 2, isActive: true },
];
```

新增 3 用例（describe 内、'saves on Enter key for text field' 之后）：

```ts
  it('renders storage limit column in GB (integer and 1-decimal)', async () => {
    mockFetch(mockPlans);
    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());
    expect(screen.getByText('75')).toBeInTheDocument();    // 80530636800 bytes → 75 GB
    expect(screen.getByText('53.5')).toBeInTheDocument();  // 57495537152 bytes → 53.5 GB
  });

  it('saves storage limit as bytes via PATCH on blur', async () => {
    mockFetch(mockPlans);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();

    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());

    fireEvent.click(screen.getByText('75'));
    const input = screen.getByDisplayValue('75');
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/subscription/plans/plan1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ storageLimitBytes: 64424509440 }),
        }),
      );
    });
  });

  it('saves storage limit as bytes via PATCH on Enter', async () => {
    mockFetch(mockPlans);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();

    render(<PlanManagementTab />);
    await waitFor(() => expect(screen.getByText('基础版')).toBeInTheDocument());

    fireEvent.click(screen.getByText('75'));
    const input = screen.getByDisplayValue('75');
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/subscription/plans/plan1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ storageLimitBytes: 64424509440 }),
        }),
      );
    });
  });
```

注意：若 `fireEvent.change` 未触发 antd InputNumber 的 onChange（numberRef 未更新、PATCH 出 80530636800），改用原生 setter 驱动（项目 antd5 测试既有 workaround 模式）：

```ts
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
setter.call(input, '60');
input.dispatchEvent(new Event('input', { bubbles: true }));
```

- [ ] **Step 2: 运行确认失败原因正确**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/admin/components/SubscriptionTabs.test.tsx`
Expected: 3 个新用例 FAIL——'75'/'53.5' 找不到（无存储上限列）；PATCH body 为 `{ storageLimitBytes: 60 }`（GB 未转 bytes）或无 PATCH 调用

- [ ] **Step 3: 最小实现**

`subscriptionApi.ts`——`SubscriptionPlan` 接口加字段（`monthlyCredits: number;` 之后）：

```ts
  id: string; name: string; tier: string; monthlyCredits: number;
  storageLimitBytes: number;
```

`SubscriptionTabs.tsx`——组件外顶部加常量与工具函数（`PLAN_COLORS` 定义之后）：

```ts
const GB = 1024 ** 3;
// 裸除法对 53.25GB 会渲染两位小数，显式收敛：整除显示整数，否则 1 位小数
const toGB = (b: number) => { const g = b / GB; return Number.isInteger(g) ? g : Number(g.toFixed(1)); };
```

`renderNumberEdit` 加第 5 个可选参数（transform + 编辑态额外 props），保存统一走 `commit` 闭包（onBlur/onPressEnter 双保存点共用，杜绝漏挂）：

```ts
  const renderNumberEdit = (
    v: number, record: any, field: string, min?: number,
    opts?: { transform?: (val: number) => number; editProps?: { step?: number; precision?: number } },
  ) => {
    if (editingCell === cellKey(record.id, field)) {
      numberRef.current = v;
      const commit = () => save(record.id, field, opts?.transform ? opts.transform(numberRef.current) : numberRef.current);
      return (
        <InputNumber
          autoFocus
          defaultValue={v}
          size="small"
          style={{ width: '100%' }}
          min={min ?? 0}
          onChange={val => { numberRef.current = val ?? 0; }}
          onBlur={commit}
          onPressEnter={commit}
          onKeyDown={e => { if (e.key === 'Escape') setEditingCell(null); }}
          {...(opts?.editProps ?? {})}
        />
      );
    }
    return <div onClick={() => setEditingCell(cellKey(record.id, field))} style={{ cursor: 'pointer', minHeight: 22 }}>{v}</div>;
  };
```

columns 数组在「月积分」之后、「包月原价」之前插入存储上限列（编辑态 `precision={0}` 自行整数化显示，非 GiB 对齐存量值编辑保存后吸附整数 GB——spec §4 留痕的有意行为）：

```ts
    { title: '月积分', dataIndex: 'monthlyCredits', key: 'monthlyCredits', render: (v: number, r: any) => renderNumberEdit(v, r, 'monthlyCredits') },
    { title: '存储上限(GB)', dataIndex: 'storageLimitBytes', key: 'storageLimitBytes', render: (v: number, r: any) => renderNumberEdit(toGB(v), r, 'storageLimitBytes', 1, { transform: g => g * GB, editProps: { step: 1, precision: 0 } }) },
    { title: '包月原价', dataIndex: 'originalPriceMonthly', key: 'originalPriceMonthly', render: (v: number, r: any) => renderNumberEdit(v, r, 'originalPriceMonthly') },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/admin/components/SubscriptionTabs.test.tsx`
Expected: 全部 PASS（含既有 9 个用例——renderNumberEdit 改动向后兼容）

- [ ] **Step 5: web 全量类型检查 + 回归**

Run: `cd /d/flowweb/apps/web && pnpm exec tsc --noEmit`
Expected: 无错误（strict）

Run: `cd /d/flowweb/apps/web && pnpm exec vitest run src/pages/admin/components/`
Expected: admin 组件全部 PASS

- [ ] **Step 6: Commit**

```bash
cd /d/flowweb && git add apps/web/src/api/subscriptionApi.ts apps/web/src/pages/admin/components/SubscriptionTabs.tsx apps/web/src/pages/admin/components/SubscriptionTabs.test.tsx && git commit -m "feat(web): 后台套餐管理存储上限列（GB 显示/编辑、bytes 提交）+ SubscriptionPlan 类型（含测试）"
```

---

### Task 5: HTTP smoke（7 端点真实序列化）+ 浏览器验收

**Files:**
- Create（临时，执行后删除，不入库）: `apps/api/scripts/scratch/smoke-subscription.cjs`

**前置：** API（:3000）与 web（:5173）dev server 运行中（preview_start api/web）。测试账号 `333@333.com / DevTest123456`（2026-09-01 重置，记忆 browser_acceptance_quirks）。

**已核实前提（勿凭印象改）：**
- 登录路由是 `POST /api/auth/sign-in`（auth.controller.ts:31，body `{email,password}`，成功 Set-Cookie `flowweb.session_token`）——`sign-in/email` 是 Better Auth 内部方法名，不是 URL
- User 模型无 role 列；全局仅 AuthGuard，admin 路由登录即可达（admin 角色守卫是登记在案的上线前必修项，记忆 project_launch_blockers）——无需任何角色准备
- UserSubscription 的 `subscribedAt/currentPeriodStart/currentPeriodEnd/nextGrantDate` 均 NOT NULL 无默认（schema:532-535），造测试订阅必须补齐
- 长脚本落 `.cjs` 文件执行（`node -e` 单引号内嵌长代码跨 shell 脆弱）；本会话执行 shell 为 Git Bash，`cd /d/...` 语法有效

- [ ] **Step 1: 写 smoke 脚本文件（真实 HTTP + 真实 Express 序列化层）**

创建 `apps/api/scripts/scratch/smoke-subscription.cjs`（目录不存在则先创建）：

```js
const { PrismaClient } = require('@prisma/client');
const GB = 1024 ** 3;
const BASE = 'http://localhost:3000';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : ''));
};

const prisma = new PrismaClient();

(async () => {
  let r, body, cookie, sub;

  // 1. GET /api/subscription/plans（PUBLIC_PREFIXES，无会话）
  r = await fetch(BASE + '/api/subscription/plans');
  body = await r.json();
  check('GET /plans(无会话)', r.status === 200 && body.code === 0 && Array.isArray(body.data)
    && body.data.length === 4 && body.data.every(p => typeof p.storageLimitBytes === 'number'),
    'plans=' + (body.data && body.data.length));

  // 2. 登录拿会话 cookie（路由是 /api/auth/sign-in）
  r = await fetch(BASE + '/api/auth/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '333@333.com', password: 'DevTest123456' }),
  });
  cookie = (r.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  check('登录', r.status === 200 && cookie.includes('session_token'), 'status=' + r.status);

  // 幂等清理：上次 smoke 被强杀可能残留 active sub，会让 null 分支假 FAIL（开发库无用户数据，删除安全）
  const user = await prisma.user.findUnique({ where: { email: '333@333.com' } });
  await prisma.userSubscription.deleteMany({ where: { userId: user.id, status: 'active' } });

  // 3. GET /me（无 active sub → data null 分支）
  r = await fetch(BASE + '/api/subscription/me', { headers: { cookie } });
  body = await r.json();
  check('GET /me(null 分支)', r.status === 200 && body.data === null);

  // 4. 造 active sub（补齐 4 个 NOT NULL 时间字段）→ /me 嵌套转换分支 + /upgrade/available 非空分支
  const plan = await prisma.subscriptionPlan.findFirst({ where: { tier: 'pro' } });
  const now = Date.now();
  sub = await prisma.userSubscription.create({ data: {
    userId: user.id, planId: plan.id, tier: 'pro', period: 'monthly', status: 'active',
    paidAmount: 15900, totalCredits: 4600, totalDays: 30,
    subscribedAt: new Date(now), currentPeriodStart: new Date(now),
    currentPeriodEnd: new Date(now + 30 * 864e5), nextGrantDate: new Date(now + 30 * 864e5),
  } });
  try {
    r = await fetch(BASE + '/api/subscription/me', { headers: { cookie } });
    body = await r.json();
    check('GET /me(active 分支)', r.status === 200 && body.data?.plan?.storageLimitBytes === Number(plan.storageLimitBytes),
      'storage=' + (body.data && body.data.plan && body.data.plan.storageLimitBytes));

    // upgrade/available 必须在 sub 存在时测：pro → max/ultra 两行（含 BigInt），转换路径真正被压到
    r = await fetch(BASE + '/api/subscription/upgrade/available', { headers: { cookie } });
    body = await r.json();
    check('GET /upgrade/available(pro→max/ultra)', r.status === 200 && body.code === 0
      && Array.isArray(body.data) && body.data.length === 2
      && body.data.every(p => typeof p.storageLimitBytes === 'number'),
      'tiers=' + (body.data || []).map(p => p.tier).join(','));
  } finally {
    await prisma.userSubscription.delete({ where: { id: sub.id } });
  }

  // 5. admin 4 端点（PATCH→DB 断言→还原 全程 try/finally，异常也还原 50GB）
  r = await fetch(BASE + '/api/admin/subscription/plans', { headers: { cookie } });
  body = await r.json();
  check('GET /admin/plans', r.status === 200 && body.code === 0
    && body.data.every(x => typeof x.storageLimitBytes === 'number'));

  const basic = body.data.find(x => x.tier === 'basic');
  try {
    r = await fetch(BASE + '/api/admin/subscription/plans/' + basic.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ storageLimitBytes: 60 * GB }),
    });
    body = await r.json();
    check('PATCH /admin/plans(50→60GB)', r.status === 200 && body.data?.storageLimitBytes === 60 * GB);

    const row = await prisma.subscriptionPlan.findUnique({ where: { id: basic.id } });
    check('DB 值 64424509440', row.storageLimitBytes === 64424509440n);
  } finally {
    await prisma.subscriptionPlan.update({ where: { id: basic.id }, data: { storageLimitBytes: BigInt(50) * BigInt(GB) } });
  }

  r = await fetch(BASE + '/api/admin/subscription/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ name: 'smoke临时档', tier: 'basic', monthlyCredits: 1, priceMonthly: 1, priceQuarterly: 1, priceAnnually: 1, sort: 99 }),
  });
  body = await r.json();
  check('POST /admin/plans(默认1GB路径)', r.status === 200 && body.data?.storageLimitBytes === 1073741824);
  if (body.data?.id) await prisma.subscriptionPlan.delete({ where: { id: body.data.id } });

  r = await fetch(BASE + '/api/admin/subscription/subscriptions', { headers: { cookie } });
  body = await r.json();
  check('GET /admin/subscriptions', r.status === 200 && body.code === 0
    && body.data.items.every(i => i.plan == null || typeof i.plan.storageLimitBytes === 'number'));

  const failed = results.filter(x => !x.ok);
  console.log('\n==== ' + (failed.length === 0 ? 'ALL ' + results.length + ' PASS' : failed.length + '/' + results.length + ' FAILED') + ' ====');
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: 执行 smoke**

```bash
mkdir -p /d/flowweb/apps/api/scripts/scratch && cd /d/flowweb/apps/api && node scripts/scratch/smoke-subscription.cjs
```

Expected: `ALL 10 PASS`（10 个 check：plans / 登录 / me-null / me-active / upgrade / admin-plans / PATCH / DB值 / POST / admin-subscriptions）。任何 FAIL → 停下按 systematic-debugging 排查，不带病推进

- [ ] **Step 3: 浏览器验收（preview 工具）**

1. 会员中心：导航 `/settings/membership` → 表格显示 4 套餐（普通/Pro/Max/Ultra），无 500
2. 后台套餐管理：导航 `/admin?s=subscription` → 套餐管理 tab 显示 4 行，含「存储上限(GB)」列（50/100/200/500）
3. 编辑验证：点击普通会员「50」→ 输入 60 → 回车 → 提示「已更新」→ 重新加载显示 60
4. 订阅管理 tab：列表正常加载（无 500）
5. 验证后将普通会员还原为 50（编辑回 50，或确认 Step 2 finally 已还原后显示 50）

Expected: 全部通过

- [ ] **Step 4: 清理临时脚本 + 收尾回归 + 状态汇报**

```bash
rm /d/flowweb/apps/api/scripts/scratch/smoke-subscription.cjs
```

Run: `cd /d/flowweb && pnpm test`
Expected: 全仓测试 PASS

向用户汇报：10 项 smoke 结果、浏览器验收要点、任务完成状态。

---

## Self-Review 记录

- **Spec 覆盖**：§3 转换（Task 1/2）、toStorageBytes 双入口（Task 3）、§4 后端字段+前端列/类型（Task 4）、§5 用例 1-9（Task 1: #1/#2/#7；Task 2: #5/#6/#7；Task 3: #3/#4；Task 4: #8/#9）、smoke 两套会话 + /me 双分支（Task 5）——无缺口
- **占位符扫描**：所有步骤含完整代码/命令/期望输出，无 TBD
- **类型一致性**：`serializeSubscriptionPlan`（Task 1 定义，Task 2/3 复用）、`toStorageBytes(input: number | undefined, fallback?: number): bigint`（Task 3 定义并调用两次）、`renderNumberEdit` 第 5 参数 `opts`（Task 4 定义并调用）——签名一致
