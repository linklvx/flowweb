<!-- doc-status: historical | verified_at: n/a -->
# Plan: 会员订阅引导弹窗 (VipSubscribeModal)

## 实施概览

4 个文件变更，2 新建 2 修改。按 TDD 红-绿-重构循环逐任务执行。

**挂载位置决策**：当前项目无全局 AppLayout，弹窗挂载在 HomePage。Zustand store 是全局的，后续任意页面可直接调用 `vipModalStore.open()` 触发；届时将挂载点上移至新建的 AppLayout 即可，无需改动业务代码。

---

## 任务分解

### Task 1: vipModalStore（Zustand Store）

**文件**: `apps/web/src/stores/vipModalStore.ts` (新建)
**测试**: `apps/web/src/stores/vipModalStore.test.ts` (新建)

**实现**:
```ts
interface VipModalState {
  visible: boolean;
  open: () => void;
  close: () => void;
}
```

**测试用例**:
1. 初始状态 `visible === false`
2. `open()` 设置 `visible === true`
3. `close()` 设置 `visible === false`
4. `open()` + `close()` 完整周期

**验证**: `pnpm vitest run apps/web/src/stores/vipModalStore.test.ts`

---

### Task 2: VipSubscribeModal 组件

**文件**: `apps/web/src/components/VipSubscribeModal.tsx` (新建)
**测试**: `apps/web/src/components/VipSubscribeModal.test.tsx` (新建)

**实现分 4 个子步骤**:

#### 2.1 弹窗框架 + 交互

**遮罩与容器**：
- 遮罩层 `fixed inset-0 z-[100] bg-black/60`
- 内容区 `bg-[#1a1a1a] rounded-xl max-w-[960px] max-h-[90vh] overflow-y-auto overscroll-contain`
- 遮罩点击关闭 (`e.target === e.currentTarget`)

**进退场动效**：
- 内部维护 `exiting` 本地状态 + `exitTimerRef`
- 入场：组件挂载时 `opacity-0 scale-95`，rAF 后切换 `opacity-100 scale-100`
- 退场：监听到 store `visible` 变 false → 设置 `exiting=true`（触发 `opacity-0 scale-95`）→ `setTimeout` 200ms 后调 `store.close()` 卸载
- 全部 transition：`duration-200`

**竞态防护**：
- useEffect 清理函数中 `clearTimeout(exitTimerRef.current)`
- visible 从 false 变 true 时重置 `exiting=false` + 清除定时器
- 退场过程中再次打开 → 取消卸载 → 恢复入场态

**滚动锁定（useRef 安全恢复）**：
```ts
const originalOverflow = useRef('');
// 打开时
originalOverflow.current = document.body.style.overflow;
document.body.style.overflow = 'hidden';
// 关闭时
document.body.style.overflow = originalOverflow.current;
```

**无障碍 + 焦点**：
- `role="dialog" aria-modal="true" aria-labelledby="vip-modal-title"`
- 关闭按钮 `aria-label="关闭会员弹窗"`，热区 `w-8 h-8`
- ESC 键关闭
- 弹窗打开时自动聚焦关闭按钮（`useEffect` + `ref.focus()`）

#### 2.2 Banner + Tab + 周期选择
- 促销 Banner（CSS gradient 背景，预留图片容器结构）
- 倒计时（`font-mono` 等宽数字，静态展示）
- 创作会员 / 团队版会员 Tab 切换（通用 Tab 结构）
- 连续包年/包季/包月周期选择（`PLANS_BY_PERIOD` 驱动）
- 默认选中 "连续包月"

#### 2.3 套餐卡片列表

**卡片**：4 个（普通/Pro/Max/Ultra），每卡片含价格区、积分区、权益列表、开通按钮。

**横向滚动**：
- 原生 `overflow-x-auto scroll-smooth overscroll-contain`
- 左右箭头 `scrollBy({ left: ±cardStep, behavior: 'smooth' })`，`cardStep` = 单卡片宽度 + 间距（≈322px）
- **边界禁用**：监听 `scroll` 事件，对比 `scrollLeft`/`scrollWidth`/`clientWidth`
  - 最左 → 左箭头 `opacity-50 cursor-not-allowed pointer-events-none`
  - 最右 → 右箭头 `opacity-50 cursor-not-allowed pointer-events-none`

**选中与交互**：
- `activeTier` 默认 Pro，选中态 `border-2 border-[#4ade80] bg-[#252525]`（与周期选中态一致）
- Hover 态 `hover:border-[#4ade80]/50 hover:bg-[#252525]`
- **键盘可访问性**：`tabIndex={0}`，`onKeyDown` 处理 Enter / Space 切换选中

#### 2.4 FAQ 折叠面板 + 底部说明
- 手风琴折叠，**非互斥模式**（可同时展开多个），用 `Set<string>` 管理展开状态
- `aria-expanded` / `aria-controls` 属性
- 底部免费用户权益说明文字

**测试用例（15 个）**:
1. `visible=true` 时渲染弹窗内容
2. 点击遮罩层调用 store.close
3. 点击关闭按钮调用 store.close
4. ESC 键调用 store.close
5. 弹窗打开时 body overflow 为 hidden，关闭后恢复原始值
6. 默认渲染 4 张套餐卡片
7. 周期切换后卡片数据更新
8. 点击 FAQ 项展开/收起（验证多项可同时展开）
9. 切换 Tab 到团队版显示占位内容
10. 默认选中 "连续包月" + Pro 套餐
11. 弹窗根节点有 `role="dialog"` `aria-modal="true"`
12. 关闭按钮有 `aria-label`
13. 点击套餐卡片切换 activeTier，选中态样式正确
14. 滚动到边界时对应箭头处于禁用状态
15. 套餐卡片支持 Enter/Space 键盘选中

**延后**：焦点陷阱（focus trap）测试成本较高，后续迭代补充。

**验证**: `pnpm vitest run apps/web/src/components/VipSubscribeModal.test.tsx`

---

### Task 3: Navbar 按钮改造

**文件**: `apps/web/src/pages/home/components/Navbar.tsx` (修改)
**测试**: `apps/web/src/pages/home/components/Navbar.test.tsx` (修改，已有)

**改动**:
- 引入 `useVipModalStore`
- 将 "会员充值" 按钮（语义定位：`CrownOutlined` + "会员充值" 文字的按钮）从 `<Link to="/settings/membership">` 改为 `<button onClick={vipModalStore.open}>`
- 移除不再需要的 `Link` import（如果该 import 仅用于此按钮）

**测试用例（新增）**:
1. 点击 "会员充值" 按钮调用了 store.open
2. 按钮渲染为 `<button>` 而非 `<a>` 标签

**验证**: `pnpm vitest run apps/web/src/pages/home/components/Navbar.test.tsx`

---

### Task 4: HomePage 挂载弹窗

**文件**: `apps/web/src/pages/home/index.tsx` (修改)
**测试**: `apps/web/src/pages/home/page.test.tsx` (修改，已有)

**改动**:
- 引入 `VipSubscribeModal` + `useVipModalStore`
- 在页面底部条件渲染 `{visible && <VipSubscribeModal />}`

**验证**: `pnpm vitest run apps/web/src/pages/home/page.test.tsx`

---

## Mock 数据结构

### PLANS_BY_PERIOD（组件内常量）

折扣逻辑一致性：年卡 37 折 = 月均单价 = 月价 × 0.37，确保各周期数据不矛盾。

```ts
const PLANS_BY_PERIOD: Record<SubscriptionPeriod, VipPlan[]> = {
  monthly: [
    { tier: 'basic', name: '普通', price: 49, originalPrice: 66, discountTag: '75折',
      monthlyPoints: 1500, imageEstimate: 6000, videoEstimate: 300,
      concurrentLimit: 8, storageSize: '60GB', annualSavingPercent: 20, rights: {...} },
    { tier: 'pro', name: 'Pro', price: 149, originalPrice: 199, discountTag: '75折',
      monthlyPoints: 4600, imageEstimate: 18400, videoEstimate: 920,
      concurrentLimit: 12, storageSize: '100GB', annualSavingPercent: 46, rights: {...} },
    { tier: 'max', name: 'Max', price: 499, originalPrice: 669, discountTag: '75折',
      monthlyPoints: 16300, imageEstimate: 65200, videoEstimate: 3260,
      concurrentLimit: 20, storageSize: '300GB', annualSavingPercent: 47, rights: {...} },
    { tier: 'ultra', name: 'Ultra', price: 999, originalPrice: 1299, discountTag: '77折',
      monthlyPoints: 32800, imageEstimate: 131200, videoEstimate: 6560,
      concurrentLimit: null, storageSize: '600GB', annualSavingPercent: 47, rights: {...} },
  ],
  quarterly: [...],  // 季价 = 月价 × 3 × 季折扣
  annually: [...],   // 年价 = 月价 × 12 × 年折扣
};
```

### FAQ_LIST

```ts
const FAQ_LIST: FaqItem[] = [
  { id: 'expiry', question: '积分有效期规则', answer: '...' },
  { id: 'refund', question: '会员&积分 退款规则', answer: '...' },
  { id: 'return', question: '积分返还规则', answer: '...' },
  { id: 'order', question: '积分消耗顺序', answer: '...' },
  { id: 'more', question: '如何获取更多积分', answer: '...' },
  { id: 'invoice', question: '发票申请与联系方式', answer: '...' },
  { id: 'protect', question: '会员权益7天保护计划', answer: '...' },
];
```

---

## 边界与风险确认

| 项 | 状态 |
|------|------|
| 季付/年付 Mock 价格与月付折扣逻辑一致 | 已纳入 Plan |
| "团队版会员" 仅展示占位，无业务逻辑 | 已确认 |
| 开通按钮仅预留回调，不接真实支付 | 已确认 |
| 倒计时为纯静态展示，无真实计时 | 已确认 |
| 不影响原 `/settings/membership` 会员中心 | 已确认（仅改 Navbar 按钮+新增弹窗） |
| 退场动效竞态防护 | 已纳入 2.1（cleanup + 重置退出态） |

---

## 执行顺序

```
Task 1 (store) → Task 2 (组件) → Task 3 (Navbar) → Task 4 (HomePage)
```

每个 Task 严格遵循 TDD：先写测试 → 确认失败 → 写实现 → 测试通过 → 提交。

---

## 验证命令

```bash
# 全部测试
pnpm vitest run

# 单 Task 验证
pnpm vitest run apps/web/src/stores/vipModalStore.test.ts
pnpm vitest run apps/web/src/components/VipSubscribeModal.test.tsx
pnpm vitest run apps/web/src/pages/home/components/Navbar.test.tsx
```
