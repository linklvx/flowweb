# 规格说明：图片站标替换为 Flow123 文字站标（斜体流动感）

**日期**：2026-09-02
**状态**：待确认

## 背景

现有图片站标 `/img/LOGO.png` 显示效果不理想，决定弃用图片，改用域名文字 **Flow123** 作为站标，采用斜体流动感风格（italic + semibold + 紧字距），呼应 Flow 流动语义。

## 目标

全站图片站标替换为斜体文字站标 Flow123；登录页 banner 文字由 FlowWeb 统一为 Flow123。不引入 webfont，字体继承 body 现有系统字体栈（`index.css:31` 已与拟用栈完全一致）。

## 文字站标样式规格（最终版）

| 属性 | 值 | 说明 |
| --- | --- | --- |
| font-size | 22px（Sidebar）/ 24px（登录页，维持现状） | 用户确认 22px；登录页仅换文字与斜体风格，字号不变 |
| font-weight | 600 | 斜体下 400 偏细、700 偏粗 |
| font-style | italic | 核心特征 |
| letter-spacing | -0.04em | 7 字符紧凑 |
| line-height | 1（两处均适用） | 避免垂直撑高；登录页 banner flex 居中更精准 |
| color | #ffffff（Sidebar，背景 #141414）/ #141414（登录页，浅背景） | 各自保持现有配色逻辑 |
| user-select / white-space | none / nowrap | 站标不可选中、不换行 |
| font-family | 不写，继承 body | body 已有同款系统栈 |

**已否决的原始建议项**（与项目实际不符）：
- 多位置尺寸适配表（Header 20px / Footer 16px / 营销页 36px）——项目无这些站标位置。
- `pr-1` 防斜体右侧溢出——两处站标均独占一行，右侧无紧邻元素。
- 显式声明 font-family——继承即可。

**已知取舍**：Windows 的 Segoe UI Semibold 无真 italic 字形，浏览器合成斜体，效果略逊 macOS（用户已知悉接受）。

## 改动范围（4 处）

| # | 文件 | 现状 | 改为 |
|---|---|---|---|
| 1 | `Sidebar.tsx:39` | `<img src="/img/LOGO.png" alt="Flow123" className="block h-7 w-auto" />` | `<span className="text-[22px] font-semibold italic tracking-[-0.04em] leading-none text-white select-none whitespace-nowrap">Flow123</span>`。高度 28→22px 缩短 6px：站标与下方「新建项目」按钮的间距由 Link 的 `pb-4` 固定提供，与内容高度无关；无 border-b、无固定高度依赖，**不补偿 `h-7` 占位**（浏览器验证确认视觉节奏） |
| 2 | `Sidebar.test.tsx:22-24` | `getByAltText('Flow123')` 断言 `src='/img/LOGO.png'` | `getByText('Flow123')` 在文档中，且 `closest('a')` 的 `href` 为 `/`（防重构误删首页 Link）；img 断言删除 |
| 3 | `login/page.tsx:24-26` | `<span className="text-[24px] font-semibold text-[#141414]">FlowWeb</span>` | `<span className="text-[24px] font-semibold italic tracking-[-0.04em] leading-none text-[#141414]">Flow123</span>`。补 `leading-none` 与规格表一致；banner 容器 `flex items-center` 垂直居中更精准 |
| 4 | `login/page.test.tsx:35-38` | 断言 `getByText('FlowWeb')` | 断言 `getByText('Flow123')` |
| 5 | `LoginModal.tsx:54-56`（实施后追加，用户确认） | `<span className="text-[24px] font-semibold text-[#141414]">FlowWeb</span>` banner fallback | 与 #3 同款 Flow123 斜体样式；`LoginModal.test.tsx:72,77` 两处断言同步 FlowWeb→Flow123 |

## 明确不改动

- `public/img/LOGO.png` 文件本身保留（成为孤立资源，是否删除由用户另行决定）。
- `Sidebar.tsx` 站标 Link 的 `aria-label="首页"`、`pt-5 pb-4` 垂直节奏、`to="/"` 行为。
- `WeChatFollowModal` 的 `/img/wechat-qrcode.jpg` 等其他静态资源引用。
- `CanvasTopBar`、`SettingsLayout`（均无站标元素）。
- body 字体栈、Tailwind 配置。

## 测试策略（TDD）

每处先改测试确认红，再改实现确认绿：

1. `Sidebar.test.tsx`：改断言 → 红（img 不存在新断言失败）→ 改 `Sidebar.tsx` → 绿。
2. `login/page.test.tsx`：断言 FlowWeb → Flow123 → 红 → 改 `login/page.tsx` → 绿。

## 验证标准

1. `Sidebar.test.tsx`、`login/page.test.tsx` 全部通过。
2. `grep LOGO.png apps/web/src` 无结果（源码不再引用图片站标）。
3. 浏览器验证：侧边栏顶部显示白色斜体 Flow123，站标与「新建项目」按钮间距正常（pb-4 = 16px 不变），点击回首页；登录页 banner 显示深色斜体 Flow123 且垂直居中。
