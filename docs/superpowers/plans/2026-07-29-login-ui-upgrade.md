<!-- doc-status: historical | verified_at: n/a -->
# Login UI Upgrade — 实施计划

## 总览

按 spec 设计，从叶子组件到组合组件逐层 TDD 实现。每个组件遵循 RED → GREEN → REFACTOR。

## 执行顺序

```
AgreementFooter → WeChatQRLogin → PhoneLoginForm → LoginModal → LoginPage → Navbar
```

---

## Task 1: AgreementFooter（底部协议栏）

**文件：**
- 新建 `apps/web/src/components/auth/AgreementFooter.tsx`
- 新建 `apps/web/src/components/auth/AgreementFooter.test.tsx`

**Props（命名导出）：**
```typescript
export interface AgreementFooterProps {
  className?: string;
}
```

**测试（RED → GREEN）：**

| # | 用例 | 类型 |
|---|------|------|
| 1.1 | 渲染两行文字——第一行「登录即代表同意《用户协议》和《隐私政策》」，第二行「未注册手机号将自动注册」 | 渲染 |
| 1.2 | 两个链接 href 为 `#`，有 `target="_blank"` 和 `rel="noopener noreferrer"` | 渲染 |
| 1.3 | 链接文字颜色类名存在（不校验具体色值），结构完整性由快照覆盖 | 渲染 |
| 1.4 | 快照测试 | 快照 |

**实现要点：**
- 两行居中布局，行间距 4px（`gap-y-1` 或 `space-y-1`）
- 背景 `bg-[#1a1a1a]`，全宽，`rounded-b-[12px]`，`py-3`
- `<a>` 链接：`text-brand-green`，`target="_blank"`，`rel="noopener noreferrer"`
- href 暂用 `#`，上方标注 `// TODO: 替换为真实路由`

**验证：** `pnpm test -- AgreementFooter`

---

## Task 2: WeChatQRLogin（微信扫码登录）

**文件：**
- 新建 `apps/web/src/components/auth/WeChatQRLogin.tsx`
- 新建 `apps/web/src/components/auth/WeChatQRLogin.test.tsx`

**Props（命名导出）：**
```typescript
export interface WeChatQRLoginProps {
  qrCodeUrl?: string;
  onRefresh?: () => void;
  onAlternativeLogin?: () => void;
  className?: string;
}
```

**测试（RED → GREEN）：**

| # | 用例 | 类型 |
|---|------|------|
| 2.1 | 渲染标题"微信扫码登录"、QR 区域、提示文字"使用微信扫码快捷登录"、"或"分隔线、备用登录按钮 | 渲染 |
| 2.2 | 未传入 `qrCodeUrl` 时，灰色占位 + "二维码加载中"文字 | 状态 |
| 2.3 | QR 图片加载失败（fire `onError`）→ 显示"加载失败，点击重试"占位 | 状态 |
| 2.4 | QR 过期状态 → 遮罩 + "二维码已过期\n点击刷新"，点击遮罩后恢复正常（调用 onRefresh） | 状态 |
| 2.5 | 过期与加载失败互斥——加载失败优先级 > 过期，不同时显示 | 状态 |
| 2.6 | 点击备用登录按钮触发 `onAlternativeLogin` | 交互 |
| 2.7 | 快照测试 | 快照 |

> hover 样式不在单测中校验（JSDOM 不稳定），由快照测试覆盖。

**实现要点：**
- QR 容器 145×145，背景 `bg-[#1a1a1a]`，圆角 8px，flex 居中
- QR 图片 135×135，圆角 4px，`alt="微信扫码登录二维码"`
- 状态管理：`qrLoadFailed`、`qrExpired` 互斥，`qrLoadFailed` 优先
- 点击过期遮罩/失败占位 → 先重置本地状态，再调用 `onRefresh?.()`
- 默认占位（无 qrCodeUrl）→ `bg-[#1a1a1a]` + 文字"二维码加载中"，`#888`，12px
- 过期遮罩：`bg-black/60`，绝对定位，圆角 4px
- "或"分隔线：两侧 `flex-1 h-[1px] bg-[rgba(255,255,255,0.1)]` + 中间文字 `#888`，font 12px
- 备用登录按钮：width 196px，height 40px，边框 `1px solid rgba(255,255,255,0.1)`，文字 `#888`，hover 边框+文字 → `#4ade80`

**验证：** `pnpm test -- WeChatQRLogin`

---

## Task 3: PhoneLoginForm（手机号登录表单）

**文件：**
- 新建 `apps/web/src/components/auth/PhoneLoginForm.tsx`
- 新建 `apps/web/src/components/auth/PhoneLoginForm.test.tsx`

**常量：**
```typescript
const COUNTDOWN_SECONDS = 60;
```

**Props（命名导出）：**
```typescript
export interface PhoneLoginFormProps {
  onLogin?: (phone: string, code: string) => void;
  loading?: boolean;
  errorMsg?: string;
  className?: string;
}
```

回调 Props 默认值：`onLogin` 默认 `() => {}`，`loading` 默认 `false`，`errorMsg` 默认 `''`。

**测试（RED → GREEN）：**

| # | 用例 | 类型 |
|---|------|------|
| 3.1 | 渲染标题"手机号登录"、+86 前缀、手机号输入框（placeholder/aria-label/maxLength=11/inputMode="numeric"）、验证码输入框（placeholder/aria-label/maxLength=6/inputMode="numeric"）、获取验证码按钮、登录按钮 | 渲染 |
| 3.2 | 手机号输入 maxLength=11，第 12 位无法输入 | 交互 |
| 3.3 | 验证码输入 maxLength=6，第 7 位无法输入 | 交互 |
| 3.4 | 点击"获取验证码" → 倒计时 60s，按钮文字变为"59s后重试"，按钮 disabled | 交互 |
| 3.5 | 倒计时结束 → 恢复"获取验证码"，按钮可点击 | 交互 |
| 3.6 | 点击登录按钮 → `onLogin` 被调用，传入 phone 和 code 参数 | 交互 |
| 3.7 | errorMsg 非空 → 红色文字显示；空字符串 → 保留 30px 高度 | 渲染 |
| 3.8 | 组件卸载时清除倒计时定时器（`vi.useFakeTimers()` + unmount 后无剩余 timer） | 内存 |
| 3.9 | loading=true 时登录按钮 disabled，opacity 0.5 | 状态 |
| 3.10 | 快照测试 | 快照 |

**实现要点：**
- `<Input bordered={false}>` + Tailwind className 控制所有样式
- +86 前缀：传入自定义 ReactNode 作为 `prefix`，完全控制 82px 宽度、右侧 `1px solid rgba(255,255,255,0.2)` 分隔线、文字色 `#e2e8f0`、font-size 15px
- 手机号框：height 48px，padding-left 82px，margin-top 24px，`focus:ring-1 focus:ring-[#4ade80]`
- 验证码框：height 48px，padding-right 180px，margin-top 16px，`focus:ring-1 focus:ring-[#4ade80]`
- 验证码按钮：绝对定位，right 12px，top 50% translateY(-50%)，40×94px，圆角 8px
- 倒计时逻辑：`useEffect` + `setInterval`，依赖 `countdown`，cleanup `clearInterval`
- 错误行：height 30px，line-height 30px，font-size 12px，color `#F53F3F`
- 登录按钮：`<Button type="text">` + `bg-brand-green`，width 320px，height 48px，圆角 8px
- 所有按钮 `type="button"`（除提交可为 submit）
- `aria-label`：手机号框、验证码框、获取验证码按钮、登录按钮

**验证：** `pnpm test -- PhoneLoginForm`

---

## Task 4: LoginModal（弹窗容器）

**文件：**
- 新建 `apps/web/src/components/auth/LoginModal.tsx`
- 新建 `apps/web/src/components/auth/LoginModal.test.tsx`

**Props（命名导出）：**
```typescript
export interface LoginModalProps {
  onClose: () => void;
  bannerUrl?: string;
}
```

**设计决策：基于 AntD `<Modal>` 封装**，复用原生 ESC 关闭、遮罩点击关闭、无障碍焦点管理。视觉样式通过 `styles` 和 `className` 覆盖。

**测试（RED → GREEN）：**

| # | 用例 | 类型 |
|---|------|------|
| 4.1 | 渲染 Banner 区 + PhoneLoginForm + 分隔线 + WeChatQRLogin + AgreementFooter | 渲染 |
| 4.2 | 调用 `onClose`（Modal `onCancel`） | 交互 |
| 4.3 | Banner 加载失败（fire `onError`）→ 渐变占位 + "FlowWeb" 文字（24px/600/#e2e8f0）| 状态 |
| 4.4 | 快照测试（使用 `asFragment()`） | 快照 |

**实现要点：**
- `<Modal open={true} onCancel={onClose} centered destroyOnClose footer={null} closable={true}>`
- Modal `styles.content` 设置背景透明/padding 0 等
- 容器 720px，边框 `1px solid rgba(255,255,255,0.1)`，圆角 16px
- Banner `onError` → 渐变 `from-[#1a1a1a] to-[#222222]` + "FlowWeb" 居中，font-size 24px，font-weight 600，`#e2e8f0`
- 分隔线渐变：`linear-gradient(180deg, rgba(255,255,255,0.1) 0%, #fff 35%, #fff 65%, rgba(255,255,255,0.1) 100%)`，opacity 0.1
- 组合 PhoneLoginForm + 分隔线 + WeChatQRLogin + AgreementFooter

**验证：** `pnpm test -- LoginModal`

---

## Task 5: LoginPage（独立登录页）

**文件：**
- 编辑 `apps/web/src/pages/login/page.tsx`
- 编辑 `apps/web/src/pages/login/page.test.tsx`

**布局：** 卡片 720px，保留 Banner、双栏、协议栏（与弹窗一致），**无关闭按钮**（页面级入口）。

**测试更新：**

| # | 用例 | 类型 |
|---|------|------|
| 5.1 | 全屏背景 `#0f0f0f`，卡片水平垂直居中 | 渲染 |
| 5.2 | Banner + PhoneLoginForm + WeChatQRLogin + AgreementFooter 均正确渲染 | 渲染 |
| 5.3 | 无关闭按钮 | 渲染 |

**实现要点：**
```tsx
<div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">
  <div className="w-[720px] ...">
    {/* Banner + 双栏 + AgreementFooter，与 LoginModal 内层一致 */}
  </div>
</div>
```

**验证：** `pnpm test -- login/page`

---

## Task 6: Navbar 集成 + AuthModal 标记废弃

**文件：**
- 编辑 `apps/web/src/pages/home/components/Navbar.tsx`
- 编辑 `apps/web/src/pages/home/components/Navbar.test.tsx`
- 编辑 `apps/web/src/components/AuthModal.tsx`

**前置检查：**
```bash
grep -r "AuthModal" apps/web/src --include="*.tsx" --include="*.ts"
```
确认所有 AuthModal 引用，确保全部替换。

**变更：**
1. Navbar.tsx import：`AuthModal` → `LoginModal`，路径 `@/components/AuthModal` → `@/components/auth/LoginModal`
2. 状态变量 `showAuthModal` → `showLoginModal`，handler（如有 `openAuthModal`）同步重命名
3. JSX：`<AuthModal onClose={...}>` → `<LoginModal onClose={...}>`
4. AuthModal.tsx：文件顶部添加 `/** @deprecated 请使用 @/components/auth/LoginModal 替换 */`
5. Navbar.test.tsx：import 和 render 引用同步更新

**验证：**
- `pnpm test -- Navbar`
- `pnpm test -- AuthModal`（旧测试仍需通过）

---

## Task 7: 全量回归

```bash
pnpm test                          # 全量测试通过
npx tsc --noEmit -p apps/web       # TypeScript 类型检查通过
```

---

## 工程规范

| 规范 | 要求 |
|------|------|
| 路径别名 | 所有内部导入使用 `@/components/auth/xxx` |
| 类型导出 | 所有 Props interface 命名导出 |
| 主题变量 | 优先 `text-brand-green` / `bg-brand-green`，无对应类时用任意值 |
| 无障碍 | Input 有 `aria-label`，图标按钮有 `aria-label`，按钮显式 `type` 属性 |
| AntD 组件 | Input 统一 `bordered={false}`，Button 统一 `type="text"` |

## 风险提示

1. **AntD 样式覆盖**：Input/Modal 内置样式可能干扰，重点关注输入框内边距、前缀分隔线、Modal content padding，需在浏览器中像素级验证。
2. **快照稳定性**：快照使用 `asFragment()` 捕获核心结构，避免 AntD 内部 DOM 变化导致频繁失效。

---

## 文件清单

| # | 文件 | 操作 |
|---|------|------|
| 1 | `apps/web/src/components/auth/` | 新建目录 |
| 2 | `.../auth/AgreementFooter.tsx` | 新建 |
| 3 | `.../auth/AgreementFooter.test.tsx` | 新建 |
| 4 | `.../auth/WeChatQRLogin.tsx` | 新建 |
| 5 | `.../auth/WeChatQRLogin.test.tsx` | 新建 |
| 6 | `.../auth/PhoneLoginForm.tsx` | 新建 |
| 7 | `.../auth/PhoneLoginForm.test.tsx` | 新建 |
| 8 | `.../auth/LoginModal.tsx` | 新建 |
| 9 | `.../auth/LoginModal.test.tsx` | 新建 |
| 10 | `components/AuthModal.tsx` | 加 @deprecated |
| 11 | `pages/login/page.tsx` | 重写 |
| 12 | `pages/login/page.test.tsx` | 更新 |
| 13 | `pages/home/components/Navbar.tsx` | 更新 import |
