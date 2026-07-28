# 登录 UI 升级 Spec — 手机号验证码 + 微信扫码登录

## 概述

将现有邮箱/密码登录 UI 替换为**手机号验证码登录 + 微信扫码登录**双栏布局。仅实现前端 UI 界面，不涉及后端业务逻辑。

## 现状

- `AuthModal.tsx`：Navbar 中的登录弹窗，邮箱+密码表单，暗色主题
- `pages/login/page.tsx`：独立登录页 `/login`，邮箱+密码表单
- 主题：暗色，主色 `#4ade80`（brand.green），背景 `#0f0f0f` / `#1a1a1a` / `#222222`
- 组件库：Ant Design 5.22.5 + Tailwind CSS 3.4.19
- Tailwind 配置：`brand.green: '#4ade80'`，`brand.dark: '#1A1A1A'`，`brand.darker: '#111'`

---

## 设计方案

### 整体布局

```
┌─────────────────────────────────────────────┐
│  Banner 图片（140px）或渐变占位              │
├─────────────────────────────────────────────┤
│  ┌──────────────────┬──┬─────────────────┐  │
│  │  手机号登录       │  │  微信扫码登录    │  │
│  │                  │  │                 │  │
│  │  [+86] 手机号    │  │  ┌───────────┐  │  │
│  │                  │  │  │  QR Code  │  │  │
│  │  验证码 [获取]    │  │  │  145×145  │  │  │
│  │                  │  │  └───────────┘  │  │
│  │  错误提示（30px） │  │  使用微信扫码... │  │  │
│  │                  │  │                 │  │  │
│  │  [登录/注册]      │  │      或         │  │  │
│  │                  │  │   [备选登录]    │  │  │
│  └──────────────────┴──┴─────────────────┘  │
│  登录即代表同意《用户协议》和《隐私政策》...  │
└─────────────────────────────────────────────┘
```

### 精确尺寸规格

| 元素 | 尺寸/样式 |
|------|----------|
| 容器总宽 | 720px |
| 容器边框 | `1px solid rgba(255,255,255,0.1)` |
| 容器圆角 | 16px |
| Banner 高度 | 140px，top 圆角 16px |
| Banner 兜底 | 渐变 `from-[#1a1a1a] to-[#222222]` + "FlowWeb" 文字居中 |
| 表单区 | margin-top: -15px，z-index: 1 |
| 内层 flex 区 | height 328px，padding-left 40px |
| 左侧手机登录区 | flex: 1 |
| 分隔线 | 1px × 280px，margin-top 8px |
| 分隔线渐变 | `linear-gradient(180deg, rgba(255,255,255,0.1) 0%, #fff 35%, #fff 65%, rgba(255,255,255,0.1) 100%)`，opacity 0.1 |
| 右侧微信扫码区 | width 320px |
| 右侧布局 | flex flex-col items-center justify-start |
| +86 前缀区 | width 82px，右侧分隔线 `1px solid rgba(255,255,255,0.2)`，padding-right 16px，font-size 15px |
| 手机号输入框 | height 48px，padding-left 82px，padding-right 20px，margin-top 24px |
| 验证码输入框 | height 48px，padding-left 20px，padding-right 180px，margin-top 16px |
| 获取验证码按钮 | height 40px，width 94px，圆角 8px，边框 `1px solid rgba(255,255,255,0.1)`，margin 12px |
| 错误提示行 | height 30px，line-height 30px，font-size 12px |
| 登录/注册按钮 | width 320px，height 48px，圆角 8px |
| QR 容器外框 | 145×145px，圆角 8px，背景 `#1a1a1a` |
| QR 图片 | 135×135px，圆角 4px |
| 提示文字 | font-size 12px，margin-top 12px |
| 备用登录按钮 | height 40px，width 196px，圆角 8px，边框 `1px solid rgba(255,255,255,0.1)` |
| 底部协议栏 | padding-y 12px，圆角 12px（bottom only） |

---

## 样式规范

### 颜色体系

| 用途 | 色值 | 备注 |
|------|------|------|
| 容器背景 | `#222222` | |
| 容器边框 | `rgba(255,255,255,0.1)` | |
| 输入框背景 | `#1a1a1a` | |
| 输入框文字 | `#e2e8f0` | |
| 标题文字 | `#e2e8f0` | font-weight: 600 |
| 辅助文字 | `#888` | |
| +86 前缀文字 | `#e2e8f0` | |
| +86 右侧分隔线 | `rgba(255,255,255,0.2)` | 1px solid |
| 主按钮背景 | `#4ade80`（brand.green） | |
| 主按钮文字 | `#000` | |
| 主按钮 hover 背景 | `#22c55e` | |
| 获取验证码文字 | `#4ade80`（brand.green） | |
| 获取验证码倒计时文字 | `#888` | |
| 获取验证码 hover 背景 | `#333` | 文字色不变 |
| 获取验证码边框 | `rgba(255,255,255,0.1)` | 1px solid |
| 错误提示 | `#F53F3F` | |
| 底部协议栏背景 | `#1a1a1a` | |
| 协议链接 | `#4ade80`（brand.green） | |
| 备用登录按钮文字 | `#888` | |
| 备用登录按钮边框 | `rgba(255,255,255,0.1)` | |
| 备用登录按钮 hover | 边框+文字 → `#4ade80` | |
| QR 过期遮罩 | `rgba(0,0,0,0.6)` | |

### 主题色引用

优先使用 Tailwind 配置中的品牌色 token（`bg-brand-green`、`text-brand-green`），而非硬编码 `#4ade80`。若 Tailwind 类无法覆盖动态场景（如 inline style），可写 `#4ade80`。

### 输入框交互态

| 状态 | 表现 |
|------|------|
| 默认 | 背景 `#1a1a1a`，无边框（`bordered={false}`） |
| focus | box-shadow/border 高亮 `#4ade80` |
| error | border `#F53F3F` |

### 按钮交互态

**主按钮（登录/注册）：**

| 状态 | 背景 | 文字 | 其他 |
|------|------|------|------|
| 默认 | `#4ade80` | `#000` | font-weight: 600 |
| hover | `#22c55e` | `#000` | |
| disabled | `#4ade80` | `#000` | opacity: 0.5 |

**获取验证码按钮（type="text"）：**

| 状态 | 背景 | 文字 | 其他 |
|------|------|------|------|
| 默认 | transparent | `#4ade80` | font-size 14px，font-weight 600 |
| hover | `#333` | `#4ade80` | |
| 倒计时 | transparent | `#888` | cursor: not-allowed |

**备用登录按钮：**

| 状态 | 边框 | 文字 |
|------|------|------|
| 默认 | `rgba(255,255,255,0.1)` | `#888` |
| hover | `#4ade80` | `#4ade80` |

### 二维码过期遮罩

- 遮罩层：`rgba(0,0,0,0.6)`，圆角 4px，绝对定位覆盖 QR 图片
- 居中文字："二维码已过期\n点击刷新"，白色，font-size 12px
- 点击遮罩 → 移除遮罩，回到正常状态

### Banner 图片兜底

- 图片 `onError` → 显示渐变占位 `from-[#1a1a1a] to-[#222222]` + 平台名 "FlowWeb" 居中

### QR 图片加载失败兜底

- `onError` → 显示灰色占位 `#1a1a1a` + "加载失败，点击重试"，font-size 12px，`#888`
- 点击占位区域 → 恢复正常状态（模拟重试）

---

## 组件拆分

### 文件结构

```
apps/web/src/components/auth/
├── LoginModal.tsx          # 弹窗容器（原 AuthModal 重构）
├── PhoneLoginForm.tsx      # 手机号登录表单
├── WeChatQRLogin.tsx       # 微信扫码登录
└── AgreementFooter.tsx     # 底部协议栏
```

弹窗与独立登录页复用 3 个子组件，仅外层容器不同。所有组件使用**命名导出**。

### 1. LoginModal（弹窗容器）

- 基于现有 AuthModal 的 backdrop 机制（`fixed inset-0 z-[100] bg-black/60`）
- 关闭交互：遮罩点击关闭、ESC 键关闭、右上角 ✕ 按钮关闭（与旧 AuthModal 一致）
- Banner + 双栏表单 + 分隔线 + AgreementFooter
- Props 包含 `onClose: () => void` 和可选的 `bannerUrl?: string`

### 2. PhoneLoginForm（手机号登录）

- 标题"手机号登录"，font-size 16px，font-weight 600，居中
- +86 前缀：Ant Design `<Input>` 的 `prefix` prop，右侧带分隔线
- 手机号输入框：`<Input bordered={false} maxLength={11} inputMode="numeric" aria-label="手机号" />`
- 验证码输入框：`<Input bordered={false} maxLength={6} inputMode="numeric" aria-label="验证码" />`
- 验证码右侧：绝对定位的获取验证码 `<Button type="text">`
- 错误提示行：固定 30px 高度
- 登录按钮：`<Button type="text">` + 自定义背景色

### 3. WeChatQRLogin（微信扫码登录）

- 标题"微信扫码登录"
- QR 码容器 145×145 + 内嵌图片 135×135
- 过期遮罩 + QR 加载失败兜底
- 提示文字"使用微信扫码快捷登录"
- "或"分隔线（两侧横线 + 中间文字）
- 备用登录入口按钮，hover 边框+文字变绿

### 4. AgreementFooter（底部协议栏）

- 背景 `#1a1a1a`，全宽，底部圆角 12px
- 文字 12px，`#888`
- 链接主色，href=`#`，标注 `// TODO: 替换为真实路由`
- 补充文字"未注册手机号将自动注册"

---

## 技术实现规范

### Ant Design 组件使用规则

**所有输入框：**
```tsx
<Input
  bordered={false}
  className="bg-[#1a1a1a] text-[#e2e8f0] ..."
  aria-label="手机号"
/>
```

**所有按钮：**
```tsx
<Button
  type="text"
  className="bg-brand-green text-black font-semibold ..."
  aria-label="登录/注册"
/>
```

- `bordered={false}` 关闭 AntD 默认边框
- `type="text"` 清除 AntD 按钮默认样式
- 样式完全通过 Tailwind className 控制

### 状态管理

全部使用组件内 `useState`，不接入 Zustand：

```typescript
// PhoneLoginForm
const [phone, setPhone] = useState('');
const [code, setCode] = useState('');
const [countdown, setCountdown] = useState(0);
const [errorMsg, setErrorMsg] = useState('');

// WeChatQRLogin
const [qrExpired, setQrExpired] = useState(false);
const [qrLoadFailed, setQrLoadFailed] = useState(false);

// LoginModal
const [bannerFailed, setBannerFailed] = useState(false);
```

### 倒计时逻辑

```typescript
useEffect(() => {
  if (countdown <= 0) return;
  const timer = setInterval(() => {
    setCountdown(prev => prev - 1);
  }, 1000);
  return () => clearInterval(timer); // 组件卸载时清除
}, [countdown]);
// 默认倒计时 60 秒
```

### TypeScript 约束

```typescript
interface PhoneLoginFormProps {
  onLogin?: (phone: string, code: string) => void;
  loading?: boolean;
  errorMsg?: string;
  className?: string;
}

interface WeChatQRLoginProps {
  qrCodeUrl?: string;
  onRefresh?: () => void;
  onAlternativeLogin?: () => void;
  className?: string;
}

interface LoginModalProps {
  onClose: () => void;
  bannerUrl?: string;
}

interface AgreementFooterProps {
  className?: string;
}
```

- 回调 Props 可选，默认值为空函数 `() => {}`
- `loading` 默认 `false`，`errorMsg` 默认 `''`

### 协议链接占位

```tsx
<a href="#" className="text-brand-green" target="_blank" rel="noopener noreferrer">
  // TODO: 替换为真实路由
  《用户协议》
</a>
```

### 无障碍

| 元素 | 属性 |
|------|------|
| 手机号输入框 | `aria-label="手机号"` |
| 验证码输入框 | `aria-label="验证码"` |
| 登录按钮 | `aria-label="登录/注册"` |
| 获取验证码按钮 | `aria-label="获取验证码"` |
| 关闭按钮 | `aria-label="关闭"` |
| Banner 图片 | `alt="登录Banner"` |
| QR 码图片 | `alt="微信扫码登录二维码"` |
| 所有按钮 | `type="button"` |

---

## 交互与状态覆盖

### 手机号输入

| 状态 | 表现 |
|------|------|
| 空 | placeholder "请输入手机号" |
| 输入中 | 仅数字（maxLength=11，inputMode="numeric"） |
| focus | 边框高亮 `#4ade80` |

### 验证码输入

| 状态 | 表现 |
|------|------|
| 空 | placeholder "请输入验证码" |
| 输入中 | 仅数字（maxLength=6，inputMode="numeric"） |
| focus | 边框高亮 `#4ade80` |

### 验证码按钮

| 状态 | 表现 |
|------|------|
| 默认 | 显示"获取验证码"，文字 `#4ade80` |
| hover | 文字色不变，背景 `#333` |
| 倒计时 | 显示"XXs后重试"，文字 `#888`，不可点击 |
| 倒计时结束 | 恢复"获取验证码"，可再次点击 |

### 提交按钮

| 状态 | 表现 |
|------|------|
| 默认 | 背景 `#4ade80`，文字 `#000` |
| hover | 背景 `#22c55e` |
| disabled | opacity: 0.5，cursor: not-allowed |

### 微信扫码

| 状态 | 表现 |
|------|------|
| 默认 | QR 码 135×135 显示 |
| 过期 | `rgba(0,0,0,0.6)` 遮罩 + "二维码已过期\n点击刷新" |
| 点击过期遮罩 | 移除遮罩，恢复正常 |
| 加载失败 | `#1a1a1a` 占位 + "加载失败，点击重试" |
| 点击加载失败 | 移除，恢复正常 |

---

## 边界与兜底

| 场景 | 处理 |
|------|------|
| Banner 图加载失败 | `onError` → 渐变占位 + "FlowWeb" 文字 |
| QR 图加载失败 | `onError` → 灰色占位 + "加载失败，点击重试" |
| 手机号超 11 位 | maxLength=11 阻止输入 |
| 验证码超 6 位 | maxLength=6 阻止输入 |
| 错误信息为空 | 错误行保留 30px 高度 |
| 组件卸载 | useEffect return 清除倒计时定时器 |
| 移动端 | **本期不做**，仅桌面端 720px |

---

## 弹窗关闭行为（与旧 AuthModal 保持一致）

| 交互 | 行为 |
|------|------|
| 点击遮罩 | `onClose()` |
| ESC 键 | `onClose()` |
| 点击 ✕ 按钮 | `onClose()` |

---

## 文件变更范围

| 文件 | 操作 |
|------|------|
| `apps/web/src/components/auth/LoginModal.tsx` | **新增** |
| `apps/web/src/components/auth/PhoneLoginForm.tsx` | **新增** |
| `apps/web/src/components/auth/WeChatQRLogin.tsx` | **新增** |
| `apps/web/src/components/auth/AgreementFooter.tsx` | **新增** |
| `apps/web/src/components/auth/LoginModal.test.tsx` | **新增** |
| `apps/web/src/components/auth/PhoneLoginForm.test.tsx` | **新增** |
| `apps/web/src/components/auth/WeChatQRLogin.test.tsx` | **新增** |
| `apps/web/src/components/auth/AgreementFooter.test.tsx` | **新增** |
| `apps/web/src/components/AuthModal.tsx` | 添加 `/** @deprecated */` JSDoc 注释，文件保留不做引用 |
| `apps/web/src/pages/login/page.tsx` | 重写，复用 PhoneLoginForm + WeChatQRLogin + AgreementFooter |
| `apps/web/src/pages/login/page.test.tsx` | 更新测试 |
| `apps/web/src/pages/home/components/Navbar.tsx` | import 从 `AuthModal` 改为 `LoginModal`（路径 `@/components/auth/LoginModal`） |

---

## 测试覆盖清单（TDD）

### 渲染测试

- [ ] LoginModal 渲染 Banner、双栏、分隔线、协议栏
- [ ] LoginModal 点击遮罩触发 onClose
- [ ] PhoneLoginForm 渲染标题、手机号框（+86 前缀）、验证码框、获取验证码按钮、登录按钮
- [ ] WeChatQRLogin 渲染标题、QR 占位区、提示文字、备用登录入口
- [ ] AgreementFooter 渲染协议文字、两个链接、补充说明文字
- [ ] LoginPage（独立页）全屏 `#0f0f0f` 背景 + 居中卡片，复用子组件

### 交互测试

- [ ] 手机号输入 maxLength=11，第 12 位无法输入
- [ ] 验证码输入 maxLength=6，第 7 位无法输入
- [ ] 点击"获取验证码" → 倒计时 60s，"59s后重试"，按钮禁用
- [ ] 倒计时结束 → 恢复"获取验证码"，再次可点击
- [ ] errorMsg 有值时显示红色文字；空字符串时保留 30px 高度
- [ ] 提交按钮 disabled → opacity 0.5

### 状态测试

- [ ] 二维码过期遮罩显示 + 点击后恢复正常
- [ ] QR 加载失败占位显示 + 点击后恢复正常
- [ ] Banner 加载失败显示渐变占位

### 键盘可访问性

- [ ] 按钮支持 Enter 触发
- [ ] 输入框支持 Tab 聚焦

### 内存安全

- [ ] 组件卸载时倒计时定时器被清除（无内存泄漏 Warning）

### 快照测试

- [ ] LoginModal 默认状态快照
- [ ] PhoneLoginForm 默认状态快照
- [ ] WeChatQRLogin 默认状态快照
- [ ] AgreementFooter 默认状态快照

---

## 非目标（本期不做）

- 后端手机号/微信登录 API
- 实际验证码发送逻辑
- 微信 OAuth 对接
- 第三方登录（QQ/微博/Google/GitHub）
- 注册页面改造
- 移动端响应式适配
- 邮箱登录功能的最终移除（仅标记 @deprecated）
