# Spec: 会员订阅引导弹窗 (VipSubscribeModal)

## 目标

制作一个全屏遮罩的会员订阅引导弹窗，替代原有 Navbar "会员充值" 按钮直接跳转到 `/settings/membership` 的行为。原会员中心 (`/settings/membership`) 保持不变。

本次只做前端 UI，但组件结构需为后续接入真实订阅逻辑做铺垫。

---

## 触发方式 / 状态管理

### Zustand Store（对齐项目 confirmModalStore 模式）

新建 `apps/web/src/stores/vipModalStore.ts`：

```ts
interface VipModalState {
  visible: boolean;
  open: () => void;
  close: () => void;
}
```

- Navbar "会员充值" 按钮 → `vipModalStore.open()`
- 关闭按钮 / 遮罩点击 / ESC 键 → `vipModalStore.close()`
- `VipSubscribeModal` 在 App 根级条件渲染：`{visible && <VipSubscribeModal />}`（非 CSS display:none）

### 交互规格

| 交互 | 行为 |
|------|------|
| 弹窗打开 | 锁定背景滚动 `document.body.style.overflow = 'hidden'`，关闭时恢复；自动聚焦关闭按钮 |
| 点击遮罩层 | 关闭弹窗（`e.target === e.currentTarget`） |
| 点击关闭按钮 | 关闭弹窗 |
| 按 ESC 键 | 关闭弹窗（`keydown` 监听） |
| 内容区点击 | 不冒泡到遮罩层 |
| 滚动穿透 | 纵/横滚动容器加 `overscroll-contain`，防止滚动到边缘触发背景页面滚动 |

### 入场动效

用 Tailwind 原生 transition：`opacity-0 scale-95` → `opacity-100 scale-100`，`duration-200`，打开时触发。

---

## 无障碍规范

| 元素 | 属性 |
|------|------|
| 弹窗根节点 | `role="dialog"` `aria-modal="true"` `aria-labelledby="vip-modal-title"` |
| 关闭按钮 | `aria-label="关闭会员弹窗"` |
| FAQ 折叠项标题按钮 | `aria-expanded`（当前展开状态）+ `aria-controls`（关联内容区 id） |
| 弹窗打开时 | 自动聚焦到关闭按钮（`useEffect` + `ref.focus()`） |

---

## 页面结构

### 1. 遮罩层 + 容器
- 全屏固定定位 `fixed inset-0 z-[100]`
- 深色半透明背景 `bg-black/60`
- 内容区：深色背景 `bg-[#1a1a1a]`，居中显示，最大宽度约 960px，内部 `max-height` + `overflow-y-auto` + `overscroll-contain`

### 2. 顶部促销 Banner
- 预留图片容器结构（当前用 CSS gradient 填充），后续替换运营背景图无需改动布局
- 左侧：标题 "会员限时折扣｜年卡低至 37折" + 副标题
- 右侧：倒计时组件
  - 天/时/分/秒 4 个卡片
  - 数字使用 `font-mono` 等宽字体，避免视觉跳动
  - 静态数据展示即可
- 右上角：关闭按钮 (✕)，点击热区 `w-8 h-8` 居中图标

### 3. Tab 切换栏（通用 Tab 结构）
- 两个 Tab："创作会员"（默认选中）| "团队版会员"
- 采用通用 Tab 组件结构：头部 Tab 栏 + 右侧内容区。后续新增「团队版」完整内容时仅需替换内容区
- "团队版会员" 点击后展示占位内容（"敬请期待"），本次不实现具体内容
- 选中态：文字高亮 + 底部指示条

### 4. 方案周期选择栏
- 横向排列：连续包年 | 连续包季 | 连续包月
- 每项带折扣标签 (如 "限时37折", "74折", "75折")
- 默认选中 "连续包月"
- 选中态：`border-2 border-[#4ade80] bg-[#252525]`
- 右侧："会员超市" 链接按钮（仅展示，无跳转）

### 5. 套餐卡片列表（4 个等级）

对应 `SubscriptionTier`：**普通 (basic) / Pro / Max / Ultra**

卡片横向排列，原生 `overflow-x-auto` + `scroll-smooth` + `overscroll-contain`，左右箭头操作 `scrollLeft`。不引入轮播库。

每个卡片包含：
- **头部**：套餐名、价格（大号数字+"/月"）、原价（划线）、续费提示
- **积分信息**：月度积分配额、约可生成图片/视频数量
- **年卡优惠按钮**："买年卡立省XX%"
- **开通按钮**："立即开通"（onClick 预留，本次不接真实逻辑）
- **权益列表**：限时活动区 + 通用权益区 + 独家功能区

交互：
- `activeTier` 本地状态，默认选中 **Pro**（高转化档位），选中态与周期选中态一致（`border-2 border-[#4ade80]`）
- Hover 态：`hover:border-[#4ade80]/50 hover:bg-[#252525]` 过渡效果

### 6. 底部说明文字
- 免费用户权益说明
- 订阅积分重置规则

### 7. FAQ 折叠面板
- 手风琴模式，默认全部折叠，点击展开/收起（带动画过渡）
- 问题项：积分有效期规则 / 退款规则 / 积分返还规则 / 积分消耗顺序 / 如何获取更多积分 / 发票申请 / 7天保护计划

---

## 不包含的内容

- ❌ "每月生成数量" 对比表格
- ❌ "团队版会员" tab 的完整内容（仅占位）
- ❌ 真实支付/订阅业务逻辑
- ❌ 后端 API 对接
- ❌ 倒计时真实逻辑（静态数字展示即可）
- ❌ "联系客服" 入口

---

## 类型定义与 Mock 数据规范

### 类型（对齐 `shared/types/subscription.types.ts` 的 `SubscriptionTier`）

```ts
type SubscriptionPeriod = 'monthly' | 'quarterly' | 'annually';

interface VipPlan {
  tier: SubscriptionTier;        // 'basic' | 'pro' | 'max' | 'ultra'
  name: string;                  // 显示名称
  price: number;                 // 当前周期价格（由周期决定）
  originalPrice: number;         // 原价
  discountTag: string;           // 折扣标签
  monthlyPoints: number;         // 月度积分
  imageEstimate: number;         // 约可生成图片数
  videoEstimate: number;         // 约可生成视频数
  concurrentLimit: number | null; // 并发任务数（null = 无限）
  storageSize: string;           // 存储空间
  annualSavingPercent: number;   // 年卡省百分比
  rights: {
    limited: string[];           // 限时活动权益
    general: string[];           // 通用权益
    exclusive: string[];         // 独家功能权益
  };
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}
```

### 按周期维度的数据结构（核心设计）

切换周期时价格/折扣联动，贴近真实业务逻辑，后续对接接口零改造：

```ts
const PLANS_BY_PERIOD: Record<SubscriptionPeriod, VipPlan[]> = {
  monthly: [...],
  quarterly: [...],
  annually: [...],
};

const FAQ_LIST: FaqItem[] = [...];
```

### 组件内部状态

```ts
const [period, setPeriod] = useState<SubscriptionPeriod>('monthly');
const [activeTier, setActiveTier] = useState<SubscriptionTier>('pro');
const [activeTab, setActiveTab] = useState<'creator' | 'team'>('creator');
const [expandedFaqs, setExpandedFaqs] = useState<Set<string>>(new Set());
```

### 组件 Props（为后续业务逻辑铺垫）

```ts
interface VipSubscribeModalProps {
  onSubscribe?: (tier: SubscriptionTier, period: SubscriptionPeriod) => void; // 预留
  plansByPeriod?: Record<SubscriptionPeriod, VipPlan[]>; // 预留外部注入
}
```

关闭逻辑通过 store 驱动，不作为 props 传入。

---

## 技术约束

- React 18 + TypeScript strict
- Tailwind CSS（无额外 CSS 依赖）
- 不使用 antd Modal（参考 AuthModal 纯自定义实现）
- 状态管理：新建 `vipModalStore.ts`，对齐 `confirmModalStore.ts` 模式
- 组件文件位置：`apps/web/src/components/VipSubscribeModal.tsx`
- 弹窗挂载位置：页面根级，条件渲染

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `apps/web/src/stores/vipModalStore.ts` | Zustand store |
| 新建 | `apps/web/src/components/VipSubscribeModal.tsx` | 弹窗组件 |
| 修改 | `apps/web/src/pages/home/components/Navbar.tsx` | 按钮从 `<Link>` 改为 `<button onClick>` |

## 深色主题色板

- 遮罩：`bg-black/60`
- 卡片背景：`bg-[#1a1a1a]` / `bg-[#222222]`
- 边框：`border-[#333]` / `border-[#3a3a3a]`
- 主文字：`text-[#e2e8f0]` / `text-white`
- 次要文字：`text-[#ccc]` / `text-[#888]`
- 品牌绿：`#4ade80`
- 选中/Hover：`bg-[#252525]`
- 倒计时数字：`font-mono`（等宽字体）
